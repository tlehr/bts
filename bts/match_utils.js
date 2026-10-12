'use_strict';

const SetupChanges = require('./match_updates/setup_changes');

const assert = require('assert');
const async = require('async');
const debug_flags = require('./debug_flags');
const update_queue = require('./update_queue');
const preparation_timing = require('./preparation_selection/timing');

const pending_preparation_selection_runs = new Map();
const pending_auto_call_on_court_runs = new Map();
const pending_technical_official_assignment_runs = new Map();
const pending_technical_official_pause_runs = new Map();
const pending_player_court_reconciliation_runs = new Map();
const active_match_call_locks = new Set();
const active_court_call_locks = new Set();
const active_preparation_call_locks = new Set();
const delayed_preparation_selection_runs = new Map();
let technical_official_pause_interval = null;
let player_court_reconciliation_interval = null;
let preparation_age_auto_call_interval = null;
let preparation_pause_auto_call_interval = null;
const PREPARATION_CALL_MIN_GAP_MS = 10 * 1000;
const AUTO_PREPARATION_SELECTION_DELAYED = Symbol('auto_preparation_selection_delayed');

function now_ms(app) {
	return app?.clock ? app.clock.now_ms() : Date.now();
}

function sleep_ms(app, ms) {
	if (ms <= 0) {
		return Promise.resolve();
	}
	if (app?.clock && typeof app.clock.sleep_ms === 'function') {
		return app.clock.sleep_ms(ms);
	}
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function preparation_call_gap_reservations(app) {
	if (!app._preparation_call_gap_reservations) {
		app._preparation_call_gap_reservations = new Map();
	}
	return app._preparation_call_gap_reservations;
}

function preparation_pause_auto_call_state(app) {
	if (!app._preparation_pause_auto_call_state) {
		app._preparation_pause_auto_call_state = new Map();
	}
	return app._preparation_pause_auto_call_state;
}

function setup_team_players(setup, team_index) {
	const teams = Array.isArray(setup?.teams) ? setup.teams : [];
	const team = teams[team_index];
	return Array.isArray(team?.players) ? team.players : [];
}

function setup_player_btp_ids(setup) {
	const ids = [];
	for (let team_index = 0; team_index < 2; team_index++) {
		for (const player of setup_team_players(setup, team_index)) {
			if (player?.btp_id != null && player.btp_id !== -1) {
				ids.push(player.btp_id);
			}
		}
	}
	return [...new Set(ids)];
}

function setup_tabletoperator_btp_ids(setup) {
	const tabletoperators = Array.isArray(setup?.tabletoperators) ? setup.tabletoperators : [];
	return [...new Set(tabletoperators.map((operator) => operator?.btp_id).filter((btp_id) => btp_id != null && btp_id !== -1))];
}

function setup_tabletoperators(setup) {
	return Array.isArray(setup?.tabletoperators) ? setup.tabletoperators : [];
}

function first_setup_player_state(setup) {
	for (let team_index = 0; team_index < 2; team_index++) {
		const player = setup_team_players(setup, team_index).find((entry) => entry?.state);
		if (player) {
			return player.state;
		}
	}
	return '';
}

function for_each_setup_player(setup, callback) {
	for (let team_index = 0; team_index < 2; team_index++) {
		setup_team_players(setup, team_index).forEach((player, player_index) => {
			callback(player, team_index, player_index);
		});
	}
}

function setup_has_player_on_court(setup) {
	let has_player_on_court = false;
	for_each_setup_player(setup, (player) => {
		if (player?.now_playing_on_court) {
			has_player_on_court = true;
		}
	});
	return has_player_on_court;
}

function release_blocked_match_if_no_players_on_court(setup) {
	if (!setup || setup.state !== 'blocked' || setup.now_on_court === true) {
		return false;
	}
	if (setup_has_player_on_court(setup)) {
		return false;
	}
	setup.state = 'scheduled';
	return true;
}

function log_missing_cleanup_context(context, tournament_key, match_id, match) {
	require('./server_diagnostics').log(null, tournament_key, '[bts] skipped match cleanup: missing match setup context', {
		context,
		tournament_key,
		match_id,
		has_match: !!match,
		has_setup: !!match?.setup,
	});
}

function is_tournament_automation_enabled(tournament) {
	return tournament?.automation_enabled !== false;
}

function get_court_sort_value(court) {
	const numeric_num = Number(court?.num);
	if (Number.isFinite(numeric_num)) {
		return { numeric: true, value: numeric_num };
	}
	return { numeric: false, value: String(court?.num || '') };
}

function cmp_court_order(c1, c2) {
	const a = get_court_sort_value(c1);
	const b = get_court_sort_value(c2);
	if (a.numeric && b.numeric) {
		return a.value - b.value;
	}
	return String(a.value).localeCompare(String(b.value), 'de', { numeric: true, sensitivity: 'base' });
}

function summarize_tabletoperator_entry(tabletoperator, index) {
	return {
		index,
		_id: tabletoperator?._id || null,
		start_ts: tabletoperator?.start_ts || null,
		played_on_court: tabletoperator?.played_on_court || null,
		names: (Array.isArray(tabletoperator?.tabletoperator) ? tabletoperator.tabletoperator : [])
			.map((participant) => participant && participant.name)
			.filter(Boolean),
		btp_ids: (Array.isArray(tabletoperator?.tabletoperator) ? tabletoperator.tabletoperator : [])
			.map((participant) => participant && participant.btp_id)
			.filter((btp_id) => btp_id != null),
	};
}

function build_free_court_order_debug(courts, tabletoperators, tournament, all_courts) {
	const free_courts = Array.isArray(courts) ? [...courts] : [];
	if (tournament?.tabletoperator_enabled !== true) {
		const sorted_courts = free_courts.sort(cmp_court_order);
		return {
			sorted_courts,
			scope: normalize_tabletoperator_assignment_scope(tournament),
			tabletoperator_enabled: false,
			waiting_tabletoperators: [],
			court_order: sorted_courts.map((court, index) => ({
				index,
				court_id: court?._id || null,
				court_num: court?.num ?? null,
				location_id: court?.location_id || null,
				reason: 'tabletoperator_disabled_court_order',
				exact_tabletoperator: null,
				location_tabletoperator: null,
			})),
		};
	}

	const free_court_ids = new Set(free_courts.map((court) => court?._id).filter(Boolean));
	const free_courts_by_location_id = new Map();
	const court_location_by_id = new Map();
	(Array.isArray(all_courts) ? all_courts : free_courts).forEach((court) => {
		if (court?._id && court.location_id) {
			court_location_by_id.set(court._id, court.location_id);
		}
	});
	free_courts.forEach((court) => {
		if (!court?._id) {
			return;
		}
		if (court.location_id) {
			if (!free_courts_by_location_id.has(court.location_id)) {
				free_courts_by_location_id.set(court.location_id, []);
			}
			free_courts_by_location_id.get(court.location_id).push(court._id);
		}
	});

	const exact_court_preference = new Map();
	const location_court_preference = new Map();
	const scope = normalize_tabletoperator_assignment_scope(tournament);

	const waiting_tabletoperators = (Array.isArray(tabletoperators) ? [...tabletoperators] : [])
		.filter((tabletoperator) => tabletoperator && tabletoperator.court == null)
		.sort((a, b) => Number(a.start_ts || 0) - Number(b.start_ts || 0));
	waiting_tabletoperators
		.forEach((tabletoperator, index) => {
			const summarized_tabletoperator = summarize_tabletoperator_entry(tabletoperator, index);
			const played_on_court = tabletoperator?.played_on_court;
			if (!played_on_court) {
				return;
			}
			if (free_court_ids.has(played_on_court) && !exact_court_preference.has(played_on_court)) {
				exact_court_preference.set(played_on_court, summarized_tabletoperator);
			}
			if (scope !== 'same_location') {
				return;
			}

			const played_location_id = court_location_by_id.get(played_on_court);
			if (!played_location_id) {
				return;
			}
			(free_courts_by_location_id.get(played_location_id) || []).forEach((court_id) => {
				if (!location_court_preference.has(court_id)) {
					location_court_preference.set(court_id, summarized_tabletoperator);
				}
			});
		});

	const sorted_courts = free_courts.sort((c1, c2) => {
		const exact_preference1 = exact_court_preference.has(c1?._id) ? exact_court_preference.get(c1._id).index : Number.POSITIVE_INFINITY;
		const exact_preference2 = exact_court_preference.has(c2?._id) ? exact_court_preference.get(c2._id).index : Number.POSITIVE_INFINITY;
		if (exact_preference1 !== exact_preference2) {
			return exact_preference1 - exact_preference2;
		}

		const location_preference1 = location_court_preference.has(c1?._id) ? location_court_preference.get(c1._id).index : Number.POSITIVE_INFINITY;
		const location_preference2 = location_court_preference.has(c2?._id) ? location_court_preference.get(c2._id).index : Number.POSITIVE_INFINITY;
		if (location_preference1 !== location_preference2) {
			return location_preference1 - location_preference2;
		}
		return cmp_court_order(c1, c2);
	});

	return {
		sorted_courts,
		scope,
		tabletoperator_enabled: true,
		waiting_tabletoperators: waiting_tabletoperators.map(summarize_tabletoperator_entry),
		court_order: sorted_courts.map((court, index) => {
			const exact_tabletoperator = exact_court_preference.get(court?._id) || null;
			const location_tabletoperator = location_court_preference.get(court?._id) || null;
			let reason = 'court_order';
			if (exact_tabletoperator) {
				reason = 'oldest_waiting_tabletoperator_played_on_this_court';
			} else if (location_tabletoperator) {
				reason = 'oldest_waiting_tabletoperator_played_in_this_location';
			}
			return {
				index,
				court_id: court?._id || null,
				court_num: court?.num ?? null,
				location_id: court?.location_id || null,
				reason,
				exact_tabletoperator,
				location_tabletoperator,
			};
		}),
	};
}

function sort_free_courts_for_auto_call(courts, tabletoperators, tournament, all_courts) {
	return build_free_court_order_debug(courts, tabletoperators, tournament, all_courts).sorted_courts;
}

function summarize_court_exclusion(court, occupied_sources) {
	const reasons = [];
	if (court?.is_active !== true) {
		reasons.push('inactive');
	}
	const occupied_source = court?._id ? occupied_sources.get(court._id) : null;
	if (occupied_source) {
		reasons.push(occupied_source.reason);
	}
	return {
		court_id: court?._id || null,
		court_num: court?.num ?? null,
		location_id: court?.location_id || null,
		is_active: court?.is_active === true,
		selected_for_scan: reasons.length === 0,
		reasons,
		occupied_by: occupied_source || null,
	};
}

function summarize_call_on_court_rejections(match_automation, tournament, court_id, matches, now_ts) {
	return (matches || [])
		.filter((match) => match?.setup?.state === 'preparation')
		.map((match) => {
			const diagnostics = match_automation.calculate_match_call_on_court_diagnostics(match, court_id, tournament, { now_ts });
			const failed_rules = (diagnostics.rules || [])
				.filter((rule) => rule && rule.enabled !== false && rule.passed !== true)
				.map((rule) => ({
					key: rule.key,
					group: rule.group || 'criteria',
					detail: rule.detail || null,
				}));
			return {
				match_id: match?._id || null,
				match_num: match?.setup?.match_num ?? null,
				event_name: match?.setup?.event_name || null,
				location_id: match?.setup?.location_id || null,
				preparation_call_timestamp: match?.setup?.preparation_call_timestamp || null,
				eligible: diagnostics.eligible === true,
				failed_rules,
			};
		});
}

function build_match_first_field_assignment_plan(potential_call_matches, court_candidate_entries) {
	const selected_court_ids = new Set();
	const selected_match_ids = new Set();
	const call_plan = [];
	const skipped_priority_matches = [];

	(Array.isArray(potential_call_matches) ? potential_call_matches : []).forEach((match) => {
		if (!match || !match._id || selected_match_ids.has(match._id)) {
			return;
		}
		const entry = (Array.isArray(court_candidate_entries) ? court_candidate_entries : []).find((candidate_entry) => {
			if (!candidate_entry?.court?._id || selected_court_ids.has(candidate_entry.court._id)) {
				return false;
			}
			return (candidate_entry.candidate_matches || []).some((candidate_match) => candidate_match && candidate_match._id === match._id);
		});
		if (!entry) {
			skipped_priority_matches.push({
				match_id: match._id,
				match_num: match?.setup?.match_num ?? null,
				reason: 'no_eligible_free_court',
			});
			return;
		}
		selected_court_ids.add(entry.court._id);
		selected_match_ids.add(match._id);
		call_plan.push({
			court: entry.court,
			match,
		});
	});

	return {
		call_plan,
		skipped_priority_matches,
	};
}

function get_tabletoperator_break_after_service_ms(tournament) {
	if (!tournament?.tabletoperator_set_break_after_tabletservice) {
		return 0;
	}
	const seconds = Number(tournament?.tabletoperator_break_seconds);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return 0;
	}
	return Math.round(seconds * 1000);
}

function get_tabletoperator_ready_ts_after_service(tournament, end_ts) {
	const base_ts = Number(end_ts);
	if (!Number.isFinite(base_ts)) {
		return end_ts;
	}
	return base_ts + get_tabletoperator_break_after_service_ms(tournament);
}

function normalize_tabletoperator_assignment_scope(tournament) {
	const scope = tournament?.tabletoperator_assignment_scope;
	if (scope === 'same_location' || scope === 'same_court') {
		return scope;
	}
	return 'any';
}

function is_manual_tabletoperator_entry(tabletoperator_entry) {
	return !tabletoperator_entry?.played_on_court;
}

async function build_court_location_map(app, tournament_key) {
	const courts = await app.db.courts.find_async({ tournament_key });
	const result = new Map();
	(Array.isArray(courts) ? courts : []).forEach((court) => {
		if (court?._id && court.location_id) {
			result.set(court._id, court.location_id);
		}
	});
	return result;
}

async function select_tabletoperator_for_court(app, tournament, tabletoperators, court_id) {
	const candidates = Array.isArray(tabletoperators) ? tabletoperators : [];
	if (candidates.length < 1) {
		return null;
	}

	const scope = normalize_tabletoperator_assignment_scope(tournament);
	if (scope === 'any' || !court_id || court_id === 'prep_call') {
		return candidates[0];
	}

	const manual_candidates = candidates.filter(is_manual_tabletoperator_entry);
	const played_candidates = candidates.filter((entry) => !is_manual_tabletoperator_entry(entry));
	if (scope === 'same_court') {
		return played_candidates.find((entry) => entry.played_on_court === court_id)
			|| manual_candidates[0]
			|| null;
	}

	const court_location_by_id = await build_court_location_map(app, tournament.key);
	const target_location_id = court_location_by_id.get(court_id);
	if (!target_location_id) {
		return manual_candidates[0] || null;
	}

	return played_candidates.find((entry) => court_location_by_id.get(entry.played_on_court) === target_location_id)
		|| manual_candidates[0]
		|| null;
}

function get_technical_official_break_after_assignment_ms(tournament) {
	const seconds = Number(tournament?.technical_official_break_after_assignment_seconds);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return 0;
	}
	return Math.round(seconds * 1000);
}

function is_technical_official_unavailable(official) {
	if (!official) {
		return true;
	}
	return official.umpire_pause != null ||
		official.service_judge_pause != null ||
		official.umpire_manual_pause != null ||
		official.service_judge_manual_pause != null ||
		official.inactive_list != null;
}

function get_effective_technical_official_checked_in(official, tournament_or_btp_settings) {
	if (!official) {
		return false;
	}
	const btp_settings = tournament_or_btp_settings?.btp_settings || tournament_or_btp_settings || {};
	if (btp_settings.check_in_per_match === false) {
		return !is_technical_official_unavailable(official);
	}
	return !!official.checked_in;
}

function sync_technical_official_checked_in(official, tournament_or_btp_settings) {
	if (!official) {
		return official;
	}
	official.checked_in = get_effective_technical_official_checked_in(official, tournament_or_btp_settings);
	return official;
}

function match_needs_technical_official_assignment(match, tournament) {
	if (!match || !match.setup) {
		return false;
	}
	if ((tournament?.official_rotation_mode || 'umpire_and_service_judge') === 'disabled') {
		return false;
	}
	if (!match.setup.umpire) {
		return true;
	}
	if ((tournament?.official_rotation_mode || 'umpire_and_service_judge') !== 'umpire_and_service_judge') {
		return false;
	}
	return !match.setup.service_judge;
}

async function match_update(app, match, old_court, callback) {
	async.waterfall([	
			(wcb) => update_match_btp(app, match, wcb), 
			(wcb) => update_match_db(app, match, wcb),
			(wcb) => notify_change_match_edit(app, match, wcb),
			(wcb) => notify_bupws(app, match, old_court, wcb),
		],
		(err) => {
			return callback(err);
		}
	);
}

async function uncall_match(app, tournament, match, old_court, callback) {
	// Imports

	// Requrements

	async.waterfall([	(wcb) => remove_called_timestamp(match, wcb),
		(wcb) => remove_tablet_on_court(app, tournament.key, match._id, null, wcb),
		(wcb) => remove_tablet_operator_to_list(app, tournament.key, match, wcb),
		(wcb) => update_match_btp(app, match, wcb), 
		(wcb) => update_match_db(app, match, wcb),
		(wcb) => update_court_db(app, match, wcb),
		(wcb) => notify_change_match_edit(app, match, wcb),
		(wcb) => notify_bupws(app, match, old_court, wcb),
		(wcb) => remove_player_on_court(app, tournament.key, match._id, null, wcb),
		(wcb) => update_btp_courts(app, tournament.key, match, wcb)],
		(err) => {
			return callback(err);
		}
	);
}


async function call_match(app, tournament, match, old_court, callback, options = {}) {
    if (!match.setup.court_id || !match._id) {
		return callback("Match cannot be called court_id or _id not given.");
    }
	if (match_completly_initialized(match.setup) == false) { 
		return callback("Match cannot be called one or more Teams are not set.");
	}
	const call_lock = acquire_match_call_lock(match);
	if (call_lock.error) {
		return callback(call_lock.error);
	}
	debug_flags.log(app, tournament && tournament.key, '[bts] auto_call_trace:call_match_start', {
		ts: now_ms(app),
		tournament_key: tournament && tournament.key,
		match_id: match._id,
		match_num: match?.setup?.match_num ?? null,
		court_id: match.setup && match.setup.court_id,
		old_court,
		state: match.setup && match.setup.state,
		now_on_court: match.setup && match.setup.now_on_court,
	});
	const finish_call = (err, updated_match) => {
		call_lock.release();
		debug_flags.log(app, tournament && tournament.key, '[bts] auto_call_trace:call_match_end', {
			ts: now_ms(app),
			tournament_key: tournament && tournament.key,
			match_id: (updated_match || match) && (updated_match || match)._id,
			match_num: (updated_match || match)?.setup?.match_num ?? null,
			court_id: (updated_match || match) && (updated_match || match).setup && (updated_match || match).setup.court_id,
			called_timestamp: (updated_match || match) && (updated_match || match).setup && (updated_match || match).setup.called_timestamp,
			error: err ? (err.message || String(err)) : null,
		});
		return callback(err, updated_match || match);
	};
	app.db.matches.findOne({ _id: match._id, tournament_key: tournament.key }, (currentErr, current_match) => {
		if (currentErr) {
			return finish_call(currentErr);
		}
		const current_setup = current_match?.setup || {};
		require('./match_entry_status').preserve(current_match, match);
		const dns_error = require('../static/js/btp_entry_status').call_error(current_match || match) ||
			require('../static/js/btp_entry_status').call_error(match);
		if (dns_error) return finish_call(dns_error);
		const current_is_finished = current_match &&
			(typeof current_match.team1_won === 'boolean' || current_setup.state === 'finished' || current_match.btp_winner);
		const already_called_on_same_court = current_match &&
			current_setup.now_on_court === true &&
			current_setup.court_id === match.setup.court_id &&
			current_setup.called_timestamp &&
			!current_is_finished;
		if (already_called_on_same_court) {
			debug_flags.log(app, tournament && tournament.key, '[bts] auto_call_trace:call_match_already_called', {
				ts: now_ms(app),
				tournament_key: tournament && tournament.key,
				match_id: match._id,
				court_id: match.setup.court_id,
				called_timestamp: current_setup.called_timestamp,
			});
			return finish_call(null, current_match);
		}
		if (current_is_finished && options.reactivate !== true) {
			return finish_call(new Error('Match ' + match._id + ' is already finished and cannot be called.'));
		}
	async.waterfall([	(wcb) => ensure_match_not_already_on_other_court(app, tournament.key, match, wcb),
		(wcb) => ensure_court_available_for_match(app, tournament.key, match, wcb),
		(wcb) => {
			if (options.reactivate !== true) return wcb(null);
			require('./match_reactivation')(app, tournament, match, (err, reactivated) => {
				if (err) return wcb(err);
				match = reactivated;
				wcb(null);
			});
		},
		(wcb) => add_called_timestamp(app, match, wcb),
		(wcb) => auto_assign_technical_officials_for_match(app, tournament, match._id, (assignErr) => {
			if (assignErr) {
				return wcb(assignErr);
			}
			app.db.matches.findOne({ _id: match._id, tournament_key: tournament.key }, (reloadErr, refreshed_match) => {
				if (reloadErr) {
					return wcb(reloadErr);
				}
				if (refreshed_match) {
					// Preserve transient on-court fields that are only persisted later in this waterfall.
					refreshed_match.setup = refreshed_match.setup || {};
					refreshed_match.setup.court_id = match.setup.court_id;
					refreshed_match.setup.now_on_court = match.setup.now_on_court;
					refreshed_match.setup.called_timestamp = match.setup.called_timestamp;
					refreshed_match.setup.state = match.setup.state;
					match = refreshed_match;
				}
				return wcb(null);
			});
		}, { allow_on_match_call: true }),
		(wcb) => drop_unsupported_court_officials(app, tournament, match, wcb),
		(wcb) => add_tabletoperators(app, tournament, match, wcb),
		(wcb) => set_umpires_on_court(app, tournament, match, wcb),
		(wcb) => remove_highlight_preparation(match, wcb),
		(wcb) => update_match_btp(app, match, wcb),
		(wcb) => update_match_db(app, match, wcb),
		(wcb) => update_court_db(app, match, wcb),
		(wcb) => notify_change_match_edit(app, match, wcb),
		(wcb) => notify_bupws(app, match, old_court, wcb),
		(wcb) => notify_change_match_called_on_court(app, match, wcb),
		(wcb) => set_player_on_court(app, tournament.key, match, wcb),
		(wcb) => set_player_on_tablet(app, tournament.key, match.setup, wcb),
		(wcb) => update_btp_courts(app, tournament.key, match, wcb),
		(wcb) => auto_execute_preparation_selection_for_setup(app, tournament, match.setup, wcb)],
		(err) => {
			return finish_call(err, match);
		}
	);
	});
}

function acquire_match_call_lock(match) {
	const match_id = match?._id;
	const court_id = match?.setup?.court_id;
	if (!match_id || !court_id) {
		return {
			error: new Error('Match cannot be called court_id or _id not given.'),
			release: () => {},
		};
	}
	const match_key = String(match_id);
	const court_key = String(court_id);
	if (active_match_call_locks.has(match_key)) {
		return {
			error: new Error('Match ' + match_id + ' is already being called.'),
			release: () => {},
		};
	}
	if (active_court_call_locks.has(court_key)) {
		return {
			error: new Error('Court ' + court_id + ' is already receiving a match call.'),
			release: () => {},
		};
	}
	active_match_call_locks.add(match_key);
	active_court_call_locks.add(court_key);
	let released = false;
	return {
		error: null,
		release: () => {
			if (released) {
				return;
			}
			released = true;
			active_match_call_locks.delete(match_key);
			active_court_call_locks.delete(court_key);
		},
	};
}

function acquire_preparation_call_lock(match_id) {
	if (!match_id) {
		return {
			error: new Error('Match cannot be called in preparation without _id.'),
			release: () => {},
		};
	}
	const key = String(match_id);
	if (active_preparation_call_locks.has(key)) {
		return {
			error: new Error('Match ' + match_id + ' is already being called in preparation.'),
			release: () => {},
		};
	}
	active_preparation_call_locks.add(key);
	let released = false;
	return {
		error: null,
		release: () => {
			if (released) {
				return;
			}
			released = true;
			active_preparation_call_locks.delete(key);
		},
	};
}

async function switch_court(app, tournament, match, old_court, callback) {
	if (!match.setup.court_id || !match._id) {
		return callback("Match cannot be switched to another court: court_id or _id not given.");
    }
	if (match_completly_initialized(match.setup) == false) { 
		return callback("Match cannot be switched to another court: one or more Teams are not set.");
	}
	async.waterfall([
		(wcb) => ensure_court_available_for_match(app, tournament.key, match, wcb),
		(wcb) => add_tabletoperators(app, tournament, match, wcb),
		(wcb) => set_umpires_on_court(app, tournament, match, wcb),
		(wcb) => remove_highlight_preparation(match, wcb),
		(wcb) => update_match_btp(app, match, wcb),
		(wcb) => update_match_db(app, match, wcb),
		(wcb) => update_court_db(app, match, wcb),
		(wcb) => notify_change_match_edit(app, match, wcb),
		(wcb) => notify_bupws(app, match, old_court, wcb),
		(wcb) => notify_change_match_called_on_court(app, match, wcb),
		(wcb) => set_player_on_court(app, tournament.key, match, wcb),
		(wcb) => set_player_on_tablet(app, tournament.key, match.setup, wcb),
		(wcb) => update_btp_courts(app, tournament.key, match, wcb)
		],
		(err) => {
			return callback(err, match);
		}
	);
}

function match_completly_initialized(setup) {
	if (
		!setup ||
		setup_team_players(setup, 0).length == 0 ||
		setup_team_players(setup, 1).length == 0
	) {
		return false;
	}
	return true;
}

function ensure_court_available_for_match(app, tournament_key, match, callback) {
	const court_id = match?.setup?.court_id;
	const match_id = match?._id;
	if (!court_id || !match_id) {
		return callback("Match cannot be called court_id or _id not given.");
	}

	app.db.matches.find({
		tournament_key,
		'setup.now_on_court': true,
		'setup.court_id': court_id,
	}, (err, matches) => {
		if (err) {
			return callback(err);
		}
		const blocking_match = (matches || []).find((candidate) => {
			return candidate &&
				candidate._id !== match_id &&
				candidate?.setup?.now_on_court === true &&
				candidate?.setup?.court_id === court_id &&
				typeof candidate.team1_won !== 'boolean';
		});
		if (blocking_match) {
			return callback(new Error('Court ' + court_id + ' is already occupied by match ' + blocking_match._id));
		}
		return callback(null);
	});
}

function ensure_match_not_already_on_other_court(app, tournament_key, match, callback) {
	const court_id = match?.setup?.court_id;
	const match_id = match?._id;
	if (!court_id || !match_id) {
		return callback("Match cannot be called court_id or _id not given.");
	}

	app.db.matches.findOne({ tournament_key, _id: match_id }, (err, current_match) => {
		if (err) {
			return callback(err);
		}
		const current_setup = current_match?.setup || {};
		if (
			current_match &&
			current_setup.now_on_court === true &&
			current_setup.court_id &&
			current_setup.court_id !== court_id &&
			typeof current_match.team1_won !== 'boolean'
		) {
			return callback(new Error('Match ' + match_id + ' is already on court ' + current_setup.court_id));
		}
		return callback(null);
	});
}

	function add_called_timestamp(app, match, callback) {
		const setup = match.setup;
		const called_timestamp = now_ms(app);
		setup.called_timestamp = called_timestamp;
		setup.state = 'oncourt';
		delete setup.preparation_call_deferred;
		remove_preparation_call_timestamp(setup);
		return callback(null);
	}

function remove_called_timestamp(match, callback) {
	const setup = match.setup;
	setup.called_timestamp = undefined;
	setup.state = 'scheduled';
	return callback(null);
}

function normalize_preparation_state(setup) {
	if (!setup) {
		return setup;
	}
	if (Number(setup.highlight) > 0) {
		return setup;
	}
	if (setup.state === 'preparation') {
		setup.state = 'scheduled';
	}
	if (setup.preparation_call_timestamp != null) {
		setup.preparation_call_timestamp = undefined;
	}
	return setup;
}

function latest_preparation_call_timestamp(app, tournament_key) {
	return new Promise((resolve, reject) => {
		const captured = (err, matches) => {
			if (err) {
				return reject(err);
			}
			let latest_ts = 0;
			for (const match of matches || []) {
				const preparation_ts = Number(match?.setup?.preparation_call_timestamp);
				if (Number.isFinite(preparation_ts) && preparation_ts > latest_ts) {
					latest_ts = preparation_ts;
				}
			}
			return resolve(latest_ts);
		};
		const reads = require('./preparation_selection/model_reads');
		if (reads.supported(app, 'matches', true)) reads.read(app, tournament_key, 'matches', true)
			.then(matches => captured(null, matches), captured);
		else app.db.matches.find({ tournament_key }, captured);
	});
}

function preparation_call_min_gap_ms(tournament) {
	const configured_seconds = Number(tournament && tournament.preparation_call_min_gap_seconds);
	if (Number.isFinite(configured_seconds) && configured_seconds >= 0) {
		return configured_seconds * 1000;
	}
	return PREPARATION_CALL_MIN_GAP_MS;
}

async function wait_for_preparation_call_gap(app, tournament) {
	const tournament_key = typeof tournament === 'string' ? tournament : tournament && tournament.key;
	const min_gap_ms = preparation_call_min_gap_ms(tournament);
	if (!tournament_key || min_gap_ms <= 0) {
		return now_ms(app);
	}
	const latest_ts = await latest_preparation_call_timestamp(app, tournament_key);
	const reservations = preparation_call_gap_reservations(app);
	const reserved_latest_ts = Number(reservations.get(tournament_key)) || 0;
	const target_ts = Math.max(now_ms(app), latest_ts + min_gap_ms, reserved_latest_ts + min_gap_ms);
	reservations.set(tournament_key, target_ts);
	const wait_ms = target_ts - now_ms(app);
	if (wait_ms > 0) {
		await sleep_ms(app, wait_ms);
	}
	return target_ts;
}

async function get_preparation_call_gap_wait_ms(app, tournament) {
	const tournament_key = typeof tournament === 'string' ? tournament : tournament && tournament.key;
	const min_gap_ms = preparation_call_min_gap_ms(tournament);
	if (!tournament_key || min_gap_ms <= 0) {
		return 0;
	}
	const latest_ts = await latest_preparation_call_timestamp(app, tournament_key);
	const next_allowed_ts = latest_ts + min_gap_ms;
	return Math.max(0, next_allowed_ts - now_ms(app));
}

function schedule_auto_execute_preparation_selection_after_gap(app, tournament_key, wait_ms) {
	if (!app || !app.db || !tournament_key) {
		return;
	}
	const delay_ms = Math.max(0, Math.ceil(Number(wait_ms) || 0));
	const due_ts = Date.now() + delay_ms;
	const existing = delayed_preparation_selection_runs.get(tournament_key);
	if (existing && existing.due_ts <= due_ts) {
		return;
	}
	if (existing && existing.timer) {
		clearTimeout(existing.timer);
	}
	const timer = setTimeout(() => {
		delayed_preparation_selection_runs.delete(tournament_key);
		queue_auto_execute_preparation_selections(app, tournament_key);
	}, delay_ms);
	if (typeof timer.unref === 'function') {
		timer.unref();
	}
	delayed_preparation_selection_runs.set(tournament_key, {
		timer,
		due_ts,
	});
	debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_execute_preparation_selection_delayed_for_gap', {
		ts: now_ms(app),
		tournament_key,
		wait_ms: delay_ms,
	});
}

function add_preparation_call_timestamp(app, tournament_key, setup, location_id, timestamp = null) {
	return new Promise((resolve) => {
		const stournament = require('./stournament');
		
		stournament.get_locations(app.db, tournament_key, (err, all_locations) => {
			for (const location of all_locations) {
				if (location._id == location_id) {
							setup.highlight = location.highlight;
							setup.location_id = location_id;
							setup.preparation_call_timestamp = timestamp == null ? now_ms(app) : timestamp;
							setup.state = 'preparation';
							delete setup.court_id;
							delete setup.preparation_call_deferred;
							resolve(setup);
							return;
					}
			}
			serror.silent("Can't call a match in preparation for location ' + location_id.");
			setup.highlight = 0;
			resolve(setup);
		});
	});
}

function resolve_location_id_for_setup(app, tournament_key, setup, callback) {
	if (setup && setup.location_id) {
		return callback(null, setup.location_id);
	}
	if (!(setup && setup.court_id)) {
		return callback(null, null);
	}
	app.db.courts.findOne({ tournament_key, _id: setup.court_id }, (err, court) => {
		if (err) return callback(err);
		return callback(null, court ? court.location_id : null);
	});
}

function enabled_failed_preparation_rules(diagnostics) {
	return (diagnostics?.rules || []).filter((rule) => rule && rule.enabled !== false && rule.passed !== true);
}

function find_self_blocked_waiting_tabletoperator_match(selection) {
	if (!selection || Number(selection.effective_missing_preparation_count || 0) <= 0) {
		return null;
	}
	if ((selection.auto_selected_matches || []).length > 0) {
		return null;
	}
	const match = selection.frontier || selection.display_frontier || null;
	if (!match || match._id == null) {
		return null;
	}
	const diagnostics = selection.diagnostics_by_match_id && selection.diagnostics_by_match_id[match._id];
	const failed_rules = enabled_failed_preparation_rules(diagnostics);
	const allowed_self_block_rules = new Set(['not_waiting_tabletoperator', 'not_active_tabletoperator']);
	if (
		failed_rules.length === 0 ||
		!failed_rules.some((rule) => rule.key === 'not_waiting_tabletoperator') ||
		failed_rules.some((rule) => !allowed_self_block_rules.has(rule.key))
	) {
		return null;
	}
	return match;
}

function remove_match_players_from_waiting_tabletoperator_list(app, tournament_key, match, callback) {
	const match_player_ids = new Set(
		setup_player_btp_ids(match?.setup)
			.map((btp_id) => Number(btp_id))
			.filter((btp_id) => Number.isFinite(btp_id) && btp_id !== -1)
	);
	if (match_player_ids.size === 0) {
		return callback(null, { removed: false });
	}

	const admin = require('./admin');
	app.db.tabletoperators.find({ tournament_key, court: null }, (err, tabletoperators) => {
		if (err) {
			return callback(err);
		}

		const removed_participants = [];
		const changed_entry_ids = [];
		async.eachSeries(tabletoperators || [], (entry, cb) => {
			if (!entry || !Array.isArray(entry.tabletoperator)) {
				return cb(null);
			}
			const removed = [];
			const kept = [];
			entry.tabletoperator.forEach((participant) => {
				const participant_btp_id = Number(participant && participant.btp_id);
				if (Number.isFinite(participant_btp_id) && match_player_ids.has(participant_btp_id)) {
					removed.push(participant);
				} else {
					kept.push(participant);
				}
			});
			if (removed.length === 0) {
				return cb(null);
			}
			removed_participants.push(...removed);
			changed_entry_ids.push(entry._id);

			const update = kept.length > 0
				? { $set: { tabletoperator: kept } }
				: { $set: { court: -1, end_ts: now_ms(app) } };
			app.db.tabletoperators.update(
				{ _id: entry._id, tournament_key },
				update,
				{ returnUpdatedDocs: true },
				(update_err, _numAffected, changed_tabletoperator) => {
					if (update_err) {
						return cb(update_err);
					}
					if (changed_tabletoperator) {
						admin.notify_change(app, tournament_key, 'tabletoperator_removed', { tabletoperator: changed_tabletoperator });
					}
					return cb(null);
				}
			);
		}, (each_err) => {
			if (each_err) {
				return callback(each_err);
			}
			const removed_btp_ids = [...new Set(removed_participants
				.map((participant) => Number(participant && participant.btp_id))
				.filter((btp_id) => Number.isFinite(btp_id) && btp_id !== -1))];
			const result = {
				removed: removed_participants.length > 0,
				removed_btp_ids,
				removed_names: removed_participants.map((participant) => participant && participant.name).filter(Boolean),
				changed_entry_ids,
			};
			if (removed_btp_ids.length === 0 || typeof admin._release_tabletoperator_player_flags !== 'function') {
				return callback(null, result);
			}
			return admin._release_tabletoperator_player_flags(app, tournament_key, removed_btp_ids, (release_err) => {
				if (release_err) {
					return callback(release_err);
				}
				return callback(null, result);
			});
		});
	});
}

function auto_execute_preparation_selection(app, tournament, location_id, callback, options = {}) {
	if (!tournament || !tournament.key || !location_id) {
		return callback(null);
	}
	if (!is_tournament_automation_enabled(tournament)) {
		return callback(null);
	}
	if (!tournament.call_preparation_matches_automatically_enabled) {
		return callback(null);
	}

	const match_automation = require('./match_automation');
	const timing = options.timing || preparation_timing.start(tournament.key, 'location_preparation');
	const original_callback = callback;
	callback = err => {
		if (!options.timing) timing?.finish(err, { location_id });
		original_callback(err);
	};
	match_automation.fetch_location_preparation_selection(app, tournament.key, location_id, {
		now_ts: now_ms(app),
		preparation_timing: timing,
		automatic_only: require('./offload/profile').enabled('preparation_candidates'),
	})
		.then((selection) => {
			const summarize_match = (match) => match ? {
				_id: match._id,
				match_num: match?.setup?.match_num,
				event_name: match?.setup?.event_name,
				phase_block_key: match?.setup?.phase_block_key,
				state: match?.setup?.state,
				scheduled_date: match?.setup?.scheduled_date,
				scheduled_time_str: match?.setup?.scheduled_time_str,
			} : null;
				debug_flags.log(app, tournament.key, '[bts] auto_call_trace:auto_execute_preparation_selection', {
					ts: now_ms(app),
					tournament_key: tournament.key,
					location_id,
					required_preparation_count: selection && selection.required_preparation_count,
					current_preparation_count: selection && selection.current_preparation_count,
					missing_preparation_count: selection && selection.missing_preparation_count,
					effective_required_preparation_count: selection && selection.effective_required_preparation_count,
					effective_missing_preparation_count: selection && selection.effective_missing_preparation_count,
					frontier: summarize_match(selection && selection.frontier),
					display_frontier: summarize_match(selection && selection.display_frontier),
					display_candidates: (selection && selection.display_candidates || []).map(summarize_match),
					candidates: (selection && selection.candidates || []).map(summarize_match),
					selected_matches: (selection && selection.selected_matches || []).map(summarize_match),
					auto_selected_matches: (selection && selection.auto_selected_matches || []).map(summarize_match),
				});
				const self_blocked_match = options.resolved_waiting_tabletoperator_self_block !== true
					? find_self_blocked_waiting_tabletoperator_match(selection)
					: null;
					if (self_blocked_match) {
						const resolved = timing?.step('resolve_waiting_tabletoperator', { location_id });
						return remove_match_players_from_waiting_tabletoperator_list(app, tournament.key, self_blocked_match, (remove_err, result) => {
							resolved?.(remove_err, { removed: result?.removed === true });
							if (remove_err) {
								return callback(remove_err);
							}
							if (!result || result.removed !== true) {
								return execute_auto_selected_preparation_matches(app, tournament, location_id, selection.auto_selected_matches || [], callback, timing);
							}
						debug_flags.log(app, tournament.key, '[bts] auto_call_trace:removed_self_blocking_tabletoperator', {
							ts: now_ms(app),
							tournament_key: tournament.key,
							location_id,
							match_id: self_blocked_match._id,
							match_num: self_blocked_match?.setup?.match_num,
							removed_btp_ids: result.removed_btp_ids || [],
							removed_names: result.removed_names || [],
							changed_entry_ids: result.changed_entry_ids || [],
						});
						return auto_execute_preparation_selection(app, tournament, location_id, callback, {
							...options,
								timing,
							resolved_waiting_tabletoperator_self_block: true,
						});
					});
					}
					execute_auto_selected_preparation_matches(app, tournament, location_id, selection.auto_selected_matches || [], callback, timing);
			})
			.catch((err) => callback(err));
}

function execute_auto_selected_preparation_matches(app, tournament, location_id, matches, callback, timing) {
	const executed = timing?.step('execute_preparation_calls', { location_id, selected_matches: (matches || []).length });
	async.eachSeries(matches || [], (match, cb) => {
		get_preparation_call_gap_wait_ms(app, tournament)
			.then((wait_ms) => {
				if (wait_ms > 0) {
					schedule_auto_execute_preparation_selection_after_gap(app, tournament.key, wait_ms);
					return cb(AUTO_PREPARATION_SELECTION_DELAYED);
				}
				call_match_in_preparation(app, tournament, match, location_id, cb, {
					automatic_preparation_call: true,
					preparation_call_gap_checked: true,
				});
			})
			.catch(cb);
	}, (err) => {
		executed?.(err === AUTO_PREPARATION_SELECTION_DELAYED ? null : err, { delayed_by_call_gap: err === AUTO_PREPARATION_SELECTION_DELAYED });
		if (err === AUTO_PREPARATION_SELECTION_DELAYED) {
			return callback(null);
		}
		return callback(err);
	});
}

function auto_execute_preparation_selections(app, tournament, callback, options = {}) {
	if (!tournament || !tournament.key) {
		return callback(null);
	}
	if (!is_tournament_automation_enabled(tournament)) {
		return callback(null);
	}
	if (!tournament.call_preparation_matches_automatically_enabled) {
		return callback(null);
	}

	const timing = options.timing || preparation_timing.start(tournament.key);
	const done = (err, details) => {
		timing?.annotate(details);
		if (!options.timing) timing?.finish(err, details);
		callback(err);
	};
	require('./preparation_selection/status').inspect(app, tournament, timing).then(({ locations, runnable_locations, read_source }) => {
		if (runnable_locations.length === 0) {
			debug_flags.log(app, tournament.key, '[bts] auto_call_trace:auto_execute_preparation_selections_fast_skip', {
				ts: now_ms(app), tournament_key: tournament.key, location_count: locations.length,
			});
			return done(null, { reason: 'enough_preparation', read_source, runnable_locations: 0 });
		}
		async.eachSeries(runnable_locations, (location, cb) => {
			return auto_execute_preparation_selection(app, tournament, location._id, cb, { timing });
		}, err => done(err, { reason: 'selection_executed', read_source, runnable_locations: runnable_locations.length }));
	}).catch(err => done(err));
}

function auto_execute_preparation_selection_for_setup(app, tournament, setup, callback) {
	if (!tournament || !tournament.key) {
		return callback(null);
	}
	// A successful explicit call must not await selection of other matches.
	// The queued follow-up reads fresh state under selection/allocation locks;
	// planners capture it as a deferred job and run it only after commit.
	if (is_tournament_automation_enabled(tournament) && (tournament.call_preparation_matches_automatically_enabled ||
		(tournament.technical_official_auto_assignment_mode || 'manual_only') === 'when_available')) {
		queue_auto_execute_preparation_selections(app, tournament.key);
	}
	return callback(null);
}

function queue_auto_execute_preparation_selections(app, tournament_key, callback) {
	if (require('./btp_sync_effects').capture(app, real_app => queue_auto_execute_preparation_selections(real_app, tournament_key), { deferred_job: true },
		{ target: 'match_utils', method: 'queue_auto_execute_preparation_selections', args: [tournament_key] })) {
		if (callback) callback(null);
		return;
	}
	if (!app || !app.db || !tournament_key) {
		if (callback) {
			callback(null);
		}
		return;
	}

	const pending = pending_preparation_selection_runs.get(tournament_key);
	if (pending) {
		if (callback) {
			pending.callbacks.push(callback);
		}
		return;
	}

	const state = {
		callbacks: callback ? [callback] : [],
	};
	pending_preparation_selection_runs.set(tournament_key, state);

	const task = update_queue.locks([
		update_queue.lock_keys.selection(tournament_key),
		update_queue.lock_keys.preparation(tournament_key),
		update_queue.lock_keys.tabletoperators(tournament_key),
		update_queue.lock_keys.umpires(tournament_key),
	], update_queue.named('auto_execute_preparation_selections', () => new Promise((resolve, reject) => {
		const timing = preparation_timing.start(tournament_key, 'queued_preparation');
		const loaded = timing?.step('read_tournament');
		const captured = (err, tournament) => {
			loaded?.(err, { found: !!tournament });
			if (err) {
				timing?.finish(err);
				return reject(err);
			}
			if (!tournament) {
				const missing = new Error('Cannot find tournament ' + tournament_key);
				timing?.finish(missing);
				return reject(missing);
			}
			return auto_execute_preparation_selections(app, tournament, (execErr) => {
				timing?.finish(execErr);
				if (execErr) {
					return reject(execErr);
				}
				return resolve(true);
			}, { timing });
		};
		const reads = require('./preparation_selection/model_reads');
		if (reads.supported(app, 'tournaments', true)) reads.read(app, tournament_key, 'tournaments', true)
			.then(tournament => captured(null, tournament), captured);
		else app.db.tournaments.findOne({ key: tournament_key }, captured);
	})));

	update_queue.instance().execute(task).then(() => {
		const current = pending_preparation_selection_runs.get(tournament_key);
		pending_preparation_selection_runs.delete(tournament_key);
		queue_auto_assign_technical_officials_when_available(app, tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(null));
	}).catch((err) => {
		const current = pending_preparation_selection_runs.get(tournament_key);
		pending_preparation_selection_runs.delete(tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(err));
		console.warn('[bts] failed to queue auto_execute_preparation_selections', err && (err.stack || err.message || String(err)));
	});
}

function score_update_should_trigger_auto_preparation(match, preparation_successor_state, finish_confirmed) {
	if (finish_confirmed === true) {
		return true;
	}
	if (!preparation_successor_state || preparation_successor_state.needs_preparation_successor !== true) {
		return false;
	}
	return match?.setup?.needs_preparation_successor !== true;
}

function technical_official_auto_assignment_mode_supports_preparation(mode) {
	return mode === 'on_preparation_call' || mode === 'when_available';
}

function technical_official_auto_assignment_mode_supports_match_call(mode) {
	return mode === 'on_match_call_if_possible' || mode === 'on_preparation_call' || mode === 'when_available';
}

function build_official_wait_reentry_set_obj(role, ts) {
	const setObj = {
		inactive_list: null,
		service_judge_pause: null,
		umpire_pause: null,
		service_judge_manual_pause: null,
		umpire_manual_pause: null,
		service_judge_wait: null,
		umpire_wait: null,
		service_judge_on_court: null,
		umpire_on_court: null,
		is_planed_as_service_judge: false,
		is_planed_as_umpire: false,
	};
	if (role === 'umpire') {
		setObj.umpire_wait = ts;
	} else if (role === 'service_judge') {
		setObj.service_judge_wait = ts;
	}
	return setObj;
}

function drop_unsupported_court_officials(app, tournament, match, callback) {
	if (!match?.setup?.court_id) {
		return callback(null);
	}

	app.db.courts.findOne({ tournament_key: tournament.key, _id: match.setup.court_id }, (courtErr, court) => {
		if (courtErr) {
			return callback(courtErr);
		}
		if (!court) {
			return callback(null);
		}

		const admin = require('./admin');
		const setup = match.setup || {};
		const releases = [];
		if (court.has_umpire === false && setup.umpire) {
			const official = setup.umpire;
			admin._remove_official_from_setup(setup, 'umpire');
			if (official && official._id) {
				releases.push({
					official_id: official._id,
					role: 'umpire',
					wait_ts: Number.isFinite(Number(official.umpire_wait)) ? Number(official.umpire_wait) : (now_ms(app) / 10),
				});
			}
		}
		if (court.has_service_judge === false && setup.service_judge) {
			const official = setup.service_judge;
			admin._remove_official_from_setup(setup, 'service_judge');
			if (official && official._id) {
				releases.push({
					official_id: official._id,
					role: 'service_judge',
					wait_ts: Number.isFinite(Number(official.service_judge_wait)) ? Number(official.service_judge_wait) : (now_ms(app) / 10),
				});
			}
		}

		if (releases.length === 0) {
			return callback(null);
		}

		match.btp_needsync = true;
		async.eachSeries(releases, (release, cb) => {
			app.db.umpires.update(
				{ _id: release.official_id, tournament_key: tournament.key },
				{ $set: build_official_wait_reentry_set_obj(release.role, release.wait_ts) },
				{},
				cb
			);
		}, (updateErr) => {
			if (updateErr) {
				return callback(updateErr);
			}
			app.db.umpires.find(
				{ tournament_key: tournament.key, _id: { $in: releases.map((release) => release.official_id) } },
				(findErr, updatedOfficials) => {
					if (findErr) {
						return callback(findErr);
					}
					app.db.umpires.find({ tournament_key: tournament.key }, (allErr, all_umpires) => {
						if (allErr) {
							return callback(allErr);
						}
						(updatedOfficials || []).forEach((official) => {
							admin.notify_change(app, tournament.key, 'umpire_updated', official);
						});
						admin.notify_change(app, tournament.key, 'umpires_changed', { all_umpires });
						return callback(null);
					});
				}
			);
		});
	});
}

function is_nonblocking_auto_assign_error(err) {
	return !!(err && (
		/Match already has assigned umpire/.test(err.message) ||
		/No umpire available/.test(err.message) ||
		/Match has no assigned umpire/.test(err.message) ||
		/Match already has assigned service judge/.test(err.message) ||
		/No service judge available/.test(err.message)
	));
}

function auto_assign_technical_officials_for_match(app, tournament, match_id, callback, options = {}) {
	if (!is_tournament_automation_enabled(tournament)) {
		return callback(null, false);
	}
	const mode = tournament.technical_official_auto_assignment_mode || 'manual_only';
	if (!technical_official_auto_assignment_mode_supports_match_call(mode)) {
		return callback(null, false);
	}
	if ((tournament.official_rotation_mode || 'umpire_and_service_judge') === 'disabled') {
		return callback(null, false);
	}
	if (mode === 'on_match_call_if_possible' && options.allow_on_match_call !== true) {
		return callback(null, false);
	}

	const admin = require('./admin');
	let changed = false;
	const load_target_court = () => new Promise((resolve, reject) => {
		if (!app?.db?.matches || typeof app.db.matches.findOne !== 'function') {
			return resolve(null);
		}
		app.db.matches.findOne({ _id: match_id, tournament_key: tournament.key }, (matchErr, match) => {
			if (matchErr) {
				return reject(matchErr);
			}
			const court_id = match?.setup?.court_id;
			if (!court_id) {
				return resolve(null);
			}
			if (!app?.db?.courts || typeof app.db.courts.findOne !== 'function') {
				return resolve(null);
			}
			app.db.courts.findOne({ tournament_key: tournament.key, _id: court_id }, (courtErr, court) => {
				if (courtErr) {
					return reject(courtErr);
				}
				return resolve(court || null);
			});
		});
	});
	const try_auto_assign = (assign_fn) => {
		return assign_fn(app, tournament.key, match_id, { skip_btp_push: true })
			.then(() => {
				changed = true;
			})
			.catch((err) => {
				if (is_nonblocking_auto_assign_error(err)) {
					return null;
				}
				throw err;
			});
	};

	Promise.resolve()
		.then(() => load_target_court())
		.then((court) => {
			if (court && court.has_umpire === false) {
				return null;
			}
			return try_auto_assign(admin._assign_next_umpire_to_match).then(() => court);
		})
		.then((court) => {
			if ((tournament.official_rotation_mode || 'umpire_and_service_judge') !== 'umpire_and_service_judge') {
				return null;
			}
			if (court && court.has_service_judge === false) {
				return null;
			}
			return try_auto_assign(admin._assign_next_service_judge_to_match);
		})
		.then(() => callback(null, changed))
		.catch((err) => callback(err));
}

function fetch_technical_official_assignment_targets(app, tournament, callback) {
	if (!tournament || !tournament.key) {
		return callback(null, []);
	}

	app.db.matches
		.find({ tournament_key: tournament.key, 'setup.state': 'preparation' })
		.sort({ 'setup.preparation_call_timestamp': 1 })
		.exec((err, preparation_matches) => {
			if (err) {
				return callback(err);
			}

			const targets = [];
			const seen_match_ids = new Set();
			(preparation_matches || []).forEach((match) => {
				if (!match || !match._id || seen_match_ids.has(match._id)) {
					return;
				}
				if (!match_needs_technical_official_assignment(match, tournament)) {
					return;
				}
				seen_match_ids.add(match._id);
				targets.push(match);
			});

			if ((tournament.technical_official_auto_assignment_mode || 'manual_only') !== 'when_available') {
				return callback(null, targets);
			}

			const match_automation = require('./match_automation');
			match_automation.fetch_all_location_preparation_selections(app, tournament.key, {
				ignore_technical_officials_available_rule: true,
			})
				.then((selections) => {
					(selections || []).forEach((selection) => {
						(selection.selected_matches || []).forEach((match) => {
							if (!match || !match._id || seen_match_ids.has(match._id)) {
								return;
							}
							if (!match_needs_technical_official_assignment(match, tournament)) {
								return;
							}
							seen_match_ids.add(match._id);
							targets.push(match);
						});
					});

					app.db.umpires.find({ tournament_key: tournament.key, umpire_wait: { $ne: null } }, (umpireErr, waiting_umpires) => {
						if (umpireErr) {
							return callback(umpireErr);
						}
						const available_umpire_count = Array.isArray(waiting_umpires) ? waiting_umpires.length : 0;
						if (available_umpire_count <= targets.length) {
							return callback(null, targets);
						}

						match_automation.fetch_global_preparation_candidates(app, tournament.key, {
							ignore_technical_officials_available_rule: true,
						})
							.then((global_candidates) => {
								(global_candidates || []).forEach((match) => {
									if (!match || !match._id || seen_match_ids.has(match._id)) {
										return;
									}
									if (targets.length >= available_umpire_count) {
										return;
									}
									if (!match_needs_technical_official_assignment(match, tournament)) {
										return;
									}
									seen_match_ids.add(match._id);
									targets.push(match);
								});
								callback(null, targets);
							})
							.catch((globalErr) => callback(globalErr));
					});
				})
				.catch((selectionErr) => callback(selectionErr));
		});
}

function auto_assign_technical_officials_for_preparation_matches(app, tournament, callback) {
	if (!tournament || !tournament.key) {
		return callback(null);
	}
	if (!is_tournament_automation_enabled(tournament)) {
		return callback(null);
	}
	if ((tournament.technical_official_auto_assignment_mode || 'manual_only') !== 'when_available') {
		return callback(null);
	}
	if ((tournament.official_rotation_mode || 'umpire_and_service_judge') === 'disabled') {
		return callback(null);
	}

	fetch_technical_official_assignment_targets(app, tournament, (targetErr, matches) => {
		if (targetErr) {
			return callback(targetErr);
		}

		const btp_manager = require('./btp_manager');
		async.eachSeries(matches || [], (match, cb) => {
				if (!match || !match._id) {
					return cb(null);
				}
				return auto_assign_technical_officials_for_match(app, tournament, match._id, (assignErr, changed) => {
					if (assignErr) {
						return cb(assignErr);
					}
					if (!changed) {
						return cb(null);
					}
					fetch_match(app, tournament.key, match._id)
						.then((updatedMatch) => {
							btp_manager.update_highlight(app, updatedMatch);
							cb(null);
						})
						.catch(cb);
				});
			}, callback);
	});
}

function queue_auto_assign_technical_officials_when_available(app, tournament_key, callback) {
	if (require('./btp_sync_effects').capture(app, real_app => queue_auto_assign_technical_officials_when_available(real_app, tournament_key), { deferred_job: true },
		{ target: 'match_utils', method: 'queue_auto_assign_technical_officials_when_available', args: [tournament_key] })) {
		if (callback) callback(null);
		return;
	}
	if (!app || !app.db || !tournament_key) {
		if (callback) {
			callback(null);
		}
		return;
	}

	const pending = pending_technical_official_assignment_runs.get(tournament_key);
	if (pending) {
		if (callback) {
			pending.callbacks.push(callback);
		}
		return;
	}

	const state = {
		callbacks: callback ? [callback] : [],
	};
	pending_technical_official_assignment_runs.set(tournament_key, state);

	const task = update_queue.locks([
		update_queue.lock_keys.selection(tournament_key),
		update_queue.lock_keys.preparation(tournament_key),
		update_queue.lock_keys.umpires(tournament_key),
	], update_queue.named('auto_assign_technical_officials_when_available', () => new Promise((resolve, reject) => {
		app.db.tournaments.findOne({ key: tournament_key }, (err, tournament) => {
			if (err) {
				return reject(err);
			}
			if (!tournament) {
				return reject(new Error('Cannot find tournament ' + tournament_key));
			}
			return auto_assign_technical_officials_for_preparation_matches(app, tournament, (execErr) => {
				if (execErr) {
					return reject(execErr);
				}
				return resolve(true);
			});
		});
	})));

	update_queue.instance().execute(task).then(() => {
		const current = pending_technical_official_assignment_runs.get(tournament_key);
		pending_technical_official_assignment_runs.delete(tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(null));
	}).catch((err) => {
		const current = pending_technical_official_assignment_runs.get(tournament_key);
		pending_technical_official_assignment_runs.delete(tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(err));
		console.warn('[bts] failed to queue auto_assign_technical_officials_when_available', err && (err.stack || err.message || String(err)));
	});
}

function remove_preparation_call_timestamp(setup) {
	setup.preparation_call_timestamp = undefined;
}
function remove_tablet_operator_to_list(app, tkey, match, callback) {
	add_tabletoperator_to_tabletoperator_list_by_match(app, tkey, match);

	const setup = match.setup;
	setup.tabletoperators = undefined;

	return callback(null);
}

async function add_tabletoperators(app, tournament, match, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const btp_manager = require('./btp_manager');
	
	const court_id = match.setup.court_id;
    const match_id = match._id;

    if (!court_id || !match_id) {
		return callback(null);
    }

	const setup = match.setup;

	try {
        if (is_tournament_automation_enabled(tournament) && (tournament.tabletoperator_enabled && tournament.tabletoperator_enabled == true)) {
            if (!setup.tabletoperators || setup.tabletoperators == null) {
                
				const fetch_result = await fetch_tabletoperator(admin, app, tournament, court_id);
				let value = [];
				if (tournament.tabletoperator_with_state_from_match_enabled && typeof(fetch_result) == "undefined") {
					value.push({
						asian_name: false,
						name: first_setup_player_state(setup),
						firstname: "",
						lastname: "",
						btp_id: -1});
				} else {
					value = fetch_result;
				}

                if (!setup.umpire || !setup.umpire.name || (tournament.tabletoperator_with_umpire_enabled && tournament.tabletoperator_with_umpire_enabled == true)) {
                    setup.tabletoperators = value;
                }
            }
        }
    } catch (err) {
        return callback(err);
    }

    if (setup.tabletoperators) {
        for (let operator of setup.tabletoperators) {
            operator.checked_in = false;
        }
        btp_manager.update_players(app, tournament.key, setup.tabletoperators);
    }
	return callback(null);
}

async function set_umpires_on_court(app, tournament, match, callback) {
	const setup = match.setup;
	const court_id = setup.court_id;
	if (!court_id) {
		return callback(null);
	}

	if (setup.umpire) {
		const umpire = setup.umpire;
		umpire.umpire_on_court = court_id;
		umpire.is_planed_as_umpire = false;
		umpire.is_planed_as_service_judge = false;
		umpire.service_judge_on_court = null;
		umpire.umpire_wait = null;
		umpire.service_judge_wait = null;
		umpire.umpire_pause = null;
		umpire.service_judge_pause = null;
		umpire.inactive_list = null;
        umpire.last_time_on_court_ts = setup.called_timestamp;
		umpire.status = 'oncourt';
		umpire.court_id = court_id;
		sync_technical_official_checked_in(umpire, tournament);

		update_umpire(app, tournament.key, umpire);
	}

	if (setup.service_judge) {
		const service_judge = setup.service_judge;
		service_judge.service_judge_on_court = court_id;
		service_judge.is_planed_as_umpire = false;
		service_judge.is_planed_as_service_judge = false;
		service_judge.umpire_on_court = null;
		service_judge.umpire_wait = null;
		service_judge.service_judge_wait = null;
		service_judge.umpire_pause = null;
		service_judge.service_judge_pause = null;
		service_judge.inactive_list = null;
		service_judge.last_time_on_court_ts = setup.called_timestamp;
		service_judge.status = 'oncourt';
		service_judge.court_id = court_id;
		sync_technical_official_checked_in(service_judge, tournament);
		
		update_umpire(app, tournament.key, service_judge);
	}
	return callback(null);
}

function remove_highlight_preparation(match, callback){
	const setup = match.setup;
	setup.highlight = 0;
	normalize_preparation_state(setup);

	return callback(null);
}

function update_match_db (app, match, callback) {
	const setup = match.setup;
	const match_q = {_id: match._id};
	const set_obj = {setup};
	if (match.btp_needsync !== undefined) {
		set_obj.btp_needsync = match.btp_needsync;
	}
	
	app.db.matches.update(match_q, {$set: set_obj}, {}, (err) => {
		if (err) {
			return callback(err);
		}
	
		return callback(null);
	});
}

function update_match_btp(app, match, callback) {
	const btp_manager = require('./btp_manager');
	
	// this function also send the changes of this match to btp
	btp_manager.update_highlight(app, match);

	return callback(null);
}

function update_court_db (app, match, callback) {
	const court_q = {_id: match.setup.court_id};
	app.db.courts.find(court_q, (err, courts) => {
		if (err) {
			return callback(err);
		}
		
		if (courts.length !== 1) {
			return callback(null);
		}

		app.db.courts.update(court_q, {$set: {match_id: match._id}}, {}, (err) => {
			return callback(err);
		});
	});
}

function notify_change_match_edit (app, match, callback) {
	const admin = require('./admin'); // avoid dependency cycle

	admin.notify_change(app, match.tournament_key, 'match_edit', {	match__id: match._id,
																	match: match});
	
	return callback(null); 
}


function notify_change_match_called_on_court (app, match, callback) {
	const admin = require('./admin'); // avoid dependency cycle

	admin.notify_change(app, match.tournament_key, 'match_called_on_court', match);
	
	return callback(null); 
}

function notify_bupws(app, match, old_court, callback) {
	if (require('./btp_sync_effects').capture(app, real_app => {
		const bupws = require('./bupws');
		bupws.handle_score_change(real_app, match.tournament_key, match.setup.court_id);
		if (old_court) bupws.handle_score_change(real_app, match.tournament_key, old_court);
	}, { courts: [match.setup.court_id, old_court] },
		{ target: 'bupws', method: 'notify_courts', args: [match.tournament_key, match.setup.court_id, old_court] })) {
		return callback(null);
	}
	const bupws = require('./bupws');
	debug_flags.log(app, match && match.tournament_key, '[bts] auto_call_trace:notify_bupws', {
		ts: now_ms(app),
		tournament_key: match && match.tournament_key,
		match_id: match && match._id,
		court_id: match && match.setup && match.setup.court_id,
		old_court,
		state: match && match.setup && match.setup.state,
		now_on_court: match && match.setup && match.setup.now_on_court,
		called_timestamp: match && match.setup && match.setup.called_timestamp,
	});

	bupws.handle_score_change(app, match.tournament_key, match.setup.court_id);
	
	if(old_court) {
		bupws.handle_score_change(app, match.tournament_key, old_court);
	}

	return callback(null);
}

function serialized(fn) {
	let queue = Promise.resolve();
	return (...args) => {
		const res = queue.then(() => fn(...args));
		queue = res.catch(() => { });
		return res;
	}
}

const fetch_tabletoperator = serialized(get_last_looser_on_court);

function get_last_looser_on_court(admin, app, tournament, court_id) {
	return new Promise((resolve, reject) => {
		const tkey = tournament?.key || tournament;
		const tabletoperator_querry = { 'tournament_key': tkey, court: null, start_ts: { $lte: now_ms(app) } };
		app.db.tabletoperators.find(tabletoperator_querry).sort({ 'start_ts': 1 }).exec(async (err, tabletoperator) => {
			if (err) {
				return reject(err);
			}
			var returnvalue = undefined;
			let selected_tabletoperator = null;
			try {
				selected_tabletoperator = await select_tabletoperator_for_court(app, tournament, tabletoperator, court_id);
			} catch (selection_err) {
				return reject(selection_err);
			}
			if (selected_tabletoperator) {
				returnvalue = selected_tabletoperator.tabletoperator
				app.db.tabletoperators.update({ _id: selected_tabletoperator._id, tournament_key: tkey }, { $set: { court: court_id } }, { returnUpdatedDocs: true }, function (err, numAffected, changed_tabletoperator) {
					if (err) {
						return reject(err);
					}
					admin.notify_change(app, tkey, 'tabletoperator_removed', { tabletoperator: changed_tabletoperator });
					return resolve(returnvalue);
				});
			} else { 
				return resolve(returnvalue);
			}
		});
	});
}

function calc_match_set_player_on_tablet(match, match_on_court_setup) {
	return new Promise((resolve) => {
		if(match?.setup?.now_on_court == false) {
			return resolve(null);
		}

		let tablet_operatorns_btp_ids = setup_tabletoperator_btp_ids(match_on_court_setup);
		if(tablet_operatorns_btp_ids.length < 1) {
			return resolve(null);
		}

		let change = false;

		for_each_setup_player(match?.setup, (player) => {
			if (player?.btp_id != null && tablet_operatorns_btp_ids.includes(player.btp_id)) {
				if (player.now_tablet_on_court === match_on_court_setup.court_id && player.checked_in === false) {
					return;
				}
				player.now_tablet_on_court = match_on_court_setup.court_id;
				player.checked_in = false;
				change = true;
			}
		});

		if (change) {
			return resolve(match);
		}

		return resolve(null);
	});
}

function set_player_on_tablet(app, tkey, match_on_court_setup, callback) {
	if (setup_tabletoperator_btp_ids(match_on_court_setup).length === 0) {
		return callback(null);
	}
	return update_player_court_states(app, tkey, [{ setup: match_on_court_setup, tabletoperators: true }], callback);
}

function calc_match_set_player_on_court(match, match_on_court_setup, match_on_court_id = null) {
	return new Promise((resolve) => {
		if (match_on_court_id != null && match?._id === match_on_court_id) {
			return resolve(null);
		}
		if(match?.setup?.now_on_court == false) {
			return resolve(null);
		}

		let on_court_btp_ids = setup_player_btp_ids(match_on_court_setup);
		if(on_court_btp_ids.length < 1) {
			return resolve(null);
		}

		let change = false;

		for_each_setup_player(match?.setup, (player) => {
			if (player?.btp_id != null && on_court_btp_ids.includes(player.btp_id)) {
				if (player.now_playing_on_court === match_on_court_setup.court_id &&
					player.tablet_break_active === false && match.setup.state === 'blocked') {
					return;
				}
				player.now_playing_on_court = match_on_court_setup.court_id;
				player.tablet_break_active = false;
				match.setup.state = 'blocked';
				change = true;
			}
		});

		if (change) {
			return resolve(match);
		}
		return resolve(null);
	});
}

function set_player_on_court(app, tkey, match_on_court, callback) {
	const match_on_court_setup = match_on_court?.setup || match_on_court;
	const match_on_court_id = match_on_court?._id || null;
	return update_player_court_states(app, tkey, [{ setup: match_on_court_setup, match_id: match_on_court_id, players: true }], callback);
}

function set_players_on_courts(app, tkey, matches_on_court, callback) {
	const assignments = matches_on_court.map(match => ({
		setup: match.setup,
		match_id: match._id,
		players: true,
		tabletoperators: true,
	}));
	return update_player_court_states(app, tkey, assignments, callback);
}

function update_player_court_states(app, tkey, assignments, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	if (assignments.length === 0) return callback(null);
	const players = new Set(assignments.flatMap(assignment => [
		...(assignment.players ? setup_player_btp_ids(assignment.setup) : []),
		...(assignment.tabletoperators ? setup_tabletoperator_btp_ids(assignment.setup) : []),
	]));
	const find = app.db.model
		? done => app.db.model.find_matches_by_players(tkey, players, done)
		: done => app.db.matches.find({ tournament_key: tkey }, done);
	find((err, matches) => {
		if (err) return callback(err);
		// Merge all assignments into each setup before writing it once. Separate
		// scans per court can overwrite each other's player changes in one match.
		Promise.allSettled(matches.map(async (match) => {
			const setup_changes = new SetupChanges(match.setup);
			let changed = false;
			for (const assignment of assignments) {
				if (assignment.players) {
					changed = !!(await calc_match_set_player_on_court(match, assignment.setup, assignment.match_id)) || changed;
				}
				if (assignment.tabletoperators) {
					changed = !!(await calc_match_set_player_on_tablet(match, assignment.setup)) || changed;
				}
			}
			if (!changed) return;
			await new Promise((resolve, reject) => {
				app.db.matches.update({ _id: match._id, tournament_key: tkey }, setup_changes.update(match.setup), { returnUpdatedDocs: true }, (update_err, _count, updated) => {
					if (update_err) return reject(update_err);
					const current = updated || match;
					admin.notify_change(app, tkey, 'update_player_status', {
						match__id: current._id,
						btp_winner: current.btp_winner,
						setup: current.setup,
					});
					resolve();
				});
			});
		})).then((results) => {
			const failure = results.find(result => result.status === 'rejected');
			callback(failure ? failure.reason : null);
		}, callback);
	});
}

function add_player_to_tabletoperator_list(app, tournament_key, cur_match_id, end_ts, callback) {
	app.db.tournaments.findOne({ key: tournament_key }, async (err, tournament) => {
		if (err) {
			return callback(err);
		}
		if ((tournament.tabletoperator_enabled && tournament.tabletoperator_enabled == true)) {
			app.db.matches.findOne({ 'tournament_key': tournament_key, '_id': cur_match_id }, (err, cur_match) => {
				if (err) {
					return callback(err);
				}
				add_player_to_tabletoperator_list_by_match(app, tournament, tournament_key, cur_match, end_ts, callback)
			});
		} else {
			return callback(null);
		}
	});
}

function add_player_to_tabletoperator_list_by_match(app, tournament, tournament_key, cur_match, end_ts, callback) {
	if (cur_match?.network_score && cur_match?.setup) {
		// walkovers and retirements will not be recorgnized.
		app.db.tabletoperators.findOne({ 'tournament_key': tournament_key, 'match_id': cur_match._id }, (err, no_tabletoperator) => {
			if (err) {
				return callback(err);
			}
			if (no_tabletoperator == null) {
				const round = cur_match.setup.match_name;
				const match_teams = Array.isArray(cur_match.setup.teams) ? cur_match.setup.teams : [];
				var team = null;

				if (tournament.tabletoperator_winner_of_quaterfinals_enabled && (round == 'VF' || round == 'QF')) {
					team = match_teams[cur_match.btp_winner - 1];
				} else {
					const index = cur_match.btp_winner % 2;
					team = match_teams[index];
				}

				if (tournament.tabletoperator_with_state_from_match_enabled) {
					return callback(null);
				}

				if (team && typeof team.players !== 'undefined') {
					const tabletoperator_ready_ts = get_tabletoperator_ready_ts_after_service(tournament, end_ts);
					var teams = [];
					if (tournament.tabletoperator_split_doubles && team.players.length > 1) {
						for (const player of team.players) {
							var toinsert = player
							if (tournament.tabletoperator_with_state_enabled && player.state) {
								toinsert = create_team_from_player_state(player);
							}
							var newTeam = {
								players: [toinsert]
							};
							teams.push(newTeam);
						}
					} else {
						var toinsert = team;
						if (tournament.tabletoperator_with_state_enabled && team.players[0].state) {
							toinsert = {
								players: [create_team_from_player_state(team.players[0])]
							};
						}
						teams.push(toinsert);
					}

					var i = 0;
					for (const t of teams) {
						var tabletoperator = [];
						t.players.forEach((player) => {
							tabletoperator.push(player);
						});

						const new_tabletoperator = {
							tournament_key,
							tabletoperator,
							'match_id': cur_match._id,
							'start_ts': tabletoperator_ready_ts,
							'end_ts': null,
							'court': null,
							'played_on_court': (cur_match.setup.court_id ? cur_match.setup.court_id : null)
						};

						app.db.tabletoperators.insert(new_tabletoperator, function (err, inserted_t) {
							if (err) {
								return callback(err);
							}
							const admin = require('./admin'); // avoid dependency cycle
							admin.notify_change(app, tournament_key, 'tabletoperator_add', { tabletoperator: inserted_t });
							queue_auto_execute_preparation_selections(app, tournament_key);
							if (i == teams.length - 1) {
								callback(null);
							}
							i++;
						});
					}
				} else {
					return callback(null);
				}
			} else {
				return callback(null);
			}
		});
	} else {
		return callback(null);
	}
}
function fetch_match(app, tournament_key, match_id) {
	return new Promise((resolve, reject) => {
		app.db.matches.findOne({ tournament_key: tournament_key, _id: match_id }, async (err, match) => {
			if (err) {
				return reject(err);
			}
			if (match != null) {
				return resolve(match)
			} else {
				return reject("Match cannot be fetched from DB 111 " + match_id);
			}
		});
	});
}

function create_team_from_player_state(player) {
	return {
		"asian_name": false,
		"name": player.state,
		"firstname": "",
		"lastname": "",
		"btp_id": -1
	};
}

function add_tabletoperator_to_tabletoperator_list_by_match(app, tournament_key, cur_match) {

	if(cur_match?.setup?.tabletoperators) {
		var tabletoperator = cur_match.setup.tabletoperators;

		const new_tabletoperator = {
			tournament_key,
			tabletoperator,
			'match_id': cur_match._id,
			'start_ts': tabletoperator[0].last_time_on_court_ts,
			'end_ts': null,
			'court': null,
			'played_on_court': (cur_match.setup.court_id ? cur_match.setup.court_id : null)
		};
		
		app.db.tabletoperators.insert(new_tabletoperator, function (err, inserted_t) {
			if (err) {
				ws.respond(msg, err);
				return;
			}
			const admin = require('./admin'); // avoid dependency cycle
			admin.notify_change(app, tournament_key, 'tabletoperator_add', { tabletoperator: inserted_t });
			queue_auto_execute_preparation_selections(app, tournament_key);
		});
	}
	
}


function remove_player_on_court(app, tkey, match_id, end_ts = null, context, callback) {
	if (typeof context === 'function') { callback = context; context = null; }
	require('./match_cleanup/players').players(app, tkey, match_id, end_ts, context, {
		setup_player_btp_ids, release_blocked_match_if_no_players_on_court,
	}).then(() => callback(null), callback);
}

function remove_tablet_on_court(app, tkey, match_id, end_ts, context, callback) {
	if (typeof context === 'function') { callback = context; context = null; }
	require('./match_cleanup/players').tablets(app, tkey, match_id, end_ts, context, {
		setup_tabletoperator_btp_ids, close_tabletoperator_assignment_on_court, reset_tabletoperator_settings_at_player,
	}).then(() => callback(null), callback);
}

function close_tabletoperator_assignment_on_court(app, tkey, court_id, end_ts, callback) {
	if (!court_id) {
		return callback(null);
	}
	const service_end_ts = Number.isFinite(Number(end_ts)) ? Number(end_ts) : now_ms(app);
	const admin = require('./admin'); // avoid dependency cycle
	app.db.tabletoperators.find({ tournament_key: tkey, court: court_id }, (err, tabletoperators) => {
		if (err) {
			return callback(err);
		}
		async.each(tabletoperators || [], (tabletoperator, cb) => {
			app.db.tabletoperators.update(
				{ _id: tabletoperator._id, tournament_key: tkey },
				{ $set: { court: -1, end_ts: service_end_ts } },
				{ returnUpdatedDocs: true },
				(update_err, _numAffected, changed_tabletoperator) => {
					if (update_err) {
						return cb(update_err);
					}
					if (changed_tabletoperator) {
						admin.notify_change(app, tkey, 'tabletoperator_removed', { tabletoperator: changed_tabletoperator });
					}
					return cb(null);
				}
			);
		}, callback);
	});
}

function reset_tabletoperator_settings_at_player(app, tkey, tournament, player, end_ts, notify_btp = true) {
	const btp_manager = require('./btp_manager');

	player.now_tablet_on_court = false;
	const now = now_ms(app);
	const tabletoperator_break_ms = get_tabletoperator_break_after_service_ms(tournament);
	const service_end_ts = Number.isFinite(Number(end_ts)) ? Number(end_ts) : now;
	const player_pause_end_ts = Number.isFinite(Number(player.last_time_on_court_ts))
		? Number(player.last_time_on_court_ts) + Number(tournament?.btp_settings?.pause_duration_ms || 0)
		: 0;
	const tablet_break_until_ts = service_end_ts + tabletoperator_break_ms;
	if (tournament.tabletoperator_set_break_after_tabletservice && tablet_break_until_ts > player_pause_end_ts) {
		player.tablet_last_time_on_court_ts = service_end_ts;
		player.tablet_break_until_ts = tablet_break_until_ts;
		player.checked_in = false;
		player.tablet_break_active = true;
		if (notify_btp) btp_manager.update_players(app, tkey, [player]);
		
	} else {
		if (!tournament?.btp_settings?.check_in_per_match && player.last_time_on_court_ts) {
			if ((now - player.last_time_on_court_ts) > tournament.btp_settings.pause_duration_ms) {
				player.checked_in = true;
			}
		}
		player.tablet_break_active = false;
		if (notify_btp) btp_manager.update_players(app, tkey, [player]);
	}
}

function reconcile_player_court_flags_for_tournament(app, tournament, callback) {
	if (!app?.db || !tournament?.key) return callback(null);
	const key = tournament.key;
	require('./preparation_selection/periodic_reads').matches(app, key).then(matches =>
		require('./match_reconciliation/run').apply(app, key, matches,
			require('./match_reconciliation/player_flags').expected(matches))).then(() => callback(null), callback);
}

function queue_reconcile_player_court_flags(app, tournament_key, callback) {
	if (require('./btp_sync_effects').capture(app, real_app => queue_reconcile_player_court_flags(real_app, tournament_key), { deferred_job: true },
		{ target: 'match_utils', method: 'queue_reconcile_player_court_flags', args: [tournament_key] })) {
		if (callback) callback(null);
		return;
	}
	if (!app || !app.db || !tournament_key) {
		if (callback) callback(null);
		return;
	}
	const pending = pending_player_court_reconciliation_runs.get(tournament_key);
	if (pending) {
		if (callback) {
			pending.callbacks.push(callback);
		}
		return;
	}

	const state = {
		callbacks: callback ? [callback] : [],
	};
	pending_player_court_reconciliation_runs.set(tournament_key, state);

	require('./match_reconciliation/run').run(app, tournament_key).then(() => {
		const current = pending_player_court_reconciliation_runs.get(tournament_key);
		pending_player_court_reconciliation_runs.delete(tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(null));
	}).catch((err) => {
		const current = pending_player_court_reconciliation_runs.get(tournament_key);
		pending_player_court_reconciliation_runs.delete(tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(err));
	});
}

function start_player_court_reconciliation_manager(app) {
	if (player_court_reconciliation_interval || !app || !app.db) {
		return;
	}
	const reconcile_all_tournaments = require('./preparation_selection/periodic_reads').runner(app,
		'periodic_player_court_reconciliation', {}, tournament => {
			if (!is_tournament_automation_enabled(tournament)) return;
			return new Promise((resolve, reject) => queue_reconcile_player_court_flags(app, tournament.key,
				error => error ? reject(error) : resolve()));
		});
	player_court_reconciliation_interval = setInterval(reconcile_all_tournaments, 15000);
	reconcile_all_tournaments();
}

function apply_official_on_court_release(official, role, end_ts, options = {}) {
	if (!official) {
		return official;
	}
	const official_rotation_mode = options.official_rotation_mode || 'umpire_and_service_judge';
	const technical_break_ms = Number(options.technical_official_break_after_assignment_ms) || 0;
	const use_break = technical_break_ms > 0;
	const set_pause_or_wait = (pause_field, wait_field, ts, pause_ts) => {
		official.status = use_break ? 'pause' : 'ready';
		official[pause_field] = use_break ? pause_ts : null;
		official[wait_field] = use_break ? null : ts;
	};

	official.umpire_on_court = null;
	official.service_judge_on_court = null;
	official.is_planed_as_umpire = false;
	official.is_planed_as_service_judge = false;
	official.last_time_on_court_ts = end_ts;
	official.checked_in = false;
	official.status = 'ready';
	official.court_id = null;
	official.umpire_wait = null;
	official.service_judge_wait = null;
	official.umpire_pause = null;
	official.service_judge_pause = null;
	official.umpire_manual_pause = null;
	official.service_judge_manual_pause = null;
	official.inactive_list = null;

	if (official_rotation_mode === 'umpire_only') {
		if (official.is_umpire === true || official.is_service_judge === true) {
			set_pause_or_wait('umpire_pause', 'umpire_wait', end_ts, end_ts + technical_break_ms);
		} else {
			// Be tolerant for legacy/inconsistent role flags and keep the official in rotation.
			set_pause_or_wait('umpire_pause', 'umpire_wait', end_ts, end_ts + technical_break_ms);
		}
		return official;
	}

	if (role === 'umpire') {
		if (official.is_service_judge === true) {
			set_pause_or_wait('service_judge_pause', 'service_judge_wait', end_ts, end_ts + technical_break_ms);
		} else if (official.is_umpire === true) {
			set_pause_or_wait('umpire_pause', 'umpire_wait', end_ts + 100, end_ts + technical_break_ms + 100);
		} else {
			// Fall back to the role actually performed if role flags are missing.
			set_pause_or_wait('umpire_pause', 'umpire_wait', end_ts + 100, end_ts + technical_break_ms + 100);
		}
	} else if (role === 'service_judge') {
		if (official.is_umpire === true) {
			set_pause_or_wait('umpire_pause', 'umpire_wait', end_ts, end_ts + technical_break_ms);
		} else if (official.is_service_judge === true) {
			set_pause_or_wait('service_judge_pause', 'service_judge_wait', end_ts + 100, end_ts + technical_break_ms + 100);
		} else {
			// Fall back to the role actually performed if role flags are missing.
			set_pause_or_wait('service_judge_pause', 'service_judge_wait', end_ts + 100, end_ts + technical_break_ms + 100);
		}
	}

	sync_technical_official_checked_in(official, options.tournament || options.btp_settings);
	return official;
}

function apply_official_pause_expiry(official, options = {}) {
	if (!official) {
		return official;
	}
	const has_umpire_pause = official.umpire_pause != null;
	const has_service_judge_pause = official.service_judge_pause != null;
	const umpire_pause = has_umpire_pause ? Number(official.umpire_pause) : null;
	const service_judge_pause = has_service_judge_pause ? Number(official.service_judge_pause) : null;

	if (!has_umpire_pause && !has_service_judge_pause) {
		return official;
	}

	official.status = 'ready';
	official.umpire_wait = null;
	official.service_judge_wait = null;
	official.umpire_pause = null;
	official.service_judge_pause = null;
	official.umpire_manual_pause = null;
	official.service_judge_manual_pause = null;
	official.inactive_list = null;

	if (has_umpire_pause && (!has_service_judge_pause || umpire_pause <= service_judge_pause)) {
		official.umpire_wait = umpire_pause;
	} else {
		official.service_judge_wait = service_judge_pause;
	}

	sync_technical_official_checked_in(official, options.tournament || options.btp_settings);
	return official;
}

function apply_official_standby_state(official, options = {}) {
	if (!official) {
		return official;
	}

	official.umpire_on_court = null;
	official.service_judge_on_court = null;
	official.is_planed_as_umpire = false;
	official.is_planed_as_service_judge = false;
	official.umpire_wait = null;
	official.service_judge_wait = null;
	official.umpire_pause = null;
	official.service_judge_pause = null;
	official.umpire_manual_pause = null;
	official.service_judge_manual_pause = null;
	official.inactive_list = null;
	official.last_time_on_court_ts = null;
	official.status = 'standby';
	official.court_id = null;

	sync_technical_official_checked_in(official, options.tournament || options.btp_settings);
	return official;
}

function remove_umpire_on_court(app, tkey, match_id, end_ts, context, callback) {
	if (typeof context === 'function') { callback = context; context = null; }
	require('./match_cleanup/officials')(app, tkey, match_id, end_ts, context, {
		apply_official_on_court_release, get_technical_official_break_after_assignment_ms, update_umpire,
	}).then(() => callback(null), callback);
}

function set_umpire_to_standby(app, tournament_key, setup) {
	if (!setup.umpire && !setup.service_judge) return;
	app.db.tournaments.findOne({ key: tournament_key }, (tournament_err, tournament) => {
		const standby_options = tournament_err || !tournament ? {} : { tournament };
		if (setup.umpire) {
			const umpire = apply_official_standby_state(setup.umpire, standby_options);
			update_umpire(app, tournament_key, umpire);
		}

		if (setup.service_judge) {
			const service_judge = apply_official_standby_state(setup.service_judge, standby_options);
			update_umpire(app, tournament_key, service_judge);
		}
	});
}



function update_umpire(app, tkey, umpire, callback) {
  if (!umpire || !umpire._id) {
    console.error('update_umpire: invalid umpire object');
    if (callback) callback(new Error('Invalid umpire object'));
    return;
  }

  // Sicherheitsnetz: tournament_key immer korrekt setzen
  umpire.tournament_key = tkey;

  app.db.umpires.update(
    { _id: umpire._id, tournament_key: tkey },
    { $set: umpire },
    { returnUpdatedDocs: true },
    function (err, numAffected, changed_umpire) {
      if (err) {
        console.error(err);
        if (callback) callback(err);
        return;
      }

      if (!changed_umpire) { if (callback) callback(null); return; }
      const admin = require('./admin');
      admin.notify_change(app, tkey, 'umpire_updated', changed_umpire);
      const official_is_waiting =
        changed_umpire &&
        (changed_umpire.umpire_wait != null || changed_umpire.service_judge_wait != null);

      if (official_is_waiting) {
        queue_auto_execute_preparation_selections(app, tkey);
      } else {
        queue_auto_assign_technical_officials_when_available(app, tkey);
      }
      if (callback) callback(null);
    }
  );
}

function process_expired_technical_official_breaks_for_tournament(app, tournament, callback) {
	if (!app || !app.db || !tournament || !tournament.key) {
		return callback(null);
	}
	if ((tournament.official_rotation_mode || 'umpire_and_service_judge') === 'disabled') {
		return callback(null);
	}
	const pause_ms = get_technical_official_break_after_assignment_ms(tournament);
	const now = now_ms(app);
	const query = pause_ms > 0
		? {
			tournament_key: tournament.key,
			$or: [
				{ umpire_pause: { $ne: null, $lte: now } },
				{ service_judge_pause: { $ne: null, $lte: now } },
			]
		}
		: {
			tournament_key: tournament.key,
			$or: [
				{ umpire_pause: { $ne: null } },
				{ service_judge_pause: { $ne: null } },
			]
		};
	app.db.umpires.find(query, (err, officials) => {
		if (err) {
			return callback(err);
		}
		const sorted_officials = (officials || []).sort((a, b) => {
			const a_ts = Math.min(
				Number.isFinite(Number(a?.umpire_pause)) ? Number(a.umpire_pause) : Number.POSITIVE_INFINITY,
				Number.isFinite(Number(a?.service_judge_pause)) ? Number(a.service_judge_pause) : Number.POSITIVE_INFINITY
			);
			const b_ts = Math.min(
				Number.isFinite(Number(b?.umpire_pause)) ? Number(b.umpire_pause) : Number.POSITIVE_INFINITY,
				Number.isFinite(Number(b?.service_judge_pause)) ? Number(b.service_judge_pause) : Number.POSITIVE_INFINITY
			);
			return a_ts - b_ts;
		});

		async.eachSeries(sorted_officials, (official, cb) => {
			update_umpire(app, tournament.key, apply_official_pause_expiry(official, { tournament }));
			cb(null);
		}, callback);
	});
}

function queue_process_expired_technical_official_breaks(app, tournament_key, callback) {
	if (!app || !app.db || !tournament_key) {
		if (callback) callback(null);
		return;
	}

	const pending = pending_technical_official_pause_runs.get(tournament_key);
	if (pending) {
		if (callback) {
			pending.callbacks.push(callback);
		}
		return;
	}

	const state = {
		callbacks: callback ? [callback] : [],
	};
	pending_technical_official_pause_runs.set(tournament_key, state);

	const task = update_queue.locks([
		update_queue.lock_keys.umpires(tournament_key),
	], update_queue.named(`technical_official_pause_expiry_${tournament_key}`, () => new Promise((resolve, reject) => {
			app.db.tournaments.findOne({ key: tournament_key }, (err, tournament) => {
				if (err || !tournament) {
					reject(err || new Error('tournament not found'));
					return;
				}
				process_expired_technical_official_breaks_for_tournament(app, tournament, (process_err) => {
					if (process_err) {
						reject(process_err);
						return;
					}
					resolve(null);
				});
			});
		})));

	update_queue.instance().execute(task).then(() => {
		const current = pending_technical_official_pause_runs.get(tournament_key);
		pending_technical_official_pause_runs.delete(tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(null));
	}).catch((err) => {
		const current = pending_technical_official_pause_runs.get(tournament_key);
		pending_technical_official_pause_runs.delete(tournament_key);
		(current?.callbacks || []).forEach((cb) => cb(err));
	});
}

function start_technical_official_pause_manager(app) {
	if (technical_official_pause_interval || !app || !app.db) {
		return;
	}
	const run = require('./preparation_selection/periodic_reads').runner(app, 'periodic_official_pause', {
		official_rotation_mode: { $ne: 'disabled' }, technical_official_break_after_assignment_seconds: { $gt: 0 },
	}, tournament => new Promise((resolve, reject) => queue_process_expired_technical_official_breaks(app, tournament.key,
		error => error ? reject(error) : resolve())));
	technical_official_pause_interval = setInterval(run, 1000);
}

function get_call_on_court_preparation_age_ms(tournament) {
	if (tournament?.call_on_court_only_preparation_enabled !== true) {
		return null;
	}
	const minutes = Number(tournament?.call_on_court_only_preparation_minutes);
	return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 0) * 60 * 1000;
}

function has_preparation_match_ready_for_auto_call(tournament, matches, now) {
	const minimum_age_ms = get_call_on_court_preparation_age_ms(tournament);
	if (minimum_age_ms == null) {
		return false;
	}
	return (matches || []).some((match) => {
		const setup = match?.setup || {};
		if (setup.state !== 'preparation') {
			return false;
		}
		const preparation_ts = Number(setup.preparation_call_timestamp);
		return Number.isFinite(preparation_ts) && (now - preparation_ts) >= minimum_age_ms;
	});
}

function process_preparation_age_auto_calls_for_tournament(app, tournament, callback) {
	if (!app || !app.db || !tournament?.key) {
		return callback(null);
	}
	if (!is_tournament_automation_enabled(tournament)) {
		return callback(null);
	}
	if (tournament.call_next_possible_scheduled_match_in_preparation !== true) {
		return callback(null);
	}
	if (get_call_on_court_preparation_age_ms(tournament) == null) {
		return callback(null);
	}
	const tournament_key = tournament.key;
	require('./preparation_selection/periodic_reads').matches(app, tournament_key, { 'setup.state': 'preparation' }).then(matches => {
		if (!has_preparation_match_ready_for_auto_call(tournament, matches, now_ms(app))) {
			return callback(null);
		}
		return auto_call_matches_on_free_courts(app, tournament_key, callback);
	}, callback);
}

function start_preparation_age_auto_call_manager(app) {
	if (preparation_age_auto_call_interval || !app || !app.db) {
		return;
	}
	const run = require('./preparation_selection/periodic_reads').runner(app, 'periodic_preparation_age', {
		call_next_possible_scheduled_match_in_preparation: true, call_on_court_only_preparation_enabled: true,
	}, tournament => new Promise((resolve, reject) => process_preparation_age_auto_calls_for_tournament(app, tournament,
		error => error ? reject(error) : resolve())));
	preparation_age_auto_call_interval = setInterval(run, 1000);
	run();
}

function get_player_preparation_pause_ready_ts(player, pause_duration_ms) {
	const candidates = [];
	if (player?.tablet_break_active === true) {
		const tablet_break_until_ts = Number(player.tablet_break_until_ts);
		if (Number.isFinite(tablet_break_until_ts)) {
			candidates.push(tablet_break_until_ts);
		}
	}
	const last_time_on_court_ts = Number(player?.last_time_on_court_ts);
	if (Number.isFinite(last_time_on_court_ts) && last_time_on_court_ts > 0) {
		candidates.push(last_time_on_court_ts + pause_duration_ms);
	}
	if (candidates.length === 0) {
		return null;
	}
	return Math.max(...candidates);
}

function latest_expired_preparation_pause_ts(tournament, matches, now) {
	if (!is_tournament_automation_enabled(tournament)) {
		return null;
	}
	if (tournament?.call_preparation_matches_automatically_enabled !== true) {
		return null;
	}
	const match_automation = require('./match_automation');
	if (match_automation.get_participant_readiness_mode(tournament, 'preparation_call') !== 'pause_expired') {
		return null;
	}
	const pause_duration_ms = Number(tournament?.btp_settings?.pause_duration_ms);
	if (!Number.isFinite(pause_duration_ms) || pause_duration_ms <= 0) {
		return null;
	}
	let latest_ts = null;
	(matches || []).forEach((match) => {
		const setup = match?.setup || {};
		if (setup.is_match !== true || setup.state !== 'scheduled') {
			return;
		}
		for_each_setup_player(setup, (player) => {
			const ready_ts = get_player_preparation_pause_ready_ts(player, pause_duration_ms);
			if (Number.isFinite(ready_ts) && ready_ts <= now && (latest_ts == null || ready_ts > latest_ts)) {
				latest_ts = ready_ts;
			}
		});
	});
	return latest_ts;
}

function process_preparation_pause_auto_calls_for_tournament(app, tournament, callback) {
	if (!app || !app.db || !tournament?.key) {
		return callback(null);
	}
	const tournament_key = tournament.key;
	if (!is_tournament_automation_enabled(tournament) || tournament.call_preparation_matches_automatically_enabled !== true ||
		require('./match_automation').get_participant_readiness_mode(tournament, 'preparation_call') !== 'pause_expired' ||
		!Number.isFinite(Number(tournament.btp_settings?.pause_duration_ms)) || Number(tournament.btp_settings.pause_duration_ms) <= 0) {
		return callback(null);
	}
	require('./preparation_selection/periodic_reads').matches(app, tournament_key).then(matches => {
		const now = now_ms(app);
		const latest_ready_ts = latest_expired_preparation_pause_ts(tournament, matches, now);
		if (latest_ready_ts == null) {
			return callback(null);
		}
		const state = preparation_pause_auto_call_state(app);
		const previous_ready_ts = Number(state.get(tournament_key)) || 0;
		if (latest_ready_ts <= previous_ready_ts) {
			return callback(null);
		}
		state.set(tournament_key, latest_ready_ts);
		return queue_auto_execute_preparation_selections(app, tournament_key, callback);
	}, callback);
}

function start_preparation_pause_auto_call_manager(app) {
	if (preparation_pause_auto_call_interval || !app || !app.db) {
		return;
	}
	const run = require('./preparation_selection/periodic_reads').runner(app, 'periodic_preparation_pause', {
		call_preparation_matches_automatically_enabled: true,
	}, tournament => new Promise((resolve, reject) => process_preparation_pause_auto_calls_for_tournament(app, tournament,
		error => error ? reject(error) : resolve())));
	preparation_pause_auto_call_interval = setInterval(run, 1000);
	run();
}

function call_preparation_match_on_court(app, tournament_key, court_id, expected_match_id) {
	return new Promise((resolve, reject) => {
		debug_flags.log(app, tournament_key, '[bts] auto_call_trace:call_preparation_match_on_court_start', {
			ts: now_ms(app),
			tournament_key,
			court_id,
			expected_match_id: expected_match_id || null,
		});
		require('./preparation_selection/call_reads').callback(app, tournament_key, 'tournaments', async (err, tournament) => {
			if (err) {
				return reject("No tournament found for ");
			}
			if (!is_tournament_automation_enabled(tournament)) {
				return resolve("Global automation disabled");
			}
			if (tournament.call_next_possible_scheduled_match_in_preparation) {
				const match_automation = require('./match_automation');
				Promise.all([
					require('./preparation_selection/call_reads').read(app, tournament_key, 'courts'),
					require('./preparation_selection/call_reads').read(app, tournament_key, 'matches'),
					require('./preparation_selection/call_reads').read(app, tournament_key, 'umpires'),
				]).then(([courts, matches, umpires]) => {
					const current_tournament = {
						...(tournament || {}),
						courts,
						matches,
						umpires,
					};
					const candidates = match_automation.find_call_on_court_candidates(current_tournament, court_id, {
						now_ts: now_ms(app),
					});
					if (!candidates || candidates.length === 0) {
						debug_flags.log(app, tournament_key, '[bts] auto_call_trace:call_preparation_match_on_court_no_candidate', {
							ts: now_ms(app),
							tournament_key,
							court_id,
							expected_match_id: expected_match_id || null,
						});
						return reject("No match found to call on court.");
					}
					let next_match = expected_match_id
						? candidates.find((match) => match && match._id === expected_match_id)
						: candidates[0];
					if (!next_match) {
						debug_flags.log(app, tournament_key, '[bts] auto_call_trace:call_preparation_match_on_court_expected_candidate_gone', {
							ts: now_ms(app),
							tournament_key,
							court_id,
							expected_match_id,
							candidate_match_ids: candidates.map((match) => match && match._id).filter(Boolean),
							candidate_match_nums: candidates.map((match) => match && match.setup && match.setup.match_num),
						});
						return reject("Selected match no longer eligible for court.");
					}
					debug_flags.log(app, tournament_key, '[bts] auto_call_trace:call_preparation_match_on_court_candidate', {
						ts: now_ms(app),
						tournament_key,
						court_id,
						match_id: next_match && next_match._id,
						match_num: next_match?.setup?.match_num ?? null,
						state: next_match && next_match.setup && next_match.setup.state,
						highlight: next_match && next_match.setup && next_match.setup.highlight,
						location_id: next_match && next_match.setup && next_match.setup.location_id,
						candidate_count: candidates.length,
					});
					next_match = require('nedb/lib/model').deepCopy(next_match);
					next_match.setup.court_id = court_id;
					next_match.setup.now_on_court = true;
					call_match(app, tournament, next_match, undefined, (callErr) => {
						if (callErr) {
							return reject(callErr);
						}
						return resolve(next_match);
					});
				}).catch((queryErr) => reject(queryErr));
			} else {
				return resolve("Function call_next_possible_scheduled_match_in_preparation disabled");
			}
		});
	});
}

function queue_auto_call_matches_on_free_courts(app, tournament_key, callback) {
	if (require('./btp_sync_effects').capture(app, real_app => queue_auto_call_matches_on_free_courts(real_app, tournament_key), { deferred_job: true },
		{ target: 'match_utils', method: 'queue_auto_call_matches_on_free_courts', args: [tournament_key] })) {
		if (callback) callback(null);
		return;
	}
	// Calculate allocations outside the queue too. Reuse the validated write
	// planner so post-sync calling cannot reintroduce a lock on every match.
	require('./btp_sync_plan').sync(app, tournament_key, { operation: 'auto_call' }, {
		planning_namespace: 'post_sync_auto_call', task_name: 'post_sync_auto_call_apply',
		worker_operation: 'auto_call',
		skip_unchanged: false,
		preflight: require('./auto_call_precheck'),
	}, staged => new Promise((resolve, reject) => {
		_auto_call_matches_on_free_courts_once(staged, tournament_key, err => err ? reject(err) : resolve(true));
	})).then(() => { if (callback) callback(null); }, err => { if (callback) callback(err); });
}

function auto_call_matches_on_free_courts(app, tournament_key, callback) {
	if (require('./btp_sync_effects').capture(app, real_app => auto_call_matches_on_free_courts(real_app, tournament_key), { deferred_job: true },
		{ target: 'match_utils', method: 'auto_call_matches_on_free_courts', args: [tournament_key] })) {
		if (callback) callback(null);
		return;
	}
	if (!app || !app.db || !tournament_key) {
		return callback ? callback(null) : null;
	}

	const pending_run = pending_auto_call_on_court_runs.get(tournament_key);
	if (pending_run) {
		pending_run.pending = true;
		if (callback) {
			pending_run.callbacks.push(callback);
		}
		return null;
	}

	const run_state = {
		pending: false,
		callbacks: callback ? [callback] : [],
	};
	pending_auto_call_on_court_runs.set(tournament_key, run_state);

	const finish_callbacks = (err) => {
		const callbacks = run_state.callbacks.splice(0);
		callbacks.forEach((cb) => cb(err));
	};

	const run_once = () => {
		// Live automatic choices use the validated planner/commit path as well
		// as post-sync choices; ordering cannot change during their commit.
		queue_auto_call_matches_on_free_courts(app, tournament_key, (err) => {
			finish_callbacks(err);
			if (run_state.pending) {
				run_state.pending = false;
				run_once();
				return;
			}
			pending_auto_call_on_court_runs.delete(tournament_key);
		});
	};

	run_once();
	return null;
}

function _auto_call_matches_on_free_courts_once(app, tournament_key, callback) {
	if (!app || !app.db || !tournament_key) {
		return callback ? callback(null) : null;
	}

	require('./preparation_selection/call_reads').callback(app, tournament_key, 'tournaments', (tournamentErr, tournament) => {
		if (tournamentErr) {
			return callback ? callback(tournamentErr) : null;
		}

		require('./preparation_selection/call_reads').callback(app, tournament_key, 'courts', (err, courts) => {
			if (err) {
				return callback ? callback(err) : null;
			}

			const matches_read = require('./preparation_selection/call_reads').read(app, tournament_key, 'matches');
			Promise.all([
				matches_read.then(matches => matches.filter(match => match.setup?.now_on_court === true)),
				matches_read,
				require('./preparation_selection/call_reads').read(app, tournament_key, 'umpires'),
			]).then(([on_court_matches, all_matches, umpires]) => {

				const continue_with_tabletoperators = (tabletoperators) => {
					const match_automation = require('./match_automation');
					const occupied_sources = new Map();
					(on_court_matches || [])
						.filter((match) => match?.setup?.court_id)
						.forEach((match) => {
							if (!occupied_sources.has(match.setup.court_id)) {
								occupied_sources.set(match.setup.court_id, {
									reason: 'occupied_by_on_court_match',
									match_id: match._id || null,
									match_num: match?.setup?.match_num ?? null,
								});
							}
						});
					(courts || []).forEach((court) => {
						if (court?._id && court.match_id) {
							if (!occupied_sources.has(court._id)) {
								occupied_sources.set(court._id, {
									reason: 'court_match_id_set',
									match_id: court.match_id,
									match_num: null,
								});
							}
						}
					});
					const occupied_court_ids = new Set(occupied_sources.keys());
					const active_courts = (courts || []).filter((court) => court && court.is_active === true);
					const free_court_order_debug = build_free_court_order_debug(
						active_courts.filter((court) => court && !occupied_court_ids.has(court._id)),
						tabletoperators,
						tournament,
						courts || []
					);
					const free_active_courts = free_court_order_debug.sorted_courts;
					debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_call_matches_on_free_courts', {
						ts: now_ms(app),
						tournament_key,
						active_court_ids: active_courts.map((court) => court._id),
						occupied_court_ids: Array.from(occupied_court_ids),
						free_active_court_ids: free_active_courts.map((court) => court._id),
					});
					debug_flags.log(app, tournament_key, '[bts] auto_call_trace:field_selection_decision', {
						ts: now_ms(app),
						tournament_key,
						tabletoperator_enabled: tournament?.tabletoperator_enabled === true,
						tabletoperator_assignment_scope: free_court_order_debug.scope,
						waiting_tabletoperators: free_court_order_debug.waiting_tabletoperators,
						courts: (courts || []).map((court) => summarize_court_exclusion(court, occupied_sources)),
						free_court_order: free_court_order_debug.court_order,
					});

					const selection_ts = now_ms(app);
					const current_tournament = {
						...(tournament || {}),
						courts: courts || [],
						matches: all_matches || [],
						umpires: umpires || [],
					};
					const trace_enabled = debug_flags.auto_call_trace_enabled(app, tournament_key);
					const call_selection = match_automation.calculate_call_on_court_selection(current_tournament, free_active_courts, {
						now_ts: selection_ts,
					});
					const potential_call_matches = call_selection.potential_matches;
					if (potential_call_matches.length === 0) {
						debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_call_matches_on_free_courts_no_global_candidates', {
							ts: now_ms(app),
							tournament_key,
							selection_ts,
							only_preparation: tournament?.call_on_court_only_preparation_enabled === true,
							preparation_match_count: (all_matches || []).filter((match) => match?.setup?.state === 'preparation').length,
							scheduled_match_count: (all_matches || []).filter((match) => match?.setup?.state === 'scheduled').length,
						});
						return callback ? callback(null) : null;
					}
					const court_candidate_entries = free_active_courts.map((court) => {
						const candidate_matches = call_selection.by_court.get(court._id);
						const rejection_diagnostics = trace_enabled
							? summarize_call_on_court_rejections(
								match_automation,
								current_tournament,
								court._id,
								all_matches || [],
								selection_ts
							)
							: [];
						return {
							court,
							candidate_matches,
							rejection_diagnostics,
						};
					});
					const has_any_candidate = court_candidate_entries.some((entry) => entry.candidate_matches.length > 0);
					if (!has_any_candidate) {
						debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_call_matches_on_free_courts_no_candidates', {
							ts: now_ms(app),
							tournament_key,
							selection_ts,
							courts: court_candidate_entries.map((entry) => ({
								court_id: entry.court && entry.court._id,
								court_num: entry.court && entry.court.num,
								candidate_match_nums: [],
								preparation_match_diagnostics: entry.rejection_diagnostics,
							})),
						});
						return callback ? callback(null) : null;
					}

					const { call_plan, skipped_priority_matches } = build_match_first_field_assignment_plan(
						potential_call_matches,
						court_candidate_entries
					);

					debug_flags.log(app, tournament_key, '[bts] auto_call_trace:match_first_field_assignment_plan', {
						ts: now_ms(app),
						tournament_key,
						selection_ts,
						global_match_order: potential_call_matches.map((match) => ({
							match_id: match && match._id,
							match_num: match?.setup?.match_num ?? null,
							state: match?.setup?.state || null,
							preparation_call_timestamp: match?.setup?.preparation_call_timestamp || null,
						})),
						free_court_order: free_active_courts.map((court) => ({
							court_id: court && court._id,
							court_num: court && court.num,
						})),
						assignments: call_plan.map((entry) => ({
							match_id: entry.match && entry.match._id,
							match_num: entry.match?.setup?.match_num ?? null,
							court_id: entry.court && entry.court._id,
							court_num: entry.court && entry.court.num,
						})),
						skipped_priority_matches,
					});

					if (call_plan.length === 0) {
						debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_call_matches_on_free_courts_no_assignments', {
							ts: now_ms(app),
							tournament_key,
							selection_ts,
							skipped_priority_matches,
						});
						return callback ? callback(null) : null;
					}

					async.eachSeries(call_plan, (entry, cb) => {
						const court = entry.court;
						const match = entry.match;
						debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_call_matches_on_free_courts_candidates', {
							ts: now_ms(app),
							tournament_key,
							court_id: court && court._id,
							court_num: court && court.num,
							result: 'will_try_selected_match',
							selected_candidate_match_num: match?.setup?.match_num ?? null,
							selected_candidate_match_id: match?._id || null,
							candidate_match_nums: [match?.setup?.match_num ?? null],
						});
						call_preparation_match_on_court(app, tournament_key, court._id, match?._id)
							.then(() => {
								debug_flags.log(app, tournament_key, '[bts] auto_call_trace:field_call_result', {
									ts: now_ms(app),
									tournament_key,
									court_id: court && court._id,
									court_num: court && court.num,
									match_id: match && match._id,
									match_num: match?.setup?.match_num ?? null,
									result: 'called',
								});
								occupied_court_ids.add(court._id);
								return cb(null);
							})
							.catch((callErr) => {
								const message = callErr && (callErr.message || String(callErr));
								if (/No match found to call on court|Selected match no longer eligible/.test(message)) {
									debug_flags.log(app, tournament_key, '[bts] auto_call_trace:field_call_result', {
										ts: now_ms(app),
										tournament_key,
										court_id: court && court._id,
										court_num: court && court.num,
										match_id: match && match._id,
										match_num: match?.setup?.match_num ?? null,
										result: 'skipped_no_candidate',
										error: message,
									});
									return cb(null);
								}
								debug_flags.log(app, tournament_key, '[bts] auto_call_trace:field_call_result', {
									ts: now_ms(app),
									tournament_key,
									court_id: court && court._id,
									court_num: court && court.num,
									match_id: match && match._id,
									match_num: match?.setup?.match_num ?? null,
									result: 'error',
									error: message,
								});
								return cb(callErr);
							});
					}, (finalErr) => {
						if (callback) {
							callback(finalErr);
						}
					});
				};

				if (tournament?.tabletoperator_enabled !== true) {
					return continue_with_tabletoperators([]);
				}

				app.db.tabletoperators.find({ tournament_key, court: null, start_ts: { $lte: now_ms(app) } }, (tabletErr, tabletoperators) => {
					if (tabletErr) {
						return callback ? callback(tabletErr) : null;
					}
					return continue_with_tabletoperators(tabletoperators || []);
				});
			}).catch((queryErr) => {
				return callback ? callback(queryErr) : null;
			});
		});
	});
}

async function call_next_possible_match_for_preparation(app, tournament_key, callback) {
	app.db.tournaments.findOne({ key: tournament_key }, async (err, tournament) => {
		if (err) {
			return callback("No tournament found for ");
		}
		if (tournament.call_next_possible_scheduled_match_in_preparation) {
			const match_querry = { 'tournament_key': tournament_key, 'setup.state': 'scheduled' };
			app.db.matches.find(match_querry).sort({ 'setup.scheduled_date': 1, 'setup.scheduled_time_str': 1, 'match_order': 1 }).exec((err, matches) => {
				if (err) {
					return callback(err);
				}
				if (matches && matches.length > 0) {
					const now = now_ms(app);
						for (var i = 0; i < matches.length; ++i) {
							var match = matches[i];
							var possible = true;
							for_each_setup_player(match?.setup, (player) => {
								if (possible == true) {
									if (player.now_playing_on_court != undefined) {
										if (player.now_playing_on_court === false) {
											possible = true;
										} else {
											possible = false;
										}
									}
									if (possible) { 
										if (player.now_tablet_on_court != undefined) {
											if (player.now_tablet_on_court === false) {
												possible = true;
											} else {
												possible = false;
											}
										}
										if (possible) {
											if (player.tablet_break_active === true) {
												const tablet_break_until_ts = Number(player.tablet_break_until_ts);
												if (Number.isFinite(tablet_break_until_ts) && now < tablet_break_until_ts) {
													possible = false;
												}
											}
										}
										if (possible) {
											if (player.last_time_on_court_ts) {
												if ((now - player.last_time_on_court_ts) < tournament.btp_settings.pause_duration_ms) {
													possible = false;
												} else {
													possible = true;
												}
											}
										}
									}
							}
						});
						if (possible) {
							call_match_in_preparation(app, tournament, match, null, callback);
							break;
						}
					}
				} else {
					return callback("No match found to call on court.");
				}
			});
		} else {
			return callback(null);
		}
	});
}


async function call_match_in_preparation(app, tournament, match, location_id, callback, options = {}) {
	const tournament_key = tournament.key;
	const admin = require('./admin');
	const match_id = match._id;
	const force = options && options.force === true;
	const use_preparation_call_gap = options && options.automatic_preparation_call === true;
	const preparation_call_gap_checked = options && options.preparation_call_gap_checked === true;
	const preparation_lock = acquire_preparation_call_lock(match_id);
	if (preparation_lock.error) {
		if (use_preparation_call_gap) {
			debug_flags.log(app, tournament_key, '[bts] auto_call_trace:preparation_call_skipped_locked', {
				ts: now_ms(app),
				tournament_key,
				match_id,
				match_num: match?.setup?.match_num ?? null,
				error: preparation_lock.error.message,
			});
			return callback(null);
		}
		return callback(preparation_lock.error);
	}
	const finish = (err) => {
		preparation_lock.release();
		return callback(err);
	};

	app.db.matches.findOne({ _id: match_id, tournament_key }, async (findErr, current_match) => {
		if (findErr) {
			return finish(findErr);
		}
		if (!current_match) {
			return finish(new Error('Cannot find match ' + match_id + ' of tournament ' + tournament_key + ' in database'));
		}
		const setup = current_match.setup || match.setup || {};
		const dns_error = require('../static/js/btp_entry_status').call_error(current_match);
		if (dns_error) return finish(dns_error);
		if (
			!force &&
			current_match.setup &&
			current_match.setup.state === 'preparation' &&
			(use_preparation_call_gap || !location_id || current_match.setup.location_id === location_id)
		) {
			if (use_preparation_call_gap) {
				debug_flags.log(app, tournament_key, '[bts] auto_call_trace:preparation_call_skipped_already_prepared', {
					ts: now_ms(app),
					tournament_key,
					match_id,
					match_num: current_match?.setup?.match_num ?? match?.setup?.match_num ?? null,
					current_location_id: current_match.setup.location_id || null,
					requested_location_id: location_id || null,
				});
			}
			return finish(null);
		}

		if (force) {
			try {
				const match_automation = require('./match_automation');
				const [courts, matches, umpires, tabletoperators] = await Promise.all([
					app.db.courts.find_async({ tournament_key }),
					app.db.matches.find_async({ tournament_key }),
					app.db.umpires.find_async({ tournament_key }),
					app.db.tabletoperators.find_async({ tournament_key }),
				]);
				const current_tournament = {
					...(tournament || {}),
					courts,
					matches,
					umpires,
					tabletoperators,
				};
				const diagnostics = match_automation.calculate_match_preparation_diagnostics(
					current_match,
					location_id,
					current_tournament
					);
					if (diagnostics.manual_eligible !== true) {
						return finish(new Error('Match cannot be called in preparation manually.'));
					}
				} catch (eligibilityErr) {
					return finish(eligibilityErr);
				}
			}

		if (!force) {
			try {
				const match_automation = require('./match_automation');
				const reads = require('./preparation_selection/model_reads');
				const [courts, matches, umpires, tabletoperators] = await Promise.all(
					['courts', 'matches', 'umpires', 'tabletoperators'].map(collection =>
						reads.read(app, tournament_key, collection, use_preparation_call_gap)));
				const current_tournament = {
					...(tournament || {}),
					courts,
					matches,
					umpires,
					tabletoperators,
				};
				if (!match_automation.is_match_eligible_for_preparation(current_match, location_id, current_tournament)) {
					return finish(null);
				}
			} catch (eligibilityErr) {
				return finish(eligibilityErr);
			}
		}

			try {
				const preparation_call_timestamp = use_preparation_call_gap
					? (preparation_call_gap_checked ? now_ms(app) : await wait_for_preparation_call_gap(app, tournament))
					: now_ms(app);
				await add_preparation_call_timestamp(app, tournament_key, setup, location_id, preparation_call_timestamp);

				if (is_tournament_automation_enabled(tournament) && tournament.preparation_tabletoperator_setup_enabled) {
					if (!setup.umpire || (tournament.tabletoperator_with_umpire_enabled && tournament.tabletoperator_with_umpire_enabled == true)) {
						if (!setup.tabletoperators || setup.tabletoperators == null) {
							const fetch_result = await fetch_tabletoperator(admin, app, tournament, "prep_call");
							let value = [];
							if (tournament.tabletoperator_with_state_from_match_enabled && typeof(fetch_result) == "undefined") {
								value.push({
									asian_name: false,
									name: first_setup_player_state(setup),
									firstname: "",
									lastname: "",
									btp_id: -1});
							} else {
								value = fetch_result;
							}

			                if (!setup.umpire || !setup.umpire.name || (tournament.tabletoperator_with_umpire_enabled && tournament.tabletoperator_with_umpire_enabled == true)) {
			                    setup.tabletoperators = value;
			                }
						}
					}
				}
				set_umpire_to_standby(app, tournament_key, setup);
			} catch (preparationErr) {
				return finish(preparationErr);
			}

				app.db.matches.update({ _id: match_id, tournament_key }, { $set: { setup } }, { returnUpdatedDocs: true }, function (err, numAffected, changed_match) {
				if (err) {
					return finish(err);
				}
				if (numAffected !== 1) {
					return finish(new Error('Cannot find match ' + match_id + ' of tournament ' + tournament_key + ' in database'));
				}
				if (changed_match._id !== match_id) {
					const errmsg = 'Match ' + changed_match._id + ' changed by accident, intended to change ' + match_id + ' (old nedb version?)';
					serror.silent(errmsg);

					return finish(new Error(errmsg));
				}
				return auto_assign_technical_officials_for_match(app, tournament, match_id, (assignErr) => {
					if (assignErr) {
						return finish(assignErr);
					}
					app.db.matches.findOne({ _id: match_id, tournament_key }, (latestErr, latest_match) => {
						if (latestErr) {
							return finish(latestErr);
						}
						const final_match = latest_match || changed_match;
						admin.notify_change(app, tournament_key, 'match_preparation_call', { match__id: match_id, match: final_match});
						const btp_manager = require('./btp_manager');
						btp_manager.update_highlight(app, final_match);
						return finish(null);
					});
				});
		});
	});
}

function update_btp_courts(app, tournament_key, match, callback) {
	const stournament = require('./stournament');
	const btp_manager = require('./btp_manager');
	stournament.get_courts(app.db, tournament_key, (err, all_courts) => {
		if (err) {
			callback(err);
			return;
		}

		const courts = [];

		all_courts.forEach((element, index) => {
			if (match.setup.court_id === element._id && match.setup.now_on_court) {
				const court = {
					btp_id: element.btp_id,
					btp_match_id: match.btp_match_ids[0].id,
				}

				courts.push(court);
			} else if (element.match_id && element.match_id == ("btp_" + match.btp_id) && !match.setup.now_on_court) {
				const court = {
					btp_id: element.btp_id
				}

				courts.push(court);
			}
		});

		btp_manager.update_courts(app, tournament_key, courts);

		callback(null);
		return;
	});
}
function reset_player_tabletoperator(app, tournament_key, match_id, end_ts, options = {}) {
	return require('./match_cleanup/finish')(app, tournament_key, match_id, end_ts, {
		remove_player_on_court, remove_tablet_on_court, remove_umpire_on_court,
		add_player_to_tabletoperator_list_by_match, update_btp_courts,
	}, options);
}

module.exports ={
	_plan_auto_call_once: _auto_call_matches_on_free_courts_once,
    add_player_to_tabletoperator_list,
	call_match,
	calc_match_set_player_on_court,
	calc_match_set_player_on_tablet,
	switch_court,
	match_update,
	uncall_match,
	fetch_match,
	fetch_tabletoperator,
	match_completly_initialized,
	remove_player_on_court,
	remove_tablet_on_court,
	remove_umpire_on_court,
	set_player_on_court,
	set_player_on_tablet,
	set_players_on_courts,
	set_umpire_to_standby,
	add_preparation_call_timestamp,
	remove_preparation_call_timestamp,
	normalize_preparation_state,
	reset_player_tabletoperator,
	reconcile_player_court_flags_for_tournament,
	queue_reconcile_player_court_flags,
	start_player_court_reconciliation_manager,
	_release_blocked_match_if_no_players_on_court: release_blocked_match_if_no_players_on_court,
	_close_tabletoperator_assignment_on_court: close_tabletoperator_assignment_on_court,
	_wait_for_preparation_call_gap: wait_for_preparation_call_gap,
	apply_official_on_court_release,
	apply_official_pause_expiry,
	apply_official_standby_state,
	auto_execute_preparation_selection,
	auto_execute_preparation_selections,
	auto_execute_preparation_selection_for_setup,
	queue_auto_execute_preparation_selections,
	score_update_should_trigger_auto_preparation,
	technical_official_auto_assignment_mode_supports_preparation,
	auto_assign_technical_officials_for_match,
	fetch_technical_official_assignment_targets,
	auto_assign_technical_officials_for_preparation_matches,
	queue_auto_assign_technical_officials_when_available,
	get_technical_official_break_after_assignment_ms,
	process_expired_technical_official_breaks_for_tournament,
	queue_process_expired_technical_official_breaks,
	start_technical_official_pause_manager,
	process_preparation_age_auto_calls_for_tournament,
	start_preparation_age_auto_call_manager,
	process_preparation_pause_auto_calls_for_tournament,
	start_preparation_pause_auto_call_manager,
	auto_call_matches_on_free_courts,
	queue_auto_call_matches_on_free_courts,
	call_preparation_match_on_court,
	call_next_possible_match_for_preparation,
	call_match_in_preparation,
	_build_match_first_field_assignment_plan: build_match_first_field_assignment_plan,
	_ensure_match_not_already_on_other_court: ensure_match_not_already_on_other_court,
	sort_free_courts_for_auto_call,
	is_tournament_automation_enabled,
	is_technical_official_unavailable,
	get_effective_technical_official_checked_in,
	sync_technical_official_checked_in
};
