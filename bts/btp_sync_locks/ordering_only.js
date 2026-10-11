'use strict';

const { isDeepStrictEqual: equal } = require('util');
const OrderingNotifications = require('./ordering_notifications');

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

function inspect(changes, effects, matches = []) {
	if (!changes.length || !changes.every(change_is_ordering)) return { ordering: false, unchanged_notifications: 0 };
	const notifications = new OrderingNotifications(new Set(changes.map(change => change.id)), matches);
	const ordering = effects.every(effect => notifications.accept(effect));
	return { ordering, unchanged_notifications: ordering ? notifications.unchanged : 0 };
}

module.exports = (changes, effects, matches) => inspect(changes, effects, matches).ordering;
module.exports.inspect = inspect;
