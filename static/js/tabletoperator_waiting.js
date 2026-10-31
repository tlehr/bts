'use strict';

// Shared identity rules for the waiting-list search and server-side additions.
var tabletoperator_waiting = (function() {

function id(player) {
	const value = player?.btp_id;
	return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function name(player) {
	return String(player?.name || [player?.firstname, player?.lastname].filter(Boolean).join(' '))
		.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function participant(player, with_state) {
	return with_state && player?.state ? { name: player.state, btp_id: -1, asian_name: false, firstname: '', lastname: '' } : player;
}

function index(entries, with_state = false) {
	const ids = new Set(), names = new Set(), anonymous_names = new Set();
	const add = player => {
		const player_id = id(player), player_name = name(player);
		if (player_id != null) ids.add(player_id);
		if (player_name) {
			names.add(player_name);
			if (player_id == null) anonymous_names.add(player_name);
		}
	};
	for (const entry of entries || []) {
		if (entry && entry.court == null && Array.isArray(entry.tabletoperator)) entry.tabletoperator.forEach(add);
	}
	return {
		add,
		has(player) {
			player = participant(player, with_state);
			const player_id = id(player), player_name = name(player);
			// Real IDs distinguish namesakes; legacy/free-text entries match by name.
			return player_id != null ? ids.has(player_id) || anonymous_names.has(player_name) : names.has(player_name);
		},
	};
}

function activity_index(matches) {
	const playing = index([]), preparing = index([]);
	for (const match of matches || []) {
		const setup = match?.setup;
		// A completed match may still carry its old court and player flags.
		if (!setup || typeof match.team1_won === 'boolean' || match.btp_winner || match.end_ts || setup.end_ts ||
			['finished', 'done', 'completed'].includes(setup.state) ||
			['walkover', 'retired', 'disqualified', 'no_match', 'no_match_team1', 'no_match_team2'].includes(match.score_status || match.btp_score_status)) continue;
		const target = setup.now_on_court && setup.court_id ? playing
			: !setup.now_on_court && setup.state === 'preparation' && !setup.preparation_call_deferred ? preparing : null;
		if (!target) continue;
		for (const player of [...(setup.teams || []).flatMap(team => team?.players || []), ...(setup.tabletoperators || [])]) target.add(player);
	}
	return { playing, preparing };
}

return { id, participant, index, activity_index };
})();

/*@DEV*/
if (typeof module !== 'undefined') module.exports = tabletoperator_waiting;
/*/@DEV*/
