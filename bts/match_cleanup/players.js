'use strict';

const reads = require('./reads');

// Patch participant fields rather than replacing setup: a point press on an
// independent court may concurrently update state and preparation markers.
async function save(app, match, patch) {
	if (!Object.keys(patch).length) return;
	const updated = await new Promise((resolve, reject) => {
		app.db.matches.update({ _id: match._id, tournament_key: match.tournament_key }, { $set: patch }, { returnUpdatedDocs: true },
			(error, _count, document) => error ? reject(error) : resolve(document));
	});
	const current = updated || match;
	require('../admin').notify_change(app, match.tournament_key, 'update_player_status', {
		match__id: current._id, btp_winner: current.btp_winner, setup: current.setup,
	});
}

function slots(setup, include_tablets) {
	const result = [];
	(setup?.teams || []).slice(0, 2).forEach((team, ti) => (team.players || []).forEach((player, pi) => {
		result.push({ player, path: `setup.teams.${ti}.players.${pi}` });
	}));
	if (include_tablets) (setup?.tabletoperators || []).forEach((player, pi) => result.push({ player, path: `setup.tabletoperators.${pi}` }));
	return result;
}

async function players(app, key, id, end_ts, provided, helpers) {
	const current = provided?.match || await reads.match(app, key, id);
	const ids = helpers.setup_player_btp_ids(current?.setup);
	if (!ids.length) return;
	const wanted = new Set(ids.map(String));
	const matches = await reads.matches(app, key, ids, true);
	await Promise.allSettled(matches.map(async match => {
		if (!match.setup || match.setup.now_on_court === true) return;
		const patch = {}, changed = [];
		for (const { player, path } of slots(match.setup, false)) {
			if (!wanted.has(String(player.btp_id))) continue;
			// A later assignment on another court must survive finishing this one.
			if (player.now_playing_on_court && player.now_playing_on_court !== true &&
				player.now_playing_on_court !== current.setup.court_id) continue;
			if (!player.now_playing_on_court && match._id !== id) continue;
			if (player.now_playing_on_court === false && player.checked_in === false &&
				(!end_ts || player.last_time_on_court_ts === end_ts)) continue;
			player.now_playing_on_court = false;
			player.checked_in = false;
			if (end_ts) player.last_time_on_court_ts = end_ts;
			patch[path] = player;
			changed.push(player);
		}
		if (helpers.release_blocked_match_if_no_players_on_court(match.setup)) patch['setup.state'] = match.setup.state;
		if (changed.length) require('../btp_manager').update_players(app, key, changed);
		await save(app, match, patch);
	})).then(throw_failure);
}

async function tablets(app, key, id, end_ts, provided, helpers) {
	const { match: current, tournament } = await reads.context(app, key, id, provided);
	await new Promise((resolve, reject) => helpers.close_tabletoperator_assignment_on_court(app, key, current?.setup?.court_id, end_ts,
		error => error ? reject(error) : resolve()));
	const ids = helpers.setup_tabletoperator_btp_ids(current?.setup);
	if (!ids.length) return;
	const wanted = new Set(ids.map(String));
	// Read after player cleanup so a dual-role participant keeps its updated
	// check-in and pause timestamps.
	const matches = await reads.matches(app, key, ids, false);
	await Promise.allSettled(matches.map(async match => {
		if (match.setup?.now_on_court === true && match._id !== id) return;
		const patch = {};
		for (const { player, path } of slots(match.setup, true)) {
			if (!wanted.has(String(player.btp_id))) continue;
			if (player.now_tablet_on_court && player.now_tablet_on_court !== true &&
				player.now_tablet_on_court !== current.setup.court_id) continue;
			const before = JSON.stringify(player);
			helpers.reset_tabletoperator_settings_at_player(app, key, tournament, player, end_ts, false);
			if (JSON.stringify(player) !== before) {
				patch[path] = player;
				require('../btp_manager').update_players(app, key, [player]);
			}
		}
		await save(app, match, patch);
	})).then(throw_failure);
}

function throw_failure(results) {
	const failed = results.find(result => result.status === 'rejected');
	if (failed) throw failed.reason;
}

module.exports = { players, tablets };
