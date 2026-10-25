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
	// NeDB defers releasing its queue slot until after the datastore callback.
	// Keep the slot's identity through that gap, then clear it before the next
	// job starts. Otherwise a completed read and an unobserved running write
	// would both look like an empty observer with queue.running() === 1.
	const token = Symbol('read_barrier_job'), queue = store.executor.queue, push = queue.push;
	queue.push = function enqueue(task, callback) {
		if (Array.isArray(task)) {
			for (const item of task) enqueue.call(this, item, callback);
			return;
		}
		const job = task?.[token];
		return push.call(this, task, job ? function(...args) {
			if (state.active === job) state.active = null;
			return callback?.apply(this, args);
		} : callback);
	};
	state.wrap = task => {
		const kind = task.this === store.persistence && task.fn === store.persistence.persistCachedDatabase ? 'compact'
			: model_reads.has(task) || (task.this instanceof Cursor && task.this.db === store && task.fn === Cursor.prototype._exec)
				? 'read' : 'barrier';
		const job = { kind, ttl_free: !Object.keys(store.ttlIndexes || {}).length };
		pending.add(job);
		return { ...task, [token]: job, fn: function(...args) {
			pending.delete(job); state.active = job;
			job.ttl_free &&= !Object.keys(store.ttlIndexes || {}).length;
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

function inspect_idle(store) {
	const state = states.get(store), executor = store.executor;
	if (!executor.ready) return { allowed: false, reason: 'not_ready' };
	if (!state || state.active || state.pending.size || executor.queue.running() || executor.queue.length() || executor.buffer.length) {
		return { allowed: false, reason: 'busy_store' };
	}
	if (Object.keys(store.ttlIndexes || {}).length) return { allowed: false, reason: 'ttl_index' };
	return { allowed: true, reason: 'idle_store' };
}

function inspect_readonly(store) {
	const state = states.get(store), executor = store.executor;
	if (!executor.ready) return { allowed: false, reason: 'not_ready' };
	if (!state || executor.queue.running() !== Number(!!state.active) ||
		state.pending.size !== executor.queue.length() + executor.buffer.length) {
		return { allowed: false, reason: 'untracked_tasks' };
	}
	if (Object.keys(store.ttlIndexes || {}).length) return { allowed: false, reason: 'ttl_index' };
	const pure = job => job.kind === 'read' && job.ttl_free;
	if (state.active && !pure(state.active)) {
		return { allowed: false, reason: 'prior_write_or_unknown_task' };
	}
	for (const job of state.pending) if (!pure(job)) return { allowed: false, reason: 'prior_write_or_unknown_task' };
	return { allowed: true, reason: 'read_only_store' };
}

module.exports = { attach, certify_read, inspect, inspect_idle, inspect_readonly };
