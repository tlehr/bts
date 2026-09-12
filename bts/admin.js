'use strict';

const async = require('async');
const fs = require('fs');
const path = require('path');
const uuidv4 = require('uuid/v4');
const {promisify} = require('util');
const xlsx = require('node-xlsx');

const btp_manager = require('./btp_manager');
const update_queue = require('./update_queue');
const serror = require('./serror');
const stournament = require('./stournament');
const ticker_manager = require('./ticker_manager');
const utils = require('./utils');
const match_automation = require('./match_automation');
const debug_flags = require('./debug_flags');
const displaysettings_defaults = require('./displaysettings_defaults');

const TABLETOPERATOR_RELEASE_SELECTION = '__release_tabletoperators__';
const TABLETOPERATOR_RELEASE_PARTICIPANT_PREFIX = '__release_tabletoperator__:';

function now_ms(app) {
	return app?.clock ? app.clock.now_ms() : Date.now();
}

function now_iso(app) {
	return new Date(now_ms(app)).toISOString();
}


/**
* Returns true iff everything is ok.
*/
function _require_msg(ws, msg, fields) {
	for (const f of fields) {
		if (typeof msg[f] === 'undefined') {
			ws.respond(msg, {message: 'Missing required field ' + f + ' in message ' + msg.type});
			return false;
		}
	}
	return true;
}

function _annotate_tournament(tournament) {
	const tz = utils.get_system_timezone();
	tournament.system_timezone = tz;
	debug_flags.set_from_tournament(tournament);
}

function _get_default_displaysetting_requirements(tournament, displaysetting_id) {
	const requirements = [];
	if (displaysetting_id && tournament && displaysetting_id === tournament.displaysettings_general) {
		requirements.push('display');
	}
	if (displaysetting_id && tournament && displaysetting_id === tournament.displaysettings_general_tablet) {
		requirements.push('umpire');
	}
	return requirements;
}

async function _validate_default_displaysetting_field(app, field, displaysetting_id) {
	if (field !== 'displaysettings_general' && field !== 'displaysettings_general_tablet') {
		return null;
	}
	if (!displaysetting_id) {
		return { message: `Field ${field} requires a display setting` };
	}
	const expected_devicemode = field === 'displaysettings_general_tablet' ? 'umpire' : 'display';
	const displaysetting = await app.db.displaysettings.findOne_async({ id: displaysetting_id });
	if (!displaysetting) {
		return { message: `Display setting ${displaysetting_id} not found` };
	}
	if (displaysetting.devicemode !== expected_devicemode) {
		return { message: `Display setting ${displaysetting_id} must use devicemode ${expected_devicemode}` };
	}
	return null;
}

function _ensure_tournament_displaysetting_defaults(tournament) {
	const displaysettings = Array.isArray(tournament.displaysettings) ? tournament.displaysettings : [];
	const first_display = displaysettings.find((setting) => setting.devicemode === 'display');
	const first_umpire = displaysettings.find((setting) => setting.devicemode === 'umpire');
	const selected_display = displaysettings.find((setting) => setting.id === tournament.displaysettings_general);
	const selected_tablet = displaysettings.find((setting) => setting.id === tournament.displaysettings_general_tablet);
	const patch = {};
	if (!selected_display || selected_display.devicemode !== 'display') {
		patch.displaysettings_general = first_display ? first_display.id : tournament.displaysettings_general;
	}
	if (!selected_tablet || selected_tablet.devicemode !== 'umpire') {
		patch.displaysettings_general_tablet = first_umpire ? first_umpire.id : tournament.displaysettings_general_tablet;
	}
	return patch;
}


function handle_tournament_list(app, ws, msg) {
	app.db.tournaments.find({}, function(err, tournaments) {
		for (const t of tournaments) {
			_annotate_tournament(t);
		}
		ws.respond(msg, err, {tournaments});
	});
}

function handle_confirm_match_finished(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament' });
	}
	if (!msg.court_id) {
		return ws.respond(msg, { message: 'Missing court' });
	}
	if (!msg.match_id) {
		return ws.respond(msg, { message: 'Missing match' });
	}
	const bupws = require('./bupws');
	bupws.confirm_match_finished_from_admin(app, msg.tournament_key, msg.match_id, msg.court_id)
		.then(() => {
			ws.respond(msg, null);
		})
		.catch((err) => {
			ws.respond(msg, err);
		});
}

function handle_tournament_edit_props(app, ws, msg) {
	if (! msg.key) {
		return ws.respond(msg, {message: 'Missing key'});
	}
	if (! msg.props) {
		return ws.respond(msg, {message: 'Missing props'});
	}

	const key = msg.key;
	const props = utils.pluck(msg.props, [
		'name','tguid',
		'automation_enabled',
		'btp_enabled', 'btp_autofetch_enabled', 'btp_readonly',
		'btp_ip', 'btp_password','btp_autofetch_timeout_intervall',
		'is_team', 'is_nation_competition',
		'warmup', 'warmup_ready', 'warmup_start',
		'upcoming_matches_animation_speed', 'upcoming_matches_max_count','upcoming_matches_animation_pause',
		'upcoming_matches_today_only_enabled',
		'self_check_in_called_overlay_duration_ms',
		'ticker_enabled', 'ticker_url', 'ticker_password',
		'language', 'dm_style', 'displaysettings_general', 'displaysettings_general_tablet',
		'bupws_v2_enabled', 'bup_v2_admin_wait_for_score_updates', 'bts_debug_output_enabled', 'bts_auto_call_trace_enabled',
		'tabletoperator_enabled', 'tabletoperator_break_seconds',
		'announcement_speed','announcement_pause_time_ms',
		'tabletoperator_set_break_after_tabletservice','tabletoperator_with_state_enabled',
		'tabletoperator_with_state_from_match_enabled',
		'tabletoperator_winner_of_quaterfinals_enabled','tabletoperator_split_doubles',
		'tabletoperator_use_manual_counting_boards_enabled', 'tabletoperator_with_umpire_enabled', 
		'annoncement_include_event', 'annoncement_include_round','annoncement_include_matchnumber',
		'no_match_cascade_announcements_enabled',
		'preparation_meetingpoint_enabled', 'preparation_tabletoperator_setup_enabled',
		'call_preparation_matches_automatically_enabled', 'call_next_possible_scheduled_match_in_preparation',
		'preparation_successor_rally_count',
		'preparation_call_time_limit_before_scheduled_enabled',
		'preparation_call_time_limit_before_scheduled_minutes',
		'preparation_call_block_ahead_limit_enabled',
		'preparation_call_block_ahead_limit',
		'preparation_call_time_ahead_of_frontier_enabled',
		'preparation_call_time_ahead_of_frontier_minutes',
		'preparation_call_matches_ahead_of_frontier_enabled',
		'preparation_call_matches_ahead_of_frontier_limit',
		'preparation_call_player_pause_expired_enabled',
		'preparation_call_debug_output_enabled',
		'preparation_call_debug_icons_enabled',
		'preparation_call_technical_officials_available_enabled',
		'preparation_call_no_player_waiting_as_tabletoperator_enabled',
		'preparation_call_no_player_active_as_tabletoperator_enabled',
		'call_on_court_time_limit_before_scheduled_enabled',
		'call_on_court_time_limit_before_scheduled_minutes',
		'call_on_court_only_preparation_enabled',
		'call_on_court_only_preparation_minutes',
		'call_on_court_block_ahead_limit_enabled',
		'call_on_court_block_ahead_limit',
		'call_on_court_time_ahead_of_frontier_enabled',
		'call_on_court_time_ahead_of_frontier_minutes',
		'call_on_court_matches_ahead_of_frontier_enabled',
		'call_on_court_matches_ahead_of_frontier_limit',
		'call_on_court_participant_readiness_mode',
		'call_on_court_player_pause_expired_enabled',
		'call_on_court_technical_officials_mode',
		'call_on_court_require_official_space_enabled',
		'official_rotation_mode',
		'technical_official_auto_assignment_mode',
		'technical_official_break_after_assignment_seconds',
		'logo_background_color', 'logo_foreground_color', 'scoring_formats',
		'certificate_title_line_1', 'certificate_title_line_2',
		'certificate_export_location',
		'certificate_export_max_place', 'certificate_export_date',
		'certificate_export_last_scheduled_date_filter',
		'certificate_export_double_swapped_entries_enabled',
		'certificate_age_class_splits',
		'certificate_discipline_replacements']);

	if (msg.props.btp_timezone) {
		props.btp_timezone = msg.props.btp_timezone === 'system' ? undefined : msg.props.btp_timezone;
	}
	app.db.tournaments.findOne({ key }, async (err, tournament) => {
		if (err || !tournament) {
			ws.respond(msg, err);
			return;
		}
		for (const field_name of ['displaysettings_general', 'displaysettings_general_tablet']) {
			if (!Object.prototype.hasOwnProperty.call(props, field_name)) {
				continue;
			}
			const validation_error = await _validate_default_displaysetting_field(app, field_name, props[field_name]);
			if (validation_error) {
				return ws.respond(msg, validation_error);
			}
		}
		app.db.tournaments.update({ key }, { $set: props }, { returnUpdatedDocs: true }, function (err, num, t) {
			if (err) {
				ws.respond(msg, err);
				return;
			}
			if (utils.has_key(props, k => /^btp_/.test(k))) {
				btp_manager.reconfigure(app, t);
			}
			if (utils.has_key(props, k => /^ticker_/.test(k))) {
				ticker_manager.reconfigure(app, t);
			}
			debug_flags.set_from_tournament(t);
			notify_change(app, key, 'props', t);
			if (utils.has_key(props, (k) => k === 'technical_official_auto_assignment_mode' || k === 'official_rotation_mode')) {
				const match_utils = require('./match_utils');
				match_utils.queue_auto_assign_technical_officials_when_available(app, key);
			}
			if (utils.has_key(props, (k) => k === 'technical_official_break_after_assignment_seconds')) {
				const match_utils = require('./match_utils');
				match_utils.queue_process_expired_technical_official_breaks(app, key);
			}
			if (props.automation_enabled === true) {
				const match_utils = require('./match_utils');
				match_utils.queue_auto_assign_technical_officials_when_available(app, key);
				match_utils.queue_auto_execute_preparation_selections(app, key, (selectionErr) => {
					if (selectionErr) {
						console.warn('[bts] failed to resume preparation automation', selectionErr && (selectionErr.stack || selectionErr.message || String(selectionErr)));
						return;
					}
					match_utils.auto_call_matches_on_free_courts(app, key, (callErr) => {
						if (callErr) {
							console.warn('[bts] failed to resume on-court automation', callErr && (callErr.stack || callErr.message || String(callErr)));
						}
					});
				});
			}

			if (!tournament.displaysettings_general || (tournament.displaysettings_general != t.displaysettings_general)){
				const bupws = require('./bupws');
				bupws.change_default_display_mode(app, t, tournament.displaysettings_general, t.displaysettings_general);
			}
			if (!tournament.displaysettings_general_tablet || (tournament.displaysettings_general_tablet != t.displaysettings_general_tablet)){
				const bupws = require('./bupws');
				bupws.change_default_display_mode(app, t, tournament.displaysettings_general_tablet, t.displaysettings_general_tablet);
			}
			if (Object.prototype.hasOwnProperty.call(props, 'bupws_v2_enabled')) {
				const bupws = require('./bupws');
				bupws.refresh_protocol_mode(app, key).catch((refreshErr) => {
					console.warn('[bts] failed to refresh BUP protocol mode', refreshErr && (refreshErr.stack || refreshErr.message || String(refreshErr)));
				});
			}

			ws.respond(msg, err);
		});
	});
}

function handle_tournament_edit_prop(app, ws, msg) {
	if (! msg.key) {
		return ws.respond(msg, {message: 'Missing key'});
	}
	if (typeof msg.field === 'undefined') {
		return ws.respond(msg, {message: 'Missing field'});
	}

	const allowed_fields = new Set([
		'name', 'tguid',
		'automation_enabled',
		'btp_enabled', 'btp_autofetch_enabled', 'btp_readonly',
		'btp_ip', 'btp_password', 'btp_autofetch_timeout_intervall', 'btp_timezone',
		'is_team', 'is_nation_competition',
		'warmup', 'warmup_ready', 'warmup_start',
		'upcoming_matches_animation_speed', 'upcoming_matches_max_count', 'upcoming_matches_animation_pause',
		'upcoming_matches_today_only_enabled',
		'self_check_in_called_overlay_duration_ms',
		'ticker_enabled', 'ticker_url', 'ticker_password',
		'language', 'dm_style', 'displaysettings_general', 'displaysettings_general_tablet',
		'bupws_v2_enabled', 'bup_v2_admin_wait_for_score_updates', 'bts_debug_output_enabled', 'bts_auto_call_trace_enabled',
		'tabletoperator_enabled', 'tabletoperator_break_seconds',
		'announcement_speed', 'announcement_pause_time_ms',
		'tabletoperator_set_break_after_tabletservice', 'tabletoperator_with_state_enabled',
		'tabletoperator_with_state_from_match_enabled',
		'tabletoperator_winner_of_quaterfinals_enabled', 'tabletoperator_split_doubles',
		'tabletoperator_assignment_scope',
		'tabletoperator_use_manual_counting_boards_enabled', 'tabletoperator_with_umpire_enabled',
		'annoncement_include_event', 'annoncement_include_round', 'annoncement_include_matchnumber',
		'no_match_cascade_announcements_enabled',
		'preparation_meetingpoint_enabled', 'preparation_tabletoperator_setup_enabled',
		'call_preparation_matches_automatically_enabled', 'call_next_possible_scheduled_match_in_preparation',
		'preparation_successor_rally_count',
		'preparation_call_time_limit_before_scheduled_enabled',
		'preparation_call_time_limit_before_scheduled_minutes',
		'preparation_call_block_ahead_limit_enabled',
		'preparation_call_block_ahead_limit',
		'preparation_call_time_ahead_of_frontier_enabled',
		'preparation_call_time_ahead_of_frontier_minutes',
		'preparation_call_matches_ahead_of_frontier_enabled',
		'preparation_call_matches_ahead_of_frontier_limit',
		'preparation_call_player_pause_expired_enabled',
		'preparation_call_debug_output_enabled',
		'preparation_call_debug_icons_enabled',
		'preparation_call_technical_officials_available_enabled',
		'preparation_call_no_player_waiting_as_tabletoperator_enabled',
		'preparation_call_no_player_active_as_tabletoperator_enabled',
		'call_on_court_time_limit_before_scheduled_enabled',
		'call_on_court_time_limit_before_scheduled_minutes',
		'call_on_court_only_preparation_enabled',
		'call_on_court_only_preparation_minutes',
		'call_on_court_block_ahead_limit_enabled',
		'call_on_court_block_ahead_limit',
		'call_on_court_time_ahead_of_frontier_enabled',
		'call_on_court_time_ahead_of_frontier_minutes',
		'call_on_court_matches_ahead_of_frontier_enabled',
		'call_on_court_matches_ahead_of_frontier_limit',
		'call_on_court_participant_readiness_mode',
		'call_on_court_player_pause_expired_enabled',
		'call_on_court_technical_officials_mode',
		'call_on_court_require_official_space_enabled',
		'official_rotation_mode',
		'technical_official_auto_assignment_mode',
		'technical_official_break_after_assignment_seconds',
		'logo_background_color', 'logo_foreground_color',
		'certificate_title_line_1', 'certificate_title_line_2',
		'certificate_export_location',
		'certificate_export_max_place', 'certificate_export_date',
		'certificate_export_last_scheduled_date_filter',
		'certificate_export_double_swapped_entries_enabled',
		'certificate_age_class_splits',
		'certificate_discipline_replacements',
	]);

	const field = msg.field;
	if (!allowed_fields.has(field)) {
		return ws.respond(msg, {message: 'Unsupported field ' + field});
	}

	const key = msg.key;
	let value = msg.value;
	if (field === 'btp_timezone') {
		value = value === 'system' ? undefined : value;
	}
	const props = {};
	props[field] = value;

	app.db.tournaments.findOne({ key }, async (err, tournament) => {
		if (err || !tournament) {
			ws.respond(msg, err);
			return;
		}
		const validation_error = await _validate_default_displaysetting_field(app, field, value);
		if (validation_error) {
			return ws.respond(msg, validation_error);
		}
		app.db.tournaments.update({ key }, { $set: props }, { returnUpdatedDocs: true }, function (err, num, t) {
			if (err) {
				ws.respond(msg, err);
				return;
			}
			if (/^btp_/.test(field)) {
				btp_manager.reconfigure(app, t);
			}
			if (/^ticker_/.test(field)) {
				ticker_manager.reconfigure(app, t);
			}
			debug_flags.set_from_tournament(t);
			if (field === 'automation_enabled' && t[field] === true) {
				const match_utils = require('./match_utils');
				match_utils.queue_auto_assign_technical_officials_when_available(app, key);
				match_utils.queue_auto_execute_preparation_selections(app, key, (selectionErr) => {
					if (selectionErr) {
						console.warn('[bts] failed to resume preparation automation', selectionErr && (selectionErr.stack || selectionErr.message || String(selectionErr)));
						return;
					}
					match_utils.auto_call_matches_on_free_courts(app, key, (callErr) => {
						if (callErr) {
							console.warn('[bts] failed to resume on-court automation', callErr && (callErr.stack || callErr.message || String(callErr)));
						}
					});
				});
			}
			notify_change(app, key, 'prop_changed', { field, value: t[field] });

			if (!tournament.displaysettings_general || (field === 'displaysettings_general' && tournament.displaysettings_general != t.displaysettings_general)){
				const bupws = require('./bupws');
				bupws.change_default_display_mode(app, t, tournament.displaysettings_general, t.displaysettings_general);
			}
			if (!tournament.displaysettings_general_tablet || (field === 'displaysettings_general_tablet' && tournament.displaysettings_general_tablet != t.displaysettings_general_tablet)){
				const bupws = require('./bupws');
				bupws.change_default_display_mode(app, t, tournament.displaysettings_general_tablet, t.displaysettings_general_tablet);
			}
			if (field === 'bupws_v2_enabled') {
				const bupws = require('./bupws');
				bupws.refresh_protocol_mode(app, key).catch((refreshErr) => {
					console.warn('[bts] failed to refresh BUP protocol mode', refreshErr && (refreshErr.stack || refreshErr.message || String(refreshErr)));
				});
			}

			ws.respond(msg, err);
		});
	});
}

function handle_tournament_edit_scoring_format(app, ws, msg) {
	if (! msg.key) {
		return ws.respond(msg, {message: 'Missing key'});
	}
	if (! msg.scoring_format) {
		return ws.respond(msg, {message: 'Missing scoring_format'});
	}

	const key = msg.key;
	const scoring_format = msg.scoring_format;
	app.db.tournaments.findOne({ key }, async (err, tournament) => {
		if (err || !tournament) {
			ws.respond(msg, err);
			return;
		}

		const btp_sync = require('./btp_sync');
		const scoring_formats = tournament.scoring_formats || { formats: [], default_id: null };
		const formats = Array.isArray(scoring_formats.formats) ? scoring_formats.formats.slice() : [];
		const index = formats.findIndex(f => Number(f.id) === Number(scoring_format.id));
		if (index === -1) {
			return ws.respond(msg, {message: 'Unknown scoring format ' + scoring_format.id});
		}

		formats[index] = btp_sync._sanitize_scoring_format(scoring_format);
		const updated_scoring_formats = {
			...scoring_formats,
			formats,
		};

		app.db.tournaments.update(
			{ key },
			{ $set: { scoring_formats: updated_scoring_formats } },
			{ returnUpdatedDocs: true },
			function (err) {
				if (err) {
					ws.respond(msg, err);
					return;
				}
				notify_change(app, key, 'scoring_format_changed', {
					scoring_format: formats[index],
				});
				notify_change(app, key, 'props', {
					scoring_formats: updated_scoring_formats,
				});
				ws.respond(msg, err);
			}
		);
	});
}


function handle_tournament_edit_logo(app, ws, msg) {
	if (! msg.key) {
		return ws.respond(msg, {message: 'Missing key'});
	}
	if (! msg.props) {
		return ws.respond(msg, {message: 'Missing props'});
	}

	const key = msg.key;
	const props = utils.pluck(msg.props, [
		'logo_background_color', 'logo_foreground_color']);

	app.db.tournaments.findOne({ key }, async (err, tournament) => {
		if (err || !tournament) {
			ws.respond(msg, err);
			return;
		}
		app.db.tournaments.update({ key }, { $set: props }, { returnUpdatedDocs: true }, function (err) {
			if (err) {
				ws.respond(msg, err);
				return;
			}

			notify_change(app, key, 'logo_changed', {logo_foreground_color : props.logo_foreground_color, logo_background_color: props.logo_background_color});
			require('./bupws_v2').refresh_tournament(app, key).catch((refresh_err) => {
				console.error('[bup v2] logo color refresh failed', refresh_err);
			});

			ws.respond(msg, err);
		});
	});
}

function handle_certificate_export_mark(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}
	const event_names = Array.isArray(msg.event_names) ? msg.event_names : [];
	const normalized_event_names = event_names
		.map((event_name) => String(event_name || '').trim())
		.filter(Boolean);

	app.db.tournaments.findOne({ key: msg.tournament_key }, function(err, tournament) {
		if (err || !tournament) {
			return ws.respond(msg, err || { message: 'Tournament not found' });
		}

		const certificate_exports = {
			...(tournament.certificate_exports || {}),
		};
		const exported_at = now_iso(app);
		normalized_event_names.forEach((event_name) => {
			certificate_exports[event_name] = exported_at;
		});

		app.db.tournaments.update(
			{ key: msg.tournament_key },
			{ $set: { certificate_exports } },
			{ returnUpdatedDocs: true },
			function(updateErr) {
				if (updateErr) {
					return ws.respond(msg, updateErr);
				}
				notify_change(app, msg.tournament_key, 'prop_changed', {
					field: 'certificate_exports',
					value: certificate_exports,
				});
				ws.respond(msg, null, { certificate_exports });
			}
		);
	});
}

function handle_certificate_export_reset(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}
	const event_name = typeof msg.event_name === 'string' ? msg.event_name.trim() : '';
	const reset_all = !!msg.all;

	app.db.tournaments.findOne({ key: msg.tournament_key }, function(err, tournament) {
		if (err || !tournament) {
			return ws.respond(msg, err || { message: 'Tournament not found' });
		}

		let certificate_exports = {
			...(tournament.certificate_exports || {}),
		};
		if (reset_all) {
			certificate_exports = {};
		} else if (event_name) {
			delete certificate_exports[event_name];
		}

		app.db.tournaments.update(
			{ key: msg.tournament_key },
			{ $set: { certificate_exports } },
			{ returnUpdatedDocs: true },
			function(updateErr) {
				if (updateErr) {
					return ws.respond(msg, updateErr);
				}
				notify_change(app, msg.tournament_key, 'prop_changed', {
					field: 'certificate_exports',
					value: certificate_exports,
				});
				ws.respond(msg, null, { certificate_exports });
			}
		);
	});
}

function handle_courts_add(app, ws, msg) {
	if (! msg.tournament_key) {
		return ws.respond(msg, {message: 'Missing tournament_key'});
	}
	const tournament_key = msg.tournament_key;
	if (! msg.nums) {
		return ws.respond(msg, {message: 'Missing nums'});
	}

	const added_courts = msg.nums.map(num => {
		return {
			_id: tournament_key + '_' + num,
			tournament_key,
			num,
			is_active: true,
			has_umpire: true,
			has_service_judge: true,
		};
	});
	app.db.courts.insert(added_courts, function(err) {
		if (err) {
			ws.respond(msg, err);
			return;
		}

		stournament.get_courts(app.db, tournament_key, function(err, all_courts) {
			notify_change(app, tournament_key, 'courts_changed', {all_courts});
			ws.respond(msg, err, {});
		});
	});
}

function handle_court_edit(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'court_id'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const court_id = msg.court_id;

	const query = {
		tournament_key,
		_id: court_id,
	};

	app.db.courts.findOne(query, async (err, court) => {
		if (err || !court) {
			ws.respond(msg, err);
			return;
		}
		const is_active = (msg.is_active != undefined ? msg.is_active : court.is_active);
		const has_umpire = (msg.has_umpire != undefined ? msg.has_umpire : (court.has_umpire != undefined ? court.has_umpire : true));
		const has_service_judge = (msg.has_service_judge != undefined ? msg.has_service_judge : (court.has_service_judge != undefined ? court.has_service_judge : true));
		app.db.courts.update(query, { $set: {is_active, has_umpire, has_service_judge} }, {}, (err) => {
			if(err) {
				ws.respond(msg, err);
				return;
			}
			notify_change(app, msg.tournament_key, 'court_changed', {court_id, is_active, has_umpire, has_service_judge, match_id: court.match_id ?? null});
			ws.respond(msg);
			return;
		});
	});
}

function handle_location_changed(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'location_id', 'highlight', 'preparation_addition', 'meetingpoint_announcement'])) {
		return;
	}
	const location_id = msg.location_id;
	const preparation_addition = msg.preparation_addition;
	const meetingpoint_announcement = msg.meetingpoint_announcement;
	const highlight = msg.highlight;

	const query = {
		tournament_key: msg.tournament_key,
		_id: msg.location_id,
	};

	app.db.locations.findOne(query, async (err, old_location) => {
		if(err) {
			ws.respond(msg, err);
			return;
		}

		app.db.locations.update(query, { $set: {highlight, preparation_addition, meetingpoint_announcement} }, {}, (err) => {
			if(err) {
				ws.respond(msg, err);
				return;
			}

			notify_change(app, msg.tournament_key, 'location_changed', {location_id, highlight, preparation_addition, meetingpoint_announcement});
			notify_change(app, msg.tournament_key, 'location_highlight_changed', {old_location_highlight: old_location.highlight, new_location_highlight: highlight});
			

			const match_querry = {
				tournament_key: msg.tournament_key,
				'setup.highlight': old_location.highlight,
			};
			app.db.matches.update(
				match_querry,
				{ $set: { 'setup.highlight': highlight } },
				{ multi: true, returnUpdatedDocs: true },
				(err, numAffected, affectedDocs) => {
					if (err) {
						ws.respond(msg, err);
						return;
					}
			
					const btp_manager = require('./btp_manager');
			
					// Wenn mehrere Matches aktualisiert wurden:
					if (Array.isArray(affectedDocs)) {
						for (const match of affectedDocs) {
							btp_manager.update_highlight(app, match);
						}
					} else if (affectedDocs) {
						// Falls nur ein Match betroffen war
						btp_manager.update_highlight(app, affectedDocs);
					}
			
					ws.respond(msg);
					return;
				}
			);
		});
	});
}

function generate_tournament_web_url(tournament) {
	var url = "";
	if (tournament.ticker_enabled) {
		url = "https://" + tournament.ticker_url.split("/")[2];
	} else {
		url = "https://" + ((tournament.btp_settings && tournament.btp_settings.tournament_urn) ? tournament.btp_settings.tournament_urn : "www.turnier.de") + "/tournament" + (tournament.tguid ? "/" + tournament.tguid + "/matches" : "s/");
	}
	return url;
}

function _clock_state_response(app) {
	return app.clock ? app.clock.get_state() : null;
}

async function handle_clock_get(app, ws, msg) {
	return ws.respond(msg, null, { clock: _clock_state_response(app) });
}

async function handle_clock_set(app, ws, msg) {
	if (!app.clock) {
		return ws.respond(msg, { message: 'Clock not initialized' });
	}

	let clock_state = null;
	if (msg.mode === 'real') {
		clock_state = await app.clock.set_real();
	} else if (msg.mode === 'fixed') {
		const fixed_ts = Number(msg.fixed_ts);
		if (!Number.isFinite(fixed_ts)) {
			return ws.respond(msg, { message: 'Invalid fixed_ts' });
		}
		clock_state = await app.clock.set_fixed(fixed_ts);
	} else if (msg.mode === 'offset') {
		if (typeof msg.offset_target_ts !== 'undefined' && msg.offset_target_ts !== null && msg.offset_target_ts !== '') {
			const offset_target_ts = Number(msg.offset_target_ts);
			if (!Number.isFinite(offset_target_ts)) {
				return ws.respond(msg, { message: 'Invalid offset_target_ts' });
			}
			clock_state = await app.clock.set_offset_target(offset_target_ts);
		} else {
		const offset_ms = Number(msg.offset_ms);
		if (!Number.isFinite(offset_ms)) {
			return ws.respond(msg, { message: 'Invalid offset_ms' });
		}
		clock_state = await app.clock.set_offset(offset_ms);
		}
	} else {
		return ws.respond(msg, { message: 'Unsupported clock mode ' + msg.mode });
	}

	notify_change(app, msg.tournament_key || null, 'clock_changed', { clock: clock_state });
	return ws.respond(msg, null, { clock: clock_state });
}

function handle_tournament_get(app, ws, msg) {
	if (! msg.key) {
		return ws.respond(msg, {message: 'Missing key'});
	}

	app.db.tournaments.findOne({ key: msg.key }, function (err, tournament) {
		if (!err && !tournament) {
			err = { message: 'No tournament ' + msg.key };
		}
		if (err) {
			ws.respond(msg, err);
			return;
		}
		tournament.certificate_exports = tournament.certificate_exports || {};
		displaysettings_defaults.ensure_default_displaysettings(app, tournament)
			.then(({ tournament: ensured_tournament, displaysettings }) => {
				tournament = ensured_tournament;
				tournament.displaysettings = displaysettings;
				async.parallel([
					function (cb) {
						try {
							const qrcode = require('qrcode');

							const url = generate_tournament_web_url(tournament);
							qrcode.toDataURL(url, function (error, data) {
								const qrCodeDataUrl = data;
								tournament.mainQrCode = qrCodeDataUrl;
								cb(error);
							});
						} catch (error) {
							cb(error);
						}
					},
					function(cb) {
						stournament.get_locations(app.db, tournament.key, function(err, locations) {
							tournament.locations = locations;
							cb(err);
						});
					}, function(cb) {
						stournament.get_courts(app.db, tournament.key, function(err, courts) {
							tournament.courts = courts;
							cb(err);
						});
					}, function(cb) {
						stournament.get_umpires(app.db, tournament.key, function(err, umpires) {
							tournament.umpires = umpires;
							cb(err);
						});
					}, function (cb) {
						stournament.get_tabletoperators(app.db, tournament.key, function (err, tabletoperators) {
							tournament.tabletoperators = tabletoperators;
							cb(err);
						});
					}, function(cb) {
						stournament.get_matches(app.db, tournament.key, function(err, matches) {
							tournament.matches = matches;
							cb(err);
						});
					}, function (cb) {
						stournament.get_displays(app, tournament, function (err, displays) {
							tournament.displays = displays;
							cb(err);
						});
					}, function (cb) {
						stournament.get_normalizations(app.db, tournament.key, function (err, normalizations) {
							tournament.normalizations = normalizations;
							cb(err);
						});
					}, function (cb) {
						stournament.get_advertisements(app.db, tournament.key, function (err, advertisements) {
							tournament.advertisements = advertisements;
							cb(err);
						});
					}
				], function(err) {
					if (tournament.scoring_formats && Array.isArray(tournament.scoring_formats.formats)) {
						const btp_sync = require('./btp_sync');
						tournament.scoring_formats = {
							...tournament.scoring_formats,
							formats: tournament.scoring_formats.formats.map(f => btp_sync._sanitize_scoring_format(f)),
						};
					}
					tournament.btp_status = btp_manager.get_status(tournament.key);
					tournament.ticker_status = ticker_manager.get_status(tournament.key);
					tournament.test_clock = _clock_state_response(app);
					_annotate_tournament(tournament);
					ws.respond(msg, err, {tournament});
				});
			})
			.catch((ensureErr) => ws.respond(msg, ensureErr));
	});
}

async function async_handle_preparation_selection_get(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	const selections = await match_automation.fetch_all_location_preparation_selections(app, msg.tournament_key, {
		now_ts: now_ms(app),
	});
	return ws.respond(msg, null, {
		selections: selections.map((selection) => ({
			location_id: selection.location_id,
			required_preparation_count: selection.required_preparation_count,
			current_preparation_count: selection.current_preparation_count,
			missing_preparation_count: selection.missing_preparation_count,
			effective_required_preparation_count: selection.effective_required_preparation_count,
			effective_missing_preparation_count: selection.effective_missing_preparation_count,
			candidate_match_ids: selection.candidates.map((match) => match?._id).filter((id) => id != null),
			candidate_match_nums: selection.candidates.map((match) => match?.setup?.match_num).filter((num) => num != null),
			selected_match_ids: selection.selected_matches.map((match) => match?._id).filter((id) => id != null),
			selected_match_nums: selection.selected_matches.map((match) => match?.setup?.match_num).filter((num) => num != null),
			auto_selected_match_ids: selection.auto_selected_matches.map((match) => match?._id).filter((id) => id != null),
			auto_selected_match_nums: selection.auto_selected_matches.map((match) => match?.setup?.match_num).filter((num) => num != null),
			display_candidate_match_ids: selection.display_candidates.map((match) => match?._id).filter((id) => id != null),
			display_candidate_match_nums: selection.display_candidates.map((match) => match?.setup?.match_num).filter((num) => num != null),
			display_frontier_match_id: selection.display_frontier?._id || null,
			display_frontier_match_num: selection.display_frontier?.setup?.match_num ?? null,
			display_cutoff_match_id: selection.display_cutoff?._id || null,
			display_cutoff_match_num: selection.display_cutoff?.setup?.match_num ?? null,
			diagnostics_by_match_id: selection.diagnostics_by_match_id || {},
			call_on_court_diagnostics_by_match_id: selection.call_on_court_diagnostics_by_match_id || {},
			successor_court_ids: Array.isArray(selection.successor_court_ids) ? selection.successor_court_ids : [],
			successor_match_ids: Array.isArray(selection.successor_match_ids) ? selection.successor_match_ids : [],
			free_court_ids: Array.isArray(selection.free_court_ids) ? selection.free_court_ids : [],
			demand_court_ids: Array.isArray(selection.demand_court_ids) ? selection.demand_court_ids : [],
		})),
	});
}

async function async_handle_preparation_selection_execute(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'location_id'])) {
		return;
	}

	const match_utils = require('./match_utils');
	try {
		const called_matches = await update_queue.instance().execute(update_queue.named('preparation_selection_execute', async () => {
			const tournament = await app.db.tournaments.findOne_async({ key: msg.tournament_key });
			if (!tournament) {
				throw new Error('Cannot find tournament ' + msg.tournament_key);
			}

			const selection = await match_automation.fetch_location_preparation_selection(app, msg.tournament_key, msg.location_id, {
				now_ts: now_ms(app),
			});
			const called_matches = [];

			for (const match of selection.selected_matches) {
				await new Promise((resolve, reject) => {
					match_utils.call_match_in_preparation(app, tournament, match, msg.location_id, (err) => {
						if (err) return reject(err);
						called_matches.push({
							_id: match._id,
							match_num: match?.setup?.match_num,
						});
						resolve(null);
					});
				});
			}

			return called_matches;
		}));

		return ws.respond(msg, null, {
			location_id: msg.location_id,
			called_matches,
		});
	} catch (err) {
		return ws.respond(msg, err);
	}
}

function handle_create_tournament(app, ws, msg) {
	if (! msg.key) {
		return ws.respond(msg, {message: 'Missing key'});
	}

	const t = {
		key: msg.key,
	};

	app.db.tournaments.insert(t, function(err) {
		ws.respond(msg, err);
	});
}

async function reset_tournament_to_empty_default(app, tournament_key) {
	const tournament = await app.db.tournaments.findOne_async({ key: tournament_key });
	if (!tournament) {
		throw new Error('No tournament ' + tournament_key);
	}

	const reset_ts = now_ms(app);
	const tournament_patch = {
		name: 'Default',
		events: { events: [] },
		certificate_exports: {},
		last_reset_ts: reset_ts,
	};

	await app.db.matches.remove_async({ tournament_key }, { multi: true });
	await app.db.tabletoperators.remove_async({ tournament_key }, { multi: true });
	await app.db.logs.remove_async({ tournament_key }, { multi: true });
	await app.db.courts.remove_async({ tournament_key }, { multi: true });
	await app.db.locations.remove_async({ tournament_key }, { multi: true });
	await app.db.umpires.remove_async({ tournament_key }, { multi: true });

	const [, updated_tournament] = await app.db.tournaments.update_async(
		{ key: tournament_key },
		{ $set: tournament_patch, $unset: { tguid: true } },
		{ returnUpdatedDocs: true },
	);

	await displaysettings_defaults.ensure_default_displaysettings(app, updated_tournament || { ...tournament, ...tournament_patch });
	return {
		tournament_key,
		tournament: updated_tournament || { ...tournament, ...tournament_patch },
		reset_ts,
	};
}

async function handle_tournament_reset(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	try {
		const result = await reset_tournament_to_empty_default(app, msg.tournament_key);
		notify_change(app, msg.tournament_key, 'tournament_reset', {
			tournament: result.tournament,
			reset_ts: result.reset_ts,
		});
		const bupws = require('./bupws');
		bupws.refresh_protocol_mode(app, msg.tournament_key).catch((refreshErr) => {
			console.warn('[bts] failed to refresh BUP clients after tournament reset', refreshErr && (refreshErr.stack || refreshErr.message || String(refreshErr)));
		});
		return ws.respond(msg, null, result);
	} catch (err) {
		return ws.respond(msg, err);
	}
}

const PLAYER_PAUSE_RESET_TS = Date.UTC(2000, 0, 1, 0, 0, 0, 0);

function collect_players_for_pause_reset(matches) {
	const players_by_btp_id = new Map();
	for (const match of matches || []) {
		for (const team of match?.setup?.teams || []) {
			for (const player of team?.players || []) {
				if (!player || !player.btp_id) {
					continue;
				}
				const reset_player = players_by_btp_id.get(player.btp_id) || {
					btp_id: player.btp_id,
					last_time_on_court_ts: PLAYER_PAUSE_RESET_TS,
				};
				if (player.checked_in !== undefined) {
					reset_player.checked_in = player.checked_in;
				}
				players_by_btp_id.set(player.btp_id, reset_player);
			}
		}
	}
	return Array.from(players_by_btp_id.values());
}

function clear_player_pause_fields_in_match(match) {
	let changed = false;
	for (const team of match?.setup?.teams || []) {
		for (const player of team?.players || []) {
			if (!player) {
				continue;
			}
			for (const field of [
				'last_time_on_court_ts',
				'tablet_last_time_on_court_ts',
				'tablet_break_until_ts',
			]) {
				if (player[field] !== undefined) {
					delete player[field];
					changed = true;
				}
			}
			if (player.tablet_break_active !== undefined && player.tablet_break_active !== false) {
				player.tablet_break_active = false;
				changed = true;
			}
		}
	}
	return changed;
}

async function reset_player_pause_times(app, tournament_key) {
	const tournament = await app.db.tournaments.findOne_async({ key: tournament_key });
	if (!tournament) {
		throw new Error('No tournament ' + tournament_key);
	}
	if (!tournament.btp_enabled) {
		throw new Error('BTP-Anbindung ist nicht aktiviert. Pausenzeiten können nicht sicher in BTP zurückgesetzt werden.');
	}
	if (tournament.btp_readonly) {
		throw new Error('BTP ist im Nur-Lesen-Modus. Pausenzeiten können nicht in BTP zurückgesetzt werden.');
	}

	const matches = await app.db.matches.find_async({ tournament_key });
	const players_to_update = collect_players_for_pause_reset(matches);
	if (players_to_update.length > 0) {
		const btp_update_queued = btp_manager.update_players(app, tournament_key, players_to_update);
		if (!btp_update_queued) {
			throw new Error('BTP-Verbindung ist nicht bereit. Bitte BTP verbinden und erneut versuchen.');
		}
	}

	let changed_matches = 0;
	for (const match of matches) {
		if (!clear_player_pause_fields_in_match(match)) {
			continue;
		}
		changed_matches++;
		await app.db.matches.update_async(
			{ _id: match._id, tournament_key },
			{ $set: { setup: match.setup } },
			{},
		);
	}

	return {
		tournament_key,
		reset_ts: now_ms(app),
		player_count: players_to_update.length,
		changed_matches,
	};
}

async function handle_player_pause_reset(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	try {
		const result = await reset_player_pause_times(app, msg.tournament_key);
		notify_change(app, msg.tournament_key, 'player_pause_reset', result);
		return ws.respond(msg, null, result);
	} catch (err) {
		return ws.respond(msg, err);
	}
}

function _extract_setup(msg_setup) {
	const setup = utils.pluck(msg_setup, [
		'court_id',
		'event_name',
		'match_name',
		'match_num',
		'now_on_court',
		'umpire',
		'service_judge_name',
		'service_judge',
		'highlight',
		'is_doubles',
		'is_match',
		'incomplete',
		'links',
		'scheduled_time_str',
		'scheduled_date',
		'scoring_format',
		'called_timestamp',
		'preparation_call_timestamp',
		'location_id',
		'teams',
		'team_competition',
		'tabletoperators',
		'override_colors',
		'warmup',
		'warmup_ready',
		'warmup_start',
	]);
	if (!setup.match_name && setup.match_num) {
		setup.match_name = '# ' + setup.match_num;
	}

	return setup;
}

function handle_match_add(app, ws, msg) {
	if (! msg.tournament_key) {
		return ws.respond(msg, {message: 'Missing tournament_key'});
	}
	if (! msg.setup) {
		return ws.respond(msg, {message: 'Missing setup'});
	}
	const tournament_key = msg.tournament_key;

	const match = {
		tournament_key,
		setup: _extract_setup(msg.setup),
		presses: [],
	};
	app.db.matches.insert(match, function(err, inserted_m) {
		if (err) {
			ws.respond(msg, err);
			return;
		}
		notify_change(app, tournament_key, 'match_add', {match: inserted_m});
		ws.respond(msg, err);
	});
}

function handle_normalization_add(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}

	if (!msg.normalization) {
		return ws.respond(msg, { message: 'Missing required normalization' });
	}

	app.db.normalizations.insert(msg.normalization, function (err, inserted_normalization) {
		if (err) {
			ws.respond(msg, err);
			return;
		}
		notify_change(app, msg.tournament_key, 'normalization_add', { normalization: inserted_normalization });
	});
}
function handle_normalization_remove(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}

	if (!msg.normalization_id) {
		return ws.respond(msg, { message: 'Missing required normalization' });
	}

	const query = { _id: msg.normalization_id };
	app.db.normalizations.remove(query, {}, (err) => {
		notify_change(app, msg.tournament_key, 'normalization_removed', {normalization_id: msg.normalization_id});
		return;
	});
}
function handle_advertisement_add(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}

	if (!msg.advertisement) {
		return ws.respond(msg, { message: 'Missing required advertisement' });
	}

	app.db.advertisements.insert(msg.advertisement, function (err, inserted_advertisement) {
		if (err) {
			ws.respond(msg, err);
			return;
		}
		notify_change(app, msg.tournament_key, 'advertisement_add', { advertisement: inserted_advertisement });
		const bupws = require('./bupws');
		bupws.send_advertisement_add(app, msg.tournament_key,inserted_advertisement);
		return;
	});
}

function handle_advertisement_remove(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}

	if (!msg.advertisement_id) {
		return ws.respond(msg, { message: 'Missing required advertisement' });
	}

	const query = { _id: msg.advertisement_id };
	app.db.advertisements.remove(query, {}, (err) => {
		notify_change(app, msg.tournament_key, 'advertisement_removed', { advertisement_id: msg.advertisement_id });
		const bupws = require('./bupws');
		bupws.send_advertisement_remove(app, msg.tournament_key,msg.advertisement_id);
		return;
	});
}

function handle_tabletoperator_move_up(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}
	if (!msg.tabletoperator) {
		return ws.respond(msg, { message: 'Missing tabletoperator' });
	}
	const tournament_key = msg.tournament_key;
	const tabletoperator = msg.tabletoperator

	const tabletoperator_querry = { 'tournament_key': msg.tournament_key, court: null };

	
	app.db.tabletoperators.find(tabletoperator_querry).sort({ 'start_ts': 1 }).exec((err, tabletoperators) => {
		if (err) {
			ws.respond(msg, err);
			return;
		}
		
		let start_ts_1 = 0;
		let start_ts_2 = 0;
		let index = 0;

		while (index <  tabletoperators.length && tabletoperators[index]._id != tabletoperator._id) {
			start_ts_2 = start_ts_1;
			start_ts_1 = tabletoperators[index].start_ts;
			index++;
		}
		app.db.tabletoperators.update({ _id: tabletoperator._id, tournament_key: tournament_key }, { $set: { start_ts: (start_ts_1 + start_ts_2)/2 } }, { returnUpdatedDocs: true}, function (err, numAffected, changed_tabletoperator) {
			if (err) {
				ws.respond(msg, err);
				return;
			}
			notify_change(app, tournament_key, 'tabletoperator_moved_up', { tabletoperator: changed_tabletoperator });
		});
	});
}

function handle_tabletoperator_move_down(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}
	if (!msg.tabletoperator) {
		return ws.respond(msg, { message: 'Missing tabletoperator' });
	}
	const tournament_key = msg.tournament_key;
	const tabletoperator = msg.tabletoperator

	const tabletoperator_querry = { 'tournament_key': msg.tournament_key, court: null };

	
	app.db.tabletoperators.find(tabletoperator_querry).sort({ 'start_ts': -1 }).exec((err, tabletoperators) => {
		if (err) {
			ws.respond(msg, err);
			return;
		}
		
		let start_ts_1 = now_ms(app);
		let start_ts_2 = now_ms(app);
		let index = 0;

		while (index <  tabletoperators.length && tabletoperators[index]._id != tabletoperator._id) {
			start_ts_2 = start_ts_1;
			start_ts_1 = tabletoperators[index].start_ts;
			index++;
		}
		app.db.tabletoperators.update({ _id: tabletoperator._id, tournament_key: tournament_key }, { $set: { start_ts: (start_ts_1 + start_ts_2)/2 } }, { returnUpdatedDocs: true}, function (err, numAffected, changed_tabletoperator) {
			if (err) {
				ws.respond(msg, err);
				return;
			}
			notify_change(app, tournament_key, 'tabletoperator_moved_up', { tabletoperator: changed_tabletoperator });
		});
	});
}
function handle_tabletoperator_remove(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}
	if (!msg.tabletoperator) {
		return ws.respond(msg, { message: 'Missing tabletoperator' });
	}
	const tournament_key = msg.tournament_key;
	const tabletoperator = msg.tabletoperator
	app.db.tabletoperators.update({ _id: tabletoperator._id, tournament_key: tournament_key }, { $set: { court: -1 } }, { returnUpdatedDocs: true}, function (err, numAffected, changed_tabletoperator) {
		if (err) {
			ws.respond(msg, err);
			return;
		}
		notify_change(app, tournament_key, 'tabletoperator_removed', { tabletoperator: changed_tabletoperator });
	});
}

function handle_tabletoperator_add(app, ws, msg) {
	if (!msg.tournament_key) {
		return ws.respond(msg, { message: 'Missing tournament_key' });
	}
	const tournament_key = msg.tournament_key;
	app.db.tournaments.findOne({ key: tournament_key }, async (err, tournament) => {
		if (err) {
			return ws.respond(err);
		}

		var team = null;
		if (msg.match) {
			const team_id = msg.team_id;
			const match = msg.match
			team = match.setup.teams[team_id];
		} else if (msg.tabletoperator_name) {
			let tabletoperator_participant = null;
			try {
				tabletoperator_participant = await new Promise((resolve, reject) => {
					_find_tabletoperator_replacement_participant(app, tournament_key, msg.tabletoperator_name, msg.tabletoperator_btp_id, (find_err, participant) => {
						if (find_err) {
							return reject(find_err);
						}
						return resolve(participant);
					});
				});
			} catch (find_err) {
				return ws.respond(msg, find_err);
			}
			const participant_name = _tabletoperator_display_name(tabletoperator_participant) || msg.tabletoperator_name;
			const participant_btp_id = Number(tabletoperator_participant?.btp_id);
			team = {
				"players": [
					{
						"asian_name": !!tabletoperator_participant?.asian_name,
						"name": participant_name,
						"firstname": tabletoperator_participant?.firstname || "",
						"lastname": tabletoperator_participant?.lastname || "",
						"btp_id": Number.isFinite(participant_btp_id) ? participant_btp_id : -1,
						"state": tabletoperator_participant?.state || null
					}
				],
				"name": "N/N"
			};

		}
		if (team != null) {
			team.players.forEach((player) => {
				var tabletoperator = [];
				if (tournament.tabletoperator_with_state_enabled && player.state) {
					tabletoperator.push({
						"asian_name": false,
						"name": player.state,
						"firstname": "",
						"lastname": "",
						"btp_id": -1
					});
				} else { 
					tabletoperator.push(player);
				}
				const new_tabletoperator = {
					tournament_key,
					tabletoperator,
					'match_id': 'manually_added',
					'start_ts': now_ms(app),
					'end_ts': null,
					'court': null,
					'played_on_court': null
				};
				app.db.tabletoperators.insert(new_tabletoperator, function (err, inserted_tabletoperator) {
					if (err) {
						ws.respond(msg, err);
						return;
					}
					notify_change(app, tournament_key, 'tabletoperator_add', { tabletoperator: inserted_tabletoperator });
					trigger_auto_call_after_readiness_change(app, tournament_key);
				});
			});
		} else {
			return ws.respond(msg, { message: 'Not enough Information to add a tabletoperator to list' });
		}
	});
}

function _clone_match_tabletoperators(tabletoperators) {
	if (!Array.isArray(tabletoperators)) {
		return [];
	}
	return tabletoperators.map((participant) => ({ ...participant }));
}

function _normalize_tabletoperator_participants_for_assignment(tabletoperators, court_id) {
	return _clone_match_tabletoperators(tabletoperators).map((participant) => ({
		...participant,
		now_tablet_on_court: court_id || false,
		tablet_break_active: false,
	}));
}

function _normalize_tabletoperator_participants_for_waiting_list(tabletoperators) {
	return _clone_match_tabletoperators(tabletoperators).map((participant) => ({
		...participant,
		now_tablet_on_court: false,
		tablet_break_active: false,
	}));
}

function _tabletoperator_release_participant_index(value) {
	if (typeof value !== 'string' || !value.startsWith(TABLETOPERATOR_RELEASE_PARTICIPANT_PREFIX)) {
		return null;
	}
	const index = Number(value.slice(TABLETOPERATOR_RELEASE_PARTICIPANT_PREFIX.length));
	return Number.isInteger(index) && index >= 0 ? index : null;
}

function _tabletoperator_display_name(participant) {
	if (!participant) {
		return '';
	}
	return participant.name || [participant.firstname, participant.lastname].filter(Boolean).join(' ').trim();
}

function _normalize_tabletoperator_lookup_name(name) {
	return String(name || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLocaleLowerCase();
}

function _tabletoperator_participant_match_keys(tabletoperators) {
	const ids = new Set();
	const names = new Set();
	_clone_match_tabletoperators(tabletoperators).forEach((participant) => {
		const btp_id = Number(participant && participant.btp_id);
		if (Number.isFinite(btp_id) && btp_id !== -1) {
			ids.add(btp_id);
		}
		const name = _normalize_tabletoperator_lookup_name(_tabletoperator_display_name(participant));
		if (name) {
			names.add(name);
		}
	});
	return { ids, names };
}

function _tabletoperator_participant_matches(player, match_keys) {
	if (!player) {
		return false;
	}
	const player_btp_id = Number(player.btp_id);
	if (Number.isFinite(player_btp_id) && player_btp_id !== -1) {
		return match_keys.ids.has(player_btp_id);
	}
	const player_name = _normalize_tabletoperator_lookup_name(_tabletoperator_display_name(player));
	return !!player_name && match_keys.names.has(player_name);
}

function _parse_tabletoperator_replacement_name(value, btp_id_value) {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw) {
		return null;
	}
	const provided_btp_id = Number(btp_id_value);
	if (Number.isFinite(provided_btp_id) && provided_btp_id !== -1) {
		return {
			name: raw,
			btp_id: provided_btp_id,
		};
	}
	const btp_id_match = raw.match(/^(.*?)\s*\[#(-?\d+)\]\s*$/);
	if (!btp_id_match) {
		return {
			name: raw,
			btp_id: null,
		};
	}
	return {
		name: btp_id_match[1].trim(),
		btp_id: Number(btp_id_match[2]),
	};
}

function _find_tabletoperator_replacement_participant(app, tournament_key, value, btp_id_value, callback) {
	const parsed = _parse_tabletoperator_replacement_name(value, btp_id_value);
	if (!parsed) {
		return callback(null, null);
	}

	app.db.matches.find({ tournament_key }, (find_err, matches) => {
		if (find_err) {
			return callback(find_err);
		}

		const normalized_name = _normalize_tabletoperator_lookup_name(parsed.name);
		let fallback_by_name = null;
		for (const match of matches || []) {
			for (const team of (match?.setup?.teams || [])) {
				for (const player of (team?.players || [])) {
					if (!player) {
						continue;
					}
					const player_btp_id = Number(player.btp_id);
					if (parsed.btp_id !== null && Number.isFinite(parsed.btp_id) && player_btp_id === parsed.btp_id) {
						const participant = { ...player };
						participant.name = _tabletoperator_display_name(participant) || parsed.name;
						return callback(null, participant);
					}
					if (!fallback_by_name && _normalize_tabletoperator_lookup_name(_tabletoperator_display_name(player)) === normalized_name) {
						fallback_by_name = { ...player };
					}
				}
			}
		}

		if (fallback_by_name) {
			fallback_by_name.name = _tabletoperator_display_name(fallback_by_name) || parsed.name;
			return callback(null, fallback_by_name);
		}

		return callback(null, {
			name: parsed.name,
			btp_id: -1,
		});
	});
}

function _release_tabletoperator_player_flags(app, tournament_key, released_ids, callback) {
	if (!released_ids.length) {
		return callback(null);
	}
	const released_id_set = new Set(released_ids);
	const match_utils = require('./match_utils');

	app.db.tournaments.findOne({ key: tournament_key }, (tournament_err, tournament) => {
		if (tournament_err) {
			return callback(tournament_err);
		}
		const check_in_per_match = !!(tournament?.btp_settings?.check_in_per_match);

		app.db.matches.find({ tournament_key }, (find_err, matches) => {
			if (find_err) {
				return callback(find_err);
			}

			const players_to_update = [];
			async.each(matches || [], (match, cb) => {
				if (!match?.setup) {
					return cb(null);
				}

				let changed = false;
				(match.setup.teams || []).forEach((team) => {
					(team?.players || []).forEach((player) => {
						const player_btp_id = player && Number(player.btp_id);
						if (!player || !Number.isFinite(player_btp_id) || !released_id_set.has(player_btp_id)) {
							return;
						}
						const should_mark_globally_checked_in = !check_in_per_match && player.checked_in === false;
						if (player.now_tablet_on_court || player.tablet_break_active || should_mark_globally_checked_in) {
							player.now_tablet_on_court = false;
							player.tablet_break_active = false;
							if (should_mark_globally_checked_in) {
								player.checked_in = true;
								players_to_update.push(player);
							}
							changed = true;
						}
					});
				});

				if (!changed) {
					return cb(null);
				}
				app.db.matches.update({ _id: match._id, tournament_key }, { $set: { setup: match.setup } }, {}, (update_err) => {
					if (update_err) {
						return cb(update_err);
					}
					notify_change(app, tournament_key, 'update_player_status', {
						match__id: match._id,
						btp_winner: match.btp_winner,
						setup: match.setup,
					});
					notify_change(app, tournament_key, 'match_edit', {
						match__id: match._id,
						match,
					});
					return cb(null);
				});
			}, (each_err) => {
				if (each_err) {
					return callback(each_err);
				}
				if (players_to_update.length > 0) {
					btp_manager.update_players(app, tournament_key, players_to_update);
				}
				match_utils.queue_reconcile_player_court_flags(app, tournament_key);
				return callback(null);
			});
		});
	});
}

function _set_tabletoperator_player_flags(app, tournament_key, assigned_tabletoperators, court_id, callback) {
	const assigned_match_keys = _tabletoperator_participant_match_keys(assigned_tabletoperators);
	if (!assigned_match_keys.ids.size && !assigned_match_keys.names.size) {
		return callback(null);
	}

	app.db.matches.find({ tournament_key }, (find_err, matches) => {
		if (find_err) {
			return callback(find_err);
		}

		const players_to_update = [];
		async.each(matches || [], (match, cb) => {
			if (!match?.setup) {
				return cb(null);
			}

			let changed = false;
			(match.setup.teams || []).forEach((team) => {
				(team?.players || []).forEach((player) => {
					if (!_tabletoperator_participant_matches(player, assigned_match_keys)) {
						return;
					}
					if (player.now_tablet_on_court !== court_id || player.checked_in !== false || player.tablet_break_active !== false) {
						player.now_tablet_on_court = court_id;
						player.checked_in = false;
						player.tablet_break_active = false;
						players_to_update.push(player);
						changed = true;
					}
				});
			});

			if (!changed) {
				return cb(null);
			}
			app.db.matches.update({ _id: match._id, tournament_key }, { $set: { setup: match.setup } }, { returnUpdatedDocs: true }, (update_err, numAffected, changed_match) => {
				if (update_err) {
					return cb(update_err);
				}
				const update_match = changed_match || match;
				notify_change(app, tournament_key, 'update_player_status', {
					match__id: update_match._id,
					btp_winner: update_match.btp_winner,
					setup: update_match.setup,
				});
				notify_change(app, tournament_key, 'match_edit', {
					match__id: update_match._id,
					match: update_match,
				});
				return cb(null);
			});
		}, (each_err) => {
			if (each_err) {
				return callback(each_err);
			}
			if (players_to_update.length > 0) {
				btp_manager.update_players(app, tournament_key, players_to_update);
			}
			const match_utils = require('./match_utils');
			match_utils.queue_reconcile_player_court_flags(app, tournament_key);
			return callback(null);
		});
	});
}

function _replace_match_edit_tabletoperator(app, tournament_key, old_match, setup, tabletoperator_assignment_id, replacement_name, replacement_btp_id, callback) {
	const current_tabletoperators = Array.isArray(old_match?.setup?.tabletoperators)
		? old_match.setup.tabletoperators
		: [];
	const release_participant_index = _tabletoperator_release_participant_index(tabletoperator_assignment_id);
	const assignment_court_id = setup?.court_id || old_match?.setup?.court_id || false;

	_find_tabletoperator_replacement_participant(app, tournament_key, replacement_name, replacement_btp_id, (find_err, replacement_participant) => {
		if (find_err) {
			return callback(find_err);
		}
		if (!replacement_participant) {
			return callback(null);
		}

		const replace_single = release_participant_index !== null;
		const released_tabletoperators = replace_single
			? current_tabletoperators.filter((participant, index) => index === release_participant_index)
			: current_tabletoperators;
		if (replace_single && released_tabletoperators.length === 0) {
			return callback(new Error('Tabletoperator for replacement not found in match'));
		}
		const released_ids = [...new Set(released_tabletoperators
			.map((participant) => Number(participant && participant.btp_id))
			.filter((btp_id) => Number.isFinite(btp_id) && btp_id !== -1))];

		const next_tabletoperators = replace_single
			? current_tabletoperators.map((participant, index) => index === release_participant_index ? replacement_participant : participant)
			: [replacement_participant];

		setup.tabletoperators = _normalize_tabletoperator_participants_for_assignment(next_tabletoperators, assignment_court_id);
		if (!assignment_court_id) {
			return callback(null);
		}

		_release_tabletoperator_player_flags(app, tournament_key, released_ids, (release_err) => {
			if (release_err) {
				return callback(release_err);
			}
			_set_tabletoperator_player_flags(app, tournament_key, setup.tabletoperators, assignment_court_id, callback);
		});
	});
}

function _apply_match_edit_tabletoperator_assignment(app, tournament_key, old_match, setup, tabletoperator_assignment_id, replacement_name, replacement_btp_id, callback) {
	if (replacement_name && String(replacement_name).trim()) {
		return _replace_match_edit_tabletoperator(app, tournament_key, old_match, setup, tabletoperator_assignment_id, replacement_name, replacement_btp_id, callback);
	}
	if (!tabletoperator_assignment_id) {
		return callback(null);
	}
	const release_participant_index = _tabletoperator_release_participant_index(tabletoperator_assignment_id);

	if (tabletoperator_assignment_id === TABLETOPERATOR_RELEASE_SELECTION || release_participant_index !== null) {
		const current_tabletoperators = Array.isArray(old_match?.setup?.tabletoperators)
			? old_match.setup.tabletoperators
			: [];
		const released_tabletoperators = tabletoperator_assignment_id === TABLETOPERATOR_RELEASE_SELECTION
			? current_tabletoperators
			: current_tabletoperators.filter((participant, index) => index === release_participant_index);
		if (released_tabletoperators.length === 0) {
			return callback(new Error('Tabletoperator for release not found in match'));
		}
		const released_ids = [...new Set(released_tabletoperators
			.map((participant) => Number(participant && participant.btp_id))
			.filter((btp_id) => Number.isFinite(btp_id) && btp_id !== -1))];
		const remaining_tabletoperators = tabletoperator_assignment_id === TABLETOPERATOR_RELEASE_SELECTION
			? []
			: current_tabletoperators.filter((participant, index) => index !== release_participant_index);
		if (remaining_tabletoperators.length > 0) {
			setup.tabletoperators = _normalize_tabletoperator_participants_for_assignment(remaining_tabletoperators, setup.court_id);
		} else {
			delete setup.tabletoperators;
		}
		return _release_tabletoperator_player_flags(app, tournament_key, released_ids, callback);
	}

	app.db.tabletoperators.findOne({
		_id: tabletoperator_assignment_id,
		tournament_key,
		court: null,
	}, (find_err, queued_entry) => {
		if (find_err) {
			return callback(find_err);
		}
		if (!queued_entry) {
			return callback(new Error('Tabletoperator for assignment not found in waiting list'));
		}

		const selected_tabletoperators = _normalize_tabletoperator_participants_for_assignment(queued_entry.tabletoperator, setup.court_id);
		const previous_tabletoperators = _normalize_tabletoperator_participants_for_waiting_list(old_match?.setup?.tabletoperators);
		setup.tabletoperators = selected_tabletoperators;
		const previous_tabletoperator_ids = [...new Set(previous_tabletoperators
			.map((participant) => Number(participant && participant.btp_id))
			.filter((btp_id) => Number.isFinite(btp_id) && btp_id !== -1))];

		const finalize_assignment = (swap_err) => {
			if (swap_err) {
				return callback(swap_err);
			}
			const assigned_court_marker = setup.court_id || '__match_edit_assigned__';
			app.db.tabletoperators.update(
				{ _id: queued_entry._id, tournament_key },
				{ $set: { court: assigned_court_marker } },
				{ returnUpdatedDocs: true },
				(update_err, numAffected, changed_tabletoperator) => {
					if (update_err) {
						return callback(update_err);
					}
					if (numAffected > 0 && changed_tabletoperator) {
						notify_change(app, tournament_key, 'tabletoperator_removed', { tabletoperator: changed_tabletoperator });
					}
					if (!setup.court_id) {
						return callback(null);
					}
					_release_tabletoperator_player_flags(app, tournament_key, previous_tabletoperator_ids, (remove_err) => {
						if (remove_err) {
							return callback(remove_err);
						}
						_set_tabletoperator_player_flags(app, tournament_key, setup.tabletoperators, setup.court_id, callback);
					});
				}
			);
		};

		if (!previous_tabletoperators.length) {
			return finalize_assignment(null);
		}

		const swapped_tabletoperator = {
			tournament_key,
			tabletoperator: previous_tabletoperators,
			match_id: old_match?._id || 'manual_swap',
			start_ts: queued_entry.start_ts || now_ms(app),
			end_ts: null,
			court: null,
			played_on_court: null,
		};
		app.db.tabletoperators.insert(swapped_tabletoperator, (insert_err, inserted_tabletoperator) => {
			if (insert_err) {
				return callback(insert_err);
			}
			notify_change(app, tournament_key, 'tabletoperator_add', { tabletoperator: inserted_tabletoperator });
			finalize_assignment(null);
		});
	});
}

function handle_match_call_on_court(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'court_id', 'match_id'])) {
		return;
	}
	app.db.tournaments.findOne({ key: msg.tournament_key }, async (err, tournament) => {
		if (err) {
			return ws.respond(msg, err);
		}

		update_queue.instance().execute(process_match,app, msg, tournament).then(res => {
			ws.respond(msg);
		}).catch(err => {
			ws.respond(msg, err);
		});
	});

}


function process_match(app, msg, tournament) {
	return new Promise((resolve, reject) => {
		const match_utils = require('./match_utils');
		app.db.matches.findOne({ tournament_key: msg.tournament_key, _id: msg.match_id }, async (err, match) => {
			if (err) {
				reject(err);
				return;
			}
			if (match != null) {
				match.setup.court_id = msg.court_id;
				match.setup.now_on_court = true;
				match_utils.call_match(app, tournament, match, undefined, (err, updated_match) => {
					if (err) {
						reject(err);
					} else {
						resolve(updated_match);
					}
				});
			} else {
				reject(new Error("Match cannot be fetched from DB 222 " + msg.match_id));
			}
		});
	});
}

function normalize_match_score_status(score_status) {
	if (score_status === 'no_match_team1' || score_status === 'no_match_team2') {
		return 'no_match';
	}
	const allowed = new Set(['normal', 'walkover', 'retired', 'disqualified', 'no_match']);
	return allowed.has(score_status) ? score_status : 'normal';
}

function match_score_status_forwards_loser(score_status) {
	return score_status === 'retired' || score_status === 'disqualified' || score_status === 'no_match';
}

function match_score_status_cascades_no_match(score_status) {
	return score_status === 'retired' || score_status === 'disqualified' || score_status === 'no_match';
}

function match_score_status_is_special_result(score_status) {
	return score_status === 'walkover' || match_score_status_cascades_no_match(score_status);
}

function plain_deep_copy(value) {
	return value == null ? value : JSON.parse(JSON.stringify(value));
}

function match_has_played_result(match) {
	const score_status = normalize_match_score_status(match?.score_status);
	if (score_status === 'walkover' || score_status === 'no_match') {
		return false;
	}
	return typeof match?.team1_won === 'boolean' ||
		(Array.isArray(match?.network_score) && match.network_score.length > 0) ||
		(Array.isArray(match?.presses) && match.presses.length > 0);
}

function match_event_name(match) {
	return String(match?.setup?.event_name || '').trim();
}

function normalize_match_discipline_name(match) {
	return match_event_name(match)
		.replace(/\s*-\s*(?:Gruppe|Position)\s+.+$/i, '')
		.trim();
}

function match_same_event(a, b) {
	const discipline_a = normalize_match_discipline_name(a);
	const discipline_b = normalize_match_discipline_name(b);
	return discipline_a !== '' && discipline_a === discipline_b;
}

function match_team_players(setup, team_index) {
	const teams = Array.isArray(setup?.teams) ? setup.teams : [];
	const team = teams[team_index];
	return Array.isArray(team?.players) ? team.players : [];
}

function match_team_btp_ids(setup, team_index) {
	return match_team_players(setup, team_index)
		.map((player) => player?.btp_id)
		.filter((btp_id) => btp_id != null && btp_id !== -1)
		.map((btp_id) => String(btp_id));
}

function match_team_has_known_players(setup, team_index) {
	const players = match_team_players(setup, team_index);
	return players.length > 0 && players.every((player) => player?.btp_id != null && player.btp_id !== -1);
}

function match_no_match_opponent_is_known(match, affected_team_index) {
	if (affected_team_index !== 0 && affected_team_index !== 1) {
		return false;
	}
	return match_team_has_known_players(match?.setup, affected_team_index === 0 ? 1 : 0);
}

function match_contains_any_btp_id(match, btp_ids) {
	if (!match?.setup || !btp_ids || btp_ids.size === 0) {
		return false;
	}
	for (let team_index = 0; team_index < 2; team_index++) {
		for (const btp_id of match_team_btp_ids(match.setup, team_index)) {
			if (btp_ids.has(btp_id)) {
				return true;
			}
		}
	}
	return false;
}

function match_contains_all_btp_ids(match, btp_ids) {
	if (!match?.setup || !btp_ids || btp_ids.size === 0) {
		return false;
	}
	const match_btp_ids = new Set();
	for (let team_index = 0; team_index < 2; team_index++) {
		for (const btp_id of match_team_btp_ids(match.setup, team_index)) {
			match_btp_ids.add(btp_id);
		}
	}
	for (const btp_id of btp_ids) {
		if (!match_btp_ids.has(btp_id)) {
			return false;
		}
	}
	return true;
}

function match_is_before(a, b) {
	const setup_a = a?.setup || {};
	const setup_b = b?.setup || {};
	const date_a = setup_a.scheduled_date || '';
	const date_b = setup_b.scheduled_date || '';
	if (date_a && date_b && date_a !== date_b) {
		return date_a < date_b;
	}
	const time_a = setup_a.scheduled_time_str || '';
	const time_b = setup_b.scheduled_time_str || '';
	if (time_a && time_b && time_a !== time_b) {
		return time_a < time_b;
	}
	const match_num_a = Number(setup_a.match_num);
	const match_num_b = Number(setup_b.match_num);
	if (Number.isFinite(match_num_a) && Number.isFinite(match_num_b) && match_num_a !== match_num_b) {
		return match_num_a < match_num_b;
	}
	return false;
}

function team_has_prior_played_match_in_event(matches, source_match, team_index) {
	const affected_btp_ids = new Set(match_team_btp_ids(source_match?.setup, team_index));
	if (affected_btp_ids.size === 0) {
		return true;
	}
	return (matches || []).some((match) =>
		match &&
		match._id !== source_match._id &&
		match_same_event(source_match, match) &&
		match_is_before(match, source_match) &&
		match_contains_all_btp_ids(match, affected_btp_ids) &&
		match_has_played_result(match)
	);
}

function resolve_admin_match_score_status(app, tournament_key, old_match, edited_match, callback) {
	const raw_score_status = edited_match?.score_status;
	const score_status = normalize_match_score_status(raw_score_status);
	const no_match_losing_team = no_match_losing_team_from_message(edited_match);
	if (score_status !== 'no_match' || no_match_losing_team == null || match_has_played_result(old_match)) {
		return callback(null, { score_status, no_match_losing_team });
	}
	const source_match = {
		...old_match,
		setup: edited_match?.setup || old_match?.setup,
	};
	app.db.matches.find({ tournament_key }, (err, matches) => {
		if (err) {
			return callback(err);
		}
		const has_prior_played_match = team_has_prior_played_match_in_event(matches, source_match, no_match_losing_team);
		callback(null, {
			score_status: has_prior_played_match ? 'no_match' : 'walkover',
			no_match_losing_team,
		});
	});
}

function affected_team_index_for_score_status(match) {
	if (!match) {
		return null;
	}
	if (match.score_status === 'no_match' && (match.no_match_losing_team === 0 || match.no_match_losing_team === 1)) {
		return match.no_match_losing_team;
	}
	if (typeof match.team1_won !== 'boolean') {
		return null;
	}
	return match.team1_won ? 1 : 0;
}

function no_match_losing_team_from_message(match) {
	if (!match) {
		return null;
	}
	if (match.no_match_losing_team === 0 || match.no_match_losing_team === 1) {
		return match.no_match_losing_team;
	}
	if (match.score_status === 'no_match_team1') {
		return 0;
	}
	if (match.score_status === 'no_match_team2') {
		return 1;
	}
	return null;
}

function team_affected_by_btp_ids(match, team_index, affected_btp_ids) {
	return match_team_btp_ids(match?.setup, team_index).some((btp_id) => affected_btp_ids.has(btp_id));
}

function affected_team_state_from_btp_ids(match, affected_btp_ids) {
	const team0_affected = team_affected_by_btp_ids(match, 0, affected_btp_ids);
	const team1_affected = team_affected_by_btp_ids(match, 1, affected_btp_ids);
	if (team0_affected && team1_affected) {
		return 'both';
	}
	if (team0_affected) {
		return 0;
	}
	if (team1_affected) {
		return 1;
	}
	return null;
}

function collect_cascade_inactive_btp_ids(matches, source_match) {
	const result = new Set();
	for (const match of matches || []) {
		if (!match || !match_same_event(source_match, match) || !match_score_status_cascades_no_match(match.score_status)) {
			continue;
		}
		const affected_team_index = affected_team_index_for_score_status(match);
		if (affected_team_index == null) {
			continue;
		}
		for (const btp_id of match_team_btp_ids(match.setup, affected_team_index)) {
			result.add(btp_id);
		}
	}
	return result;
}

function unfinished_match_can_be_auto_no_match(match) {
	return !!match?._id &&
		typeof match.team1_won !== 'boolean' &&
		!match.btp_winner &&
		match.score_status !== 'no_match';
}

function match_can_be_auto_no_winner_no_match(match) {
	if (!match?._id) {
		return false;
	}
	if (Array.isArray(match.presses) && match.presses.length > 0) {
		return false;
	}
	if (Array.isArray(match.network_score) && match.network_score.length > 0) {
		return false;
	}
	const score_status = normalize_match_score_status(match.score_status);
	if (score_status !== 'normal' && score_status !== 'no_match') {
		return false;
	}
	return typeof match.team1_won !== 'boolean' || score_status === 'no_match';
}

function reset_cascaded_match_setup(setup) {
	const next_setup = plain_deep_copy(setup || {});
	next_setup.now_on_court = false;
	next_setup.state = 'scheduled';
	next_setup.highlight = 0;
	delete next_setup.preparation_call_timestamp;
	delete next_setup.preparation_call_deferred;
	return next_setup;
}

function remove_affected_teams_from_setup(setup, affected_btp_ids) {
	const original_setup = setup || {};
	const next_setup = plain_deep_copy(original_setup);
	if (!Array.isArray(next_setup.teams)) {
		return next_setup;
	}
	let changed = false;
	next_setup.teams = next_setup.teams.map((team, team_index) => {
		const team_ids = match_team_btp_ids(original_setup, team_index);
		if (!team_ids.some((btp_id) => affected_btp_ids.has(btp_id))) {
			return team;
		}
		changed = true;
		return { ...(team || {}), players: [] };
	});
	if (changed) {
		next_setup.incomplete = true;
	}
	return next_setup;
}

function cascade_no_match_for_future_player_matches(app, tournament_key, source_match, callback) {
	if (!source_match || !match_score_status_cascades_no_match(source_match.score_status)) {
		return callback(null, []);
	}
	const affected_team_index = affected_team_index_for_score_status(source_match);
	if (affected_team_index == null) {
		return callback(null, []);
	}
	const affected_btp_ids = new Set(match_team_btp_ids(source_match.setup, affected_team_index));

	app.db.matches.find({ tournament_key }, (find_err, matches) => {
		if (find_err) {
			return callback(find_err);
		}
		const cascade_inactive_btp_ids = collect_cascade_inactive_btp_ids(matches, source_match);
		const candidate_by_id = new Map();
		const no_winner_candidate_by_id = new Map();
		function add_no_winner_candidate(match) {
			if (
				!match ||
				match._id === source_match._id ||
				!match_same_event(source_match, match) ||
				!match_team_has_known_players(match.setup, 0) ||
				!match_team_has_known_players(match.setup, 1) ||
				!match_can_be_auto_no_winner_no_match(match) ||
				no_winner_candidate_by_id.has(match._id)
			) {
				return;
			}
			no_winner_candidate_by_id.set(match._id, { match });
		}
		function add_candidate(match, affected_team_index) {
			if (
				!match ||
				match._id === source_match._id ||
				!match_same_event(source_match, match) ||
				!unfinished_match_can_be_auto_no_match(match) ||
				affected_team_index == null ||
				!match_no_match_opponent_is_known(match, affected_team_index) ||
				candidate_by_id.has(match._id)
			) {
				return;
			}
			candidate_by_id.set(match._id, { match, affected_team_index });
		}

		for (const match of matches || []) {
			if (affected_btp_ids.size === 0) {
				continue;
			}
			const global_affected_team_state = affected_team_state_from_btp_ids(match, cascade_inactive_btp_ids);
			if (global_affected_team_state === 'both') {
				add_no_winner_candidate(match);
				continue;
			}
			if (!match_contains_any_btp_id(match, affected_btp_ids)) {
				continue;
			}
			add_candidate(match, global_affected_team_state);
		}

			const candidates = [...candidate_by_id.values()];
			const no_winner_candidates = [...no_winner_candidate_by_id.values()];
			const changed_matches = [];
			async.eachSeries(no_winner_candidates, (candidate, next) => {
				const { match } = candidate;
			const setup = { ...(match.setup || {}) };
			setup.now_on_court = false;
			setup.state = 'scheduled';
				setup.highlight = 0;
				delete setup.preparation_call_timestamp;
				delete setup.preparation_call_deferred;
				const set_update = {
					setup,
					score_status: 'no_match',
					forward_loser: false,
					btp_needsync: true,
					no_match_cascade_source_match_id: source_match._id,
					no_match_cascade_affected_btp_ids: [...affected_btp_ids],
					no_match_cascade_original_setup: match.no_match_cascade_original_setup || plain_deep_copy(match.setup),
				};
				app.db.matches.update(
					{ _id: match._id, tournament_key },
					{
						$set: set_update,
					$unset: {
						network_score: true,
						score_status_network_score: true,
						no_match_losing_team: true,
						team1_won: true,
						btp_winner: true,
					},
				},
				{ returnUpdatedDocs: true },
				(update_err, numAffected, changed_match) => {
					if (update_err) {
						return next(update_err);
					}
					if (numAffected === 1 && changed_match) {
						changed_matches.push(changed_match);
					}
					return next(null);
				}
			);
		}, (no_winner_err) => {
			if (no_winner_err) {
				return callback(no_winner_err);
			}
			async.eachSeries(candidates, (candidate, next) => {
				const { match, affected_team_index: no_match_losing_team } = candidate;
				const team1_won = no_match_losing_team === 1;
				const setup = { ...(match.setup || {}) };
				setup.now_on_court = false;
				setup.state = 'scheduled';
				setup.highlight = 0;
				delete setup.preparation_call_timestamp;
					delete setup.preparation_call_deferred;
					// DBV cascade rule: the source can be retired/disqualified/no_match,
					// but every future affected match is written as "kein Spiel".
					const set_update = {
						setup,
						score_status: 'no_match',
						forward_loser: true,
						btp_needsync: true,
						no_match_cascade_source_match_id: source_match._id,
						no_match_cascade_affected_btp_ids: [...affected_btp_ids],
						no_match_cascade_original_setup: match.no_match_cascade_original_setup || plain_deep_copy(match.setup),
					};
				set_update.no_match_losing_team = no_match_losing_team;
				set_update.team1_won = team1_won;
				set_update.btp_winner = team1_won ? 1 : 2;
				app.db.matches.update(
					{ _id: match._id, tournament_key },
					{ $set: set_update, $unset: { network_score: true, score_status_network_score: true } },
					{ returnUpdatedDocs: true },
					(update_err, numAffected, changed_match) => {
						if (update_err) {
							return next(update_err);
						}
						if (numAffected === 1 && changed_match) {
							changed_matches.push(changed_match);
						}
						return next(null);
					}
				);
			}, (update_err) => callback(update_err, changed_matches));
		});
	});
}

function clear_no_match_cascade_for_source_match(app, tournament_key, source_match, callback) {
	if (!source_match || !match_score_status_is_special_result(source_match.score_status)) {
		return callback(null, []);
	}
	const affected_team_index = affected_team_index_for_score_status(source_match);
	if (affected_team_index == null) {
		return callback(null, []);
	}
	const affected_btp_ids = new Set(match_team_btp_ids(source_match.setup, affected_team_index));
	if (affected_btp_ids.size === 0) {
		return callback(null, []);
	}

	app.db.matches.find({ tournament_key }, (find_err, matches) => {
		if (find_err) {
			return callback(find_err);
		}
		const changed_matches = [];
		const candidates = (matches || []).filter((match) => {
			if (
				!match ||
				match._id === source_match._id ||
				!match_same_event(source_match, match) ||
				!match_contains_any_btp_id(match, affected_btp_ids)
			) {
				return false;
			}
				if (match.no_match_cascade_source_match_id === source_match._id) {
					return true;
				}
				const affected_team_state = affected_team_state_from_btp_ids(match, affected_btp_ids);
				return normalize_match_score_status(match.score_status) === 'no_match' &&
					affected_team_state != null &&
					(match.no_match_losing_team === affected_team_state || affected_team_state === 'both' || match.forward_loser === true) &&
					!match_has_played_result(match);
			});

		async.eachSeries(candidates, (match, next) => {
			const restored_setup = match.no_match_cascade_original_setup
				? plain_deep_copy(match.no_match_cascade_original_setup)
				: remove_affected_teams_from_setup(match.setup, affected_btp_ids);
			const setup = reset_cascaded_match_setup(restored_setup);
			app.db.matches.update(
				{ _id: match._id, tournament_key },
				{
					$set: {
						setup,
						score_status: 'normal',
						forward_loser: false,
						btp_needsync: true,
					},
					$unset: {
						network_score: true,
						score_status_network_score: true,
						no_match_losing_team: true,
						team1_won: true,
						btp_winner: true,
						no_match_cascade_source_match_id: true,
						no_match_cascade_affected_btp_ids: true,
						no_match_cascade_original_setup: true,
					},
				},
				{ returnUpdatedDocs: true },
				(update_err, numAffected, changed_match) => {
					if (update_err) {
						return next(update_err);
					}
					if (numAffected === 1 && changed_match) {
						changed_matches.push(changed_match);
					}
					return next(null);
				}
			);
		}, (update_err) => callback(update_err, changed_matches));
	});
}

function get_no_match_winning_team_index(match) {
	if (!match || match.score_status !== 'no_match') {
		return null;
	}
	if (match.no_match_losing_team === 0) {
		return 1;
	}
	if (match.no_match_losing_team === 1) {
		return 0;
	}
	return null;
}

function notify_no_match_win_announcement(app, tournament_key, match) {
	const winning_team_index = get_no_match_winning_team_index(match);
	if (winning_team_index == null) {
		return false;
	}
	notify_change(app, tournament_key, 'match_no_match_announcement', {
		match__id: match._id,
		match,
		winning_team_index,
	});
	return true;
}

function notify_cascaded_no_match_announcements(app, tournament_key, tournament, cascade_matches) {
	if (!tournament?.no_match_cascade_announcements_enabled) {
		return 0;
	}
	let count = 0;
	for (const match of cascade_matches || []) {
		if (match?.no_match_cascade_source_match_id) {
			count += notify_no_match_win_announcement(app, tournament_key, match) ? 1 : 0;
		}
	}
	return count;
}

function handle_match_edit(app, ws, msg) {
	const match_utils = require('./match_utils');
	
	if (!_require_msg(ws, msg, ['tournament_key', 'id', 'match', 'old_court'])) {
		return;
	}
	const tournament_key = msg.tournament_key;
	const setup = msg.match.setup;
	const tabletoperator_assignment_id = msg.tabletoperator_assignment_id || null;
	const tabletoperator_replacement_name = msg.tabletoperator_replacement_name || null;
	const tabletoperator_replacement_btp_id = msg.tabletoperator_replacement_btp_id != null
		? msg.tabletoperator_replacement_btp_id
		: null;

	app.db.tournaments.findOne({ key: tournament_key }, async (err, tournament) => {
		if (err) {
			return ws.respond(msg, err);
		}

		app.db.matches.findOne({_id: msg.id, tournament_key}, function(old_err, old_match) {
			if (old_err) {
				ws.respond(msg, old_err);
				return;
			}
			if (!old_match) {
				ws.respond(msg, new Error('Cannot find match ' + msg.id + ' of tournament ' + tournament_key + ' in database'));
				return;
			}

			const old_setup = old_match.setup || {};
			const was_called = !!old_setup.called_timestamp;
			const will_be_on_court = !!setup.now_on_court && !!setup.court_id;
			const will_be_in_preparation = !will_be_on_court && setup.state === 'preparation' && !!setup.location_id;
			const was_in_same_preparation =
				old_setup.state === 'preparation' &&
				old_setup.location_id === setup.location_id &&
				Number(old_setup.highlight) > 0 &&
				!!old_setup.preparation_call_timestamp;
			const court_changed = (old_setup.court_id || null) !== (setup.court_id || null);
			const dependent_releases = _collect_dependent_official_releases(setup);
			const official_sync_meta = _build_match_edit_official_sync_meta(old_setup, setup || {});
			resolve_admin_match_score_status(app, tournament_key, old_match, msg.match, function(score_status_err, resolved_status) {
				if (score_status_err) {
					ws.respond(msg, score_status_err);
					return;
				}
				const score_status = resolved_status.score_status;
				const forward_loser = match_score_status_forwards_loser(score_status);
				const no_match_losing_team = resolved_status.no_match_losing_team;
				const old_score_status = normalize_match_score_status(old_match.score_status);
				const clears_special_result = match_score_status_is_special_result(old_score_status) &&
					!match_score_status_is_special_result(score_status);
				if (no_match_losing_team != null) {
					msg.match.no_match_losing_team = no_match_losing_team;
					msg.match.team1_won = no_match_losing_team === 1;
					msg.match.btp_winner = msg.match.team1_won ? 1 : 2;
					delete msg.match.network_score;
					delete msg.match.score_status_network_score;
				} else {
					delete msg.match.no_match_losing_team;
					if (clears_special_result) {
						delete msg.match.team1_won;
						delete msg.match.btp_winner;
						delete msg.match.network_score;
						delete msg.match.score_status_network_score;
					}
				}
					const has_result_status_change =
						old_score_status !== score_status ||
						(old_match.no_match_losing_team == null ? null : old_match.no_match_losing_team) !== no_match_losing_team ||
						(old_match.team1_won == null ? null : old_match.team1_won) !== (msg.match.team1_won == null ? null : msg.match.team1_won) ||
						(old_match.forward_loser === true) !== forward_loser;
					const should_announce_no_match =
						(score_status === 'no_match' || score_status === 'walkover') &&
						no_match_losing_team != null &&
						has_result_status_change;

			_apply_match_edit_tabletoperator_assignment(app, tournament_key, old_match, setup, tabletoperator_assignment_id, tabletoperator_replacement_name, tabletoperator_replacement_btp_id, function(tabletoperator_err) {
				if (tabletoperator_err) {
					ws.respond(msg, tabletoperator_err);
					return;
				}

				if (will_be_on_court && !was_called) {
					return match_utils.call_match(app, tournament, msg.match, msg.old_court, (call_err) => {
						ws.respond(msg, call_err);
					});
				}

				if (will_be_on_court && was_called && court_changed) {
					return match_utils.switch_court(app, tournament, msg.match, msg.old_court, (switch_err) => {
						ws.respond(msg, switch_err);
					});
				}

				if (!will_be_on_court && was_called) {
					return match_utils.uncall_match(app, tournament, msg.match, msg.old_court, (uncall_err) => {
						ws.respond(msg, uncall_err);
					});
				}

				if (will_be_in_preparation && !was_in_same_preparation) {
					return match_utils.call_match_in_preparation(app, tournament, msg.match, setup.location_id, (preparation_err) => {
						ws.respond(msg, preparation_err);
					}, { force: true });
				}

					const update_set = { setup, score_status, forward_loser };
					const update_unset = {};
					if (no_match_losing_team != null) {
						update_set.no_match_losing_team = no_match_losing_team;
						update_set.team1_won = msg.match.team1_won;
						update_set.btp_winner = msg.match.btp_winner;
						update_unset.network_score = true;
						update_unset.score_status_network_score = true;
					} else {
						update_unset.no_match_losing_team = true;
						if (clears_special_result) {
							update_unset.team1_won = true;
							update_unset.btp_winner = true;
							update_unset.network_score = true;
							update_unset.score_status_network_score = true;
						}
					}
				if (official_sync_meta.has_official_change || has_result_status_change) {
					update_set.btp_needsync = true;
				}
				const update_doc = { $set: update_set };
				if (Object.keys(update_unset).length > 0) {
					update_doc.$unset = update_unset;
				}
				app.db.matches.update({_id: msg.id, tournament_key}, update_doc, {returnUpdatedDocs: true}, function(err, numAffected, changed_match) {
					if (err) {
						ws.respond(msg, err);
						return;
					}
					if (numAffected !== 1) {
						ws.respond(msg, new Error('Cannot find match ' + msg.id + ' of tournament ' + tournament_key + ' in database'));
						return;
					}
					if (changed_match._id !== msg.id) {
						const errmsg = 'Match ' + changed_match._id + ' changed by accident, intended to change ' + msg.id + ' (old nedb version?)';
						serror.silent(errmsg);
						ws.respond(msg, new Error(errmsg));
						return;
					}

					_apply_match_edit_official_state_changes(app, tournament_key, old_setup, changed_match.setup || {}, function(official_err) {
						if (official_err) {
							ws.respond(msg, official_err);
							return;
						}
							_apply_wait_releases(app, tournament_key, dependent_releases, now_ms(app) / 10, function(release_err) {
								if (release_err) {
									ws.respond(msg, release_err);
									return;
								}
								clear_no_match_cascade_for_source_match(app, tournament_key, old_match, function(clear_err, cleared_matches) {
									if (clear_err) {
										ws.respond(msg, clear_err);
										return;
									}
									cascade_no_match_for_future_player_matches(app, tournament_key, changed_match, function(cascade_err, cascade_matches) {
										if (cascade_err) {
											ws.respond(msg, cascade_err);
											return;
										}
									const related_matches = [...(cleared_matches || []), ...(cascade_matches || [])];
										notify_change(app, tournament_key, 'match_edit', {match__id: msg.id, match: changed_match});
										if (should_announce_no_match) {
											notify_change(app, tournament_key, 'match_no_match_announcement', {
												match__id: changed_match._id,
												match: changed_match,
												winning_team_index: no_match_losing_team === 1 ? 0 : 1,
											});
										}
										for (const related_match of related_matches) {
											notify_change(app, tournament_key, 'match_edit', {match__id: related_match._id, match: related_match});
										}
										notify_cascaded_no_match_announcements(app, tournament_key, tournament, cascade_matches);
									match_utils.queue_reconcile_player_court_flags(app, tournament_key);
									if (msg.btp_update) {
										btp_manager.update_score(app, changed_match);
											for (const related_match of related_matches) {
												btp_manager.update_score(app, related_match);
											}
										}
										app.db.umpires.find({ tournament_key }, function (umpire_err, all_umpires) {
											if (umpire_err) {
												ws.respond(msg, umpire_err);
												return;
											}
											notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
											ws.respond(msg, err);
										});
									});
								});
							});
						});
					});
			});
			});
		});
	});
}

function _roles_by_official_id_from_setup(setup) {
	const map = new Map();
	['umpire', 'service_judge'].forEach((role) => {
		const official = setup && setup[role];
		if (official && official._id) {
			if (!map.has(official._id)) {
				map.set(official._id, { official, roles: new Set() });
			}
			map.get(official._id).roles.add(role);
		}
	});
	return map;
}

function _build_match_edit_official_sync_meta(old_setup, new_setup) {
	const result = {
		has_official_change: false
	};
	['umpire', 'service_judge'].forEach((role) => {
		const suppressed_key = role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id';
		const old_official = old_setup && old_setup[role];
		const new_official = new_setup && new_setup[role];
		const old_btp_id = old_official && old_official.btp_id != null ? String(old_official.btp_id) : null;
		const new_btp_id = new_official && new_official.btp_id != null ? String(new_official.btp_id) : null;
		if (old_btp_id !== new_btp_id) {
			result.has_official_change = true;
			if (old_official && old_official.btp_id != null) {
				new_setup[suppressed_key] = old_official.btp_id;
			}
		}
		if (new_official && new_official.btp_id != null) {
			delete new_setup[suppressed_key];
		}
	});
	return result;
}

function _collect_dependent_official_releases(setup) {
	const releases = [];
	if (!setup.umpire && setup.service_judge) {
		const dependent = setup.service_judge;
		if (dependent && dependent.btp_id != null) {
			setup.suppressed_service_judge_btp_id = dependent.btp_id;
		}
		delete setup.service_judge;
		if (dependent && dependent._id) {
			releases.push({
				official_id: dependent._id,
				wait_field: 'service_judge_wait',
				target_position: 'front'
			});
		}
	}
	return releases;
}

function _remove_official_from_setup(setup, role) {
	const current_btp_id = setup[role] && setup[role].btp_id != null ? setup[role].btp_id : null;
	delete setup[role];
	if (current_btp_id != null) {
		setup[role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id'] = current_btp_id;
	}
	return _collect_dependent_official_releases(setup);
}

function _official_wait_set_obj(wait_field, ts) {
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
		is_planed_as_umpire: false
	};
	setObj[wait_field] = ts;
	return setObj;
}

function _official_list_target_ts(to_list, base_ts, tournament) {
	return base_ts;
}

function _official_list_target_field(to_list) {
	if (to_list === 'umpire_pause') {
		return 'umpire_manual_pause';
	}
	if (to_list === 'service_judge_pause') {
		return 'service_judge_manual_pause';
	}
	return to_list;
}

function _apply_wait_releases(app, tournament_key, releases, start_ts, cb) {
	if (!releases.length) {
		cb(null, []);
		return;
	}
	let index = 0;
	const updated_ids = [];
	const next = () => {
		if (index >= releases.length) {
			cb(null, updated_ids);
			return;
		}
		const release = releases[index++];
		updated_ids.push(release.official_id);
		const release_ts = release.target_position === 'front'
			? index
			: (start_ts + index - 1);
		app.db.umpires.update(
			{ _id: release.official_id, tournament_key },
			{ $set: _official_wait_set_obj(release.wait_field, release_ts) },
			{},
			function (err) {
				if (err) {
					cb(err);
					return;
				}
				next();
			}
		);
	};
	next();
}

function _preferred_wait_field_from_roles(official_doc, old_roles) {
	if (old_roles.has('service_judge') && !old_roles.has('umpire')) {
		return 'service_judge_wait';
	}
	if (old_roles.has('umpire') && !old_roles.has('service_judge')) {
		return 'umpire_wait';
	}
	if (official_doc && official_doc.is_umpire && !official_doc.is_service_judge) {
		return 'umpire_wait';
	}
	if (official_doc && official_doc.is_service_judge && !official_doc.is_umpire) {
		return 'service_judge_wait';
	}
	return 'umpire_wait';
}

function _apply_match_edit_official_state_changes(app, tournament_key, old_setup, new_setup, cb) {
	const old_roles_by_id = _roles_by_official_id_from_setup(old_setup);
	const new_roles_by_id = _roles_by_official_id_from_setup(new_setup);
	const affected_ids = [...new Set([...old_roles_by_id.keys(), ...new_roles_by_id.keys()])];
	if (!affected_ids.length) {
		cb();
		return;
	}

	app.db.umpires.find({ tournament_key, _id: { $in: affected_ids } }, function (err, officials) {
		if (err) {
			cb(err);
			return;
		}
		const official_by_id = new Map((officials || []).map((official) => [official._id, official]));
		const updates = affected_ids.map((official_id) => {
			const official_doc = official_by_id.get(official_id);
			if (!official_doc) {
				return null;
			}
			const old_roles = old_roles_by_id.get(official_id)?.roles || new Set();
			const new_roles = new_roles_by_id.get(official_id)?.roles || new Set();
			const same_roles = old_roles.size === new_roles.size && [...old_roles].every((role) => new_roles.has(role));
			if (same_roles) {
				return null;
			}
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
				is_planed_as_service_judge: new_roles.has('service_judge'),
				is_planed_as_umpire: new_roles.has('umpire')
			};
			if (new_roles.size === 0) {
				setObj[_preferred_wait_field_from_roles(official_doc, old_roles)] = now_ms(app) / 10;
			}
			return { official_id, setObj };
		}).filter(Boolean);

		if (!updates.length) {
			cb();
			return;
		}

		let index = 0;
		const next = () => {
			if (index >= updates.length) {
				cb();
				return;
			}
			const update = updates[index++];
			app.db.umpires.update(
				{ _id: update.official_id, tournament_key },
				{ $set: update.setObj },
				{},
				function (update_err) {
					if (update_err) {
						cb(update_err);
						return;
					}
					next();
				}
			);
		};
		next();
	});
}




function handle_match_preparation_call(app, ws, msg) {

	const match_utils = require('./match_utils');

	if (!_require_msg(ws, msg, ['tournament_key', 'match', 'location_id'])) {
		return;
	}
	if (match_utils.match_completly_initialized(msg.match.setup) == false) {
		return ws.respond("Match cannot be called one or more Teams are not set.");
	}

	const tournament_key = msg.tournament_key;
	app.db.tournaments.findOne({ key: tournament_key }, async (err, tournament) => {
		if (err) {
			return ws.respond(err);
		}

		match_utils.call_match_in_preparation(app, tournament, msg.match, msg.location_id, (err) => {
			ws.respond(msg, err);
			return;
		}, { force: true });
	});
}

function handle_match_player_check_in (app, ws, msg) {
	const match_utils = require('./match_utils');

	if (!_require_msg(ws, msg, ['tournament_key', 'player_id', 'match_id', 'checked_in'])) {
		return;
	}

	update_queue.instance().execute(update_queue.named('handle_match_player_check_in', () => new Promise((resolve, reject) => {
		app.db.tournaments.findOne({ key: msg.tournament_key }, async (err, tournament) => {
			if (err) {
				return reject(err);
			}

			app.db.matches.findOne({tournament_key: msg.tournament_key, _id: msg.match_id}, async (err, match) => {
				if (err) {
					return reject(err);
				}
				if (!match || !match.setup) {
					return reject(new Error('Match not found'));
				}

				let player_found = false;
				for (const team of match.setup.teams) {
					for (const player of team.players) {
						if (player.btp_id == msg.player_id) {
							if (msg.checked_in && player.now_tablet_on_court) {
								return reject(new Error('Player is currently assigned as tablet operator and cannot be checked in'));
							}
							if (msg.checked_in) {
								const waiting_as_tabletoperator = await is_player_waiting_as_tabletoperator(app, msg.tournament_key, msg.player_id);
								if (waiting_as_tabletoperator) {
									return reject(new Error('Player is waiting as tablet operator and cannot be checked in'));
								}
							}
							player.checked_in = msg.checked_in;
							player_found = true;
						}
					}
				}

				if (!player_found) {
					return reject(new Error('Player not found in match'));
				}

					match_utils.match_update(app, match, undefined, (err) => {
					if (err) {
						return reject(err);
					}
					debug_flags.log(app, msg.tournament_key, '[bts] auto_call_trace:player_check_in_updated', {
						ts: now_ms(app),
						tournament_key: msg.tournament_key,
						match_id: msg.match_id,
						player_id: msg.player_id,
						checked_in: !!msg.checked_in,
					});
					trigger_auto_call_after_readiness_change(app, msg.tournament_key);
					resolve();
				});
			});
		});
	}))).then(() => ws.respond(msg)).catch((err) => ws.respond(msg, err));
}

function is_player_waiting_as_tabletoperator(app, tournament_key, player_id) {
	return new Promise((resolve, reject) => {
		app.db.tabletoperators.find({ tournament_key, court: null }, (err, tabletoperators) => {
			if (err) {
				return reject(err);
			}

			resolve((tabletoperators || []).some((entry) => {
				if (!entry || !Array.isArray(entry.tabletoperator)) {
					return false;
				}

				return entry.tabletoperator.some((operator) => operator && operator.btp_id == player_id);
			}));
		});
	});
}

function trigger_auto_call_after_readiness_change(app, tournament_key) {
	const match_utils = require('./match_utils');
	debug_flags.log(app, tournament_key, '[bts] auto_call_trace:readiness_trigger_start', {
		ts: now_ms(app),
		tournament_key,
	});
	match_utils.queue_auto_execute_preparation_selections(app, tournament_key, (selectionErr) => {
		if (selectionErr) {
			console.warn('[bts] failed to auto select preparation matches after readiness change', selectionErr && (selectionErr.stack || selectionErr.message || String(selectionErr)));
			return;
		}
		debug_flags.log(app, tournament_key, '[bts] auto_call_trace:readiness_trigger_after_preparation_selection', {
			ts: now_ms(app),
			tournament_key,
		});
		match_utils.auto_call_matches_on_free_courts(app, tournament_key, (callErr) => {
			if (callErr) {
				console.warn('[bts] failed to auto call matches on free courts after readiness change', callErr && (callErr.stack || callErr.message || String(callErr)));
				return;
			}
			debug_flags.log(app, tournament_key, '[bts] auto_call_trace:readiness_trigger_after_auto_call', {
				ts: now_ms(app),
				tournament_key,
			});
		});
	});
}

function handle_match_participant_check_in(app, ws, msg) {
	const match_utils = require('./match_utils');

	if (!_require_msg(ws, msg, ['tournament_key', 'match_id', 'role', 'checked_in'])) {
		return;
	}

	update_queue.instance().execute(update_queue.named('handle_match_participant_check_in', () => new Promise((resolve, reject) => {
		app.db.tournaments.findOne({ key: msg.tournament_key }, (tournament_err, tournament) => {
			if (tournament_err) {
				return reject(tournament_err);
			}
			app.db.matches.findOne({ tournament_key: msg.tournament_key, _id: msg.match_id }, async (err, match) => {
				if (err) {
					return reject(err);
				}
				if (!match || !match.setup) {
					return reject(new Error('Match not found'));
				}

				let participant_found = false;
				const checked_in = !!msg.checked_in;

				if (msg.role === 'umpire' || msg.role === 'service_judge') {
					if (tournament?.btp_settings?.check_in_per_match === false) {
						return resolve();
					}
					const participant = match.setup[msg.role];
					if (participant && participant.btp_id == msg.participant_id) {
						participant.checked_in = checked_in;
						participant_found = true;
					}
				} else if (msg.role === 'tabletoperator' && Array.isArray(match.setup.tabletoperators)) {
					match.setup.tabletoperators.forEach((participant) => {
						if (participant.btp_id == msg.participant_id) {
							participant.checked_in = checked_in;
							participant_found = true;
						}
					});
				}

				if (!participant_found) {
					return reject(new Error('Participant not found in match'));
				}

				match_utils.match_update(app, match, undefined, (update_err) => {
					if (update_err) {
						return reject(update_err);
					}
					debug_flags.log(app, msg.tournament_key, '[bts] auto_call_trace:participant_check_in_updated', {
						ts: now_ms(app),
						tournament_key: msg.tournament_key,
						match_id: msg.match_id,
						role: msg.role,
						participant_id: msg.participant_id,
						checked_in,
					});
					if ((msg.role === 'umpire' || msg.role === 'service_judge') && tournament?.btp_settings?.check_in_per_match !== false) {
						const participant = match.setup[msg.role];
						if (!participant) {
							trigger_auto_call_after_readiness_change(app, msg.tournament_key);
							return resolve();
						}
						const official_query = participant._id
							? { tournament_key: msg.tournament_key, _id: participant._id }
							: { tournament_key: msg.tournament_key, btp_id: msg.participant_id };
						return app.db.umpires.update(
							official_query,
							{ $set: { checked_in } },
							{ returnUpdatedDocs: true },
							(official_err, numAffected, updated_official) => {
								if (official_err) {
									return reject(official_err);
								}
								if (numAffected > 0 && updated_official) {
									notify_change(app, msg.tournament_key, 'umpire_updated', updated_official);
								}
								trigger_auto_call_after_readiness_change(app, msg.tournament_key);
								resolve();
							}
						);
					}
					trigger_auto_call_after_readiness_change(app, msg.tournament_key);
					resolve();
				});
			});
		});
	}))).then(() => ws.respond(msg)).catch((err) => ws.respond(msg, err));
}


function handle_begin_to_play_call(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'begin_to_play_call', {setup});
	
	ws.respond(msg);
}

function handle_announce_match_manually(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'match'])) {
		return;
	}
	notify_change(app, msg.tournament_key, 'match_called_on_court', msg.match);
	ws.respond(msg);
}


function handle_free_announce(app, ws, msg) {
	if (!_require_msg(ws, msg, ['text'])) {
		return;
	}
	const tournament_key = msg.tournament_key;
	const text = msg.text;
	const announcement_claim_key = typeof msg.announcement_claim_key === 'string'
		? msg.announcement_claim_key.trim().slice(0, 160)
		: '';

	notify_change(app, tournament_key, 'free_announce', {
		text,
		...(announcement_claim_key ? {_announcement_claim_key: announcement_claim_key} : {}),
	});

	ws.respond(msg);
}

function handle_emergency_announce(app, ws, msg) {

	if (!_require_msg(ws, msg, ['tournament_key', 'enable'])) {
		return;
	}
	const tournament_key = msg.tournament_key;
	const enable = msg.enable;

	notify_change(app, tournament_key, 'emergency_announce', enable);

	ws.respond(msg);
}

function handle_second_call_tabletoperator(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_call_tabletoperator', {setup});
	
	ws.respond(msg);
}

function handle_second_preparation_call_tabletoperator(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_preparation_call_tabletoperator', {setup});
	
	ws.respond(msg);
}

function handle_second_call_umpire(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_call_umpire', { setup });

	ws.respond(msg);
}

function handle_second_preparation_call_umpire(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_preparation_call_umpire', { setup });

	ws.respond(msg);
}

function handle_second_call_servicejudge(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_call_servicejudge', { setup });

	ws.respond(msg);
}

function handle_second_preparation_call_servicejudge(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_preparation_call_servicejudge', { setup });

	ws.respond(msg);
}


function handle_second_call_team_one(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_call_team_one', {setup});
	
	ws.respond(msg);
}


function handle_second_preparation_call_team_one(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_preparation_call_team_one', {setup});
	
	ws.respond(msg);
}

function handle_official_list_move(app, ws, msg) {
  const match_utils = require('./match_utils');
  if (!_require_msg(ws, msg, [
    'tournament_key',
    'official_id',
    'from_list',
    'to_list'
  ])) {
    return;
  }

  const {
    tournament_key,
    official_id,
    prev_btp_id,
    next_btp_id,
    prev_official_id,
    next_official_id,
    ordered_official_ids,
    from_list,
    to_list
  } = msg;

  app.db.tournaments.findOne({ key: tournament_key }, function (tournament_err, tournament) {
    if (tournament_err) return cerror.ws(ws, tournament_err);
    if (!tournament) return cerror.ws(ws, new Error('tournament not found'));

    if (Array.isArray(ordered_official_ids) && ordered_official_ids.length > 0) {
      const unique_ordered_ids = [...new Set(ordered_official_ids.filter(Boolean))];
      if (!unique_ordered_ids.includes(official_id)) {
        unique_ordered_ids.push(official_id);
      }
      return app.db.umpires.find({
        tournament_key,
        _id: { $in: unique_ordered_ids }
      }, function(err, docs) {
      if (err) return cerror.ws(ws, err);
      const currentUmpire = docs.find((u) => u._id === official_id);
      if (!currentUmpire) {
        return cerror.ws(ws, new Error('current umpire not found'));
      }

      const now = now_ms(app);
      const updates = unique_ordered_ids.map((id, index) => {
        const setObj = {};
        if (id === official_id) {
          setObj[from_list] = null;
          setObj['inactive_list'] = null;
          setObj['service_judge_pause'] = null;
          setObj['umpire_pause'] = null;
          setObj['service_judge_manual_pause'] = null;
          setObj['umpire_manual_pause'] = null;
          setObj['service_judge_wait'] = null;
          setObj['umpire_wait'] = null;
          setObj['service_judge_on_court'] = null;
          setObj['umpire_on_court'] = null;
          setObj['is_planed_as_service_judge'] = false;
          setObj['is_planed_as_umpire'] = false;
        }
        setObj[_official_list_target_field(to_list)] = _official_list_target_ts(to_list, now + index, tournament);
        const updated_official = { ...(docs.find((u) => u._id === id) || {}), ...setObj };
        setObj.checked_in = match_utils.get_effective_technical_official_checked_in(updated_official, tournament);
        return { _id: id, setObj };
      });

      return async.eachSeries(updates, function(entry, next) {
        app.db.umpires.update(
          { _id: entry._id, tournament_key },
          { $set: entry.setObj },
          {},
          next
        );
      }, function(err2) {
        if (err2) return cerror.ws(ws, err2);
        app.db.umpires.find(
          { tournament_key, _id: { $in: unique_ordered_ids } },
          function(err3, updatedOfficials) {
            if (err3) return cerror.ws(ws, err3);
            app.db.umpires.find({ tournament_key }, function(err4, all_umpires) {
              if (err4) return cerror.ws(ws, err4);
              updatedOfficials.forEach((updated) => {
                notify_change(app, tournament_key, 'umpire_updated', updated);
              });
              notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
              notify_change(app, tournament_key, 'official_list_move', {
                official_id,
                from_list,
                to_list,
                new_ts: _official_list_target_ts(to_list, now + unique_ordered_ids.indexOf(official_id), tournament),
              });
              ws.respond(msg);
            });
          }
        );
      });
      });
    }

    // btp_id sicher normalisieren
    const prevId = (prev_btp_id == null) ? null : Number(prev_btp_id);
    const nextId = (next_btp_id == null) ? null : Number(next_btp_id);

    const neighborOfficialIds = [];
    if (prev_official_id) neighborOfficialIds.push(prev_official_id);
    if (next_official_id) neighborOfficialIds.push(next_official_id);

    const neighborBtpIds = [];
    if (Number.isFinite(prevId)) neighborBtpIds.push(prevId);
    if (Number.isFinite(nextId)) neighborBtpIds.push(nextId);

    // Query: current über _id, prev/next primär über _id, fallback über btp_id
    const query = {
      tournament_key,
      $or: [{ _id: official_id }]
    };
    if (neighborOfficialIds.length > 0) {
      query.$or.push({ _id: { $in: neighborOfficialIds } });
    }
    if (neighborBtpIds.length > 0) {
      query.$or.push({ btp_id: { $in: neighborBtpIds } });
    }

    app.db.umpires.find(query, function (err, docs) {
    if (err) return cerror.ws(ws, err);

    let currentUmpire = null;
    let prevUmpire = null;
    let nextUmpire = null;

    for (const u of docs) {
      if (u._id === official_id) {
        currentUmpire = u;
        continue;
      }
      if (prev_official_id && u._id === prev_official_id) {
        prevUmpire = u;
        continue;
      }
      if (next_official_id && u._id === next_official_id) {
        nextUmpire = u;
        continue;
      }
      if (Number.isFinite(prevId) && Number(u.btp_id) === prevId) {
        prevUmpire = u;
        continue;
      }
      if (Number.isFinite(nextId) && Number(u.btp_id) === nextId) {
        nextUmpire = u;
      }
    }

    if (!currentUmpire) {
      return cerror.ws(ws, new Error('current umpire not found'));
    }

    // --- Timestamp für to_list berechnen gemäß deiner Regeln (robust gegen null) ---
    const now = now_ms(app);

    const prevTS = (prevUmpire && prevUmpire[to_list] != null) ? Number(prevUmpire[to_list]) : null;
    const nextTS = (nextUmpire && nextUmpire[to_list] != null) ? Number(nextUmpire[to_list]) : null;

    const prevOk = (prevTS != null) && Number.isFinite(prevTS);
    const nextOk = (nextTS != null) && Number.isFinite(nextTS);

    let newTS;

    // Ende der Liste: wenn es keinen Nachfolger gibt -> aktueller Timestamp
    if (!nextUmpire || !nextOk) {
      newTS = now;

    // Anfang der Liste: kein Vorgänger, aber Nachfolger -> zwischen 0 und next
    } else if (!prevUmpire || !prevOk) {
      newTS = nextTS / 2;

    // Zwischen zwei Elementen -> Mittelwert
    } else {
      newTS = (prevTS + nextTS) / 2;
    }
    newTS = _official_list_target_ts(to_list, newTS, tournament);

    // --- Update vorbereiten ---
    // Spezifikation:
    // - currentUmpire[from_list] = null
    // - currentUmpire[to_list] = newTS
	    const setObj = {};
		
		    setObj[from_list] = null;
		    setObj['inactive_list'] = null;
		    setObj['service_judge_pause'] = null;
		    setObj['umpire_pause'] = null;
		    setObj['service_judge_manual_pause'] = null;
		    setObj['umpire_manual_pause'] = null;
		    setObj['service_judge_wait'] = null;
		    setObj['umpire_wait'] = null;
		    setObj['service_judge_on_court'] = null;
		    setObj['umpire_on_court'] = null;
		    setObj['is_planed_as_service_judge'] = false;
		    setObj['is_planed_as_umpire'] = false;
    setObj[_official_list_target_field(to_list)] = newTS;
    setObj.checked_in = match_utils.get_effective_technical_official_checked_in({ ...currentUmpire, ...setObj }, tournament);

    app.db.umpires.update(
      { _id: currentUmpire._id, tournament_key },
      { $set: setObj },
      {},
      function (err2) {
        if (err2) return cerror.ws(ws, err2);

        // Optional: aktualisiertes Objekt laden (für Broadcast/Clients)
        app.db.umpires.findOne(
          { _id: currentUmpire._id, tournament_key },
          function (err3, updated) {
            if (err3) return cerror.ws(ws, err3);

            notify_change(app, tournament_key, 'official_list_move', {
              official_id: currentUmpire._id,
              from_list,
              to_list,
              new_ts: newTS,
            });
            notify_change(app, tournament_key, 'umpire_updated', updated);

			ws.respond(msg);	
          }
        );
      }
    );
    });
  });
}

function handle_official_edit(app, ws, msg) {
  // Pflichtfelder prüfen
  if (!_require_msg(ws, msg, ['tournament_key', 'official_id', 'field', 'value'])) {
    return;
  }

  const { tournament_key, official_id, field, value } = msg;

  // Nur diese Felder dürfen vom Client geändert werden
  if (field !== 'is_umpire' && field !== 'is_service_judge') {
    return ws.respond(
      msg,
      new Error('Field not allowed for official_edit: ' + field)
    );
  }

  // Checkbox-Wert normalisieren
  const newVal = !!value;

  // Offiziellen suchen
  app.db.umpires.findOne(
    { _id: official_id, tournament_key },
    function (err, umpire) {
      if (err) {
        return ws.respond(msg, err);
      }

      if (!umpire) {
        return ws.respond(
          msg,
          new Error(
            'Cannot find official ' +
              official_id +
              ' of tournament ' +
              tournament_key +
              ' in database'
          )
        );
      }

      // Update vorbereiten
      const setObj = {};
      setObj[field] = newVal;
      setObj.updated_at = now_ms(app); // optional

      // DB-Update
      app.db.umpires.update(
        { _id: official_id, tournament_key },
        { $set: setObj },
        {},
        function (err2) {
          if (err2) {
            return ws.respond(msg, err2);
          }

          // Aktualisiertes Dokument laden (für Broadcast)
          app.db.umpires.findOne(
            { _id: official_id, tournament_key },
            function (err3, updated) {
              if (err3) {
                return ws.respond(msg, err3);
              }

              // Broadcast an alle Clients
              notify_change(app, tournament_key, 'official_edit', {
                official_id,
                field,
                value: newVal
              });

              ws.respond(msg);
            }
          );
        }
      );
    }
  );
}

function handle_official_roles_edit(app, ws, msg) {
  if (!_require_msg(ws, msg, ['tournament_key', 'official_id', 'is_umpire', 'is_service_judge'])) {
    return;
  }

  const { tournament_key, official_id } = msg;
  const setObj = {
    is_umpire: !!msg.is_umpire,
    is_service_judge: !!msg.is_service_judge,
    updated_at: now_ms(app)
  };

  app.db.umpires.findOne({ _id: official_id, tournament_key }, function (err, umpire) {
    if (err) {
      return ws.respond(msg, err);
    }
    if (!umpire) {
      return ws.respond(
        msg,
        new Error(
          'Cannot find official ' +
            official_id +
            ' of tournament ' +
            tournament_key +
            ' in database'
        )
      );
    }

    app.db.umpires.update(
      { _id: official_id, tournament_key },
      { $set: setObj },
      {},
      function (err2) {
        if (err2) {
          return ws.respond(msg, err2);
        }

        app.db.umpires.findOne(
          { _id: official_id, tournament_key },
          function (err3, updated) {
            if (err3) {
              return ws.respond(msg, err3);
            }

            notify_change(app, tournament_key, 'umpire_updated', updated);
            ws.respond(msg);
          }
        );
      }
    );
  });
}

function _assign_next_umpire_to_match(app, tournament_key, match_id, options = {}) {
  const skip_btp_push = options && options.skip_btp_push === true;
  return new Promise((resolve, reject) => {
    app.db.tournaments.findOne({ key: tournament_key }, function (tournament_err, tournament) {
      if (tournament_err) return reject(tournament_err);
    app.db.matches.findOne({ _id: match_id, tournament_key }, function (err, match) {
      if (err) return reject(err);
      if (!match) {
        return reject(
          new Error('Cannot find match ' + match_id + ' of tournament ' + tournament_key + ' in database')
        );
      }

      if (match.setup?.umpire) {
        return reject(
          new Error('Match already has assigned umpire')
        );
      }

	  const setup = match.setup;
	  if (setup.court_id) {
		return app.db.courts.findOne({ tournament_key, _id: setup.court_id }, function(courtErr, court) {
			if (courtErr) return reject(courtErr);
			if (court && court.has_umpire === false) {
				return reject(new Error('Court has no space for an umpire'));
			}
			return continue_assign();
		});
	  }

	  return continue_assign();

	  function continue_assign() {

      app.db.umpires
        .find({ tournament_key, umpire_wait: { $ne: null } })
        .sort({ umpire_wait: 1 })
        .limit(1)
        .exec(function (err2, umps) {
          if (err2) return reject(err2);
          if (!umps || umps.length === 0) {
            return reject(new Error('No umpire available'));
          }

          const umpire = umps[0];

          app.db.umpires.update(
            { _id: umpire._id, tournament_key, umpire_wait: { $ne: null } },
            { $set: { umpire_wait: null,
					      service_judge_wait: null,
					      is_planed_as_umpire: true,
					      is_planed_as_service_judge: false } },
            {},
            function (err3, affected1) {
              if (err3) return reject(err3);
              if (affected1 === 0) {
                return reject(new Error('Umpire was already taken by another assignment'));
              }

              setup.umpire = _pack_official_for_match(umpire, options.tournament || tournament || null);

              app.db.matches.update(
                { _id: match_id, tournament_key, 'setup.umpire': { $exists: false } },
                { $set: { setup, btp_needsync: true } },
                {},
                function (err4, affectedMatch) {
                  if (err4 || affectedMatch === 0) {
                    app.db.umpires.update(
                      { _id: umpire._id, tournament_key },
                      { $set: { umpire_wait: umpire.is_umpire ? now_ms(app)/10 : null,
							    service_judge_wait: umpire.is_service_judge ? now_ms(app)/10 : null,
							    is_planed_as_umpire: false,
							    is_planed_as_service_judge: false
						   } }
                    );
                    return reject(err4 || new Error('Match changed during official assignment'));
                  }

                  app.db.matches.findOne(
                    { _id: match_id, tournament_key },
                    function (err5, updatedMatch) {
                      if (err5) return reject(err5);

                      notify_change(app, tournament_key, 'match_edit', {match__id: match_id, match: updatedMatch});
					  if (!skip_btp_push) {
					  	btp_manager.update_score(app, updatedMatch);
					  }

                      app.db.umpires.find(
                        { tournament_key, _id: umpire._id },
                        function (err6, updatedOfficials) {
                          if (err6) {
                            return reject(err6);
                          }
                          if (updatedOfficials) {
                            for (const u of updatedOfficials) {
                              notify_change(app, tournament_key, 'umpire_updated', u);
                            }
                          }
                          app.db.umpires.find({ tournament_key }, function (err7, all_umpires) {
                            if (err7) {
                              return reject(err7);
                            }
                            notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
                            resolve();
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
	  }
    });
    });
  });
}

function assign_next_umpire_to_match(app, tournament_key, match_id) {
  return update_queue.instance().execute(update_queue.named('handle_add_officials_to_match', () => _assign_next_umpire_to_match(app, tournament_key, match_id)));
}

function handle_add_officials_to_match(app, ws, msg) {
  if (!_require_msg(ws, msg, ['tournament_key', 'match_id'])) {
    return;
  }

  const { tournament_key, match_id } = msg;
  assign_next_umpire_to_match(app, tournament_key, match_id)
    .then(() => ws.respond(msg))
    .catch((err) => ws.respond(msg, err));
}

function _assign_next_service_judge_to_match(app, tournament_key, match_id, options = {}) {
  const skip_btp_push = options && options.skip_btp_push === true;
  return new Promise((resolve, reject) => {
    app.db.tournaments.findOne({ key: tournament_key }, function (tournament_err, tournament) {
      if (tournament_err) return reject(tournament_err);
    app.db.matches.findOne({ _id: match_id, tournament_key }, function (err, match) {
      if (err) return reject(err);
      if (!match) {
        return reject(
          new Error('Cannot find match ' + match_id + ' of tournament ' + tournament_key + ' in database')
        );
      }

      if (!match.setup?.umpire) {
        return reject(new Error('Match has no assigned umpire'));
      }
      if (match.setup?.service_judge) {
        return reject(new Error('Match already has assigned service judge'));
      }

      const setup = match.setup;
      if (setup.court_id) {
		return app.db.courts.findOne({ tournament_key, _id: setup.court_id }, function(courtErr, court) {
			if (courtErr) return reject(courtErr);
			if (court && court.has_service_judge === false) {
				return reject(new Error('Court has no space for a service judge'));
			}
			return continue_assign();
		});
      }

      return continue_assign();

      function continue_assign() {

      app.db.umpires
        .find({ tournament_key, service_judge_wait: { $ne: null } })
        .sort({ service_judge_wait: 1 })
        .limit(1)
        .exec(function (err2, sjs) {
          if (err2) return reject(err2);
          if (!sjs || sjs.length === 0) {
            return reject(new Error('No service judge available'));
          }

          const service_judge = sjs[0];

          app.db.umpires.update(
            { _id: service_judge._id, tournament_key, service_judge_wait: { $ne: null } },
            { $set: { service_judge_wait: null, umpire_wait: null, is_planed_as_service_judge: true, is_planed_as_umpire: false } },
            {},
            function (err3, affected) {
              if (err3) return reject(err3);
              if (affected === 0) {
                return reject(new Error('Service judge was already taken'));
              }

              setup.service_judge = _pack_official_for_match(service_judge, options.tournament || tournament || null);

              app.db.matches.update(
                { _id: match_id, tournament_key, 'setup.umpire': { $exists: true }, 'setup.service_judge': { $exists: false } },
                { $set: { setup, btp_needsync: true } },
                {},
                function (err4, affectedMatch) {
                  if (err4 || affectedMatch === 0) {
                    app.db.umpires.update(
                      { _id: service_judge._id, tournament_key },
                      { $set: {
						  service_judge_wait: service_judge.is_service_judge ? now_ms(app) / 10 : null,
						  umpire_wait: service_judge.is_umpire ? now_ms(app) / 10 : null,
						  is_planed_as_service_judge: false,
						  is_planed_as_umpire: false
					  } }
                    );
                    return reject(err4 || new Error('Match changed during service judge assignment'));
                  }

                  app.db.matches.findOne(
                    { _id: match_id, tournament_key },
                    function (err5, updatedMatch) {
                      if (err5) return reject(err5);

                      notify_change(app, tournament_key, 'match_edit', { match__id: match_id, match: updatedMatch });
                      if (!skip_btp_push) {
                      	btp_manager.update_score(app, updatedMatch);
                      }

                      app.db.umpires.findOne(
                        { tournament_key, _id: service_judge._id },
                        function (err6, updatedOfficial) {
                          if (err6) {
                            return reject(err6);
                          }
                          if (updatedOfficial) {
                            notify_change(app, tournament_key, 'umpire_updated', updatedOfficial);
                          }
                          app.db.umpires.find({ tournament_key }, function (err7, all_umpires) {
                            if (err7) {
                              return reject(err7);
                            }
                            notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
                            resolve();
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
	  }
    });
    });
  });
}

function assign_next_service_judge_to_match(app, tournament_key, match_id) {
  return update_queue.instance().execute(update_queue.named('handle_add_service_judge_to_match', () => _assign_next_service_judge_to_match(app, tournament_key, match_id)));
}

function handle_add_service_judge_to_match(app, ws, msg) {
  if (!_require_msg(ws, msg, ['tournament_key', 'match_id'])) {
    return;
  }

  const { tournament_key, match_id } = msg;
  assign_next_service_judge_to_match(app, tournament_key, match_id)
    .then(() => ws.respond(msg))
    .catch((err) => ws.respond(msg, err));
}

function _pack_official_for_match(u, tournament = null) {
  const match_utils = require('./match_utils');
  return {
    _id: u._id,
    btp_id: u.btp_id,
    name: u.name,
    firstname: u.firstname,
    surname: u.surname,
    country: u.country,
    is_umpire: !!u.is_umpire,
    is_service_judge: !!u.is_service_judge,
    umpire_wait: u.umpire_wait ?? null,
    service_judge_wait: u.service_judge_wait ?? null,
    checked_in: match_utils.get_effective_technical_official_checked_in(u, tournament)
  };
}

function handle_assign_official_to_preparation_match(app, ws, msg) {
  if (!_require_msg(ws, msg, ['tournament_key', 'official_id', 'match_id', 'role'])) {
    return;
  }

  const { tournament_key, official_id, match_id, role, source_match_id, source_type, source_role } = msg;
  if (role !== 'umpire' && role !== 'service_judge') {
    return cerror.ws(ws, new Error('Invalid role for assign_official_to_preparation_match: ' + role));
  }
  if (source_type != null && source_type !== 'preparation' && source_type !== 'assigned') {
    return cerror.ws(ws, new Error('Invalid source_type for assign_official_to_preparation_match: ' + source_type));
  }
  if (source_role != null && source_role !== 'umpire' && source_role !== 'service_judge') {
    return cerror.ws(ws, new Error('Invalid source_role for assign_official_to_preparation_match: ' + source_role));
  }

  const role_flag = role === 'umpire' ? 'is_planed_as_umpire' : 'is_planed_as_service_judge';

  update_queue.instance().execute(update_queue.named('handle_assign_official_to_preparation_match', () => new Promise((resolve, reject) => {
    app.db.tournaments.findOne({ key: tournament_key }, function (tournament_err, tournament) {
      if (tournament_err) return reject(tournament_err);
    app.db.matches.find({ tournament_key, _id: { $in: [...new Set([match_id, source_match_id].filter(Boolean))] } }, function (err, matches) {
      if (err) return reject(err);
      const match = matches.find((m) => m._id === match_id);
      if (!match) return reject(new Error('Cannot find match ' + match_id));
      if ((match.setup || {}).state !== 'preparation') {
        return reject(new Error('Match is not in preparation'));
      }
      const source_match = source_match_id ? matches.find((m) => m._id === source_match_id) : null;
      if (source_match_id && !source_match) {
        return reject(new Error('Cannot find source match ' + source_match_id));
      }
      const same_match_move = !!source_match && source_match._id === match_id;
      if (match.setup && match.setup[role] && (!same_match_move || source_role !== role || match.setup[role]._id !== official_id)) {
        return reject(new Error('Match already has assigned ' + role));
      }
      if (source_match) {
        const source_setup = source_match.setup || {};
        const source_official = source_setup[source_role];
        if (!source_official || source_official._id !== official_id) {
          return reject(new Error('Official is not assigned to the source match/role'));
        }
      }

      app.db.umpires.findOne({ _id: official_id, tournament_key }, function (err2, official) {
        if (err2) return reject(err2);
        if (!official) return reject(new Error('Cannot find official ' + official_id));

        const target_setup = structuredClone(match.setup || {});
        const source_setup = source_match ? structuredClone(source_match.setup || {}) : null;
        if (source_setup && source_role) {
          const current_btp_id = source_setup[source_role] && source_setup[source_role].btp_id != null ? source_setup[source_role].btp_id : null;
          delete source_setup[source_role];
          if (current_btp_id != null) {
            source_setup[source_role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id'] = current_btp_id;
          }
          if (same_match_move) {
            delete target_setup[source_role];
            if (current_btp_id != null) {
              target_setup[source_role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id'] = current_btp_id;
            }
          }
        }
        target_setup[role] = _pack_official_for_match(official, tournament || null);
        delete target_setup[role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id'];

	        const officialSetObj = {
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
          is_planed_as_umpire: false
        };
        officialSetObj[role_flag] = true;

        app.db.umpires.update(
          { _id: official_id, tournament_key },
          { $set: officialSetObj },
          {},
          function (err3) {
            if (err3) return reject(err3);

            const finish = () => {
              app.db.umpires.findOne({ _id: official_id, tournament_key }, function (err6, updatedOfficial) {
                if (err6) return reject(err6);
                const match_ids = [...new Set([match_id, source_match_id].filter(Boolean))];
                app.db.matches.find({ tournament_key, _id: { $in: match_ids } }, function (err7, updatedMatches) {
                  if (err7) return reject(err7);
                  updatedMatches.forEach((updatedMatch) => {
                    notify_change(app, tournament_key, 'match_edit', { match__id: updatedMatch._id, match: updatedMatch });
                    btp_manager.update_score(app, updatedMatch);
                  });
                  notify_change(app, tournament_key, 'umpire_updated', updatedOfficial);
                  resolve();
                });
              });
            };

            if (same_match_move) {
              const same_guard = { _id: match_id, tournament_key, [`setup.${source_role}._id`]: official_id };
              if (source_role !== role) {
                same_guard[`setup.${role}`] = { $exists: false };
              }
              app.db.matches.update(
                same_guard,
                { $set: { setup: target_setup, btp_needsync: true } },
                {},
                function (err4, affected) {
                  if (err4) return reject(err4);
                  if (!affected) return reject(new Error('Match changed during official reassignment'));
                  finish();
                }
              );
              return;
            }

            const update_source = (cb) => {
              if (!source_match) return cb();
              const source_guard = { _id: source_match_id, tournament_key, [`setup.${source_role}._id`]: official_id };
              app.db.matches.update(
                source_guard,
                { $set: { setup: source_setup, btp_needsync: true } },
                {},
                function (err4, affected) {
                  if (err4) return cb(err4);
                  if (!affected) return cb(new Error('Source match changed during official move'));
                  cb();
                }
              );
            };

            update_source(function (err4) {
              if (err4) return reject(err4);
              const guard = { _id: match_id, tournament_key };
              guard[`setup.${role}`] = { $exists: false };
              app.db.matches.update(
                guard,
                { $set: { setup: target_setup, btp_needsync: true } },
                {},
                function (err5, affected) {
                  if (err5) return reject(err5);
                  if (!affected) return reject(new Error('Match changed during official assignment'));
                  finish();
                }
              );
            });
          }
        );
      });
    });
    });
  }))).then(() => ws.respond(msg)).catch((err) => cerror.ws(ws, err));
}

function handle_assign_official_to_match(app, ws, msg) {
  if (!_require_msg(ws, msg, ['tournament_key', 'official_id', 'match_id', 'role'])) {
    return;
  }

  const { tournament_key, official_id, match_id, role, source_match_id, source_type, source_role } = msg;
  if (role !== 'umpire' && role !== 'service_judge') {
    return cerror.ws(ws, new Error('Invalid role for assign_official_to_match: ' + role));
  }
  if (source_type != null && source_type !== 'preparation' && source_type !== 'assigned') {
    return cerror.ws(ws, new Error('Invalid source_type for assign_official_to_match: ' + source_type));
  }
  if (source_role != null && source_role !== 'umpire' && source_role !== 'service_judge') {
    return cerror.ws(ws, new Error('Invalid source_role for assign_official_to_match: ' + source_role));
  }

  const role_flag = role === 'umpire' ? 'is_planed_as_umpire' : 'is_planed_as_service_judge';

  update_queue.instance().execute(update_queue.named('handle_assign_official_to_match', () => new Promise((resolve, reject) => {
    app.db.tournaments.findOne({ key: tournament_key }, function (tournament_err, tournament) {
      if (tournament_err) return reject(tournament_err);
    app.db.matches.find({ tournament_key, _id: { $in: [...new Set([match_id, source_match_id].filter(Boolean))] } }, function (err, matches) {
      if (err) return reject(err);
      const match = matches.find((m) => m._id === match_id);
      if (!match) return reject(new Error('Cannot find match ' + match_id));
      const state = (match.setup || {}).state;
      if (state === 'preparation' || ['oncourt', 'blocked', 'finished'].includes(state)) {
        return reject(new Error('Match cannot be assigned in state ' + state));
      }
      const source_match = source_match_id ? matches.find((m) => m._id === source_match_id) : null;
      if (source_match_id && !source_match) {
        return reject(new Error('Cannot find source match ' + source_match_id));
      }
      const same_match_move = !!source_match && source_match._id === match_id;
      if (match.setup && match.setup[role] && (!same_match_move || source_role !== role || match.setup[role]._id !== official_id)) {
        return reject(new Error('Match already has assigned ' + role));
      }
      if (source_match) {
        const source_setup = source_match.setup || {};
        const source_official = source_setup[source_role];
        if (!source_official || source_official._id !== official_id) {
          return reject(new Error('Official is not assigned to the source match/role'));
        }
      }

      app.db.umpires.findOne({ _id: official_id, tournament_key }, function (err2, official) {
        if (err2) return reject(err2);
        if (!official) return reject(new Error('Cannot find official ' + official_id));

        const target_setup = structuredClone(match.setup || {});
        const source_setup = source_match ? structuredClone(source_match.setup || {}) : null;
        if (source_setup && source_role) {
          const current_btp_id = source_setup[source_role] && source_setup[source_role].btp_id != null ? source_setup[source_role].btp_id : null;
          delete source_setup[source_role];
          if (current_btp_id != null) {
            source_setup[source_role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id'] = current_btp_id;
          }
          if (same_match_move) {
            delete target_setup[source_role];
            if (current_btp_id != null) {
              target_setup[source_role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id'] = current_btp_id;
            }
          }
        }
        target_setup[role] = _pack_official_for_match(official, tournament || null);
        delete target_setup[role === 'umpire' ? 'suppressed_umpire_btp_id' : 'suppressed_service_judge_btp_id'];

	        const officialSetObj = {
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
          is_planed_as_umpire: false
        };
        officialSetObj[role_flag] = true;

        app.db.umpires.update(
          { _id: official_id, tournament_key },
          { $set: officialSetObj },
          {},
          function (err3) {
            if (err3) return reject(err3);

            const finish = () => {
              app.db.umpires.findOne({ _id: official_id, tournament_key }, function (err6, updatedOfficial) {
                if (err6) return reject(err6);
                const match_ids = [...new Set([match_id, source_match_id].filter(Boolean))];
                app.db.matches.find({ tournament_key, _id: { $in: match_ids } }, function (err7, updatedMatches) {
                  if (err7) return reject(err7);
                  updatedMatches.forEach((updatedMatch) => {
                    notify_change(app, tournament_key, 'match_edit', { match__id: updatedMatch._id, match: updatedMatch });
                    btp_manager.update_score(app, updatedMatch);
                  });
                  notify_change(app, tournament_key, 'umpire_updated', updatedOfficial);
                  resolve();
                });
              });
            };

            if (same_match_move) {
              const same_guard = { _id: match_id, tournament_key, [`setup.${source_role}._id`]: official_id };
              if (source_role !== role) {
                same_guard[`setup.${role}`] = { $exists: false };
              }
              app.db.matches.update(
                same_guard,
                { $set: { setup: target_setup, btp_needsync: true } },
                {},
                function (err4, affected) {
                  if (err4) return reject(err4);
                  if (!affected) return reject(new Error('Match changed during official reassignment'));
                  finish();
                }
              );
              return;
            }

            const update_source = (cb) => {
              if (!source_match) return cb();
              const source_guard = { _id: source_match_id, tournament_key, [`setup.${source_role}._id`]: official_id };
              app.db.matches.update(
                source_guard,
                { $set: { setup: source_setup, btp_needsync: true } },
                {},
                function (err4, affected) {
                  if (err4) return cb(err4);
                  if (!affected) return cb(new Error('Source match changed during official move'));
                  cb();
                }
              );
            };

            update_source(function (err4) {
              if (err4) return reject(err4);
              const guard = { _id: match_id, tournament_key };
              guard[`setup.${role}`] = { $exists: false };
              app.db.matches.update(
                guard,
                { $set: { setup: target_setup, btp_needsync: true } },
                {},
                function (err5, affected) {
                  if (err5) return reject(err5);
                  if (!affected) return reject(new Error('Match changed during official assignment'));
                  finish();
                }
              );
            });
          }
        );
      });
    });
    });
  }))).then(() => ws.respond(msg)).catch((err) => cerror.ws(ws, err));
}

function handle_remove_official_from_preparation_match(app, ws, msg) {
  if (!_require_msg(ws, msg, ['tournament_key', 'official_id', 'match_id', 'role', 'to_list'])) {
    return;
  }

  const { tournament_key, official_id, match_id, role, to_list, ordered_official_ids } = msg;
  if (role !== 'umpire' && role !== 'service_judge') {
    return cerror.ws(ws, new Error('Invalid role for remove_official_from_preparation_match: ' + role));
  }

  update_queue.instance().execute(update_queue.named('handle_remove_official_from_preparation_match', () => new Promise((resolve, reject) => {
    app.db.matches.findOne({ _id: match_id, tournament_key }, function (err, match) {
      if (err) return reject(err);
      if (!match) return reject(new Error('Cannot find match ' + match_id));
      const currentOfficial = match.setup && match.setup[role];
      if (!currentOfficial || currentOfficial._id !== official_id) {
        return reject(new Error('Official is not assigned to this preparation role'));
      }

      app.db.umpires.findOne({ _id: official_id, tournament_key }, function (err2, official) {
        if (err2) return reject(err2);
        if (!official) return reject(new Error('Cannot find official ' + official_id));

        const setup = structuredClone(match.setup || {});
        const dependent_releases = _remove_official_from_setup(setup, role);

	        const baseSetObj = {
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
          is_planed_as_umpire: false
        };

        app.db.matches.update(
          { _id: match_id, tournament_key, [`setup.${role}._id`]: official_id },
          { $set: { setup, btp_needsync: true } },
          {},
          function (err3, affected) {
            if (err3) return reject(err3);
            if (!affected) return reject(new Error('Match changed during official removal'));

            const applyOfficialUpdates = (cb) => {
              if (Array.isArray(ordered_official_ids) && ordered_official_ids.length > 0) {
                const unique_ordered_ids = [...new Set(ordered_official_ids.filter(Boolean))];
                if (!unique_ordered_ids.includes(official_id)) {
                  unique_ordered_ids.push(official_id);
                }
                const now = now_ms(app);
                return async.eachSeries(unique_ordered_ids, (id, next) => {
                  const setObj = (id === official_id) ? { ...baseSetObj } : {};
                  setObj[_official_list_target_field(to_list)] = _official_list_target_ts(to_list, now + unique_ordered_ids.indexOf(id), null);
                  app.db.umpires.update(
                    { _id: id, tournament_key },
                    { $set: setObj },
                    {},
                    next
                  );
                }, function(series_err) {
                  if (series_err) return cb(series_err);
                  _apply_wait_releases(app, tournament_key, dependent_releases, now + unique_ordered_ids.length, cb);
                });
              }
              const setObj = { ...baseSetObj };
              const now = now_ms(app);
              setObj[_official_list_target_field(to_list)] = _official_list_target_ts(to_list, now, null);
              app.db.umpires.update(
                { _id: official_id, tournament_key },
                { $set: setObj },
                {},
                function(update_err) {
                  if (update_err) return cb(update_err);
                  _apply_wait_releases(app, tournament_key, dependent_releases, now + 1, cb);
                }
              );
            };

            applyOfficialUpdates(function (err4) {
              if (err4) return reject(err4);

              app.db.matches.findOne({ _id: match_id, tournament_key }, function (err5, updatedMatch) {
                if (err5) return reject(err5);
                const affected_official_ids = [...new Set(
                  (Array.isArray(ordered_official_ids) ? ordered_official_ids.filter(Boolean) : [])
                    .concat([official_id], dependent_releases.map((release) => release.official_id))
                )];
                const officialQuery = { tournament_key, _id: { $in: affected_official_ids } };
                app.db.umpires.find(officialQuery, function (err6, updatedOfficials) {
                  if (err6) return reject(err6);
                  app.db.umpires.find({ tournament_key }, function (err7, all_umpires) {
                    if (err7) return reject(err7);
                    notify_change(app, tournament_key, 'match_edit', { match__id: match_id, match: updatedMatch });
                    btp_manager.update_score(app, updatedMatch);
                    (updatedOfficials || []).forEach((updatedOfficial) => {
                      notify_change(app, tournament_key, 'umpire_updated', updatedOfficial);
                    });
                    notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
                    resolve();
                  });
                });
              });
            });
          }
        );
      });
    });
  }))).then(() => ws.respond(msg)).catch((err) => cerror.ws(ws, err));
}

function handle_remove_official_from_match(app, ws, msg) {
  if (!_require_msg(ws, msg, ['tournament_key', 'official_id', 'match_id', 'role', 'to_list'])) {
    return;
  }

  const { tournament_key, official_id, match_id, role, to_list, ordered_official_ids } = msg;
  if (role !== 'umpire' && role !== 'service_judge') {
    return cerror.ws(ws, new Error('Invalid role for remove_official_from_match: ' + role));
  }

  update_queue.instance().execute(update_queue.named('handle_remove_official_from_match', () => new Promise((resolve, reject) => {
    app.db.matches.findOne({ _id: match_id, tournament_key }, function (err, match) {
      if (err) return reject(err);
      if (!match) return reject(new Error('Cannot find match ' + match_id));
      const currentOfficial = match.setup && match.setup[role];
      if (!currentOfficial || currentOfficial._id !== official_id) {
        return reject(new Error('Official is not assigned to this role'));
      }

      app.db.umpires.findOne({ _id: official_id, tournament_key }, function (err2, official) {
        if (err2) return reject(err2);
        if (!official) return reject(new Error('Cannot find official ' + official_id));

        const setup = structuredClone(match.setup || {});
        const dependent_releases = _remove_official_from_setup(setup, role);

	        const baseSetObj = {
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
          is_planed_as_umpire: false
        };

        app.db.matches.update(
          { _id: match_id, tournament_key, [`setup.${role}._id`]: official_id },
          { $set: { setup, btp_needsync: true } },
          {},
          function (err3, affected) {
            if (err3) return reject(err3);
            if (!affected) return reject(new Error('Match changed during official removal'));

            const applyOfficialUpdates = (cb) => {
              if (Array.isArray(ordered_official_ids) && ordered_official_ids.length > 0) {
                const unique_ordered_ids = [...new Set(ordered_official_ids.filter(Boolean))];
                if (!unique_ordered_ids.includes(official_id)) {
                  unique_ordered_ids.push(official_id);
                }
                const now = now_ms(app);
                return async.eachSeries(unique_ordered_ids, (id, next) => {
                  const setObj = (id === official_id) ? { ...baseSetObj } : {};
                  setObj[_official_list_target_field(to_list)] = _official_list_target_ts(to_list, now + unique_ordered_ids.indexOf(id), null);
                  app.db.umpires.update(
                    { _id: id, tournament_key },
                    { $set: setObj },
                    {},
                    next
                  );
                }, function(series_err) {
                  if (series_err) return cb(series_err);
                  _apply_wait_releases(app, tournament_key, dependent_releases, now + unique_ordered_ids.length, cb);
                });
              }
              const setObj = { ...baseSetObj };
              const now = now_ms(app);
              setObj[_official_list_target_field(to_list)] = _official_list_target_ts(to_list, now, null);
              app.db.umpires.update(
                { _id: official_id, tournament_key },
                { $set: setObj },
                {},
                function(update_err) {
                  if (update_err) return cb(update_err);
                  _apply_wait_releases(app, tournament_key, dependent_releases, now + 1, cb);
                }
              );
            };

            applyOfficialUpdates(function (err4) {
              if (err4) return reject(err4);

              app.db.matches.findOne({ _id: match_id, tournament_key }, function (err5, updatedMatch) {
                if (err5) return reject(err5);
                const affected_official_ids = [...new Set(
                  (Array.isArray(ordered_official_ids) ? ordered_official_ids.filter(Boolean) : [])
                    .concat([official_id], dependent_releases.map((release) => release.official_id))
                )];
                const officialQuery = { tournament_key, _id: { $in: affected_official_ids } };
                app.db.umpires.find(officialQuery, function (err6, updatedOfficials) {
                  if (err6) return reject(err6);
                  app.db.umpires.find({ tournament_key }, function (err7, all_umpires) {
                    if (err7) return reject(err7);
                    notify_change(app, tournament_key, 'match_edit', { match__id: match_id, match: updatedMatch });
                    btp_manager.update_score(app, updatedMatch);
                    (updatedOfficials || []).forEach((updatedOfficial) => {
                      notify_change(app, tournament_key, 'umpire_updated', updatedOfficial);
                    });
                    notify_change(app, tournament_key, 'umpires_changed', { all_umpires });
                    resolve();
                  });
                });
              });
            });
          }
        );
      });
    });
  }))).then(() => ws.respond(msg)).catch((err) => cerror.ws(ws, err));
}



function handle_display_delete(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'display_client_id'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const client_id = msg.display_client_id;

	const query_remove = {client_id: client_id};
	app.db.display_court_displaysettings.remove(query_remove, {}, (err) => {
		notify_change(app, tournament_key, 'delete_display', client_id);
	});

	ws.respond(msg);
}

function handle_display_reset(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'display_client_id'])) {
		return;
	}
	const tournament_key = msg.tournament_key;
	const client_id = msg.display_client_id;
	const bupws = require('./bupws');

	bupws.restart_panel(app, tournament_key, client_id);
	ws.respond(msg);
}

function handle_edit_display_setting(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'displaysetting'])) {
		return;
	}
	const displaysetting = msg.displaysetting;
	const tournament_key = msg.tournament_key;
	app.db.tournaments.findOne({ key: tournament_key }, async (tournamentErr, tournament) => {
		if (tournamentErr || !tournament) {
			return ws.respond(msg, tournamentErr || { message: 'Tournament not found' });
		}
		const required_modes = _get_default_displaysetting_requirements(tournament, displaysetting.id);
		if (required_modes.length > 0 && !required_modes.includes(displaysetting.devicemode)) {
			return ws.respond(msg, {
				message: `Default display setting ${displaysetting.id} must stay in mode ${required_modes.join(' or ')}`,
			});
		}

		const bupws = require('./bupws');
		const querry = {id : msg.displaysetting.id};
		app.db.displaysettings.update(querry, {$set: displaysetting}, {returnUpdatedDocs: true}, () => {});

		notify_change(app, msg.tournament_key, 'update_display_setting', {setting: displaysetting});

		app.db.display_court_displaysettings.find({}, function(err, all_displays) {
		if (err) {
			return ws.respond(msg, err);
		}

		const updated_displays = all_displays.filter(
			m => (m.displaysetting_id  == displaysetting.id)
		);

		updated_displays.forEach((display) => {
			bupws.change_display_mode(app, tournament_key, display.client_id, displaysetting.id);
		});

		ws.respond(msg);	
		});
	});
}

async function async_handle_delete_display_setting(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	const setting_id = msg.setting_id;
	const tournament = await app.db.tournaments.findOne_async({ key: tournament_key });
	if (tournament && (setting_id === tournament.displaysettings_general || setting_id === tournament.displaysettings_general_tablet)) {
		ws.respond(msg, {message: `Could not delete default displaysetting ${msg.setting_id}`});
		return;
	}
	const display = await app.db.display_court_displaysettings.findOne_async({displaysetting_id:setting_id});
	
	if(display) {
		ws.respond(msg, {message: `Could not delete displaysetting ${msg.setting_id} while in use`});
		return;
	}
	const query_remove = {id: setting_id};
	app.db.displaysettings.remove(query_remove, {}, (err) => {
		notify_change(app, tournament_key, 'delete_display_setting', setting_id);
	});
	
	ws.respond(msg);
}

function handle_create_display_setting(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'displaysetting'])) {
		return;
	}
	const tournament_key = msg.tournament_key;
	const displaysetting = msg.displaysetting;
	app.db.tournaments.findOne({ key: tournament_key }, async (tournamentErr, tournament) => {
		if (tournamentErr || !tournament) {
			return ws.respond(msg, tournamentErr || { message: 'Tournament not found' });
		}
		const required_modes = _get_default_displaysetting_requirements(tournament, displaysetting.id);
		if (required_modes.length > 0 && !required_modes.includes(displaysetting.devicemode)) {
			return ws.respond(msg, {
				message: `Default display setting ${displaysetting.id} must stay in mode ${required_modes.join(' or ')}`,
			});
		}
		app.db.displaysettings.findOne({ id: displaysetting.id }, (findErr, existingSetting) => {
			if (findErr) {
				return ws.respond(msg, findErr);
			}
			if (existingSetting) {
				return ws.respond(msg, { message: `Display setting ${displaysetting.id} already exists` });
			}
			app.db.displaysettings.insert(displaysetting, (insertErr, insertedSetting) => {
				if (insertErr) {
					return ws.respond(msg, insertErr);
				}
				notify_change(app, tournament_key, 'update_display_setting', { setting: insertedSetting });
				ws.respond(msg, null, { setting: insertedSetting });
			});
		});
	});
}


function handle_relocate_display(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	const client_id = msg.display_setting_id;
	const new_court_id = msg.new_court_id;
	const bupws = require('./bupws');
	bupws.restart_panel(app, tournament_key, client_id, new_court_id)
		.then(() => ws.respond(msg))
		.catch((err) => ws.respond(msg, err));
}

function handle_change_display_mode(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	const client_id = msg.display_setting_id;
	const new_displaysettings_id = msg.new_displaysettings_id;
	const bupws = require('./bupws');
	bupws.change_display_mode(app, tournament_key, client_id, new_displaysettings_id)
		.then(() => ws.respond(msg))
		.catch((err) => ws.respond(msg, err));
}


function handle_second_call_team_two(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_call_team_two', {setup});
	
	ws.respond(msg);
}


function handle_second_preparation_call_team_two(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'setup'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const setup = _extract_setup(msg.setup);

	notify_change(app, tournament_key, 'second_preparation_call_team_two', {setup});
	
	ws.respond(msg);
}


async function async_handle_match_delete(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'id'])) {
		return;
	}
	const tournament_key = msg.tournament_key;
	let num_removed;
	try {
		num_removed = await app.db.matches.remove_async({_id: msg.id, tournament_key}, {});
	} catch (err) {
		ws.respond(msg, err);
		return;
	}
	if (num_removed !== 1) {
		ws.respond(msg, new Error('Cannot find match ' + msg.id + ' of tournament ' + tournament_key + ' to remove in database'));
		return;
	}

	await app.db.courts.update_async({match_id: msg.id}, {$unset: {match_id: true}}, {});

	notify_change(app, tournament_key, 'match_delete', {match__id: msg.id});
	ws.respond(msg);
}

function handle_btp_fetch(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	btp_manager.fetch(msg.tournament_key);
	ws.respond(msg);
}

function handle_ticker_pushall(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	ticker_manager.pushall(app, msg.tournament_key);
	ws.respond(msg);
}

function handle_ticker_reset(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	ticker_manager.reset(app, msg.tournament_key);
	ws.respond(msg);
}

function _registration_player_status_payload(app, key, status, raw_payload) {
	const payload = raw_payload && typeof raw_payload === 'object' ? raw_payload : {};
	const player_index = Number(payload.player_index);
	const stage_type = Number(payload.stage_type);
	return {
		key,
		status,
		stage_entry_id: payload.stage_entry_id == null ? null : String(payload.stage_entry_id),
		entry_id: payload.entry_id == null ? null : String(payload.entry_id),
		entry_name: payload.entry_name == null ? '' : String(payload.entry_name),
		player_id: payload.player_id == null ? null : String(payload.player_id),
		player_index: Number.isFinite(player_index) ? player_index : null,
		player_name: payload.player_name == null ? '' : String(payload.player_name),
		event_name: payload.event_name == null ? '' : String(payload.event_name),
		stage_id: payload.stage_id == null ? null : String(payload.stage_id),
		stage_name: payload.stage_name == null ? '' : String(payload.stage_name),
		stage_type: Number.isFinite(stage_type) ? stage_type : null,
		club: payload.club == null ? '' : String(payload.club),
		state: payload.state == null ? '' : String(payload.state),
		partner: payload.partner == null ? '' : String(payload.partner),
		updated_at: now_iso(app),
	};
}

function handle_registration_player_status(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'key', 'status'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const key = String(msg.key || '').trim();
	const status = msg.status === null ? '' : String(msg.status || '');
	if (!key) {
		return ws.respond(msg, { message: 'Missing registration player status key' });
	}
	if (!/^[A-Za-z0-9:_-]+$/.test(key)) {
		return ws.respond(msg, { message: 'Invalid registration player status key ' + key });
	}
	if (!['', 'present', 'absent'].includes(status)) {
		return ws.respond(msg, { message: 'Unsupported registration player status ' + status });
	}

	const saved_status = status
		? _registration_player_status_payload(app, key, status, msg.registration_status)
		: null;
	const field = 'registration_player_statuses.' + key;
	const update = saved_status
		? { $set: { [field]: saved_status } }
		: { $unset: { [field]: true } };
	app.db.tournaments.update(
		{ key: tournament_key },
		update,
		{ returnUpdatedDocs: true },
		function(update_err, num) {
			if (update_err) {
				return ws.respond(msg, update_err);
			}
			if (num !== 1) {
				return ws.respond(msg, { message: 'No tournament ' + tournament_key });
			}
			notify_change(app, tournament_key, 'registration_player_status', { key, status: saved_status });
			return ws.respond(msg, null, { key, status: saved_status });
		}
	);
}

function handle_registration_player_status_reset(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	app.db.tournaments.update(
		{ key: tournament_key },
		{ $set: { registration_player_statuses: {} } },
		{ returnUpdatedDocs: true },
		function(update_err, num) {
			if (update_err) {
				return ws.respond(msg, update_err);
			}
			if (num !== 1) {
				return ws.respond(msg, { message: 'No tournament ' + tournament_key });
			}
			notify_change(app, tournament_key, 'registration_player_status_reset', {});
			return ws.respond(msg, null, {});
		}
	);
}

function _registration_validate_player_key(ws, msg, key) {
	if (!key) {
		ws.respond(msg, { message: 'Missing registration player key' });
		return false;
	}
	if (!/^[A-Za-z0-9:_-]+$/.test(key)) {
		ws.respond(msg, { message: 'Invalid registration player key ' + key });
		return false;
	}
	return true;
}

function _registration_player_comment_payload(app, key, comment, raw_payload) {
	const payload = raw_payload && typeof raw_payload === 'object' ? raw_payload : {};
	const player_index = Number(payload.player_index);
	const stage_type = Number(payload.stage_type);
	return {
		key,
		comment,
		read: false,
		read_at: null,
		stage_entry_id: payload.stage_entry_id == null ? null : String(payload.stage_entry_id),
		entry_id: payload.entry_id == null ? null : String(payload.entry_id),
		entry_name: payload.entry_name == null ? '' : String(payload.entry_name),
		player_id: payload.player_id == null ? null : String(payload.player_id),
		player_index: Number.isFinite(player_index) ? player_index : null,
		player_name: payload.player_name == null ? '' : String(payload.player_name),
		event_name: payload.event_name == null ? '' : String(payload.event_name),
		stage_id: payload.stage_id == null ? null : String(payload.stage_id),
		stage_name: payload.stage_name == null ? '' : String(payload.stage_name),
		stage_type: Number.isFinite(stage_type) ? stage_type : null,
		club: payload.club == null ? '' : String(payload.club),
		state: payload.state == null ? '' : String(payload.state),
		partner: payload.partner == null ? '' : String(payload.partner),
		updated_at: now_iso(app),
	};
}

function _registration_stage_comment_payload(app, key, comment, raw_payload) {
	const payload = raw_payload && typeof raw_payload === 'object' ? raw_payload : {};
	const stage_type = Number(payload.stage_type);
	return {
		key,
		comment,
		read: false,
		read_at: null,
		event_id: payload.event_id == null ? null : String(payload.event_id),
		event_name: payload.event_name == null ? '' : String(payload.event_name),
		stage_id: payload.stage_id == null ? null : String(payload.stage_id),
		stage_name: payload.stage_name == null ? '' : String(payload.stage_name),
		stage_type: Number.isFinite(stage_type) ? stage_type : null,
		stage_label: payload.stage_label == null ? '' : String(payload.stage_label),
		updated_at: now_iso(app),
	};
}

function _registration_comment_direction(direction) {
	if (direction === 'control_to_check' || direction === 'check_to_control') {
		return direction;
	}
	return null;
}

function _registration_comment_request(app, ws, msg, options) {
	if (!_require_msg(ws, msg, ['tournament_key', 'key', 'direction', 'comment'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const key = String(msg.key || '').trim();
	if (!options.validate_key(ws, msg, key)) {
		return;
	}
	const direction = _registration_comment_direction(msg.direction);
	if (!direction) {
		return ws.respond(msg, { message: 'Invalid registration ' + options.label + ' comment direction ' + msg.direction });
	}

	const comment = String(msg.comment || '').trim();
	if (comment.length > 2000) {
		return ws.respond(msg, { message: 'Registration ' + options.label + ' comment is too long' });
	}

	const saved_comment = comment
		? options.payload(app, key, comment, msg.registration_comment)
		: null;
	const field = options.field + '.' + key + '.' + direction;
	const update = saved_comment
		? { $set: { [field]: saved_comment } }
		: { $unset: { [field]: true } };
	app.db.tournaments.update(
		{ key: tournament_key },
		update,
		{ returnUpdatedDocs: true },
		function(update_err, num) {
			if (update_err) {
				return ws.respond(msg, update_err);
			}
			if (num !== 1) {
				return ws.respond(msg, { message: 'No tournament ' + tournament_key });
			}
			notify_change(app, tournament_key, options.change_type, { key, direction, comment: saved_comment });
			return ws.respond(msg, null, { key, direction, comment: saved_comment });
		}
	);
}

function handle_registration_player_comment(app, ws, msg) {
	return _registration_comment_request(app, ws, msg, {
		label: 'player',
		field: 'registration_player_comments',
		change_type: 'registration_player_comment',
		validate_key: _registration_validate_player_key,
		payload: _registration_player_comment_payload,
	});
}

function _registration_comment_read_request(app, ws, msg, options) {
	if (!_require_msg(ws, msg, ['tournament_key', 'key', 'direction'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const key = String(msg.key || '').trim();
	if (!options.validate_key(ws, msg, key)) {
		return;
	}
	const direction = _registration_comment_direction(msg.direction);
	if (!direction) {
		return ws.respond(msg, { message: 'Invalid registration ' + options.label + ' comment direction ' + msg.direction });
	}

	const read_at = now_iso(app);
	const field = options.field + '.' + key + '.' + direction;
	app.db.tournaments.update(
		{ key: tournament_key, [field]: { $exists: true } },
		{ $set: { [field + '.read']: true, [field + '.read_at']: read_at } },
		{ returnUpdatedDocs: true },
		function(update_err) {
			if (update_err) {
				return ws.respond(msg, update_err);
			}
			notify_change(app, tournament_key, options.change_type, { key, direction, read: true, read_at });
			return ws.respond(msg, null, { key, direction, read: true, read_at });
		}
	);
}

function handle_registration_player_comment_read(app, ws, msg) {
	return _registration_comment_read_request(app, ws, msg, {
		label: 'player',
		field: 'registration_player_comments',
		change_type: 'registration_player_comment_read',
		validate_key: _registration_validate_player_key,
	});
}

function _registration_validate_stage_key(ws, msg, key) {
	if (!key) {
		ws.respond(msg, { message: 'Missing registration stage key' });
		return false;
	}
	if (!/^[A-Za-z0-9:_-]+$/.test(key)) {
		ws.respond(msg, { message: 'Invalid registration stage key ' + key });
		return false;
	}
	return true;
}

function handle_registration_stage_comment(app, ws, msg) {
	return _registration_comment_request(app, ws, msg, {
		label: 'stage',
		field: 'registration_stage_comments',
		change_type: 'registration_stage_comment',
		validate_key: _registration_validate_stage_key,
		payload: _registration_stage_comment_payload,
	});
}

function handle_registration_stage_comment_read(app, ws, msg) {
	return _registration_comment_read_request(app, ws, msg, {
		label: 'stage',
		field: 'registration_stage_comments',
		change_type: 'registration_stage_comment_read',
		validate_key: _registration_validate_stage_key,
	});
}

function _registration_event_key_part(value) {
	return String(value == null ? '' : value)
		.trim()
		.replace(/[^A-Za-z0-9:_-]/g, '_')
		.slice(0, 120);
}

function _registration_current_event_open_map(tournament) {
	if (tournament.registration_open_events && typeof tournament.registration_open_events === 'object') {
		const open_events = {};
		for (const [key, value] of Object.entries(tournament.registration_open_events)) {
			if (value === true) {
				open_events[key] = true;
			}
		}
		return open_events;
	}

	return {};
}

function handle_registration_open_event(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'event_key', 'is_open'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	const event_key = String(msg.event_key || '').trim();
	if (!event_key) {
		return ws.respond(msg, { message: 'Missing registration event key' });
	}
	if (!/^[A-Za-z0-9:_-]+$/.test(event_key)) {
		return ws.respond(msg, { message: 'Invalid registration event key ' + event_key });
	}
	if (typeof msg.is_open !== 'boolean') {
		return ws.respond(msg, { message: 'registration_open_event requires boolean is_open' });
	}

	app.db.tournaments.findOne({ key: tournament_key }, function(find_err, tournament) {
		if (find_err || !tournament) {
			return ws.respond(msg, find_err || { message: 'No tournament ' + tournament_key });
		}
		const registration_open_events = _registration_current_event_open_map(tournament);
		if (msg.is_open) {
			registration_open_events[event_key] = true;
		} else {
			delete registration_open_events[event_key];
		}
		app.db.tournaments.update(
			{ key: tournament_key },
			{ $set: { registration_open_events } },
			{ returnUpdatedDocs: true },
			function(update_err, num) {
				if (update_err) {
					return ws.respond(msg, update_err);
				}
				if (num !== 1) {
					return ws.respond(msg, { message: 'No tournament ' + tournament_key });
				}
				const payload = { event_key, is_open: msg.is_open, open_events: registration_open_events };
				notify_change(app, tournament_key, 'registration_open_events', payload);
				return ws.respond(msg, null, payload);
			}
		);
	});
}

function _registration_xlsx_text(value) {
	if (value === null || value === undefined) {
		return '';
	}
	return String(value).trim();
}

function _registration_xlsx_norm(value) {
	return _registration_xlsx_text(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ß/g, 'ss')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function _registration_xlsx_number(value) {
	if (value === null || value === undefined || _registration_xlsx_text(value) === '') {
		return null;
	}
	const num = Number(String(value).replace(',', '.'));
	return Number.isFinite(num) && num !== 0 ? num : null;
}

function _registration_xlsx_date(value) {
	if (value === null || value === undefined || _registration_xlsx_text(value) === '') {
		return '';
	}
	if (value instanceof Date) {
		return value.getFullYear() + '-' + utils.pad(value.getMonth() + 1, 2, '0') + '-' + utils.pad(value.getDate(), 2, '0');
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		const epoch = Date.UTC(1899, 11, 30);
		const date = new Date(epoch + value * 24 * 60 * 60 * 1000);
		return date.getUTCFullYear() + '-' + utils.pad(date.getUTCMonth() + 1, 2, '0') + '-' + utils.pad(date.getUTCDate(), 2, '0');
	}
	const str = _registration_xlsx_text(value);
	const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(.*)$/.exec(str);
	if (m) {
		const date = m[3] + '-' + utils.pad(m[2], 2, '0') + '-' + utils.pad(m[1], 2, '0');
		const rest = m[4].trim();
		return rest ? date + ' ' + rest : date;
	}
	return str;
}

function _registration_xlsx_stage_label(stage) {
	const type = Number(stage?.stage_type);
	const name = _registration_xlsx_norm(stage?.name || stage?.stage_name);
	if (type === 1 || name.includes('hauptfeld') || name.includes('main')) return 'Hauptfeld';
	if (type === 9998 || name.includes('reserve')) return 'Reserve';
	if (type === 9999 || name.includes('aussch') || name.includes('exclud')) return 'Ausschließen';
	return stage?.name || stage?.stage_name || 'Liste';
}

function _registration_xlsx_player_key(entry, player, player_index) {
	const player_id = player?.btp_id != null ? player.btp_id : player_index;
	return String(entry?.stage_entry_id || entry?.entry_id || 'entry') + ':' + String(player_id);
}

function _registration_xlsx_sheet_parts(sheet_name, data) {
	const title = _registration_xlsx_text(data?.[1]?.[0]) || _registration_xlsx_text(sheet_name);
	const parts = title.split(/\s+-\s+/);
	if (parts.length >= 2) {
		return {
			event_name: parts.slice(0, -1).join(' - '),
			stage_name: parts[parts.length - 1],
		};
	}
	return {
		event_name: title,
		stage_name: '',
	};
}

function _registration_xlsx_header_map(row) {
	const aliases = {
		'nr': 'entry_order',
		'name': 'player_name',
		'geschlecht': 'gender',
		'geb': 'date_of_birth',
		'starke': 'strength',
		'leistungspunktzahl': 'performance_points',
		'ranglistenplatz': 'ranking_place',
		'punkte': 'points',
		'spielerid': 'member_id',
		'verein': 'club',
		'verband': 'association',
		'bundesland': 'state',
		'land': 'nationality',
		'datum': 'entered_at',
		'setzplatz': 'seed',
		'status': 'entry_status',
		'reihenfolge': 'display_order',
		'notiz': 'note',
		'entry info': 'entry_info',
		'verfugbarkeit': 'availability',
	};
	const map = {};
	row.forEach((label, index) => {
		const key = aliases[_registration_xlsx_norm(label)];
		if (key) {
			map[key] = index;
		}
	});
	return map;
}

function _registration_xlsx_parse(buffer) {
	const sheets = xlsx.parse(buffer);
	const rows = [];
	for (const sheet of sheets) {
		const data = sheet.data || [];
		const header_index = data.findIndex((row) => {
			const headers = row.map(_registration_xlsx_norm);
			return headers.includes('name') && headers.includes('ranglistenplatz') && headers.includes('punkte');
		});
		if (header_index === -1) {
			continue;
		}
		const sheet_parts = _registration_xlsx_sheet_parts(sheet.name, data);
		const header = _registration_xlsx_header_map(data[header_index]);
		for (const row of data.slice(header_index + 1)) {
			const player_name = _registration_xlsx_text(row[header.player_name]);
			if (!player_name) {
				continue;
			}
			rows.push({
				event_name: sheet_parts.event_name,
				stage_name: sheet_parts.stage_name,
				entry_order: _registration_xlsx_number(row[header.entry_order]),
				player_name,
				gender: _registration_xlsx_text(row[header.gender]),
				date_of_birth: _registration_xlsx_date(row[header.date_of_birth]),
				strength: _registration_xlsx_text(row[header.strength]),
				performance_points: _registration_xlsx_number(row[header.performance_points]),
				ranking_place: _registration_xlsx_number(row[header.ranking_place]),
				points: _registration_xlsx_number(row[header.points]),
				member_id: _registration_xlsx_text(row[header.member_id]),
				club: _registration_xlsx_text(row[header.club]),
				association: _registration_xlsx_text(row[header.association]),
				state: _registration_xlsx_text(row[header.state]),
				nationality: _registration_xlsx_text(row[header.nationality]),
				entered_at: _registration_xlsx_date(row[header.entered_at]),
				seed: _registration_xlsx_text(row[header.seed]),
				entry_status: _registration_xlsx_text(row[header.entry_status]),
				display_order: _registration_xlsx_text(row[header.display_order]),
				note: _registration_xlsx_text(row[header.note]),
				entry_info: _registration_xlsx_text(row[header.entry_info]),
				availability: _registration_xlsx_text(row[header.availability]),
			});
		}
	}
	return rows;
}

function _registration_xlsx_collect_candidates(tournament) {
	const candidates = [];
	for (const event of tournament.events?.events || []) {
		const event_norm = _registration_xlsx_norm(event.name);
		for (const stage of event.stages || []) {
			const stage_label = _registration_xlsx_stage_label(stage);
			const stage_norms = new Set([
				_registration_xlsx_norm(stage.name),
				_registration_xlsx_norm(stage.stage_name),
				_registration_xlsx_norm(stage_label),
			]);
			for (const entry of stage.entries || []) {
				for (const [player_index, player] of (entry?.team?.players || []).entries()) {
					candidates.push({
						key: _registration_xlsx_player_key(entry, player, player_index),
						event_norm,
						stage_norms,
						name_norm: _registration_xlsx_norm(player?.name || [player?.firstname, player?.lastname].filter(Boolean).join(' ')),
						date_of_birth: _registration_xlsx_text(player?.date_of_birth),
						club_norm: _registration_xlsx_norm(player?.club),
						member_id_norm: _registration_xlsx_norm(player?.member_id),
					});
				}
			}
		}
	}
	return candidates;
}

function _registration_xlsx_match_rows(tournament, rows) {
	const candidates = _registration_xlsx_collect_candidates(tournament);
	const by_registration_key = {};
	const unmatched = [];
	for (const row of rows) {
		const event_norm = _registration_xlsx_norm(row.event_name);
		const stage_norm = _registration_xlsx_norm(row.stage_name);
		const name_norm = _registration_xlsx_norm(row.player_name);
		const club_norm = _registration_xlsx_norm(row.club);
		const member_id_norm = _registration_xlsx_norm(row.member_id);
		const matching = candidates.filter((candidate) => {
			if (candidate.event_norm !== event_norm) return false;
			if (stage_norm && !candidate.stage_norms.has(stage_norm)) return false;
			if (member_id_norm && candidate.member_id_norm && candidate.member_id_norm === member_id_norm) return true;
			if (candidate.name_norm !== name_norm) return false;
			if (row.date_of_birth && candidate.date_of_birth && candidate.date_of_birth !== row.date_of_birth) return false;
			if (club_norm && candidate.club_norm && candidate.club_norm !== club_norm) return false;
			return true;
		});
		if (matching.length === 1) {
			by_registration_key[matching[0].key] = row;
		} else {
			unmatched.push({
				event_name: row.event_name,
				stage_name: row.stage_name,
				player_name: row.player_name,
				matches: matching.length,
			});
		}
	}
	return { by_registration_key, unmatched };
}

async function async_handle_registration_xlsx_upload(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'data_url', 'name'])) {
		return;
	}

	const tournament = await app.db.tournaments.findOne_async({ key: msg.tournament_key });
	if (!tournament) {
		return ws.respond(msg, { message: 'No tournament ' + msg.tournament_key });
	}

	const m = /^data:([^;,]+)?(?:;base64)?,([A-Za-z0-9+/=]+)$/.exec(msg.data_url);
	if (!m) {
		return ws.respond(msg, { message: 'Invalid XLSX data URL' });
	}
	const buffer = Buffer.from(m[2], 'base64');
	let rows;
	try {
		rows = _registration_xlsx_parse(buffer);
	} catch (err) {
		return ws.respond(msg, { message: 'Could not read XLSX file: ' + err.message });
	}
	const matched = _registration_xlsx_match_rows(tournament, rows);
	const metadata = {
		file_name: String(msg.name || ''),
		uploaded_at: now_iso(app),
		row_count: rows.length,
		matched_count: Object.keys(matched.by_registration_key).length,
		unmatched_count: matched.unmatched.length,
		unmatched: matched.unmatched.slice(0, 25),
		by_registration_key: matched.by_registration_key,
	};

	await app.db.tournaments.update_async(
		{ key: msg.tournament_key },
		{ $set: { registration_xlsx_metadata: metadata } },
		{ returnUpdatedDocs: true }
	);
	notify_change(app, msg.tournament_key, 'registration_xlsx_metadata', { metadata });
	return ws.respond(msg, null, { metadata });
}

const all_admins = [];
function _notify_queue_hang(payload) {
	for (const admin_ws of all_admins) {
		admin_ws.sendmsg({
			type: 'change',
			tournament_key: admin_ws.last_tournament_key || 'default',
			ctype: 'queue_hang_warning',
			val: payload,
		});
	}
}
function notify_change(app, tournament_key, ctype, val) {
	let payload = val;
	const announcement_change_types = new Set([
		'match_preparation_call',
		'match_called_on_court',
		'begin_to_play_call',
		'second_call_tabletoperator',
		'second_preparation_call_tabletoperator',
		'second_call_umpire',
		'second_preparation_call_umpire',
		'second_call_servicejudge',
		'second_preparation_call_servicejudge',
		'second_call_team_one',
		'second_preparation_call_team_one',
		'second_call_team_two',
		'second_preparation_call_team_two',
		'match_no_match_announcement',
		'free_announce',
	]);
	if (payload && typeof payload === 'object' && announcement_change_types.has(ctype) && payload._announcement_ts == null) {
		payload = {
			...payload,
			_announcement_ts: now_ms(app),
		};
	}
	if (ctype === 'match_preparation_call' && payload && typeof payload === 'object') {
		debug_flags.log(app, payload.match?.tournament_key || payload.match?.setup?.tournament_key || null, '[bts] debug:match_preparation_call_sent', {
			match_id: payload.match__id || payload.match?._id || null,
			announcement_ts: payload._announcement_ts || null,
			state: payload.match?.setup?.state || null,
			highlight: payload.match?.setup?.highlight || 0,
			location_id: payload.match?.setup?.location_id || null,
		});
	}
	if (ctype === 'score') {
		debug_flags.log(app, tournament_key, '[bts] debug:admin_notify_score', {
			tournament_key,
			admin_count: all_admins.length,
			match_id: payload?.match_id || null,
			court_id: payload?.court_id || null,
			score: payload?.network_score || null,
			now_on_court: payload?.now_on_court,
		});
	}
	for (const admin_ws of all_admins) {
		admin_ws.sendmsg({
			type: 'change',
			tournament_key,
			ctype,
			val: payload,
		});
	}
}

function handle_fetch_allscoresheets_data(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key'])) {
		return;
	}

	const tournament_key = msg.tournament_key;
	app.db.matches.find({
		tournament_key,
	}, function(err, all_matches) {
		if (err) {
			return ws.respond(msg, err);
		}
		const interesting_matches = all_matches.filter(
			m => (m.presses && (m.presses.length > 0))
		);

		return ws.respond(msg, null, {
			matches: interesting_matches,
		});
	});
}

function on_connect(app, ws) {
	all_admins.push(ws);
	update_queue.instance().set_hang_reporter(_notify_queue_hang);
}

function on_close(app, ws) {
	if (! utils.remove(all_admins, ws)) {
		serror.silent('Removing admin ws, but it was not connected!?');
	}
}

async function async_handle_tournament_upload_logo(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'data_url', 'name'])) {
		return;
	}

	const tournament = await app.db.tournaments.findOne_async({
		key: msg.tournament_key,
	});
	if (!tournament) {
		ws.respond(msg, {message: `Could not find tournament ${msg.tournament_key}`});
		return;
	}

	const m = /^data:(image\/[a-z+]+)(?:;base64)?,([A-Za-z0-9+/=]+)$/.exec(msg.data_url);
	if (!m) {
		ws.respond(msg, {message: `Invalid base64 URI, starts with ${msg.data_url.slice(0, 80)}`});
		return;
	}
	const mime_type = m[1];
	const logo_b64 = m[2];

	const ext = {
		'image/gif': 'gif',
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/svg+xml': 'svg',
		'image/webp': 'webp',
	}[mime_type];
	if (!ext) {
		ws.respond(msg, {message: `Unsupported mime type ${mime_type}`});
		return;
	}

	const buf = Buffer.from(logo_b64, 'base64');
	const logo_id = uuidv4() + '.' + ext;
	await promisify(fs.writeFile)(path.join(utils.root_dir(), 'data', 'logos', logo_id), buf);
	const logo_name = msg.name;

	const [_, updated_tournament] = await app.db.tournaments.update_async( // eslint-disable-line no-unused-vars
		{key: msg.tournament_key},
		{$set: {logo_id, logo_name}},
		{returnUpdatedDocs: true});
	notify_change(app, msg.tournament_key, 'logo_changed', {logo_id, logo_name});
	require('./bupws_v2').refresh_tournament(app, msg.tournament_key).catch((refresh_err) => {
		console.error('[bup v2] logo refresh failed', refresh_err);
	});

	return ws.respond(msg, null, {});
}

async function async_handle_tournament_upload_location_logo(app, ws, msg) {
	if (!_require_msg(ws, msg, ['tournament_key', 'data_url', 'name', 'location_id'])) {
		return;
	}

	const tournament = await app.db.tournaments.findOne_async({
		key: msg.tournament_key,
	});
	if (!tournament) {
		ws.respond(msg, {message: `Could not find tournament ${msg.tournament_key}`});
		return;
	}

	const m = /^data:(image\/[a-z+]+)(?:;base64)?,([A-Za-z0-9+/=]+)$/.exec(msg.data_url);
	if (!m) {
		ws.respond(msg, {message: `Invalid base64 URI, starts with ${msg.data_url.slice(0, 80)}`});
		return;
	}
	const mime_type = m[1];
	const logo_b64 = m[2];

	const ext = {
		'image/gif': 'gif',
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/svg+xml': 'svg',
		'image/webp': 'webp',
	}[mime_type];
	if (!ext) {
		ws.respond(msg, {message: `Unsupported mime type ${mime_type}`});
		return;
	}

	const buf = Buffer.from(logo_b64, 'base64');
	const logo_id = uuidv4() + '.' + ext;
	await promisify(fs.writeFile)(path.join(utils.root_dir(), 'data', 'logos', logo_id), buf);
	const logo_name = msg.name;
	const location_id = msg.location_id;
	const tournament_key = msg.tournament_key

	const [_, updated_tournament] = await app.db.locations.update_async( // eslint-disable-line no-unused-vars
		{tournament_key, _id: location_id},
		{$set: {logo_id, logo_name}},
		{returnUpdatedDocs: true});
	notify_change(app, msg.tournament_key, 'location_logo_changed', {location_id, logo_id, logo_name});

	return ws.respond(msg, null, {});
}

module.exports = {
	handle_edit_display_setting,
	handle_create_display_setting,
	async_handle_delete_display_setting,
	async_handle_match_delete,
	async_handle_tournament_upload_logo,
	async_handle_tournament_upload_location_logo,
	handle_begin_to_play_call,
	handle_certificate_export_mark,
	handle_certificate_export_reset,
	handle_announce_match_manually,
	handle_btp_fetch,
	handle_confirm_match_finished,
	handle_normalization_add,
	handle_normalization_remove,
	handle_advertisement_add,
	handle_advertisement_remove,
	handle_tabletoperator_add,
	handle_tabletoperator_move_up,
	handle_tabletoperator_move_down,
	handle_tabletoperator_remove,
	handle_fetch_allscoresheets_data,
	handle_clock_get,
	handle_clock_set,
	handle_create_tournament,
	handle_tournament_reset,
	handle_player_pause_reset,
	handle_courts_add,
	handle_court_edit,
	handle_location_changed,
	handle_match_add,
	handle_match_edit,
	handle_match_call_on_court,
	handle_match_preparation_call,
	async_handle_preparation_selection_get,
	async_handle_preparation_selection_execute,
	handle_match_player_check_in,
	handle_match_participant_check_in,
	handle_registration_player_status,
	handle_registration_player_status_reset,
	handle_registration_player_comment,
	handle_registration_player_comment_read,
	handle_registration_stage_comment,
	handle_registration_stage_comment_read,
	handle_registration_open_event,
	async_handle_registration_xlsx_upload,
	handle_ticker_pushall,
	handle_ticker_reset,
	handle_free_announce,
	handle_emergency_announce,
	handle_official_list_move,
	handle_official_edit,
	handle_official_roles_edit,
	handle_add_officials_to_match,
	handle_add_service_judge_to_match,
	assign_next_umpire_to_match,
	assign_next_service_judge_to_match,
	_assign_next_umpire_to_match,
	_assign_next_service_judge_to_match,
	handle_assign_official_to_match,
	handle_assign_official_to_preparation_match,
	handle_remove_official_from_match,
	handle_remove_official_from_preparation_match,
	handle_second_call_umpire,
	handle_second_preparation_call_umpire,
	handle_second_call_servicejudge,
	handle_second_preparation_call_servicejudge,
	handle_second_call_tabletoperator,
	handle_second_preparation_call_tabletoperator,
	handle_second_call_team_one,
	handle_second_call_team_two,
	handle_second_preparation_call_team_one,
	handle_second_preparation_call_team_two,
	handle_tournament_get,
	handle_tournament_list,
	handle_tournament_edit_prop,
	handle_tournament_edit_scoring_format,
	handle_tournament_edit_props,
	handle_tournament_edit_logo,
	handle_display_delete,
	handle_display_reset,
	handle_relocate_display,
	handle_change_display_mode,
	cascade_no_match_for_future_player_matches,
	clear_no_match_cascade_for_source_match,
	notify_cascaded_no_match_announcements,
	notify_change,
	generate_tournament_web_url,
	on_close,
	on_connect,
	_build_match_edit_official_sync_meta,
	_collect_dependent_official_releases,
	_remove_official_from_setup,
	reset_tournament_to_empty_default,
};
