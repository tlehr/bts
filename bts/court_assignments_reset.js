'use strict';

const queue = require('./update_queue');

function can_reset(match) {
	const setup = match.setup;
	return !!setup && !setup.now_on_court && setup.state !== 'oncourt' && setup.state !== 'finished' &&
		typeof match.team1_won !== 'boolean' && !match.btp_winner && !match.btp_needsync && !match.end_ts && !setup.end_ts &&
		!['walkover', 'retired', 'disqualified', 'no_match', 'no_match_team1', 'no_match_team2'].includes(match.score_status) &&
		!(Number(match.btp_score_status) > 0);
}

// Confirm the write in BTP before changing local fields. Own just the court
// field; preserve preparation, attendance and results.
function reset(app, tournament_key, notify = () => {}) {
	return queue.execute_locked([queue.lock_keys.tournament(tournament_key)],
		queue.named('court_assignments_reset_' + tournament_key, async () => {
			const tournament = await app.db.tournaments.findOne_async({ key: tournament_key });
			if (!tournament) throw new Error('No tournament ' + tournament_key);
			if (!tournament.btp_enabled || tournament.btp_readonly) {
				throw new Error('Zum Zurücksetzen der Felder muss BTP schreibend verbunden sein.');
			}
			const reset_ts = app.clock ? app.clock.now_ms() : Date.now();
			const matches = await app.db.matches.find_async({ tournament_key });
			const pending = matches.filter(can_reset);
			const remote = await require('./btp_manager').clear_court_assignments(tournament_key, pending);
			const allowed = new Set(remote.allowed_match_ids);
			const changed_setups = [];
			for (const match of matches) {
				if (!allowed.has(match._id) || !match.setup.court_id) continue;
				await app.db.matches.update_async({ _id: match._id, tournament_key }, { $set: { 'setup.court_id': null } }, {});
				changed_setups.push({ _id: match._id, setup: { ...match.setup, court_id: null } });
			}
			if (changed_setups.length) {
				await app.db.courts.update_async({ tournament_key, match_id: { $in: changed_setups.map(match => match._id) } },
					{ $set: { match_id: null } }, { multi: true });
			}
			const result = { tournament_key, changed_matches: changed_setups.length, reset_ts,
				btp_changed_matches: remote.btp_changed_matches, skipped_matches: remote.skipped_matches };
			notify({
				...result,
				matches: changed_setups,
				courts: await app.db.courts.find_async({ tournament_key }),
			});
			return result;
		}));
}

module.exports = { reset, can_reset };
