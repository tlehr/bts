'use strict';

const SCORE_FIELDS = ['network_score', 'network_team1_left', 'network_team1_serving',
	'network_teams_player1_even', 'presses', 'duration_ms', 'shuttle_count',
	'end_ts', 'team1_won', 'btp_winner', 'score_status', 'score_status_network_score', 'forward_loser'];

function normalization(collection, document) {
	if (collection === 'tournaments') {
		const { _id, btp_settings, last_reset_ts } = document;
		return { _id, btp_settings, last_reset_ts };
	}
	if (collection !== 'matches') return document;
	const { _id, end_ts, team1_won, btp_winner, btp_needsync } = document;
	const setup = document.setup;
	return { _id, end_ts, team1_won, btp_winner, btp_needsync,
		setup: {
			state: setup?.state, now_on_court: setup?.now_on_court, court_id: setup?.court_id,
			umpire: setup?.umpire, service_judge: setup?.service_judge,
			teams: (setup?.teams || []).map(team => ({ players: (team?.players || []).map(player => ({
				btp_id: player?.btp_id, last_time_on_court_ts: player?.last_time_on_court_ts,
			})) })),
		},
	};
}

module.exports = function projection(collection, document, kind) {
	if (!document) return null;
	if (kind === 'document') return document;
	if (kind === 'normalization') return normalization(collection, document);
	if (collection === 'matches' && kind === 'score') {
		return Object.fromEntries(SCORE_FIELDS.map(field => [field, document[field]]));
	}
	if (collection === 'matches' && kind === 'participants') {
		const setup = document.setup;
		return { btp_player_ids: document.btp_player_ids, teams: setup?.teams,
			tabletoperators: setup?.tabletoperators, umpire: setup?.umpire, service_judge: setup?.service_judge,
			court_id: setup?.court_id };
	}
	throw new Error(`Unsupported ${collection} fingerprint: ${kind}`);
};
