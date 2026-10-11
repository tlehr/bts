'use strict';

const keys = require('../queue_lock_keys');
const { player_ids } = require('../tournament_model/player_ids');
const match_changes = require('./match_changes');

module.exports = function resources(tkey, before, changes, effects) {
	const locks = [keys.sync(tkey)];
	const locked_matches = new Set();
	const direct = new Set();
	const players = new Set();
	const courts = new Set();
	const reasons = {};
	const sources = new Map();
	let match_work = false;
	let metadata_only = 0;
	const ordering_plan = require('./ordering_only')(changes, effects);
	// A tablet-operator team can be chosen from another match during an explicit
	// call. Official moves can also update a previous assignment. Those writers
	// still use allocation-wide locks, so keep their existing protection.
	const ordering_only = ordering_plan && !before.tournaments?.some(tournament => tournament.tabletoperator_enabled === true) &&
		changes.every(change => !change.before.setup?.umpire && !change.before.setup?.service_judge &&
			!change.before.setup?.tabletoperators?.length);
	const add_match = (id, source = 'direct') => {
		if (!id) return;
		locked_matches.add(id);
		locks.push(keys.match(tkey, id));
		if (source === 'direct') direct.add(id);
		else {
			if (!sources.has(source)) sources.set(source, new Set());
			sources.get(source).add(id);
		}
	};
	for (const change of changes) {
		const { collection, before: old, after: next, id } = change;
		if (collection === 'tournaments') {
			const paths = [...Object.keys(change.update?.$set || {}), ...Object.keys(change.update?.$unset || {})];
			const events_only = old && next && paths.length && paths.every(path => path === 'events' || path.startsWith('events.'));
			locks.push(events_only ? keys.events(tkey) : keys.tournament(tkey));
		}
		if (collection === 'locations') locks.push(keys.locations(tkey));
		if (collection === 'matches') {
			match_work = true;
			add_match(id);
			const dependencies = match_changes(old, next);
			if (!dependencies.length) metadata_only++;
			for (const reason of dependencies) reasons[reason] = (reasons[reason] || 0) + 1;
			if (dependencies.length) for (const doc of [old, next]) {
				player_ids(doc).forEach(player => players.add(player));
				if (doc?.setup?.court_id) courts.add(doc.setup.court_id);
			}
		}
		if (collection === 'courts') { courts.add(id); add_match(old?.match_id); add_match(next?.match_id); match_work = true; }
		if (collection === 'umpires') locks.push(keys.umpires(tkey));
		if (collection === 'tabletoperators') {
			locks.push(keys.tabletoperators(tkey));
			for (const doc of [old, next]) {
				add_match(doc?.match_id);
				if (doc?.court) courts.add(doc.court);
				(doc?.tabletoperator || []).forEach(player => { if (player.btp_id != null) players.add(String(player.btp_id)); });
			}
			match_work = true;
		}
	}
	for (const effect of effects) {
		(effect.resources.matches || []).forEach(id => add_match(id, 'effect'));
		(effect.resources.players || []).forEach(id => { if (id != null) players.add(String(id)); });
		(effect.resources.courts || []).forEach(id => { if (id) courts.add(id); });
	}
	if (players.size || courts.size || locked_matches.size) match_work = true;
	if (before.relations) {
		for (const player of players) for (const id of before.relations.for_player(player)) add_match(id, 'player');
		for (const court of courts) for (const id of before.relations.for_court(court)) add_match(id, 'court');
	} else {
		// Compatibility for callers constructing a standalone plan snapshot.
		for (const match of before.matches) {
			if (player_ids(match).some(id => players.has(id))) add_match(match._id, 'player');
			if (courts.has(match.setup?.court_id)) add_match(match._id, 'court');
		}
	}
	for (const court of courts) locks.push(keys.court(tkey, court));
	if (match_work) {
		locks.push(keys.selection(tkey));
		// Keep allocation/check-in/finish writers serialized, also for profile
		// updates. Ordering-only writes protect candidate selection separately;
		// targeted calls on matches outside their relation scope can continue.
		if (!ordering_only) locks.push(keys.preparation(tkey), keys.tabletoperators(tkey), keys.umpires(tkey), keys.auto_call(tkey));
	}
	return { locks: keys.normalize_list(locks), locked_matches, diagnostics: {
		direct_match_locks: direct.size,
		additional_match_locks: [...locked_matches].filter(id => !direct.has(id)).length,
		local_only_changes: metadata_only,
		allocation_scope: ordering_only ? 'ordering_only' : ordering_plan ? 'ordering_with_allocation' : 'full',
		expansion_reasons: reasons,
		dependency_matches: Object.fromEntries([...sources].map(([source, ids]) => [source, ids.size])),
		players: players.size, courts: courts.size,
	} };
};
