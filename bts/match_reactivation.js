'use strict';

// Called only for an explicit admin reactivation, after the match-call lock,
// participant validation and court availability checks have succeeded.
module.exports = function reset_finished_result(app, tournament, match, callback) {
	app.db.matches.update({ _id: match._id, tournament_key: tournament.key }, {
		$set: {
			score_status: 'normal',
			forward_loser: false,
			btp_needsync: true,
			'setup.state': 'scheduled',
		},
		$unset: {
			no_match_losing_team: true,
			team1_won: true,
			btp_winner: true,
			score_status_network_score: true,
			end_ts: true,
			tabletoperator_finish_ts: true,
		},
	}, { returnUpdatedDocs: true }, (err, count, updated) => {
		if (err) return callback(err);
		if (count !== 1) return callback(new Error('Cannot find match ' + match._id + ' of tournament ' + tournament.key + ' in database'));
		// Preserve the latest stored point data and the requested field/setup.
		updated.setup = match.setup;
		require('./match_reconciliation/tablet_queue').remove_waiting(app, tournament.key,
			(match.setup.teams || []).flatMap(team => team.players || [])).then(() => callback(null, updated), callback);
	});
};
