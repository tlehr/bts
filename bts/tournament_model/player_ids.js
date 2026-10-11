'use strict';

function known_player_id(id) {
	return id != null && String(id) !== '-1' ? String(id) : null;
}

function player_ids(match) {
	return [...new Set([...(match?.btp_player_ids || []), ...(match?.setup?.teams || []).flatMap(team =>
		(team.players || []).map(player => player.btp_id)), ...(match?.setup?.tabletoperators || []).map(player => player.btp_id)]
		.filter(id => id != null).map(String))];
}

module.exports = { known_player_id, player_ids };
