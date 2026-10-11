'use strict';

const { isMainThread } = require('worker_threads');
const profile = require('../offload/profile');
const event_loop_probe = require('../timing/event_loop_probe');
const ms = value => Math.round(Number(value) / 1e5) / 10;
let sequence = 0;

function start(key, operation = 'automatic_preparation') {
	if (!isMainThread || !profile.timing_enabled()) return null;
	const started = process.hrtime.bigint(), start_ts = Date.now();
	const heartbeat = event_loop_probe(), phases = [], context = {};
	const id = ++sequence;
	let finished = false;
	const trace = {
		annotate(details) { Object.assign(context, details); },
		step(phase, details = {}) {
			const began = process.hrtime.bigint();
			const row = { phase, ...details, start_ts: Date.now() };
			phases.push(row);
			let ended = false;
			return (error, extra = {}) => {
				if (ended) return;
				ended = true;
				Object.assign(row, extra, { ts: Date.now(), duration_ms: ms(process.hrtime.bigint() - began),
					status: error ? 'error' : 'ok', ...(error ? { error_type: error.name } : {}) });
			};
		},
		sync(phase, details, work) {
			const done = trace.step(phase, { ...details, synchronous: true });
			const cpu_started = process.cpuUsage();
			let error;
			try { return work(); }
			catch (err) { error = err; throw err; }
			finally {
				const cpu = process.cpuUsage(cpu_started);
				done(error, { process_cpu_ms: Math.round((cpu.user + cpu.system) / 100) / 10 });
			}
		},
		finish(error, details = {}) {
			if (finished) return;
			finished = true;
			const record = { id, operation, tournament_key: key, ...context, ...details, start_ts, ts: Date.now(),
				duration_ms: ms(process.hrtime.bigint() - started), status: error ? 'error' : 'ok',
				...(error ? { error_type: error.name } : {}), phases, ...heartbeat.stop(), profile: profile.snapshot() };
			try { console.warn('[bts] preparation:timing ' + JSON.stringify(record)); } // eslint-disable-line no-console
			catch (_) { /* Diagnostics must not change the preparation result. */ }
		},
	};
	return trace;
}

module.exports = { start };
