'use strict';

const { isDeepStrictEqual: deep_equal } = require('util');
const profile_fields = require('../tournament_model/profile_fields');
// Player.state (regional association) can select a tablet operator team.
const player_profiles = new Set([...profile_fields].filter(field => field !== 'state'));

// Only known display fields may bypass relation locks. Ordering, eligibility,
// identities, check-ins, pauses and unknown fields keep the conservative scope.
const display_fields = new Set(['btp_group_rankings']);
const official_profiles = new Set(['name', 'firstname', 'surname', 'country']);
const groups = {
	participants: new Set(['teams', 'tabletoperators']),
	officials: new Set(['umpire', 'service_judge', 'suppressed_umpire_btp_id', 'suppressed_service_judge_btp_id']),
	court: new Set(['court_id', 'now_on_court', 'location_id', 'highlight']),
	state: new Set(['state', 'called_timestamp', 'preparation_call_timestamp', 'preparation_call_deferred',
		'needs_preparation_successor', 'needs_preparation_successor_ts', 'incomplete', 'is_match']),
	scheduling: new Set(['match_name', 'scheduled_date', 'scheduled_time_str', 'match_num', 'event_name', 'phase_block_key',
		'phase_name_raw', 'stage_id', 'stage_name', 'stage_type', 'stage_display_order', 'draw_id', 'draw_name', 'draw_position']),
	scoring: new Set(['counting', 'scoring_format', 'is_doubles', 'team_competition', 'warmup', 'warmup_ready', 'warmup_start']),
	links: new Set(['links']),
};
const without = (object, fields) => Object.fromEntries(Object.entries(object || {}).filter(([key]) => !fields.has(key)));
function team_dependencies(teams) {
	return (teams || []).map(team => ({ ...team,
		players: (team.players || []).map(player => without(player, player_profiles)),
	}));
}

function dependency_setup(setup) {
	return { ...without(setup, display_fields), teams: team_dependencies(setup?.teams) };
}

module.exports = function match_changes(before, after) {
	if (!before || !after) return ['lifecycle'];
	const reasons = new Set();
	if (!deep_equal(before.match_order, after.match_order)) reasons.add('scheduling');
	for (const field of ['end_ts', 'team1_won', 'btp_winner', 'btp_needsync', 'score_status', 'forward_loser', 'no_match_losing_team']) {
		if (!deep_equal(before[field], after[field])) reasons.add('result');
	}
	for (const field of ['btp_id', 'btp_match_ids', 'btp_player_ids']) {
		if (!deep_equal(before[field], after[field])) reasons.add('identity');
	}
	const old = before.setup || {};
	const next = after.setup || {};
	for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
		if (deep_equal(old[field], next[field]) || display_fields.has(field)) continue;
		if (field === 'teams' && deep_equal(team_dependencies(old.teams), team_dependencies(next.teams))) continue;
		if (['umpire', 'service_judge'].includes(field) && old[field] && next[field] &&
			deep_equal(without(old[field], official_profiles), without(next[field], official_profiles))) continue;
		const group = Object.keys(groups).find(key => groups[key].has(field));
		reasons.add(group || 'unknown_setup');
	}
	// Replacing/removing an entire setup remains an inventory change, even if
	// its only surviving fields happen to be display fields.
	if (!!before.setup !== !!after.setup) reasons.add('lifecycle');
	return [...reasons];
};

module.exports.dependency_setup = dependency_setup;
