'use strict';

const utils = require('../utils');
const { known_player_id } = require('./player_ids');
const empty = [];
const events_of = payload => payload?.events || (Array.isArray(payload) ? payload : empty);

function profiles(payload) {
	const result = new Map();
	const events = events_of(payload);
	for (const event of events) for (const stage of event.stages || []) {
		for (const entry of stage.entries || []) for (const player of entry.team?.players || []) {
			const id = known_player_id(player.btp_id);
			if (id !== null) result.set(id, player);
		}
	}
	return result;
}

// Registration metadata and match participation state have separate owners.
// Unchanged registration copies never undo newer changes from a match.
module.exports = function update_registrations(tournament, next, previous) {
	// Payload metadata does not affect registered player profiles. Prepared
	// writes retain this array's identity when only metadata changes.
	if (utils.deep_equal(events_of(next), events_of(previous))) return;
	const registrations = profiles(next);
	for (const [id, player] of tournament._registrations) {
		if (!registrations.has(id)) player._detach(tournament);
	}
	tournament._registrations.clear();
	for (const [id, source] of registrations) {
		const player = tournament.player(id);
		player._profile(tournament, source, true);
		tournament._registrations.set(id, player);
	}
};
