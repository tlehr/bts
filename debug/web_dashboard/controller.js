'use strict';

const { EventEmitter } = require('events');
const { fork } = require('child_process');
const path = require('path');
const { build_options } = require('./options');
const Archive = require('./archive');

class Controller extends EventEmitter {
	constructor({ create_child = () => fork(path.join(__dirname, 'runner.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }) } = {}) {
		super(); this.create_child = create_child; this.child = null; this.sequence = 0; this.revision = 0; this.pending = new Map();
		this.current = { id: null, status: 'idle', snapshot: null, report: null, error: null, logs: [], ready: false };
		this.history = []; this.archive = new Archive(); this.closed = false;
	}
	state(history = true) {
		return { ...this.current, revision: this.revision, ...(history ? { history: this.history } : {}), report_available: !!(this.current.report || this.current.snapshot),
			report: undefined };
	}
	changed(point = null, reset_history = false) { this.revision++; this.emit('update', { state: this.state(false), point, reset_history }); }
	start(input) {
		if (this.closed) throw new Error('Das Testwerkzeug wird beendet.');
		if (this.child) throw new Error('Es läuft bereits ein Test.');
		const options = build_options(input);
		this.current = { id: ++this.sequence, status: 'starting', ready: false, snapshot: null, report: null, error: null, logs: [], mode: input.mode };
		this.history = [];
		this.archive = new Archive();
		let child;
		try { child = this.create_child(); }
		catch (error) { this.current.status = 'error'; this.current.error = error.message; this.changed(); throw error; }
		this.child = child;
		const id = this.current.id;
		let stop_timer, kill_timer;
		const guard = () => this.current.id === id;
		const log = chunk => {
			if (!guard()) return;
			this.current.logs.push(String(chunk).slice(0, 2000)); this.current.logs = this.current.logs.slice(-30);
		};
		child.stdout?.on('data', log); child.stderr?.on('data', log);
		child.on('message', message => {
			if (!guard()) return;
			if (message.type === 'ready') {
				this.current.ready = true;
			} else if (message.type === 'snapshot') {
				const snapshot = message.snapshot, previous = this.current.snapshot;
				if (this.current.status === 'starting' && snapshot.events.some(event => event.label === 'live-drill:start')) this.current.status = 'running';
				const restart = previous?.server_id && snapshot.server_id && previous.server_id !== snapshot.server_id;
				if (restart) this.history = [];
				this.current.snapshot = snapshot;
				const fresh = snapshot.probe.age_ms != null && snapshot.probe.age_ms + (snapshot.probe.rtt_ms || 0) <= 5000;
				const point = { ts: snapshot.ts, server_id: snapshot.server_id, measured: fresh, unobserved_db: snapshot.unobserved_db || [],
					trace_session: snapshot.processing?.session,
					stages: (snapshot.processing?.stages || []).map(row => ({ key: row.key, type: row.type, kind: row.kind, name: row.name, count: row.count, p95: row.p95, last: row.last })),
					queues: snapshot.queues.map(row => ({ key: row.key, name: row.name, pending: fresh ? row.pending : null,
						active: fresh ? row.active : null, oldest_ms: fresh ? row.oldest_pending_ms : null })),
					tv_p95: snapshot.receipts[0].p95, admin_p95: snapshot.receipts[1].p95,
					loop_p95: fresh ? snapshot.event_loop?.p95_ms ?? null : null,
					loop_max: fresh ? snapshot.event_loop?.max_ms ?? null : null };
				this.history.push(point); this.history = this.history.filter(entry => entry.ts >= snapshot.ts - 300000).slice(-301);
				this.archive.add(snapshot, point);
				this.changed(point, !!restart); return;
			} else if (message.type === 'report') this.current.report = message.report;
			else if (message.type === 'failure') this.current.error = message.error;
			else if (message.type === 'ack') {
				const command = this.pending.get(message.id);
				if (command) { this.pending.delete(message.id); clearTimeout(command.timer);
					if (message.error) command.reject(new Error(message.error)); else command.resolve(); }
				return;
			}
			this.changed();
		});
		child.once('error', error => { if (guard()) { this.current.error = error.message; this.changed(); } });
		child.once('close', (code, signal) => {
			clearTimeout(stop_timer); clearTimeout(kill_timer);
			for (const command of this.pending.values()) { clearTimeout(command.timer); command.reject(new Error('Der Test wurde beendet.')); }
			this.pending.clear();
			if (!guard()) return;
			this.child = null; this.current.ready = false;
			const reason = this.current.report?.stop_reason;
			this.current.status = this.current.error || reason === 'error' || (!reason && this.current.status !== 'stopping') ? 'error'
				: reason === 'completed' ? 'completed' : 'interrupted';
			if (this.current.status === 'error') this.current.error ||= 'Der Testprozess wurde unerwartet beendet (' + (signal || code) + ').';
			this.changed(); this.emit('finished');
		});
		this.once_stop = () => {
			stop_timer = setTimeout(() => { if (this.child === child) child.kill('SIGTERM'); }, 4000);
			kill_timer = setTimeout(() => { if (this.child === child) child.kill('SIGKILL'); }, 8000);
			stop_timer.unref(); kill_timer.unref();
		};
		child.send({ type: 'start', options }); this.changed(null, true);
		return this.state();
	}
	async command(command) {
		if (!this.child) throw new Error('Es läuft kein Test.');
		if (command === 'stop') {
			if (this.current.status === 'stopping') return;
			this.current.status = 'stopping'; this.once_stop(); this.changed();
			if (!this.current.ready) { this.child.kill('SIGTERM'); return; }
		} else {
			if (!['pause', 'faster', 'slower'].includes(command)) throw new Error('Unbekannter Befehl.');
			if (!this.current.ready || this.current.status === 'stopping') throw new Error('Der Test ist noch nicht bedienbereit.');
			if (this.current.mode === 'benchmark') throw new Error('Pause und Tempo bleiben in der festen Testsequenz automatisch.');
		}
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Der Test antwortet nicht auf den Befehl.')); }, 3000);
			this.pending.set(id, { resolve, reject, timer });
			this.child.send({ type: 'command', command, id }, error => {
				if (error && this.pending.delete(id)) { clearTimeout(timer); reject(error); }
			});
		});
	}
	export_report() {
		if (!this.current.report && !this.current.snapshot) return null;
		const snapshot = this.current.snapshot;
		const archive = this.archive.export();
		if (this.current.report?.server_performance?.traces) { archive.traces = undefined; archive.trace_source = 'server_performance.traces'; }
		return { ...(this.current.report || { stop_reason: 'in-progress', tablet_to_tv_ms: snapshot.cumulative?.tv,
			tablet_to_admin_ms: snapshot.cumulative?.admin, payload_types: snapshot.payloads, points: snapshot.points, checkins: snapshot.checkins }),
			export_version: 2, exported_at: new Date().toISOString(), partial: !this.current.report,
			dashboard: { ...archive, settings: snapshot?.settings, last_snapshot: snapshot,
				process_log_tail: this.current.logs, process_log_tail_limit: 30 } };
	}
	async close() {
		this.closed = true;
		if (!this.child) return;
		const finished = new Promise(resolve => this.once('finished', resolve));
		await this.command('stop').catch(() => {}); await finished;
	}
}

module.exports = Controller;
