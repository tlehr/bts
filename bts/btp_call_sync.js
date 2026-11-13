'use strict';

const { isDeepStrictEqual } = require('util');
const { deepCopy } = require('nedb/lib/model');
const participant_guard = require('./btp_participant_guard');

// Court calls are separate from results: a pending call must never make a
// running match look finished or prevent ordinary point updates from rebasing.
function is_call(match) {
	return match?.setup?.now_on_court === true && !!match.setup.court_id &&
		match.setup.called_timestamp != null && match.setup.state !== 'finished' &&
		typeof match.team1_won !== 'boolean' && !match.btp_winner && match.score_status !== 'no_match';
}

function confirmed(match, remote, { state, court_map }) {
	const court_id = remote.CourtID?.[0];
	const court = state.courts.get(court_id);
	const match_id = match.btp_match_ids?.[0]?.id;
	return is_call(match) && match_id != null &&
		court_map.get(court_id) === match.setup.court_id &&
		(court?.MatchID || []).some(id => String(id) === String(match_id));
}

function needs_repair(match, remote, context) {
	return context.tournament.btp_enabled === true && !context.tournament.btp_readonly &&
		is_call(match) && !match.btp_participant_conflict &&
		Array.from(context.court_map.values()).includes(match.setup.court_id) &&
		!participant_guard.conflict(match, participant_guard.raw_ids(remote)) &&
		!Number(remote.Winner?.[0]) && !Number(remote.ScoreStatus?.[0]) && !confirmed(match, remote, context);
}

function revision(match) {
	return { ids: match.btp_match_ids, winner: match.team1_won, btp_winner: match.btp_winner,
		score_status: match.score_status, conflict: match.btp_participant_conflict, pending: match.btp_call_pending,
		needsync: match.btp_needsync, setup: match.setup, match_order: match.match_order };
}

function version_query(match, tkey) {
	const expected = deepCopy(revision(match));
	return { _id: match._id, tournament_key: tkey, $where: function() {
		return isDeepStrictEqual(revision(this), expected);
	} };
}

async function reconcile(app, tkey, match, remote, context) {
	const accepted = confirmed(match, remote, context);
	const set = accepted ? { btp_call_pending: false, btp_needsync: false } : { btp_call_pending: true };
	if (!accepted && match.btp_call_pending === true) return { changed: false, confirmed: false };
	const affected = await new Promise((resolve, reject) => app.db.matches.update(
		// Point/clock changes do not change a court call. A new call, court,
		// participant assignment or result does, and must reject this readback.
		version_query(match, tkey), { $set: set }, {},
		(error, count) => error ? reject(error) : resolve(count)));
	if (affected === 1) Object.assign(match, set);
	return { changed: affected === 1, confirmed: affected === 1 && accepted };
}

module.exports = { is_call, confirmed, needs_repair, reconcile };
