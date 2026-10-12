'use strict';

const debug_flags = require('./debug_flags');
const observers = new WeakMap();
const QueueStats = require('./performance/queue_stats');
const ms = (start, end) => Math.round(Number(end - start) / 1e5) / 10;
const enabled = () => require('./server_diagnostics').enabled() || process.env.BTS_BTP_SYNC_TIMING === '1' || debug_flags.any_score_press_timing_enabled();

function origin() {
	// Only unowned diagnostic jobs need a call site. Export source locations,
	// never paths, query values or complete stacks.
	const frames = (new Error().stack || '').split('\n').map(line => line.match(/[/\\]bts[/\\]([^/\\]+\.js):(\d+):\d+/))
		.filter(frame => frame && !['database_tasks.js', 'database.js', 'utils.js'].includes(frame[1]));
	return frames.slice(0, 2).map(frame => frame[1] + ':' + frame[2]).join('>');
}

function name_of(store, task) {
	if (task.diagnostic_name) return task.diagnostic_name;
	if (task.fn === store.persistence.persistCachedDatabase) return 'compact';
	for (const name of ['_update', '_insert', '_remove', '_loadDatabase']) if (task.fn === store[name]) return name.slice(1);
	if (task.this?.constructor?.name === 'Cursor') return task.this._limit === 1 ? 'findOne' : 'find';
	return task.fn.name || 'datastore_task';
}

function summary(record, now) {
	if (!record) return null;
	return {
		id: record.id, task: record.task, phase: record.phase,
		query_fields: record.query_fields,
		elapsed_ms: ms(record.started, now),
		before_callback_ms: record.callback_started ? ms(record.started, record.callback_started) : null,
		callback_ms: record.callback_started ? ms(record.callback_started, record.callback_finished || now) : null,
		queue_release_pending_ms: record.callback_finished ? ms(record.callback_finished, now) : null,
		persistence: record.persistence ? { kind: record.persistence.kind,
			elapsed_ms: ms(record.persistence.started, record.persistence.finished || now),
			pending: !record.persistence.finished } : null,
	};
}

function attach(store, collection) {
	if (observers.has(store)) return;
	const read_barrier = require('./database_read_barrier').attach(store);
	const state = { active: null, last: null, next_id: 0, health: new QueueStats('db', collection + ':') };
	observers.set(store, state);
	const executor = store.executor, push = executor.push;
	executor.push = function(task, force) {
		// Ordering safety is independent of diagnostic flags. Classify the
		// original task before its function is wrapped for timing below.
		const barrier_task = read_barrier.wrap(task);
		const traces = require('./performance/traces');
		const source = !traces.capture() && traces.enabled() ? origin() : '';
		const task_name = name_of(store, task) + (source ? '@' + source : '');
		const health_entry = state.health.enqueue(task_name);
		const ordered = { ...barrier_task, fn: function(...args) {
			state.health.start(health_entry);
			const callback = args[args.length - 1];
			args[args.length - 1] = function(...results) {
				try { return traces.with_context(health_entry.context, () => callback.apply(this, results)); }
				finally { state.health.finish(health_entry, results[0]); }
			};
			try { return traces.with_context(health_entry.context, () => traces.run(health_entry.run_span, () => barrier_task.fn.apply(this, args))); }
			catch (error) { state.health.finish(health_entry, error); throw error; }
		} };
		if (!enabled() && !traces.enabled()) {
			state.active = null; state.last = null;
			return push.call(this, ordered, force);
		}
		const query = task.this?.constructor?.name === 'Cursor' ? task.this.query
			: task.fn === store._update || task.fn === store._remove ? task.arguments[0] : null;
		const record = { id: ++state.next_id, task: task_name, started: null, phase: 'queued',
			query_fields: query ? Object.keys(query).slice(0, 8) : [] };
		health_entry.diagnostic = record;
		const traced = { ...ordered, diagnostic_id: record.id, fn: function(...args) {
			record.started = process.hrtime.bigint(); record.phase = 'running'; state.active = record;
			const done = args[args.length - 1];
			args[args.length - 1] = function(...results) {
				record.callback_started = process.hrtime.bigint(); record.phase = 'callback';
				try { return done.apply(this, results); }
				finally {
					record.callback_finished = process.hrtime.bigint(); record.phase = 'awaiting_executor_release';
					state.last = record;
					const duration_ms = ms(record.started, record.callback_finished);
					if (duration_ms >= 100 && enabled()) {
						console.log('[bts] database:executor_task ' + JSON.stringify({ collection, ts: Date.now(), // eslint-disable-line no-console
							storage_mode: store.persistence.inMemoryOnly ? 'memory' : 'file',
							...summary(record, record.callback_finished), duration_ms }));
					}
				}
			};
			return ordered.fn.apply(this, args);
		} };
		return push.call(this, traced, force);
	};
	for (const [method, kind] of [['persistNewState', 'append'], ['persistCachedDatabase', 'compact']]) {
		const original = store.persistence[method];
		store.persistence[method] = function(...args) {
			const record = state.active;
			if ((!enabled() && !require('./performance/traces').enabled()) || !record || record.phase !== 'running') return original.apply(this, args);
			const persistence = { kind, started: process.hrtime.bigint(), finished: null };
			record.persistence = persistence;
			const last = method === 'persistNewState' ? 1 : 0;
			const done = args[last];
			const callback = function(...results) {
				persistence.finished = process.hrtime.bigint();
				if (typeof done === 'function') return done.apply(this, results);
			};
			args[last] = callback;
			return original.apply(this, args);
		};
	}
}

function snapshot(store) {
	const state = observers.get(store);
	if (!state || (!enabled() && !require('./performance/traces').enabled())) return null;
	const now = process.hrtime.bigint();
	const running = store.executor.queue.running();
	const active = running && state.active ? summary(state.active, now) : null;
	return { running, active, last_completed: state.last ? {
		...summary(state.last, state.last.callback_finished),
		callback_finished_ago_ms: ms(state.last.callback_finished, now),
	} : null };
}

function health(store) {
	const state = observers.get(store);
	const current = snapshot(store);
	// Do not expose query fields through the diagnostic protocol.
	const safe = record => record ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'query_fields')) : null;
	return state ? { observed: true, ...state.health.snapshot(), executor_running: store.executor.queue.running(),
		active_detail: safe(current?.active), last_completed: safe(current?.last_completed) }
		: { observed: false };
}

module.exports = { attach, snapshot, health };
