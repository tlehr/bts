'use strict';

const signatures = new WeakMap();
const point_fields = ['network_score', 'network_team1_left', 'network_team1_serving',
	'network_teams_player1_even', 'presses', 'duration_ms', 'shuttle_count'];

function signature(collection, document) {
	if (signatures.has(document)) return signatures.get(document);
	let value = document;
	if (collection === 'matches') {
		value = { ...document };
		delete value._btp_sync_signature;
		// Running scores do not affect field allocation. Result/state changes,
		// participants, check-ins and every other metadata field remain visible.
		if (document.setup?.state === 'oncourt' && document.setup.now_on_court === true &&
			!document.end_ts && document.team1_won == null) {
			for (const field of point_fields) delete value[field];
		}
	}
	const result = JSON.stringify(value);
	signatures.set(document, result);
	return result;
}

function capture(state) {
	return Object.fromEntries(Object.entries(state).map(([collection, documents]) =>
		[collection, new Map(documents.map(document => [document._id, document]))]));
}

function unchanged(state, previous) {
	return Object.entries(state).every(([collection, documents]) => {
		const old = previous[collection];
		return old?.size === documents.length && documents.every(document => {
			const before = old.get(document._id);
			return before === document || (before && signature(collection, before) === signature(collection, document));
		});
	});
}

module.exports = { capture, unchanged };
