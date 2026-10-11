'use strict';

const Cursor = require('nedb/lib/cursor');
const states = new WeakMap();
const model_reads = new WeakSet();

// Only these model capture functions and NeDB's own cursors are known reads.
// Unknown jobs remain barriers regardless of their diagnostic name.
function certify_read(task) { model_reads.add(task); return task; }

function attach(store) {
	if (states.has(store)) return states.get(store);
	const pending = new Set();
	const state = { active: null, pending };
	states.set(store, state);
	state.wrap = task => {
		const kind = task.this === store.persistence && task.fn === store.persistence.persistCachedDatabase ? 'compact'
			: model_reads.has(task) || (task.this instanceof Cursor && task.this.db === store && task.fn === Cursor.prototype._exec)
				? 'read' : 'barrier';
		const job = { kind };
		pending.add(job);
		return { ...task, fn: function(...args) {
			pending.delete(job); state.active = job;
			const done = args[args.length - 1];
			args[args.length - 1] = function(...results) {
				if (state.active === job) state.active = null;
				return done.apply(this, results);
			};
			try { return task.fn.apply(this, args); }
			catch (error) { if (state.active === job) state.active = null; throw error; }
		} };
	};
	return state;
}

function inspect(store) {
	const state = states.get(store), executor = store.executor;
	if (!executor.ready) return { allowed: false, reason: 'not_ready' };
	if (state?.active?.kind !== 'compact') return { allowed: false, reason: 'no_active_compaction' };
	// Also detect jobs queued before this observer was installed, or through an
	// unobserved push: never infer that an unknown queued task is a pure read.
	if (executor.queue.running() !== 1 || state.pending.size !== executor.queue.length() + executor.buffer.length) {
		return { allowed: false, reason: 'untracked_tasks' };
	}
	// NeDB cursors can delete expired records. Do not treat them as pure reads
	// in stores with TTL indices, including indices added after enqueueing.
	if (Object.keys(store.ttlIndexes || {}).length) return { allowed: false, reason: 'ttl_index' };
	for (const job of state.pending) if (job.kind === 'barrier') return { allowed: false, reason: 'prior_write_or_unknown_task' };
	return { allowed: true, reason: 'pure_compaction' };
}

module.exports = { attach, certify_read, inspect };
