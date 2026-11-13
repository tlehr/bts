'use strict';

const Cursor = require('nedb/lib/cursor');
const states = new WeakMap();
const model_reads = new WeakSet();
const model_writes = new WeakMap();
const pure_compactions = new WeakSet();
const native_updates = new WeakMap();
const update_hooks = ['_update', '_getCandidates', 'getCandidates', 'addToIndexes', 'updateIndexes', 'removeFromIndexes', 'resetIndexes'];

// Establish trust before the model installs its known index observers. A
// custom datastore/index implementation must keep the ordinary queue barrier.
function prepare_native_updates(store) {
	const prototype = require('nedb').prototype;
	if (!update_hooks.every(name => store[name] === prototype[name])) return null;
	return () => native_updates.set(store, Object.fromEntries(update_hooks.map(name => [name, store[name]])));
}
function scoped_native_update(store, task) {
	const hooks = native_updates.get(store), args = task.arguments;
	if (!hooks || task.this !== store || task.fn !== hooks._update || !args) return null;
	const plain = value => value && typeof value === 'object' && !require('util').types.isProxy(value) &&
		[Object.prototype, null].includes(Object.getPrototypeOf(value));
	const query = args[0], options = args[2];
	if (!plain(query)) return null;
	const id = Object.getOwnPropertyDescriptor(query, '_id')?.value;
	const exact_query = () => plain(query) &&
		Object.prototype.hasOwnProperty.call(query, '_id') && typeof id === 'string' &&
		Object.entries(Object.getOwnPropertyDescriptors(query)).every(([key, descriptor]) =>
			['_id', 'tournament_key'].includes(key) && descriptor.enumerable && 'value' in descriptor &&
			(key === '_id' ? descriptor.value === id : typeof descriptor.value === 'string'));
	const no_upsert = () => {
		if (typeof options === 'function') return true; // NeDB's optional callback argument.
		if (!plain(options)) return false;
		const descriptor = Object.getOwnPropertyDescriptor(options, 'upsert');
		return descriptor ? 'value' in descriptor && !descriptor.value : !('upsert' in options);
	};
	const valid = () => task.this === store && task.fn === hooks._update && task.arguments === args &&
		args[0] === query && args[2] === options && no_upsert() && exact_query() &&
		update_hooks.every(name => store[name] === hooks[name]);
	if (!valid()) return null;
	// NeDB forbids changing an existing document's _id. Upserts are excluded
	// because they can insert a replacement whose ID differs from the query.
	return { ids: new Set([id]), valid };
}
function certify_write(task, ids, valid) { model_writes.set(task, { ids: new Set(ids.map(String)), valid }); return task; }
function certify_compaction(task) { pure_compactions.add(task); return task; }

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
		const write = model_writes.get(task) || scoped_native_update(store, task);
		const kind = pure_compactions.has(task) || task.this === store.persistence && task.fn === store.persistence.persistCachedDatabase ? 'compact'
			: model_reads.has(task) || (task.this instanceof Cursor && task.this.db === store && task.fn === Cursor.prototype._exec)
				? 'read' : write ? 'scoped_write' : 'barrier';
		const job = { kind, write, ttl_free: !Object.keys(store.ttlIndexes || {}).length };
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
	for (const job of state.pending) if (job.kind !== 'read' && job.kind !== 'compact') return { allowed: false, reason: 'prior_write_or_unknown_task' };
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

function inspect_disjoint(store, ids) {
	const state = states.get(store), executor = store.executor, requested = new Set(ids.map(String));
	if (!requested.size || !executor.ready || !state || executor.queue.running() !== Number(!!state.active) ||
		state.pending.size !== executor.queue.length() + executor.buffer.length) return { allowed: false, reason: 'untracked_tasks' };
	if (Object.keys(store.ttlIndexes || {}).length) return { allowed: false, reason: 'ttl_index' };
	const disjoint = job => job.ttl_free && (job.kind === 'read' || job.kind === 'scoped_write' && job.write.valid() && [...requested].every(id => !job.write.ids.has(id)));
	if (state.active && !disjoint(state.active) || [...state.pending].some(job => !disjoint(job))) return { allowed: false, reason: 'prior_write_or_unknown_task' };
	return { allowed: true, reason: 'disjoint_records' };
}

module.exports = { attach, prepare_native_updates, certify_read, certify_write, certify_compaction, inspect, inspect_idle, inspect_readonly, inspect_disjoint };
