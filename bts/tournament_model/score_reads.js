'use strict';

const { deepCopy } = require('nedb/lib/model');
const database_tasks = require('../database_tasks');
const read_barrier = require('../database_read_barrier');
const profile = require('../offload/profile');

const COLLECTIONS = { match: 'matches', tournament: 'tournaments', court: 'courts' };
const milliseconds = (start, end) => Math.round(Number(end - start) / 1e5) / 10;

module.exports = function attach_score_reads(model) {
	for (const collection of Object.values(COLLECTIONS)) database_tasks.attach(model.db[collection], collection);
	model.read_score_context_part = (part, key, id, callback) => {
		const collection = COLLECTIONS[part];
		const store = model.db[collection];
		const enqueued = process.hrtime.bigint();
		const idle = profile.enabled('score_idle_reads') ? read_barrier.inspect_idle(store) : { allowed: false };
		const readonly = !idle.allowed && profile.enabled('score_readonly_reads') ? read_barrier.inspect_readonly(store) : { allowed: false };
		const bypass = idle.allowed ? idle : readonly.allowed ? readonly : profile.enabled('compaction_reads') ? read_barrier.inspect(store)
			: { allowed: false, reason: 'disabled' };
		const extra = {
			read_source: 'object_model',
			compaction_read_bypassed: bypass.allowed && bypass.reason === 'pure_compaction',
			compaction_read_decision: bypass.reason,
			model_read_bypassed: bypass.allowed,
			model_read_decision: bypass.reason,
			queue_depth_at_enqueue: store.executor.queue.length(),
			compaction_pending_at_enqueue: model.db.compaction?.active_collection === collection,
			executor_at_enqueue: database_tasks.snapshot(store),
		};
		const capture = done => {
			const started = process.hrtime.bigint();
			const executor_before_read = database_tasks.snapshot(store);
			let value, error;
			try {
				const tournament = model.tournament(key);
				const entity = part === 'tournament' ? tournament.record : tournament.collection(collection).get(String(id));
				const data = entity?.present ? entity.data : null;
				const field = part === 'tournament' ? 'key' : 'tournament_key';
				if (!data || data[field] !== key) value = null;
				else if (part === 'tournament') value = deepCopy({ _id: data._id, key: data.key,
					preparation_successor_rally_count: data.preparation_successor_rally_count });
				else value = deepCopy(data);
			} catch (err) { error = err; }
			const finished = process.hrtime.bigint();
			done(error, value, { ...extra,
				executor_before_read,
				db_queue_wait_ms: milliseconds(enqueued, started),
				read_ms: milliseconds(started, finished),
			});
		};
		if (bypass.allowed) {
			// Capture now, before any later enqueue, but retain asynchronous callback
			// delivery. A later write must not change this detached snapshot.
			return capture((...results) => {
				if (profile.timing_enabled()) {
					try {
						console.warn('[bts] database:compaction_model_read ' + JSON.stringify({ // eslint-disable-line no-console
							tournament_key: key, collection, part, id: id || null, ts: Date.now(),
							...extra, read_ms: results[2].read_ms, status: results[0] ? 'error' : 'ok',
						}));
					} catch (_) { /* Preserve reads even if the diagnostic sink fails. */ }
				}
				queueMicrotask(() => callback(...results));
			});
		}
		// The model observes index updates before persistence callbacks. Reading
		// through this executor prevents seeing a pending write too early.
		store.executor.push(read_barrier.certify_read({ this: store, fn: capture, arguments: [callback], diagnostic_name: 'score_context_' + part }));
	};
};
