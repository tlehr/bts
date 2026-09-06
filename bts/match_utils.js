'use_strict';

const assert = require('assert');
const async = require('async');
const debug_flags = require('./debug_flags');
const update_queue = require('./update_queue');

const pending_preparation_selection_runs = new Map();
const pending_technical_official_assignment_runs = new Map();
const pending_technical_official_pause_runs = new Map();
const pending_player_court_reconciliation_runs = new Map();
let technical_official_pause_interval = null;
let player_court_reconciliation_interval = null;

function now_ms(app) {
	return app?.clock ? app.clock.now_ms() : Date.now();
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

function log_missing_cleanup_context(context, tournament_key, match_id, match) {
	console.warn('[bts] skipped match cleanup: missing match setup context', {
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

function sort_free_courts_for_auto_call(courts, tabletoperators, tournament, all_courts) {
	const free_courts = Array.isArray(courts) ? [...courts] : [];
	if (tournament?.tabletoperator_enabled !== true) {
		return free_courts.sort(cmp_court_order);
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

	const preferred_court_index = new Map();
	const scope = normalize_tabletoperator_assignment_scope(tournament);

	(Array.isArray(tabletoperators) ? [...tabletoperators] : [])
		.filter((tabletoperator) => tabletoperator && tabletoperator.court == null)
		.sort((a, b) => Number(a.start_ts || 0) - Number(b.start_ts || 0))
		.forEach((tabletoperator, index) => {
			const played_on_court = tabletoperator?.played_on_court;
			if (!played_on_court) {
				return;
			}
			if (free_court_ids.has(played_on_court) && !preferred_court_index.has(played_on_court)) {
				preferred_court_index.set(played_on_court, index);
			}
			if (scope !== 'same_location') {
				return;
			}

			const played_location_id = court_location_by_id.get(played_on_court);
			if (!played_location_id) {
				return;
			}
			(free_courts_by_location_id.get(played_location_id) || []).forEach((court_id) => {
				if (!preferred_court_index.has(court_id)) {
					preferred_court_index.set(court_id, index);
				}
			});
		});

	return free_courts.sort((c1, c2) => {
		const preference1 = preferred_court_index.has(c1?._id) ? preferred_court_index.get(c1._id) : Number.POSITIVE_INFINITY;
		const preference2 = preferred_court_index.has(c2?._id) ? preferred_court_index.get(c2._id) : Number.POSITIVE_INFINITY;
		if (preference1 !== preference2) {
			return preference1 - preference2;
		}
		return cmp_court_order(c1, c2);
	});
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


async function call_match(app, tournament, match, old_court, callback) {
    if (!match.setup.court_id || !match._id) {
		return callback("Match cannot be called court_id or _id not given.");
    }
	if (match_completly_initialized(match.setup) == false) { 
		return callback("Match cannot be called one or more Teams are not set.");
	}
	debug_flags.log(app, tournament && tournament.key, '[bts] auto_call_trace:call_match_start', {
		ts: now_ms(app),
		tournament_key: tournament && tournament.key,
		match_id: match._id,
		court_id: match.setup && match.setup.court_id,
		old_court,
		state: match.setup && match.setup.state,
		now_on_court: match.setup && match.setup.now_on_court,
	});
	async.waterfall([	(wcb) => ensure_court_available_for_match(app, tournament.key, match, wcb),
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
		(wcb) => set_player_on_court(app, tournament.key, match.setup, wcb),
		(wcb) => set_player_on_tablet(app, tournament.key, match.setup, wcb),
		(wcb) => update_btp_courts(app, tournament.key, match, wcb),
		(wcb) => auto_execute_preparation_selection_for_setup(app, tournament, match.setup, wcb)],
		(err) => {
			debug_flags.log(app, tournament && tournament.key, '[bts] auto_call_trace:call_match_end', {
				ts: now_ms(app),
				tournament_key: tournament && tournament.key,
				match_id: match && match._id,
				court_id: match && match.setup && match.setup.court_id,
				called_timestamp: match && match.setup && match.setup.called_timestamp,
				error: err ? (err.message || String(err)) : null,
			});
			return callback(err, match);
		}
	);
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
		(wcb) => set_player_on_court(app, tournament.key, match.setup, wcb),
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

function add_preparation_call_timestamp(app, tournament_key, setup, location_id) {
	return new Promise((resolve) => {
		const stournament = require('./stournament');
		
		stournament.get_locations(app.db, tournament_key, (err, all_locations) => {
			for (const location of all_locations) {
				if (location._id == location_id) {
						setup.highlight = location.highlight;
						setup.location_id = location_id;
						setup.preparation_call_timestamp = now_ms(app);
						setup.state = 'preparation';
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

function auto_execute_preparation_selection(app, tournament, location_id, callback) {
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
	match_automation.fetch_location_preparation_selection(app, tournament.key, location_id, {
		now_ts: now_ms(app),
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
				async.eachSeries(selection.auto_selected_matches || [], (match, cb) => {
					call_match_in_preparation(app, tournament, match, location_id, cb);
				}, callback);
		})
		.catch((err) => callback(err));
}

function auto_execute_preparation_selections(app, tournament, callback) {
	if (!tournament || !tournament.key) {
		return callback(null);
	}
	if (!is_tournament_automation_enabled(tournament)) {
		return callback(null);
	}
	if (!tournament.call_preparation_matches_automatically_enabled) {
		return callback(null);
	}

	app.db.locations.find({ tournament_key: tournament.key }).sort({ name: 1 }).exec((err, locations) => {
		if (err) {
			return callback(err);
		}

		async.eachSeries(locations || [], (location, cb) => {
			if (!location || !location._id) {
				return cb(null);
			}
			return auto_execute_preparation_selection(app, tournament, location._id, cb);
		}, callback);
	});
}

function auto_execute_preparation_selection_for_setup(app, tournament, setup, callback) {
	if (!tournament || !tournament.key) {
		return callback(null);
	}
	return auto_execute_preparation_selections(app, tournament, (err) => {
		if (err) {
			return callback(err);
		}
		return auto_assign_technical_officials_for_preparation_matches(app, tournament, callback);
	});
}

function queue_auto_execute_preparation_selections(app, tournament_key, callback) {
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

	update_queue.instance().execute(update_queue.named('auto_execute_preparation_selections', () => new Promise((resolve, reject) => {
		app.db.tournaments.findOne({ key: tournament_key }, (err, tournament) => {
			if (err) {
				return reject(err);
			}
			if (!tournament) {
				return reject(new Error('Cannot find tournament ' + tournament_key));
			}
			return auto_execute_preparation_selections(app, tournament, (execErr) => {
				if (execErr) {
					return reject(execErr);
				}
				return resolve(true);
			});
		});
	}))).then(() => {
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

	update_queue.instance().execute(update_queue.named('auto_assign_technical_officials_when_available', () => new Promise((resolve, reject) => {
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
	}))).then(() => {
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
	
	app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
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

async function set_player_on_tablet (app, tkey, match_on_court_setup, callback) {	
	
	if(!match_on_court_setup.tabletoperators || match_on_court_setup.tabletoperators.length == 0) {
		return callback(null);
	}
	
	const admin = require('./admin'); // avoid dependency cycle	
	app.db.matches.find({'tournament_key': tkey}, async (err, matches) => {
		if (err) {
			callback(err);
		}

		async.each(matches, async (match, cb) => {
			const changed_match = await calc_match_set_player_on_tablet(match, match_on_court_setup)
			if (changed_match != null) {
				const setup = changed_match.setup;
				const match_q = {_id: changed_match._id};
				app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
					if (err) return callback(err);
					admin.notify_change(app, changed_match.tournament_key, 'update_player_status', {match__id: changed_match._id,
																									btp_winner: changed_match.btp_winner, 
																									setup: changed_match.setup});
				});
			}
		});

		callback(null);
	});
}

function calc_match_set_player_on_court(match, match_on_court_setup) {
	return new Promise((resolve) => {
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

async function set_player_on_court (app, tkey, match_on_court_setup, callback) {	
	const admin = require('./admin'); // avoid dependency cycle	
	app.db.matches.find({'tournament_key': tkey}, async (err, matches) => {
		if (err) {
			callback(err);
		}

		async.each(matches, async (match) => {
			const changed_match = await calc_match_set_player_on_court(match, match_on_court_setup);
			if (changed_match != null) {
				const setup = changed_match.setup;
				const match_q = {_id: changed_match._id};
				app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
					if (err) return callback(err);

					admin.notify_change(app, changed_match.tournament_key, 'update_player_status', {match__id: changed_match._id,
																							btp_winner: changed_match.btp_winner, 
																							setup: changed_match.setup});
				});
			}
		});

		callback(null);
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


function remove_player_on_court (app, tkey, cur_match_id, end_ts = null, callback)	{
	const admin = require('./admin'); // avoid dependency cycle
	const btp_manager = require('./btp_manager');

	app.db.matches.findOne({'tournament_key': tkey, '_id': cur_match_id}, (err, cur_match) => {
		if (err) return callback(err);
		const remove_btp_ids = setup_player_btp_ids(cur_match?.setup);
		if (remove_btp_ids.length === 0) {
			log_missing_cleanup_context('remove_player_on_court', tkey, cur_match_id, cur_match);
			return callback(null);
		}

		app.db.matches.find({'tournament_key': tkey}, async (err, matches) => {
			if (err) {
				return callback(err);
			}

			async.each(matches, (match, cb) => {
				if(!match.setup)
				{
					return cb(null);
				}
				
				if(match.setup.now_on_court == true) {
					return cb(null);
				}
				
				const match_id = match._id;
				const players_to_change = [];
				const is_finished_match = match_id === cur_match_id;
				const team0_players = setup_team_players(match.setup, 0);
				const team1_players = setup_team_players(match.setup, 1);

				let change = false;
				
				if (team0_players.length > 0 &&
					remove_btp_ids.includes(team0_players[0].btp_id) &&
					(team0_players[0].now_playing_on_court || is_finished_match)) {
						team0_players[0].now_playing_on_court = false;
						team0_players[0].checked_in = false;
						if(end_ts) {
							team0_players[0].last_time_on_court_ts = end_ts;
						}
						players_to_change.push(team0_players[0]);
						change = true;
				}

				if (team0_players.length > 1 &&
					remove_btp_ids.includes(team0_players[1].btp_id) &&
					(team0_players[1].now_playing_on_court || is_finished_match)) {
						team0_players[1].now_playing_on_court = false;
						team0_players[1].checked_in = false;
						if(end_ts) {
							team0_players[1].last_time_on_court_ts = end_ts;
						}
						players_to_change.push(team0_players[1]);
						change = true;
				}

				if (team1_players.length > 0 &&
					remove_btp_ids.includes(team1_players[0].btp_id) &&
					(team1_players[0].now_playing_on_court || is_finished_match)) {
						team1_players[0].now_playing_on_court = false;
						team1_players[0].checked_in = false;
						if(end_ts) {
							team1_players[0].last_time_on_court_ts = end_ts;
						}
						players_to_change.push(team1_players[0]);
						change = true;
				}

				if (team1_players.length > 1 &&
					remove_btp_ids.includes(team1_players[1].btp_id) &&
					(team1_players[1].now_playing_on_court || is_finished_match)) {
						team1_players[1].now_playing_on_court = false;
						team1_players[1].checked_in = false;
						if(end_ts) {
							team1_players[1].last_time_on_court_ts = end_ts;
						}
						players_to_change.push(team1_players[1]);
						change = true;
				}

				if (change) {
					btp_manager.update_players(app, tkey, players_to_change);
					const setup = match.setup;
					const match_q = {_id: match_id};
					app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
						if (err) return cb(err);

						admin.notify_change(app, match.tournament_key, 'update_player_status',{	match__id: match._id,
																								btp_winner: match.btp_winner, 
																								setup: match.setup});

						return cb(null);
					});
				} else {
					return cb(null);
				}	
			}, callback);
		});
	});
	
}


function remove_tablet_on_court (app, tkey, cur_match_id, end_ts, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	app.db.tournaments.findOne({ key: tkey }, async (err, tournament) => {
		if (err) {
			return callback(err);
		}
		app.db.matches.findOne({'tournament_key': tkey, '_id': cur_match_id}, (err, cur_match) => {
			if (err) return callback(err);
			const remove_btp_ids = setup_tabletoperator_btp_ids(cur_match?.setup);
			if (remove_btp_ids.length === 0) {
				log_missing_cleanup_context('remove_tablet_on_court', tkey, cur_match_id, cur_match);
				return callback(null);
			}

			app.db.matches.find({'tournament_key': tkey}, async (err, matches) => {
				if (err) {
					console.error(err);
					return callback(err);
				}

				async.each(matches, (match, cb) => {
					if(!match?.setup) {
						return cb(null);
					}

					const match_id = match._id;
					const team0_players = setup_team_players(match.setup, 0);
					const team1_players = setup_team_players(match.setup, 1);

					let change = false;
				
					if (team0_players.length > 0 &&
						remove_btp_ids.includes(team0_players[0].btp_id)) {
						reset_tabletoperator_settings_at_player(app, tkey, tournament, team0_players[0], end_ts);
						change = true;
					}

					if (team0_players.length > 1 &&
						remove_btp_ids.includes(team0_players[1].btp_id)) {
						reset_tabletoperator_settings_at_player(app, tkey, tournament, team0_players[1], end_ts);
						change = true;
					}

					if (team1_players.length > 0 &&
						remove_btp_ids.includes(team1_players[0].btp_id)) {
						reset_tabletoperator_settings_at_player(app, tkey, tournament, team1_players[0], end_ts);
						change = true;
					}

					if (team1_players.length > 1 &&
						remove_btp_ids.includes(team1_players[1].btp_id)) {
						reset_tabletoperator_settings_at_player(app, tkey, tournament, team1_players[1], end_ts);
						change = true;
					}

					if (change) {
						const setup = match.setup;
						const match_q = {_id: match_id};
						
						app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
							if (err) return cb(err);
							admin.notify_change(app, match.tournament_key, 'update_player_status', {	match__id: match._id,
																										btp_winner: match.btp_winner, 
																										setup: match.setup});
							
							return cb(null);
						});
					} else {
						return cb(null);
					}
				}, callback);
			});
		});	
	});
}

function reset_tabletoperator_settings_at_player(app, tkey, tournament, player, end_ts) {
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
		btp_manager.update_players(app, tkey, [player]);
		
	} else {
		if (!tournament?.btp_settings?.check_in_per_match && player.last_time_on_court_ts) {
			if ((now - player.last_time_on_court_ts) > tournament.btp_settings.pause_duration_ms) {
				player.checked_in = true;
			}
		}
		player.tablet_break_active = false;
		btp_manager.update_players(app, tkey, [player]);
	}
}

function collect_expected_player_court_flags(matches) {
	const expected_playing_courts = new Map();
	const expected_tablet_courts = new Map();
	(matches || [])
		.filter((match) => match?.setup && typeof match.team1_won !== 'boolean')
		.forEach((match) => {
			const court_id = match?.setup?.court_id;
			if (!court_id) {
				return;
			}
			if (match.setup.now_on_court === true) {
				for_each_setup_player(match.setup, (player) => {
					const player_btp_id = Number(player?.btp_id);
					if (Number.isFinite(player_btp_id) && player_btp_id !== -1) {
						expected_playing_courts.set(player_btp_id, court_id);
					}
				});
				(Array.isArray(match.setup.tabletoperators) ? match.setup.tabletoperators : []).forEach((operator) => {
					const operator_btp_id = Number(operator?.btp_id);
					if (Number.isFinite(operator_btp_id) && operator_btp_id !== -1) {
						expected_tablet_courts.set(operator_btp_id, court_id);
					}
				});
			}
		});
	return { expected_playing_courts, expected_tablet_courts };
}

function reconcile_player_court_flags_for_match(app, tournament_key, match, expected_flags, end_ts, callback) {
	if (!match?.setup) {
		return callback(null, false);
	}
	const btp_manager = require('./btp_manager');
	const admin = require('./admin');
	const players_to_update = [];
	let changed = false;

	for_each_setup_player(match.setup, (player) => {
		if (!player) {
			return;
		}
		const btp_id = Number(player.btp_id);
		const expected_playing_court = Number.isFinite(btp_id) ? expected_flags.expected_playing_courts.get(btp_id) : null;
		const expected_tablet_court = Number.isFinite(btp_id) ? expected_flags.expected_tablet_courts.get(btp_id) : null;
		const has_wrong_playing_flag = !!player.now_playing_on_court && player.now_playing_on_court !== expected_playing_court;
		const has_wrong_tablet_flag = !!player.now_tablet_on_court && player.now_tablet_on_court !== expected_tablet_court;

		if (has_wrong_playing_flag) {
			player.now_playing_on_court = false;
			player.checked_in = false;
			player.tablet_break_active = false;
			players_to_update.push(player);
			changed = true;
		}

		if (has_wrong_tablet_flag) {
			player.now_tablet_on_court = false;
			player.tablet_break_active = false;
			players_to_update.push(player);
			changed = true;
		}
	});

	if (!changed) {
		return callback(null, false);
	}

	const setup = match.setup;
	app.db.matches.update({ _id: match._id }, { $set: { setup } }, {}, (err) => {
		if (err) {
			return callback(err);
		}
		if (players_to_update.length > 0) {
			btp_manager.update_players(app, tournament_key, players_to_update);
		}
		admin.notify_change(app, tournament_key, 'update_player_status', {
			match__id: match._id,
			btp_winner: match.btp_winner,
			setup: match.setup,
		});
		return callback(null, true);
	});
}

function reconcile_player_court_flags_for_tournament(app, tournament, callback) {
	if (!app || !app.db || !tournament?.key) {
		return callback(null);
	}
	const tournament_key = tournament.key;
	const end_ts = now_ms(app);
	app.db.matches.find({ tournament_key }, (err, matches) => {
		if (err) {
			return callback(err);
		}
		const expected_flags = collect_expected_player_court_flags(matches);
		let changed_count = 0;
		async.eachSeries(matches || [], (match, cb) => {
			reconcile_player_court_flags_for_match(app, tournament_key, match, expected_flags, end_ts, (match_err, changed) => {
				if (match_err) {
					return cb(match_err);
				}
				if (changed) {
					changed_count++;
				}
				return cb(null);
			});
		}, (reconcile_err) => {
			if (reconcile_err) {
				return callback(reconcile_err);
			}
			if (changed_count > 0) {
				queue_auto_execute_preparation_selections(app, tournament_key);
			}
			return callback(null);
		});
	});
}

function queue_reconcile_player_court_flags(app, tournament_key, callback) {
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

	update_queue.instance().execute(
		update_queue.named(`player_court_reconciliation_${tournament_key}`, () => new Promise((resolve, reject) => {
			app.db.tournaments.findOne({ key: tournament_key }, (err, tournament) => {
				if (err || !tournament) {
					reject(err || new Error('tournament not found'));
					return;
				}
				reconcile_player_court_flags_for_tournament(app, tournament, (reconcile_err) => {
					if (reconcile_err) {
						reject(reconcile_err);
						return;
					}
					resolve(null);
				});
			});
		}))
	).then(() => {
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
	const reconcile_all_tournaments = () => {
		app.db.tournaments.find({}, (err, tournaments) => {
			if (err) {
				return;
			}
			(tournaments || [])
				.filter((tournament) => is_tournament_automation_enabled(tournament))
				.forEach((tournament) => {
					queue_reconcile_player_court_flags(app, tournament.key);
				});
		});
	};
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

async function remove_umpire_on_court(app, tournament_key, cur_match_id, end_ts, callback) {
	app.db.tournaments.findOne({ key: tournament_key }, (tournament_err, tournament) => {
		if (tournament_err) {
			return callback(tournament_err);
		}
		const official_rotation_mode = tournament?.official_rotation_mode || 'umpire_and_service_judge';
		const technical_official_break_after_assignment_ms = get_technical_official_break_after_assignment_ms(tournament);

		app.db.matches.findOne({ 'tournament_key': tournament_key, '_id': cur_match_id }, (err, cur_match) => {
			if (err) {
				return callback(err);
			}
			if (!cur_match?.setup) {
				log_missing_cleanup_context('remove_umpire_on_court', tournament_key, cur_match_id, cur_match);
				return callback(null);
			}
			if (cur_match.setup.umpire) {
				const umpire = apply_official_on_court_release(cur_match.setup.umpire, 'umpire', end_ts, {
					tournament,
					official_rotation_mode,
					technical_official_break_after_assignment_ms,
				});
				update_umpire(app, tournament_key, umpire, 'ready', end_ts, null);
			}

			if (cur_match.setup.service_judge) {
				const service_judge = apply_official_on_court_release(cur_match.setup.service_judge, 'service_judge', end_ts, {
					tournament,
					official_rotation_mode,
					technical_official_break_after_assignment_ms,
				});
				update_umpire(app, tournament_key, service_judge);
			}
			return callback(null);
		});
	});
}

function set_umpire_to_standby(app, tournament_key, setup) {
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



function update_umpire(app, tkey, umpire) {
  if (!umpire || !umpire._id) {
    console.error('update_umpire: invalid umpire object');
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
        return;
      }

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

	update_queue.instance().execute(
		update_queue.named(`technical_official_pause_expiry_${tournament_key}`, () => new Promise((resolve, reject) => {
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
		}))
	).then(() => {
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
	technical_official_pause_interval = setInterval(() => {
		app.db.tournaments.find({
			official_rotation_mode: { $ne: 'disabled' },
			technical_official_break_after_assignment_seconds: { $gt: 0 },
		}, (err, tournaments) => {
			if (err) {
				return;
			}
			(tournaments || []).forEach((tournament) => {
				queue_process_expired_technical_official_breaks(app, tournament.key);
			});
		});
	}, 1000);
}

function call_preparation_match_on_court(app, tournament_key, court_id) {
	return new Promise((resolve, reject) => {
		debug_flags.log(app, tournament_key, '[bts] auto_call_trace:call_preparation_match_on_court_start', {
			ts: now_ms(app),
			tournament_key,
			court_id,
		});
		app.db.tournaments.findOne({ key: tournament_key }, async (err, tournament) => {
			if (err) {
				return reject("No tournament found for ");
			}
			if (!is_tournament_automation_enabled(tournament)) {
				return resolve("Global automation disabled");
			}
			if (tournament.call_next_possible_scheduled_match_in_preparation) {
				const match_automation = require('./match_automation');
				Promise.all([
					app.db.courts.find_async({ tournament_key }),
					app.db.matches.find_async({ tournament_key }),
					app.db.umpires.find_async({ tournament_key }),
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
						});
						return reject("No match found to call on court.");
					}
					const next_match = candidates[0];
					debug_flags.log(app, tournament_key, '[bts] auto_call_trace:call_preparation_match_on_court_candidate', {
						ts: now_ms(app),
						tournament_key,
						court_id,
						match_id: next_match && next_match._id,
						state: next_match && next_match.setup && next_match.setup.state,
						highlight: next_match && next_match.setup && next_match.setup.highlight,
						location_id: next_match && next_match.setup && next_match.setup.location_id,
						candidate_count: candidates.length,
					});
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

function auto_call_matches_on_free_courts(app, tournament_key, callback) {
	if (!app || !app.db || !tournament_key) {
		return callback ? callback(null) : null;
	}

	app.db.tournaments.findOne({ key: tournament_key }, (tournamentErr, tournament) => {
		if (tournamentErr) {
			return callback ? callback(tournamentErr) : null;
		}

		app.db.courts.find({ tournament_key, is_active: true }, (err, courts) => {
			if (err) {
				return callback ? callback(err) : null;
			}

			Promise.all([
				app.db.matches.find_async({ tournament_key, 'setup.now_on_court': true }),
				app.db.matches.find_async({ tournament_key }),
				app.db.umpires.find_async({ tournament_key }),
			]).then(([on_court_matches, all_matches, umpires]) => {

				const continue_with_tabletoperators = (tabletoperators) => {
					const match_automation = require('./match_automation');
					const occupied_court_ids = new Set(
						(on_court_matches || [])
							.filter((match) => match?.setup?.court_id)
							.map((match) => match.setup.court_id)
					);
					const free_active_courts = sort_free_courts_for_auto_call(
						(courts || []).filter((court) => court && !occupied_court_ids.has(court._id)),
						tabletoperators,
						tournament,
						courts || []
					);
					debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_call_matches_on_free_courts', {
						ts: now_ms(app),
						tournament_key,
						active_court_ids: (courts || []).filter((court) => court && court.is_active).map((court) => court._id),
						occupied_court_ids: Array.from(occupied_court_ids),
						free_active_court_ids: free_active_courts.map((court) => court._id),
					});

					async.eachSeries(free_active_courts, (court, cb) => {
						const candidate_match_nums = match_automation.find_call_on_court_candidates({
							...(tournament || {}),
							courts: courts || [],
							matches: all_matches || [],
							umpires: umpires || [],
						}, court._id, {
							now_ts: now_ms(app),
						});
						debug_flags.log(app, tournament_key, '[bts] auto_call_trace:auto_call_matches_on_free_courts_candidates', {
							ts: now_ms(app),
							tournament_key,
							court_id: court && court._id,
							court_num: court && court.num,
							candidate_match_nums: candidate_match_nums.map((match) => match && match.setup && match.setup.match_num),
						});
						call_preparation_match_on_court(app, tournament_key, court._id)
							.then(() => {
								occupied_court_ids.add(court._id);
								return cb(null);
							})
							.catch((callErr) => {
								const message = callErr && (callErr.message || String(callErr));
								if (/No match found to call on court/.test(message)) {
									return cb(null);
								}
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
								call_match_in_preparation(app, tournament,match._id, null, match.setup, callback);
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
	const setup = match.setup;
	const match_id = match._id;
	const force = options && options.force === true;

	app.db.matches.findOne({ _id: match_id, tournament_key }, async (findErr, current_match) => {
		if (findErr) {
			return callback(findErr);
		}
		if (!current_match) {
			return callback(new Error('Cannot find match ' + match_id + ' of tournament ' + tournament_key + ' in database'));
		}
		if (
			current_match.setup &&
			current_match.setup.state === 'preparation' &&
			Number(current_match.setup.highlight) > 0 &&
			(!location_id || current_match.setup.location_id === location_id)
		) {
			return callback(null);
		}

		if (!force) {
			try {
				const match_automation = require('./match_automation');
				const [courts, matches, umpires] = await Promise.all([
					app.db.courts.find_async({ tournament_key }),
					app.db.matches.find_async({ tournament_key }),
					app.db.umpires.find_async({ tournament_key }),
				]);
				const current_tournament = {
					...(tournament || {}),
					courts,
					matches,
					umpires,
				};
				if (!match_automation.is_match_eligible_for_preparation(current_match, location_id, current_tournament)) {
					return callback(null);
				}
			} catch (eligibilityErr) {
				return callback(eligibilityErr);
			}
		}

		await add_preparation_call_timestamp(app, tournament_key, setup, location_id);

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

		app.db.matches.update({ _id: match_id, tournament_key }, { $set: { setup } }, { returnUpdatedDocs: true }, function (err, numAffected, changed_match) {
			if (err) {
				return callback(err);
			}
			if (numAffected !== 1) {
				return callback(new Error('Cannot find match ' + match_id + ' of tournament ' + tournament_key + ' in database'));
			}
			if (changed_match._id !== match_id) {
				const errmsg = 'Match ' + changed_match._id + ' changed by accident, intended to change ' + match_id + ' (old nedb version?)';
				serror.silent(errmsg);
					
				return callback(new Error(errmsg));
			}
			return auto_assign_technical_officials_for_match(app, tournament, match_id, (assignErr) => {
				if (assignErr) {
					return callback(assignErr);
				}
				app.db.matches.findOne({ _id: match_id, tournament_key }, (latestErr, latest_match) => {
					if (latestErr) {
						return callback(latestErr);
					}
					const final_match = latest_match || changed_match;
					admin.notify_change(app, tournament_key, 'match_preparation_call', { match__id: match_id, match: final_match});
					const btp_manager = require('./btp_manager');
					btp_manager.update_highlight(app, final_match);
					return callback(null);
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
function reset_player_tabletoperator(app, tournament_key, match_id, end_ts) {
	return new Promise((resolve, reject) => {
		let current_match = null;
		async.waterfall([
			cb => fetch_match(app, tournament_key, match_id).then((match) => {
				current_match = match;
				cb(null);
			}).catch(cb),
			cb => remove_player_on_court(app, tournament_key, match_id, end_ts, cb),
			cb => remove_tablet_on_court(app, tournament_key, match_id, end_ts, cb),
			cb => remove_umpire_on_court(app, tournament_key, match_id, end_ts, cb),
			cb => add_player_to_tabletoperator_list(app, tournament_key, match_id, end_ts, cb),
			cb => {
				if (!current_match) {
					return cb(null);
				}
				update_btp_courts(app, tournament_key, current_match, cb);
			},
		], function (err) {
			if (err) {
				return reject(err);
			}
			return resolve(null);
		});
	});
}

module.exports ={
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
	set_umpire_to_standby,
	add_preparation_call_timestamp,
	remove_preparation_call_timestamp,
	normalize_preparation_state,
	reset_player_tabletoperator,
	reconcile_player_court_flags_for_tournament,
	queue_reconcile_player_court_flags,
	start_player_court_reconciliation_manager,
	apply_official_on_court_release,
	apply_official_pause_expiry,
	apply_official_standby_state,
	auto_execute_preparation_selection,
	auto_execute_preparation_selections,
	auto_execute_preparation_selection_for_setup,
	queue_auto_execute_preparation_selections,
	technical_official_auto_assignment_mode_supports_preparation,
	auto_assign_technical_officials_for_match,
	fetch_technical_official_assignment_targets,
	auto_assign_technical_officials_for_preparation_matches,
	queue_auto_assign_technical_officials_when_available,
	get_technical_official_break_after_assignment_ms,
	process_expired_technical_official_breaks_for_tournament,
	queue_process_expired_technical_official_breaks,
	start_technical_official_pause_manager,
	auto_call_matches_on_free_courts,
	call_preparation_match_on_court,
	call_next_possible_match_for_preparation,
	call_match_in_preparation,
	sort_free_courts_for_auto_call,
	is_tournament_automation_enabled,
	is_technical_official_unavailable,
	get_effective_technical_official_checked_in,
	sync_technical_official_checked_in
};
