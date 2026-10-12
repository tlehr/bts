'use strict';

// Spread one round across ten minutes instead of starting every collection's
// serialization and crash-safe file rewrite in the same event-loop turn.
module.exports = function schedule_compaction(db, collections, options = {}) {
	const interval_ms = options.interval_ms ?? 600000;
	const set_timer = options.set_timer || setTimeout;
	const clear_timer = options.clear_timer || clearTimeout;
	const on_error = options.on_error || ((collection, error) => {
		console.warn('[bts] database:compaction_error', collection, error); // eslint-disable-line no-console
	});
	const stores = collections.map(name => ({ name, store: db[name] })).filter(({ store }) => store?.persistence);
	const spacing_ms = Math.max(1, Math.ceil(interval_ms / Math.max(1, stores.length)));
	let timer = null;
	let stopped = false;
	let index = 0;
	const state = { active_collection: null, stop };
	for (const { store } of stores) store.persistence.stopAutocompaction();
	function stop() {
		stopped = true;
		if (timer !== null) clear_timer(timer);
		timer = null;
	}
	function schedule() {
		if (stopped || !stores.length) return;
		timer = set_timer(run, spacing_ms);
		if (timer?.unref) timer.unref();
	}
	function run() {
		timer = null;
		if (stopped) return;
		const { name, store } = stores[index];
		index = (index + 1) % stores.length;
		state.active_collection = name;
		const done = error => {
			state.active_collection = null;
			try { if (error) on_error(name, error); }
			finally { schedule(); }
		};
		const staged = require('./compaction_worker/staged');
		if (staged.supported(store)) {
			require('./performance/traces').operation('database_compaction', { type: 'other', collection: name },
				() => staged.run(store, name)).then(() => done(null), done);
			return;
		}
		// Use NeDB's executor and persistence implementation. Pending writes
		// finish first; later reads/writes wait for the crash-safe rewrite.
		store.executor.push({ this: store.persistence, fn: store.persistence.persistCachedDatabase,
			arguments: [done] });
	}
	schedule();
	return state;
};
