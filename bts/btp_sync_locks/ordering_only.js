'use strict';

const { isDeepStrictEqual: equal } = require('util');

// Match numbers/order affect candidate selection, but do not allocate players,
// courts or officials. Unknown fields and profile changes remain conservative.
const setup_fields = new Set(['match_num', 'btp_group_rankings']);
const without_number = references => Array.isArray(references) ? references.map(reference =>
	Object.fromEntries(Object.entries(reference).filter(([key]) => key !== 'nr'))) : references;
function change_is_ordering(change) {
	if (change.collection !== 'matches' || !change.before || !change.after) return false;
	const { before, after } = change;
	for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (field === '_btp_sync_signature') continue;
		if (field === 'btp_match_ids' && equal(without_number(before[field]), without_number(after[field]))) continue;
		if (!['setup', 'match_order'].includes(field) && !equal(before[field], after[field])) return false;
	}
	if (!before.setup || !after.setup) return false;
	for (const field of new Set([...Object.keys(before.setup), ...Object.keys(after.setup)])) {
		if (!setup_fields.has(field) && !equal(before.setup[field], after.setup[field])) return false;
	}
	return !equal(before.setup.match_num, after.setup.match_num) || !equal(before.match_order, after.match_order);
}

module.exports = function ordering_only(changes, effects) {
	if (!changes.length || !changes.every(change_is_ordering)) return false;
	const ids = new Set(changes.map(change => change.id));
	return effects.every(({ resources }) => {
		// Deferred work obtains its own locks after this commit. Other external
		// effects (including byes) still require the full allocation scope.
		if (resources.deferred_job) return Object.keys(resources).every(key => key === 'deferred_job');
		const notification = resources.notification;
		const value = notification?.value;
		return Object.keys(resources).every(key => key === 'notification') && notification?.ctype === 'match_edit' &&
			ids.has(value?.match__id || value?._id) && (!value.match || ids.has(value.match._id)) &&
			Object.keys(value).every(key => !key.startsWith('all_'));
	});
};
