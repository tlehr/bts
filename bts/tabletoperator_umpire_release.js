'use strict';

const { promisify } = require('util');
const activity = require('./match_reconciliation/tablet_queue');
const reads = require('./match_cleanup/reads');

function has_umpire(setup) {
	return !!(setup?.umpire && (setup.umpire.name || setup.umpire._id || setup.umpire.btp_id != null));
}

function prepare(tournament, match) {
	if (!tournament.tabletoperator_enabled || !tournament.tabletoperator_release_on_umpire_enabled ||
		tournament.tabletoperator_with_umpire_enabled === true || !has_umpire(match.setup)) return null;
	const reserved = (match.setup.tabletoperators || []).map(person => ({ ...person }));
	delete match.setup.tabletoperators;
	return reserved;
}

function same_people(entry, participants) {
	const ids = activity.player_ids(participants);
	const names = new Set(participants.filter(person => !activity.player_ids([person]).size).map(person => person.name).filter(Boolean));
	return (entry.tabletoperator || []).some(person => ids.has(String(person.btp_id)) ||
		(!activity.player_ids([person]).size && names.has(person.name)));
}

async function release_flags(app, tournament, participants, court_id) {
	const ids = activity.player_ids(participants);
	if (!ids.size) return;
	const matches = await reads.matches(app, tournament.key, [...ids].map(Number), false), edits = [];
	const now = app.clock?.now_ms?.() ?? Date.now(), ready = [];
	for (const match of matches) {
		const patch = {};
		for (const [ti, team] of (match.setup?.teams || []).entries()) {
			for (const [pi, player] of (team.players || []).entries()) {
				if (!ids.has(String(player.btp_id))) continue;
				// Preserve a later assignment elsewhere, and all planned roles.
				if (player.now_tablet_on_court && ![court_id, 'prep_call', true].includes(player.now_tablet_on_court)) continue;
				const prefix = `setup.teams.${ti}.players.${pi}`;
				if (player.now_tablet_on_court) patch[prefix + '.now_tablet_on_court'] = false;
				// A waived duty adds no service pause; an existing player pause stays.
				if (!tournament.btp_settings?.check_in_per_match && player.checked_in === false &&
					!player.now_playing_on_court && !player.tablet_break_active &&
					Number(player.last_time_on_court_ts || 0) + Number(tournament.btp_settings?.pause_duration_ms || 0) <= now) {
					patch[prefix + '.checked_in'] = true;ready.push({ ...player, now_tablet_on_court: false, checked_in: true });
				}
			}
		}
		if (Object.keys(patch).length) edits.push({ match, patch });
	}
	await require('./match_cleanup/participant_writes')(app, edits, records => {
		for (const current of records) require('./admin').notify_change(app, tournament.key, 'update_player_status', {
			match__id: current._id, btp_winner: current.btp_winner, setup: current.setup,
		});
	});
	if (ready.length) require('./btp_manager').update_players(app, tournament.key, ready);
}

async function apply(app, tournament, match, reserved) {
	if (reserved === null || !match.setup.now_on_court || !match.setup.court_id) return;
	const store = app.db.tabletoperators, key = tournament.key;
	const identity = { released_for_match_id: match._id, released_for_call_timestamp: match.setup.called_timestamp ?? null };
	if (await promisify(store.findOne.bind(store))({ tournament_key: key, ...identity })) return;
	let selected;
	if (reserved.length) {
		// Includes reservations made by older preparation calls without a match id.
		const entries = await promisify(store.find.bind(store))({ tournament_key: key,
			court: { $in: [match.setup.court_id, 'prep_call', '__match_edit_assigned__'] } });
		selected = entries.find(entry => (!entry.assigned_match_id || entry.assigned_match_id === match._id) && same_people(entry, reserved));
	} else {
		const entries = await promisify(store.find.bind(store))({ tournament_key: key, court: null, played_on_court: match.setup.court_id });
		// A waiver needs no elapsed waiting timer, but an active participant must
		// never be selected from a stale queue entry.
		const available = await activity.available(app, key, entries);
		available.sort((a, b) => Number(a.start_ts || 0) - Number(b.start_ts || 0) || String(a._id).localeCompare(String(b._id)));
		selected = available[0];
	}
	const participants = reserved.length ? reserved : selected?.tabletoperator || [];
	if (!participants.length) return;
	let changed;
	if (selected) {
		changed = await new Promise((resolve, reject) => store.update({ _id: selected._id, tournament_key: key, court: selected.court ?? null },
			{ $set: { court: -1, end_ts: app.clock?.now_ms?.() ?? Date.now(), release_reason: 'umpire', ...identity } },
			{ returnUpdatedDocs: true }, (error, count, document) => error ? reject(error) : resolve(count ? document : null)));
		if (!changed) return;
	}
	await release_flags(app, tournament, participants, match.setup.court_id);
	if (changed) require('./admin').notify_change(app, key, 'tabletoperator_removed', { tabletoperator: changed });
}

module.exports = { has_umpire, prepare, apply };
