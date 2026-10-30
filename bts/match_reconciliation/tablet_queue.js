'use strict';

const { promisify } = require('util');
const flags = require('./player_flags');
const reads = require('../preparation_selection/model_reads');

function player_ids(players) {
	return new Set((players || []).map(player => player?.btp_id)
		.filter(id => id != null && Number.isFinite(Number(id)) && Number(id) >= 0).map(String));
}

function busy_ids(matches) {
	const active = flags.expected(matches);
	return new Set([...active.playing.keys(), ...active.tablets.keys()].map(String));
}

function repair(entry, busy) {
	if (entry.court != null || !Array.isArray(entry.tabletoperator)) return null;
	const remaining = entry.tabletoperator.filter(player => !busy.has(String(player?.btp_id)));
	if (remaining.length === entry.tabletoperator.length) return null;
	// Keep the idle partner waiting; retain the source court/finish identity.
	return remaining.length ? { tabletoperator: remaining } : { court: -1 };
}

async function apply(app, key, entries, busy) {
	const result = [];
	for (const entry of entries) {
		const patch = repair(entry, busy);
		if (!patch) { result.push(entry); continue; }
		if (patch.court === -1) patch.end_ts = app.clock?.now_ms?.() ?? Date.now();
		const updated = await new Promise((resolve, reject) => app.db.tabletoperators.update(
			{ _id: entry._id, tournament_key: key, court: null }, { $set: patch }, { returnUpdatedDocs: true },
			(error, count, document) => error ? reject(error) : resolve(count ? document : null)));
		if (!updated) continue;
		require('../admin').notify_change(app, key, updated.court == null ? 'tabletoperator_add' : 'tabletoperator_removed', { tabletoperator: updated });
		result.push(updated);
	}
	return result.filter(entry => entry.court == null);
}

async function remove_waiting(app, key, players) {
	const ids = player_ids(players);
	if (!ids.size || !app.db.tabletoperators) return;
	const entries = await promisify(app.db.tabletoperators.find.bind(app.db.tabletoperators))({
		tournament_key: key, court: null, 'tabletoperator.btp_id': { $in: [...ids].flatMap(id => [id, Number(id)]) },
	});
	await apply(app, key, entries, ids);
}

async function available(app, key, entries) {
	if (!entries.length) return entries;
	const matches = await reads.read(app, key, 'matches', true);
	return apply(app, key, entries, busy_ids(matches));
}

async function assert_available(app, key, players, except_match_id) {
	const ids = player_ids(players);
	if (!ids.size) return;
	const matches = await reads.read(app, key, 'matches', true);
	const busy = busy_ids(matches.filter(match => match._id !== except_match_id));
	if ([...ids].some(id => busy.has(id))) throw new Error('Player is already playing or operating a tablet on a court');
}

async function validate_match(app, key, match) {
	const players = (match.setup.teams || []).flatMap(team => team.players || []);
	const tablets = match.setup.tabletoperators || [];
	const playing = player_ids(players);
	if ([...player_ids(tablets)].some(id => playing.has(id))) throw new Error('Player cannot play and operate the tablet in the same match');
	await assert_available(app, key, [...players, ...tablets], match._id);
}

module.exports = { player_ids, busy_ids, repair, apply, remove_waiting, available, assert_available, validate_match };
