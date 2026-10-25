'use strict';

const { deepCopy } = require('nedb/lib/model');
const { natcmp } = require('../utils');

// Resolve the committed versions before copying the remaining envelope. In
// particular, discarded match histories and court lists must not be traversed.
module.exports = function notification_value(notification, current_match, current_umpire, state) {
	const original = notification.value;
	let source = original;
	const replacements = {};
	let committed = false;
	if (current_umpire) { source = current_umpire; committed = true; }
	else if (current_match) {
		if (original.match) replacements.match = current_match;
		else if (original.match__id) Object.assign(replacements, { setup: current_match.setup, btp_winner: current_match.btp_winner });
		else { source = current_match; committed = true; }
	}
	for (const [field, collection] of [['all_courts', 'courts'], ['all_locations', 'locations'], ['all_umpires', 'umpires']]) {
		if (source?.[field]) replacements[field] = field === 'all_courts'
			? state.courts.slice().sort((a, b) => natcmp(String(a.num), String(b.num)))
			: state[collection];
	}
	if (!Object.keys(replacements).length) return committed ? source : deepCopy(source);
	const result = {};
	for (const field of Object.keys(source)) {
		result[field] = Object.prototype.hasOwnProperty.call(replacements, field) ? replacements[field] : deepCopy(source[field]);
	}
	return Object.assign(result, replacements);
};
