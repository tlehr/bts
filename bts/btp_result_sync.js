'use strict';

const { deepCopy } = require('nedb/lib/model');
const { isDeepStrictEqual } = require('util');
const call_sync = require('./btp_call_sync');

// Compare the payload revision, not just the ID: a delayed acknowledgement of
// an earlier court/status update must not acknowledge a newer result.
const fields = ['btp_match_ids', 'setup', 'team1_won', 'btp_winner', 'network_score',
	'score_status_network_score', 'score_status', 'btp_score_status', 'forward_loser',
	'no_match_losing_team', 'end_ts', 'duration_ms', 'shuttle_count', 'match_order', 'btp_participant_conflict', 'btp_call_pending'];

function version_query(match, tkey) {
	const expected = Object.fromEntries(fields.map(field => [field, deepCopy(match[field])]));
	// NeDB object equality never matches nested undefined values, even against
	// themselves. Newly imported setups can contain these until a restart.
	// Compare the copied revision inside the atomic, ID-indexed update instead.
	return { _id: match._id, tournament_key: tkey, $where: function() {
		return fields.every(field => isDeepStrictEqual(this[field], expected[field]));
	} };
}

function is_result(match) {
	return typeof match.team1_won === 'boolean' || match.score_status === 'no_match';
}

function score_matches(match, remote) {
	if (match.score_status === 'no_match' || match.score_status === 'walkover') return true;
	let expected = match.score_status_network_score || match.network_score;
	if (['retired', 'disqualified'].includes(match.score_status) && match.btp_match_ids?.length) {
		// Use precisely the reached score sent by the protocol, before any
		// synthetic final points used to display a special result in BTS.
		const request = require('./btp_proto').update_request(match, 'readback');
		const sets = request.Update.Tournament.Matches[0].Match.Sets;
		expected = sets?.map(row => [row.Set.T1, row.Set.T2]);
	}
	if (!Array.isArray(expected)) return true; // Automatic byes have no sets.
	const actual = (remote.Sets?.[0]?.Set || []).map(set => [set.T1?.[0], set.T2?.[0]]);
	const normalized = sets => sets.map(set => [Number(set[0]) || 0, Number(set[1]) || 0])
		.filter(set => set[0] !== 0 || set[1] !== 0);
	return JSON.stringify(normalized(expected)) === JSON.stringify(normalized(actual));
}

function call(store, method, ...args) {
	return new Promise((resolve, reject) => store[method](...args,
		(error, value) => error ? reject(error) : resolve(value)));
}

async function latest_pending(connection, source) {
	if (!source._id) return source; // Hidden bye nodes are not stored locally.
	const store = connection.app.db.matches;
	const current = await call(store, 'findOne', { _id: source._id, tournament_key: connection.tkey })
		.catch(error => { error.btp_phase = 'load'; throw error; });
	if (!current || connection.terminated) return null;
	// These flags describe an outgoing operation, rather than stored state.
	if (source.btp_clear_court === true && !current.setup?.court_id) current.btp_clear_court = true;
	if (source.btp_winner_only_update === true) current.btp_winner_only_update = true;
	const pending = {};
	if (is_result(current) && current.btp_needsync !== true) pending.btp_needsync = true;
	if (call_sync.is_call(current) && current.btp_call_pending !== true) pending.btp_call_pending = true;
	if (Object.keys(pending).length) {
		const affected = await call(store, 'update', version_query(current, connection.tkey),
			{ $set: pending }, {})
			.catch(error => { error.btp_phase = 'persist'; throw error; });
		if (affected !== 1) return null; // A newer change will enqueue/retry its own payload.
		Object.assign(current, pending);
	}
	return current.btp_participant_conflict ? null : current;
}

function enqueue(connection, match, send) {
	if (connection.readonly || connection.terminated) return Promise.resolve(false);
	connection.score_updates ||= new Map();
	const key = match._id || JSON.stringify(match.btp_match_ids);
	const queued = connection.score_updates.get(key);
	if (queued) {
		queued.next = deepCopy(match);
		return queued.promise;
	}
	const entry = { next: deepCopy(match) };
	connection.score_updates.set(key, entry);
	entry.promise = Promise.resolve().then(async () => {
		let result = false;
		while (entry.next && !connection.terminated && !connection.readonly) {
			const source = entry.next;
			entry.next = null;
			entry.has_pending ||= is_result(source) || call_sync.is_call(source) || source.btp_needsync || source.btp_call_pending;
			const latest = await latest_pending(connection, source);
			if (latest && !connection.terminated) {
				entry.has_pending ||= is_result(latest) || latest.btp_needsync || latest.btp_call_pending;
				result = await send(latest);
				entry.delivered = result === true;
			}
		}
		return result;
	}).catch(error => {
		entry.delivered = false;
		require('./btp_request_log').local_failure(connection, match, error);
		return false;
	}).finally(() => {
		connection.score_updates.delete(key);
		if (entry.next && !connection.terminated) return enqueue(connection, entry.next, send);
		if (entry.has_pending) connection.schedule_result_retry({ readback: entry.delivered === true });
	});
	return entry.promise;
}

module.exports = { version_query, is_result, score_matches, enqueue };
