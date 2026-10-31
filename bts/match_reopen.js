'use strict';

const queue = require('./update_queue');
const {finished} = require('../static/js/match_edit_rules');

module.exports = async function reopen(app, tournament_key, match_id) {
	return queue.execute_locked([queue.lock_keys.match(tournament_key, match_id)], async () => {
		const [previous, tournament] = await Promise.all([
			app.db.matches.findOne_async({_id: match_id, tournament_key}),
			app.db.tournaments.findOne_async({key: tournament_key}),
		]);
		if (!previous || !tournament) throw new Error('Spiel oder Turnier nicht gefunden.');
		if (!finished(previous)) throw new Error('Dieses Spiel ist nicht beendet. Bitte den Dialog neu öffnen.');
		const set = {score_status: 'normal', forward_loser: false, btp_needsync: true,
			'setup.state': 'scheduled', 'setup.now_on_court': false, 'setup.preparation_call_deferred': true, 'setup.highlight': 0};
		if (!previous.network_score?.length && previous.score_status_network_score?.length) set.network_score = previous.score_status_network_score;
		const [count, match] = await app.db.matches.update_async({_id: match_id, tournament_key}, {$set: set,
			$unset: {team1_won: true, btp_winner: true, no_match_losing_team: true, score_status_network_score: true,
				end_ts: true, duration_ms: true, tabletoperator_finish_ts: true, 'setup.end_ts': true, 'setup.called_timestamp': true, 'setup.preparation_call_timestamp': true}},
		{returnUpdatedDocs: true});
		if (count !== 1) throw new Error('Spiel konnte nicht wieder geöffnet werden.');
		require('./admin').notify_change(app, tournament_key, 'match_edit', {match__id: match_id, match});
		if (tournament.btp_enabled) require('./btp_manager').update_score(app, match);
		return match;
	});
};
