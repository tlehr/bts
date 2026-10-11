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
	}
	enqueue(task) {
		const entry = { id: ++this.next_id, task, queued: performance.now() };
		const traces = require('./traces'); entry.context = traces.capture();
		entry.wait_span = traces.begin(this.prefix + task, this.kind + '_wait');
		this.pending.set(entry.id, entry);
		this.high_watermark = Math.max(this.high_watermark, this.pending.size + this.active.size);
		return entry;
	}
	start(entry) {
		this.pending.delete(entry.id); entry.started = performance.now(); this.active.set(entry.id, entry);
		const traces = require('./traces'); traces.end(entry.wait_span);
		entry.run_span = traces.with_context(entry.context, () => traces.begin(this.prefix + entry.task, this.kind + '_run'));
	}
	finish(entry, error) {
		if (!this.pending.delete(entry.id) && !this.active.delete(entry.id)) return;
		const traces = require('./traces'); traces.end(entry.wait_span, error); traces.end(entry.run_span, error);
		if (error) this.failed++; else this.completed++;
	}
	snapshot() {
		const now = performance.now(), oldest = this.pending.values().next().value;
		const active = this.active.values().next().value;
		return { pending: this.pending.size, active: this.active.size,
			oldest_pending_ms: oldest ? Math.round(now - oldest.queued) : 0,
			active_task: active?.task || null, active_ms: active ? Math.round(now - active.started) : 0,
			enqueued_count: this.next_id, completed_count: this.completed, failed_count: this.failed,
			rejected_count: this.rejected,
			high_watermark: this.high_watermark };
	}
}

module.exports = QueueStats;
