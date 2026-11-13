'use strict';

// A successful rewrite already contains the current append history. Avoid
// rewriting unchanged files again, including their filesystem flushes.
// Unknown/custom stores retain the ordinary maintenance path.
const stores = new WeakMap();

function revision(store) { return stores.get(store)?.revision; }
function needed(store) {
	const state = stores.get(store);
	return !state || state.compacted !== state.revision;
}
function compacted(store, captured) {
	const state = stores.get(store);
	if (state && captured !== undefined) state.compacted = Math.max(state.compacted ?? -1, captured);
}
function attach(store) {
	if (stores.has(store)) return;
	const persistence = store.persistence;
	if (persistence.inMemoryOnly || typeof persistence.persistNewState !== 'function' ||
		typeof persistence.persistCachedDatabase !== 'function') return;
	const state = { revision: 0, compacted: null };
	stores.set(store, state);
	const append = persistence.persistNewState, rewrite = persistence.persistCachedDatabase;
	persistence.persistNewState = function(documents, callback) {
		// Include index definitions and prepared appends. Failed writes remain
		// dirty too; a failed operation must never suppress later maintenance.
		if (documents?.length) state.revision++;
		return append.call(this, documents, callback);
	};
	persistence.persistCachedDatabase = function(callback = () => {}) {
		const captured = state.revision;
		return rewrite.call(this, error => {
			if (!error) compacted(store, captured);
			callback(error);
		});
	};
}

module.exports = { attach, revision, needed, compacted };
