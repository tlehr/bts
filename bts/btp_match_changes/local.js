'use strict';

const projections = new WeakMap();

function local_state(document) {
	if (projections.has(document)) return projections.get(document);
	const projection = { ...document };
	for (const field of ['_btp_sync_signature', 'presses', 'duration_ms',
		'network_team1_left', 'network_team1_serving', 'network_teams_player1_even']) delete projection[field];
	if (document.setup?.now_on_court && !document.btp_needsync) delete projection.network_score;
	const state = {
		document,
		signature: JSON.stringify(projection),
		dependency: JSON.stringify({
			btp_match_ids: document.btp_match_ids, team1_won: document.team1_won,
			btp_winner: document.btp_winner, btp_needsync: document.btp_needsync,
			score_status: document.score_status, forward_loser: document.forward_loser,
			players: (document.setup?.teams || []).map(team => (team.players || []).map(player => player.btp_id)),
		}),
	};
	projections.set(document, state);
	return state;
}

module.exports = local_state;
