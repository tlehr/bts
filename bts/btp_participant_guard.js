'use strict';

const { deepCopy } = require('nedb/lib/model');
const utils = require('./utils');
const effects = require('./btp_sync_effects');

const id = value => Number.isInteger(Number(value)) && Number(value) > 0 ? String(value) : null;
const setup_ids = setup => Array.from(setup?.teams || [], team => Array.from(team?.players || [], player => id(player?.btp_id)));
const raw_ids = remote => Array.isArray(remote?.bts_players)
	? Array.from(remote.bts_players, team => Array.from(team || [], player => id(player?.ID?.[0]))) : null;
const known = teams => teams?.length === 2 && teams.every(team => team.length > 0 && team.every(Boolean));

function conflict(current, received) {
	// Pending results also retain their opponents after leaving the court.
	const protected_match = current?.btp_participant_conflict || current?.setup?.now_on_court === true ||
		current?.setup?.state === 'oncourt' ||
		(current?.btp_needsync && (typeof current.team1_won === 'boolean' || current.score_status === 'no_match'));
	if (!protected_match || received === null) return null;
	const expected = setup_ids(current?.setup);
	if (!known(expected) || utils.deep_equal(expected, received)) return null;
	const missing = !known(received) || expected.some((team, index) => received[index].length < team.length);
	return { reason: missing ? 'missing_participants' : 'changed_participants', expected, received };
}

function report(app, tkey, match, problem) {
	if (effects.capture(app, real_app => report(real_app, tkey, match, problem), { matches: [match._id] },
		{ target: 'btp_participant_guard', method: 'report', args: [tkey, match, problem] })) return;
	const error = new Error('BTP meldet andere oder fehlende Teilnehmer. Lokale Teilnehmer, Feld und Spielstand bleiben erhalten; ' +
		'BTP-Schreibaufträge für dieses Spiel warten bis zur Übereinstimmung. Erwartete Spieler-IDs: ' +
		JSON.stringify(problem.expected) + '; empfangen: ' + JSON.stringify(problem.received));
	error.code = 'BTP_PARTICIPANT_CONFLICT';
	error.btp_phase = 'reconcile';
	require('./btp_request_log').local_failure({ app, tkey }, match, error, 'participant_sync');
}

// Persist only the guard flag. Never replace a newer score/setup with the
// snapshot used to detect the conflict. A rejected CAS is retried next sync.
async function reconcile(app, tkey, current, remote) {
	if (!current) return { current, blocked: false, changed: false };
	const received = raw_ids(remote);
	if (received === null) return { current, blocked: !!current.btp_participant_conflict, changed: false };
	const problem = conflict(current, received);
	if (utils.deep_equal(current.btp_participant_conflict, problem || undefined)) {
		return { current, blocked: !!problem, changed: false };
	}
	const patch = problem ? { $set: { btp_participant_conflict: problem } } : { $unset: { btp_participant_conflict: true } };
	const affected = await new Promise((resolve, reject) => app.db.matches.update(
		require('./btp_result_sync').version_query(current, tkey), patch, {},
		(error, count) => error ? reject(error) : resolve(count)));
	if (affected !== 1) return { current, blocked: true, changed: false };
	const next = deepCopy(current);
	if (problem) next.btp_participant_conflict = problem;
	else delete next.btp_participant_conflict;
	if (problem) report(app, tkey, { _id: next._id, setup: { match_num: next.setup?.match_num }, btp_match_ids: next.btp_match_ids }, problem);
	return { current: next, blocked: !!problem, changed: true };
}

module.exports = { setup_ids, raw_ids, conflict, reconcile, report };
