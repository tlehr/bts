'use strict';

const assert = require('assert');
const crypto = require('crypto');

const async = require('async');

const btp_parse = require('./btp_parse');
const countries = require('./countries');
const match_utils = require('./match_utils');
const utils = require('./utils');
const { fix_player } = require('./name_fixup');
const match_changes = require('./btp_match_changes');
const integrated_btp_match = require('./btp_match_changes/integrated_match');
const normalization_fingerprints = require('./tournament_model/normalization_fingerprints');
const { cmp_scheduled_match_order } = require('./match_automation');

function now_ms(app) {
	return app?.clock ? app.clock.now_ms() : Date.now();
}

function resolve_current_now_ms(current_now_ms) {
	const normalized = Number(current_now_ms);
	return Number.isFinite(normalized) ? normalized : Date.now();
}

function log_btp_sync_timing(tkey, phase, duration_ms, extra = {}) {
	require('./performance/traces').phase(phase, Date.now() - duration_ms, duration_ms, extra);
	if (!require('./server_diagnostics').sync_timing_enabled(tkey)) {
		return;
	}
	const payload = {
		execution: require('worker_threads').isMainThread ? 'main' : 'worker',
		tournament_key: tkey,
		phase,
		duration_ms,
		...extra,
	};
	console.warn('[bts] btp_sync:phase_timing ' + JSON.stringify(payload));
}

async function btp_sync_state(app, tkey, expected_reset_ts) {
	const tournaments = app?.db?.tournaments;
	if (!tournaments || typeof tournaments.findOne_async !== 'function') {
		return { ok: true, reason: 'no_tournament_store' };
	}
	const tournament = await tournaments.findOne_async({ key: tkey }, { btp_enabled: 1, last_reset_ts: 1 });
	if (!tournament || tournament.btp_enabled !== true) {
		return { ok: false, reason: 'btp_disabled' };
	}
	if (expected_reset_ts !== undefined && tournament.last_reset_ts !== expected_reset_ts) {
		return { ok: false, reason: 'tournament_reset_during_sync' };
	}
	return { ok: true, reason: 'current' };
}

function log_btp_sync_skipped(tkey, reason) {
	require('./server_diagnostics').log(null, tkey, '[bts] btp_sync:skipped', {
		tournament_key: tkey,
		reason,
	});
}

function timed_btp_sync_task(tkey, phase, task) {
	return (...args) => {
		const cb = args[args.length - 1];
		const start_ms = Date.now();
		args[args.length - 1] = (...cbArgs) => {
			log_btp_sync_timing(tkey, phase, Date.now() - start_ms);
			cb(...cbArgs);
		};
		try {
			return task(...args);
		} catch (err) {
			args[args.length - 1](err);
		}
	};
}

function btp_state_counts(btp_state) {
	const map_size = (value) => value instanceof Map ? value.size : 0;
	return {
		matches: Array.isArray(btp_state.matches) ? btp_state.matches.length : map_size(btp_state.matches),
		events: map_size(btp_state.events),
		stages: map_size(btp_state.stages),
		entries: map_size(btp_state.entries),
		officials: map_size(btp_state.officials),
		locations: map_size(btp_state.locations),
		courts: map_size(btp_state.courts),
	};
}

function time_str(dt) {
	return utils.pad(dt.hour, 2, '0') + ':' + utils.pad(dt.minute, 2, '0');
}

function date_str(dt) {
	return utils.pad(dt.year, 2, '0') + '-' + utils.pad(dt.month, 2, '0') + '-' + utils.pad(dt.day, 2, '0');
}

function _get_btp_event_name(event, draw) {
	return (event.Name[0] === draw.Name[0]) ? draw.Name[0] : event.Name[0] + (draw.DrawTypeID[0] > 1 ? ' - ' + draw.Name[0] : "");
}

function _format_btp_match_relation_label(relation_key, bm) {
	if (!bm || !bm.MatchNr || !bm.MatchNr[0]) {
		return null;
	}
	const relation = relation_key === 'winner' ? 'Gewinner' : 'Verlierer';
	const planned_time = bm.PlannedTime && bm.PlannedTime[0];
	if (!planned_time) {
		return `${relation} #${bm.MatchNr[0]}`;
	}
	return `${relation} #${bm.MatchNr[0]} - ${date_str(planned_time)} ${time_str(planned_time)}`;
}

function _is_displayable_btp_match_node(node) {
	return !!(node && node.MatchNr && node.MatchNr[0]);
}

function _is_integrated_btp_match_node(node) {
	return !!(node && node.DrawID && node.PlanningID && integrated_btp_match(node));
}

function _same_btp_from_pair(a, b) {
	if (!a || !b || !a.From1 || !a.From2 || !b.From1 || !b.From2) {
		return false;
	}
	return a.From1[0] == b.From1[0] && a.From2[0] == b.From2[0];
}

function _btp_dependency_key(draw_id, planning_id) {
	return `${draw_id}_${planning_id}`;
}

function _build_btp_dependency_lookup(btp_links, planning_nodes, btp_matches = [], current_matches = []) {
	const direct_link_by_key = new Map();
	const incoming_by_key = new Map();
	const visible_nodes_by_draw = new Map();
	const resolved_link_cache = new Map();
	const planning_node_by_key = new Map();
	const raw_match_by_key = new Map();
	const current_match_by_key = new Map();
	const raw_match_by_draw_match_nr = new Map();
	const current_match_by_draw_match_nr = new Map();
	const source_consumers_by_key = new Map();

	const remember_source_consumers = (node) => {
		if (!node?.DrawID || !_btp_node_is_match_like(node)) {
			return;
		}
		const sources = new Set([node.From1?.[0], node.From2?.[0]]);
		for (const source of sources) {
			if (source == null) continue;
			const key = _btp_dependency_key(node.DrawID[0], source);
			if (!source_consumers_by_key.has(key)) source_consumers_by_key.set(key, []);
			source_consumers_by_key.get(key).push(node);
		}
	};

	const remember_visible_node = (node) => {
		if (!node || !node.DrawID) {
			return;
		}
		const draw_id = node.DrawID[0];
		if (!_is_displayable_btp_match_node(node)) {
			return;
		}
		if (!visible_nodes_by_draw.has(draw_id)) {
			visible_nodes_by_draw.set(draw_id, []);
		}
		const visible_nodes = visible_nodes_by_draw.get(draw_id);
		const planning_id = node.PlanningID && node.PlanningID[0];
		const existing_index = planning_id == null
			? -1
			: visible_nodes.findIndex((candidate) => candidate?.PlanningID?.[0] == planning_id);
		if (existing_index >= 0) {
			const existing = visible_nodes[existing_index];
			if (!(existing?.PlannedTime?.[0]) && node?.PlannedTime?.[0]) {
				visible_nodes[existing_index] = node;
			}
		} else {
			visible_nodes.push(node);
		}
		const remember_incoming = (target_planning, relation) => {
			const key = _btp_dependency_key(draw_id, target_planning);
			if (!incoming_by_key.has(key)) incoming_by_key.set(key, []);
			const incoming = incoming_by_key.get(key);
			const existing_incoming_index = planning_id == null
				? -1
				: incoming.findIndex((entry) => entry?.relation === relation && entry?.candidate?.PlanningID?.[0] == planning_id);
			if (existing_incoming_index >= 0) {
				const existing = incoming[existing_incoming_index]?.candidate;
				if (!(existing?.PlannedTime?.[0]) && node?.PlannedTime?.[0]) {
					incoming[existing_incoming_index] = { candidate: node, relation };
				}
			} else {
				incoming.push({ candidate: node, relation });
			}
		};
		if (node.WinnerTo) {
			remember_incoming(node.WinnerTo[0], 'winner');
		}
		if (node.LoserTo) {
			remember_incoming(node.LoserTo[0], 'loser');
		}
	};

	for (const link of (btp_links || [])) {
		if (link && link.DrawID && link.PlanningID) {
			direct_link_by_key.set(_btp_dependency_key(link.DrawID[0], link.PlanningID[0]), link);
		}
	}

	for (const node of planning_nodes.values()) {
		if (node?.DrawID && node?.PlanningID) {
			planning_node_by_key.set(_btp_dependency_key(node.DrawID[0], node.PlanningID[0]), node);
		}
		remember_visible_node(node);
	}

	for (const match of (btp_matches || [])) {
		if (match?.DrawID && match?.PlanningID) {
			raw_match_by_key.set(_btp_dependency_key(match.DrawID[0], match.PlanningID[0]), match);
		}
		if (match?.DrawID && match?.MatchNr) {
			raw_match_by_draw_match_nr.set(_btp_dependency_key(match.DrawID[0], match.MatchNr[0]), match);
		}
		remember_visible_node(match);
	}
	// Use the same final raw/planning maps as the former full scan. Duplicate
	// planning keys must retain only the last node in each representation.
	for (const node of raw_match_by_key.values()) remember_source_consumers(node);
	for (const node of planning_node_by_key.values()) remember_source_consumers(node);

	for (const match of (current_matches || [])) {
		for (const btp_match_id of (match?.btp_match_ids || [])) {
			if (btp_match_id?.draw != null && btp_match_id?.planning != null) {
				current_match_by_key.set(_btp_dependency_key(btp_match_id.draw, btp_match_id.planning), match);
			}
			if (btp_match_id?.draw != null && btp_match_id?.nr != null) {
				current_match_by_draw_match_nr.set(_btp_dependency_key(btp_match_id.draw, btp_match_id.nr), match);
			}
		}
	}

	return {
		direct_link_by_key,
		incoming_by_key,
		visible_nodes_by_draw,
		resolved_link_cache,
		planning_node_by_key,
		raw_match_by_key,
		current_match_by_key,
		raw_match_by_draw_match_nr,
		current_match_by_draw_match_nr,
		source_consumers_by_key,
	};
}

function _visible_nodes_for_draw(draw_id, planning_nodes, dependency_lookup) {
	return dependency_lookup && dependency_lookup.visible_nodes_by_draw
		? (dependency_lookup.visible_nodes_by_draw.get(draw_id) || [])
		: planning_nodes.values();
}

function _find_visible_consolidation_match_for_hidden_node(draw_id, hidden_node, planning_nodes, dependency_lookup = null) {
	if (!hidden_node || !hidden_node.From1 || !hidden_node.From2) {
		return null;
	}
	const hidden_planning = hidden_node.PlanningID && hidden_node.PlanningID[0];
	for (const candidate of _visible_nodes_for_draw(draw_id, planning_nodes, dependency_lookup)) {
		if (!candidate || candidate.DrawID[0] !== draw_id) {
			continue;
		}
		if (hidden_planning != null && candidate.PlanningID && candidate.PlanningID[0] == hidden_planning) {
			continue;
		}
		if (!_is_displayable_btp_match_node(candidate)) {
			continue;
		}
		if (_same_btp_from_pair(candidate, hidden_node)) {
			return candidate;
		}
	}
	return null;
}

function _find_incoming_matches_for_planning(draw_id, source_planning, planning_nodes, dependency_lookup = null) {
	if (dependency_lookup && dependency_lookup.incoming_by_key) {
		return dependency_lookup.incoming_by_key.get(_btp_dependency_key(draw_id, source_planning)) || [];
	}
	const incoming = [];
	for (const candidate of planning_nodes.values()) {
		if (!candidate || candidate.DrawID[0] !== draw_id) {
			continue;
		}
		if (!_is_displayable_btp_match_node(candidate)) {
			continue;
		}
		let relation = null;
		if (candidate.WinnerTo && candidate.WinnerTo[0] == source_planning) {
			relation = 'winner';
		} else if (candidate.LoserTo && candidate.LoserTo[0] == source_planning) {
			relation = 'loser';
		}
		if (relation) {
			incoming.push({ candidate, relation });
		}
	}
	return incoming;
}

function _find_visible_consolidation_match_for_incoming(draw_id, incoming, planning_nodes, dependency_lookup = null) {
	if (!incoming || incoming.length < 2) {
		return null;
	}
	const incoming_plannings = incoming
		.map((entry) => entry.candidate && entry.candidate.PlanningID ? entry.candidate.PlanningID[0] : null)
		.filter((planning) => planning != null);
	if (incoming_plannings.length !== incoming.length) {
		return null;
	}
	for (const candidate of _visible_nodes_for_draw(draw_id, planning_nodes, dependency_lookup)) {
		if (!candidate || candidate.DrawID[0] !== draw_id) {
			continue;
		}
		if (!_is_displayable_btp_match_node(candidate)) {
			continue;
		}
		const candidate_sources = [
			candidate.From1 && candidate.From1[0],
			candidate.From2 && candidate.From2[0],
		];
		if (candidate_sources.every((planning) => planning != null && incoming_plannings.includes(planning))) {
			return candidate;
		}
	}
	return null;
}

function _resolve_btp_dependency_link(draw_id, source_planning, target_planning, btp_links, planning_nodes, visited = new Set(), dependency_lookup = null) {
	if (source_planning == null) {
		return null;
	}
	const visit_key = `${draw_id}_${source_planning}_${target_planning || ''}`;
	if (dependency_lookup && dependency_lookup.resolved_link_cache && dependency_lookup.resolved_link_cache.has(visit_key)) {
		return dependency_lookup.resolved_link_cache.get(visit_key);
	}
	if (visited.has(visit_key)) {
		return null;
	}
	visited.add(visit_key);

	const direct_link = dependency_lookup && dependency_lookup.direct_link_by_key
		? dependency_lookup.direct_link_by_key.get(_btp_dependency_key(draw_id, source_planning))
		: btp_links.find((l) => l.DrawID[0] === draw_id && l.PlanningID[0] == source_planning);
	if (direct_link && direct_link.Link && direct_link.Link[0]) {
		if (dependency_lookup && dependency_lookup.resolved_link_cache) {
			dependency_lookup.resolved_link_cache.set(visit_key, direct_link.Link[0]);
		}
		return direct_link.Link[0];
	}

	const incoming = _find_incoming_matches_for_planning(draw_id, source_planning, planning_nodes, dependency_lookup);
	if (incoming.length > 1) {
		const unique_relations = [...new Set(incoming.map((entry) => entry.relation))];
		if (unique_relations.length === 1) {
			const consolidation_match = _find_visible_consolidation_match_for_incoming(draw_id, incoming, planning_nodes, dependency_lookup);
			if (consolidation_match) {
				const resolved = _format_btp_match_relation_label(unique_relations[0], consolidation_match);
				if (dependency_lookup && dependency_lookup.resolved_link_cache) {
					dependency_lookup.resolved_link_cache.set(visit_key, resolved);
				}
				return resolved;
			}
		}
	}

	const node = planning_nodes.get(`${draw_id}_${source_planning}`)
		|| (dependency_lookup?.raw_match_by_key && dependency_lookup.raw_match_by_key.get(_btp_dependency_key(draw_id, source_planning)));
	if (!node) {
		if (incoming.length === 1) {
			const resolved = _format_btp_match_relation_label(incoming[0].relation, incoming[0].candidate);
			if (dependency_lookup && dependency_lookup.resolved_link_cache) {
				dependency_lookup.resolved_link_cache.set(visit_key, resolved);
			}
			return resolved;
		}
		if (dependency_lookup && dependency_lookup.resolved_link_cache) {
			dependency_lookup.resolved_link_cache.set(visit_key, null);
		}
		return null;
	}

	if (_is_displayable_btp_match_node(node)) {
		if (target_planning != null && node.WinnerTo && node.WinnerTo[0] == target_planning) {
			const direct_label = _format_btp_match_relation_label('winner', node);
			if (node.PlannedTime && node.PlannedTime[0]) {
				return direct_label;
			}
		}
		if (target_planning != null && node.LoserTo && node.LoserTo[0] == target_planning) {
			const direct_label = _format_btp_match_relation_label('loser', node);
			if (node.PlannedTime && node.PlannedTime[0]) {
				return direct_label;
			}
		}
	}

	const consolidation_match = _find_visible_consolidation_match_for_hidden_node(draw_id, node, planning_nodes, dependency_lookup);
	if (consolidation_match) {
		if (target_planning != null && node.WinnerTo && node.WinnerTo[0] == target_planning) {
			return _format_btp_match_relation_label('winner', consolidation_match);
		}
		if (target_planning != null && node.LoserTo && node.LoserTo[0] == target_planning) {
			return _format_btp_match_relation_label('loser', consolidation_match);
		}
		if (consolidation_match.WinnerTo && consolidation_match.WinnerTo[0] == source_planning) {
			return _format_btp_match_relation_label('winner', consolidation_match);
		}
		if (consolidation_match.LoserTo && consolidation_match.LoserTo[0] == source_planning) {
			return _format_btp_match_relation_label('loser', consolidation_match);
		}
	}

	if (_is_displayable_btp_match_node(node)) {
		if (target_planning != null && node.WinnerTo && node.WinnerTo[0] == target_planning) {
			return _format_btp_match_relation_label('winner', node);
		}
		if (target_planning != null && node.LoserTo && node.LoserTo[0] == target_planning) {
			return _format_btp_match_relation_label('loser', node);
		}
	}

	if (node.From1 && node.From1[0]) {
		const nested_from1 = _resolve_btp_dependency_link(draw_id, node.From1[0], source_planning, btp_links, planning_nodes, visited, dependency_lookup);
		if (nested_from1) {
			return nested_from1;
		}
	}
	if (node.From2 && node.From2[0]) {
		const nested_from2 = _resolve_btp_dependency_link(draw_id, node.From2[0], source_planning, btp_links, planning_nodes, visited, dependency_lookup);
		if (nested_from2) {
			return nested_from2;
		}
	}

	if (dependency_lookup && dependency_lookup.resolved_link_cache) {
		dependency_lookup.resolved_link_cache.set(visit_key, null);
	}
	return null;
}

function _relation_from_source_to_target(source_match, target_planning) {
	if (!source_match || target_planning == null) {
		return null;
	}
	if (source_match.WinnerTo && source_match.WinnerTo[0] == target_planning) {
		return 'winner';
	}
	if (source_match.LoserTo && source_match.LoserTo[0] == target_planning) {
		return 'loser';
	}
	const links = source_match.setup && source_match.setup.links;
	if (links) {
		if (links.winner_to != null && links.winner_to == target_planning) {
			return 'winner';
		}
		if (links.loser_to != null && links.loser_to == target_planning) {
			return 'loser';
		}
	}
	return null;
}

function _winner_index_from_match(match) {
	if (!match) {
		return null;
	}
	if (match.Winner && match.Winner[0] != null) {
		const winner = Number(match.Winner[0]);
		return winner === 1 ? 0 : (winner === 2 ? 1 : null);
	}
	if (match.btp_winner != null) {
		const winner = Number(match.btp_winner);
		return winner === 1 ? 0 : (winner === 2 ? 1 : null);
	}
	if (typeof match.team1_won === 'boolean') {
		return match.team1_won ? 0 : 1;
	}
	return null;
}

function _btp_raw_team_has_players(team) {
	return Array.isArray(team) && team.some((player) => player && player.ID && player.ID[0] != null);
}

function _btp_raw_match_has_players(match) {
	if (!match) {
		return false;
	}
	if (Array.isArray(match.bts_players) && match.bts_players.some(_btp_raw_team_has_players)) {
		return true;
	}
	if (_btp_raw_team_has_players(match.bts_winners)) {
		return true;
	}
	return false;
}

function _current_match_has_players(match) {
	return (match?.setup?.teams || []).some((team) => (team?.players || []).some((player) => player?.btp_id != null));
}

function _current_team_has_players(team) {
	return (team?.players || []).some((player) => player?.btp_id != null);
}

function _resolved_winner_can_produce_human(match) {
	const winner_index = _winner_index_from_match(match);
	if (winner_index == null) {
		return null;
	}
	if (Array.isArray(match?.bts_winners)) {
		return _btp_raw_team_has_players(match.bts_winners);
	}
	if (Array.isArray(match?.bts_players) && Array.isArray(match.bts_players[winner_index])) {
		return _btp_raw_team_has_players(match.bts_players[winner_index]);
	}
	if (Array.isArray(match?.setup?.teams) && match.setup.teams[winner_index]) {
		return _current_team_has_players(match.setup.teams[winner_index]);
	}
	return false;
}

function _btp_node_is_match_like(node) {
	return !!(
		node &&
		(
			(node.IsMatch && node.IsMatch[0]) ||
			(node.MatchNr && node.MatchNr[0] && node.From1 && node.From2) ||
			(node.ID && node.DrawID && node.PlanningID && node.From1 && node.From2 && !node.Link)
		)
	);
}

function _btp_source_can_produce_human(draw_id, source_planning, dependency_lookup = null, visited = new Set()) {
	if (!dependency_lookup || source_planning == null) {
		return false;
	}
	const key = _btp_dependency_key(draw_id, source_planning);
	if (visited.has(key)) {
		return false;
	}
	visited.add(key);

	const raw_match = dependency_lookup.raw_match_by_key && dependency_lookup.raw_match_by_key.get(key);
	const planning_node = dependency_lookup.planning_node_by_key && dependency_lookup.planning_node_by_key.get(key);
	const raw_winner_can_produce_human = _resolved_winner_can_produce_human(raw_match);
	if (raw_winner_can_produce_human != null) {
		return raw_winner_can_produce_human;
	}
	const planning_winner_can_produce_human = _resolved_winner_can_produce_human(planning_node);
	if (planning_winner_can_produce_human != null) {
		return planning_winner_can_produce_human;
	}
	if (_btp_raw_match_has_players(raw_match) || _btp_raw_match_has_players(planning_node)) {
		return true;
	}
	const current_match = dependency_lookup.current_match_by_key && dependency_lookup.current_match_by_key.get(key);
	const current_winner_can_produce_human = _resolved_winner_can_produce_human(current_match);
	if (current_winner_can_produce_human != null) {
		return current_winner_can_produce_human;
	}
	if (_current_match_has_players(current_match)) {
		return true;
	}
	const node = raw_match
		|| planning_node
		|| null;
	if (!node) {
		return false;
	}
	return _btp_source_can_produce_human(draw_id, node.From1 && node.From1[0], dependency_lookup, visited) ||
		_btp_source_can_produce_human(draw_id, node.From2 && node.From2[0], dependency_lookup, visited);
}

function _btp_match_is_empty_bye_branch(bm, dependency_lookup = null) {
	if (!_btp_node_is_match_like(bm) || bm.Winner) {
		return false;
	}
	if (_btp_raw_match_has_players(bm)) {
		return false;
	}
	if (!bm.From1 || !bm.From2) {
		return false;
	}
	const draw_id = bm.DrawID && bm.DrawID[0];
	return !_btp_source_can_produce_human(draw_id, bm.From1 && bm.From1[0], dependency_lookup) &&
		!_btp_source_can_produce_human(draw_id, bm.From2 && bm.From2[0], dependency_lookup);
}

function _btp_source_human_trace(draw_id, source_planning, dependency_lookup = null, visited = new Set()) {
	if (!dependency_lookup || source_planning == null) {
		return { can_produce_human: false, reason: 'missing_lookup_or_source', source_planning };
	}
	const key = _btp_dependency_key(draw_id, source_planning);
	if (visited.has(key)) {
		return { can_produce_human: false, reason: 'cycle', source_planning };
	}
	visited.add(key);

	const raw_match = dependency_lookup.raw_match_by_key && dependency_lookup.raw_match_by_key.get(key);
	const planning_node = dependency_lookup.planning_node_by_key && dependency_lookup.planning_node_by_key.get(key);
	const current_match = dependency_lookup.current_match_by_key && dependency_lookup.current_match_by_key.get(key);
	const raw_winner_can_produce_human = _resolved_winner_can_produce_human(raw_match);
	if (raw_winner_can_produce_human != null) {
		return {
			can_produce_human: raw_winner_can_produce_human,
			reason: raw_winner_can_produce_human ? 'raw_match_winner_has_players' : 'raw_match_winner_empty',
			source: compact_btp_node_debug(raw_match),
		};
	}
	const planning_winner_can_produce_human = _resolved_winner_can_produce_human(planning_node);
	if (planning_winner_can_produce_human != null) {
		return {
			can_produce_human: planning_winner_can_produce_human,
			reason: planning_winner_can_produce_human ? 'planning_node_winner_has_players' : 'planning_node_winner_empty',
			source: compact_btp_node_debug(planning_node),
		};
	}
	if (_btp_raw_match_has_players(raw_match)) {
		return { can_produce_human: true, reason: 'raw_match_players', source: compact_btp_node_debug(raw_match) };
	}
	if (_btp_raw_match_has_players(planning_node)) {
		return { can_produce_human: true, reason: 'planning_node_players', source: compact_btp_node_debug(planning_node) };
	}
	if (_current_match_has_players(current_match)) {
		const current_winner_can_produce_human = _resolved_winner_can_produce_human(current_match);
		if (current_winner_can_produce_human != null) {
			return {
				can_produce_human: current_winner_can_produce_human,
				reason: current_winner_can_produce_human ? 'current_match_winner_has_players' : 'current_match_winner_empty',
				source: current_match ? {
					id: current_match._id,
					btp_id: current_match.btp_id,
					match_num: current_match.setup && current_match.setup.match_num,
				} : null,
			};
		}
		return {
			can_produce_human: true,
			reason: 'current_match_players',
			source: current_match ? {
				id: current_match._id,
				btp_id: current_match.btp_id,
				match_num: current_match.setup && current_match.setup.match_num,
			} : null,
		};
	}
	const node = raw_match || planning_node || null;
	if (!node) {
		return { can_produce_human: false, reason: 'missing_node', source_planning };
	}
	const from1 = _btp_source_human_trace(draw_id, node.From1 && node.From1[0], dependency_lookup, visited);
	if (from1.can_produce_human) {
		return {
			can_produce_human: true,
			reason: 'from1_can_produce_human',
			source: compact_btp_node_debug(node),
			child: from1,
		};
	}
	const from2 = _btp_source_human_trace(draw_id, node.From2 && node.From2[0], dependency_lookup, visited);
	if (from2.can_produce_human) {
		return {
			can_produce_human: true,
			reason: 'from2_can_produce_human',
			source: compact_btp_node_debug(node),
			child: from2,
		};
	}
	return {
		can_produce_human: false,
		reason: 'empty_branch',
		source: compact_btp_node_debug(node),
		from1,
		from2,
	};
}

function explain_hidden_empty_bye_candidate_rejection(bm, lookup, visible_match_keys, candidate_keys) {
	if (!bm?.DrawID || !bm?.PlanningID || !bm?.ID) {
		return { reason: 'missing_identity' };
	}
	const key = _btp_dependency_key(bm.DrawID[0], bm.PlanningID[0]);
	if (visible_match_keys.has(key)) {
		return { reason: 'visible_match_key' };
	}
	if (candidate_keys.has(key)) {
		return { reason: 'duplicate_candidate_key' };
	}
	if (!_btp_node_is_match_like(bm)) {
		return { reason: 'not_match_like' };
	}
	if (bm.Winner) {
		return { reason: 'has_winner' };
	}
	if (_btp_raw_match_has_players(bm)) {
		return { reason: 'has_players' };
	}
	if (!bm.From1 || !bm.From2) {
		return { reason: 'missing_sources' };
	}
	const draw_id = bm.DrawID && bm.DrawID[0];
	const source1 = _btp_source_human_trace(draw_id, bm.From1 && bm.From1[0], lookup);
	const source2 = _btp_source_human_trace(draw_id, bm.From2 && bm.From2[0], lookup);
	if (source1.can_produce_human || source2.can_produce_human) {
		return {
			reason: 'source_can_produce_human',
			source1,
			source2,
		};
	}
	return { reason: 'candidate' };
}

function compact_btp_dependency_tree(draw_id, source_planning, dependency_lookup = null, depth = 0, visited = new Set()) {
	if (!dependency_lookup || source_planning == null) {
		return null;
	}
	const key = _btp_dependency_key(draw_id, source_planning);
	if (visited.has(key)) {
		return { planning: source_planning, cycle: true };
	}
	visited.add(key);
	const node =
		(dependency_lookup.raw_match_by_key && dependency_lookup.raw_match_by_key.get(key)) ||
		(dependency_lookup.planning_node_by_key && dependency_lookup.planning_node_by_key.get(key)) ||
		null;
	if (!node) {
		return { planning: source_planning, missing: true };
	}
	const compact = compact_btp_node_debug(node);
	if (depth <= 0) {
		return compact;
	}
	return {
		...compact,
		source1: compact_btp_dependency_tree(draw_id, node.From1 && node.From1[0], dependency_lookup, depth - 1, visited),
		source2: compact_btp_dependency_tree(draw_id, node.From2 && node.From2[0], dependency_lookup, depth - 1, visited),
	};
}

function _team_index_for_relation(match, relation) {
	const winner_index = _winner_index_from_match(match);
	if (winner_index == null) {
		return null;
	}
	if (relation === 'winner') {
		return winner_index;
	}
	if (relation === 'loser') {
		return winner_index === 0 ? 1 : 0;
	}
	return null;
}

function _btp_dependency_team_signature(draw_id, source_planning, target_planning, dependency_lookup = null) {
	if (!dependency_lookup || source_planning == null) {
		return null;
	}
	const key = _btp_dependency_key(draw_id, source_planning);
	const raw_match = dependency_lookup.raw_match_by_key && dependency_lookup.raw_match_by_key.get(key);
	const current_match = dependency_lookup.current_match_by_key && dependency_lookup.current_match_by_key.get(key);
	const relation = _relation_from_source_to_target(raw_match, target_planning)
		|| _relation_from_source_to_target(current_match, target_planning);
	const source_match = raw_match || current_match;
	const team_index = _team_index_for_relation(source_match, relation);
	if (team_index == null) {
		return {
			draw_id,
			source_planning,
			target_planning,
			relation,
			winner: null,
		};
	}
	const raw_team = raw_match?.bts_players?.[team_index] || null;
	const current_team = current_match?.setup?.teams?.[team_index] || null;
	return {
		draw_id,
		source_planning,
		target_planning,
		relation,
		winner: _winner_index_from_match(source_match),
		raw_player_ids: Array.isArray(raw_team)
			? raw_team.map((player) => player?.ID?.[0]).filter((id) => id != null)
			: null,
		current_player_ids: Array.isArray(current_team?.players)
			? current_team.players.map((player) => player?.btp_id).filter((id) => id != null)
			: null,
	};
}

async function craft_match(app, tkey, btp_id, location_map, court_map, event, stage, scoring_formats, draw, btp_links, planning_nodes, officials, clubs, districts, bm, match_ids_on_court, match_types, is_league, cached_tournament, btp_dependency_lookup = null) {
	return new Promise((resolve, reject) => {
		const gtid = event.GameTypeID[0];
		assert((gtid === 1) || (gtid === 2));

		const scheduled_time_str = (bm.PlannedTime ? time_str(bm.PlannedTime[0]) : undefined);
		const scheduled_date = (bm.PlannedTime ? date_str(bm.PlannedTime[0]) : undefined);
		const phase_name_raw = (bm.RoundName && bm.RoundName[0] ? bm.RoundName[0] : undefined);
		var match_name = phase_name_raw;
		var event_name = event.Name[0];
		const teams = _craft_teams(bm, clubs, districts);

		let phase_block_key = 'UNKNOWN';
		if (phase_name_raw) {
			if (/^G\d+$/.test(phase_name_raw)) {
				phase_block_key = phase_name_raw;
			} else if (['R64', 'R32', 'R16', 'VF', 'HF'].includes(phase_name_raw)) {
				phase_block_key = phase_name_raw;
			} else if (phase_name_raw === 'CP- R16') {
				phase_block_key = 'CP-R16';
			} else if (phase_name_raw === 'CP- VF') {
				phase_block_key = 'CP-VF';
			} else if (['Finale', '3/4'].includes(phase_name_raw)) {
				phase_block_key = 'FR';
			}
		}

		const round_places = MATCH_ROUNDS.get(match_name);
		if(match_name && round_places && (draw.Position[0] > 1 || !['Finale', 'HF', 'VF', 'R16', 'R32'].includes(match_name))) {
			const best_place = round_places[0] + draw.Position[0] - 1;
			const lowes_place = round_places[1] + draw.Position[0] - 1;

			match_name = best_place + "/" + lowes_place;
		} else {
			event_name = _get_btp_event_name(event, draw);
		}

		const btp_player_ids = [];

		if (bm.bts_players && bm.bts_players.length > 0) {
			for (const team of bm.bts_players) {
				if (team && team.length > 0) {
					for (const p of team) {
						btp_player_ids.push(p.ID[0]);
					}
				}
			}
		}

		const links = {};
		try {
			links.from1 = bm.From1[0];
			links.from2 = bm.From2[0];

			if (bm.WinnerTo) {
				links.winner_to = bm.WinnerTo[0];
			}
			if (bm.LoserTo) {
				links.loser_to = bm.LoserTo[0];
			}
			if (bm.Link) {
				links.from_link = bm.Link;
			}
		} catch (err) {
			console.error(err);
		}

		if (teams[0].players.length < 1) {
			links.from1_link = _resolve_btp_dependency_link(bm.DrawID[0], links.from1, bm.PlanningID[0], btp_links, planning_nodes, new Set(), btp_dependency_lookup);
		}

		if (teams[1].players.length < 1) {
			links.from2_link = _resolve_btp_dependency_link(bm.DrawID[0], links.from2, bm.PlanningID[0], btp_links, planning_nodes, new Set(), btp_dependency_lookup);
		}

		for (const team of teams) {
			for (const player of (team?.players || [])) {
				if (player?.btp_id != null && !btp_player_ids.includes(player.btp_id)) {
					btp_player_ids.push(player.btp_id);
				}
			}
		}


		let scoring_format = null;

		if (stage.ScoringFormat) {
			scoring_format = scoring_formats.get(Number(stage.ScoringFormat));
		} else {
			scoring_format = findDefaultScoringFormat(scoring_formats);
		}

		// Fallback, falls gar nichts gefunden wird
		if (!scoring_format) {
			scoring_format = fallbackScoringFormat();
		}

			const setup = {
				is_match: (bm.IsMatch && bm.IsMatch[0] ? true : false),
				incomplete: !_teams_complete_for_match(teams),
				is_doubles: (gtid === 2),
				match_num: bm.MatchNr[0],
			scoring_format: scoring_format,
			team_competition: false,
			event_name,
			teams,
			warmup: "none",
			links: links,
				highlight: bm.Highlight[0],
				phase_name_raw,
				phase_block_key,
				stage_id: stage.ID[0],
				stage_name: stage.Name[0],
				stage_type: stage.StageType ? stage.StageType[0] : undefined,
				stage_display_order: stage.DisplayOrder ? stage.DisplayOrder[0] : undefined,
				draw_id: draw.ID[0],
				draw_name: draw.Name[0],
				draw_position: draw.Position ? draw.Position[0] : undefined,
			};

			if (draw.bts_rankings) {
				setup.btp_group_rankings = draw.bts_rankings;
			}

		const build_with_tournament = async (tournament) => {
			if (!tournament) {
				reject(new Error(`Tournament not found for key: ${tkey}`));
				return;
			}
			if (tournament.warmup) {
				setup.warmup = tournament.warmup;
			}
			if (tournament.warmup_ready) {
				setup.warmup_ready = tournament.warmup_ready;
			}
			if (tournament.warmup_start) {
				setup.warmup_start = tournament.warmup_start;
			}
			if (tournament.btp_settings.check_in_per_match && teams.length > 1 && teams[0].players.length > 0) {
				teams[0].players[0].checked_in = (bm.Status & 0b0001) > 0;
				teams[0].players[0].check_in_per_match = true;
				if (teams[0].players.length > 1) {
					teams[0].players[1].checked_in = (bm.Status & 0b0010) > 0;
					teams[0].players[1].check_in_per_match = true;
				}

				if (teams[1].players.length > 0) {
					teams[1].players[0].checked_in = (bm.Status & 0b0100) > 0;
					teams[1].players[0].check_in_per_match = true;
					if (teams[1].players.length > 1) {
						teams[1].players[1].checked_in = (bm.Status & 0b1000) > 0;
						teams[1].players[1].check_in_per_match = true;
					}
				}
			}
			if (match_name) {
				setup.match_name = match_name;
			}

			if (scheduled_time_str) {
				setup.scheduled_time_str = scheduled_time_str;
			}
			if (scheduled_date) {
				setup.scheduled_date = scheduled_date;
			}
			if (bm.CourtID) {
				const btp_court_id = bm.CourtID[0];
				const court_id = court_map.get(btp_court_id);
				assert(court_id);
				setup.court_id = court_id;
				setup.now_on_court = match_ids_on_court.has(bm.ID[0]);
			} 
			if(bm.LocationID) {
				const btp_location_id = bm.LocationID[0];
				const location_id = location_map.get(btp_location_id);
				assert(location_id);
				setup.location_id = location_id;
			}
			if (setup.highlight != 0) {
				const all_locations = await app.db.locations.find_async({ tournament_key: tkey });
				const location = all_locations.find(loc => loc.highlight === setup.highlight);
				if (location) setup.location_id = location._id;
			}
			if (bm.Official1ID) {
				const official_id = bm.Official1ID[0];
				const o = get_umpire(app, tkey, officials, official_id) || build_fallback_official(official_id, tkey);
				if (o) {
					setup.umpire = { ...o, checked_in: !!o.checked_in };
				}
			}
			if (bm.Official2ID) {
				const official_id = bm.Official2ID[0];
				const o = get_umpire(app, tkey, officials, official_id) || build_fallback_official(official_id, tkey);
				if (o) {
					setup.service_judge = { ...o, checked_in: !!o.checked_in };
				}
			}

			const btp_match_ids = [{
				id: bm.ID[0],
				nr: bm.MatchNr[0],
				draw: bm.DrawID[0],
				planning: bm.PlanningID[0],
			}];

			const match = {
				tournament_key: tkey,
				btp_id,
				btp_match_ids,
				btp_player_ids,
				setup,
			};
			match.team1_won = undefined;
			match.btp_winner = undefined;
			if (bm.Winner) {
				match.btp_winner = bm.Winner[0];
				match.team1_won = (match.btp_winner === 1);
			} else if (_btp_match_is_empty_bye_branch(bm, btp_dependency_lookup)) {
				match.btp_winner = 1;
				match.team1_won = true;
				match.btp_needsync = true;
				match._btp_auto_bye_winner_sync = true;
			}
			match.btp_score_status = bm.ScoreStatus ? Number(bm.ScoreStatus[0]) : 0;
			match.score_status = normalize_btp_score_status(match.btp_score_status);
			match.forward_loser =
				['retired', 'disqualified', 'no_match'].includes(match.score_status) &&
				(bm.ForwardLoser ? parse_btp_bool(bm.ForwardLoser[0]) : false);
			if ((match.score_status === 'no_match' || match.score_status === 'walkover') && typeof match.team1_won === 'boolean') {
				match.no_match_losing_team = match.team1_won ? 1 : 0;
			}
			if (bm.Sets) {
				match.network_score = _parse_score(bm);
			}
			if (bm.Shuttles) {
				match.shuttle_count = bm.Shuttles[0];
			}
			if (bm.DisplayOrder) {
				match.match_order = bm.DisplayOrder[0];
			}
			match._id = 'btp_' + btp_id;
			resolve(match);
		};

		if (cached_tournament) {
			build_with_tournament(cached_tournament).catch(reject);
			return;
		}

		app.db.tournaments.findOne({ key: tkey }, (err, tournament) => {
			if (err) {
				reject(err);
				return;
			}
			build_with_tournament(tournament).catch(reject);
		});
	});
}

function _build_btp_rankings_for_draw(draw, event, stages, planning_nodes, entries, players, clubs, districts) {
	const ranking_nodes = [];
	for (const node of planning_nodes.values()) {
		if (!node || String(node.DrawID[0]) !== String(draw.ID[0])) continue;
		if (!node.EntryID || !node.Rank) continue;
		const rank = Number(node.Rank[0]);
		if (!Number.isFinite(rank) || rank < 1) continue;
		ranking_nodes.push(node);
	}

	if (ranking_nodes.length === 0) {
		return null;
	}

	const stage = stages.get(draw.StageID[0]);
	const rankings = [];
	for (const node of ranking_nodes) {
		const entry = entries.get(node.EntryID[0]);
		if (!entry) continue;
		const team_players = [];
		if (entry.Player1ID && players.get(entry.Player1ID[0])) {
			team_players.push(players.get(entry.Player1ID[0]));
		}
		if (entry.Player2ID && players.get(entry.Player2ID[0])) {
			team_players.push(players.get(entry.Player2ID[0]));
		}
		if (team_players.length === 0) continue;
		const team = _craft_team.call({ clubs, districts }, team_players);
		rankings.push({
			place_from: Number(node.Rank[0]),
			place_to: Number(node.Rank[0]),
			team,
			source: 'btp_ranking',
			confidence: 'authoritative',
			event_name: _get_btp_event_name(event, draw),
			stage_id: draw.StageID[0],
			stage_name: stage && stage.Name ? stage.Name[0] : undefined,
			stage_display_order: stage && stage.DisplayOrder ? stage.DisplayOrder[0] : undefined,
			draw_id: draw.ID[0],
			draw_name: draw.Name[0],
			draw_position: draw.Position ? draw.Position[0] : undefined,
		});
	}

	if (rankings.length === 0) {
		return null;
	}

	rankings.sort((a, b) => a.place_from - b.place_from);
	return rankings;
}

function _annotate_draw_rankings(btp_state) {
	const { draws, events, stages, planning_nodes, entries, players, clubs, districts } = btp_state;
	for (const draw of draws.values()) {
		const event = events.get(draw.EventID[0]);
		if (!event) continue;
		const rankings = _build_btp_rankings_for_draw(draw, event, stages, planning_nodes, entries, players, clubs, districts);
		if (rankings) {
			draw.bts_rankings = rankings;
		}
	}
}

function normalize_stage_entry_for_event_payload(stage_entry, btp_state) {
	const unwrap = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v);
	const optional_number = (object, fields) => {
		for (const field of fields) {
			if (object[field] === undefined) continue;
			const value = Number(unwrap(object[field]));
			if (Number.isFinite(value)) {
				return value;
			}
		}
		return null;
	};
	const optional_string = (object, fields) => {
		for (const field of fields) {
			if (object[field] === undefined) continue;
			const value = unwrap(object[field]);
			if (value !== undefined && value !== null && String(value).trim() !== '') {
				return String(value);
			}
		}
		return '';
	};
	const optional_datetime = (object, fields) => {
		for (const field of fields) {
			if (object[field] === undefined) continue;
			const value = unwrap(object[field]);
			if (!value) continue;
			if (typeof value === 'object' && Number.isFinite(Number(value.year))) {
				const date = date_str(value);
				if (Number.isFinite(Number(value.hour)) && Number.isFinite(Number(value.minute))) {
					return date + ' ' + time_str(value);
				}
				return date;
			}
			if (String(value).trim() !== '') {
				return String(value);
			}
		}
		return '';
	};
	const entry_id = Number(unwrap(stage_entry.EntryID));
	const entry = btp_state.entries.get(entry_id) || btp_state.entries.get(String(entry_id));
	if (!entry) {
		return null;
	}

	const team_players = [];
	if (entry.Player1ID) {
		const player_id = unwrap(entry.Player1ID);
		const player = btp_state.players.get(player_id) || btp_state.players.get(Number(player_id)) || btp_state.players.get(String(player_id));
		if (player) {
			team_players.push(player);
		}
	}
	if (entry.Player2ID) {
		const player_id = unwrap(entry.Player2ID);
		const player = btp_state.players.get(player_id) || btp_state.players.get(Number(player_id)) || btp_state.players.get(String(player_id));
		if (player) {
			team_players.push(player);
		}
	}
	if (team_players.length === 0) {
		return null;
	}

	const team = _craft_team.call({
		clubs: btp_state.clubs,
		districts: btp_state.districts,
	}, team_players);

	return {
		stage_entry_id: Number(unwrap(stage_entry.ID)),
		entry_id,
		status: stage_entry.Status !== undefined ? Number(unwrap(stage_entry.Status)) : null,
		seed1: stage_entry.Seed1 !== undefined ? Number(unwrap(stage_entry.Seed1)) : null,
		seed2: stage_entry.Seed2 !== undefined ? Number(unwrap(stage_entry.Seed2)) : null,
		entry_order: optional_number(stage_entry, ['EntryOrder', 'Order', 'DisplayOrder', 'Position', 'EntryNo', 'No']),
		row: optional_number(stage_entry, ['Row', 'RowNr', 'RowNumber']),
		strength: optional_number(stage_entry, ['Strength', 'Performance', 'Level', 'Leistung']),
		rank: optional_number(stage_entry, ['Rank', 'Ranking', 'Rating', 'Rang']),
		points: optional_number(stage_entry, ['Points', 'Punkte']),
		entered_at: optional_datetime(stage_entry, ['Date', 'Created', 'CreatedAt', 'Timestamp', 'ModifiedAt', 'LastModified']),
		series: optional_string(stage_entry, ['Series', 'Serie']),
		team,
	};
}

function findDefaultScoringFormat(scoringFormatMap) {

    for (const entry of scoringFormatMap.entries()) {
      const id = entry[0];
      const sf = entry[1];

      if (sf && sf.isDefault) return sf;
    }
    return null;
}

function local_match_is_live_without_confirmed_result(current_match) {
	return !!(
		current_match &&
		current_match.setup &&
		current_match.setup.now_on_court === true &&
		typeof current_match.team1_won !== 'boolean' &&
		!current_match.btp_winner &&
		!current_match.btp_needsync
	);
}

function preserveLocalLiveScoreFields(current_match, match) {
	if (!local_match_is_live_without_confirmed_result(current_match)) {
		return;
	}
	[
		'network_score',
		'network_team1_left',
		'network_team1_serving',
		'network_teams_player1_even',
		'presses',
		'duration_ms',
		'shuttle_count',
		'end_ts',
	].forEach((field) => {
		if (current_match[field] !== undefined) {
			match[field] = current_match[field];
		}
	});
}

function mergeLocalMatchIntoBtpMatch(current_match, match) {
	if (current_match.team1_won === null) {
		current_match.team1_won = undefined;
	}

	if (current_match.btp_winner) {
		match.setup.state = 'finished';
	}
	// "Kein Spiel" is a complete result even if neither side can win.
	const has_result = typeof current_match.team1_won === 'boolean' || current_match.btp_winner ||
		current_match.btp_needsync || current_match.score_status === 'no_match' || match.score_status === 'no_match';
	if (has_result) {
		match.setup.now_on_court = false;
		match.setup.state = 'finished';
	} else if (current_match.setup.now_on_court === true) {
		// Keep the local on-court state until the result is explicitly confirmed.
		match.setup.now_on_court = true;
		if (current_match.setup.state === 'blocked') {
			match.setup.state = 'blocked';
		} else if (current_match.setup.called_timestamp) {
			match.setup.state = 'oncourt';
		}
	}
	if (
		typeof current_match.team1_won !== 'boolean' &&
		!current_match.btp_winner &&
		!current_match.btp_needsync &&
		!has_result &&
		current_match.setup &&
		current_match.setup.state === 'blocked'
	) {
		match.setup.state = 'blocked';
	}

	// A missing planned court in BTP also removes the old local assignment.
	// Keep local allocations only while a match is on court or as result history.
	if (!match.setup.court_id && current_match.setup?.court_id &&
		(has_result || current_match.setup.now_on_court === true ||
			['oncourt', 'finished'].includes(current_match.setup.state))) {
		match.setup.court_id = current_match.setup.court_id;
	}

	if (!match.network_score && current_match.network_score) {
		match.network_score = current_match.network_score;
	}
	preserveLocalLiveScoreFields(current_match, match);

	if (
		(current_match.score_status === 'retired' || current_match.score_status === 'disqualified') &&
		Array.isArray(current_match.score_status_network_score)
	) {
		match.score_status = current_match.score_status;
		match.btp_score_status = current_match.btp_score_status || match.btp_score_status;
		match.forward_loser = current_match.forward_loser === true || match.forward_loser === true;
		match.score_status_network_score = current_match.score_status_network_score;
	}

	if (current_match.setup.called_timestamp) {
		match.setup.called_timestamp = current_match.setup.called_timestamp;
	}

	const local_preparation_active =
		!has_result &&
		current_match.setup &&
		current_match.setup.state === 'preparation' &&
		current_match.setup.preparation_call_timestamp;

		if (local_preparation_active) {
			match.setup.preparation_call_timestamp = current_match.setup.preparation_call_timestamp;
			match.setup.state = 'preparation';
			if (current_match.setup.location_id) {
				match.setup.location_id = current_match.setup.location_id;
			}
			if (current_match.setup.highlight != null) {
				match.setup.highlight = current_match.setup.highlight;
			}
		}
		if (current_match.setup.preparation_call_deferred === true) {
			match.setup.preparation_call_deferred = true;
		}
		if (current_match.setup.needs_preparation_successor != null) {
			match.setup.needs_preparation_successor = current_match.setup.needs_preparation_successor;
		}
	if (current_match.setup.needs_preparation_successor_ts != null) {
		match.setup.needs_preparation_successor_ts = current_match.setup.needs_preparation_successor_ts;
	}

	const suppression_active = current_match.btp_needsync === true;
	const suppressed_umpire_btp_id = suppression_active ? current_match.setup.suppressed_umpire_btp_id : null;
	const suppressed_service_judge_btp_id = suppression_active ? current_match.setup.suppressed_service_judge_btp_id : null;
	if (suppressed_umpire_btp_id != null) {
		if (match.setup.umpire && String(match.setup.umpire.btp_id) === String(suppressed_umpire_btp_id)) {
			delete match.setup.umpire;
			match.setup.suppressed_umpire_btp_id = suppressed_umpire_btp_id;
		}
	}
	if (suppressed_service_judge_btp_id != null) {
		if (match.setup.service_judge && String(match.setup.service_judge.btp_id) === String(suppressed_service_judge_btp_id)) {
			delete match.setup.service_judge;
			match.setup.suppressed_service_judge_btp_id = suppressed_service_judge_btp_id;
		}
	}

	if (current_match.btp_needsync === true && current_match.setup.umpire && !match.setup.umpire && suppressed_umpire_btp_id == null) {
		match.setup.umpire = current_match.setup.umpire;
	}

	if (current_match.setup.umpire && match.setup.umpire &&
		current_match.setup.umpire.btp_id == match.setup.umpire.btp_id &&
		current_match.btp_needsync === true &&
		('checked_in' in current_match.setup.umpire)) {
		match.setup.umpire.checked_in = current_match.setup.umpire.checked_in;
	}

	if (current_match.btp_needsync === true && current_match.setup.service_judge && !match.setup.service_judge && suppressed_service_judge_btp_id == null) {
		match.setup.service_judge = current_match.setup.service_judge;
	}

	if (current_match.setup.service_judge && match.setup.service_judge &&
		current_match.setup.service_judge.btp_id == match.setup.service_judge.btp_id &&
		current_match.btp_needsync === true &&
		('checked_in' in current_match.setup.service_judge)) {
		match.setup.service_judge.checked_in = current_match.setup.service_judge.checked_in;
	}

	if (current_match.setup.tabletoperators) {
		match.setup.tabletoperators = current_match.setup.tabletoperators;
	}

	for (const current_team of (current_match.setup.teams || [])) {
		for (const current_player of (current_team.players || [])) {
			if (!current_player?.btp_id) {
				continue;
			}
			const next_player = find_setup_player_by_btp_id(match.setup, current_player.btp_id);
			if (!next_player) {
				continue;
			}

			if (current_player.now_playing_on_court != undefined) {
				next_player.now_playing_on_court = current_player.now_playing_on_court;
			}

			if (current_player.now_tablet_on_court != undefined) {
				next_player.now_tablet_on_court = current_player.now_tablet_on_court;
			}

			if (current_player.tablet_break_active != undefined) {
				next_player.tablet_break_active = current_player.tablet_break_active;
			}

			if (current_match.btp_needsync === true && current_player.checked_in != undefined) {
				next_player.checked_in = current_player.checked_in;
			}
		}
	}

	return match;
}

function find_setup_player_by_btp_id(setup, btp_id) {
	if (!setup || btp_id == null) {
		return null;
	}
	for (const team of (setup.teams || [])) {
		for (const player of (team?.players || [])) {
			if (String(player?.btp_id) === String(btp_id)) {
				return player;
			}
		}
	}
	return null;
}

function setup_player_id_signature(setup) {
	return (setup?.teams || []).map((team) =>
		(team?.players || []).map((player) =>
			player?.btp_id == null ? null : String(player.btp_id)
		)
	);
}

function setup_player_assignment_changed(previous_setup, next_setup) {
	const previous_signature = setup_player_id_signature(previous_setup);
	const next_signature = setup_player_id_signature(next_setup);
	if (previous_signature.length !== next_signature.length) {
		return true;
	}
	for (let team_index = 0; team_index < previous_signature.length; team_index++) {
		const previous_team = previous_signature[team_index] || [];
		const next_team = next_signature[team_index] || [];
		if (previous_team.length !== next_team.length) {
			return true;
		}
		for (let player_index = 0; player_index < previous_team.length; player_index++) {
			if (previous_team[player_index] !== next_team[player_index]) {
				return true;
			}
		}
	}
	return false;
}

function player_assignment_change_affects_now_on_court_state(current_match, next_match) {
	return current_match?.setup?.now_on_court === true || next_match?.setup?.now_on_court === true;
}

function copy_checked_in_by_btp_id(target_setup, source_setup) {
	for (const source_team of (source_setup?.teams || [])) {
		for (const source_player of (source_team?.players || [])) {
			if (source_player?.btp_id == null) {
				continue;
			}
			const target_player = find_setup_player_by_btp_id(target_setup, source_player.btp_id);
			if (target_player) {
				target_player.checked_in = source_player.checked_in;
			}
		}
	}
}

function _craft_team(par) {
	if (!par) {
		return { players: [] };
	}

	const players = par.map(p => {
		const asian_name = !!(p.Asianname && p.Asianname[0]);
		const pres = { asian_name };
		if (p.Firstname && p.Lastname) {
			if (asian_name) {
				pres.name = p.Lastname[0].toUpperCase() + ' ' + p.Firstname[0];
			} else {
				pres.name = p.Firstname[0] + ' ' + p.Lastname[0];
			}

			pres.firstname = p.Firstname[0];
			pres.lastname = p.Lastname[0];
		} else if (p.Lastname) {
			pres.name = p.Lastname[0];
			pres.lastname = p.Lastname[0];
			pres.firstname = '';
		} else if (p.Firstname) {
			pres.name = p.Firstname[0];
			pres.lastname = p.Firstname[0];
			pres.firstname = '';
		}


		if (p.ID && p.ID[0]) {
			pres.btp_id = p.ID[0];
		}

		if (p.MemberID && p.MemberID[0]) {
			pres.member_id = String(p.MemberID[0]);
		}

		if (p.GenderID && p.GenderID[0]) {
			pres.gender_id = p.GenderID[0];
			pres.gender = Number(p.GenderID[0]) === 1 ? 'M' : (Number(p.GenderID[0]) === 2 ? 'W' : String(p.GenderID[0]));
		}

		if (p.Country && p.Country[0]) {
			pres.nationality = p.Country[0];
		}

		if (p.DateOfBirth && p.DateOfBirth[0] && Number.isFinite(Number(p.DateOfBirth[0].year))) {
			const birth_date = p.DateOfBirth[0];
			pres.birth_year = Number(birth_date.year);
			pres.date_of_birth = date_str(birth_date);
		}

		if (p.entries instanceof Map) {
			pres.entries = Object.fromEntries(p.entries);
		}

		if (p.LastTimeOnCourt && p.LastTimeOnCourt[0]) {
			let date = new Date(p.LastTimeOnCourt[0].year,
				p.LastTimeOnCourt[0].month - 1,
				p.LastTimeOnCourt[0].day,
				p.LastTimeOnCourt[0].hour,
				p.LastTimeOnCourt[0].minute,
				p.LastTimeOnCourt[0].second,
				p.LastTimeOnCourt[0].ms);
			pres.last_time_on_court_ts = date.getTime();
		}

		if (p.CheckedIn?.length > 0) {
			pres.checked_in = p.CheckedIn?.[0];
		}

		try{
			const club = p.ClubID && this.clubs ? this.clubs.get(p.ClubID[0]) : null;
			if (club && club.Name && club.Name[0]) {
				pres.club = club.Name[0];
				pres.club_id = p.ClubID[0];
			}
			const district = club && club.DistrictID && this.districts ? this.districts.get(club.DistrictID[0]) : null;
			const state_by_district = district && district.Name && district.Name[0] ? district.Name[0].split("-")[0] : null;
			if (district && district.Name && district.Name[0]) {
				pres.association = district.Name[0];
				pres.association_id = club.DistrictID[0];
			}

			var state = (state_by_district ? state_by_district : (p.State && p.State.length > 0 ? p.State[0] : undefined));
			if (state) {
				switch (state) {
					case 'BAW' : {
						pres.state = "Baden-Württemberg";
						break;
					} case 'BAY' : {
						pres.state = "Bayern";
						break;
					} case 'BBB': {
						pres.state = "Berlin-Brandenburg";
						break;
					} case 'BRE': {
						pres.state = "Bremen";
						break;
					} case 'HAM': {
						pres.state = "Hamburg";
						break;
					}  case 'HES': {
						pres.state = "Hessen";
						break;
					} case 'MVP': {
						pres.state = "Mecklenburg-Vorpommern";
						break;
					} case 'NIS': {
						pres.state = "Niedersachsen";
						break;
					} case 'NRW': {
						pres.state = "Nordrhein-Westfalen";
						break;
					} case 'RHP': {
						pres.state = "Rheinhessen-Pfalz";
						break;
					} case 'RHL': {
						pres.state = "Rheinland";
						break;
					} case 'SAA': {
						pres.state = "Saarland";
						break;
					} case 'SAC': {
						pres.state = "Sachsen";
						break;
					} case 'SAH': {
						pres.state = "Sachsen-Anhalt";
						break;
					} case 'SLH': {
						pres.state = "Schleswig-Holstein";
						break;
					} case 'THÜ': {
						pres.state = "Thüringen";
						break;
					} 
					default:
						pres.state = state
				}
			}
		} catch (error)
		{
		}
		fix_player(pres);
		return pres;
	});

	const tres = {
		players,
	};

	if ((players.length === 2) && (players[0].nationality != players[1].nationality)) {
		tres.name = countries.lookup(players[0].nationality) + ' / ' + countries.lookup(players[1].nationality);
	} else if ((players.length > 0) && (players[0].nationality)) {
		tres.name = countries.lookup(players[0].nationality);
	}

	return tres;
}

function _craft_teams(bm, clubs, districts) {
	assert(bm.bts_players);
	assert(clubs);
	assert(districts);

	let res = bm.bts_players.map(_craft_team, {clubs: clubs, districts: districts});
	if (Array.isArray(bm.bts_players_entry_status)) {
		res.forEach((team, index) => {
			team.entry_status = bm.bts_players_entry_status[index] || "<none>";
		});
	}

	return res;
}

function _teams_complete_for_match(teams) {
	return Array.isArray(teams) &&
		teams.length >= 2 &&
		(teams[0]?.players || []).length > 0 &&
		(teams[1]?.players || []).length > 0;
}

function _parse_score(bm) {
	assert(bm.Sets);
	assert(bm.Sets[0]);
	assert(bm.Sets[0].Set);

	return bm.Sets[0].Set.map(s => [s.T1[0], s.T2[0]]);
}

function cleanup_entities(app, tkey, btp_state, callback) {
	const admin = require('./admin');
	const { draws, events } = btp_state;
	const imported = new Set(btp_state.matches.map(match => calculate_btp_match_id(tkey, match, draws, events)));
	const official_ids = new Set(Array.from(btp_state.officials.values(), official => String(official.ID[0])));
	(async () => {
		const [matches, umpires] = await Promise.all([
			app.db.matches.find_async({ tournament_key: tkey }),
			app.db.umpires.find_async({ tournament_key: tkey }),
		]);
		for (const match of matches) {
			if (imported.has(match.btp_id)) continue;
			await app.db.matches.remove_async({ _id: match._id, tournament_key: tkey }, {});
			admin.notify_change(app, tkey, 'match_remove', { match__id: match._id });
		}
		for (const umpire of umpires) {
			if (official_ids.has(String(umpire.btp_id))) continue;
			const unused = !umpire.is_planed_as_umpire && !umpire.is_planed_as_service_judge &&
				umpire.umpire_on_court == null && umpire.service_judge_on_court == null &&
				umpire.umpire_wait == null && umpire.service_judge_wait == null &&
				umpire.umpire_pause == null && umpire.service_judge_pause == null;
			const inactive_list = unused ? (umpire.inactive_list || now_ms(app)) : null;
			if (umpire.inactive_list === inactive_list) continue;
			const [, changed] = await app.db.umpires.update_async(
				{ _id: umpire._id, tournament_key: tkey }, { $set: { inactive_list } }, { returnUpdatedDocs: true });
			if (changed) admin.notify_change(app, tkey, 'umpire_updated', changed);
		}
	})().then(() => callback(null), callback);
}

function calculate_btp_match_id(tkey, bm, draws, events) {
	const draw = draws.get(bm.DrawID[0]);
	const event = events.get(draw.EventID[0]);
	const discipline_name = (event.Name[0] === draw.Name[0]) ? draw.Name[0] : event.Name[0] + '_' + draw.Name[0];
	return tkey + '_' + discipline_name + '_' + bm.ID[0];
}

function build_match_update_fields(match) {
	return {
		btp_match_ids: match.btp_match_ids,
		btp_player_ids: match.btp_player_ids,
		_btp_sync_signature: match._btp_sync_signature,
		btp_score_status: match.btp_score_status,
		forward_loser: match.forward_loser,
		score_status: match.score_status,
		no_match_losing_team: match.no_match_losing_team,
		score_status_network_score: match.score_status_network_score,
		setup: match.setup,
		team1_won: match.team1_won,
		btp_winner: match.btp_winner,
		btp_needsync: match.btp_needsync,
		network_score: match.network_score,
		network_team1_left: match.network_team1_left,
		network_team1_serving: match.network_team1_serving,
		network_teams_player1_even: match.network_teams_player1_even,
		presses: match.presses,
		duration_ms: match.duration_ms,
		end_ts: match.end_ts,
		tabletoperator_finish_ts: match.tabletoperator_finish_ts,
		shuttle_count: match.shuttle_count,
		match_order: match.match_order,
	};
}

const MATCH_ROUNDS = new Map([
	["Finale",  [ 1,  2]],
	["HF",      [ 1,  4]],
	["VF",      [ 1,  8]],
	["R16",     [ 1, 16]],
	["R32",     [ 1, 32]],
	["3/4",     [ 3,  4]],
	["5/6",     [ 5,  6]],
	["7/8",     [ 7,  8]],
	["9/10",    [ 9, 10]],
	["11/12",   [11, 12]],
	["13/14",   [13, 14]],
	["15/16",   [15, 16]],
	["17/18",   [17, 18]],
	["19/20",   [19, 20]],
	["21/22",   [21, 22]],
	["23/24",   [23, 24]],
	["25/26",   [25, 26]],
	["27/28",   [27, 28]],
	["29/30",   [29, 30]],
	["31/32",   [31, 32]],
	["5/8",     [ 5,  8]],
	["9/12",    [ 9, 12]],
	["13/16",   [13, 16]],
	["17/20",   [17, 20]],
	["21/24",   [21, 24]],
	["25/28",   [25, 28]],
	["29/32",   [29, 32]],
	["9/16",    [ 9, 16]],
	["17/24",   [17, 24]],
	["25/32",   [25, 32]],
	["17/32",   [17, 32]],
	["CP- R16", [ 5, 16]],
	["CP- VF",  [ 5, 12]],
]);

function build_officials_by_btp_id(officials) {
	const officials_by_btp_id = new Map();
	for (const official of (officials || [])) {
		if (official && official.btp_id != null) {
			officials_by_btp_id.set(String(official.btp_id), official);
		}
	}
	return officials_by_btp_id;
}

function get_umpire(app, tkey, umpires, btp_id) {
	if (umpires instanceof Map) {
		return umpires.get(String(btp_id)) || null;
	}
	var returnValue = null;
	umpires.forEach((umpire) => {
		if (umpire.btp_id != null && String(umpire.btp_id) === String(btp_id)) {
			returnValue = umpire;
		}
	});
	return returnValue;
}

function build_btp_match_sync_signature({ bm, event, stage, draw, scoring_formats, location_map, court_map, match_ids_on_court, tournament, officials_by_btp_id, btp_dependency_lookup, source_signature, dependency_labels }) {
	const official_projection = (official_id) => {
		if (official_id == null) {
			return null;
		}
		const official = officials_by_btp_id.get(String(official_id));
		if (!official) {
			return null;
		}
		return {
			_id: official._id,
			btp_id: official.btp_id,
			firstname: official.firstname || '',
			surname: official.surname || '',
			name: official.name || '',
			country: official.country || '',
			checked_in: !!official.checked_in,
		};
	};
	const scoring_format_id = stage && stage.ScoringFormat ? Number(stage.ScoringFormat[0]) : null;
	const payload = JSON.stringify({
		bm,
		source_signature,
		dependency_labels,
		event,
		stage,
		draw,
		scoring_format: scoring_format_id == null ? findDefaultScoringFormat(scoring_formats) : scoring_formats.get(scoring_format_id),
		location_id: bm.LocationID ? location_map.get(bm.LocationID[0]) : null,
		court_id: bm.CourtID ? court_map.get(bm.CourtID[0]) : null,
		now_on_court: match_ids_on_court.has(bm.ID[0]),
		tournament: {
			warmup: tournament && tournament.warmup,
			warmup_ready: tournament && tournament.warmup_ready,
			warmup_start: tournament && tournament.warmup_start,
			check_in_per_match: !!(tournament && tournament.btp_settings && tournament.btp_settings.check_in_per_match),
		},
		official1: bm.Official1ID ? official_projection(bm.Official1ID[0]) : null,
		official2: bm.Official2ID ? official_projection(bm.Official2ID[0]) : null,
		from1_dependency: _btp_dependency_team_signature(
			bm.DrawID && bm.DrawID[0],
			bm.From1 && bm.From1[0],
			bm.PlanningID && bm.PlanningID[0],
			btp_dependency_lookup
		),
		from2_dependency: _btp_dependency_team_signature(
			bm.DrawID && bm.DrawID[0],
			bm.From2 && bm.From2[0],
			bm.PlanningID && bm.PlanningID[0],
			btp_dependency_lookup
		),
		empty_bye_branch: _btp_match_is_empty_bye_branch(bm, btp_dependency_lookup),
	});
	return crypto.createHash('sha1').update(payload).digest('hex');
}

function get_btp_match_index(app, tkey) {
	if (app.db.model) {
		// Immutable document revisions supply both delta detection and dependency
		// lookups, without cloning all setups and point histories out of NeDB.
		return app.db.model.snapshot(tkey, ['matches']).then(state => state.matches);
	}
	return new Promise((resolve, reject) => {
		app.db.matches.find(
			{ tournament_key: tkey },
			(err, matches) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(matches || []);
			}
		);
	});
}

function get_current_match_for_btp_sync(app, tkey, indexed_match) {
	if (!indexed_match) {
		return Promise.resolve(indexed_match);
	}
	// Integration helpers adjust player/setup objects. Never hand them the
	// model's immutable stored revision; copy only the selected current match.
	return app.db.matches.findOne_async({ _id: indexed_match._id, tournament_key: tkey });
}

function get_btp_no_match_cascade_sources(app, tkey) {
	return new Promise((resolve, reject) => {
		app.db.matches.find(
			{
				tournament_key: tkey,
				score_status: { $in: ['retired', 'disqualified', 'no_match'] },
			},
			(err, matches) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(matches || []);
			}
		);
	});
}

function get_now_on_court_matches(app, tkey) {
	return app.db.matches.find_async({ tournament_key: tkey, 'setup.now_on_court': true });
}

function normalize_btp_score_status(score_status) {
	const value = Number(score_status);
	switch (value) {
		case 1:
			return 'walkover';
		case 2:
			return 'retired';
		case 3:
			return 'disqualified';
		case 4:
			return 'no_match';
		default:
			return 'normal';
	}
}

function parse_btp_bool(value) {
	return value === true || value === 'true' || value === 1 || value === '1';
}

function btp_result_signature_from_match(match) {
	if (!match) {
		return null;
	}
	const score_status = score_status_by_name_value(match.score_status, match.btp_score_status);
	let winner = null;
	if (match.btp_winner != null) {
		winner = Number(match.btp_winner);
	} else if (typeof match.team1_won === 'boolean') {
		winner = match.team1_won ? 1 : 2;
	}
	if (winner == null && score_status === 0) {
		return null;
	}
	return {
		winner: Number.isFinite(winner) ? winner : null,
		score_status,
		forward_loser: match.forward_loser === true,
	};
}

function btp_result_signature_from_raw_match(bm) {
	if (!bm) {
		return null;
	}
	const winner = bm.Winner ? Number(bm.Winner[0]) : null;
	const score_status = bm.ScoreStatus ? Number(bm.ScoreStatus[0]) : 0;
	if (winner == null && score_status === 0) {
		return null;
	}
	return {
		winner: Number.isFinite(winner) ? winner : null,
		score_status,
		forward_loser: bm.ForwardLoser ? parse_btp_bool(bm.ForwardLoser[0]) : false,
	};
}

function score_status_by_name_value(score_status, fallback_score_status = 0) {
	const score_status_by_name = {
		normal: 0,
		walkover: 1,
		retired: 2,
		disqualified: 3,
		no_match: 4,
	};
	if (score_status_by_name[score_status] != null) {
		return score_status_by_name[score_status];
	}
	const numeric_fallback = Number(fallback_score_status);
	return Number.isFinite(numeric_fallback) ? numeric_fallback : 0;
}

function btp_match_confirms_pending_local_sync(current_match, bm) {
	if (!current_match || current_match.btp_needsync !== true) {
		return false;
	}
	const local = btp_result_signature_from_match(current_match);
	const remote = btp_result_signature_from_raw_match(bm);
	if (!local || !remote) {
		return false;
	}
	if (local.winner !== remote.winner) {
		return false;
	}
	if (local.score_status !== remote.score_status) {
		return false;
	}
	if ((local.score_status === 2 || local.score_status === 3 || local.score_status === 4) && local.forward_loser !== remote.forward_loser) {
		return false;
	}
	return true;
}

function btp_match_clears_local_special_result(current_match, bm) {
	if (!current_match || current_match.btp_needsync === true) {
		return false;
	}
	if (!['walkover', 'retired', 'disqualified', 'no_match'].includes(current_match.score_status)) {
		return false;
	}
	const remote = btp_result_signature_from_raw_match(bm);
	return !remote || remote.score_status === 0;
}

function btp_match_needs_local_status_cleanup(current_match, bm) {
	if (!current_match || current_match.btp_needsync === true) {
		return false;
	}
	if (require('./court_assignments_reset').can_reset(current_match) &&
		current_match.setup.court_id && !bm.CourtID?.[0]) return true;
	const remote = btp_result_signature_from_raw_match(bm);
	const remote_score_status = remote ? remote.score_status : 0;
	if (remote_score_status === 4 && current_match.score_status === 'no_match' &&
		(current_match.setup?.state !== 'finished' || current_match.setup?.now_on_court === true)) return true;
	return remote_score_status === 0 &&
		current_match.score_status === 'normal' &&
		current_match.forward_loser === true;
}

function btp_match_clears_local_normal_result(current_match, bm) {
	if (!current_match || current_match.btp_needsync === true) {
		return false;
	}
	const remote = btp_result_signature_from_raw_match(bm);
	if (remote) {
		return false;
	}
	const remote_has_score = bm?.Sets?.[0]?.Set;
	if (Array.isArray(remote_has_score) && remote_has_score.length > 0) {
		return false;
	}
	const local_score_status = score_status_by_name_value(current_match.score_status, current_match.btp_score_status);
	if (local_score_status !== 0) {
		return false;
	}
	const has_local_score = Array.isArray(current_match.network_score) && current_match.network_score.length > 0;
	const is_local_finished =
		typeof current_match.team1_won === 'boolean' ||
		current_match.btp_winner != null ||
		current_match.end_ts != null ||
		current_match.setup?.state === 'finished';
	const is_local_live = current_match.setup?.now_on_court === true;
	return is_local_finished || (has_local_score && !is_local_live);
}

function push_auto_bye_winner_to_btp(btp_manager, app, match) {
	btp_manager.update_score(app, {
		...match,
		btp_winner_only_update: true,
		network_score: undefined,
		score_status_network_score: undefined,
		duration_ms: undefined,
		forward_loser: false,
	});
}

function find_hidden_empty_bye_branch_winner_candidates(btp_state, existing_matches = [], dependency_lookup = null) {
	const lookup = dependency_lookup || _build_btp_dependency_lookup(
		btp_state.links,
		btp_state.planning_nodes,
		btp_state.matches,
		existing_matches
	);
	const visible_match_keys = new Set((btp_state.matches || [])
		.filter(_is_integrated_btp_match_node)
		.map((match) => _btp_dependency_key(match.DrawID[0], match.PlanningID[0])));
	const candidate_keys = new Set();
	const candidates = [];

	for (const bm of (btp_state.planning_nodes || new Map()).values()) {
		if (!bm?.DrawID || !bm?.PlanningID || !bm?.ID) {
			continue;
		}
		const key = _btp_dependency_key(bm.DrawID[0], bm.PlanningID[0]);
		if (visible_match_keys.has(key) || candidate_keys.has(key)) {
			continue;
		}
		if (!_btp_match_is_empty_bye_branch(bm, lookup)) {
			continue;
		}
		if (!_btp_empty_bye_candidate_feeds_one_sided_match(bm, lookup)) {
			continue;
		}
		candidate_keys.add(key);
		candidates.push(bm);
	}

	return candidates;
}

function _btp_empty_bye_candidate_feeds_one_sided_match(candidate, dependency_lookup = null) {
	if (!candidate?.DrawID || !candidate?.PlanningID || !dependency_lookup) {
		return false;
	}
	const draw_id = candidate.DrawID[0];
	const planning_id = candidate.PlanningID[0];
	const candidates_to_scan = dependency_lookup.source_consumers_by_key
		? dependency_lookup.source_consumers_by_key.get(_btp_dependency_key(draw_id, planning_id)) || []
		: [
			...(dependency_lookup.raw_match_by_key?.values?.() || []),
			...(dependency_lookup.planning_node_by_key?.values?.() || []),
		];
	for (const node of candidates_to_scan) {
		if (!node || !node.DrawID || node.DrawID[0] != draw_id || !_btp_node_is_match_like(node)) {
			continue;
		}
		const is_source1 = node.From1 && node.From1[0] == planning_id;
		const is_source2 = node.From2 && node.From2[0] == planning_id;
		if (!is_source1 && !is_source2) {
			continue;
		}
		const team_sizes = Array.isArray(node.bts_players)
			? node.bts_players.map((team) => _btp_raw_team_has_players(team))
			: [];
		if (team_sizes.length < 2) {
			continue;
		}
		const other_side_has_players = is_source1 ? team_sizes[1] === true : team_sizes[0] === true;
		const candidate_side_empty = is_source1 ? team_sizes[0] !== true : team_sizes[1] !== true;
		if (other_side_has_players && candidate_side_empty) {
			return true;
		}
	}
	return false;
}

function compact_btp_node_debug(node) {
	if (!node) {
		return null;
	}
	const team_sizes = Array.isArray(node.bts_players)
		? node.bts_players.map((team) => Array.isArray(team)
			? team.filter((player) => player && player.ID && player.ID[0] != null).length
			: null)
		: undefined;
	const winner_size = Array.isArray(node.bts_winners)
		? node.bts_winners.filter((player) => player && player.ID && player.ID[0] != null).length
		: undefined;
	return {
		id: node.ID && node.ID[0],
		match_num: node.MatchNr && node.MatchNr[0],
		draw: node.DrawID && node.DrawID[0],
		planning: node.PlanningID && node.PlanningID[0],
		from1: node.From1 && node.From1[0],
		from2: node.From2 && node.From2[0],
		winner: node.Winner && node.Winner[0],
		is_match: node.IsMatch && node.IsMatch[0],
		is_playable: node.IsPlayable && node.IsPlayable[0],
		has_players: _btp_raw_match_has_players(node),
		team_sizes,
		winner_size,
	};
}

function btp_draw_event_debug(btp_state, draw_id) {
	const draw = btp_state?.draws?.get && btp_state.draws.get(draw_id);
	const event = draw?.EventID && btp_state?.events?.get && btp_state.events.get(draw.EventID[0]);
	return {
		draw_name: draw?.Name && draw.Name[0],
		event_name: event?.Name && event.Name[0],
	};
}

function log_hidden_empty_bye_scan(tkey, btp_state, dependency_lookup, candidates) {
	if (!require('./server_diagnostics').sync_timing_enabled(tkey)) {
		return;
	}
	const planning_nodes = Array.from((btp_state.planning_nodes || new Map()).values());
	const visible_match_keys = new Set((btp_state.matches || [])
		.filter(_is_integrated_btp_match_node)
		.map((match) => _btp_dependency_key(match.DrawID[0], match.PlanningID[0])));
	const candidate_keys = new Set(candidates
		.filter((match) => match?.DrawID && match?.PlanningID)
		.map((match) => _btp_dependency_key(match.DrawID[0], match.PlanningID[0])));
	const rejection_counts = {};
	const rejection_samples = [];
	for (const node of planning_nodes) {
		const explanation = explain_hidden_empty_bye_candidate_rejection(
			node,
			dependency_lookup,
			visible_match_keys,
			candidate_keys
		);
		rejection_counts[explanation.reason] = (rejection_counts[explanation.reason] || 0) + 1;
		if (
			explanation.reason !== 'candidate' &&
			rejection_samples.length < 20 &&
			_btp_node_is_match_like(node)
		) {
			rejection_samples.push({
				node: compact_btp_node_debug(node),
				...explanation,
			});
		}
	}
	const visible_empty_matches = (btp_state.matches || [])
		.filter((match) => match?.DrawID && match?.PlanningID && !_btp_raw_match_has_players(match))
		.slice(0, 10)
		.map((match) => {
			const draw_id = match.DrawID[0];
			const source1_key = _btp_dependency_key(draw_id, match.From1 && match.From1[0]);
			const source2_key = _btp_dependency_key(draw_id, match.From2 && match.From2[0]);
			return {
				...compact_btp_node_debug(match),
				source1: compact_btp_node_debug(dependency_lookup?.planning_node_by_key?.get(source1_key)),
				source2: compact_btp_node_debug(dependency_lookup?.planning_node_by_key?.get(source2_key)),
			};
		});
	const visible_empty_dependency_trees = (btp_state.matches || [])
		.filter((match) => match?.DrawID && match?.PlanningID && !_btp_raw_match_has_players(match))
		.filter((match) => {
			const match_num = Number(match.MatchNr && match.MatchNr[0]);
			const from1 = Number(match.From1 && match.From1[0]);
			const from2 = Number(match.From2 && match.From2[0]);
			const draw_id = match.DrawID && match.DrawID[0];
			const names = btp_draw_event_debug(btp_state, draw_id);
			return match_num === 28 ||
				from1 === 2009 ||
				from2 === 2010 ||
				names.draw_name === 'MD U13' ||
				names.event_name === 'MD U13';
		})
		.sort((a, b) => {
			const a_names = btp_draw_event_debug(btp_state, a.DrawID && a.DrawID[0]);
			const b_names = btp_draw_event_debug(btp_state, b.DrawID && b.DrawID[0]);
			const a_focus = a_names.draw_name === 'MD U13' || a_names.event_name === 'MD U13' ? 0 : 1;
			const b_focus = b_names.draw_name === 'MD U13' || b_names.event_name === 'MD U13' ? 0 : 1;
			if (a_focus !== b_focus) return a_focus - b_focus;
			return Number(a.DrawID && a.DrawID[0]) - Number(b.DrawID && b.DrawID[0]);
		})
		.slice(0, 40)
		.map((match) => {
			const draw_id = match.DrawID[0];
			return {
				target: compact_btp_node_debug(match),
				...btp_draw_event_debug(btp_state, draw_id),
				source1_tree: compact_btp_dependency_tree(draw_id, match.From1 && match.From1[0], dependency_lookup, 4),
				source2_tree: compact_btp_dependency_tree(draw_id, match.From2 && match.From2[0], dependency_lookup, 4),
				source1_trace: _btp_source_human_trace(draw_id, match.From1 && match.From1[0], dependency_lookup),
				source2_trace: _btp_source_human_trace(draw_id, match.From2 && match.From2[0], dependency_lookup),
			};
		});
	console.warn('[bts] btp_sync:hidden_empty_bye_scan ' + JSON.stringify({
		tournament_key: tkey,
		planning_nodes: planning_nodes.length,
		visible_matches: (btp_state.matches || []).length,
		hidden_match_like_nodes: planning_nodes.filter((node) => _btp_node_is_match_like(node)).length,
		candidate_count: candidates.length,
		candidates: candidates.slice(0, 20).map(compact_btp_node_debug),
		rejection_counts,
		rejection_samples,
		visible_empty_matches,
		visible_empty_dependency_trees,
	}));
}

function sync_hidden_empty_bye_branch_winners(btp_manager, app, tkey, btp_state, dependency_lookup, cached_candidates = null) {
	const pushed = [];

	const candidates = cached_candidates || find_hidden_empty_bye_branch_winner_candidates(btp_state, [], dependency_lookup);
	if (!cached_candidates) log_hidden_empty_bye_scan(tkey, btp_state, dependency_lookup, candidates);

	for (const bm of candidates) {
		const match = {
			tournament_key: tkey,
			btp_id: `${tkey}_hidden_${bm.ID[0]}`,
			// Winner-only updates still replace BTP's display position. Carry it
			// across just like ordinary imported games, including an explicit zero.
			match_order: bm.DisplayOrder?.[0] ?? 0,
			btp_match_ids: [{
				id: bm.ID[0],
				nr: bm.MatchNr && bm.MatchNr[0],
				draw: bm.DrawID[0],
				planning: bm.PlanningID[0],
			}],
			setup: {
				highlight: bm.Highlight ? bm.Highlight[0] : 0,
				teams: [{ players: [] }, { players: [] }],
			},
			team1_won: true,
			btp_winner: 1,
			score_status: 'normal',
			btp_score_status: 0,
		};
		push_auto_bye_winner_to_btp(btp_manager, app, match);
		pushed.push({
			id: bm.ID[0],
			match_num: bm.MatchNr && bm.MatchNr[0],
			draw: bm.DrawID[0],
			planning: bm.PlanningID[0],
		});
	}

	if (pushed.length > 0) {
		require('./server_diagnostics').log(app, tkey, '[bts] btp_sync:auto_empty_bye_hidden_winners', {
			tournament_key: tkey,
			count: pushed.length,
			matches: pushed.slice(0, 20),
		});
	}
	return pushed.length;
}

function mark_pending_btp_sync_confirmed(app, tkey, current_match, bm) {
	return new Promise((resolve, reject) => {
		if (!btp_match_confirms_pending_local_sync(current_match, bm)) {
			resolve(false);
			return;
		}
		app.db.matches.update(
			{ _id: current_match._id, tournament_key: tkey, btp_needsync: true },
			{ $set: { btp_needsync: false } },
			{},
			(err, numAffected) => {
				if (err) {
					reject(err);
					return;
				}
				if (numAffected === 1) {
					current_match.btp_needsync = false;
					resolve(true);
					return;
				}
				resolve(false);
			}
		);
	});
}

function build_match_update_operations(current_match, next_match) {
	const current_fields = build_match_update_fields(current_match);
	const next_fields = build_match_update_fields(next_match);
	const setObj = {};
	const unsetObj = {};

	function append_update_ops(current_value, next_value, path) {
		if (utils.deep_equal(current_value, next_value)) {
			return;
		}

		if (next_value === undefined) {
			unsetObj[path] = true;
			return;
		}

		if (current_value === undefined) {
			setObj[path] = next_value;
			return;
		}

		const current_is_array = Array.isArray(current_value);
		const next_is_array = Array.isArray(next_value);
		if (current_is_array || next_is_array) {
			if (!current_is_array || !next_is_array || current_value.length !== next_value.length) {
				setObj[path] = next_value;
				return;
			}
			for (let i = 0; i < next_value.length; i++) {
				append_update_ops(current_value[i], next_value[i], `${path}.${i}`);
			}
			return;
		}

		const current_is_object = current_value && typeof current_value === 'object';
		const next_is_object = next_value && typeof next_value === 'object';
		if (current_is_object && next_is_object) {
			const keys = new Set([...Object.keys(current_value), ...Object.keys(next_value)]);
			keys.forEach((key) => append_update_ops(current_value[key], next_value[key], `${path}.${key}`));
			return;
		}

		setObj[path] = next_value;
	}

	Object.keys(next_fields).forEach((key) => append_update_ops(current_fields[key], next_fields[key], key));

	const update = {};
	if (Object.keys(setObj).length > 0) {
		update.$set = setObj;
	}
	if (Object.keys(unsetObj).length > 0) {
		update.$unset = unsetObj;
	}
	return update;
}

function match_update_affects_now_on_court_state(update_ops) {
	const keys = [
		...Object.keys((update_ops && update_ops.$set) || {}),
		...Object.keys((update_ops && update_ops.$unset) || {}),
	];
	return keys.some((key) => (
		key === 'setup.now_on_court'
		|| key === 'setup.court_id'
		|| key === 'setup.called_timestamp'
		|| key === 'setup.tabletoperators'
		|| key.startsWith('setup.tabletoperators.')
		|| key.endsWith('.now_playing_on_court')
		|| key.endsWith('.now_tablet_on_court')
	));
}


function get_umpires(app, tkey) {
	return new Promise((resolve, reject) => {
		const querry = { 'tournament_key': tkey };
		app.db.umpires.find(querry).exec((err, umpires) => {
			if (err) {
				return reject(err);
			}
			return resolve(umpires);
		});
	});
}

function build_fallback_official(official_id, tkey) {
	return {
		_id: `${tkey}_btp_${official_id}`,
		tournament_key: tkey,
		btp_id: official_id,
		firstname: '',
		surname: '',
		name: `BTP Official ${official_id}`,
		country: '',
		status: 'ready'
	};
}

async function integrate_matches(app, tkey, btp_state, scoring_formats, location_map, court_map, callback, options = {}) {
	const admin = require('./admin'); // avoid dependency cycle
	const btp_manager = require('./btp_manager');
	const match_utils = require('./match_utils');
	const { draws, events, stages } = btp_state;

	const match_ids_on_court = calculate_match_ids_on_court(btp_state);

	let officials;
	let tournament;
	let existing_matches;
	let match_index_load_ms = 0;
	try {
		const index_load_start_ms = Date.now();
		[officials, tournament, existing_matches] = await Promise.all([
			get_umpires(app, tkey),
			app.db.tournaments.findOne_async({ key: tkey }),
			get_btp_match_index(app, tkey),
		]);
		match_index_load_ms = Date.now() - index_load_start_ms;
	} catch (err) {
		callback(err);
		return;
	}
	if (!tournament) {
		callback(new Error(`Tournament not found for key: ${tkey}`));
		return;
	}

	const matches_by_btp_id = new Map();
	const matches_by_id = new Map();
	function remember_match(match) {
		if (!match) {
			return;
		}
		if (match.btp_id) {
			matches_by_btp_id.set(match.btp_id, match);
		}
		if (match._id) {
			matches_by_id.set(match._id, match);
		}
	}
	(existing_matches || []).forEach(remember_match);
	const officials_by_btp_id = build_officials_by_btp_id(officials);
	const delta_start_ms = Date.now();
	let delta;
	try {
		delta = match_changes.select(app.db, tkey, {
			state: btp_state, tournament, scoring_formats, location_map, court_map,
			officials: officials_by_btp_id, on_court: match_ids_on_court,
			match_id: bm => calculate_btp_match_id(tkey, bm, draws, events),
		}, existing_matches);
	} catch (err) {
		callback(err);
		return;
	}
	const integration_callback = callback;
	callback = (err, result) => {
		delta.finish(err);
		if (result) result.selection = delta.timing;
		integration_callback(err, result);
	};
	const delta_ms = Date.now() - delta_start_ms;
	const dependency_lookup_start_ms = Date.now();
	const btp_dependency_lookup = delta.cached_dependencies
		? (delta.matches.length ? require('./btp_match_changes/dependencies').refresh(delta.cached_dependencies.lookup, btp_state, existing_matches)
			: delta.cached_dependencies.lookup)
		: _build_btp_dependency_lookup(
		btp_state.links,
		btp_state.planning_nodes,
		btp_state.matches,
		existing_matches
	);
	const dependency_lookup_ms = Date.now() - dependency_lookup_start_ms;
	const hidden_bye_scan_start_ms = Date.now();
	const hidden_candidates = delta.cached_dependencies?.hidden_candidates ||
		find_hidden_empty_bye_branch_winner_candidates(btp_state, [], btp_dependency_lookup);
	sync_hidden_empty_bye_branch_winners(btp_manager, app, tkey, btp_state, btp_dependency_lookup, hidden_candidates);
	if (!delta.cached_dependencies) log_hidden_empty_bye_scan(tkey, btp_state, btp_dependency_lookup, hidden_candidates);
	delta.remember_dependencies({ lookup: btp_dependency_lookup, hidden_candidates });
	const hidden_bye_scan_ms = Date.now() - hidden_bye_scan_start_ms;

	const matches_to_add = [];
	const matches_player_changed = [];
	const matches_on_court = [];
	const matches_incomplete = [];
	let now_on_court_state_changes = false;
	const match_timing = {
		...delta.timing,
		delta_ms,
		dependency_cache_hit: !!delta.cached_dependencies,
		processed: 0,
		updated: 0,
		signature_updated: 0,
		skipped_by_signature: 0,
		confirmed_pending_sync: 0,
		now_on_court_state_changes: 0,
		added: 0,
		unchanged: 0,
		index_load_ms: match_index_load_ms,
		dependency_lookup_ms,
		hidden_bye_scan_ms,
		signature_ms: 0,
		loop_ms: 0,
		post_adjust_ms: 0,
		cascade_scan_ms: 0,
		craft_ms: 0,
		equal_ms: 0,
		update_ops_ms: 0,
		cascade_ms: 0,
		update_samples: [],
	};
	const clubs = btp_state.clubs;
	const districts = btp_state.districts;
	let changes = false;
	function cascade_synced_no_match(match, cb) {
		if (!match || !['retired', 'disqualified', 'no_match'].includes(match.score_status)) {
			cb(null);
			return;
		}
		const cascade_start_ms = Date.now();
		admin.cascade_no_match_for_future_player_matches(app, tkey, match, (cascade_err, cascade_matches) => {
			match_timing.cascade_ms += Date.now() - cascade_start_ms;
			if (cascade_err) {
				cb(cascade_err);
				return;
			}
			if ((cascade_matches || []).length === 0) {
				cb(null);
				return;
			}
			changes = true;
			for (const cascade_match of cascade_matches) {
				remember_match(cascade_match);
				admin.notify_change(app, tkey, 'match_edit', {
					match__id: cascade_match._id,
					match: cascade_match
				});
				btp_manager.update_score(app, cascade_match);
			}
			admin.notify_cascaded_no_match_announcements(app, tkey, tournament, cascade_matches);
			cb(null);
		});
	}
	function rerun_pending_no_match_cascades(cb) {
		const cascade_scan_start_ms = Date.now();
		get_btp_no_match_cascade_sources(app, tkey).then((cascade_sources) => {
			match_timing.cascade_scan_ms += Date.now() - cascade_scan_start_ms;
			async.eachSeries(cascade_sources, cascade_synced_no_match, cb);
		}, (err) => {
			match_timing.cascade_scan_ms += Date.now() - cascade_scan_start_ms;
			cb(err);
		});
	}

	const match_loop_start_ms = Date.now();
	async.eachLimit(delta.matches, 25, function (bm, cb) {
		const draw = draws.get(bm.DrawID[0]);
		assert(draw);

		const event = events.get(draw.EventID[0]);
		assert(event);

		const stage = stages.get(draw.StageID[0]);
		assert(stage);

		const btp_id = calculate_btp_match_id(tkey, bm, draws, events);

		if (!integrated_btp_match(bm)) {
			cb(null);
			return;
		}
		const cur_match = matches_by_btp_id.get(btp_id) || null;
		if (cur_match && cur_match.btp_needsync) {
			get_current_match_for_btp_sync(app, tkey, matches_by_id.get(cur_match._id) || cur_match)
				.then((current_match) => mark_pending_btp_sync_confirmed(app, tkey, current_match, bm))
				.then((confirmed) => {
					if (confirmed) {
						match_timing.confirmed_pending_sync++;
					}
					cb(null);
				}, cb);
			return;
		}

		const signature_start_ms = Date.now();
		const btp_sync_signature = build_btp_match_sync_signature({
			bm,
			event,
			stage,
			draw,
			scoring_formats,
			location_map,
			court_map,
			match_ids_on_court,
			tournament,
			officials_by_btp_id,
			btp_dependency_lookup,
			source_signature: delta.sources.get(btp_id).content_signature,
			dependency_labels: [0, 1].map(index => bm.bts_players?.[index]?.length ? null :
				_resolve_btp_dependency_link(bm.DrawID[0], index === 0 ? bm.From1?.[0] : bm.From2?.[0],
					bm.PlanningID?.[0], btp_state.links, btp_state.planning_nodes, new Set(), btp_dependency_lookup)),
		});
		match_timing.signature_ms += Date.now() - signature_start_ms;
		if (
			cur_match &&
			cur_match._btp_sync_signature === btp_sync_signature &&
			!btp_match_clears_local_special_result(cur_match, bm) &&
			!btp_match_clears_local_normal_result(cur_match, bm) &&
			!btp_match_needs_local_status_cleanup(cur_match, bm)
		) {
			match_timing.processed++;
			match_timing.unchanged++;
			match_timing.skipped_by_signature++;
			cb(null);
			return;
		}

		const craft_start_ms = Date.now();
		craft_match(app, tkey, btp_id, location_map, court_map, event, stage, scoring_formats, draw, btp_state.links, btp_state.planning_nodes, officials_by_btp_id, clubs, districts, bm, match_ids_on_court, undefined, undefined, tournament, btp_dependency_lookup).then(async match => {
				match_timing.processed++;
				match_timing.craft_ms += Date.now() - craft_start_ms;
				match._btp_sync_signature = btp_sync_signature;

				
				match.setup.state = 'unscheduled';
				if (typeof match.team1_won === 'boolean' || match.btp_winner || match.btp_needsync || match.score_status === 'no_match') {
					match.setup.state = 'finished';
					match.setup.now_on_court = false;
				} else if (match.setup.now_on_court === true) {
					match.setup.state = 'oncourt';
					matches_on_court.push(match);
				} 
				else if (match.setup.incomplete == true) {
					match.setup.state = 'incomplete';
					matches_incomplete.push(match);
				}
				else if (match.setup.scheduled_date && match.setup.scheduled_time_str) {
					match.setup.state = 'scheduled';
				}

			if (cur_match) {
						const current_match = await get_current_match_for_btp_sync(app, tkey, matches_by_id.get(cur_match._id) || cur_match);
						if (!current_match) {
							changes = true;
							match_timing.added++;
							matches_to_add.push(match);
							cb(null);
							return;
						}

						const btp_clears_local_special_result = btp_match_clears_local_special_result(current_match, bm);
						const btp_clears_local_normal_result = btp_match_clears_local_normal_result(current_match, bm);
						const btp_setup_state = match.setup.state;
						const btp_now_on_court = match.setup.now_on_court;
						const btp_court_id = match.setup.court_id;
						const auto_bye_winner_sync = match._btp_auto_bye_winner_sync === true;
						match = mergeLocalMatchIntoBtpMatch(current_match, match);
						if (auto_bye_winner_sync) {
							match.team1_won = true;
							match.btp_winner = 1;
							match.btp_needsync = true;
							match.score_status = 'normal';
							match.btp_score_status = 0;
							match.setup.state = 'finished';
							match.setup.now_on_court = false;
							match._btp_auto_bye_winner_sync = true;
							delete match.network_score;
							delete match.score_status_network_score;
							delete match.no_match_losing_team;
							delete match.forward_loser;
						}
						if (btp_clears_local_special_result) {
							match.score_status = normalize_btp_score_status(bm.ScoreStatus ? Number(bm.ScoreStatus[0]) : 0);
							match.btp_score_status = bm.ScoreStatus ? Number(bm.ScoreStatus[0]) : 0;
							match.forward_loser =
								['retired', 'disqualified', 'no_match'].includes(match.score_status) &&
								(bm.ForwardLoser ? parse_btp_bool(bm.ForwardLoser[0]) : false);
							delete match.no_match_losing_team;
							delete match.score_status_network_score;
							match.setup.state = btp_setup_state;
							match.setup.now_on_court = btp_now_on_court;
							delete match.setup.called_timestamp;
							delete match.setup.preparation_call_timestamp;
							delete match.setup.preparation_call_deferred;
						}
						if (btp_clears_local_normal_result) {
							match.score_status = normalize_btp_score_status(bm.ScoreStatus ? Number(bm.ScoreStatus[0]) : 0);
							match.btp_score_status = bm.ScoreStatus ? Number(bm.ScoreStatus[0]) : 0;
							match.forward_loser = false;
							match.btp_needsync = false;
							delete match.no_match_losing_team;
							delete match.score_status_network_score;
							delete match.network_score;
							delete match.team1_won;
							delete match.btp_winner;
							delete match.presses;
							delete match.duration_ms;
							delete match.end_ts;
							delete match.tabletoperator_finish_ts;
							match.setup.state = btp_setup_state;
							match.setup.now_on_court = btp_now_on_court;
							if (btp_court_id) {
								match.setup.court_id = btp_court_id;
							} else {
								delete match.setup.court_id;
							}
							delete match.setup.called_timestamp;
							delete match.setup.preparation_call_timestamp;
							delete match.setup.preparation_call_deferred;
						}

						for (const current_team of (current_match.setup.teams || [])) {
							for (const current_player of (current_team.players || [])) {
								if (!current_player?.btp_id) {
									continue;
								}
								const next_player = find_setup_player_by_btp_id(match.setup, current_player.btp_id);
								if (!next_player || (!current_player.last_time_on_court_ts && !next_player.last_time_on_court_ts)) {
									continue;
								}
								const current_ts = current_player.last_time_on_court_ts || 0;
								const next_ts = next_player.last_time_on_court_ts || 0;
								const max_ts = Math.max(current_ts, next_ts);
								current_player.last_time_on_court_ts = max_ts;
								next_player.last_time_on_court_ts = max_ts;

							}
						}

						if (!btp_clears_local_normal_result) {
							if (!auto_bye_winner_sync) {
								match.btp_needsync = current_match.btp_needsync;
							}
							match.network_team1_left = current_match.network_team1_left;
							match.network_team1_serving = current_match.network_team1_serving;
							match.network_teams_player1_even = current_match.network_teams_player1_even;
							match.presses = current_match.presses;
							match.duration_ms = current_match.duration_ms;
							match.end_ts = current_match.end_ts;
							match.tabletoperator_finish_ts = current_match.tabletoperator_finish_ts;
						}

						if (match.setup.now_on_court === false && !btp_clears_local_normal_result) {
							if (current_match.setup.warmup) {
								match.setup.warmup = current_match.setup.warmup;
							}

							if (current_match.setup.warmup_ready) {
								match.setup.warmup_ready = current_match.setup.warmup_ready;
							}

							if (current_match.setup.warmup_start) {
								match.setup.warmup_start = current_match.setup.warmup_start;
							}
						}

						for (const current_team of (current_match.setup.teams || [])) {
							for (const current_player of (current_team.players || [])) {
								if (!current_player?.btp_id || !('tablet_break_active' in current_player)) {
									continue;
								}
								const next_player = find_setup_player_by_btp_id(match.setup, current_player.btp_id);
								if (next_player) {
									next_player.tablet_break_active = current_player.tablet_break_active;
								}
							}
						}

						const equal_start_ms = Date.now();
						const same_match = utils.plucked_deep_equal(match, current_match, Object.keys(match), true);
						match_timing.equal_ms += Date.now() - equal_start_ms;
						if (same_match) {
							match_timing.unchanged++;
							cb(null);
							return;
						}

							let only_change_check_in = false;
							let result_enterd_in_btp = false;
							let match_player_changed = false;
							const current_match_for_check_in_compare = JSON.parse(JSON.stringify(current_match));

							match_player_changed = setup_player_assignment_changed(current_match.setup, match.setup);
							copy_checked_in_by_btp_id(current_match_for_check_in_compare.setup, match.setup);

							if (typeof current_match.team1_won !== 'boolean' && typeof match.team1_won === 'boolean') {
							if (!match.end_ts) {
								result_enterd_in_btp = true;
								match.setup.warmup = 'none';
								match.end_ts = now_ms(app);
							}
						}

						const check_in_equal_start_ms = Date.now();
						if (utils.plucked_deep_equal(match, current_match_for_check_in_compare, Object.keys(match), true)) {
							only_change_check_in = true;
						}
						match_timing.equal_ms += Date.now() - check_in_equal_start_ms;

						if(match_player_changed) {
							if (player_assignment_change_affects_now_on_court_state(current_match, match)) {
								now_on_court_state_changes = true;
								match_timing.now_on_court_state_changes++;
							}
							matches_player_changed.push(match);
						}

						const update_ops_start_ms = Date.now();
						const update_ops = build_match_update_operations(current_match, match);
						match_timing.update_ops_ms += Date.now() - update_ops_start_ms;
						if (Object.keys(update_ops).length === 0) {
							match_timing.unchanged++;
							cb(null);
							return;
						}
						if (match_timing.update_samples.length < 10) {
							match_timing.update_samples.push({
								id: current_match._id,
								btp_id: current_match.btp_id,
								set: Object.keys(update_ops.$set || {}),
								unset: Object.keys(update_ops.$unset || {}),
							});
						}
						const set_keys = Object.keys(update_ops.$set || {});
						const unset_keys = Object.keys(update_ops.$unset || {});
						const signature_only_update = set_keys.length === 1 && set_keys[0] === '_btp_sync_signature' && unset_keys.length === 0;
						if (match_update_affects_now_on_court_state(update_ops)) {
							now_on_court_state_changes = true;
							match_timing.now_on_court_state_changes++;
						}
						delete match._btp_auto_bye_winner_sync;

						app.db.matches.update({ _id: current_match._id }, update_ops, {}, async (err) => {
							if (err) {
								cb(err);
								return;
							}
							if (result_enterd_in_btp && tournament.tabletoperator_enabled) {
								try {
									// Cleanup must see the committed winner, end time and teams.
									await require('./match_utils').reset_player_tabletoperator(app, tkey, match._id, match.end_ts);
									match = await get_current_match_for_btp_sync(app, tkey, match);
								} catch (cleanup_error) { return cb(cleanup_error); }
							}
							remember_match(match);
							delta.remember_local(match);
							if (signature_only_update) {
								match_timing.signature_updated++;
								cb(null);
								return;
							}
							match_timing.updated++;

							if (match.setup.is_match) {
								if (!only_change_check_in || result_enterd_in_btp) {
									changes = true;
									admin.notify_change(app, match.tournament_key, 'match_edit', {
										match__id: match._id,
										match: match
									});
								} else {
									admin.notify_change(app, match.tournament_key, 'update_player_status', {
										match__id: match._id,
										btp_winner: match.btp_winner,
										setup: match.setup
									});
								}
							}
							if (auto_bye_winner_sync) {
								push_auto_bye_winner_to_btp(btp_manager, app, match);
							}
							if (btp_clears_local_special_result) {
								admin.clear_no_match_cascade_for_source_match(app, tkey, current_match, (clear_err, cleared_matches) => {
									if (clear_err) {
										cb(clear_err);
										return;
									}
									if ((cleared_matches || []).length > 0) {
										changes = true;
										for (const cleared_match of cleared_matches) {
											remember_match(cleared_match);
											admin.notify_change(app, tkey, 'match_edit', {
												match__id: cleared_match._id,
												match: cleared_match,
											});
											btp_manager.update_score(app, cleared_match);
										}
									}
									cb(null);
								});
								return;
							}
							cb(null);
						});
					return;
				}
				changes = true;
				match_timing.added++;
				if (match.setup?.now_on_court === true || (Array.isArray(match.setup?.tabletoperators) && match.setup.tabletoperators.length > 0)) {
					now_on_court_state_changes = true;
					match_timing.now_on_court_state_changes++;
				}
				matches_to_add.push(match);
				cb(null);
				return;
			}).catch(cb);
	}, (error) => {
		match_timing.loop_ms = Date.now() - match_loop_start_ms;
		if (error) {
			callback(error);
			return;
		}

		const post_adjust_start_ms = Date.now();
		const finish_player_state_adjustments = (finish_cb) => {
			if (matches_player_changed.length === 0 && matches_to_add.length === 0) {
				finish_cb(null);
				return;
			}
			if (matches_on_court.length > 0) {
				finish_cb(null);
				return;
			}
			get_now_on_court_matches(app, tkey).then((on_court_matches) => {
				matches_on_court.push(...(on_court_matches || []));
				finish_cb(null);
			}, finish_cb);
		};

		finish_player_state_adjustments((adjustment_err) => {
			match_timing.post_adjust_ms += Date.now() - post_adjust_start_ms;
			if (adjustment_err) {
				callback(adjustment_err);
				return;
			}

			const apply_on_court_player_state = async (match) => {
				for (const match_on_court of matches_on_court) {
					const changed_match_on_court = await match_utils.calc_match_set_player_on_court(match, match_on_court.setup, match_on_court._id);
					if(changed_match_on_court != null) {
						match = changed_match_on_court;
					}
					const changed_match_tablet_operator = await match_utils.calc_match_set_player_on_tablet(match, match_on_court.setup);
					if(changed_match_tablet_operator != null) {
						match = changed_match_tablet_operator;
					}
				}
				return match;
			};

			async.eachSeries(matches_player_changed, (match_player_changed, player_changed_cb) => {
				apply_on_court_player_state(match_player_changed).then(() => player_changed_cb(), player_changed_cb);
			}, (player_changed_err) => {
				if (player_changed_err) {
					callback(player_changed_err);
					return;
				}

			async.eachSeries(matches_to_add, (match_to_add, add_cb) => {
				apply_on_court_player_state(match_to_add).then(async (match) => {
					if (options.expected_reset_ts !== undefined) {
						const insert_sync_state = await btp_sync_state(app, tkey, options.expected_reset_ts);
						if (!insert_sync_state.ok) {
							log_btp_sync_skipped(tkey, insert_sync_state.reason);
							return null;
						}
					}
					return match;
				}).then((match) => {
					if (!match) {
						add_cb(null);
						return;
					}
					if(match.setup.now_on_court && !match.setup.called_timestamp) {
						match.setup.called_timestamp = now_ms(app);
					}
					const auto_bye_winner_sync = match._btp_auto_bye_winner_sync === true;
					delete match._btp_auto_bye_winner_sync;

					app.db.matches.insert(match, function(err) {
						if (err) {
							add_cb(err);
							return;
						}
						remember_match(match);
						admin.notify_change(app, tkey, 'match_add', { match });
						if (auto_bye_winner_sync) {
							push_auto_bye_winner_to_btp(btp_manager, app, match);
						}
						add_cb(null);
					});
				}, add_cb);
			}, (add_err) => {
				if (add_err) {
					callback(add_err);
					return;
				}
			if(changes){
				const notify_incomplete = function() {
					matches_incomplete.forEach(match => {
						admin.notify_change(app, match.tournament_key, 'match_edit', {
							match__id: match._id,
							match: match
						});
					});
				};
				if (app._btp_sync_effects) notify_incomplete();
				else setTimeout(notify_incomplete, 500);
			};

			if (!changes && match_timing.updated === 0 && match_timing.added === 0) {
				log_btp_sync_timing(tkey, 'integrate_matches_detail', 0, match_timing);
				callback(null, {
					changes,
					updated: match_timing.updated,
					added: match_timing.added,
					now_on_court_state_changes,
				});
				return;
			}

			rerun_pending_no_match_cascades((cascade_err) => {
				log_btp_sync_timing(tkey, 'integrate_matches_detail', 0, match_timing);
				callback(cascade_err, {
					changes,
					updated: match_timing.updated,
					added: match_timing.added,
					now_on_court_state_changes,
				});
			});
			});
			});
		});
		});
	}

// Normalization runs in the isolated sync plan (or under its caller's locks).
// Cached fingerprints skip unchanged inputs before any setup snapshot is copied.
const normalization_cache = new WeakMap();
const normalization_match_projection = {
	_id: 1,
	end_ts: 1,
	team1_won: 1,
	btp_winner: 1,
	btp_needsync: 1,
	setup: 1,
};

async function load_normalization_state(app, tkey) {
	if (app.db.model?.normalization_state) return app.db.model.normalization_state(tkey, true);
	const [tournament, matches, umpires] = await Promise.all([
		app.db.tournaments.findOne_async({ key: tkey }, { btp_settings: 1, last_reset_ts: 1 }),
		app.db.matches.find_async({ tournament_key: tkey }, normalization_match_projection),
		app.db.umpires.find_async({ tournament_key: tkey }),
	]);
	return { tournament, matches, umpires };
}

function normalization_state_signature(snapshot) {
	return normalization_fingerprints.snapshot_signature(snapshot);
}

function read_normalization_state(app, tkey, collection, snapshot, callback) {
	if (snapshot) {
		return callback(null, snapshot[collection === 'tournaments' ? 'tournament' : collection]);
	}
	if (collection === 'tournaments') {
		return app.db.tournaments.findOne({ key: tkey }, callback);
	}
	return app.db[collection].find({ tournament_key: tkey }, callback);
}

async function normalize_sync_state(app, tkey) {
	let cache = normalization_cache.get(app);
	if (!cache) {
		cache = new Map();
		normalization_cache.set(app, cache);
	}
	const tasks = [
		['normalize_match_player_pause_state', normalize_match_player_pause_state],
		['reconcile_match_officials', reconcile_match_officials],
		['normalize_official_visibility', normalize_official_visibility],
	];
	const skip = () => {
		tasks.forEach(([phase]) => log_btp_sync_timing(tkey, phase, 0, { skipped: true }));
		return { skipped: true };
	};
	if (app.db.model?.normalization_state) {
		const guard_start_ms = Date.now();
		const state = await app.db.model.normalization_state(tkey);
		const skipped = cache.get(tkey) === state.signature;
		log_btp_sync_timing(tkey, 'normalization_fingerprint_check', Date.now() - guard_start_ms, { skipped });
		if (skipped) return skip();
	}
	const load_start_ms = Date.now();
	const snapshot = await load_normalization_state(app, tkey);
	log_btp_sync_timing(tkey, 'load_normalization_state', Date.now() - load_start_ms);
	const signature = snapshot.signature || normalization_state_signature(snapshot);
	if (cache.get(tkey) === signature) return skip();
	// A failed or partial pass must never authorize skipping a later retry.
	cache.delete(tkey);
	let changed = false;
	for (const [phase, normalize] of tasks) {
		const phase_start_ms = Date.now();
		const phase_changed = await new Promise((resolve, reject) => {
			normalize(app, tkey, (err, did_change) => err ? reject(err) : resolve(did_change), snapshot);
		});
		log_btp_sync_timing(tkey, phase, Date.now() - phase_start_ms);
		changed = changed || phase_changed;
	}
	// Cache only the snapshot actually processed, including this pass's writes.
	// A fresh live signature could absorb a concurrent change we did not process.
	const final_signature = changed ? normalization_state_signature(snapshot) : signature;
	cache.set(tkey, final_signature);
	return { skipped: false, changed: !!changed };
}

function reconcile_match_officials(app, tkey, callback, snapshot = null) {
	const admin = require('./admin');
	const stournament = require('./stournament');

	read_normalization_state(app, tkey, 'tournaments', snapshot, (tournamentErr, tournament) => {
		if (tournamentErr) {
			return callback(tournamentErr);
		}
	read_normalization_state(app, tkey, 'matches', snapshot, (err, matches) => {
		if (err) {
			return callback(err);
		}

		read_normalization_state(app, tkey, 'umpires', snapshot, (err2, umpires) => {
			if (err2) {
				return callback(err2);
			}

			const byId = new Map();
			const byBtpId = new Map();
			umpires.forEach((umpire) => {
				byId.set(umpire._id, umpire);
				if (umpire.btp_id != null) {
					byBtpId.set(String(umpire.btp_id), umpire);
				}
			});

			const refs = [];
			matches.forEach((match) => {
				const setup = match.setup || {};
				if (setup.umpire) {
					refs.push({ official: setup.umpire, role: 'umpire', match });
				}
				if (setup.service_judge) {
					refs.push({ official: setup.service_judge, role: 'service_judge', match });
				}
			});

			let changed = false;

			async.eachSeries(refs, ({ official, role, match }, cb) => {
				const existing =
					(official._id && byId.get(official._id)) ||
					(official.btp_id != null && byBtpId.get(String(official.btp_id))) ||
					null;

				const is_on_court = match.setup && match.setup.now_on_court === true;
				const is_finished = typeof match.team1_won === 'boolean' || match.btp_winner || match.btp_needsync || match.setup?.state === 'finished';
				const planned_key = role === 'umpire' ? 'is_planed_as_umpire' : 'is_planed_as_service_judge';
				const on_court_key = role === 'umpire' ? 'umpire_on_court' : 'service_judge_on_court';
				const safe_name = official.name || [official.firstname, official.surname].filter(Boolean).join(' ').trim();

				if (!existing) {
					const new_official = {
						_id: official._id || (official.btp_id != null ? `${tkey}_btp_${official.btp_id}` : `${tkey}_${role}_${match._id}`),
						tournament_key: tkey,
						btp_id: official.btp_id,
						firstname: official.firstname || '',
						surname: official.surname || '',
						name: safe_name,
						country: official.country || '',
						status: 'ready',
						is_umpire: role === 'umpire',
						is_service_judge: role === 'service_judge',
						is_planed_as_umpire: role === 'umpire' && !is_on_court && !is_finished,
						is_planed_as_service_judge: role === 'service_judge' && !is_on_court && !is_finished,
						umpire_on_court: role === 'umpire' && is_on_court ? (match.setup.court_id || true) : null,
						service_judge_on_court: role === 'service_judge' && is_on_court ? (match.setup.court_id || true) : null,
						umpire_wait: null,
						service_judge_wait: null,
						umpire_pause: null,
						service_judge_pause: null,
						inactive_list: null,
						checked_in: match_utils.get_effective_technical_official_checked_in({
							umpire_pause: null,
							service_judge_pause: null,
							umpire_manual_pause: null,
							service_judge_manual_pause: null,
							inactive_list: null,
						}, tournament)
					};
					changed = true;
					app.db.umpires.insert(new_official, (insertErr, inserted) => {
						if (insertErr) {
							return cb(insertErr);
						}
						byId.set(inserted._id, inserted);
						if (inserted.btp_id != null) {
							byBtpId.set(String(inserted.btp_id), inserted);
						}
						admin.notify_change(app, tkey, 'umpire_add', { umpire: inserted });
						return cb();
					});
					return;
				}

				const setObj = {};
				if ((existing.name || '') !== safe_name) setObj.name = safe_name;
				if ((existing.firstname || '') !== (official.firstname || '')) setObj.firstname = official.firstname || '';
				if ((existing.surname || '') !== (official.surname || '')) setObj.surname = official.surname || '';
				if ((existing.country || '') !== (official.country || '')) setObj.country = official.country || '';
				if (official.btp_id != null && existing.btp_id !== official.btp_id) setObj.btp_id = official.btp_id;

				if (!is_finished) {
					if (!is_on_court && existing[planned_key] !== true) {
						setObj[planned_key] = true;
					}
					if (is_on_court && existing[on_court_key] == null) {
						setObj[on_court_key] = match.setup.court_id || true;
					}
					if (existing.umpire_wait != null) {
						setObj.umpire_wait = null;
					}
					if (existing.service_judge_wait != null) {
						setObj.service_judge_wait = null;
					}
					if (existing.umpire_pause != null) {
						setObj.umpire_pause = null;
					}
					if (existing.service_judge_pause != null) {
						setObj.service_judge_pause = null;
					}
					if (existing.inactive_list != null) {
						setObj.inactive_list = null;
					}
				}

				const next_checked_in = match_utils.get_effective_technical_official_checked_in({ ...existing, ...setObj }, tournament);
				if (!!existing.checked_in !== next_checked_in) {
					setObj.checked_in = next_checked_in;
				}

				if (Object.keys(setObj).length === 0) {
					return cb();
				}

				changed = true;
				app.db.umpires.update(
					{ _id: existing._id },
					{ $set: setObj },
					{ returnUpdatedDocs: true },
					(updateErr, numAffected, updated) => {
						if (updateErr) {
							return cb(updateErr);
						}
						byId.set(updated._id, updated);
						if (updated.btp_id != null) {
							byBtpId.set(String(updated.btp_id), updated);
						}
						admin.notify_change(app, tkey, 'umpire_updated', updated);
						return cb();
					}
				);
			}, (seriesErr) => {
				if (seriesErr || !changed) {
					return callback(seriesErr, changed);
				}
				if (snapshot) {
					// Include newly inserted officials and the returned update documents.
					snapshot.umpires = Array.from(byId.values());
				}
				stournament.get_umpires(app.db, tkey, (allErr, all_umpires) => {
					if (!allErr) {
						admin.notify_change(app, tkey, 'umpires_changed', { all_umpires });
					}
					return callback(allErr, changed);
				});
			});
		});
	});
	});
}

function generateHallAbbreviation(name) {
	const wordRegex = /([A-Za-zÄÖÜäöüß0-9]+)([\s\-]*)/g;
	let match;
	let abbreviation = '';
	let parts = [];
	let foundAcronym = false;

	// Zerlege in Wortteile + Trennzeichen
	while ((match = wordRegex.exec(name)) !== null) {
		parts.push({
			word: match[1],
			sep: match[2] || ''
		});
	}

	let i = 0;
	while (i < parts.length) {
		const { word, sep } = parts[i];

		// Zahlen mit optionalem Buchstaben (z.B. "12A")
		if (/^\d+[A-Z]?$/.test(word)) {
			abbreviation += sep + word;

			// Sonderregel: nächstes Wort beginnt mit Großbuchstabe → ersten Buchstaben übernehmen
			if (i + 1 < parts.length && /^[A-ZÄÖÜ]/.test(parts[i + 1].word)) {
				const next = parts[i + 1];
				abbreviation += next.sep + next.word[0].toUpperCase();
				i++; // zusätzliches Wort verarbeitet
			}

			i++;
			continue;
		}

		// Großbuchstaben-Akronym
		if (!foundAcronym && /^[A-ZÄÖÜ]{2,}$/.test(word)) {
			abbreviation += word;

			if (i + 1 < parts.length) {
				abbreviation += sep + parts[i + 1].word[0].toUpperCase();
			} else {
				abbreviation += sep;
			}
			foundAcronym = true;
			i += 2;
			continue;
		}

		// Standard: erster Buchstabe
		if (!foundAcronym) {
			abbreviation += word[0].toUpperCase() + sep;
		}

		i++;
	}

	// Kein Akronym → Leerzeichen & Endpunkt entfernen
	if (!foundAcronym) {
		abbreviation = abbreviation.replace(/\s+/g, '');
		abbreviation = abbreviation.replace(/\.+$/, '');
	}

	return abbreviation.trim();
}

function integrate_locations(app, tournament_key, btp_state, scoring_formats, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const stournament = require('./stournament'); // avoid dependency cycle

	const locations = Array.from(btp_state.locations.values());
	const res = new Map();
	var changed = false;

	async.eachSeries(locations, (l, cb) => {
		const btp_id = l.ID[0];
		const name = l.Name[0];
		const address = (l.Address1 ? l.Address1[0] : "");
		const postal_code = (l.PostalCode ? l.PostalCode[0] : "");
		const city = (l.City ? l.City[0] : "");
		const state = (l.State ? l.State[0] : "");
		const country = (l.Country ? l.Country[0] : "");
		const preparation_addition = "";
		const meetingpoint_announcement = "";
		const short_name = generateHallAbbreviation(name);

		const query = {
			tournament_key,
			btp_id,
			name,
			address,
			postal_code,
			city,
			state,
			country,
			short_name
		};

		app.db.locations.findOne(query, (err, cur_location) => {
			if (err) return cb(err);
			if (cur_location) {
				res.set(btp_id, cur_location._id);
				return cb();
			}

			const alt_query = {
				tournament_key,
				btp_id,
			};

			app.db.locations.findOne(alt_query, async (err, cur_location) => {
				if (err) return cb(err);

				if (cur_location) {

					//ADD BTP ID
					res.set(btp_id, cur_location._id);
					changed = true;
					app.db.locations.update(alt_query, { $set: { btp_id, name, address, postal_code, city, state, country, short_name} }, {}, (err) => cb(err));
					return;
				}

				const highlights = [0, 1, 2, 3, 4, 5, 6];
				let highlight = null;

				for (let i = highlights.length - 1; i >= 0; i--) {
					const test = await app.db.locations.findOne_async({ tournament_key, highlight: highlights[i] });

					if (!test) {
						highlight = highlights[i];
						break;
					}
				}

				const location = {
					_id: tournament_key + '_' + btp_id,
					tournament_key,
					btp_id,
					name,
					address,
					postal_code,
					city,
					state,
					country,
					preparation_addition,
					meetingpoint_announcement,
					short_name,
					highlight,
				};

				res.set(btp_id, location._id);

				changed = true;
				app.db.locations.insert(location, (err) => cb(err));
			});
		}); 

	}, (err) => {
		if (err) {
			return callback(err);
		}

		if (changed) {
			stournament.get_locations(app.db, tournament_key, function (err, all_locations) {
				admin.notify_change(app, tournament_key, 'locations_changed', { all_locations });
				callback(err, scoring_formats, res);
			});
		} else {
			callback(err, scoring_formats, res);
		}
	});
}




function unwrap_btp_value(value) {
	return Array.isArray(value) ? value[0] : value;
}

function parse_btp_court_num(court) {
	if (court?.bts_num != null) {
		return court.bts_num;
	}
	const btp_id = Number(unwrap_btp_value(court?.ID));
	const name = String(unwrap_btp_value(court?.Name) || '').trim();
	const exact_num = name.match(/^[0-9]+$/);
	if (exact_num) {
		return parseInt(exact_num[0], 10);
	}
	const labelled_num = name.match(/^(?:court|feld|field)\s*([0-9]+)$/i);
	if (labelled_num) {
		return parseInt(labelled_num[1], 10);
	}
	const nums_in_name = name.match(/[0-9]+/g);
	if (nums_in_name && nums_in_name.length === 1) {
		return parseInt(nums_in_name[0], 10);
	}
	const sort_order = Number(unwrap_btp_value(court?.SortOrder));
	if (Number.isFinite(sort_order) && sort_order > 0) {
		return sort_order;
	}
	return Number.isFinite(btp_id) && btp_id > 0 ? btp_id : null;
}

function assign_btp_court_nums(courts) {
	const location_counts = new Map();
	courts.forEach((court) => {
		const location_id = unwrap_btp_value(court?.LocationID);
		location_counts.set(location_id, (location_counts.get(location_id) || 0) + 1);
	});

	const raw_nums = new Map();
	const courts_by_num = new Map();
	courts.forEach((court) => {
		const num = parse_btp_court_num(court);
		raw_nums.set(court, num);
		if (!courts_by_num.has(num)) {
			courts_by_num.set(num, []);
		}
		courts_by_num.get(num).push(court);
	});

	const used_nums = new Set();
	const duplicate_courts = [];
	for (const [num, group] of courts_by_num.entries()) {
		if (group.length === 1) {
			group[0].bts_num = num;
			used_nums.add(num);
			continue;
		}
		group.sort((a, b) => {
			const a_location = unwrap_btp_value(a?.LocationID);
			const b_location = unwrap_btp_value(b?.LocationID);
			const count_diff = (location_counts.get(b_location) || 0) - (location_counts.get(a_location) || 0);
			if (count_diff !== 0) {
				return count_diff;
			}
			return Number(unwrap_btp_value(a?.ID)) - Number(unwrap_btp_value(b?.ID));
		});
		group[0].bts_num = num;
		used_nums.add(num);
		duplicate_courts.push(...group.slice(1));
	}

	let next_num = Math.max(0, ...Array.from(used_nums).filter((num) => Number.isFinite(num))) + 1;
	duplicate_courts.forEach((court) => {
		while (used_nums.has(next_num)) {
			next_num++;
		}
		court.bts_num = next_num;
		used_nums.add(next_num);
	});
}

function build_court_from_btp(tournament_key, btp_id, num, name, location_id, existing_court) {
	return {
		...(existing_court || {}),
		_id: tournament_key + '_' + num,
		tournament_key,
		btp_id,
		num,
		name,
		location_id,
		is_active: existing_court && existing_court.is_active !== undefined ? existing_court.is_active : true,
		has_umpire: existing_court && existing_court.has_umpire !== undefined ? existing_court.has_umpire : true,
		has_service_judge: existing_court && existing_court.has_service_judge !== undefined ? existing_court.has_service_judge : true,
	};
}

function upsert_btp_court(app, tournament_key, court, cb) {
	const btp_id = unwrap_btp_value(court.ID);
	const name = String(unwrap_btp_value(court.Name) || '');
	const btp_location_id = unwrap_btp_value(court.LocationID);
	const num = parse_btp_court_num(court);
	const location_id = court.location_id;
	const court_id = tournament_key + '_' + num;
	const target_query = { tournament_key, _id: court_id };
	const btp_query = { tournament_key, btp_id };
	const desired = (existing_court) => build_court_from_btp(tournament_key, btp_id, num, name, location_id, existing_court);

	if (!num) {
		return cb(new Error('Could not determine court number for BTP court ' + JSON.stringify({ btp_id, name, btp_location_id })));
	}

	app.db.courts.findOne(target_query, (err, target_court) => {
		if (err) return cb(err);
		if (target_court) {
			const update = desired(target_court);
			delete update._id;
			app.db.courts.update(target_query, { $set: update }, {}, (err) => {
				if (err) return cb(err);
				app.db.courts.findOne(btp_query, (err, stale_court) => {
					if (err) return cb(err);
					if (!stale_court || stale_court._id === court_id) {
						return cb(null, court_id, false);
					}
					app.db.courts.remove({ _id: stale_court._id }, {}, (err) => cb(err, court_id, true));
				});
			});
			return;
		}

		app.db.courts.findOne(btp_query, (err, existing_btp_court) => {
			if (err) return cb(err);
			const next_court = desired(existing_btp_court);
			const insert_next = () => app.db.courts.insert(next_court, (err) => cb(err, court_id, true));
			if (!existing_btp_court) {
				return insert_next();
			}
			app.db.courts.remove({ _id: existing_btp_court._id }, {}, (err) => {
				if (err) return cb(err);
				insert_next();
			});
		});
	});
}

// Returns a map btp_court_id => court._id
function integrate_courts(app, tournament_key, btp_state, scoring_formats, location_map, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const stournament = require('./stournament'); // avoid dependency cycle

	const courts = Array.from(btp_state.courts.values());
	assign_btp_court_nums(courts);
	const res = new Map();
	var changed = false;
	async.eachSeries(courts, (c, cb) => {
		const btp_id = unwrap_btp_value(c.ID);
		const btp_location_id = unwrap_btp_value(c.LocationID);
		const location_id = location_map.get(btp_location_id);
		assert(location_id);
		c.location_id = location_id;
		upsert_btp_court(app, tournament_key, c, (err, court_id, did_change) => {
			if (err) return cb(err);
			res.set(btp_id, court_id);
			if (did_change) {
				changed = true;
			}
			cb();
		});
	}, (err) => {
		if (err) {
			return callback(err);
		}

		if (changed) {
			stournament.get_courts(app.db, tournament_key, function (err, all_courts) {
				admin.notify_change(app, tournament_key, 'courts_changed', { all_courts });
				callback(err, scoring_formats, location_map, res);
			});
		} else {
			callback(err, scoring_formats, location_map, res);
		}
	});
}

function integrate_btp_settings(app, tkey, btp_state, callback) {
	const admin = require('./admin'); // avoid dependency cycle

	app.db.tournaments.findOne({ key: tkey }, (err, tournament) => {
		if (err) return callback(err);
		var toChange = {};
		var changed = false;
		if (!tournament.btp_settings) {
			tournament.btp_settings = {};
			changed = true;
		}

		const tournament_name = btp_state.btp_settings.get(1001).Value[0];
		const tournament_urn = btp_state.btp_settings.get(1008).Value[0];
		const check_in_per_match = btp_state.btp_settings.get(1003).Value[0] ? false : true;
		const pause_duration_ms = btp_state.btp_settings.get(1303).Value[0] * 60 * 1000;

		if (tournament.btp_settings.tournament_name != tournament_name) {
			tournament.btp_settings.tournament_name = tournament_name;
			changed = true;
			toChange.btp_settings = tournament.btp_settings;
			toChange.name = tournament_name;
		}
		if (tournament.btp_settings.tournament_urn != tournament_urn) {
			tournament.btp_settings.tournament_urn = tournament_urn;
			changed = true;
			toChange.btp_settings = tournament.btp_settings;
		}
		if (tournament.btp_settings.check_in_per_match != check_in_per_match) {
			tournament.btp_settings.check_in_per_match = check_in_per_match;
			changed = true;
			toChange.btp_settings = tournament.btp_settings;
		}
		if (tournament.btp_settings.pause_duration_ms != pause_duration_ms) {
			tournament.btp_settings.pause_duration_ms = pause_duration_ms;
			changed = true;
			toChange.btp_settings = tournament.btp_settings;
		}

		if (changed) {
			app.db.tournaments.update({ key: tkey }, { $set: toChange }, {}, (err) => {
				if (err) {
					return callback(err);
				}
				admin.notify_change(app, tkey, 'update_btp_settings', {btp_settings: toChange.btp_settings});
				return callback(null);
			});
		} else {
			return callback(null);
		}
	});
}

function buildScoringFormatMap(formats) {
  const map = new Map();
  for (const f of formats) {
    map.set(Number(f.id), f);
  }
  return map;
}

function setTypeToEndMax(setType, score) {
	const t = Number(setType);
	switch (t) {
		case 0: return { end_points: 21, max_points: 30, end_points_editable: false, max_points_editable: false };
		case 301: return { end_points: 11, max_points: 11, end_points_editable: false, max_points_editable: false };
		case 304: return { end_points: 11, max_points: 15, end_points_editable: false, max_points_editable: false };
		case 305: return { end_points: 11, max_points: 13, end_points_editable: false, max_points_editable: false };
		case 306: return { end_points: 15, max_points: 21, end_points_editable: false, max_points_editable: false };
		case 1000:
			return {
				end_points: null,
				max_points: null,
				end_points_editable: true,
				max_points_editable: true,
			};
		case 999: {
			const s = Number(score);
			const fallback = Number.isFinite(s) && s > 0 ? s : null;
			return {
				end_points: fallback,
				max_points: fallback,
				end_points_editable: false,
				max_points_editable: true,
				defaults_from_score: true,
			};
		}
		default:
			return {
				end_points: null,
				max_points: null,
				end_points_editable: false,
				max_points_editable: false,
				raw: t,
			};
	}
}

function inferSetTiming(name, numSets, setType, isLastSet) {
	const normalizedName = String(name || '');
	const t = Number(setType);
	const singleSet = Number(numSets) === 1;

	function elevenSetTiming() {
		if (singleSet || isLastSet) {
			return {
				interval_at: 6,
				interval_duration_ms: normalizedName.includes('^90') ? 90000 : 60000,
			};
		}
		return {
			interval_at: null,
			interval_duration_ms: null,
		};
	}

	let timing;
	switch (t) {
		case 0:
			timing = {
				interval_at: 11,
				interval_duration_ms: 60000,
			};
			break;
		case 301:
		case 304:
		case 305:
			timing = elevenSetTiming();
			break;
		case 306:
			timing = {
				interval_at: 8,
				interval_duration_ms: 60000,
			};
			break;
		default:
			timing = {
				interval_at: null,
				interval_duration_ms: null,
			};
			break;
	}

	let breakBeforeSetDurationMs = null;
	if (!singleSet) {
		if (normalizedName.includes('2x21+11') && isLastSet) {
			breakBeforeSetDurationMs = 120000;
		} else if (normalizedName.includes('^90')) {
			breakBeforeSetDurationMs = 90000;
		} else if (
			normalizedName.includes('~NLA') ||
			t === 0 ||
			t === 306
		) {
			breakBeforeSetDurationMs = 120000;
		} else if (t === 301 || t === 304 || t === 305) {
			breakBeforeSetDurationMs = 60000;
		}
	}

	return {
		...timing,
		break_before_set_duration_ms: breakBeforeSetDurationMs,
	};
}

function applyDefaultSetTiming(setPoints) {
	const merged = {
		...setPoints,
	};
	const endPoints = Number(merged.end_points);
	if (merged.interval_at == null && Number.isFinite(endPoints) && endPoints > 0) {
		merged.interval_at = Math.ceil(endPoints / 2);
	}
	if (merged.interval_duration_ms == null) {
		merged.interval_duration_ms = 60000;
	}
	if (merged.break_before_set_duration_ms == null) {
		merged.break_before_set_duration_ms = 120000;
	}
	return merged;
}

function sanitizeSetPoints(setPoints) {
	const merged = applyDefaultSetTiming(setPoints);
	let endPoints = Number(merged.end_points);
	if (!Number.isFinite(endPoints) || endPoints < 1) {
		endPoints = 1;
	}
	let maxPoints = Number(merged.max_points);
	if (!Number.isFinite(maxPoints) || maxPoints < endPoints) {
		maxPoints = endPoints;
	}
	merged.end_points = endPoints;
	merged.max_points = maxPoints;
	if (merged.interval_at == null) {
		merged.interval_at = Math.ceil(endPoints / 2);
	}
	return merged;
}

function sanitizeScoringFormat(scoringFormat) {
	if (!scoringFormat) {
		return scoringFormat;
	}
	return {
		...scoringFormat,
		set_points: sanitizeSetPoints(scoringFormat.set_points || {}),
		last_set_points: sanitizeSetPoints(scoringFormat.last_set_points || {}),
	};
}

function normalizeScoringFormat(sf, unwrap = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v)) {
	const id = Number(unwrap(sf.ID));
	const name = String(unwrap(sf.Name));
	const numSets = Number(unwrap(sf.NumSets));
	const setType = Number(unwrap(sf.SetType));
	const lastSetType = Number(unwrap(sf.LastSetType));
	const score = Number(unwrap(sf.Score));
	const isDefault = Boolean(unwrap(sf.IsDefault));

	return sanitizeScoringFormat({
		id,
		name,
		numSets,
		score,
		isDefault,
		setType,
		lastSetType,
		set_points: applyDefaultSetTiming({
			...setTypeToEndMax(setType, score),
			...inferSetTiming(name, numSets, setType, false),
		}),
		last_set_points: applyDefaultSetTiming({
			...setTypeToEndMax(lastSetType, score),
			...inferSetTiming(name, numSets, lastSetType, true),
		}),
	});
}

function fallbackScoringFormat() {
	const scoringFormat = normalizeScoringFormat({
		ID: [0],
		Name: ['3x21'],
		NumSets: ['3'],
		SetType: ['0'],
		LastSetType: ['0'],
		Score: ['21'],
		IsDefault: [false],
	});
	scoringFormat.id = null;
	return scoringFormat;
}

function mergeLocalSetPoints(existingSetPoints, normalizedSetPoints) {
	const merged = {
		...normalizedSetPoints,
	};
	if (!existingSetPoints) {
		return merged;
	}

	if (normalizedSetPoints.end_points_editable) {
		merged.end_points = existingSetPoints.end_points ?? merged.end_points;
	}
	if (normalizedSetPoints.max_points_editable) {
		merged.max_points = existingSetPoints.max_points ?? merged.max_points;
	}

	merged.interval_at = existingSetPoints.interval_at ?? merged.interval_at;
	merged.interval_duration_ms = existingSetPoints.interval_duration_ms ?? merged.interval_duration_ms;
	merged.break_before_set_duration_ms = existingSetPoints.break_before_set_duration_ms ?? merged.break_before_set_duration_ms;
	if (existingSetPoints.interval_enabled !== undefined) {
		merged.interval_enabled = existingSetPoints.interval_enabled;
	}

	return merged;
}

function mergeLocalScoringFormat(existingFormat, normalizedFormat) {
	if (!existingFormat) {
		return sanitizeScoringFormat(normalizedFormat);
	}
	return sanitizeScoringFormat({
		...normalizedFormat,
		set_points: mergeLocalSetPoints(existingFormat.set_points, normalizedFormat.set_points),
		last_set_points: mergeLocalSetPoints(existingFormat.last_set_points, normalizedFormat.last_set_points),
	});
}

function integrate_btp_scoring_formats(app, tkey, btp_state, callback) {
  const admin = require("./admin"); // avoid dependency cycle

  const unwrap = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v);

  const deepEqualJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  app.db.tournaments.findOne({ key: tkey }, (err, tournament) => {
    if (err) return callback(err);
    if (!tournament) return callback(new Error(`Tournament not found for key: ${tkey}`));

    if (!tournament.scoring_formats) tournament.scoring_formats = {};

    if (!btp_state?.scoring_formats || !(btp_state.scoring_formats instanceof Map)) {
      return callback(new Error("btp_state.scoring_formats is missing or not a Map"));
    }

    const existingFormatsById = new Map(
      (((tournament.scoring_formats || {}).formats) || []).map(f => [Number(f.id), f])
    );

    const formats = Array.from(btp_state.scoring_formats.values())
      .map(sf => normalizeScoringFormat(sf, unwrap))
      .map(sf => mergeLocalScoringFormat(existingFormatsById.get(Number(sf.id)), sf))
      .sort((a, b) => a.id - b.id);

    const defaultFormat = formats.find(f => f.isDefault) || null;

    const scoringFormatsPayload = {
      formats,
      default_id: defaultFormat ? defaultFormat.id : null,
    };

    const scoringFormatMap = buildScoringFormatMap(formats);

    const existing = tournament.scoring_formats || null;

    // No change
    if (deepEqualJson(existing, scoringFormatsPayload)) {
      return callback(null, scoringFormatMap);
    }

    tournament.scoring_formats = scoringFormatsPayload;

    app.db.tournaments.update(
      { key: tkey },
      { $set: { scoring_formats: tournament.scoring_formats } },
      {},
      (err) => {
        if (err) return callback(err);

        admin.notify_change(app, tkey, "update_btp_scoring_formats", {
          scoring_formats: scoringFormatsPayload,
        });

        return callback(null, scoringFormatMap);
      }
    );
  });
}

const event_integration_cache = new WeakMap();

function integrate_events(app, tkey, btp_state, callback) {
	if (
		!btp_state ||
		!(btp_state.events instanceof Map) ||
		!(btp_state.stages instanceof Map) ||
		!(btp_state.stage_entries instanceof Map)
	) {
		return callback(new Error("btp_state.events/stages/stage_entries missing or not a Map"));
	}
	const started_at = Date.now();
	const match_counts = btp_event_match_counts(btp_state);
	const { first_matches, first_round_numbers } = btp_event_planning(btp_state);
	// Results do not affect registration lists. Include every other source used
	// by the payload builder. Convert the top-level Maps and the nested player
	// entry-status Maps once, avoiding a JSON replacer visit for every property.
	const source_maps = ['events', 'stages', 'stage_entries', 'entries', 'clubs', 'districts']
		.map(key => btp_state[key] instanceof Map ? Array.from(btp_state[key]) : btp_state[key]);
	const players = btp_state.players instanceof Map ? Array.from(btp_state.players, ([id, player]) => [
		id, player?.entries instanceof Map ? { ...player, entries: Array.from(player.entries) } : player,
	]) : btp_state.players;
	const signature = crypto.createHash('sha256').update(JSON.stringify([
		...source_maps, players, Array.from(match_counts), Array.from(first_matches), Array.from(first_round_numbers),
	])).digest('hex');
	const tournaments = app.db.tournaments;
	let cache = event_integration_cache.get(tournaments);
	if (!cache) {
		cache = new Map();
		event_integration_cache.set(tournaments, cache);
	}
	const cached = cache.get(tkey);
	const rebuild = () => integrate_changed_events(app, tkey, btp_state, match_counts, first_matches, first_round_numbers, (err, payload_json) => {
		if (!err) cache.set(tkey, { signature, payload_json });
		log_btp_sync_timing(tkey, 'integrate_events_details', Date.now() - started_at, { skipped: false });
		callback(err);
	});
	if (!cached || cached.signature !== signature) return rebuild();

	// Verify the actual stored payload inside NeDB, without copying the large
	// registration lists out of the datastore. This also detects resets, manual
	// edits and replacement tournaments even when BTP sends the same inputs.
	tournaments.findOne({
		key: tkey,
		$where: function() { return JSON.stringify(this.events || {}) === cached.payload_json; },
	}, { key: 1, _id: 0 }, (err, current) => {
		if (err) return callback(err);
		if (!current) return rebuild();
		log_btp_sync_timing(tkey, 'integrate_events_details', Date.now() - started_at, { skipped: true });
		callback(null);
	});
}

function btp_event_match_counts(btp_state) {
	const unwrap = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v);
	const counts = new Map();
	if (btp_state.draws instanceof Map && btp_state.matches) {
		const matches = btp_state.matches instanceof Map ? btp_state.matches.values() : btp_state.matches;
		for (const match of matches) {
			if (!match || !match.DrawID || !(match.IsMatch && unwrap(match.IsMatch))) continue;
			const draw_id = unwrap(match.DrawID);
			const draw = btp_state.draws.get(draw_id) || btp_state.draws.get(Number(draw_id)) || btp_state.draws.get(String(draw_id));
			const event_id = draw && draw.EventID ? Number(unwrap(draw.EventID)) : null;
			if (!Number.isFinite(event_id)) continue;
			counts.set(event_id, (counts.get(event_id) || 0) + 1);
		}
	}
	return counts;
}

function btp_event_planning(btp_state) {
	const first = new Map(), rounds = new Map();
	if (!(btp_state.draws instanceof Map)) return { first_matches: first, first_round_numbers: rounds };
	const unwrap = value => Array.isArray(value) ? value[0] : value;
	// Undrawn brackets already have match numbers and planned times. They need
	// not be playable or imported as BTS matches to establish discipline order.
	const source = btp_state.planning_nodes?.size ? btp_state.planning_nodes : btp_state.matches || [];
	const nodes = source instanceof Map ? source.values() : source;
	for (const node of nodes) {
		const number = Number(unwrap(node?.MatchNr));
		if (unwrap(node?.IsMatch) !== true || !Number.isFinite(number) || number <= 0 || node.EntryID || node.Link) continue;
		const draw_id = unwrap(node.DrawID);
		const draw = btp_state.draws.get(draw_id) || btp_state.draws.get(Number(draw_id)) || btp_state.draws.get(String(draw_id));
		const event_id = Number(unwrap(draw?.EventID));
		if (!Number.isFinite(event_id)) continue;
		const planned = unwrap(node.PlannedTime), order = unwrap(node.DisplayOrder);
		const setup = { match_num: number };
		if (planned && planned.year > 0 && planned.month > 0 && planned.day > 0 && Number.isFinite(planned.hour) && Number.isFinite(planned.minute)) {
			setup.scheduled_date = date_str(planned); setup.scheduled_time_str = time_str(planned);
		}
		const match = { setup, ...(order != null && Number.isFinite(Number(order)) ? { match_order: Number(order) } : {}) };
		if (!first.has(event_id) || cmp_scheduled_match_order(match, first.get(event_id)) < 0) first.set(event_id, match);
		const round = Number(unwrap(node.Round));
		if (!Number.isSafeInteger(round) || round <= 0 || !Number.isSafeInteger(number)) continue;
		if (!rounds.has(event_id) || round < rounds.get(event_id).round) rounds.set(event_id, { round, matches: [] });
		if (round === rounds.get(event_id).round) rounds.get(event_id).matches.push(match);
	}
	const first_matches = new Map([...first].sort(([a], [b]) => a - b).map(([id, match]) => [id, {
		number: match.setup.match_num,
		...(match.setup.scheduled_date ? { date: match.setup.scheduled_date, time: match.setup.scheduled_time_str } : {}),
		...(match.match_order != null ? { order: match.match_order } : {}),
	}]));
	const first_round_numbers = new Map([...rounds].sort(([a], [b]) => a - b).map(([id, { matches }]) =>
		[id, [...new Set(matches.sort(cmp_scheduled_match_order).map(match => match.setup.match_num))]]));
	return { first_matches, first_round_numbers };
}

function integrate_changed_events(app, tkey, btp_state, matchCountByEventId, firstMatchesByEventId, firstRoundNumbersByEventId, callback) {
	const admin = require("./admin"); // avoid dependency cycle
	const unwrap = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v);

	function normalizeEvent(ev) {
		return {
		id: Number(unwrap(ev.ID)),
		name: String(unwrap(ev.Name)),
		game_type_id: Number(unwrap(ev.GameTypeID)),
		gender_id: Number(unwrap(ev.GenderID)),
		min_age: Number(unwrap(ev.MinAge)),
		max_age: Number(unwrap(ev.MaxAge)),
		fee: Number(unwrap(ev.Fee)),
		separate_seeding: Boolean(unwrap(ev.SeparateSeeding)),
		allow_online_entry: Boolean(unwrap(ev.AllowOnlineEntry)),
		grading_id: Number(unwrap(ev.GradingID)),
		sub_grading_id: Number(unwrap(ev.SubGradingID)),
		sub_grading2_id: Number(unwrap(ev.SubGrading2ID)),
		};
	}

	function normalizeStage(st) {
		return {
			id: Number(unwrap(st.ID)),
			name: String(unwrap(st.Name)),
			event_id: Number(unwrap(st.EventID)),
			stage_type: Number(unwrap(st.StageType)),
			display_order: Number(unwrap(st.DisplayOrder)),
			scoring_format: st.ScoringFormat !== undefined ? Number(unwrap(st.ScoringFormat)) : null,
		};
	}

	// Build normalized payload:
	// events: [{... , stages:[...]}] for convenient GUI + lookups
	const eventsArr = Array.from(btp_state.events.values())
		.map(normalizeEvent)
		.sort((a, b) => a.id - b.id);

	const stagesArr = Array.from(btp_state.stages.values())
		.map(normalizeStage)
		.sort((a, b) => a.id - b.id);

	const entriesByStageId = new Map();
	for (const stage_entry of btp_state.stage_entries.values()) {
		const stage_id = Number(unwrap(stage_entry.StageID));
		const normalized_entry = normalize_stage_entry_for_event_payload(stage_entry, btp_state);
		if (!normalized_entry) {
			continue;
		}
		if (!entriesByStageId.has(stage_id)) entriesByStageId.set(stage_id, []);
		entriesByStageId.get(stage_id).push(normalized_entry);
	}
	for (const entries of entriesByStageId.values()) {
		entries.sort((a, b) => {
			const a_name = a.team?.players?.map((player) => player.name || '').join(' / ') || '';
			const b_name = b.team?.players?.map((player) => player.name || '').join(' / ') || '';
			return a_name.localeCompare(b_name) || (a.entry_id - b.entry_id);
		});
	}

	const stagesByEventId = new Map();
	for (const st of stagesArr) {
		st.entries = entriesByStageId.get(st.id) || [];
		st.entry_count = st.entries.length;
		if (!stagesByEventId.has(st.event_id)) stagesByEventId.set(st.event_id, []);
		stagesByEventId.get(st.event_id).push(st);
	}

	// Keep stages sorted by display_order then id for stability
	for (const [eventId, list] of stagesByEventId.entries()) {
		list.sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));
	}

	const payload = {
		events: eventsArr.map((ev) => ({
		...ev,
		is_drawn: (matchCountByEventId.get(ev.id) || 0) > 0,
		match_count: matchCountByEventId.get(ev.id) || 0,
		...(firstMatchesByEventId.has(ev.id) ? { first_planned_match: firstMatchesByEventId.get(ev.id) } : {}),
		...(firstRoundNumbersByEventId.has(ev.id) ? { first_round_match_numbers: firstRoundNumbersByEventId.get(ev.id) } : {}),
		stages: stagesByEventId.get(ev.id) || [],
		})),
		// optional: keep a flat list too, if you prefer later
		// stages: stagesArr,
	};
	const payload_json = JSON.stringify(payload);

	app.db.tournaments.findOne({
		key: tkey,
		$where: function() { return JSON.stringify(this.events || {}) === payload_json; },
	}, { key: 1, _id: 0 }, (err, unchanged) => {
		if (err) return callback(err);
		if (unchanged) return callback(null, payload_json);
		app.db.tournaments.update({ key: tkey }, { $set: { events: payload } }, {}, (err, count) => {
			if (err) return callback(err);
			if (count === 0) return callback(new Error(`Tournament not found for key: ${tkey}`));
			admin.notify_change(app, tkey, "update_btp_events", { events: payload });
			return callback(null, payload_json);
		});
	});
}


async function integrate_player_state(app, tkey, btp_state, callback) {
	const btp_manager = require('./btp_manager');
	app.db.tournaments.findOne({ key: tkey }, (err, tournament) => {
		if (err) return callback(err);

		if (!tournament.btp_settings.check_in_per_match) {
			let ids_to_change = [];
			let players_to_change = [];
			async.eachOfSeries(btp_state.matches, async (match, key) => {
				let cur_match = await get_match_form_db(app, tkey, btp_state, match);
				if (!cur_match) {
					return;
				}
				for (let team_nr = 0; team_nr < (match.bts_players || []).length; team_nr++) {
					for (let player_nr = 0; player_nr < (match.bts_players[team_nr] || []).length; player_nr++) {
						const btp_player_id = match.bts_players?.[team_nr]?.[player_nr]?.ID?.[0] || null;
						const local_player = find_setup_player_by_btp_id(cur_match.setup, btp_player_id);
						if (!local_player) {
							continue;
						}
						let id = pause_is_done(match, team_nr, player_nr, tournament.btp_settings, now_ms(app), local_player);

						if (id != undefined && id != null) {
							if (!local_player.now_tablet_on_court &&
								!local_player.now_playing_on_court &&
								!cur_match.setup.called_timestamp &&
								!cur_match.network_score) {

								if (btp_state.matches?.[key]?.bts_players?.[team_nr]?.[player_nr]?.CheckedIn) {
									btp_state.matches[key].bts_players[team_nr][player_nr].CheckedIn[0] = true;
								}

								if (ids_to_change.indexOf(id) == -1) {
									local_player.checked_in = true;
									local_player.check_in_per_match = false;
									local_player.tablet_break_active = false;
									ids_to_change.push(id);
									players_to_change.push(local_player);
								}
							}
						}
					}
				}
			}, (err) => {
				if (err) return callback(err);
				btp_manager.update_players(app, tkey, players_to_change);
				return callback(null);
			});
		}
		else {
			return callback(null);
		}

	});
}

function normalize_match_player_pause_state(app, tkey, callback, snapshot = null) {
	const admin = require('./admin');

	read_normalization_state(app, tkey, 'matches', snapshot, (err, matches) => {
		if (err) {
			return callback(err);
		}

		const canonical_last_time_by_btp_id = new Map();

		for (const match of matches) {
			const is_authoritative_pause_source =
				match?.end_ts ||
				typeof match?.team1_won === 'boolean' ||
				match?.btp_winner ||
				match?.btp_needsync;
			const teams = match?.setup?.teams || [];
			for (const team of teams) {
				for (const player of (team?.players || [])) {
					if (!player?.btp_id) {
						continue;
					}
					if (!is_authoritative_pause_source) {
						continue;
					}
					const candidate_ts = match.end_ts || player.last_time_on_court_ts;
					if (!candidate_ts) {
						continue;
					}
					const previous = canonical_last_time_by_btp_id.get(player.btp_id) || 0;
					if (candidate_ts > previous) {
						canonical_last_time_by_btp_id.set(player.btp_id, candidate_ts);
					}
				}
			}
		}

		let any_changed = false;
		let updated_matches = 0;
		async.eachSeries(matches, (match, cb) => {
			let changed = false;
			const teams = match?.setup?.teams || [];

			for (const team of teams) {
				for (const player of (team?.players || [])) {
					if (!player?.btp_id) {
						continue;
					}
					const canonical_last_time = canonical_last_time_by_btp_id.get(player.btp_id);
					if (!canonical_last_time) {
						continue;
					}
					if (player.last_time_on_court_ts !== canonical_last_time) {
						player.last_time_on_court_ts = canonical_last_time;
						changed = true;
					}
				}
			}

			if (!changed) {
				return cb(null);
			}

			any_changed = true;
			app.db.matches.update(
				{ _id: match._id, tournament_key: tkey },
				{ $set: { 'setup.teams': teams } },
				{},
				(update_err, num_affected) => {
					if (update_err) {
						return cb(update_err);
					}
					if (!num_affected) {
						return cb(null);
					}
					updated_matches++;
					admin.notify_change(app, tkey, 'update_player_status', {
						match__id: match._id,
						btp_winner: match.btp_winner,
						setup: match.setup,
					});
					return cb(null);
				}
			);
		}, err => {
			log_btp_sync_timing(tkey, 'normalize_match_player_pause_state_detail', 0, {
				matches: matches.length, updated: updated_matches,
			});
			callback(err, any_changed);
		});
	});
}

async function get_match_form_db(app, tkey, btp_state, match) {
	return new Promise((resolve, reject) => {
		const { draws, events } = btp_state;
		const btp_id = calculate_btp_match_id(tkey, match, draws, events);

		const query = {
			btp_id: btp_id,
			tournament_key: tkey,
		};

		app.db.matches.findOne(query, (err, cur_match) => {
			if (err) {
				console.error(err);
				return reject(err);
			};

			if (cur_match) {
				return resolve(cur_match);
			} else {
				return resolve(null);
			}
		});
	});
}

function pause_is_done(match, team_nr, player_nr, btp_settings, current_now_ms, local_player = null) {
	current_now_ms = resolve_current_now_ms(current_now_ms);
	if (match.bts_players && match.bts_players.length > team_nr) {
		if (match.bts_players[team_nr] && match.bts_players[team_nr].length > player_nr) {
			const player = match.bts_players[team_nr][player_nr];

				if (player.CheckedIn?.[0] || local_player?.checked_in === true) {
					return;
				}
				if (local_player?.tablet_break_active === true) {
					const tablet_break_until_ts = Number(local_player.tablet_break_until_ts);
					if (Number.isFinite(tablet_break_until_ts) && current_now_ms < tablet_break_until_ts) {
						return;
					}
				}

			let last_time_on_court_ts = local_player?.last_time_on_court_ts || null;
			if (!last_time_on_court_ts && player.LastTimeOnCourt && player.LastTimeOnCourt[0]) {
				const date = new Date(player.LastTimeOnCourt[0].year,
					player.LastTimeOnCourt[0].month - 1,
					player.LastTimeOnCourt[0].day,
					player.LastTimeOnCourt[0].hour,
					player.LastTimeOnCourt[0].minute,
					player.LastTimeOnCourt[0].second,
					player.LastTimeOnCourt[0].ms);
				last_time_on_court_ts = date.getTime();
			}

			if (last_time_on_court_ts) {
				if ((current_now_ms - last_time_on_court_ts) > btp_settings.pause_duration_ms) {
					return player.ID[0];
				}
				return;
			} else {
				return player.ID[0];
			}
		}
	}
	return;
}

function buildOfficialReferenceState(matches) {
	const referenced_ids = new Set();
	const referenced_btp_ids = new Set();
	const planned_umpire_ids = new Set();
	const planned_umpire_btp_ids = new Set();
	const planned_service_judge_ids = new Set();
	const planned_service_judge_btp_ids = new Set();
	const on_court_umpire_ids = new Set();
	const on_court_umpire_btp_ids = new Set();
	const on_court_service_judge_ids = new Set();
	const on_court_service_judge_btp_ids = new Set();

	(matches || []).forEach((match) => {
		const setup = match.setup || {};
		const is_finished = typeof match.team1_won === 'boolean' || match.btp_winner || match.btp_needsync || setup.state === 'finished';
		const is_on_court = setup.now_on_court === true;
		const is_planned = !is_finished && !is_on_court && !!setup.state;

		const addRef = (official, idSet, btpSet) => {
			if (!official) return;
			if (official._id) idSet.add(String(official._id));
			if (official.btp_id != null) btpSet.add(String(official.btp_id));
		};

		if (!is_finished) {
			[setup.umpire, setup.service_judge].forEach((official) => {
				addRef(official, referenced_ids, referenced_btp_ids);
			});
		}

		if (is_on_court) {
			addRef(setup.umpire, on_court_umpire_ids, on_court_umpire_btp_ids);
			addRef(setup.service_judge, on_court_service_judge_ids, on_court_service_judge_btp_ids);
		} else if (is_planned) {
			addRef(setup.umpire, planned_umpire_ids, planned_umpire_btp_ids);
			addRef(setup.service_judge, planned_service_judge_ids, planned_service_judge_btp_ids);
		}
	});

	return {
		referenced_ids,
		referenced_btp_ids,
		planned_umpire_ids,
		planned_umpire_btp_ids,
		planned_service_judge_ids,
		planned_service_judge_btp_ids,
		on_court_umpire_ids,
		on_court_umpire_btp_ids,
		on_court_service_judge_ids,
		on_court_service_judge_btp_ids,
	};
}

function computeOfficialVisibilityPatch(official, refState, tournament = null) {
	const hasId = (set) => set.has(String(official._id));
	const hasBtpId = (set) => official.btp_id != null && set.has(String(official.btp_id));
	const inSet = (ids, btpIds) => hasId(ids) || hasBtpId(btpIds);

	const in_active_list =
		official.umpire_wait != null ||
		official.service_judge_wait != null ||
		official.umpire_pause != null ||
		official.service_judge_pause != null ||
		official.umpire_manual_pause != null ||
		official.service_judge_manual_pause != null;
	const referenced_somewhere = inSet(refState.referenced_ids, refState.referenced_btp_ids);
	const should_be_planned_as_umpire = inSet(refState.planned_umpire_ids, refState.planned_umpire_btp_ids);
	const should_be_planned_as_service_judge = inSet(refState.planned_service_judge_ids, refState.planned_service_judge_btp_ids);
	const should_be_umpire_on_court = inSet(refState.on_court_umpire_ids, refState.on_court_umpire_btp_ids);
	const should_be_service_judge_on_court = inSet(refState.on_court_service_judge_ids, refState.on_court_service_judge_btp_ids);

	const setObj = {};
	if (!!official.is_planed_as_umpire !== should_be_planned_as_umpire) {
		setObj.is_planed_as_umpire = should_be_planned_as_umpire;
	}
	if (!!official.is_planed_as_service_judge !== should_be_planned_as_service_judge) {
		setObj.is_planed_as_service_judge = should_be_planned_as_service_judge;
	}
	if ((official.umpire_on_court != null) !== should_be_umpire_on_court) {
		setObj.umpire_on_court = should_be_umpire_on_court ? (official.umpire_on_court || true) : null;
	}
	if ((official.service_judge_on_court != null) !== should_be_service_judge_on_court) {
		setObj.service_judge_on_court = should_be_service_judge_on_court ? (official.service_judge_on_court || true) : null;
	}

	const on_court = should_be_umpire_on_court || should_be_service_judge_on_court;
	const visible_somewhere = in_active_list || on_court || referenced_somewhere;
	if (!visible_somewhere) {
		const now = Date.now();
		const reactivated_wait_ts = Math.floor(now / 10);
		let preferred_role = null;
		if (official.umpire_wait != null || official.umpire_pause != null || official.umpire_manual_pause != null || official.is_planed_as_umpire || official.umpire_on_court != null) {
			preferred_role = 'umpire';
		} else if (official.service_judge_wait != null || official.service_judge_pause != null || official.service_judge_manual_pause != null || official.is_planed_as_service_judge || official.service_judge_on_court != null) {
			preferred_role = 'service_judge';
		} else if (official.is_umpire === true && official.is_service_judge !== true) {
			preferred_role = 'umpire';
		} else if (official.is_service_judge === true && official.is_umpire !== true) {
			preferred_role = 'service_judge';
		} else if (official.is_umpire === true && official.is_service_judge === true) {
			preferred_role = 'umpire';
		}

		if (preferred_role === 'umpire') {
			setObj.umpire_wait = official.umpire_wait != null ? official.umpire_wait : reactivated_wait_ts;
			setObj.service_judge_wait = null;
		} else if (preferred_role === 'service_judge') {
			setObj.service_judge_wait = official.service_judge_wait != null ? official.service_judge_wait : reactivated_wait_ts;
			setObj.umpire_wait = null;
		}
		if (official.is_umpire !== true && official.is_service_judge !== true && official.inactive_list == null) {
			setObj.inactive_list = now;
		} else {
			setObj.inactive_list = null;
		}
		if (setObj.is_planed_as_umpire === undefined) setObj.is_planed_as_umpire = false;
		if (setObj.is_planed_as_service_judge === undefined) setObj.is_planed_as_service_judge = false;
		if (setObj.umpire_on_court === undefined) setObj.umpire_on_court = null;
		if (setObj.service_judge_on_court === undefined) setObj.service_judge_on_court = null;
	}

	const next_checked_in = match_utils.get_effective_technical_official_checked_in({ ...official, ...setObj }, tournament);
	if (!!official.checked_in !== next_checked_in) {
		setObj.checked_in = next_checked_in;
	}

	return setObj;
}

function findExistingOfficialForBtpImport(officials, tournament_key, btp_id) {
	const canonical_id = `${tournament_key}_btp_${btp_id}`;
	return (officials || []).find((official) =>
		official &&
		official.tournament_key === tournament_key &&
		(
			(official.btp_id != null && String(official.btp_id) === String(btp_id)) ||
			String(official._id) === canonical_id
		)
	) || null;
}

function integrate_umpires(app, tournament_key, btp_state, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const stournament = require('./stournament'); // avoid dependency cycle

	const officials = Array.from(btp_state.officials.values());
	var changed = false;

	app.db.umpires.find({ tournament_key }, (err, existingOfficials) => {
		if (err) return callback(err);
	async.each(officials, (o, cb) => {
		const firstname = (o.FirstName ? o.FirstName[0] : '');
		const surname = (o.Name ? o.Name[0] : '');
		const name = (firstname + " " + surname).trim();
		const country = (o.Country ? o.Country[0] : '');
		const btp_id = o.ID[0];
		if (!btp_id) {
			return cb();
		}
		

		const cur = findExistingOfficialForBtpImport(existingOfficials, tournament_key, btp_id);



			if (cur) {

				const allListsNull =    !cur.is_planed_as_umpire &&
										!cur.is_planed_as_service_judge && 
			    						cur.umpire_on_court == null &&
										cur.service_judge_on_court == null &&
										cur.umpire_wait == null &&
										cur.service_judge_wait == null &&
										cur.umpire_pause == null &&
										cur.service_judge_pause == null &&
										cur.umpire_manual_pause == null &&
										cur.service_judge_manual_pause == null &&
										cur.inactive_list == null;


				if (cur.btp_id === btp_id &&
					cur.firstname == firstname &&
					cur.surname == surname &&
					cur.country === country &&
					!allListsNull) {
					return cb();
				} else {
					const inactive_list = allListsNull ? now_ms(app) : null;
					app.db.umpires.update({ _id: cur._id, tournament_key }, { $set: { btp_id, firstname, surname, name, country, inactive_list} }, { returnUpdatedDocs: true }, function (err, numAffected, changed_umpire) {
						if (err) {
							console.error(err);
							return cb(err);
						}
						changed = true;
						const idx = existingOfficials.findIndex((official) => official && official._id === changed_umpire._id);
						if (idx >= 0) {
							existingOfficials[idx] = changed_umpire;
						} else {
							existingOfficials.push(changed_umpire);
						}
						const admin = require('./admin');
						admin.notify_change(app, tournament_key, 'umpire_updated', changed_umpire);
						return cb();
					});
					return;
				}
			}

			const u = {
				_id: tournament_key + '_btp_' + btp_id,
				btp_id,
				firstname,
				surname,
				name,
				status: 'ready',
				tournament_key,
				country,
				is_umpire: true,
				is_service_judge: true,
				is_planed_as_umpire: false,
				is_planed_as_service_judge: false,
				umpire_on_court: null,
				service_judge_on_court: null,
				umpire_wait: null,
				service_judge_wait: null,
				umpire_pause: null,
				service_judge_pause: null,
				umpire_manual_pause: null,
				service_judge_manual_pause: null,
				inactive_list: now_ms(app)
			};
			changed = true;
			app.db.umpires.insert(u, function (err, inserted_umpire) {
				if (err) {
					return cb(err);
				}
				existingOfficials.push(inserted_umpire);
				admin.notify_change(app, tournament_key, 'umpire_add', { umpire: inserted_umpire });
				return cb();
			});
	}, err => {
		if (changed) {
			stournament.get_umpires(app.db, tournament_key, function (err, all_umpires) {
				if (!err) {
					admin.notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
				}
				callback(err);
			});
		} else {
			callback(err);
		}
	});
	});
}

function calculate_match_ids_on_court(btp_state) {
	const res = new Set();
	for (const c of btp_state.courts.values()) {
		if (c.MatchID) {
			for (const match_id of c.MatchID) {
				res.add(match_id);
			}
		}
	}
	return res;
}



function update_umpire(app, tkey, umpire, status, last_time_on_court_ts,court_id) {
	app.db.umpires.update({ tournament_key: tkey, name: umpire.name }, { $set: { last_time_on_court_ts: last_time_on_court_ts, status: status, court_id: court_id } }, { returnUpdatedDocs: true }, function (err, numAffected, changed_umpire) {
		if (err) {
			console.error(err);
			return;
		}
		const admin = require('./admin');
		admin.notify_change(app, tkey, 'umpire_updated', changed_umpire);
	});
}

function normalize_official_visibility(app, tournament_key, callback, snapshot = null) {
	const admin = require('./admin');
	const stournament = require('./stournament');

	read_normalization_state(app, tournament_key, 'tournaments', snapshot, (tournamentErr, tournament) => {
		if (tournamentErr) {
			return callback(tournamentErr);
		}
	read_normalization_state(app, tournament_key, 'matches', snapshot, (matchErr, matches) => {
		if (matchErr) {
			return callback(matchErr);
		}

		const refState = buildOfficialReferenceState(matches);

		read_normalization_state(app, tournament_key, 'umpires', snapshot, (err, officials) => {
			if (err) {
				return callback(err);
			}

			let changed = false;
			async.eachSeries(officials, (official, cb) => {
				const setObj = computeOfficialVisibilityPatch(official, refState, tournament);
				if (Object.keys(setObj).length === 0) {
					return cb();
				}

				app.db.umpires.update(
					{ _id: official._id, tournament_key },
					{ $set: setObj },
					{ returnUpdatedDocs: true },
					(updateErr, numAffected, changed_umpire) => {
						if (updateErr) {
							return cb(updateErr);
						}
						if (changed_umpire) {
							changed = true;
							Object.assign(official, changed_umpire);
							admin.notify_change(app, tournament_key, 'umpire_updated', changed_umpire);
						}
						cb();
					}
				);
			}, (eachErr) => {
				if (eachErr) {
					return callback(eachErr);
				}
				if (!changed) {
					return callback(null, false);
				}
				stournament.get_umpires(app.db, tournament_key, function (getErr, all_umpires) {
					if (!getErr) {
						admin.notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
					}
					callback(getErr, changed);
				});
			});
		});
	});
	});
}

async function integrate_now_on_court(app, tkey, callback) {
	const match_utils = require('./match_utils');

	function matchHasPlayerOnCourtFlags(match) {
		if (!match || !match.setup || !match.setup.teams) {
			return false;
		}
		return match.setup.teams.some(team =>
			team.players && team.players.some(player => player.now_playing_on_court || player.now_tablet_on_court)
		);
	}

	function collectActivePlayerIds(matches) {
		const activeIds = new Set();
		matches.forEach(match => {
			if (!match || !match.setup || !match.setup.teams) {
				return;
			}
			match.setup.teams.forEach(team => {
				if (!team.players) {
					return;
				}
				team.players.forEach(player => {
					if (player && player.btp_id) {
						activeIds.add(player.btp_id);
					}
				});
			});
			if (match.setup.tabletoperators) {
				match.setup.tabletoperators.forEach(player => {
					if (player && player.btp_id) {
						activeIds.add(player.btp_id);
					}
				});
			}
		});
		return activeIds;
	}

	function matchHasOnlyStalePlayerFlags(match, activePlayerIds) {
		if (!match || !match.setup || !match.setup.teams) {
			return false;
		}
		return match.setup.teams.some(team =>
			team.players && team.players.some(player =>
				(player.now_playing_on_court || player.now_tablet_on_court) &&
				(!player.btp_id || !activePlayerIds.has(player.btp_id))
			)
		);
	}

	function setPlayerStatesForMatches(matches) {
		return new Promise((resolve, reject) => {
			match_utils.set_players_on_courts(app, tkey, matches, (err) => {
				if (err) return reject(err);
				resolve(null);
			});
		});
	}

	function clearPlayerStateForMatch(match) {
		const endTs = match.end_ts || now_ms(app);
		return new Promise((resolve, reject) => {
			match_utils.remove_player_on_court(app, tkey, match._id, endTs, (err) => {
				if (err) return reject(err);
				match_utils.remove_tablet_on_court(app, tkey, match._id, endTs, (err) => {
					if (err) return reject(err);
					resolve(null);
				});
			});
		});
	}

	// TODO after switching to async, this should happen during court&match construction
	async function reconcile() {
		const tournament = await app.db.tournaments.findOne_async({ key: tkey });
		assert(tournament);
		const matches = await app.db.matches.find_async({ tournament_key: tkey });

		const now_on_court_matches = (matches || []).filter(match => match?.setup?.now_on_court === true);
		const activeMatchesRaw = now_on_court_matches.filter(match => typeof match.team1_won !== 'boolean');
		const courts = await app.db.courts.find_async({ tournament_key: tkey });
		const courtMatchIds = new Map((courts || []).map(court => [court._id, court.match_id]));
		const activeMatchesByCourt = new Map();
		activeMatchesRaw.forEach(match => {
			const court_id = match?.setup?.court_id;
			if (!court_id) {
				return;
			}
			if (!activeMatchesByCourt.has(court_id)) {
				activeMatchesByCourt.set(court_id, []);
			}
			activeMatchesByCourt.get(court_id).push(match);
		});
		const activeMatches = [];
		const duplicateActiveMatches = [];
		activeMatchesByCourt.forEach((courtMatches, court_id) => {
			if (courtMatches.length <= 1) {
				activeMatches.push(...courtMatches);
				return;
			}
			const referenced_match_id = courtMatchIds.get(court_id);
			const selected = courtMatches.find(match => match._id === referenced_match_id) ||
				courtMatches.slice().sort((a, b) => {
					const called_diff = Number(b?.setup?.called_timestamp || 0) - Number(a?.setup?.called_timestamp || 0);
					if (called_diff !== 0) return called_diff;
					const state_score = (match) => match?.setup?.state === 'oncourt' ? 1 : 0;
					const state_diff = state_score(b) - state_score(a);
					if (state_diff !== 0) return state_diff;
					return Number(b?.match_order || 0) - Number(a?.match_order || 0);
				})[0];
			activeMatches.push(selected);
			courtMatches.forEach(match => {
				if (match._id !== selected._id) {
					duplicateActiveMatches.push(match);
				}
			});
			require('./server_diagnostics').log(app, tkey, '[bts] btp_sync:duplicate_on_court_resolved', {
				tournament_key: tkey,
				court_id,
				selected_match_id: selected?._id,
				duplicate_match_ids: courtMatches.filter(match => match._id !== selected?._id).map(match => match._id),
			});
		});
		await Promise.all(duplicateActiveMatches.map(async (match) => {
			const setup = { ...(match.setup || {}) };
			setup.now_on_court = false;
			if (setup.incomplete === true) {
				setup.state = 'incomplete';
			} else if (setup.scheduled_date && setup.scheduled_time_str) {
				setup.state = 'scheduled';
			} else {
				setup.state = 'unscheduled';
			}
			delete setup.called_timestamp;
			await app.db.matches.update_async(
				{ _id: match._id, tournament_key: tkey },
				{ $set: { setup } },
				{}
			);
			match.setup = setup;
			await clearPlayerStateForMatch(match);
		}));
		const establishedMatches = [];
		for (const match of activeMatches) {

			const court_id = match.setup.court_id;
			const match_id = match._id;

			if (!court_id || !match_id) {
				continue; // TODO in async we would assert both to be true
			}

			const setup = match.setup;
			if(!setup.called_timestamp) {
				await new Promise((resolve, reject) => {
					match_utils.call_match(app, tournament, match, undefined, (err, called_match) => {
						if (err) return reject(err);
						if (called_match) match.setup = called_match.setup;
						resolve();
					});
				});
			} else {
				const query = {
					tournament_key: tkey,
					_id: court_id,
				};
				if (courtMatchIds.get(court_id) !== match_id) {
					await app.db.courts.update_async(query, { $set: { match_id } }, {});
				}
				establishedMatches.push(match);
			}
		}
		await setPlayerStatesForMatches(establishedMatches);

		const activePlayerIds = collectActivePlayerIds(activeMatches);
		const staleMatches = matches.filter(match =>
			match &&
			match.setup &&
			match.setup.now_on_court !== true &&
			matchHasPlayerOnCourtFlags(match) &&
			matchHasOnlyStalePlayerFlags(match, activePlayerIds)
		);

		await Promise.all(staleMatches.map(match => clearPlayerStateForMatch(match)));
	}
	return reconcile().then(() => callback(null), callback);
	// TODO clear courts (better in async)
}


async function integrate_btp_snapshot(app, tkey, response, options = {}) {
	return new Promise((resolve, reject) => {
		let btp_state;
		const total_start_ms = Date.now();
		btp_sync_state(app, tkey, options.expected_reset_ts).then((initial_sync_state) => {
			if (!initial_sync_state.ok) {
				log_btp_sync_skipped(tkey, initial_sync_state.reason);
				resolve({ skipped: true, reason: initial_sync_state.reason });
				return;
			}
			try {
				const parse_start_ms = Date.now();
				btp_state = btp_parse.get_btp_state(response);
				_annotate_draw_rankings(btp_state);
				log_btp_sync_timing(tkey, 'parse_btp_state', Date.now() - parse_start_ms, btp_state_counts(btp_state));
			} catch (e) {
				reject(e);
				return;
			}

			const sync_context = {
				match_changes: true,
				now_on_court_state_changes: true,
			};
			async.waterfall([
				timed_btp_sync_task(tkey, 'integrate_btp_settings', cb => integrate_btp_settings(app, tkey, btp_state, cb)),
				timed_btp_sync_task(tkey, 'integrate_events', cb => integrate_events(app, tkey, btp_state, cb)),
				timed_btp_sync_task(tkey, 'integrate_player_state', cb => integrate_player_state(app, tkey, btp_state, cb)),
				timed_btp_sync_task(tkey, 'integrate_umpires', cb => integrate_umpires(app, tkey, btp_state, cb)),
				timed_btp_sync_task(tkey, 'integrate_btp_scoring_formats', cb => integrate_btp_scoring_formats(app, tkey, btp_state, cb)),
				timed_btp_sync_task(tkey, 'integrate_locations', (scoring_formats, cb) => integrate_locations(app, tkey, btp_state, scoring_formats, cb)),
				timed_btp_sync_task(tkey, 'integrate_courts', (scoring_formats, location_map, cb) => integrate_courts(app, tkey, btp_state, scoring_formats, location_map, cb)),
				timed_btp_sync_task(tkey, 'integrate_matches', (scoring_formats, location_map, court_map, cb) => {
					btp_sync_state(app, tkey, options.expected_reset_ts).then((match_sync_state) => {
						if (!match_sync_state.ok) {
							log_btp_sync_skipped(tkey, match_sync_state.reason);
							sync_context.match_changes = false;
							sync_context.now_on_court_state_changes = false;
							cb(null);
							return;
						}
						integrate_matches(app, tkey, btp_state, scoring_formats, location_map, court_map, (err, result = {}) => {
							sync_context.match_changes = result.changes === true || result.updated > 0 || result.added > 0;
							sync_context.now_on_court_state_changes = result.now_on_court_state_changes === true;
							cb(err);
						}, { expected_reset_ts: options.expected_reset_ts });
					}).catch(cb);
				}),
				timed_btp_sync_task(tkey, 'normalize_sync_state', cb => normalize_sync_state(app, tkey).then(() => cb(null), cb)),
				timed_btp_sync_task(tkey, 'integrate_now_on_court', cb => {
					if (!sync_context.match_changes || !sync_context.now_on_court_state_changes) {
						return cb(null);
					}
					return integrate_now_on_court(app, tkey, cb);
				}),
				timed_btp_sync_task(tkey, 'cleanup_entities', cb => cleanup_entities(app, tkey, btp_state, cb)),
			], (err) => {
				log_btp_sync_timing(tkey, 'total', Date.now() - total_start_ms, btp_state_counts(btp_state));
				if (err) {
					return reject(err);
				}
				return resolve(true);
			});
		}).catch(reject);
	});
}

function sync_btp_data(app, tkey, response, options = {}) {
	return require('./btp_sync_plan').sync(app, tkey, response, { ...options, worker_operation: 'btp' }, integrate_btp_snapshot);
}

module.exports = {
	_integrate_snapshot: integrate_btp_snapshot,
	calculate_match_ids_on_court,
	craft_match,
	date_str,
	sync_btp_data,
	time_str,
	// test only
	_integrate_player_state: integrate_player_state,
	_integrate_events: integrate_events,
	_integrate_matches: integrate_matches,
	_integrate_courts: integrate_courts,
	_integrate_now_on_court: integrate_now_on_court,
	_parse_btp_court_num: parse_btp_court_num,
	_copy_checked_in_by_btp_id: copy_checked_in_by_btp_id,
	_setup_player_assignment_changed: setup_player_assignment_changed,
	_integrate_umpires: integrate_umpires,
	_fallback_scoring_format: fallbackScoringFormat,
	_normalize_scoring_format: normalizeScoringFormat,
	_merge_local_scoring_format: mergeLocalScoringFormat,
	_build_official_reference_state: buildOfficialReferenceState,
	_compute_official_visibility_patch: computeOfficialVisibilityPatch,
	_find_existing_official_for_btp_import: findExistingOfficialForBtpImport,
	_reconcile_match_officials: reconcile_match_officials,
	_normalize_sync_state: normalize_sync_state,
	_merge_local_match_into_btp_match: mergeLocalMatchIntoBtpMatch,
	_sanitize_scoring_format: sanitizeScoringFormat,
	_resolve_btp_dependency_link,
	_btp_match_confirms_pending_local_sync: btp_match_confirms_pending_local_sync,
	_btp_match_clears_local_special_result: btp_match_clears_local_special_result,
	_btp_match_clears_local_normal_result: btp_match_clears_local_normal_result,
	_find_hidden_empty_bye_branch_winner_candidates: find_hidden_empty_bye_branch_winner_candidates,
	_match_update_affects_now_on_court_state: match_update_affects_now_on_court_state,
	_player_assignment_change_affects_now_on_court_state: player_assignment_change_affects_now_on_court_state,
	_set_type_to_end_max: setTypeToEndMax,
	_normalize_stage_entry_for_event_payload: normalize_stage_entry_for_event_payload,
	_craft_team,
};
