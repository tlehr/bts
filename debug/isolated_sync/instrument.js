'use strict';

const model = require('nedb/lib/model');
const { AsyncLocalStorage } = require('async_hooks');
const elapsed = began => Number(process.hrtime.bigint() - began) / 1e6;

// Temporary instrumentation on disposable datastores. Keep writer identities
// unchanged so the production certification and batch/fallback decision apply.
function instrument(db, on_first_match_write, on_first_live_write = () => {}, arrival = 'matches') {
	const rows = [], restore = [];
	const context = new AsyncLocalStorage();
	let triggered = false, live_started = false, active_appends = 0;
	const replace = (object, key, build) => {
		const original = object[key]; object[key] = build(original);
		restore.push(() => { object[key] = original; });
	};
	replace(require('../../bts/btp_planner/prepared_tournament'), 'prepare', original => function(...args) {
		const began = process.hrtime.bigint();
		try { return original.apply(this, args); }
		finally { rows.push({ collection: 'tournaments', operation: 'prepare', sync_ms: elapsed(began) }); }
	});
	for (const operation of ['modify', 'serialize']) {
		let depth = 0;
		replace(model, operation, original => function(...args) {
			const outer = !depth++, began = process.hrtime.bigint();
			try { return original.apply(this, args); }
			finally { depth--; const collection = context.getStore(); if (outer && collection) rows.push({ collection, operation, sync_ms: elapsed(began) }); }
		});
	}
	for (const [name, store] of Object.entries(db)) {
		if (!store?.executor) continue;
		replace(store.executor, 'push', original => function(task, ...args) {
			const write = task.diagnostic_name === 'sync_batch_write' || [store._update, store._insert, store._remove].includes(task.fn);
			const wrapped = write ? { ...task, fn: function(...fn_args) {
				if (!live_started) { live_started = true; on_first_live_write(); }
				// Ordinary NeDB updates yield before modifying; keep their writer
				// attribution across async callbacks without changing certification.
				return context.run(name, () => task.fn.apply(this, fn_args));
			} } : task;
			const result = original.call(this, wrapped, ...args);
			if ((arrival === 'first-live-write' || name === 'matches') && write && !triggered) {
				triggered = true;
				on_first_match_write(() => active_appends);
			}
			return result;
		});
		replace(store, 'updateIndexes', original => function(...args) {
			const began = process.hrtime.bigint();
			try { return original.apply(this, args); }
			finally { rows.push({ collection: name, operation: 'update_indexes_and_canonical_model', sync_ms: elapsed(began) }); }
		});
		replace(store.persistence, 'persistNewState', original => function(documents, done) {
			const began = process.hrtime.bigint();
			const row = { collection: name, operation: 'persist', documents: documents.length };
			rows.push(row); active_appends++;
			try {
				const result = original.call(this, documents, error => {
					active_appends--; row.callback_ms = elapsed(began); row.error = error ? error.message : null;
					done(error);
				});
				row.sync_ms = elapsed(began);
				return result;
			} catch (error) { active_appends--; throw error; }
		});
	}
	return { rows, stop: () => { for (const undo of restore.reverse()) undo(); context.disable(); } };
}

module.exports = { instrument, elapsed };
