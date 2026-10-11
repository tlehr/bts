'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { monitorEventLoopDelay } = require('perf_hooks');
const clock = () => process.hrtime.bigint();
const milliseconds = (start, end = clock()) => Number(end - start) / 1e6;

function instrument(root, db, queue, trigger) {
	const context = new AsyncLocalStorage(), tasks = [], database = [], samples = [];
	let enabled = false, triggered = false, high_watermark = 0;
	const loop = monitorEventLoopDelay({ resolution: 10 });
	function wrap(task, rows, locks = [], scheduler) {
		if (!enabled) return task;
		const name = task.diagnostic_name || task._queue_name || task.name || '<anonymous>';
		const row = { id: rows.length + 1, name, owner: context.getStore() || 'background', enqueued_ns: String(clock()), locks };
		rows.push(row);
		high_watermark = Math.max(high_watermark, tasks.filter(t => !t.finished_ns).length);
		const fn = async function(...args) {
			row.started_ns = String(clock()); row.wait_ms = milliseconds(BigInt(row.enqueued_ns));
			if (scheduler) {
				const entry = Array.from(scheduler.active.values()).find(entry => entry.task === fn);
				row.queue_id = entry?.id;
				row.observed_blockers = (entry?.wait_blocked_by || []).map(blocker => ({ ...blocker,
					conflicting_locks: entry.locks.filter(requested => blocker.locks.some(held =>
						require(root + '/bts/queue_lock_keys').lock_conflicts(requested, held))),
				}));
			}
			try { return await context.run(row.owner, () => task(...args)); }
			finally { row.finished_ns = String(clock()); row.runtime_ms = milliseconds(BigInt(row.started_ns)); }
		};
		Object.assign(fn, task);
		return fn;
	}
	// Observe the actual scheduler; preserve all resource-lock metadata.
	if (queue.stats) {
		const { ResourceLockQueue } = require(root + '/bts/resource_lock_queue');
		const original = ResourceLockQueue.prototype.execute;
		ResourceLockQueue.prototype.execute = function(task, options) {
			return original.call(this, wrap(task, tasks, options?.locks || task._queue_locks || [], this), options);
		};
	} else {
		const instance = queue.instance(), execute = instance.execute;
		instance.execute = function(task, ...args) { return execute.call(this, wrap(task, tasks, ['legacy:global']), ...args); };
	}
	// Executor hooks leave datastore methods/certificates and persistence intact.
	for (const [collection, store] of Object.entries(db)) {
		if (!store?.executor) continue;
		const push = store.executor.push;
		store.executor.push = function(task, force) {
			if (!enabled) return push.call(this, task, force);
			const name = task.diagnostic_name || (task.fn === store._update ? '_update' : task.fn === store._insert ? '_insert' : task.fn.name || 'anonymous');
			const row = { collection, name, owner: context.getStore() || 'background', enqueued_ns: String(clock()) };
			database.push(row);
			const fn = task.fn;
			return push.call(this, { ...task, fn: function(...args) {
				row.started_ns = String(clock()); row.wait_ms = milliseconds(BigInt(row.enqueued_ns));
				if (!triggered && row.owner === 'sync' && collection === 'matches' && /update|insert|batch_write/.test(name)) {
					triggered = true; trigger('first_live_match_write');
				}
				const callback = args.at(-1);
				args[args.length - 1] = function(...values) {
					row.finished_ns = String(clock()); row.runtime_ms = milliseconds(BigInt(row.started_ns));
					return callback(...values);
				};
				return context.run(row.owner, () => fn.apply(this, args));
			} }, force);
		};
	}
	const timer = setInterval(() => {
		if (!enabled) return;
		const pending = tasks.filter(t => !t.started_ns);
		samples.push({ ns: String(clock()), pending: pending.length, active: tasks.filter(t => t.started_ns && !t.finished_ns).length,
			oldest_pending_ms: pending.length ? milliseconds(BigInt(pending[0].enqueued_ns)) : 0,
			db: Object.fromEntries(Object.entries(db).filter(([, store]) => store?.executor).map(([name, store]) => [name, {
				pending: store.executor.queue.length(), active: store.executor.queue.running(),
			}])) });
	}, 20);
	return {
		run: (owner, work) => context.run(owner, work),
		start() { enabled = true; loop.enable(); },
		finish() { enabled = false; loop.disable(); clearInterval(timer); return { tasks, database, samples, high_watermark,
			event_loop: { measured: loop.count > 0, max_ms: loop.count ? loop.max / 1e6 : null, p95_ms: loop.count ? loop.percentile(95) / 1e6 : null } }; },
	};
}

module.exports = { instrument, clock, milliseconds };
