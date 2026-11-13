'use strict';

const signatures = new WeakMap();
// The allocation rules consume persisted state/result/successor flags. Rally
// histories and live score payloads do not enter those rules themselves.
const ignored = new Set(['presses', 'network_score', 'network_team1_left', 'network_team1_serving',
	'network_teams_player1_even', 'duration_ms', 'shuttle_count', '_btp_sync_signature',
	'btp_needsync', 'btp_call_pending', 'btp_call_pending_court_id']);
function signature(collection, document) {
	if (!document) return null;
	if (signatures.has(document)) return signatures.get(document);
	const value = collection === 'matches' ? Object.fromEntries(Object.keys(document)
		.filter(key => !ignored.has(key)).map(key => [key, document[key]])) : document;
	const result = JSON.stringify(value);signatures.set(document, result);return result;
}
function changed(collection, before, after) { return signature(collection, before) !== signature(collection, after); }
function capture(state) { return Object.fromEntries(Object.entries(state).map(([name, docs]) => [name, new Map(docs.map(doc => [doc._id, doc]))])); }
function unchanged(state, previous) {
	return Object.entries(state).every(([name, docs]) => previous[name]?.size === docs.length &&
		docs.every(doc => { const old = previous[name].get(doc._id);return old === doc || !!old && !changed(name, old, doc); }));
}
module.exports = { changed, capture, unchanged };
