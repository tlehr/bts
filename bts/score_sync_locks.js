'use strict';

const keys = require('./queue_lock_keys');
const barrier = require('./database_read_barrier');

// Use the narrower point locks only when this exact update leaves every
// allocation dependency unchanged. The queue calls this again just before
// starting; queued finishes, undo and tournament edits cannot stale the test.
module.exports = function score_sync_locks(app, key, score, now_ts) {
	if (!require('./offload/profile').enabled('score_dependency_locks')) return null;
	if (!score?.match_id || !score.court_id || score.finish_confirmed || score.end_ts || typeof score.team1_won === 'boolean') return null;
	const model = app.db.model;
	if (!model || !barrier.inspect_disjoint(app.db.matches, [score.match_id]).allowed ||
		!barrier.inspect_disjoint(app.db.courts, [score.court_id]).allowed ||
		!(barrier.inspect_idle(app.db.tournaments).allowed || barrier.inspect_readonly(app.db.tournaments).allowed)) return null;
	const tournament = model.tournament(key), match_record = tournament.matches.get(score.match_id), court_record = tournament.courts.get(score.court_id);
	if (!match_record?.present || !court_record?.present || !tournament.record?.present) return null;
	const match = match_record.data, court = court_record.data, settings = tournament.record.data;
	if (!match || !court || !settings || match.tournament_key !== key || court.tournament_key !== key || settings.key !== key ||
		match.setup?.court_id !== score.court_id || court.match_id !== score.match_id ||
		match.setup?.state !== 'oncourt' || match.setup.now_on_court !== true || match.setup.highlight === 6 ||
		match.end_ts !== undefined || typeof match.team1_won === 'boolean' || match.btp_winner || match.btp_needsync ||
		match.score_status && match.score_status !== 'normal') return null;
	const next = require('./match_automation').calculate_preparation_successor_state({ ...match,
		network_score: score.network_score, team1_won: undefined,
		setup: { ...match.setup, now_on_court: true, state: 'oncourt' },
	}, settings, { now_ts });
	if (next.needs_preparation_successor !== match.setup.needs_preparation_successor ||
		next.needs_preparation_successor_ts !== match.setup.needs_preparation_successor_ts) return null;
	return keys.score_update(key, score, { point: true });
};
