'use strict';

const { performance } = require('perf_hooks');

// Constant work at enqueue/start/finish. No payloads are retained here.
class QueueStats {
	constructor(kind = 'queue', prefix = '') {
		this.kind = kind;
		this.prefix = prefix;
		this.next_id = 0; this.pending = new Map(); this.active = new Map();
		this.completed = 0; this.failed = 0; this.high_watermark = 0;
		this.rejected = 0;
		this.recent = [];
	}
	blockers() {
		return [...this.active.values(), ...this.pending.values()].slice(0, 8).map(entry => ({
			id: entry.id, task: this.prefix + entry.task, state: this.active.has(entry.id) ? 'active' : 'pending',
			locks: [this.kind + ':' + this.prefix], conflicting_locks: [this.kind + ':' + this.prefix],
			operation_id: entry.context?.record?.id || null, trace_id: entry.context?.record?.trace_id || null,
			phase: entry.diagnostic?.phase || (entry.started ? 'running' : 'queued'),
			elapsed_ms: Math.round(performance.now() - (entry.started || entry.queued)),
			persistence_kind: entry.diagnostic?.persistence?.kind || null,
		}));
	}
	enqueue(task) {
		const entry = { id: ++this.next_id, task, queued: performance.now() };
		const traces = require('./traces'); entry.context = traces.capture();
		if (entry.context?.record) entry.wait_span = traces.begin(this.prefix + task, this.kind + '_wait', traces.enabled() ? { queue_id: this.prefix + entry.id,
			blockers: this.kind === 'db' ? this.blockers() : [] } : {});
		this.pending.set(entry.id, entry);
		this.high_watermark = Math.max(this.high_watermark, this.pending.size + this.active.size);
		return entry;
	}
	start(entry) {
		this.pending.delete(entry.id); entry.started = performance.now(); this.active.set(entry.id, entry);
		const traces = require('./traces'); traces.end(entry.wait_span);
		entry.run_span = traces.with_context(entry.context, () => traces.begin(this.prefix + entry.task, this.kind + '_run'));
		if (this.kind === 'db' && traces.enabled()) {
			const blockers = this.blockers().filter(row => row.id === entry.id);
			for (const waiting of this.pending.values()) {
				traces.update(waiting.wait_span, { blockers });
				waiting.blocker = blockers[0];
			}
		}
	}
	finish(entry, error) {
		if (!this.pending.delete(entry.id) && !this.active.delete(entry.id)) return;
		const traces = require('./traces'); traces.end(entry.wait_span, error);
		const record = entry.diagnostic, now = process.hrtime.bigint();
		const ms = start => start ? Math.round(Number(now - start) / 1e5) / 10 : null;
		const detail = record ? { before_callback_ms: record.callback_started ? Math.round(Number(record.callback_started - record.started) / 1e5) / 10 : null,
			...require('./storage_io').details(record.persistence),
			callback_ms: ms(record.callback_started), persistence_kind: record.persistence?.kind,
			persistence_ms: record.persistence ? Math.round(Number((record.persistence.finished || now) - record.persistence.started) / 1e5) / 10 : null } : {};
		traces.end(entry.run_span, error, detail);
		if (this.kind === 'db' && traces.enabled()) {
			this.recent.push({ id: entry.id, task: entry.task, ts: Date.now(), wait_ms: Math.round((entry.started || performance.now()) - entry.queued),
				runtime_ms: entry.started ? Math.round(performance.now() - entry.started) : 0, failed: !!error,
				operation_id: entry.context?.record?.id || null, trace_id: entry.context?.record?.trace_id || null, ...detail });
			if (this.recent.length > 32) this.recent.shift();
		}
		if (error) this.failed++; else this.completed++;
	}
	snapshot() {
		const now = performance.now(), oldest = this.pending.values().next().value;
		const active = this.active.values().next().value;
		return { pending: this.pending.size, active: this.active.size, recent_tasks: this.recent,
			oldest_pending_ms: oldest ? Math.round(now - oldest.queued) : 0,
			active_task: active?.task || null, active_ms: active ? Math.round(now - active.started) : 0,
			enqueued_count: this.next_id, completed_count: this.completed, failed_count: this.failed,
			rejected_count: this.rejected,
			high_watermark: this.high_watermark };
	}
}

module.exports = QueueStats;
