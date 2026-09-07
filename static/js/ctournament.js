'use strict';

var curt; // current tournament
let current_view = null;
let scoring_formats_main = null;
let live_settings_status_el = null;
let live_settings_pending_requests = 0;
let self_check_in_chip_fit_cache = Object.create(null);
let self_check_in_layout_fit_cache = new Map();
let self_check_in_resize_frame = null;
let self_check_in_measure_probe = null;
let self_check_in_fit_scheduled = false;
let self_check_in_fit_roots = new Set();
let self_check_in_called_overlay_timeout = null;
let skip_next_official_list_move = null;
let official_drag_image_el = null;
let official_drag_active = false;
let official_drag_refresh_pending = false;
let pending_official_role_overrides = new Map();
let preparation_selection_request_inflight = false;
let preparation_selection_request_pending = false;
let tournament_refresh_after_missed_change_pending = false;
let btp_next_fetch_countdown_interval = null;
let speech_output_badge_listener_registered = false;
let test_clock_controls = null;
let test_clock_status_interval = null;
const ANNOUNCEMENT_SPEECH_CHECK_STATE_STORAGE_KEY = 'bts_announcement_speech_check_state';

var ctournament = (function() {
	function admin_live_debug(label, data) {
		if (curt && curt.bts_debug_output_enabled === true) {
			console.log('[bts admin live] ' + label, data);
		}
	}

	function _route_single(rex, func, handler) {
		if (!handler) {
			handler = change.default_handler(func);
		}

		crouting.register(rex, function (m) {
			switch_tournament(m[1], func);
		}, handler);
	}

	function switch_tournament(tournament_key, success_cb) {
		send({
			type: 'tournament_get',
			key: tournament_key,
		}, function (err, response) {
			if (err) {
				return cerror.net(err);
			}

			curt = response.tournament;
			preparation_selection_request_inflight = false;
			preparation_selection_request_pending = false;
			curt.location_preparation_selection_by_location_id = {};
			if (curt.language && curt.language !== 'auto') {
				ci18n.switch_language(curt.language);
			}
			success_cb();
		});
	}

	function request_tournament_refresh_after_missed_change(reason) {
		if (!curt || !curt.key || tournament_refresh_after_missed_change_pending) {
			return;
		}
		tournament_refresh_after_missed_change_pending = true;
		setTimeout(() => {
			const tournament_key = curt && curt.key;
			if (!tournament_key) {
				tournament_refresh_after_missed_change_pending = false;
				return;
			}
			send({
				type: 'tournament_get',
				key: tournament_key,
			}, function(err, response) {
				tournament_refresh_after_missed_change_pending = false;
				if (err) {
					return cerror.net(err);
				}
				if (!response || !response.tournament) {
					return;
				}
				curt = response.tournament;
				cerror.silent('Turnierdaten nach verpasster Live-Aktualisierung neu geladen: ' + reason);
				refresh_current_view();
			});
		}, 100);
	}

	function ui_create() {
		const main = uiu.qs('.main');

		uiu.empty(main);
		const form = uiu.el(main, 'form');
		uiu.el(form, 'h2', 'edit', ci18n('Create tournament'));
		const id_label = uiu.el(form, 'label', {}, ci18n('create:id:label'));
		const key_input = uiu.el(id_label, 'input', {
			type: 'text',
			name: 'key',
			autofocus: 'autofocus',
			required: 'required',
			pattern: '^[a-z0-9]+$',
		});
		uiu.el(form, 'button', {
			role: 'submit',
		}, ci18n('Create tournament'));
		key_input.focus();

		form_utils.onsubmit(form, function (data) {
			send({
				type: 'create_tournament',
				key: data.key,
			}, function (err) {
				if (err) return cerror.net(err);

				uiu.remove(form);
				switch_tournament(data.key, ui_show);
			});
		});
	}

	function ui_list() {
		crouting.set('t/');
		toprow.set([{
			label: ci18n('Tournaments'),
			func: ui_list,
		}]);

		send({
			type: 'tournament_list',
		}, function (err, response) {
			if (err) {
				return cerror.net(err);
			}
			list_show(response.tournaments);
		});
	}

	function set_pending_official_role_override(official_id, values) {
		if (!official_id) return;
		pending_official_role_overrides.set(official_id, {
			is_umpire: !!values.is_umpire,
			is_service_judge: !!values.is_service_judge
		});
	}

	function apply_pending_official_role_override(official) {
		if (!official || !official._id) return official;
		const pending = pending_official_role_overrides.get(official._id);
		if (!pending) return official;
		if (
			!!official.is_umpire === pending.is_umpire &&
			!!official.is_service_judge === pending.is_service_judge
		) {
			pending_official_role_overrides.delete(official._id);
			return official;
		}
		official.is_umpire = pending.is_umpire;
		official.is_service_judge = pending.is_service_judge;
		return official;
	}
	crouting.register(/^t\/$/, ui_list, change.default_handler);

	function list_show(tournaments) {
		const main = uiu.qs('.main');
		uiu.empty(main);
		uiu.el(main, 'h1', {}, 'Tournaments');
		tournaments.forEach(function (t) {
			const link = uiu.el(main, 'div', 'vlink', t.name || t.key);
			link.addEventListener('click', function () {
				switch_tournament(t.key, ui_show);
			});
		});

		const create_btn = uiu.el(main, 'button', {
			role: 'button',
		}, 'Create tournament ...');
			create_btn.addEventListener('click', ui_create);
		}

		function _add_match_id_alias(ids, id) {
			if (id === undefined || id === null || id === '') {
				return;
			}
			const value = String(id);
			ids.add(value);
			if (value.startsWith('bts_btp_')) {
				ids.add(value.substring(4));
			}
			else if (value.startsWith('btp_')) {
				ids.add('bts_' + value);
			}
		}

		function _match_matches_id(match, match_id) {
			if (!match) {
				return false;
			}
			const target_ids = new Set();
			const match_ids = new Set();
			_add_match_id_alias(target_ids, match_id);
			_add_match_id_alias(match_ids, match._id);
			_add_match_id_alias(match_ids, match.match_id);
			_add_match_id_alias(match_ids, match.btp_match_id);
			if (Array.isArray(match.btp_match_ids)) {
				match.btp_match_ids.forEach((entry) => {
					if (!entry) return;
					_add_match_id_alias(match_ids, entry.planning);
					_add_match_id_alias(match_ids, entry.match_id);
					_add_match_id_alias(match_ids, entry.id);
				});
			}
			for (const id of match_ids) {
				if (target_ids.has(id)) {
					return true;
				}
			}
			return false;
		}

		function update_score(c) {
			const cval = c.val;
			const match_id = cval.match_id;
			admin_live_debug('score event', {
				match_id,
				current_view,
				tournament_key: c.tournament_key,
				current_tournament_key: curt && curt.key,
				in_memory_match: !!utils.find(curt.matches, m => _match_matches_id(m, match_id)),
			});

			// Find the match
			const m = utils.find(curt.matches, m => _match_matches_id(m, match_id));
		if (!m) {
			cerror.silent('Cannot find match to update score, ID: ' + JSON.stringify(match_id));
			request_tournament_refresh_after_missed_change('score ' + match_id);
			return;
		}

		const old_section = cmatch.calc_section(m);
		m.network_score = cval.network_score;
		m.presses = cval.presses;
		m.team1_won = cval.team1_won;
		m.shuttle_count = cval.shuttle_count;
		if ('score_status' in cval) {
			m.score_status = cval.score_status;
		}
		if ('forward_loser' in cval) {
			m.forward_loser = cval.forward_loser;
		}
		if ('score_status_network_score' in cval) {
			m.score_status_network_score = cval.score_status_network_score;
		}
		if (cval.end_ts !== undefined) {
			m.end_ts = cval.end_ts;
		}
		if (!m.setup) {
			m.setup = {};
		}
		if (cval.court_id !== undefined) {
			m.setup.court_id = cval.court_id;
		}
		if (cval.now_on_court !== undefined) {
			m.setup.now_on_court = cval.now_on_court;
		}
		const new_section = cmatch.calc_section(m);

		if (old_section === new_section) {
			c._bts_score_patch_applied = true;
				admin_live_debug('score patch', {
					match_id: m._id,
					section: old_section,
					score_targets: cmatch.count_match_score_targets ? cmatch.count_match_score_targets(m) : 0,
					timer_targets: cmatch.count_match_timer_targets ? cmatch.count_match_timer_targets(m) : 0,
					score_text: cmatch.calc_score_str(m),
				network_score: m.network_score,
				score_status: m.score_status,
				now_on_court: m.setup && m.setup.now_on_court,
			});
			cmatch.update_match_score(m);
		} else {
			c._bts_score_patch_applied = true;
			admin_live_debug('score section change', {
				match_id: m._id,
				old_section,
				new_section,
				network_score: m.network_score,
				score_status: m.score_status,
			});
			if (new_section == 'finished' || new_section == 'unassigned') {
				m.setup.now_on_court = false;
			}
			else {
				m.setup.now_on_court = true;
			}
			cmatch.update_match(m, old_section, new_section);
		}
	}

		function update_player_status(c) {
			const cval = c.val;
			const match_id = cval.match__id;

		// Find the match
		const m = utils.find(curt.matches, m => m._id === match_id);
		if (!m) {
			cerror.silent('Cannot find match to update player status, ID: ' + JSON.stringify(match_id));
			request_tournament_refresh_after_missed_change('player status ' + match_id);
			return;
		}
		m.btp_winner = cval.btp_winner;
		m.setup = cval.setup;

		cmatch.update_players(m);
		cmatch.update_all_player_status_indicators();
	}

	function remove_match(c) {
		const cval = c.val;
		const match_id = cval.match__id;

		const m = utils.find(curt.matches, m => m._id === match_id);
		if (!m) {
			cerror.silent('Cannot find match to update, ID: ' + JSON.stringify(match_id));
			request_tournament_refresh_after_missed_change('upcoming match ' + match_id);
			return;
		}
		const section = cmatch.calc_section(m);
		cmatch.remove_match_from_gui(m, section);

	}

	function add_match(c){
		const cval = c.val;
		const m = cval.match;
		const new_section = cmatch.calc_section(m);
		cmatch.add_match(m, new_section);
	}

	function update_match(c) {
		const cval = c.val;
		const match_id = cval.match__id;

		// Find the match
		let m = utils.find(curt.matches, m => m._id === match_id);
		if (!m) {
			if (cval.match) {
				curt.matches.push(cval.match);
				curt.matches = curt.matches.sort((a, b) => cmatch.cmp_match_order(a, b));
				cmatch.add_match(cval.match, cmatch.calc_section(cval.match));
				cmatch.update_all_player_status_indicators();
				update_location_preparation_need_labels();
				return;
			}
			cerror.silent('Cannot find match to update, ID: ' + JSON.stringify(match_id));
			request_tournament_refresh_after_missed_change('match ' + match_id);
			return;
		}
		const old_section = cmatch.calc_section(m);
		if (cval.match) {
			if('network_score' in cval.match){
				m.network_score = cval.match.network_score;
			} else if (cval.match.score_status === 'normal' || cval.match.score_status === 'no_match') {
				delete m.network_score;
			}
			m.presses = cval.match.presses;
			m.team1_won = cval.match.team1_won;
			m.shuttle_count = cval.match.shuttle_count;
			m.score_status = cval.match.score_status;
			m.forward_loser = cval.match.forward_loser;
			if ('score_status_network_score' in cval.match) {
				m.score_status_network_score = cval.match.score_status_network_score;
			} else {
				delete m.score_status_network_score;
			}
			if ('no_match_losing_team' in cval.match) {
				m.no_match_losing_team = cval.match.no_match_losing_team;
			} else {
				delete m.no_match_losing_team;
			}
			if ('end_ts' in cval.match) {
				m.end_ts = cval.match.end_ts;
			}
			m.setup = cval.match.setup;
			m.btp_winner = cval.match.btp_winner;
		}
		const new_section = cmatch.calc_section(m);
		cmatch.update_match(m, old_section, new_section);
		cmatch.update_all_player_status_indicators();
		update_location_preparation_need_labels();

		return old_section;
	}

	function rerender_public_match_views(old_section, new_section) {
		const affects_courts = (
			old_section.startsWith('court_') ||
			new_section.startsWith('court_')
		);
		const affects_upcoming = (
			old_section === 'unassigned' ||
			new_section === 'unassigned'
		);

		if ((current_view === 'upcoming' || current_view === 'current_matches') && affects_courts) {
			uiu.qsEach('.courts_container', (courts_container) => {
				cmatch.render_courts(courts_container, 'public');
			});
		}

		if ((current_view === 'upcoming' || current_view === 'next_matches') && affects_upcoming) {
			uiu.qsEach('.upcoming_container', (upcoming_container) => {
				cmatch.render_upcoming_matches(upcoming_container);
			});
		}
	}

	function update_upcoming_match(c) {
		const cval = c.val;
		const match_id = cval.match__id;

		// Find the match
		const m = utils.find(curt.matches, m => m._id === match_id);
		if (!m) {
			cerror.silent('Cannot find match to update, ID: ' + JSON.stringify(match_id));
			return;
		}
		const old_section = cmatch.calc_section(m);
			if('network_score' in cval.match) {
				m.network_score = cval.match.network_score;
			} else if (cval.match.score_status === 'normal' || cval.match.score_status === 'no_match') {
				delete m.network_score;
			}
			m.presses = cval.match.presses;
			m.team1_won = cval.match.team1_won;
		m.shuttle_count = cval.match.shuttle_count;
		m.score_status = cval.match.score_status;
		m.forward_loser = cval.match.forward_loser;
		if ('score_status_network_score' in cval.match) {
			m.score_status_network_score = cval.match.score_status_network_score;
		} else {
			delete m.score_status_network_score;
		}
		if ('end_ts' in cval.match) {
			m.end_ts = cval.match.end_ts;
		}
		m.setup = cval.match.setup;
		m.btp_winner = cval.match.btp_winner;
		const new_section = cmatch.calc_section(m);
		cmatch.update_match(m, old_section, new_section);
		update_location_preparation_need_labels();
		rerender_public_match_views(old_section, new_section);

		if (old_section != new_section || new_section == 'unassigned') {
			uiu.qsEach('.upcoming_container', (upcoming_container) => {
				cmatch.render_upcoming_matches(upcoming_container);
			});
		}
	}

	function tabletoperator_add(c) {
		curt.tabletoperators.push(c.val.tabletoperator);
		_show_render_tabletoperators();
		request_location_preparation_selections();
	}

	function tabletoperator_moved_up(c) {
		const changed_t = utils.find(curt.tabletoperators, m => m._id === c.val.tabletoperator._id);
		if (changed_t) {
			changed_t.start_ts = c.val.tabletoperator.start_ts;
		}
		_show_render_tabletoperators();
		request_location_preparation_selections();
	}

	function tabletoperator_moved_down(c) {
		const changed_t = utils.find(curt.tabletoperators, m => m._id === c.val.tabletoperator._id);
		if (changed_t) {
			changed_t.start_ts = c.val.tabletoperator.start_ts;
		}
		_show_render_tabletoperators();
		request_location_preparation_selections();
	}

	function tabletoperator_removed(c) {
		const changed_t = utils.find(curt.tabletoperators, m => m._id === c.val.tabletoperator._id);
		if (changed_t) {
			changed_t.court = c.val.tabletoperator.court;
		}
		_show_render_tabletoperators();
		request_location_preparation_selections();
	}

	function add_normalization(c) {
		curt.normalizations.push(c.val.normalization);
		update_normalization_values(c)
	}

	function remove_normalization(c) {
		const changed_t = utils.find(curt.normalizations, m => m._id === c.val.normalization_id);
		if (changed_t) {
			curt.normalizations.splice(curt.normalizations.indexOf(changed_t), 1);
		}
		update_normalization_values(c)
	}
	function update_normalization_values(c) {
		uiu.qsEach('.normalizations_values_div', (div_el) => {
			div_el.innerHTML = "";
			render_normalisation_values(div_el);
		});
	}

	function add_advertisement(c) {
		curt.advertisements.push(c.val.advertisement);
		update_advertisements(c)
	}

	function remove_advertisement(c) {
		const changed_t = utils.find(curt.advertisements, m => m._id === c.val.advertisement_id);
		if (changed_t) {
			curt.advertisements.splice(curt.advertisements.indexOf(changed_t), 1);
		}
		update_advertisements(c)
	}

	function update_advertisements(c) {
		uiu.qsEach('.advertisements_div', (div_el) => {
			div_el.innerHTML = "";
			render_advertisements(div_el);
		});
	}

	function update_current_match(c) {
		update_match(c);
	}

	function update_upcoming_current_match(c) {
		update_upcoming_match(c);
	}

	function _update_all_ui_elements() {
		_show_render_matches();
		_show_render_tabletoperators();

	}

	function _update_all_ui_elements_edit() {
		update_general_displaysettings(uiu.qs('.general_displaysettings'));
	}

	function refresh_current_view() {
		switch (current_view) {
			case 'edit':
				ui_edit();
				break;
			case 'show':
				ui_show();
				break;
			case 'upcoming':
				ui_upcoming();
				break;
			case 'current_matches':
				ui_current_matches();
				break;
			case 'next_matches':
				ui_next_matches();
				break;
			case 'self_check_in':
				ui_self_check_in();
				break;
			default:
				break;
		}
	}

	function _set_disabled_by_name(field_name, disabled) {
		uiu.qsEach('[name="' + field_name + '"]', function(el) {
			el.disabled = !!disabled;
		});
	}

	let refresh_location_announcement_previews = function() {};

	function update_edit_dependencies() {
		if (current_view !== 'edit') {
			return;
		}

		const warmup_select = document.querySelector('[name="warmup"]');
		if (warmup_select) {
			const custom_warmup = ['choise', 'call-down'];
			const is_custom = custom_warmup.includes(warmup_select.value);
			_set_disabled_by_name('warmup_ready', !is_custom);
			_set_disabled_by_name('warmup_start', !is_custom);
		}

		const btp_enabled = !!curt.btp_enabled;
		_set_disabled_by_name('btp_autofetch_enabled', !btp_enabled);
		_set_disabled_by_name('btp_readonly', !btp_enabled);
		_set_disabled_by_name('btp_ip', !btp_enabled);
		_set_disabled_by_name('btp_password', !btp_enabled);
		_set_disabled_by_name('btp_timezone', !btp_enabled);
		_set_disabled_by_name('btp_autofetch_timeout_intervall', !btp_enabled || !curt.btp_autofetch_enabled);
		_set_disabled_by_name('player_pause_reset', !btp_enabled || !!curt.btp_readonly);

		const ticker_enabled = !!curt.ticker_enabled;
		_set_disabled_by_name('ticker_url', !ticker_enabled);
		_set_disabled_by_name('ticker_password', !ticker_enabled);
		refresh_location_announcement_previews();

		const tabletoperator_enabled = !!curt.tabletoperator_enabled;
		[
			'tabletoperator_with_umpire_enabled',
			'tabletoperator_winner_of_quaterfinals_enabled',
			'tabletoperator_use_manual_counting_boards_enabled',
			'tabletoperator_split_doubles',
			'tabletoperator_assignment_scope',
			'tabletoperator_with_state_enabled',
			'tabletoperator_with_state_from_match_enabled',
			'tabletoperator_set_break_after_tabletservice',
			'tabletoperator_break_seconds',
		].forEach(field_name => _set_disabled_by_name(field_name, !tabletoperator_enabled));
		uiu.qsEach('[name="tabletoperator_enabled"]', function(el) {
			const box = el.closest('.automation_group_box');
			if (box) {
				box.classList.toggle('automation_group_box_content_disabled', !tabletoperator_enabled);
			}
		});

		const preparation_automation_enabled = !!curt.call_preparation_matches_automatically_enabled;
		[
			'preparation_successor_rally_count',
			'preparation_call_time_limit_before_scheduled_enabled',
			'preparation_call_time_limit_before_scheduled_minutes',
			'preparation_call_block_ahead_limit_enabled',
			'preparation_call_block_ahead_limit',
			'preparation_call_time_ahead_of_frontier_enabled',
			'preparation_call_time_ahead_of_frontier_minutes',
			'preparation_call_matches_ahead_of_frontier_enabled',
			'preparation_call_matches_ahead_of_frontier_limit',
			'preparation_call_technical_officials_available_enabled',
			'preparation_call_no_player_waiting_as_tabletoperator_enabled',
			'preparation_call_no_player_active_as_tabletoperator_enabled',
		].forEach(field_name => _set_disabled_by_name(field_name, !preparation_automation_enabled));
		const call_on_court_automation_enabled = !!curt.call_next_possible_scheduled_match_in_preparation;
		[
			'call_on_court_participant_readiness_mode',
			'call_on_court_technical_officials_mode',
			'call_on_court_require_official_space_enabled',
			'call_on_court_only_preparation_enabled',
			'call_on_court_only_preparation_minutes',
			'call_on_court_time_limit_before_scheduled_enabled',
			'call_on_court_time_limit_before_scheduled_minutes',
			'call_on_court_block_ahead_limit_enabled',
			'call_on_court_block_ahead_limit',
			'call_on_court_time_ahead_of_frontier_enabled',
			'call_on_court_time_ahead_of_frontier_minutes',
			'call_on_court_matches_ahead_of_frontier_enabled',
			'call_on_court_matches_ahead_of_frontier_limit',
		].forEach(field_name => _set_disabled_by_name(field_name, !call_on_court_automation_enabled));

		const technical_official_rotation_enabled = (curt.official_rotation_mode || 'umpire_and_service_judge') !== 'disabled';
		const technical_official_auto_assignment_mode = curt.technical_official_auto_assignment_mode || 'manual_only';
		const preparation_officials_rule_mode_supported =
			technical_official_auto_assignment_mode === 'when_available' ||
			technical_official_auto_assignment_mode === 'on_preparation_call';
		const preparation_officials_rule_enabled =
			preparation_automation_enabled &&
			technical_official_rotation_enabled &&
			preparation_officials_rule_mode_supported;
		if (!preparation_officials_rule_enabled && curt.preparation_call_technical_officials_available_enabled) {
			curt.preparation_call_technical_officials_available_enabled = false;
			const checkbox = document.querySelector('[name="preparation_call_technical_officials_available_enabled"]');
			if (checkbox) {
				checkbox.checked = false;
			}
			send_single_prop('preparation_call_technical_officials_available_enabled', false, function(err) {
				if (err) {
					cerror.net(err);
				}
			});
		}
		_set_disabled_by_name('preparation_call_technical_officials_available_enabled', !preparation_officials_rule_enabled);
		uiu.qsEach('[name="preparation_call_technical_officials_available_enabled"]', function(el) {
			const label = el.closest('label');
			if (label) {
				label.classList.toggle('automation_suboption_checkbox_disabled', !preparation_officials_rule_enabled);
			}
			const hint = label ? label.nextElementSibling : null;
			if (hint && hint.classList.contains('automation_suboption_hint')) {
				let hint_key = null;
				if (preparation_automation_enabled) {
					if (!technical_official_rotation_enabled) {
						hint_key = 'tournament:edit:preparation_call_technical_officials_available_enabled:hint_rotation_disabled';
					} else if (!preparation_officials_rule_mode_supported) {
						hint_key = 'tournament:edit:preparation_call_technical_officials_available_enabled:hint_auto_assignment_mode';
					}
				}
				hint.style.display = hint_key ? 'block' : 'none';
				if (hint_key) {
					uiu.text(hint, ci18n(hint_key));
				}
			}
		});
		const call_on_court_officials_rule_mode_supported =
			technical_official_auto_assignment_mode === 'when_available' ||
			technical_official_auto_assignment_mode === 'on_preparation_call' ||
			technical_official_auto_assignment_mode === 'on_match_call_if_possible';
		const call_on_court_officials_select_enabled =
			call_on_court_automation_enabled &&
			technical_official_rotation_enabled;
		const call_on_court_officials_available_option_enabled =
			call_on_court_officials_select_enabled &&
			call_on_court_officials_rule_mode_supported;
		const call_on_court_officials_mode = curt.call_on_court_technical_officials_mode || 'disabled';
		if ((!call_on_court_officials_select_enabled && call_on_court_officials_mode !== 'disabled') ||
			(!call_on_court_officials_available_option_enabled && call_on_court_officials_mode === 'available')) {
			curt.call_on_court_technical_officials_mode = 'disabled';
			const select = document.querySelector('[name="call_on_court_technical_officials_mode"]');
			if (select) {
				select.value = 'disabled';
			}
			send_single_prop('call_on_court_technical_officials_mode', 'disabled', function(err) {
				if (err) {
					cerror.net(err);
				}
			});
		}
		_set_disabled_by_name('call_on_court_technical_officials_mode', !call_on_court_officials_select_enabled);
		_set_disabled_by_name('call_on_court_require_official_space_enabled', !call_on_court_officials_select_enabled);
		uiu.qsEach('[name="call_on_court_technical_officials_mode"]', function(el) {
			const box = el.closest('.automation_rule_box');
			if (box) {
				box.classList.toggle('automation_rule_box_disabled', !call_on_court_officials_select_enabled);
			}
			const available_option = el.querySelector('option[value="available"]');
			if (available_option) {
				available_option.disabled = !call_on_court_officials_available_option_enabled;
			}
			const hint = box ? box.nextElementSibling : null;
			if (hint && hint.classList.contains('automation_suboption_hint')) {
				let hint_key = null;
				if (call_on_court_automation_enabled) {
					if (!technical_official_rotation_enabled) {
						hint_key = 'tournament:edit:call_on_court_technical_officials_mode:hint_rotation_disabled';
					} else if (!call_on_court_officials_rule_mode_supported) {
						hint_key = 'tournament:edit:call_on_court_technical_officials_mode:hint_auto_assignment_mode';
					}
				}
				hint.style.display = hint_key ? 'block' : 'none';
				if (hint_key) {
					uiu.text(hint, ci18n(hint_key));
				}
			}
		});
		uiu.qsEach('[name="call_on_court_require_official_space_enabled"]', function(el) {
			const label = el.closest('label');
			if (label) {
				label.classList.toggle('automation_suboption_checkbox_disabled', !call_on_court_officials_select_enabled);
			}
		});
		uiu.qsEach('[name="call_preparation_matches_automatically_enabled"]', function(el) {
			const box = el.closest('.automation_group_box');
			if (box) {
				box.classList.toggle('automation_group_box_content_disabled', !preparation_automation_enabled);
			}
		});
		uiu.qsEach('[name="call_next_possible_scheduled_match_in_preparation"]', function(el) {
			const box = el.closest('.automation_group_box');
			if (box) {
				box.classList.toggle('automation_group_box_content_disabled', !call_on_court_automation_enabled);
			}
		});

		[
			['preparation_call_time_limit_before_scheduled_enabled', 'preparation_call_time_limit_before_scheduled_minutes'],
			['preparation_call_block_ahead_limit_enabled', 'preparation_call_block_ahead_limit'],
			['preparation_call_time_ahead_of_frontier_enabled', 'preparation_call_time_ahead_of_frontier_minutes'],
			['preparation_call_matches_ahead_of_frontier_enabled', 'preparation_call_matches_ahead_of_frontier_limit'],
		].forEach(([enabled_field, value_field]) => {
			const enabled = !!curt[enabled_field];
			_set_disabled_by_name(value_field, !preparation_automation_enabled || !enabled);
			uiu.qsEach('[name="' + enabled_field + '"]', function(el) {
				const box = el.closest('.automation_rule_box');
				if (box) {
					box.classList.toggle('automation_rule_box_disabled', !preparation_automation_enabled);
					box.classList.toggle('automation_rule_box_value_disabled', preparation_automation_enabled && !enabled);
				}
			});
		});
		[
			'call_on_court_participant_readiness_mode',
			['call_on_court_only_preparation_enabled', 'call_on_court_only_preparation_minutes'],
			['call_on_court_time_limit_before_scheduled_enabled', 'call_on_court_time_limit_before_scheduled_minutes'],
			['call_on_court_block_ahead_limit_enabled', 'call_on_court_block_ahead_limit'],
			['call_on_court_time_ahead_of_frontier_enabled', 'call_on_court_time_ahead_of_frontier_minutes'],
			['call_on_court_matches_ahead_of_frontier_enabled', 'call_on_court_matches_ahead_of_frontier_limit'],
		].forEach((entry) => {
			if (typeof entry === 'string') {
				uiu.qsEach('[name="' + entry + '"]', function(el) {
					const box = el.closest('.automation_rule_box');
					if (box) {
						box.classList.toggle('automation_rule_box_disabled', !call_on_court_automation_enabled);
					}
				});
				return;
			}
			const [enabled_field, value_field] = entry;
			const enabled = !!curt[enabled_field];
			_set_disabled_by_name(value_field, !call_on_court_automation_enabled || !enabled);
			uiu.qsEach('[name="' + enabled_field + '"]', function(el) {
				const box = el.closest('.automation_rule_box');
				if (box) {
					box.classList.toggle('automation_rule_box_disabled', !call_on_court_automation_enabled);
					box.classList.toggle('automation_rule_box_value_disabled', call_on_court_automation_enabled && !enabled);
				}
			});
		});

		apply_court_official_checkbox_dependencies();
	}

	function set_live_settings_status(status_key) {
		if (!live_settings_status_el) {
			return;
		}
		live_settings_status_el.className = 'live_settings_status live_settings_status_' + status_key;
		uiu.text(live_settings_status_el, ci18n('tournament:edit:live_status:' + status_key));
	}

	function set_live_settings_status_message(message, status_key) {
		if (!live_settings_status_el) {
			return false;
		}
		live_settings_status_el.className = 'live_settings_status live_settings_status_' + (status_key || 'saved');
		uiu.text(live_settings_status_el, message);
		return true;
	}

	function begin_live_settings_request() {
		live_settings_pending_requests += 1;
		set_live_settings_status('saving');
	}

	function end_live_settings_request(err) {
		live_settings_pending_requests = Math.max(0, live_settings_pending_requests - 1);
		if (err) {
			set_live_settings_status('error');
			return;
		}
		if (live_settings_pending_requests === 0) {
			set_live_settings_status('saved');
		} else {
			set_live_settings_status('saving');
		}
	}

	function send_single_prop(field, value, callback) {
		begin_live_settings_request();
		send({
			type: 'tournament_edit_prop',
			key: curt.key,
			field,
			value,
		}, (err) => {
			end_live_settings_request(err);
			if (callback) {
				callback(err);
			}
		});
	}

	function send_with_live_status(msg, callback) {
		begin_live_settings_request();
		send(msg, function(err, response) {
			end_live_settings_request(err);
			if (callback) {
				return callback(err, response);
			}
		});
	}

	function bind_live_prop(el, field, options) {
		options = options || {};
		const event_name = options.event_name || 'change';
		const get_value = options.get_value || function(input_el) {
			if (input_el.type === 'checkbox') {
				return input_el.checked;
			}
			return input_el.value;
		};
		const on_before_send = options.on_before_send || function() {};
		const on_success = options.on_success || function() {};
		const on_error = options.on_error || function(input_el, old_value) {
			if (input_el.type === 'checkbox') {
				input_el.checked = !!old_value;
			} else {
				input_el.value = old_value ?? '';
			}
		};

		el.addEventListener(event_name, function() {
			const old_value = curt[field];
			on_before_send(el);
			const value = get_value(el);
			send_single_prop(field, value, function(err) {
				if (err) {
					on_error(el, old_value);
					return cerror.net(err);
				}
				curt[field] = value;
				update_edit_dependencies();
				on_success(el, value);
			});
		});
	}

	function _update_all_ui_elements_upcoming() {
		cmatch.render_courts(uiu.qs('.courts_container'), 'public');
		cmatch.render_upcoming_matches(uiu.qs('.upcoming_container'));
	}

	function _update_all_ui_elements_current_matches() {
		cmatch.render_courts(uiu.qs('.courts_container'), 'public');
	}

	function _update_all_ui_elements_next_matches() {
		cmatch.render_upcoming_matches(uiu.qs('.upcoming_container'));
	}

	function _show_render_matches() {
		cmatch.render_courts(uiu.qs('.courts_container'));
		cmatch.render_unassigned(uiu.qs('.unassigned_container'));
		cmatch.render_finished(uiu.qs('.finished_container'));
		update_location_preparation_need_labels();
	}
	function _show_render_tabletoperators() {
		if(curt.tabletoperator_enabled) {
			ctabletoperator.render_unassigned(uiu.qs('.unassigned_tableoperators_container'));
		}
	}

	function update_show_tabletoperators() {
		if (current_view !== 'show') {
			return;
		}
		const meta_div = document.querySelector('.metadata_container');
		if (!meta_div) {
			return;
		}
		let container = meta_div.querySelector('.unassigned_tableoperators_container');
		if (curt.tabletoperator_enabled) {
			if (!container) {
				container = document.createElement('div');
				container.className = 'unassigned_tableoperators_container';
				meta_div.insertBefore(container, meta_div.firstChild);
			} else {
				container.innerHTML = '';
			}
			_show_render_tabletoperators();
		} else if (container) {
			container.remove();
		}
	}

	function update_btp_settings_ui() {
		switch (current_view) {
			case 'show':
				_show_render_matches();
				_show_render_umpires();
				break;
			case 'upcoming':
				_update_all_ui_elements_upcoming();
				break;
			case 'current_matches':
				_update_all_ui_elements_current_matches();
				break;
			case 'next_matches':
				_update_all_ui_elements_next_matches();
				break;
			case 'edit':
				update_edit_dependencies();
				break;
			default:
				break;
		}
	}

	function _show_render_umpires() {
		cumpires.ui_status(uiu.qs('.umpire_container'));
	}



	function ui_btp_fetch() {
		send({
			type: 'btp_fetch',
			tournament_key: curt.key,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}

	function ui_ticker_push() {
		send({
			type: 'ticker_reset',
			tournament_key: curt.key,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}

	// function render_announcement_formular(target) {
	// 	const announcements = uiu.el(target, 'div', 'announcements_container');
	// 	const heading = uiu.el(announcements, 'h3', {}, 'Freie Ansage');
	// 	const form = uiu.el(announcements, 'form');
	// 	uiu.el(form, 'textarea', {
	// 		type: 'textarea',
	// 		id: 'custom_announcement',
	// 		name: 'custom_announcement',
	// 		cols: '50',
	// 		rows: '4',
	// 		maxlength: '175'
	// 	});
	// 	const btp_fetch_btn = uiu.el(form, 'button', {
	// 		'class': 'match_save_button',
	// 		role: 'submit',
	// 	}, 'Ansage abspielen');
	// 	form_utils.onsubmit(form, function (d) {
	// 		//announce([d.custom_announcement]);
	// 		send({
	// 			type: 'free_announce',
	// 			tournament_key: curt.key,
	// 			text: d.custom_announcement,
	// 		}, function (err) {
	// 			if (err) {
	// 				return cerror.net(err);
	// 			}
	// 		});
	// 	});
	// }

	function render_announcement_formular(target) {
		const announcements = uiu.el(target, 'div', 'announcements_container');
		uiu.el(announcements, 'h3', {}, 'Freie Ansage');
	
		const form = uiu.el(announcements, 'form');
	
		const textarea = uiu.el(form, 'textarea', {
			type: 'textarea',
			id: 'custom_announcement',
			name: 'custom_announcement',
			cols: '50',
			rows: '4',
			maxlength: '175'
		});
	
		const btn_container = uiu.el(form, 'div', 'announcements_btn_container');

		// Button: Lokal Abspielen
		const local_btn = uiu.el(btn_container, 'button', {
			type: 'button',
			class: 'announce_button',
			id: 'local_announce_btn'
		}, 'Lokal Abspielen');
	
		// Button: Remote Abspielen
		const remote_btn = uiu.el(btn_container, 'button', {
			type: 'submit',
			class: 'announce_button',
			id: 'remote_announce_btn'
		}, 'Remote Abspielen');

		const emergency_btn = uiu.el(btn_container, 'button', {
			type: 'submit',
			class: !curt.enable_emergency ? 'announce_emergency_button' : 'stop_emergency_button',
			id: 'announce_emergency_btn'
		}, !curt.enable_emergency ? 'Evakuierung Abspielen' : 'Evakuierung Stoppen');
	
		// Lokales Abspielen (z. B. mit deiner announce-Funktion)
		local_btn.addEventListener('click', function () {
			const text = textarea.value.trim();
			if (!text) return;
	
			// Lokale Ansage abspielen
			announce([text], true);  // ← Diese Funktion muss bei dir lokal definiert sein
		});

		emergency_btn.addEventListener("click", () => {
  			const bestaetigt = confirm(!curt.enable_emergency ? "Soll wirklich evakuiert werden?" : "Soll die Evakuierung wirklich abgebrochen werden?");

  			if (bestaetigt) {
    			send({
					type: 'emergency_announce',
					tournament_key: curt.key,
					enable: !curt.enable_emergency
				}, function (err) {
					if (err) {
						return cerror.net(err);
					}
				});
  			}
		});
	
		// Remote Abspielen
		form_utils.onsubmit(form, function (d) {
			const text = d.custom_announcement?.trim();
			if (!text) return;
	
			send({
				type: 'free_announce',
				tournament_key: curt.key,
				text: text,
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function update_emergency_btn() {
		const btn = document.getElementById('announce_emergency_btn');
		if (!btn) return;

		if (curt.enable_emergency) {
			btn.classList.remove('announce_emergency_button');
			btn.classList.add('stop_emergency_button');
			btn.textContent = 'Evakuierung Stoppen';
		} else {
			btn.classList.remove('stop_emergency_button');
			btn.classList.add('announce_emergency_button');
			btn.textContent = 'Evakuierung Abspielen';
		}
	}

	// function render_enable_announcement(target) {
	// 	const announcements = uiu.el(target, 'div', 'enable_announcements_container');
	// 	const heading = uiu.el(announcements, 'h3', {}, 'Ansagen auf diesem Gerät');
	// 	const form = uiu.el(announcements, 'form');
	// 	const enable_announcements = uiu.el(form, 'input', {
	// 		type: 'checkbox',
	// 		id: 'enable_announcements',
	// 		name: 'enable_announcements'
	// 	});

	// 	enable_announcements.checked = (window.localStorage.getItem('enable_announcements') === 'true');
	// 	uiu.el(form, 'label', { for: 'enable_announcements' }, 'aktiv');
	// 	enable_announcements.addEventListener('change', change_announcements);
	// }

	// function change_announcements(e) {
	// 	let enable_announcements = document.getElementById('enable_announcements');
	// 	window.localStorage.setItem('enable_announcements', enable_announcements.checked);
	// }

	function render_enable_announcements(target, locations) {
		const container = uiu.el(target, 'div', 'enable_announcements_container location_announcements_controls');
		render_enable_announcements_content(container, locations);
	}

	function render_enable_announcements_content(container, locations) {
		uiu.el(container, 'h3', {}, 'Ansagen auf diesem Gerät');
	
		(locations || []).forEach(loc => {
			{
				const form = uiu.el(container, 'form');
		
				const checkboxId = `enable_announcement_calls_${loc._id}`;
				const checkbox = uiu.el(form, 'input', {
					type: 'checkbox',
					id: checkboxId,
					name: checkboxId
				});
		
				// Initialer Zustand aus localStorage
				checkbox.checked = (window.localStorage.getItem(checkboxId) === 'true');
		
				// Label anzeigen mit dem Location-Namen
				uiu.el(form, 'label', { for: checkboxId }, (loc.name || 'Unbenannte Location') + " (Spielaufruf)");
		
				// Event Listener zum Speichern in localStorage
				checkbox.addEventListener('change', function () {
					window.localStorage.setItem(checkboxId, checkbox.checked);
				});
			}
			{
				const form = uiu.el(container, 'form');
		
				const checkboxId = `enable_announcement_preparations_${loc._id}`;
				const checkbox = uiu.el(form, 'input', {
					type: 'checkbox',
					id: checkboxId,
					name: checkboxId
				});
		
				// Initialer Zustand aus localStorage
				checkbox.checked = (window.localStorage.getItem(checkboxId) === 'true');
		
				// Label anzeigen mit dem Location-Namen
				uiu.el(form, 'label', { for: checkboxId }, (loc.name || 'Unbenannte Location') + " (in Vorbereitung)");
		
				// Event Listener zum Speichern in localStorage
				checkbox.addEventListener('change', function () {
					window.localStorage.setItem(checkboxId, checkbox.checked);
				});
			}
		});

		{
			const form = uiu.el(container, 'form');
	
			const checkboxId = 'enable_free_announcements';
			const checkbox = uiu.el(form, 'input', {
				type: 'checkbox',
				id: checkboxId,
				name: checkboxId
			});
	
			// Initialer Zustand aus localStorage
			checkbox.checked = (window.localStorage.getItem(checkboxId) === 'true');
	
			// Label anzeigen mit dem Location-Namen
			uiu.el(form, 'label', { for: checkboxId }, 'Freie Remote Ansagen');
	
			// Event Listener zum Speichern in localStorage
			checkbox.addEventListener('change', function () {
				window.localStorage.setItem(checkboxId, checkbox.checked);
			});
		}

		{
			const form = uiu.el(container, 'form', 'announcement_speech_check_form');
			const statusWrap = uiu.el(form, 'div', 'announcement_speech_check_status');
			const statusLabel = uiu.el(statusWrap, 'span', 'announcement_speech_check_label', ci18n('announcements:speechcheck:label'));
			const statusValue = uiu.el(statusWrap, 'span', 'announcement_speech_check_value');
			const button = uiu.el(form, 'button', {
				type: 'button',
			}, ci18n('announcements:speechcheck:button'));

			const updateSpeechCheckStatus = function(state) {
				const current = state || (typeof getAnnouncementSpeechCheckState === 'function'
					? getAnnouncementSpeechCheckState()
					: { status: 'unsupported', detail: ci18n('announcements:speechcheck:unsupported') });
				statusValue.className = 'announcement_speech_check_value announcement_speech_check_value_' + (current.status || 'untested');
				statusValue.textContent = current.detail || ci18n('announcements:speechcheck:untested');
			};

			updateSpeechCheckStatus();

			button.addEventListener('click', function() {
				if (typeof runAnnouncementSpeechCheck !== 'function') {
					updateSpeechCheckStatus({ status: 'unsupported', detail: ci18n('announcements:speechcheck:unsupported') });
					return;
				}
				button.disabled = true;
				statusValue.className = 'announcement_speech_check_value announcement_speech_check_value_running';
				statusValue.textContent = ci18n('announcements:speechcheck:running');
				Promise.resolve(runAnnouncementSpeechCheck()).then((state) => {
					updateSpeechCheckStatus(state);
					button.disabled = false;
				}).catch(() => {
					updateSpeechCheckStatus({ status: 'error', detail: ci18n('announcements:speechcheck:error') });
					button.disabled = false;
				});
			});
		}
	}

	function render_enable_location_courts(target, locations) {
		const container = uiu.el(target, 'div', 'enable_announcements_container location_courts_controls');
		render_enable_location_courts_content(container, locations);
	}

	function render_enable_location_courts_content(container, locations) {
		uiu.el(container, 'h3', {}, 'Zeige Felder');
	
		(locations || []).forEach(loc => {
			const form = uiu.el(container, 'form');
	
			const checkboxId = `show_location_courts_${loc._id}`;
			const checkbox = uiu.el(form, 'input', {
				type: 'checkbox',
				id: checkboxId,
				name: checkboxId
			});
	
			// Initialer Zustand aus localStorage oder Default auf true
			const storedValue = window.localStorage.getItem(checkboxId);
			checkbox.checked = (storedValue === null) ? true : (storedValue === 'true');
	
			// Label anzeigen mit dem Location-Namen
			uiu.el(form, 'label', {
				for: checkboxId,
				'data-location-need-label': loc._id,
			}, format_location_courts_label(loc));
	
			// Event Listener zum Speichern in localStorage und Aufruf mit Parametern
			checkbox.addEventListener('change', function () {
				window.localStorage.setItem(checkboxId, checkbox.checked);
				cmatch.update_tables(loc._id, checkbox.checked);
			});
	
			// Gleich initial einmal aufrufen, damit der Sichtbarkeitszustand korrekt gesetzt ist
			cmatch.update_tables(loc._id, checkbox.checked);
		});
	}

	function update_show_location_controls() {
		if (current_view !== 'show') {
			return;
		}
		const locations = curt && Array.isArray(curt.locations) ? curt.locations : [];
		const announcements_container = document.querySelector('.location_announcements_controls');
		if (announcements_container) {
			uiu.empty(announcements_container);
			render_enable_announcements_content(announcements_container, locations);
		}
		const courts_container = document.querySelector('.location_courts_controls');
		if (courts_container) {
			uiu.empty(courts_container);
			render_enable_location_courts_content(courts_container, locations);
		}
	}

	function calculate_location_preparation_need_statuses() {
		const courts = Array.isArray(curt.courts) ? curt.courts : [];
		const matches = Array.isArray(curt.matches) ? curt.matches : [];
		const status_by_location_id = new Map();
		const occupied_court_ids = new Set(
			matches
				.filter((match) => {
					const setup = match && match.setup;
					return !!setup && setup.now_on_court === true && setup.court_id;
				})
				.map((match) => match.setup.court_id)
		);

		(curt.locations || []).forEach((loc) => {
			const location_courts = courts.filter((court) => court && court.location_id === loc._id);
			const active_location_courts = location_courts.filter((court) => court && court.is_active === true);
			const active_location_court_ids = new Set(active_location_courts.map((court) => court._id));
			const successor_need_count = matches.filter((match) => {
				const setup = match && match.setup;
				return !!setup
					&& setup.now_on_court === true
					&& setup.needs_preparation_successor === true
					&& active_location_court_ids.has(setup.court_id);
			}).length;
			const free_court_count = active_location_courts.filter((court) => !occupied_court_ids.has(court._id)).length;
			const active_court_count = active_location_courts.length;
			const required_preparation_count = Math.min(active_court_count, successor_need_count + free_court_count);
			const current_preparation_count = matches.filter((match) => {
				const setup = match && match.setup;
				return !!setup && setup.state === 'preparation' && setup.location_id === loc._id;
			}).length;
			status_by_location_id.set(loc._id, {
				location_id: loc._id,
				active_court_count,
				successor_need_count,
				free_court_count,
				required_preparation_count,
				current_preparation_count,
				missing_preparation_count: Math.max(0, required_preparation_count - current_preparation_count),
			});
		});

		return status_by_location_id;
	}

	function request_location_preparation_selections() {
		if (!curt || !curt.key) {
			return;
		}
		if (preparation_selection_request_inflight) {
			preparation_selection_request_pending = true;
			return;
		}
		preparation_selection_request_inflight = true;
		send({
			type: 'preparation_selection_get',
			tournament_key: curt.key,
		}, function(err, response) {
			preparation_selection_request_inflight = false;
			if (err) {
				if (preparation_selection_request_pending) {
					preparation_selection_request_pending = false;
					request_location_preparation_selections();
				}
				return;
			}
			const selection_by_location_id = {};
			(response.selections || []).forEach((selection) => {
				if (selection && selection.location_id != null) {
					selection_by_location_id[String(selection.location_id)] = selection;
				}
			});
			curt.location_preparation_selection_by_location_id = selection_by_location_id;
			const labels = document.querySelectorAll('[data-location-need-label]');
			if (labels.length) {
				update_location_preparation_need_labels(false);
			}
			uiu.qsEach('.unassigned_container', (unassigned_container) => {
				cmatch.render_unassigned(unassigned_container);
			});
			if (typeof cmatch.update_preparation_demand_court_markers === 'function') {
				cmatch.update_preparation_demand_court_markers();
			}
			if (preparation_selection_request_pending) {
				preparation_selection_request_pending = false;
				request_location_preparation_selections();
			}
		});
	}

	function format_location_courts_label(location) {
		if (!location) {
			return 'Unbenannte Location';
		}
		const name = location.name || location.short_name || location._id || 'Unbenannte Location';
		return location.short_name && location.short_name !== name ? name + " [" + location.short_name + "]" : name;
	}

	function update_location_preparation_need_labels(fetch_selections = true) {
		const labels = document.querySelectorAll('[data-location-need-label]');
		if (!labels.length) {
			return;
		}
		if (fetch_selections) {
			request_location_preparation_selections();
		}
		const statuses = calculate_location_preparation_need_statuses();
		labels.forEach((label) => {
			const location_id = label.getAttribute('data-location-need-label');
			const location = utils.find(curt.locations || [], (loc) => String(loc._id) === String(location_id));
			if (!location) {
				return;
			}
			label.textContent = format_location_courts_label(location);
		});
	}

	function render_automation_controls(target) {
		const container = uiu.el(target, 'div', 'automation_controls_panel');
		const overall_active = curt.automation_enabled !== false;
		const orbit = uiu.el(container, 'div', 'automation_orbit' + (overall_active ? ' is-global-active' : ' is-paused-global'));

		const add_outer_toggle = function(position_class, icon_class, active, on_toggle, title, extra_class) {
			const button = uiu.el(orbit, 'button', {
				type: 'button',
				'class': [
					'automation_outer_toggle',
					position_class,
					active ? 'is-active' : 'is-paused',
					extra_class || '',
				].filter(Boolean).join(' '),
				'title': title,
				'aria-label': title,
			});
			const icon = uiu.el(button, 'span', 'automation_outer_toggle_icon ' + icon_class);
			if (icon_class === 'automation_icon_rotation_dual') {
				uiu.el(icon, 'span', 'automation_icon_rotation_dual_swap', '⇄');
			}
			if (typeof on_toggle === 'function') {
				button.addEventListener('click', on_toggle);
			} else {
				button.disabled = true;
			}
			return button;
		};

		const preparation_active = !!curt.call_preparation_matches_automatically_enabled;
		const on_court_active = !!curt.call_next_possible_scheduled_match_in_preparation;
		const rotation_mode = curt.official_rotation_mode || 'umpire_and_service_judge';
		const next_rotation_mode = function(mode) {
			if (mode === 'disabled') return 'umpire_only';
			if (mode === 'umpire_only') return 'umpire_and_service_judge';
			return 'disabled';
		};
		const orbit_segment_color = function(active, reserved) {
			if (reserved) {
				return '#8e948d';
			}
			return active ? '#00c000' : '#101010';
		};
		orbit.style.setProperty('--automation-segment-top', orbit_segment_color(rotation_mode !== 'disabled', false));
		orbit.style.setProperty('--automation-segment-right', orbit_segment_color(preparation_active, false));
		const tabletoperator_enabled = !!curt.tabletoperator_enabled;
		orbit.style.setProperty('--automation-segment-bottom', orbit_segment_color(on_court_active, false));
		orbit.style.setProperty('--automation-segment-left', orbit_segment_color(tabletoperator_enabled, false));

		add_outer_toggle(
			'automation_outer_top',
			rotation_mode === 'disabled'
				? 'automation_icon_rotation_disabled'
				: (rotation_mode === 'umpire_only'
					? 'automation_icon_rotation_umpire'
					: 'automation_icon_rotation_dual'),
			rotation_mode !== 'disabled',
			function() {
				send_single_prop('official_rotation_mode', next_rotation_mode(rotation_mode), function(err) {
					if (err) {
						return cerror.net(err);
					}
				});
			},
			rotation_mode === 'disabled'
				? 'Rotation deaktiviert'
				: (rotation_mode === 'umpire_only'
					? 'Nur Schiedsrichterrotation'
					: 'Schieds- und Aufschlagrichterrotation')
		);

		add_outer_toggle(
			'automation_outer_right',
			preparation_active
				? 'automation_icon_preparation_enabled'
				: 'automation_icon_preparation_disabled',
			preparation_active,
			function() {
				send_single_prop('call_preparation_matches_automatically_enabled', !preparation_active, function(err) {
					if (err) {
						return cerror.net(err);
					}
				});
			},
			'Automatik fuer Spiele in Vorbereitung'
		);

		add_outer_toggle(
			'automation_outer_bottom',
			on_court_active
				? 'automation_icon_oncourt_enabled'
				: 'automation_icon_oncourt_disabled',
			on_court_active,
			function() {
				send_single_prop('call_next_possible_scheduled_match_in_preparation', !on_court_active, function(err) {
					if (err) {
						return cerror.net(err);
					}
				});
			},
			'Automatik fuer Spiele aufs Feld'
		);

		add_outer_toggle(
			'automation_outer_left',
			tabletoperator_enabled
				? 'automation_icon_tablet_enabled'
				: 'automation_icon_tablet_disabled',
			tabletoperator_enabled,
			function() {
				send_single_prop('tabletoperator_enabled', !tabletoperator_enabled, function(err) {
					if (err) {
						return cerror.net(err);
					}
				});
			},
			'Tabletbediener einsetzen'
		);

		const center = uiu.el(orbit, 'button', {
			type: 'button',
			'class': 'automation_center_toggle ' + (overall_active ? 'is-active' : 'is-paused'),
			'title': overall_active ? 'Gesamte Automatik pausieren' : 'Gesamte Automatik starten',
			'aria-label': overall_active ? 'Gesamte Automatik pausieren' : 'Gesamte Automatik starten',
		});
		uiu.el(center, 'span', 'automation_center_toggle_label', 'AUTO');
		const center_icon_slot = uiu.el(center, 'span', 'automation_center_toggle_icon_slot');
		uiu.el(center_icon_slot, 'span', 'automation_center_toggle_icon automation_center_toggle_icon_current ' + (overall_active ? 'is-play' : 'is-pause'), overall_active ? '▶' : '❚❚');
		uiu.el(center_icon_slot, 'span', 'automation_center_toggle_icon automation_center_toggle_icon_preview ' + (overall_active ? 'is-pause' : 'is-play'), overall_active ? '❚❚' : '▶');
		center.addEventListener('click', function() {
			const next_value = !overall_active;
			send_single_prop('automation_enabled', next_value, function(err) {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function update_show_automation_controls() {
		if (current_view !== 'show') {
			return;
		}
		uiu.qsEach('.automation_controls_panel', function(panel) {
			const parent = panel.parentNode;
			if (!parent) {
				return;
			}
			uiu.remove(panel);
			render_automation_controls(parent);
		});
	}

	function build_location_view_menu_items() {
		const base_path = '/admin/t/' + encodeURIComponent(curt.key);
		const bup_lang = ((curt.language && curt.language !== 'auto') ? '&lang=' + encodeURIComponent(curt.language) : '');
		const bup_dm_style = '&dm_style=' + encodeURIComponent(curt.dm_style || 'international');
		const locations = curt.locations || [];

		function section_items(label, path_suffix) {
			const items = [{
				label,
				href: base_path + path_suffix,
			}];

			if (locations.length > 1) {
				locations.forEach((loc) => {
					const params = new URLSearchParams({
						location: loc.name,
					});
					items.push({
						label: label + ' (' + ci18n('only location') + ' ' + loc.name + ')',
						href: base_path + path_suffix + '?' + params.toString(),
					});
				});
			}

			items.push({
				class: 'toprow_menu_separator',
			});

			return items;
		}

		const view_items = [
			...section_items(ci18n('Matchoverview'), '/upcoming'),
			...section_items(ci18n('Current Matches'), '/current_matches'),
			...section_items(ci18n('Next Matches'), '/next_matches'),
			...section_items(ci18n('Self-Check-In'), '/self_check_in'),
		];
		if (view_items.length > 0 && view_items[view_items.length - 1].class === 'toprow_menu_separator') {
			view_items.pop();
		}

		const items = [{
			label: ci18n('edit BTS settings'),
			href: base_path + '/edit',
		}];
		if (curt.btp_enabled) {
			items.push({
				label: ci18n('update BTP data'),
				func: ui_btp_fetch,
			});
		}
		if (curt.ticker_enabled) {
			items.push({
				label: ci18n('update ticker'),
				func: ui_ticker_push,
			});
		}
		items.push({
			class: 'toprow_menu_separator',
		}, {
			label: ci18n('Scoreboard'),
			href: '/bup/#btsh_e=' + encodeURIComponent(curt.key) + '&display' + bup_dm_style + bup_lang,
		}, {
			class: 'toprow_menu_separator',
		}, {
			label: ci18n('Umpire Panel'),
			href: '/bup/#btsh_e=' + encodeURIComponent(curt.key) + bup_lang,
		}, {
			class: 'toprow_menu_separator',
		},
		...view_items, {
			class: 'toprow_menu_separator',
		}, {
			label: ci18n('csvexport:winners'),
			func: ui_certificate_export,
		});

		return items;
	}

	function format_date_input_value(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function format_datetime_local_input_value(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hour = String(date.getHours()).padStart(2, '0');
		const minute = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hour}:${minute}`;
	}

	function get_effective_test_clock_now_ms() {
		const clock = curt && curt.test_clock;
		if (!clock) {
			return Date.now();
		}
		if (clock.mode === 'fixed' && Number.isFinite(Number(clock.fixed_ts))) {
			return Number(clock.fixed_ts);
		}
		if (clock.mode === 'offset' && Number.isFinite(Number(clock.offset_ms))) {
			return Date.now() + Number(clock.offset_ms);
		}
		return Date.now();
	}

	function update_test_clock_status() {
		if (!test_clock_controls || !test_clock_controls.status) {
			return;
		}
		const clock = curt?.test_clock || { mode: 'real', fixed_ts: null, offset_ms: 0 };
		const mode = clock.mode || 'real';
		const effective_now = new Date(get_effective_test_clock_now_ms());
		let mode_label = 'Echtzeit (Produktivmodus)';
		if (mode === 'fixed') {
			mode_label = 'Fixe Zeit (Debug/Test)';
		} else if (mode === 'offset') {
			mode_label = 'Offset-Zeit (Debug/Test)';
		}
		uiu.text(
			test_clock_controls.status,
			`Aktiv: ${mode_label} | BTS-Zeit: ${effective_now.toLocaleString('de-DE')}`
		);
	}

	function update_test_clock_body_state() {
		if (!document.body) {
			return;
		}
		const mode = (curt?.test_clock?.mode || 'real');
		document.body.classList.toggle('bts_clock_debug_mode', mode !== 'real');
		document.body.classList.toggle('bts_clock_debug_mode_fixed', mode === 'fixed');
		document.body.classList.toggle('bts_clock_debug_mode_offset', mode === 'offset');
	}

	function update_test_clock_mode_visibility() {
		if (!test_clock_controls) {
			return;
		}
		const mode = test_clock_controls.mode_select.value || 'real';
		test_clock_controls.real_section.style.display = mode === 'real' ? '' : 'none';
		test_clock_controls.fixed_section.style.display = mode === 'fixed' ? '' : 'none';
		test_clock_controls.offset_section.style.display = mode === 'offset' ? '' : 'none';
		test_clock_controls.freeze_now_btn.style.display = mode === 'fixed' ? '' : 'none';
	}

	function ensure_test_clock_status_interval() {
		if (test_clock_status_interval != null) {
			return;
		}
		test_clock_status_interval = window.setInterval(() => {
			if (!test_clock_controls || !test_clock_controls.status || !document.body.contains(test_clock_controls.status)) {
				window.clearInterval(test_clock_status_interval);
				test_clock_status_interval = null;
				return;
			}
			update_test_clock_status();
		}, 1000);
	}

	function update_test_clock_controls() {
		update_test_clock_body_state();
		if (!test_clock_controls) {
			return;
		}
		const clock = curt?.test_clock || { mode: 'real', fixed_ts: null, offset_ms: 0 };
		const mode = clock.mode || 'real';
		test_clock_controls.mode_select.value = mode;
		test_clock_controls.fixed_input.value =
			(mode === 'fixed' && Number.isFinite(Number(clock.fixed_ts)))
				? format_datetime_local_input_value(new Date(Number(clock.fixed_ts)))
				: format_datetime_local_input_value(new Date(get_effective_test_clock_now_ms()));
		test_clock_controls.offset_input.value = String(Math.round((Number(clock.offset_ms) || 0) / 60000));
		update_test_clock_mode_visibility();
		update_test_clock_status();
		ensure_test_clock_status_interval();
	}

	function send_test_clock_update(payload, callback) {
		send_with_live_status({
			type: 'clock_set',
			tournament_key: curt.key,
			...payload,
		}, (err, response) => {
			if (!err && response && response.clock) {
				curt.test_clock = response.clock;
				update_test_clock_controls();
			}
			if (callback) {
				callback(err, response);
			}
		});
	}

	function format_certificate_export_timestamp(value) {
		if (!value) {
			return '';
		}
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return String(value);
		}
		return parsed.toLocaleString('de-DE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function _cancel_ui_certificate_export() {
		const dlg = document.querySelector('.certificate_export_dialog');
		if (!dlg) {
			return;
		}
		cbts_utils.esc_stack_pop();
		uiu.remove(dlg);
		if (/\/certificate_export$/.test(window.location.pathname)) {
			history.back();
		}
	}

	function ui_certificate_export() {
		if (document.querySelector('.certificate_export_dialog')) {
			return;
		}
		crouting.set('t/' + curt.key + '/certificate_export', {}, _cancel_ui_certificate_export);
		cbts_utils.esc_stack_push(_cancel_ui_certificate_export);

		const body = uiu.qs('body');
		const dialogBg = uiu.el(body, 'div', 'dialog_bg certificate_export_dialog');
		const dialog = uiu.el(dialogBg, 'div', 'dialog');
		uiu.el(dialog, 'h3', {}, ci18n('csvexport:winners'));

		const form = uiu.el(dialog, 'form');

		const title = ccsvexport.split_tournament_title(curt.name, curt);
		const event_options = ccsvexport.get_certificate_event_options(curt.matches);
		const today = new Date(get_effective_test_clock_now_ms());
		let certificateSettingsSaveTimer = null;
		let pendingCertificateSettingsChanges = {};

		function save_certificate_export_settings(changes) {
			send_with_live_status({
				type: 'tournament_edit_props',
				key: curt.key,
				props: changes,
			}, (err) => {
				if (err) {
					cerror.net(err);
				}
			});
		}

		function schedule_certificate_export_settings_save(changes) {
			pendingCertificateSettingsChanges = {
				...pendingCertificateSettingsChanges,
				...changes,
			};
			if (certificateSettingsSaveTimer != null) {
				window.clearTimeout(certificateSettingsSaveTimer);
			}
			certificateSettingsSaveTimer = window.setTimeout(() => {
				certificateSettingsSaveTimer = null;
				const mergedChanges = pendingCertificateSettingsChanges;
				pendingCertificateSettingsChanges = {};
				save_certificate_export_settings(mergedChanges);
			}, 250);
		}

		const title1Label = uiu.el(form, 'label');
		title1Label.style.display = 'block';
		title1Label.style.marginBottom = '0.75em';
		uiu.el(title1Label, 'span', {}, 'Veranstaltung #1');
		const title1Input = uiu.el(title1Label, 'input', {
			type: 'text',
			name: 'veranstaltung_1',
			value: curt.certificate_title_line_1 || title.veranstaltung_1 || '',
		});
		title1Input.style.display = 'block';
		title1Input.style.width = '100%';
		title1Input.style.boxSizing = 'border-box';

		const title2Label = uiu.el(form, 'label');
		title2Label.style.display = 'block';
		title2Label.style.marginBottom = '0.75em';
		uiu.el(title2Label, 'span', {}, 'Veranstaltung #2');
		const title2Input = uiu.el(title2Label, 'input', {
			type: 'text',
			name: 'veranstaltung_2',
			value: curt.certificate_title_line_2 || title.veranstaltung_2 || '',
		});
		title2Input.style.display = 'block';
		title2Input.style.width = '100%';
		title2Input.style.boxSizing = 'border-box';

		const dateLabel = uiu.el(form, 'label');
		dateLabel.style.display = 'block';
		dateLabel.style.marginBottom = '0.75em';
		uiu.el(dateLabel, 'span', {}, 'Datum');
		const dateInput = uiu.el(dateLabel, 'input', {
			type: 'date',
			name: 'datum',
			value: curt.certificate_export_date || format_date_input_value(today),
		});
		dateInput.style.display = 'block';
		dateInput.style.width = '100%';
		dateInput.style.boxSizing = 'border-box';

		const countLabel = uiu.el(form, 'label');
		countLabel.style.display = 'block';
		countLabel.style.marginBottom = '0.75em';
		uiu.el(countLabel, 'span', {}, 'Anzahl der Urkunden je Disziplin');
		const countInput = uiu.el(countLabel, 'input', {
			type: 'number',
			name: 'max_place',
			min: '1',
			step: '1',
			value: String(curt.certificate_export_max_place || 3),
		});
		countInput.style.display = 'block';
		countInput.style.width = '100%';
		countInput.style.boxSizing = 'border-box';

		const eventsWrap = uiu.el(form, 'div', 'settings');
		uiu.el(eventsWrap, 'h3', {}, 'Disziplinen');

		if (event_options.length === 0) {
			uiu.el(eventsWrap, 'p', 'hint', 'Keine Disziplinen mit Platzierungsspielen gefunden.');
			const emptyActions = uiu.el(form, 'div', { style: 'margin-top: 1.5em;' });
			const cancelBtn = uiu.el(emptyActions, 'button', {
				type: 'button',
				class: 'match_save_button',
			}, 'Zurück');
			cancelBtn.addEventListener('click', _cancel_ui_certificate_export);
		} else {
			const toggleRow = uiu.el(eventsWrap, 'div', { style: 'margin-bottom: 1em;' });
			const selectAllBtn = uiu.el(toggleRow, 'button', {
				type: 'button',
			}, 'Alle auswählen');
			const clearBtn = uiu.el(toggleRow, 'button', {
				type: 'button',
				style: 'margin-left: 0.5em;',
			}, 'Keine auswählen');
			const resetAllBtn = uiu.el(toggleRow, 'button', {
				type: 'button',
				style: 'margin-left: 0.5em;',
			}, 'Exportstatus aller Disziplinen zurücksetzen');

			const quickFilterWrap = uiu.el(eventsWrap, 'div', { style: 'margin-bottom: 1em;' });
			const onlyCompleteLabel = uiu.el(quickFilterWrap, 'label', {
				style: 'display: inline-flex; gap: 0.5em; align-items: center; margin-right: 1em;',
			});
			const onlyCompleteInput = uiu.el(onlyCompleteLabel, 'input', {
				type: 'checkbox',
				checked: 'checked',
			});
			uiu.el(onlyCompleteLabel, 'span', {}, 'Nur fertig');

			const onlyNewLabel = uiu.el(quickFilterWrap, 'label', {
				style: 'display: inline-flex; gap: 0.5em; align-items: center; margin-right: 1em;',
			});
			const onlyNewInput = uiu.el(onlyNewLabel, 'input', {
				type: 'checkbox',
				checked: 'checked',
			});
			uiu.el(onlyNewLabel, 'span', {}, 'Nur noch nicht exportiert');

			const lastScheduledLabel = uiu.el(quickFilterWrap, 'label', {
				style: 'display: inline-flex; gap: 0.5em; align-items: center; margin-right: 1em;',
			});
			uiu.el(lastScheduledLabel, 'span', {}, 'Letztes Spiel am');
			const lastScheduledInput = uiu.el(lastScheduledLabel, 'input', {
				type: 'date',
				value: format_date_input_value(today),
			});

			const typeFilterWrap = uiu.el(eventsWrap, 'div', { style: 'margin-bottom: 1em;' });
			uiu.el(typeFilterWrap, 'span', { style: 'margin-right: 0.75em;' }, 'Typ:');
			const typeFilterValues = ['all', 'single', 'double'];
			const typeFilterLabels = {
				all: 'Alle',
				single: 'Nur Einzel',
				double: 'Nur Doppel',
			};
			const typeFilterInputs = {};
			typeFilterValues.forEach((value, index) => {
				const radioLabel = uiu.el(typeFilterWrap, 'label', {
					style: 'display: inline-flex; gap: 0.5em; align-items: center; margin-right: 1em;',
				});
				const attrs = {
					type: 'radio',
					name: 'certificate_export_type_filter',
					value,
				};
				if (index === 0) {
					attrs.checked = 'checked';
				}
				typeFilterInputs[value] = uiu.el(radioLabel, 'input', attrs);
				uiu.el(radioLabel, 'span', {}, typeFilterLabels[value]);
			});

			const applyQuickFilterBtn = uiu.el(eventsWrap, 'button', {
				type: 'button',
				style: 'margin-bottom: 1em;',
			}, 'Auswahl aus Filtern übernehmen');

			const eventList = uiu.el(eventsWrap, 'div');

			const eventCheckboxes = [];
			event_options.forEach((event_option) => {
				const row = uiu.el(eventList, 'div', {
					style: 'display: flex; gap: 0.75em; align-items: flex-start; margin: 0.4em 0;',
				});
				const selector = uiu.el(row, 'label', {
					style: 'display: flex; gap: 0.75em; align-items: flex-start; flex: 1 1 auto;',
				});
				const checkbox = uiu.el(selector, 'input', {
					type: 'checkbox',
					checked: 'checked',
					'data-event-name': event_option.event_name,
				});
				const infoWrap = uiu.el(selector, 'div', { style: 'display: block; flex: 1 1 auto;' });
				const titleLine = uiu.el(infoWrap, 'div', {
					style: 'display: flex; flex-wrap: wrap; align-items: center; gap: 0.35em 0.4em;',
				});
				const titleText = uiu.el(titleLine, 'span', {}, event_option.label);
				const resetBtn = uiu.el(row, 'button', {
					type: 'button',
					style: 'margin-left: 0.5em;',
				}, 'Zurücksetzen');
				eventCheckboxes.push({
					checkbox,
					event_option,
					titleLine,
					titleText,
					resetBtn,
				});
			});

			function get_selected_type_filter() {
				if (typeFilterInputs.single.checked) return 'single';
				if (typeFilterInputs.double.checked) return 'double';
				return 'all';
			}

			function render_status_badge(container, text, class_name) {
				return uiu.el(container, 'span', {
					class: `certificate_export_badge ${class_name}`,
				}, text);
			}

			function format_certificate_preview_tooltip(event_name, max_place, exported_at_display) {
				const rows = ccsvexport.build_certificate_rows(curt.matches, curt, {
					max_place,
					selected_event_names: new Set([event_name]),
				});
				const lines = [];
				if (exported_at_display) {
					lines.push(`Zuletzt exportiert: ${exported_at_display}`);
				}
				if (rows.length === 0) {
					lines.push('Keine eindeutigen Platzierungen verfügbar.');
					return lines.join('\n');
				}
				lines.push('Platzierungen:');
				rows
					.sort((a, b) => Number(a.place || 0) - Number(b.place || 0))
					.forEach((row) => {
						const players = [row.spieler_1, row.spieler_2].filter(Boolean).join(' / ');
						lines.push(`${row.platz}: ${players || '—'}`);
					});
				return lines.join('\n');
			}

			function update_event_statuses() {
				const max_place = Number(countInput.value || 0);
				const export_state = curt.certificate_exports || {};
				eventCheckboxes.forEach((entry) => {
					const event_option = entry.event_option;
					const is_complete = ccsvexport.event_is_complete_for_max_place(event_option, max_place);
					const exported_at = export_state[event_option.event_name] || null;
					const exported_at_display = format_certificate_export_timestamp(exported_at);
					const available_places = (event_option.available_places || []).join(', ');
					entry.checkbox.dataset.complete = is_complete ? 'true' : 'false';
					entry.checkbox.dataset.exported = exported_at ? 'true' : 'false';
					entry.checkbox.dataset.kind = event_option.kind || '';
					entry.checkbox.dataset.latestScheduledDate = event_option.latest_scheduled_date || '';
					while (entry.titleLine.childNodes.length > 1) {
						entry.titleLine.removeChild(entry.titleLine.lastChild);
					}
					render_status_badge(
						entry.titleLine,
						is_complete ? 'Fertig' : 'Offen',
						is_complete
							? 'certificate_export_badge_complete'
							: 'certificate_export_badge_pending'
					);
					render_status_badge(
						entry.titleLine,
						exported_at ? `Exportiert: ${exported_at_display}` : 'Nicht exportiert',
						exported_at
							? 'certificate_export_badge_exported'
							: 'certificate_export_badge_unexported'
					);
					render_status_badge(
						entry.titleLine,
						event_option.kind === 'double' ? 'Doppel' : 'Einzel',
						'certificate_export_badge_kind'
					);
					render_status_badge(
						entry.titleLine,
						`Plätze: ${available_places || '—'}`,
						'certificate_export_badge_places'
					);
					if (event_option.latest_scheduled_date) {
						const latestDisplay = event_option.latest_scheduled_time
							? `${event_option.latest_scheduled_date} ${event_option.latest_scheduled_time}`
							: event_option.latest_scheduled_date;
						render_status_badge(
							entry.titleLine,
							`Letztes Spiel: ${latestDisplay}`,
							'certificate_export_badge_places'
						);
					}
					const previewTitle = format_certificate_preview_tooltip(
						event_option.event_name,
						max_place,
						exported_at ? exported_at_display : ''
					);
					entry.titleLine.title = previewTitle;
					entry.titleText.title = previewTitle;
					entry.checkbox.title = previewTitle;
				});
			}

			function apply_quick_filters() {
				const selected_type = get_selected_type_filter();
				eventCheckboxes.forEach((entry) => {
					const checkbox = entry.checkbox;
					const matches_complete = !onlyCompleteInput.checked || checkbox.dataset.complete === 'true';
					const matches_new = !onlyNewInput.checked || checkbox.dataset.exported !== 'true';
					const matches_type = selected_type === 'all' || checkbox.dataset.kind === selected_type;
					const matches_last_scheduled = !lastScheduledInput.value || checkbox.dataset.latestScheduledDate === lastScheduledInput.value;
					checkbox.checked = matches_complete && matches_new && matches_type && matches_last_scheduled;
				});
			}

			selectAllBtn.addEventListener('click', () => {
				eventCheckboxes.forEach((entry) => {
					entry.checkbox.checked = true;
				});
			});

			clearBtn.addEventListener('click', () => {
				eventCheckboxes.forEach((entry) => {
					entry.checkbox.checked = false;
				});
			});

			resetAllBtn.addEventListener('click', () => {
				send({
					type: 'certificate_export_reset',
					tournament_key: curt.key,
					all: true,
				}, (err, response) => {
					if (err) {
						return cerror.net(err);
					}
					curt.certificate_exports = response && response.certificate_exports ? response.certificate_exports : {};
					update_event_statuses();
				});
			});

			applyQuickFilterBtn.addEventListener('click', apply_quick_filters);
			countInput.addEventListener('input', update_event_statuses);
			title1Input.addEventListener('input', () => {
				schedule_certificate_export_settings_save({
					certificate_title_line_1: title1Input.value,
				});
			});
			title2Input.addEventListener('input', () => {
				schedule_certificate_export_settings_save({
					certificate_title_line_2: title2Input.value,
				});
			});
			dateInput.addEventListener('change', () => {
				save_certificate_export_settings({
					certificate_export_date: dateInput.value,
				});
			});
			countInput.addEventListener('change', () => {
				save_certificate_export_settings({
					certificate_export_max_place: Number(countInput.value || 0) || 3,
				});
			});
			eventCheckboxes.forEach((entry) => {
				entry.resetBtn.addEventListener('click', () => {
					send({
						type: 'certificate_export_reset',
						tournament_key: curt.key,
						event_name: entry.event_option.event_name,
					}, (err, response) => {
						if (err) {
							return cerror.net(err);
						}
						curt.certificate_exports = response && response.certificate_exports ? response.certificate_exports : {};
						update_event_statuses();
					});
				});
			});
			update_event_statuses();
			apply_quick_filters();

			const actions = uiu.el(form, 'div', { style: 'margin-top: 1.5em;' });
			const exportCsvBtn = uiu.el(actions, 'button', {
				type: 'button',
				class: 'match_save_button',
			}, 'CSV exportieren');
			const exportXlsxBtn = uiu.el(actions, 'button', {
				type: 'button',
				class: 'match_save_button',
				style: 'margin-left: 0.5em;',
			}, 'XLSX exportieren');
			const cancelBtn = uiu.el(actions, 'button', {
				type: 'button',
				class: 'match_save_button',
				style: 'margin-left: 0.5em;',
			}, 'Zurück');

			function set_certificate_export_buttons_disabled(disabled) {
				if (disabled) {
					exportCsvBtn.setAttribute('disabled', 'disabled');
					exportXlsxBtn.setAttribute('disabled', 'disabled');
					return;
				}
				exportCsvBtn.removeAttribute('disabled');
				exportXlsxBtn.removeAttribute('disabled');
			}

			function handle_certificate_export(format) {
				const selected_event_names = new Set(
					eventCheckboxes
						.filter((entry) => entry.checkbox.checked)
						.map((entry) => entry.checkbox.getAttribute('data-event-name'))
						.filter(Boolean)
				);
				if (selected_event_names.size === 0) {
					alert('Bitte mindestens eine Disziplin auswählen.');
					return;
				}
				set_certificate_export_buttons_disabled(true);
				let releaseTimeout = window.setTimeout(() => {
					releaseTimeout = null;
					set_certificate_export_buttons_disabled(false);
				}, 5000);
				try {
					ccsvexport.export_certificate_file(format, {
						veranstaltung_1: title1Input.value,
						veranstaltung_2: title2Input.value,
						datum: dateInput.value,
						max_place: Number(countInput.value || 0),
						selected_event_names,
					});
				} catch (err) {
					if (releaseTimeout != null) {
						window.clearTimeout(releaseTimeout);
					}
					set_certificate_export_buttons_disabled(false);
					cerror.net(err);
					return;
				}
				save_certificate_export_settings({
					certificate_title_line_1: title1Input.value,
					certificate_title_line_2: title2Input.value,
					certificate_export_date: dateInput.value,
					certificate_export_max_place: Number(countInput.value || 0) || 3,
				});
				send({
					type: 'certificate_export_mark',
					tournament_key: curt.key,
					event_names: [...selected_event_names],
				}, (err, response) => {
					if (releaseTimeout != null) {
						window.clearTimeout(releaseTimeout);
					}
					set_certificate_export_buttons_disabled(false);
					if (err) {
						return cerror.net(err);
					}
					curt.certificate_exports = response && response.certificate_exports ? response.certificate_exports : {};
					update_event_statuses();
				});
			}

			exportCsvBtn.addEventListener('click', () => {
				handle_certificate_export('csv');
			});
			exportXlsxBtn.addEventListener('click', () => {
				handle_certificate_export('xlsx');
			});

			cancelBtn.addEventListener('click', _cancel_ui_certificate_export);
		}
	}

	function build_show_toprow_right_items() {
		return [{
			label: 'BTS',
			class: 'status_label',
		}, {
			label: '',
			class: 'toprow_service_badge status_badge',
		}, {
			label: 'BTP',
			class: 'btp_status_label',
		}, {
			label: '',
			class: 'toprow_service_badge btp_status_badge',
		}, {
			label: 'Ticker',
			class: 'ticker_status_label',
		}, {
			label: '',
			class: 'toprow_service_badge ticker_status_badge',
		}, {
			label: 'Sprachausgabe',
			class: 'speech_output_status_label',
		}, {
			label: '',
			class: 'toprow_service_badge speech_output_status_badge',
		}, {
			label: '\u2630',
			class: 'toprow_menu_button',
			items: build_location_view_menu_items(),
		}];
	}

	function set_badge_text(badge, text) {
		if (!badge) {
			return;
		}
		while (badge.firstChild) {
			badge.removeChild(badge.firstChild);
		}
		badge.textContent = text;
	}

	function set_btp_badge_countdown(badge, ms_remaining) {
		if (!badge) {
			return;
		}
		while (badge.firstChild) {
			badge.removeChild(badge.firstChild);
		}
		uiu.el(badge, 'span', 'toprow_service_badge_prefix', 'Sync in:');
		uiu.el(badge, 'span', 'toprow_service_badge_timer', format_btp_next_fetch_remaining(ms_remaining));
	}

	function service_badge_text(status_name) {
		switch (status_name) {
			case 'connected':
				return 'aktiv';
			case 'connecting':
				return 'connecting';
			case 'error':
				return 'error';
			case 'deactivated':
				return 'aus';
			case 'waiting':
				return 'wartet';
			default:
				return status_name || '';
		}
	}

	function speech_output_badge_text(status_name) {
		switch (status_name) {
			case 'active':
			case 'ok':
				return 'aktiv';
			case 'running':
				return 'sync...';
			case 'untested':
				return 'offen';
			case 'unsupported':
				return 'kein support';
			case 'suspicious':
				return 'unsicher';
			case 'timeout':
				return 'timeout';
			case 'error':
				return 'error';
			default:
				return status_name || 'offen';
		}
	}

	function speech_output_badge_class(status_name) {
		switch (status_name) {
			case 'active':
			case 'ok':
				return 'status_connected';
			case 'running':
				return 'status_connected is-fetching';
			case 'untested':
				return 'status_waiting';
			case 'unsupported':
				return 'status_deactivated';
			case 'suspicious':
			case 'timeout':
			case 'error':
				return 'status_error';
			default:
				return 'status_waiting';
		}
	}

	function update_service_badge(service_id, c) {
		if (!c || !c.val) {
			return;
		}
		const badge_class = service_id + '_badge';
		uiu.qsEach('.' + badge_class, (badge_el) => {
			badge_el.className = 'toprow_service_badge ' + badge_class + ' status_' + c.val.status;
			badge_el.title = c.val.message || '';
			set_badge_text(badge_el, service_badge_text(c.val.status));
		});
	}

	function update_speech_output_badge(state) {
		const current = state || (typeof getAnnouncementSpeechCheckState === 'function'
			? getAnnouncementSpeechCheckState()
			: { status: 'untested', detail: '' });
		uiu.qsEach('.speech_output_status_badge', (badge_el) => {
			badge_el.className = 'toprow_service_badge speech_output_status_badge ' + speech_output_badge_class(current.status);
			badge_el.title = current.detail || '';
			set_badge_text(badge_el, speech_output_badge_text(current.status));
		});
	}

	function ensure_speech_output_badge_listener() {
		if (speech_output_badge_listener_registered) {
			return;
		}
		speech_output_badge_listener_registered = true;
		window.addEventListener('announcement-speech-check-state-changed', function(event) {
			update_speech_output_badge(event && event.detail ? event.detail : null);
		});
		window.addEventListener('storage', function(event) {
			if (event.key !== ANNOUNCEMENT_SPEECH_CHECK_STATE_STORAGE_KEY) {
				return;
			}
			update_speech_output_badge();
		});
	}

	function render_service_toprow(left_items) {
		toprow.set(left_items, build_show_toprow_right_items());
		ensure_btp_next_fetch_countdown();
		ensure_speech_output_badge_listener();
		bts_status_changed({ val: curt.status || { status: 'connected', message: '' } });
		btp_status_changed({ val: curt.btp_status });
		ticker_status_changed({ val: curt.ticker_status || { status: 'deactivated', message: '' } });
		update_speech_output_badge();
	}

	function render_show_toprow() {
		render_service_toprow([{
			label: ci18n('Tournaments'),
			func: ui_list,
		}, {
			label: curt.name || curt.key,
			func: ui_show,
			'class': 'ct_name',
		}]);
	}

	function render_edit_toprow() {
		render_service_toprow([{
			label: ci18n('Tournaments'),
			func: ui_list,
		}, {
			label: curt.name || curt.key,
			func: ui_show,
			'class': 'ct_name',
		}, {
			label: ci18n('edit tournament'),
			func: ui_edit,
		}]);
	}

	function format_btp_next_fetch_remaining(ms_remaining) {
		const total_seconds = Math.max(0, Math.ceil(ms_remaining / 1000));
		const minutes = Math.floor(total_seconds / 60);
		const seconds = total_seconds % 60;
		return minutes + ':' + String(seconds).padStart(2, '0');
	}

	function update_btp_next_fetch_countdown() {
		const countdown = document.querySelector('.btp_status_badge');
		if (!countdown || !curt) {
			return;
		}
		const btp_status = curt.btp_status || {};
		const next_fetch_ts = btp_status.next_fetch_ts;
		const status_name = btp_status.status;
		countdown.className = 'toprow_service_badge btp_status_badge';
		if (!curt.btp_enabled || !curt.btp_autofetch_enabled) {
			set_badge_text(countdown, service_badge_text(status_name || 'deactivated'));
			if (status_name) {
				countdown.classList.add('status_' + status_name);
			}
			countdown.title = '';
			return;
		}
		if (status_name === 'error') {
			set_badge_text(countdown, 'error');
			countdown.title = btp_status.message || 'BTP-Fehler';
			countdown.classList.add('status_error');
			return;
		}
		if (status_name === 'connecting') {
			set_badge_text(countdown, 'connecting');
			countdown.title = btp_status.message || 'BTP verbindet';
			countdown.classList.add('status_connecting');
			return;
		}
		if (btp_status.fetch_in_progress) {
			set_badge_text(countdown, 'sync...');
			countdown.title = 'BTP-Aktualisierung laeuft';
			countdown.classList.add('status_connected', 'is-fetching');
			return;
		}
		if (!next_fetch_ts) {
			set_badge_text(countdown, service_badge_text(status_name || 'connected'));
			countdown.title = btp_status.message || '';
			countdown.classList.add('status_' + (status_name || 'connected'));
			return;
		}
		const ms_remaining = next_fetch_ts - Date.now();
		set_btp_badge_countdown(countdown, ms_remaining);
		countdown.title = 'Naechste BTP-Aktualisierung';
		countdown.classList.add('status_connected', 'is-countdown');
	}

	function ensure_btp_next_fetch_countdown() {
		if (btp_next_fetch_countdown_interval) {
			return;
		}
		btp_next_fetch_countdown_interval = setInterval(update_btp_next_fetch_countdown, 1000);
	}
	function ui_show() {
		current_view = 'show'
		crouting.set('t/:key/', { key: curt.key });
		render_show_toprow();
		update_test_clock_body_state();

		const main = uiu.qs('.main');
		uiu.empty(main);

		const meta_div = uiu.el(main, 'div', 'metadata_container');

		
		if(curt.tabletoperator_enabled) {
			uiu.el(meta_div, 'div', 'unassigned_tableoperators_container');
		}
		uiu.el(meta_div, 'div', 'umpire_container');
		render_announcement_formular(meta_div);


		render_enable_announcements(meta_div, curt.locations);


		const meta_right_div = uiu.el(meta_div, 'div', 'metadata_right_container');

		const meta_right_top_div = uiu.el(meta_right_div, 'div', 'metadata_right_top_container');

		render_enable_location_courts(meta_right_top_div, curt.locations);
		render_automation_controls(meta_right_top_div);

		const errors_scroll_left_div = uiu.el(meta_right_div, 'div', 'errors_scroll_left');

		uiu.el(errors_scroll_left_div, 'div', 'errors');
		
		cmatch.prepare_render(curt);


		uiu.el(main, 'div', 'courts_container');
		uiu.el(main, 'div', 'unassigned_container');
		const match_create_container = uiu.el(main, 'div');
		cmatch.render_create(match_create_container);
		uiu.el(main, 'div', 'finished_container');

		_show_render_matches();

		_show_render_tabletoperators();
		_show_render_umpires();
	}
	_route_single(/t\/([a-z0-9]+)\/$/, ui_show, change.default_handler(_update_all_ui_elements, {
		score: update_score,
		court_current_match: update_current_match,
		update_player_status: update_player_status,
		match_edit: update_match,
		match_remove: remove_match,
		normalization_removed: remove_normalization,
		normalization_add: add_normalization,
		advertisement_removed: remove_advertisement,
		advertisement_add: add_advertisement,
		tabletoperator_add: tabletoperator_add,
		tabletoperator_moved_up: tabletoperator_moved_up,
		tabletoperator_moved_down: tabletoperator_moved_down,
		tabletoperator_removed: tabletoperator_removed,
		btp_status: btp_status_changed,
		ticker_status: ticker_status_changed,
	}));

	_route_single(/t\/([a-z0-9]+)\/certificate_export$/, ui_certificate_export, change.default_handler(ui_certificate_export, {
		score: ui_certificate_export,
		match_edit: ui_certificate_export,
		match_remove: ui_certificate_export,
		update_player_status: ui_certificate_export,
	}));

	function render_settings(target) {
		const settings_div = uiu.el(target, 'div', 'metadata_right_container_2');
		uiu.el(settings_div, 'h3', {}, 'Turnier-Einstellungen');
	
		const settings_table = uiu.el(settings_div, 'table');	
		var tr = uiu.el(settings_table, 'tr');
		var td = uiu.el(tr, 'td');
		uiu.el(td, 'div', 'status_label', 'BTS');
		var td = uiu.el(tr, 'td');
		uiu.el(td, 'div', 'status status_connected','');
		var td = uiu.el(tr, 'td');
		const settings_btn = uiu.el(td, 'button', 'tournament_settings_link vlink', ci18n('edit tournament'));
		settings_btn.addEventListener('click', ui_edit);

		var tr = uiu.el(settings_table, 'tr');
		var td = uiu.el(tr, 'td');
		uiu.el(td, 'div', 'btp_status_label', 'BTP');
		var td = uiu.el(tr, 'td');
		uiu.el(td, 'div', 'btp_status', '');
		btp_status_changed({ val: curt.btp_status });
		var td = uiu.el(tr, 'td');
		if (curt.btp_enabled) {
			const btp_fetch_btn = uiu.el(td, 'button', 'tournament_btp_fetch vlink', ci18n('update from BTP'));
			btp_fetch_btn.addEventListener('click', ui_btp_fetch);
		}
		var tr = uiu.el(settings_table, 'tr');
		var td = uiu.el(tr, 'td');
		uiu.el(td, 'div', 'ticker_status_label', 'Ticker');
		var td = uiu.el(tr, 'td');
		uiu.el(td, 'div', 'ticker_status', '');
		ticker_status_changed({ val: curt.ticker_status });
		var td = uiu.el(tr, 'td');
		if (curt.ticker_enabled) {
			const ticker_push_btn = uiu.el(td, 'button', 'tournament_ticker_push vlink', ci18n('update ticker'));
			ticker_push_btn.addEventListener('click', ui_ticker_push);
		}
	}

	function update_metadata_settings() {
		if (current_view !== 'show') {
			return;
		}
		render_show_toprow();
	}

	function btp_status_changed(c) {
		set_service_status('btp_status', c);
		update_btp_next_fetch_countdown();
	}
	function ticker_status_changed(c) {
		set_service_status('ticker_status', c);
	}

	function bts_status_changed(c) {
		set_service_status('status', c);
	}
	
	function set_service_status(service_id, c) {
		if (c && c.val) {
			if (curt) {
				curt[service_id] = c.val;
			}
			uiu.qsEach('.' + service_id, (div_el) => {
				div_el.className = service_id + ' status_' + c.val.status;
				div_el.title = c.val.message;
			});
			if (service_id !== 'btp_status') {
				update_service_badge(service_id, c);
			}
		}
	}
	
	function _upload_logo(e) {
		const input = e.target;
		if (!input.files.length) return;

		const reader = new FileReader();
		reader.readAsDataURL(input.files[0]);
		reader.onload = () => {
			send_with_live_status({
				type: 'tournament_upload_logo',
				tournament_key: curt.key,
				data_url: reader.result,
				name: e.target.files[0].name,
			}, (err) => {
				if (err) {
					return cerror.net(err);
				}`
				input.closest('form').reset();`
			});
		};
		reader.onerror = (e) => {
			alert('Failed to upload: ' + e);
		};
	}

	function ui_edit() {
		current_view = 'edit';
		crouting.set('t/:key/edit', { key: curt.key });
		render_edit_toprow();
		update_test_clock_body_state();

		const main = uiu.qs('.main');
		uiu.empty(main);

		const form = uiu.el(main, 'div', 'tournament_settings');
		let input = {};
	
		// tournament-div##################################################################################
		{
			const tournament_div = uiu.el(form, 'div', 'settings');
			uiu.el(tournament_div, 'h2', 'edit', ci18n('tournament:edit:tournament'));
			
			const key_label = uiu.el(tournament_div, 'label');
			uiu.el(key_label, 'span', {}, ci18n('tournament:edit:id'));
			uiu.el(key_label, 'input', {
				type: 'text',
				name: 'key',
				readonly: 'readonly',
				disabled: 'disabled',
				title: 'Can not be changed',
				'class': 'uneditable',
				value: curt.key,
			});

			const name_label = uiu.el(tournament_div, 'label');
			uiu.el(name_label, 'span', {}, ci18n('tournament:edit:name'));
				input.name = uiu.el(name_label, 'input', {
				type: 'text',
				name: 'name',
				required: 'required',
				value: curt.name || curt.key,
					'class': 'ct_name',
				});
				bind_live_prop(input.name, 'name', { event_name: 'blur' });


			const name_tguid = uiu.el(tournament_div, 'label');
			uiu.el(name_tguid, 'span', {}, ci18n('tournament:edit:tguid'));
				input.tguid = uiu.el(name_tguid, 'input', {
				type: 'text',
				name: 'tguid',
				value: curt.tguid ? curt.tguid : "",
					'class': 'ct_tguid',
				});
				bind_live_prop(input.tguid, 'tguid', { event_name: 'blur' });

			// Tournament language selection
			const language_label = uiu.el(tournament_div, 'label');
			uiu.el(language_label, 'span', {}, ci18n('tournament:edit:language'));
			const language_select = uiu.el(language_label, 'select', {
				name: 'language',
				required: 'required',
			});
			const all_langs = ci18n.get_all_languages();
			uiu.el(language_select, 'option', { value: 'auto' }, ci18n('tournament:edit:language:auto'));
			for (const l of all_langs) {
				const l_attrs = {
					value: l._code,
				};
				if (l._code === curt.language) {
					l_attrs.selected = 'selected';
				}
				uiu.el(language_select, 'option', l_attrs, l._name);
			}
				input.language = language_select;
				bind_live_prop(input.language, 'language');

			// Team competition?
			const is_team_label = uiu.el(tournament_div, 'label');
			uiu.el(is_team_label, 'span', {}, ci18n('tournament:edit:tournament:type'));
			const is_team_attrs = {
				type: 'checkbox',
				name: 'is_team',
			};
			if (curt.is_team) {
				is_team_attrs.checked = 'checked';
			}

				input.is_team = uiu.el(is_team_label, 'input', is_team_attrs);
				uiu.el(is_team_label, 'span', {}, ci18n('team competition'));
				bind_live_prop(input.is_team, 'is_team');

			// Nation competition?
			const is_nation_competition_label = uiu.el(tournament_div, 'label');
			const is_nation_competition_attrs = {
				type: 'checkbox',
				name: 'is_nation_competition',
			};
			if (curt.is_nation_competition) {
				is_nation_competition_attrs.checked = 'checked';
			}

			uiu.el(is_nation_competition_label, 'span', {}, '');
				input.is_nation_competition = uiu.el(is_nation_competition_label, 'input', is_nation_competition_attrs);
				uiu.el(is_nation_competition_label, 'span', {}, ci18n('nation competition'));
				bind_live_prop(input.is_nation_competition, 'is_nation_competition');

			const clock_fieldset = uiu.el(tournament_div, 'fieldset');
			const clock_mode_label = uiu.el(clock_fieldset, 'label');
			uiu.el(clock_mode_label, 'span', {}, 'Server-Zeitbasis');
			const clock_mode_select = uiu.el(clock_mode_label, 'select', { name: 'test_clock_mode' });
			uiu.el(clock_mode_select, 'option', { value: 'real' }, 'Echtzeit (Produktivmodus)');
			uiu.el(clock_mode_select, 'option', { value: 'fixed' }, 'Fixe Zeit (nur Debug/Test)');
			uiu.el(clock_mode_select, 'option', { value: 'offset' }, 'Offset-Zeit (nur Debug/Test)');

			const clock_real_section = uiu.el(clock_fieldset, 'div', 'hint');
			uiu.text(clock_real_section, 'Produktivmodus: BTS verwendet die aktuelle Serverzeit.');

			const clock_fixed_section = uiu.el(clock_fieldset, 'div');
			const clock_fixed_label = uiu.el(clock_fixed_section, 'label');
			uiu.el(clock_fixed_label, 'span', {}, 'Fixe Zeit');
			const clock_fixed_input = uiu.el(clock_fixed_label, 'input', {
				type: 'datetime-local',
				name: 'test_clock_fixed',
			});

			const clock_offset_section = uiu.el(clock_fieldset, 'div');
			const clock_offset_hint = uiu.el(clock_offset_section, 'div', 'hint');
			uiu.text(clock_offset_hint, 'Wenn eine Zielzeit gesetzt ist, wird daraus der Offset berechnet. Sonst werden die Minuten verwendet.');

			const clock_offset_label = uiu.el(clock_offset_section, 'label');
			uiu.el(clock_offset_label, 'span', {}, 'Offset (Minuten)');
			const clock_offset_input = uiu.el(clock_offset_label, 'input', {
				type: 'number',
				name: 'test_clock_offset_minutes',
				step: '1',
			});

			const clock_offset_target_label = uiu.el(clock_offset_section, 'label');
			uiu.el(clock_offset_target_label, 'span', {}, 'Offset-Zielzeit (optional)');
			const clock_offset_target_input = uiu.el(clock_offset_target_label, 'input', {
				type: 'datetime-local',
				name: 'test_clock_offset_target',
			});

			const clock_actions = uiu.el(clock_fieldset, 'div', 'actions');
			const apply_clock_btn = uiu.el(clock_actions, 'button', { type: 'button' }, 'Übernehmen');
			const freeze_now_btn = uiu.el(clock_actions, 'button', { type: 'button' }, 'Jetzt einfrieren');
			const reset_clock_btn = uiu.el(clock_actions, 'button', { type: 'button' }, 'Echtzeit');
			const clock_status = uiu.el(clock_fieldset, 'div', 'hint');

			test_clock_controls = {
				mode_select: clock_mode_select,
				real_section: clock_real_section,
				fixed_section: clock_fixed_section,
				offset_section: clock_offset_section,
				fixed_input: clock_fixed_input,
				offset_input: clock_offset_input,
				offset_target_input: clock_offset_target_input,
				freeze_now_btn: freeze_now_btn,
				status: clock_status,
			};
			update_test_clock_controls();

			clock_mode_select.addEventListener('change', update_test_clock_mode_visibility);

			apply_clock_btn.addEventListener('click', () => {
				if (clock_mode_select.value === 'fixed') {
					const fixed_ts = Date.parse(clock_fixed_input.value);
					if (!Number.isFinite(fixed_ts)) {
						return cerror.silent('Ungültige fixe Zeit');
					}
					return send_test_clock_update({ mode: 'fixed', fixed_ts }, (err) => err && cerror.net(err));
				}
				if (clock_mode_select.value === 'offset') {
					const offset_target_value = (clock_offset_target_input.value || '').trim();
					if (offset_target_value !== '') {
						const offset_target_ts = Date.parse(offset_target_value);
						if (!Number.isFinite(offset_target_ts)) {
							return cerror.silent('Ungültige Offset-Zielzeit');
						}
						return send_test_clock_update({ mode: 'offset', offset_target_ts }, (err) => err && cerror.net(err));
					}
					const offset_minutes = Number(clock_offset_input.value || 0);
					if (!Number.isFinite(offset_minutes)) {
						return cerror.silent('Ungültiger Offset');
					}
					return send_test_clock_update({ mode: 'offset', offset_ms: offset_minutes * 60000 }, (err) => err && cerror.net(err));
				}
				return send_test_clock_update({ mode: 'real' }, (err) => err && cerror.net(err));
			});

			freeze_now_btn.addEventListener('click', () => {
				send_test_clock_update({ mode: 'fixed', fixed_ts: get_effective_test_clock_now_ms() }, (err) => err && cerror.net(err));
			});

			reset_clock_btn.addEventListener('click', () => {
				send_test_clock_update({ mode: 'real' }, (err) => err && cerror.net(err));
			});
		}

		// btp-connection-div##################################################################################
		{
			const btp_connection_div = uiu.el(form, 'div', 'settings');
			uiu.el(btp_connection_div, 'h2', 'edit', ci18n('tournament:edit:btp_connection'));

			// BTP
			const btp_fieldset = uiu.el(btp_connection_div, 'fieldset');
			const btp_enabled_label = uiu.el(btp_fieldset, 'label');
			const ba_attrs = {
				type: 'checkbox',
				name: 'btp_enabled',
			};
			if (curt.btp_enabled) {
				ba_attrs.checked = 'checked';
			}
				input.btp_enabled = uiu.el(btp_enabled_label, 'input', ba_attrs);
				uiu.el(btp_enabled_label, 'span', {}, ci18n('tournament:edit:btp:enabled'));
				bind_live_prop(input.btp_enabled, 'btp_enabled');

			const btp_autofetch_enabled_label = uiu.el(btp_fieldset, 'label');
			const bae_attrs = {
				type: 'checkbox',
				name: 'btp_autofetch_enabled',
			};
			if (curt.btp_autofetch_enabled) {
				bae_attrs.checked = 'checked';
			}
				input.btp_autofetch_enabled = uiu.el(btp_autofetch_enabled_label, 'input', bae_attrs);
				uiu.el(btp_autofetch_enabled_label, 'span', {}, ci18n('tournament:edit:btp:autofetch_enabled'));
				bind_live_prop(input.btp_autofetch_enabled, 'btp_autofetch_enabled');

			const btp_readonly_label = uiu.el(btp_fieldset, 'label');
			const bro_attrs = {
				type: 'checkbox',
				name: 'btp_readonly',
			};
			if (curt.btp_readonly) {
				bro_attrs.checked = 'checked';
			}
				if (!curt['btp_autofetch_timeout_intervall']) {
					curt['btp_autofetch_timeout_intervall'] = 30000;
				}
				const btp_autofetch_timeout_to_seconds = function(ms) {
					const seconds = Number(ms || 30000) / 1000;
					if (!Number.isFinite(seconds) || seconds <= 0) {
						return '30';
					}
					if (Number.isInteger(seconds)) {
						return String(seconds);
					}
					return String(Math.round(seconds * 1000) / 1000).replace(/\.?0+$/, '');
				};
				const btp_autofetch_timeout_label = uiu.el(btp_connection_div, 'label');
				uiu.el(btp_autofetch_timeout_label, 'span', {}, ci18n('tournament:edit:btp_autofetch_timeout_intervall'));
				input.btp_autofetch_timeout_intervall = uiu.el(btp_autofetch_timeout_label, 'input', {
					type: 'number',
					name: 'btp_autofetch_timeout_intervall',
					min: '1',
					step: '1',
					value: btp_autofetch_timeout_to_seconds(curt.btp_autofetch_timeout_intervall),
				});
				bind_live_prop(input.btp_autofetch_timeout_intervall, 'btp_autofetch_timeout_intervall', {
					get_value: function(input_el) {
						const seconds = Number(input_el.value);
						if (!Number.isFinite(seconds) || seconds <= 0) {
							return 30000;
						}
						return Math.round(seconds * 1000);
					},
					on_error: function(input_el, old_value) {
						input_el.value = btp_autofetch_timeout_to_seconds(old_value);
					},
					on_success: function(input_el, value) {
						input_el.value = btp_autofetch_timeout_to_seconds(value);
					},
				});

				input.btp_readonly = uiu.el(btp_readonly_label, 'input', bro_attrs);
				uiu.el(btp_readonly_label, 'span', {}, ci18n('tournament:edit:btp:readonly'));
				bind_live_prop(input.btp_readonly, 'btp_readonly');

			const btp_ip_label = uiu.el(btp_fieldset, 'label');
			uiu.el(btp_ip_label, 'span', {}, ci18n('tournament:edit:btp:ip'));
				input.btp_ip = uiu.el(btp_ip_label, 'input', {
				type: 'text',
				name: 'btp_ip',
					value: (curt.btp_ip || ''),
				});
				bind_live_prop(input.btp_ip, 'btp_ip', { event_name: 'blur' });

			const btp_password_label = uiu.el(btp_fieldset, 'label');
			uiu.el(btp_password_label, 'span', {}, ci18n('tournament:edit:btp:password'));
				input.btp_password = uiu.el(btp_password_label, 'input', {
				type: 'text',
				name: 'btp_password',
					value: (curt.btp_password || ''),
				});
				bind_live_prop(input.btp_password, 'btp_password', { event_name: 'blur' });

			// BTP timezone
			const btp_timezone_label = uiu.el(btp_fieldset, 'label');
			uiu.el(btp_timezone_label, 'span', {}, ci18n('tournament:edit:btp:timezone'));
			const btp_timezone_select = uiu.el(btp_timezone_label, 'select', {
				name: 'btp_timezone',
			});
			uiu.el(
				btp_timezone_select, 'option', { value: 'system' },
				ci18n('tournament:edit:btp:system timezone', { tz: curt.system_timezone }));
			let marked = false;
			for (const tz of timezones.ALL_TIMEZONES) {
				const attrs = {
					value: tz,
				}

				if ((tz === curt.btp_timezone) && !marked) {
					marked = true;
					attrs.selected = 'selected';
				}

				uiu.el(btp_timezone_select, 'option', attrs, tz);
			}
				input.btp_timezone = btp_timezone_select;
				bind_live_prop(input.btp_timezone, 'btp_timezone');
		}		

		// tournament-flow-div##################################################################################
		{
			const tournament_flow_div = uiu.el(form, 'div', 'settings');
			uiu.el(tournament_flow_div, 'h2', 'edit', ci18n('tournament:edit:tournament_flow'));
			// Warmup Timer
			if (!curt.warmup_ready) {
				curt.warmup_ready = 150;
			}

			if (!curt.warmup_start) {
				curt.warmup_start = 180;
			}

			var warmup_options = [['bwf-2016', 90, 120, true],
				['legacy', 120, 120, true],
				['choise', curt.warmup_ready, curt.warmup_start, false],
				['call-down', curt.warmup_ready, curt.warmup_start, false],
				['call-up', 0, 0, true],
				['none', 0, 0, true]];

			var last_selected_warmup = warmup_options[0];

			const warmup_timer_label = uiu.el(tournament_flow_div, 'label');
			uiu.el(warmup_timer_label, 'span', {}, ci18n('tournament:edit:warmup_timer_behavior'));
			const warmup_timer_select = uiu.el(warmup_timer_label, 'select', {
				name: 'warmup',
			});
			uiu.el(warmup_timer_select, 'option', { value: warmup_options[0][0] }, ci18n('tournament:edit:warmup_timer_behavior:' + warmup_options[0][0]), { wo: warmup_options[0][0] });
			let warmup_marked = false;
				input.warmup = warmup_timer_select;

			const warmup_ready = uiu.el(tournament_flow_div, 'label');
			uiu.el(warmup_ready, 'span', {}, ci18n('tournament:edit:warmup_ready'));
			var warmup_ready_input = uiu.el(warmup_ready, 'input', {
				type: 'number',
				name: 'warmup_ready',
				required: 'required',
				disabled: warmup_options[0][3],
				value: warmup_options[0][1],
			});
				input.warmup_ready = warmup_ready_input;
				bind_live_prop(input.warmup_ready, 'warmup_ready', {
					get_value: input_el => Number(input_el.value),
				});

			const warmup_start = uiu.el(tournament_flow_div, 'label');
			uiu.el(warmup_start, 'span', {}, ci18n('tournament:edit:warmup_start'));
			var warmup_start_input = uiu.el(warmup_start, 'input', {
				type: 'number',
				name: 'warmup_start',
				required: 'required',
				disabled: warmup_options[0][3],
				value: warmup_options[0][2],
			});
				input.warmup_start = warmup_start_input;
				bind_live_prop(input.warmup_start, 'warmup_start', {
					get_value: input_el => Number(input_el.value),
				});

			for (const wo of warmup_options.slice(1)) {
				const attrs = {
					value: wo[0],
				}
	
				if ((wo[0] === curt.warmup) && !warmup_marked) {
					warmup_marked = true;
					attrs.selected = 'selected';
	
					warmup_ready_input.value = wo[1];
					warmup_ready_input.disabled = wo[3];
					warmup_start_input.value = wo[2];
					warmup_start_input.disabled = wo[3];
	
					last_selected_warmup = wo;
				}
	
				uiu.el(warmup_timer_select, 'option', attrs, ci18n('tournament:edit:warmup_timer_behavior:' + wo[0]));
			}
	
				warmup_timer_select.onchange = function () {
				if (!last_selected_warmup[3]) {
					for (const wo of warmup_options) {
						if (!wo[3]) {
							wo[1] = warmup_ready_input.value;
							wo[2] = warmup_start_input.value;
						}
					}
				}
	
				for (const wo of warmup_options) {
					if (warmup_timer_select.value == wo[0]) {
						warmup_ready_input.value = wo[1];
						warmup_ready_input.disabled = wo[3];
						warmup_start_input.value = wo[2];
						warmup_start_input.disabled = wo[3];
	
							last_selected_warmup = wo;
						}
					}
					send_single_prop('warmup', warmup_timer_select.value, function(err) {
						if (err) {
							return cerror.net(err);
						}
					});
					send_single_prop('warmup_ready', Number(warmup_ready_input.value), function(err) {
						if (err) {
							return cerror.net(err);
						}
					});
					send_single_prop('warmup_start', Number(warmup_start_input.value), function(err) {
						if (err) {
							return cerror.net(err);
						}
					});
				};

			const bts_fieldset = uiu.el(tournament_flow_div, 'fieldset', 'automation_group_box');
			const bts_legend = uiu.el(bts_fieldset, 'legend');
			input.call_preparation_matches_automatically_enabled = uiu.el(bts_legend, 'input', {
				type: 'checkbox',
				name: 'call_preparation_matches_automatically_enabled',
			});
			if (curt.call_preparation_matches_automatically_enabled) {
				input.call_preparation_matches_automatically_enabled.checked = true;
			}
			uiu.el(bts_legend, 'span', {}, ci18n('tournament:edit:call_preparation_matches_automatically_enabled'));
			bind_live_prop(input.call_preparation_matches_automatically_enabled, 'call_preparation_matches_automatically_enabled');
			input.preparation_successor_rally_count = create_numeric_input(curt, bts_fieldset, 'preparation_successor_rally_count', 1, 100, 11, 1);
			input.preparation_call_player_pause_expired_enabled = create_checkbox(curt, bts_fieldset, 'preparation_call_player_pause_expired_enabled', 'automation_suboption_checkbox');
			input.preparation_call_no_player_waiting_as_tabletoperator_enabled = create_checkbox(curt, bts_fieldset, 'preparation_call_no_player_waiting_as_tabletoperator_enabled', 'automation_suboption_checkbox');
			input.preparation_call_no_player_active_as_tabletoperator_enabled = create_checkbox(curt, bts_fieldset, 'preparation_call_no_player_active_as_tabletoperator_enabled', 'automation_suboption_checkbox');
			input.preparation_call_technical_officials_available_enabled = create_checkbox(curt, bts_fieldset, 'preparation_call_technical_officials_available_enabled', 'automation_suboption_checkbox');
			input.preparation_call_technical_officials_available_hint = uiu.el(bts_fieldset, 'div', 'automation_suboption_hint');
			{
				const rule = create_rule_limit_input(curt, bts_fieldset, 'preparation_call_time_limit_before_scheduled_enabled', 'preparation_call_time_limit_before_scheduled_minutes', 30, 0, 180, 1, 'tournament:edit:minutes');
				input.preparation_call_time_limit_before_scheduled_enabled = rule.enabled_input;
				input.preparation_call_time_limit_before_scheduled_minutes = rule.value_input;
			}
			{
				const rule = create_rule_limit_input(curt, bts_fieldset, 'preparation_call_block_ahead_limit_enabled', 'preparation_call_block_ahead_limit', 1, 0, 10, 1, null);
				input.preparation_call_block_ahead_limit_enabled = rule.enabled_input;
				input.preparation_call_block_ahead_limit = rule.value_input;
			}
			{
				const rule = create_rule_limit_input(curt, bts_fieldset, 'preparation_call_time_ahead_of_frontier_enabled', 'preparation_call_time_ahead_of_frontier_minutes', 30, 0, 180, 1, 'tournament:edit:minutes');
				input.preparation_call_time_ahead_of_frontier_enabled = rule.enabled_input;
				input.preparation_call_time_ahead_of_frontier_minutes = rule.value_input;
			}
			{
				const rule = create_rule_limit_input(curt, bts_fieldset, 'preparation_call_matches_ahead_of_frontier_enabled', 'preparation_call_matches_ahead_of_frontier_limit', 1, 0, 50, 1, null);
				input.preparation_call_matches_ahead_of_frontier_enabled = rule.enabled_input;
				input.preparation_call_matches_ahead_of_frontier_limit = rule.value_input;
			}
			const free_courts_fieldset = uiu.el(tournament_flow_div, 'fieldset', 'automation_group_box');
			const free_courts_legend = uiu.el(free_courts_fieldset, 'legend');
			input.call_next_possible_scheduled_match_in_preparation = uiu.el(free_courts_legend, 'input', {
				type: 'checkbox',
				name: 'call_next_possible_scheduled_match_in_preparation',
			});
			if (curt.call_next_possible_scheduled_match_in_preparation) {
				input.call_next_possible_scheduled_match_in_preparation.checked = true;
			}
			uiu.el(free_courts_legend, 'span', {}, ci18n('tournament:edit:call_next_possible_scheduled_match_in_preparation'));
			bind_live_prop(input.call_next_possible_scheduled_match_in_preparation, 'call_next_possible_scheduled_match_in_preparation');
			{
				const rule = create_rule_limit_input(curt, free_courts_fieldset, 'call_on_court_only_preparation_enabled', 'call_on_court_only_preparation_minutes', 0, 0, 180, 1, 'tournament:edit:minutes');
				input.call_on_court_only_preparation_enabled = rule.enabled_input;
				input.call_on_court_only_preparation_minutes = rule.value_input;
			}
			input.call_on_court_participant_readiness_mode = create_rule_select_input(curt, free_courts_fieldset, 'call_on_court_participant_readiness_mode', ['disabled', 'checked_in', 'pause_expired'], () => {
				if (curt.call_on_court_player_pause_expired_enabled === true) {
					return 'pause_expired';
				}
				return 'disabled';
			});
			input.call_on_court_technical_officials_mode = create_rule_select_input(curt, free_courts_fieldset, 'call_on_court_technical_officials_mode', ['disabled', 'checked_in', 'available'], () => 'disabled');
			input.call_on_court_require_official_space_enabled = create_checkbox(curt, input.call_on_court_technical_officials_mode.rule_box, 'call_on_court_require_official_space_enabled');
			input.call_on_court_technical_officials_hint = uiu.el(input.call_on_court_technical_officials_mode.rule_box, 'div', 'automation_suboption_hint');
			{
				const rule = create_rule_limit_input(curt, free_courts_fieldset, 'call_on_court_time_limit_before_scheduled_enabled', 'call_on_court_time_limit_before_scheduled_minutes', 30, 0, 180, 1, 'tournament:edit:minutes');
				input.call_on_court_time_limit_before_scheduled_enabled = rule.enabled_input;
				input.call_on_court_time_limit_before_scheduled_minutes = rule.value_input;
			}
			{
				const rule = create_rule_limit_input(curt, free_courts_fieldset, 'call_on_court_block_ahead_limit_enabled', 'call_on_court_block_ahead_limit', 1, 0, 10, 1, null);
				input.call_on_court_block_ahead_limit_enabled = rule.enabled_input;
				input.call_on_court_block_ahead_limit = rule.value_input;
			}
			{
				const rule = create_rule_limit_input(curt, free_courts_fieldset, 'call_on_court_time_ahead_of_frontier_enabled', 'call_on_court_time_ahead_of_frontier_minutes', 30, 0, 180, 1, 'tournament:edit:minutes');
				input.call_on_court_time_ahead_of_frontier_enabled = rule.enabled_input;
				input.call_on_court_time_ahead_of_frontier_minutes = rule.value_input;
			}
			{
				const rule = create_rule_limit_input(curt, free_courts_fieldset, 'call_on_court_matches_ahead_of_frontier_enabled', 'call_on_court_matches_ahead_of_frontier_limit', 1, 0, 50, 1, null);
				input.call_on_court_matches_ahead_of_frontier_enabled = rule.enabled_input;
				input.call_on_court_matches_ahead_of_frontier_limit = rule.value_input;
			}

			const tablet_fieldset = uiu.el(tournament_flow_div, 'fieldset', 'automation_group_box');
			const tablet_legend = uiu.el(tablet_fieldset, 'legend');
			input.tabletoperator_enabled = uiu.el(tablet_legend, 'input', {
				type: 'checkbox',
				name: 'tabletoperator_enabled',
			});
			if (curt.tabletoperator_enabled) {
				input.tabletoperator_enabled.checked = true;
			}
			uiu.el(tablet_legend, 'span', {}, ci18n('tournament:edit:tabletoperator_enabled'));
			bind_live_prop(input.tabletoperator_enabled, 'tabletoperator_enabled');
			input.tabletoperator_with_umpire_enabled                = create_checkbox(curt, tablet_fieldset, 'tabletoperator_with_umpire_enabled');
			input.tabletoperator_winner_of_quaterfinals_enabled     = create_checkbox(curt, tablet_fieldset, 'tabletoperator_winner_of_quaterfinals_enabled');
			input.tabletoperator_use_manual_counting_boards_enabled = create_checkbox(curt, tablet_fieldset, 'tabletoperator_use_manual_counting_boards_enabled');
			input.tabletoperator_split_doubles                      = create_checkbox(curt, tablet_fieldset, 'tabletoperator_split_doubles');
			input.tabletoperator_assignment_scope                   = create_rule_select_input(curt, tablet_fieldset, 'tabletoperator_assignment_scope', ['any', 'same_location', 'same_court'], () => 'any');
			input.tabletoperator_with_state_enabled                 = create_checkbox(curt, tablet_fieldset, 'tabletoperator_with_state_enabled');
			input.tabletoperator_with_state_from_match_enabled      = create_checkbox(curt, tablet_fieldset, 'tabletoperator_with_state_from_match_enabled');
			input.tabletoperator_set_break_after_tabletservice      = create_checkbox(curt, tablet_fieldset, 'tabletoperator_set_break_after_tabletservice');

			if (!curt.tabletoperator_break_seconds) {
				curt.tabletoperator_break_seconds = 300;
			}
			input.tabletoperator_break_seconds                      = create_input(curt, "number", tablet_fieldset, 'tabletoperator_break_seconds')
		
		}


		// scoring-formats-div##############################################################################
		{
		const scoring_div = uiu.el(form, "div", "settings");
		scoring_formats_main = scoring_div;
		render_scoring_formats(scoring_div);
		render_stages_scoring_formats(scoring_div)
		}



		// call-div##################################################################################
		{
			const call_div = uiu.el(form, 'div', 'settings');
			uiu.el(call_div, 'h2', 'edit', ci18n('tournament:edit:calls'));
			
			const announcements_fieldset = uiu.el(call_div, 'fieldset');
			input.annoncement_include_event = create_checkbox(curt, announcements_fieldset, 'annoncement_include_event');
			input.annoncement_include_round = create_checkbox(curt, announcements_fieldset, 'annoncement_include_round');
			input.annoncement_include_matchnumber = create_checkbox(curt, announcements_fieldset, 'annoncement_include_matchnumber');
			input.no_match_cascade_announcements_enabled = create_checkbox(curt, announcements_fieldset, 'no_match_cascade_announcements_enabled');
			input.preparation_meetingpoint_enabled = create_checkbox(curt, announcements_fieldset, 'preparation_meetingpoint_enabled');
			input.preparation_tabletoperator_setup_enabled = create_checkbox(curt, announcements_fieldset, 'preparation_tabletoperator_setup_enabled');

			input.announcement_speed = create_numeric_input(curt, call_div, 'announcement_speed', 0.8, 1.3, 1.05, 0.01);
			input.announcement_pause_time_ms = create_numeric_input(curt, call_div, 'announcement_pause_time_ms', 0.0, 5.0, 2.0, 0.1);

			render_normalisation_values(uiu.el(call_div, 'div','normalizations_values_div'));

		
		}

		// upcoming-div ###################################################################################################
		{
			const upcoming_div = uiu.el(form, 'div', 'settings');
			uiu.el(upcoming_div, 'h2', 'edit', ci18n('tournament:edit:upcoming_matches_settings'));

			const upcoming_fieldset = uiu.el(upcoming_div, 'fieldset');
			input.upcoming_animation_speed = create_numeric_input(curt, upcoming_fieldset, 'upcoming_matches_animation_speed', 0, 10, 2, 1);
			input.upcoming_animation_pause = create_numeric_input(curt, upcoming_fieldset, 'upcoming_matches_animation_pause', 1, 20, 4, 1);
			input.upcoming_matches_max_count = create_numeric_input(curt, upcoming_fieldset, 'upcoming_matches_max_count', 10, 50, 15, 1);
			input.upcoming_matches_today_only_enabled = create_checkbox(curt, upcoming_fieldset, 'upcoming_matches_today_only_enabled');
			input.self_check_in_called_overlay_duration_ms = create_duration_seconds_input(curt, upcoming_fieldset, 'self_check_in_called_overlay_duration_ms', 1, 60, 12, 0.5);
		}

		// officials_host ######################################################################################################
		const officials_host = uiu.el(form, 'div', { id: 'officials_host' });
		update_official_tables(officials_host);  // initial + später auch für Updates

		
		
		// devices-div##################################################################################
		{
			const devices_div = uiu.el(form, 'div', 'settings');
			uiu.el(devices_div, 'h2', 'edit', ci18n('tournament:edit:devices'));
			
			render_logo_preview(devices_div);

			const default_display_fieldset = uiu.el(devices_div, 'fieldset');
			// Default display
			const displaysettings_style_label = uiu.el(default_display_fieldset, 'label');
			uiu.el(displaysettings_style_label, 'span', {}, ci18n('tournament:edit:displaysettings_general'));

				input.displaysettings_general = createGeneralDisplaySettingsSelectBox(displaysettings_style_label, curt.displaysettings_general ? curt.displaysettings_general : "default", {
					filterFn: (displaysetting) => displaysetting.devicemode === 'display',
				});
				bind_live_prop(input.displaysettings_general, 'displaysettings_general');

			const tablet_displaysettings_style_label = uiu.el(default_display_fieldset, 'label');
			uiu.el(tablet_displaysettings_style_label, 'span', {}, ci18n('tournament:edit:displaysettings_general_tablet'));

			input.displaysettings_general_tablet = createGeneralDisplaySettingsSelectBox(tablet_displaysettings_style_label, curt.displaysettings_general_tablet || "", {
					fieldName: 'displaysettings_general_tablet',
					filterFn: (displaysetting) => displaysetting.devicemode === 'umpire',
				});
				bind_live_prop(input.displaysettings_general_tablet, 'displaysettings_general_tablet');

			input.bupws_v2_enabled = create_checkbox(curt, default_display_fieldset, 'bupws_v2_enabled');
			input.bup_v2_admin_wait_for_score_updates = create_checkbox(curt, default_display_fieldset, 'bup_v2_admin_wait_for_score_updates');

			const general_displaysettings_div = uiu.el(devices_div, 'div', 'general_displaysettings');
			render_general_displaysettings(general_displaysettings_div);
			render_displaysettings(devices_div);
		}

		// debug-div##################################################################################
		{
			const debug_div = uiu.el(form, 'div', 'settings');
			uiu.el(debug_div, 'h2', 'edit', ci18n('tournament:edit:debug_output'));
			const debug_fieldset = uiu.el(debug_div, 'fieldset');
			uiu.el(debug_fieldset, 'div', 'hint', ci18n('tournament:edit:debug_output_hint'));
			input.bts_debug_output_enabled = create_checkbox(curt, debug_fieldset, 'bts_debug_output_enabled');
			uiu.el(debug_fieldset, 'div', 'hint', ci18n('tournament:edit:bts_debug_output_enabled:hint'));
			input.bts_auto_call_trace_enabled = create_checkbox(curt, debug_fieldset, 'bts_auto_call_trace_enabled');
			uiu.el(debug_fieldset, 'div', 'hint', ci18n('tournament:edit:bts_auto_call_trace_enabled:hint'));
			function create_preparation_debug_checkbox(field) {
				const label = uiu.el(debug_fieldset, 'label');
				input[field] = uiu.el(label, 'input', {
					type: 'checkbox',
					name: field,
					checked: curt[field] ? 'checked' : undefined,
				});
				uiu.el(label, 'span', {}, ci18n('tournament:edit:' + field));
				bind_live_prop(input[field], field, {
					on_success: function() {
						uiu.qsEach('.unassigned_container', function(unassigned_container) {
							cmatch.render_unassigned(unassigned_container);
						});
					},
				});
				uiu.el(debug_fieldset, 'div', 'hint', ci18n('tournament:edit:' + field + ':hint'));
			}
			create_preparation_debug_checkbox('preparation_call_debug_output_enabled');
			create_preparation_debug_checkbox('preparation_call_debug_icons_enabled');
		}


		// advertisement-div##################################################################################
		{
			const advertisement_div = uiu.el(form, 'div', 'settings');
			render_advertisements(advertisement_div);
		}


		
		// location-div##################################################################################
		{
			const location_div = uiu.el(form, 'div', 'settings location_settings_section');
			render_locations(location_div);
			render_courts(location_div);
		}

		// ticker-connection-div##################################################################################
		{
			const ticker_div = uiu.el(form, 'div', 'settings');
			uiu.el(ticker_div, 'h2', 'edit', ci18n('tournament:edit:ticker_connection'));
			
			const ticker_fieldset = uiu.el(ticker_div, 'fieldset');
			const ticker_enabled_label = uiu.el(ticker_fieldset, 'label');
			const te_attrs = {
				type: 'checkbox',
				name: 'ticker_enabled',
			};
			if (curt.ticker_enabled) {
				te_attrs.checked = 'checked';
			}
				input.ticker_enabled = uiu.el(ticker_enabled_label, 'input', te_attrs);
				uiu.el(ticker_enabled_label, 'span', {}, ci18n('tournament:edit:ticker_enabled'));
				bind_live_prop(input.ticker_enabled, 'ticker_enabled');
	
			const ticker_url_label = uiu.el(ticker_fieldset, 'label');
			uiu.el(ticker_url_label, 'span', {}, ci18n('tournament:edit:ticker_url'));
				input.ticker_url = uiu.el(ticker_url_label, 'input', {
				type: 'text',
				name: 'ticker_url',
					value: (curt.ticker_url || ''),
				});
				bind_live_prop(input.ticker_url, 'ticker_url', { event_name: 'blur' });
	
			const ticker_password_label = uiu.el(ticker_fieldset, 'label');
			uiu.el(ticker_password_label, 'span', {}, ci18n('tournament:edit:ticker_password'));
				input.ticker_password = uiu.el(ticker_password_label, 'input', {
				type: 'text',
				name: 'ticker_password',
					value: (curt.ticker_password || ''),
				});
				bind_live_prop(input.ticker_password, 'ticker_password', { event_name: 'blur' });
		}

			// save-div##################################################################################
			{
				const save_div = uiu.el(form, 'div', 'settings');
				uiu.el(save_div, 'h2', 'edit', ci18n('tournament:edit'));
				live_settings_pending_requests = 0;
				live_settings_status_el = uiu.el(save_div, 'div', {
					class: 'live_settings_status live_settings_status_saved',
				}, ci18n('tournament:edit:live_status:saved'));

				const back_btn = uiu.el(save_div, 'button', {
					role: 'button',
				}, ci18n('Back'));
				back_btn.addEventListener('click', () => {
					ui_show();
				});

				const reset_hint = uiu.el(save_div, 'p', {
					class: 'tournament_reset_hint',
				}, ci18n('tournament:edit:reset:hint'));
				reset_hint.style.maxWidth = '60em';

				const reset_btn = uiu.el(save_div, 'button', {
					type: 'button',
					class: 'tournament_reset_button',
				}, ci18n('tournament:edit:reset'));
				reset_btn.addEventListener('click', () => {
					const expected = curt.key || 'default';
					if (!window.confirm(ci18n('tournament:edit:reset:confirm'))) {
						return;
					}
					const entered = window.prompt(ci18n('tournament:edit:reset:prompt').replace('{key}', expected), '');
					if (entered !== expected) {
						if (entered != null) {
							window.alert(ci18n('tournament:edit:reset:cancelled'));
						}
						return;
					}
					send_with_live_status({
						type: 'tournament_reset',
						tournament_key: curt.key,
					}, (err) => {
						if (err) {
							return cerror.net(err);
						}
						refresh_current_view();
					});
				});

				const pause_reset_hint = uiu.el(save_div, 'p', {
					class: 'player_pause_reset_hint',
				}, ci18n('tournament:edit:player_pause_reset:hint'));
				pause_reset_hint.style.maxWidth = '60em';

				const pause_reset_btn = uiu.el(save_div, 'button', {
					type: 'button',
					name: 'player_pause_reset',
					class: 'player_pause_reset_button',
				}, ci18n('tournament:edit:player_pause_reset'));
				pause_reset_btn.addEventListener('click', () => {
					if (!window.confirm(ci18n('tournament:edit:player_pause_reset:confirm'))) {
						return;
					}
					send_with_live_status({
						type: 'player_pause_reset',
						tournament_key: curt.key,
					}, (err) => {
						if (err) {
							return cerror.net(err);
						}
						refresh_current_view();
					});
				});
			}		
			update_edit_dependencies();
		}
	_route_single(/t\/([a-z0-9]+)\/edit$/, ui_edit, change.default_handler(_update_all_ui_elements_edit, {
		update_general_displaysettings: update_general_displaysettings,
		update_player_status: update_player_status,
		btp_status: btp_status_changed,
		ticker_status: ticker_status_changed,
	}));

		function update_scoring_formats() {
		if (!scoring_formats_main) {
			if (typeof debug !== "undefined" && debug?.log) {
				debug.log("update_scoring_formats: main container not initialized");	
			}
			return;
		}

		// kompletten Bereich leeren
		while (scoring_formats_main.firstChild) {
			scoring_formats_main.removeChild(scoring_formats_main.firstChild);
		}

		// vollständig neu rendern
		render_scoring_formats(scoring_formats_main);
		render_stages_scoring_formats(scoring_formats_main);
	}

	function format_duration_ms(durationMs) {
		const duration = Number(durationMs);
		if (!Number.isFinite(duration) || duration < 0) {
			return "—";
		}
		if (duration === 0) {
			return "0 s";
		}
		return `${Math.round(duration / 1000)} s`;
	}

	function format_set_rule_summary(setPoints) {
		if (!setPoints) {
			return "—";
		}

		const endPoints = setPoints.end_points ?? "—";
		const maxPoints = setPoints.max_points ?? "—";
		return `${endPoints} / ${maxPoints}`;
	}

	function parse_nullable_number(value) {
		if (value === undefined || value === null || value === "") {
			return null;
		}
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function duration_ms_to_seconds(value) {
		const duration = parse_nullable_number(value);
		if (duration === null) {
			return "";
		}
		return duration / 1000;
	}

	function duration_seconds_to_ms(value) {
		const duration = parse_nullable_number(value);
		if (duration === null) {
			return null;
		}
		return duration * 1000;
	}

	function is_break_in_set_enabled(setPoints) {
		if (!setPoints) {
			return false;
		}
		if (typeof setPoints.interval_enabled === "boolean") {
			return setPoints.interval_enabled;
		}
		return (
			setPoints.interval_at !== null &&
			setPoints.interval_at !== undefined &&
			setPoints.interval_duration_ms !== null &&
			setPoints.interval_duration_ms !== undefined
		);
	}

	function clone_scoring_formats() {
		const scoringFormats = curt?.scoring_formats || { formats: [], default_id: null };
		return structuredClone(scoringFormats);
	}

	function _cancel_ui_edit_scoring_format() {
		const dlg = document.querySelector('.scoring_format_edit_dialog');
		if (!dlg) {
			return;
		}
		cbts_utils.esc_stack_pop();
		uiu.remove(dlg);
	}

	function close_scoring_format_dialog_if_open(scoringFormatId, reason_i18n_key) {
		const dlg = document.querySelector('.scoring_format_edit_dialog');
		if (!dlg) {
			return false;
		}
		const open_id = dlg.getAttribute('data-scoring-format-id');
		if (typeof scoringFormatId !== 'undefined' && scoringFormatId !== null && Number(open_id) !== Number(scoringFormatId)) {
			return false;
		}
		_cancel_ui_edit_scoring_format();
		if (reason_i18n_key) {
			const reason_text = ci18n(reason_i18n_key);
			if (!set_live_settings_status_message(reason_text, 'error')) {
				cerror.silent(reason_text);
			}
		}
		return true;
	}

	function create_scoring_format_field(parent, label, name, value, type = "text", attrs = {}) {
		const row = uiu.el(parent, 'label', 'scoring_format_edit_row');
		uiu.el(row, 'span', {}, label);
		return uiu.el(row, 'input', Object.assign({
			type,
			name,
			value: value ?? '',
		}, attrs));
	}

	function create_scoring_format_checkbox(parent, label, name, checked) {
		const row = uiu.el(parent, 'label', 'scoring_format_edit_row');
		uiu.el(row, 'span', {}, label);
		const attrs = {
			type: 'checkbox',
			name,
		};
		if (checked) {
			attrs.checked = 'checked';
		}
		return uiu.el(row, 'input', attrs);
	}

	function is_scoring_value_editable(setPoints, fieldName) {
		return !!(setPoints && setPoints[`${fieldName}_editable`]);
	}

	function render_scoring_format_edit_section(parent, prefix, title, setPoints) {
		const fieldset = uiu.el(parent, 'fieldset', 'scoring_format_edit_section');
		uiu.el(fieldset, 'legend', {}, title);
		const endPointAttrs = { min: 1, step: 1 };
		if (!is_scoring_value_editable(setPoints, "end_points")) {
			endPointAttrs.disabled = 'disabled';
		} else {
			endPointAttrs.required = 'required';
		}
		const maxPointAttrs = { min: 1, step: 1 };
		if (!is_scoring_value_editable(setPoints, "max_points")) {
			maxPointAttrs.disabled = 'disabled';
		} else {
			maxPointAttrs.required = 'required';
		}
		const endPointsInput = create_scoring_format_field(fieldset, ci18n("tournament:edit:scoring_formats:end_points_label"), `${prefix}_end_points`, setPoints?.end_points, "number", endPointAttrs);
		const maxPointsInput = create_scoring_format_field(fieldset, ci18n("tournament:edit:scoring_formats:max_points"), `${prefix}_max_points`, setPoints?.max_points, "number", maxPointAttrs);
		const hasBreakInSet = is_break_in_set_enabled(setPoints);
		const breakEnabled = create_scoring_format_checkbox(fieldset, ci18n("tournament:edit:scoring_formats:break_in_set_enabled"), `${prefix}_break_in_set_enabled`, hasBreakInSet);
		const intervalAtInput = create_scoring_format_field(fieldset, ci18n("tournament:edit:scoring_formats:interval_at"), `${prefix}_interval_at`, setPoints?.interval_at, "number", { min: 0, step: 1 });
		const intervalDurationInput = create_scoring_format_field(fieldset, `${ci18n("tournament:edit:scoring_formats:interval_duration")} (s)`, `${prefix}_interval_duration_s`, duration_ms_to_seconds(setPoints?.interval_duration_ms), "number", { min: 0, step: 1 });
		create_scoring_format_field(fieldset, `${ci18n("tournament:edit:scoring_formats:break_before_set")} (s)`, `${prefix}_break_before_set_duration_s`, duration_ms_to_seconds(setPoints?.break_before_set_duration_ms), "number", { min: 0, step: 1 });

		function normalizeScoreInputs() {
			if (!endPointsInput.disabled) {
				let endPoints = Number(endPointsInput.value);
				if (!Number.isFinite(endPoints) || endPoints < 1) {
					endPoints = Math.max(1, Number(setPoints?.end_points) || 1);
				}
				endPointsInput.value = String(endPoints);
				if (!maxPointsInput.disabled) {
					maxPointsInput.min = String(endPoints);
					let maxPoints = Number(maxPointsInput.value);
					if (!Number.isFinite(maxPoints) || maxPoints < endPoints) {
						maxPoints = endPoints;
					}
					maxPointsInput.value = String(maxPoints);
				}
			} else if (!maxPointsInput.disabled) {
				let maxPoints = Number(maxPointsInput.value);
				const minValue = Math.max(1, Number(setPoints?.end_points) || 1);
				maxPointsInput.min = String(minValue);
				if (!Number.isFinite(maxPoints) || maxPoints < minValue) {
					maxPointsInput.value = String(minValue);
				}
			}
		}

		if (!endPointsInput.disabled) {
			endPointsInput.addEventListener('input', normalizeScoreInputs);
			endPointsInput.addEventListener('blur', normalizeScoreInputs);
		}
		if (!maxPointsInput.disabled) {
			maxPointsInput.addEventListener('input', normalizeScoreInputs);
			maxPointsInput.addEventListener('blur', normalizeScoreInputs);
		}
		normalizeScoreInputs();

		function updateBreakInSetUi() {
			const enabled = breakEnabled.checked;
			intervalAtInput.disabled = !enabled;
			intervalDurationInput.disabled = !enabled;
		}

		breakEnabled.addEventListener('change', updateBreakInSetUi);
		updateBreakInSetUi();
	}

	function scoring_format_from_form_data(baseFormat, data) {
		const scoringFormat = structuredClone(baseFormat);

		function update_set_points(target, prefix) {
			if (is_scoring_value_editable(target, "end_points")) {
				target.end_points = Math.max(1, Number(data[`${prefix}_end_points`]));
			}
			if (is_scoring_value_editable(target, "max_points")) {
				const minPoints = Math.max(1, Number(target.end_points));
				target.max_points = Math.max(minPoints, Number(data[`${prefix}_max_points`]));
			}
			const hasBreakInSet = !!data[`${prefix}_break_in_set_enabled`];
			target.interval_enabled = hasBreakInSet;
			if (hasBreakInSet) {
				target.interval_at = parse_nullable_number(data[`${prefix}_interval_at`]);
				target.interval_duration_ms = duration_seconds_to_ms(data[`${prefix}_interval_duration_s`]);
			}
			target.break_before_set_duration_ms = duration_seconds_to_ms(data[`${prefix}_break_before_set_duration_s`]);
		}

		update_set_points(scoringFormat.set_points, 'set_points');
		update_set_points(scoringFormat.last_set_points, 'last_set_points');
		return scoringFormat;
	}

	function save_scoring_format(scoringFormatId, scoringFormat, callback) {
		send_with_live_status({
			type: 'tournament_edit_scoring_format',
			key: curt.key,
			scoring_format: scoringFormat,
		}, callback);
	}

	function ui_edit_scoring_format(scoringFormatId) {
		const scoringFormats = curt?.scoring_formats;
		const baseFormat = structuredClone(utils.find((scoringFormats && scoringFormats.formats) || [], f => Number(f.id) === Number(scoringFormatId)));
		if (!baseFormat) {
			return;
		}

		cbts_utils.esc_stack_push(_cancel_ui_edit_scoring_format);

		const body = uiu.qs('body');
		const dialogBg = uiu.el(body, 'div', 'dialog_bg scoring_format_edit_dialog', {
			'data-scoring-format-id': scoringFormatId,
		});
		dialogBg.addEventListener('click', (e) => {
			if (e.target === dialogBg) {
				_cancel_ui_edit_scoring_format();
			}
		});

		const dialog = uiu.el(dialogBg, 'div', 'dialog');
		uiu.el(dialog, 'h3', {}, ci18n('tournament:edit:scoring_formats:dialog_title'));

		const form = uiu.el(dialog, 'form');
		const container = uiu.el(form, 'div', 'scoring_format_edit_container');
		uiu.el(container, 'div', 'hint', ci18n('tournament:edit:scoring_formats:dialog_hint'));
		create_scoring_format_field(container, ci18n("tournament:edit:scoring_formats:name"), 'name', baseFormat.name, 'text', { disabled: 'disabled' });
		create_scoring_format_field(container, ci18n("tournament:edit:scoring_formats:num_sets"), 'numSets', baseFormat.numSets, 'number', { min: 1, step: 1, disabled: 'disabled' });
		render_scoring_format_edit_section(container, 'set_points', ci18n("tournament:edit:scoring_formats:regular_sets"), baseFormat.set_points);
		render_scoring_format_edit_section(container, 'last_set_points', ci18n("tournament:edit:scoring_formats:last_set"), baseFormat.last_set_points);

		const buttons = uiu.el(form, 'div', { style: 'margin-top: 2em;' });
		uiu.el(buttons, 'button', {
			'class': 'match_save_button',
			role: 'submit',
		}, ci18n('Change'));

		form_utils.onsubmit(form, function(data) {
			const scoringFormat = scoring_format_from_form_data(baseFormat, data);
			save_scoring_format(scoringFormatId, scoringFormat, (err) => {
				if (err) {
					return cerror.net(err);
				}
				_cancel_ui_edit_scoring_format();
			});
		});

		const cancelBtn = uiu.el(buttons, 'span', 'match_cancel_link vlink', ci18n('Cancel'));
		cancelBtn.addEventListener('click', _cancel_ui_edit_scoring_format);
	}

	function render_scoring_formats(main) {
		uiu.el(main, "h2", "edit", ci18n("tournament:edit:scoring_formats"));

		const sf = curt?.scoring_formats || { formats: [], default_id: null };
		const formats = Array.isArray(sf.formats) ? sf.formats : [];
		const defaultId = sf.default_id;

		const table = uiu.el(main, "table", "scoring_formats_table");
		const tbody = uiu.el(table, "tbody");

		{
			const tr = uiu.el(tbody, "tr");
			uiu.el(tr, "th", { class: "scoring_format_name_cell" }, ci18n("tournament:edit:scoring_formats:name"));
			uiu.el(tr, "th", { class: "scoring_format_center_cell" }, ci18n("tournament:edit:scoring_formats:num_sets"));
			uiu.el(tr, "th", { class: "scoring_format_type_cell" }, ci18n("tournament:edit:scoring_formats:type"));
			uiu.el(tr, "th", { class: "scoring_format_center_cell" }, ci18n("tournament:edit:scoring_formats:end_max"));
			uiu.el(tr, "th", { class: "scoring_format_center_cell" }, ci18n("tournament:edit:scoring_formats:interval_at"));
			uiu.el(tr, "th", { class: "scoring_format_right_cell" }, ci18n("tournament:edit:scoring_formats:interval_duration"));
			uiu.el(tr, "th", { class: "scoring_format_right_cell" }, ci18n("tournament:edit:scoring_formats:break_before_set"));
			uiu.el(tr, "th", { class: "scoring_format_center_cell" }, ci18n("tournament:edit:scoring_formats:default"));
			uiu.el(tr, "th", { class: "scoring_format_center_cell" }, ci18n("tournament:edit:scoring_formats:edit"));
		}

		for (const [formatIndex, f] of formats.entries()) {
			const rowClass = (formatIndex % 2 === 0) ? "scoring_formats_row_group_even" : "scoring_formats_row_group_odd";
			const regularTr = uiu.el(tbody, "tr", rowClass);
			const lastTr = uiu.el(tbody, "tr", `scoring_formats_subrow ${rowClass}`);
			const regularSetPoints = f?.set_points;
			const lastSetPoints = f?.last_set_points;
			const isDefault = Number(f.id) === Number(defaultId);
				const canEdit = true;

				uiu.el(regularTr, "td", { rowspan: 2, class: "scoring_format_name_cell" }, f.name || "");
				uiu.el(regularTr, "td", { rowspan: 2, class: "scoring_format_center_cell" }, String(f.numSets ?? ""));
				uiu.el(regularTr, "td", { class: "scoring_format_type_cell scoring_format_rule_cell" }, ci18n("tournament:edit:scoring_formats:type_regular"));
				uiu.el(regularTr, "td", { class: "scoring_format_rule_cell scoring_format_center_cell" }, format_set_rule_summary(regularSetPoints));
				uiu.el(regularTr, "td", { class: "scoring_format_rule_cell scoring_format_center_cell" }, is_break_in_set_enabled(regularSetPoints) ? String(regularSetPoints.interval_at) : "—");
				uiu.el(regularTr, "td", { class: "scoring_format_rule_cell scoring_format_right_cell" }, is_break_in_set_enabled(regularSetPoints) ? format_duration_ms(regularSetPoints && regularSetPoints.interval_duration_ms) : "—");
				uiu.el(regularTr, "td", { class: "scoring_format_rule_cell scoring_format_right_cell" }, format_duration_ms(regularSetPoints && regularSetPoints.break_before_set_duration_ms));

				const defTd = uiu.el(regularTr, "td", { rowspan: 2, class: "scoring_format_center_cell" });
				if (isDefault) {
					uiu.el(defTd, "span", {
						class: "default_scoring_format_badge",
						title: ci18n("tournament:edit:scoring_formats:default"),
					}, ci18n("tournament:edit:scoring_formats:default_badge"));
				} else {
					uiu.el(defTd, "span", { class: "default_scoring_format_badge default_scoring_format_badge_inactive" }, "—");
				}

				const actionsTd = uiu.el(regularTr, "td", { rowspan: 2, class: "scoring_format_center_cell" });
				const editBtn = uiu.el(
					actionsTd,
					"button",
					{ "data-scoring-format-id": f.id },
					ci18n("tournament:edit:scoring_formats:edit")
					);

				editBtn.addEventListener("click", (e) => {
					const id = e.target.getAttribute("data-scoring-format-id");
					ui_edit_scoring_format(id);
				});

				uiu.el(lastTr, "td", { class: "scoring_format_type_cell scoring_format_rule_cell" }, ci18n("tournament:edit:scoring_formats:type_last"));
				uiu.el(lastTr, "td", { class: "scoring_format_rule_cell scoring_format_center_cell" }, format_set_rule_summary(lastSetPoints));
				uiu.el(lastTr, "td", { class: "scoring_format_rule_cell scoring_format_center_cell" }, is_break_in_set_enabled(lastSetPoints) ? String(lastSetPoints.interval_at) : "—");
				uiu.el(lastTr, "td", { class: "scoring_format_rule_cell scoring_format_right_cell" }, is_break_in_set_enabled(lastSetPoints) ? format_duration_ms(lastSetPoints && lastSetPoints.interval_duration_ms) : "—");
				uiu.el(lastTr, "td", { class: "scoring_format_rule_cell scoring_format_right_cell" }, format_duration_ms(lastSetPoints && lastSetPoints.break_before_set_duration_ms));
		}
	}

	function update_stages_scoring_formats() {
		if (!scoring_formats_main) {
			if (typeof debug !== "undefined" && debug?.log) {
				debug.log("update_scoring_formats: main container not initialized");	
			}
			return;
		}

		// kompletten Bereich leeren
		while (scoring_formats_main.firstChild) {
			scoring_formats_main.removeChild(scoring_formats_main.firstChild);
		}

		// vollständig neu rendern
		render_scoring_formats(scoring_formats_main);
		render_stages_scoring_formats(scoring_formats_main);
	}

	function render_stages_scoring_formats(main) {
		const sf = curt?.scoring_formats || { formats: [], default_id: null };
		const defaultId = sf.default_id;

		// Build lookup: scoring_format_id -> scoring_format_name
		const formatNameById = new Map();
		for (const f of sf.formats || []) {
			formatNameById.set(Number(f.id), f.name || String(f.id));
		}

		const eventsPayload = curt?.events?.events || [];
		const deviations = [];

		for (const ev of eventsPayload) {
			const eventName = ev?.name || "";
			const stages = Array.isArray(ev?.stages) ? ev.stages : [];

			for (const st of stages) {
				// Missing/null scoring_format => default
				const stageSfId =
					st && st.scoring_format !== undefined && st.scoring_format !== null
					? Number(st.scoring_format)
					: null;

				if (
					stageSfId !== null &&
					defaultId !== null &&
					defaultId !== undefined &&
					stageSfId !== Number(defaultId)
				) {
					deviations.push({
						event_name: eventName,
						stage_name: st?.name || "",
						scoring_format_id: stageSfId,
						scoring_format_name: formatNameById.get(stageSfId) || String(stageSfId),
					});
				}
			}
		}

		deviations.sort((a, b) => {
			const e = (a.event_name || "").localeCompare(b.event_name || "");
			if (e) return e;
			const s = (a.stage_name || "").localeCompare(b.stage_name || "");
			if (s) return s;
			return (a.scoring_format_id || 0) - (b.scoring_format_id || 0);
		});

		uiu.el(main, "h3", "edit", "Abweichungen vom Default");

		if (defaultId === null || defaultId === undefined) {
			uiu.el(
				main,
				"div",
				"hint",
				"Kein Default-Scoring-Format gefunden (scoring_formats.default_id ist leer)."
			);
			return;
		}

		if (deviations.length === 0) {
			uiu.el(main, "div", "hint", "Keine Stages weichen vom Default-Scoring-Format ab.");
			return;
		}

		const devTable = uiu.el(main, "table", "scoring_format_deviations_table");
		const devBody = uiu.el(devTable, "tbody");

		{
			const tr = uiu.el(devBody, "tr");
			uiu.el(tr, "th", {}, "Event");
			uiu.el(tr, "th", {}, "Stage");
			uiu.el(tr, "th", {}, "Verwendete Zählweise");
		}

		for (const d of deviations) {
			const tr = uiu.el(devBody, "tr");
			uiu.el(tr, "td", {}, d.event_name);
			uiu.el(tr, "td", {}, d.stage_name);
			uiu.el(tr, "td", {}, `${d.scoring_format_name} (#${d.scoring_format_id})`);
		}
	}



	function render_normalisation_values(main) {
		uiu.el(main, 'h2','edit', ci18n('tournament:edit:normalizations'));

		const display_table = uiu.el(main, 'table');
		const display_tbody = uiu.el(display_table, 'tbody');
		const tr = uiu.el(display_tbody, 'tr');
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:normalizations:origin'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:normalizations:replace'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:normalizations:language'));
		uiu.el(tr, 'th', {}, '');
		const tr_input = uiu.el(display_tbody, 'tr');
		create_undecorated_input("text", uiu.el(tr_input, 'td', {}), 'normalizations_origin');
		create_undecorated_input("text", uiu.el(tr_input, 'td', {}), 'normalizations_replace');

		// Tournament language selection
		const language_td = uiu.el(tr_input, 'td');
		const language_select = uiu.el(language_td, 'select', {
		 	name: 'language',
		 	required: 'required',
			name: 'normalizations_language',
			id: 'normalizations_language',
		});
		const all_langs = ci18n.get_all_languages();
		for (const l of all_langs) {
			const l_attrs = {
		 		value: l['announcements:lang'],
		 	};
		 	if (l._code === curt.language) {
		 		l_attrs.selected = 'selected';
		 	}
		 	uiu.el(language_select, 'option', l_attrs, l._name);
		}

		//create_undecorated_input("text", uiu.el(tr_input, 'td', {}), 'normalizations_language');
		const actions_td = uiu.el(tr_input, 'td', {});
		const add_btn = uiu.el(actions_td, 'button', {}, ci18n('tournament:edit:add'));
		add_btn.addEventListener('click', function (e) {

			var new_normalization = {}
			new_normalization.origin = document.getElementById('normalizations_origin').value;
			new_normalization.replace = document.getElementById('normalizations_replace').value;
			new_normalization.language = document.getElementById('normalizations_language').value;

			send_with_live_status({
				type: 'normalization_add',
				tournament_key: curt.key,
				normalization: new_normalization,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
			});
		});
		for (const nv of curt.normalizations) {
			const tr = uiu.el(display_tbody, 'tr');
			uiu.el(tr, 'td', {}, nv.origin);
			uiu.el(tr, 'td', {}, nv.replace);
			uiu.el(tr, 'td', {}, nv.language);
			const actions_td = uiu.el(tr, 'td', {});
			const delete_btn = uiu.el(actions_td, 'button', {
				'data-normalization-id': nv._id,
			}, ci18n('tournament:edit:delete'));
						
			delete_btn.addEventListener('click', function (e) {
				const del_btn = e.target;
				const normalization_id = del_btn.getAttribute('data-normalization-id');
					send_with_live_status({
						type: 'normalization_remove',
						tournament_key: curt.key,
						normalization_id: normalization_id,
				}, err => {
					if (err) {
						return cerror.net(err);
					}
				});
			});
		}
	}

	function render_advertisements(main) {
		uiu.el(main, 'h2', 'edit', ci18n('tournament:edit:advertisements'));

		const display_table = uiu.el(main, 'table');
		const display_tbody = uiu.el(display_table, 'tbody');
		const tr = uiu.el(display_tbody, 'tr');
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:advertisements:id'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:advertisements:url'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:advertisements:type'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:advertisements:disabled'));
		uiu.el(tr, 'th', {}, '');
		const tr_input = uiu.el(display_tbody, 'tr');
		uiu.el(tr_input, 'td', {}, '');
		create_undecorated_input("text", uiu.el(tr_input, 'td', {}), 'advertisement_url');
		create_undecorated_input("text", uiu.el(tr_input, 'td', {}), 'advertisement_type');
		uiu.el(tr_input, 'td', {}, '');
		const actions_td = uiu.el(tr_input, 'td', {});
		const add_btn = uiu.el(actions_td, 'button', {}, ci18n('tournament:edit:add'));
		add_btn.addEventListener('click', function (e) {

			var new_advertisement = {}
			new_advertisement.id = generateGUID();
			new_advertisement.url = document.getElementById('advertisement_url').value;
			new_advertisement.type = document.getElementById('advertisement_type').value;
			new_advertisement.disabled = false;
				send_with_live_status({
					type: 'advertisement_add',
					tournament_key: curt.key,
					advertisement: new_advertisement,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
			});
		});
		for (const nv of curt.advertisements) {
			const tr = uiu.el(display_tbody, 'tr');
			uiu.el(tr, 'td', {}, nv.id);
			uiu.el(tr, 'td', {}, nv.url);
			uiu.el(tr, 'td', {}, nv.type);
			uiu.el(tr, 'td', {}, nv.disabled);
			const actions_td = uiu.el(tr, 'td', {});
			const delete_btn = uiu.el(actions_td, 'button', {
				'data-advertisement-id': nv._id,
			}, ci18n('tournament:edit:delete'));

			delete_btn.addEventListener('click', function (e) {
				const del_btn = e.target;
				const advertisement_id = del_btn.getAttribute('data-advertisement-id');
					send_with_live_status({
						type: 'advertisement_remove',
						tournament_key: curt.key,
						advertisement_id: advertisement_id,
				}, err => {
					if (err) {
						return cerror.net(err);
					}
				});
			});
		}
	}
	function generateGUID() {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
			const random = Math.random() * 16 | 0;
			const value = char === 'x' ? random : (random & 0x3 | 0x8);
			return value.toString(16);
		});
	}

	function set_battery_state(battery, node) {
		if (battery && battery != null) {
			node.removeAttribute("class");
			let level = Math.floor(battery.level * 100);
			node.innerHTML = level + '%';
			if (battery.charging) {
				node.classList.add('battery-status-charging');

				node.title = ci18n('tournament:edit:displays:battery_charging_time', {
					battery_charging_time : Math.floor(battery.chargingTime / 60)
				});
			} else {
				node.title = ci18n('tournament:edit:displays:battery_duscharging_time', {
					battery_discharging_time: Math.floor(battery.dischargingTime / 60)
				});
				
				if (level <= 10) {
					node.classList.add('battery-status-red');
				} else if (level <= 20) {
					node.classList.add('battery-status-orange');
				} else if (level <= 40) {
					node.classList.add('battery-status-yellow');
				} else {
					node.classList.add('battery-status-green');
				}
			}
		}
	}

	function render_logo_preview(main) {
		uiu.el(main, 'h3', 'edit', ci18n('tournament:edit:logo'));
		const logo_preview_container = uiu.el(main, 'div', {
			style: (
				'position:relative;text-align:center;' +
				'height: 432px; width: 768px; font-size: 70px;' +
				'background:' + (curt.logo_background_color || '#000000') + ';' +
				'color:' + (curt.logo_foreground_color || '#aaaaaa') + ';'
			),
			name: "logo_preview",
		});
		if (curt.logo_id) {
			uiu.el(logo_preview_container, 'img', {
				style: 'height: 320px;',
				src: '/h/' + encodeURIComponent(curt.key) + '/logo/' + curt.logo_id,
				name: 'logo_preview_img'
			});
		}
		uiu.el(logo_preview_container, 'div', {}, 'Court 42');

		const logo_form = uiu.el(main, 'form', 'logo_form');
		const logo_button_id = 'logo_upload_input';

		const custom_label = uiu.el(logo_form, 'label', {
			for: logo_button_id,
			style: (
				'display:inline-block;padding:3px 8px;cursor:pointer; border:1px solid;' +
				'background:#eeeeee;color:black;border-radius:4px;margin:10px;'
			),
		}, 'Logo auswählen');

		const filename_display = uiu.el(logo_form, 'span', {
			id: 'upload_filename',
			style: 'font-style: italic; color: #555;',
		}, curt.logo_name ? curt.logo_name : 'Noch keine Datei ausgewählt');

		const logo_button = uiu.el(logo_form, 'input', {
			id: logo_button_id,
			type: 'file',
			accept: 'image/*',
			style: 'display:none;',
		});
		logo_button.addEventListener('change', (e) => {
			_upload_logo(e);
		});
		const logo_colors_container = uiu.el(logo_form, 'div', { style: 'display: block' });
		const bg_col_label = uiu.el(logo_colors_container, 'label', {}, ci18n('tournament:edit:logo:background'));
		const logo_background_color_input = uiu.el(bg_col_label, 'input', {
			type: 'color',
			name: 'logo_background_color',
			value: curt.logo_background_color || '#000000',
		});
		logo_background_color_input.addEventListener('input', (e) => {
			send_with_live_status({
				type: 'tournament_edit_logo',
				key: curt.key,
				props: {
					logo_background_color: e.target.value,
				},
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
			});
		});
		const fg_col_label = uiu.el(logo_colors_container, 'label', {}, ci18n('tournament:edit:logo:foreground'));
		const fg_col_input = uiu.el(fg_col_label, 'input', {
			type: 'color',
			name: 'logo_foreground_color',
			value: curt.logo_foreground_color || '#aaaaaa',
		});
		fg_col_input.addEventListener('input', (e) => {
			send_with_live_status({
				type: 'tournament_edit_logo',
				key: curt.key,
				props: {
					logo_foreground_color: e.target.value,
				},
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function update_logo() {
		switch (get_admin_subpage()){
			case 'edit':
				const logo_preview_container = document.querySelector('[name="logo_preview"]');
				logo_preview_container.style.background = curt.logo_background_color;
				logo_preview_container.style.color = curt.logo_foreground_color;
				let logo_background_color_input = document.querySelector('[name="logo_background_color"]');
				logo_background_color_input.value = curt.logo_background_color;
				let fg_col_input = document.querySelector('[name="logo_foreground_color"]');
				fg_col_input.value = curt.logo_foreground_color;
				const logo_preview_img = logo_preview_container.querySelector('[name="logo_preview_img"]');
				logo_preview_img.setAttribute('src', '/h/' + encodeURIComponent(curt.key) + '/logo/' + curt.logo_id);
				const filename_display = document.querySelector('#upload_filename');
				filename_display.textContent = curt.logo_name ? curt.logo_name : 'Noch keine Datei ausgewählt';
				break;
			default:
				break;
		}
		return;
	}

	function render_general_displaysettings(main) {
		let used_configs = new Set();
		curt.displays.forEach((d) => {
			used_configs.add(d.displaysetting_id);
		});
		
		uiu.el(main, 'h3',  'edit', ci18n('tournament:edit:general_displaysettings'));
		const create_actions = uiu.el(main, 'div', { style: 'margin: 0.5em 0 1em;' });
		const create_display_btn = uiu.el(create_actions, 'button', {
			type: 'button',
		}, 'Neue Displayeinstellung');
		const create_tablet_btn = uiu.el(create_actions, 'button', {
			type: 'button',
			style: 'margin-left: 0.5em;',
		}, 'Neue Tableteinstellung');
		create_display_btn.addEventListener('click', () => {
			ui_create_display_setting_from_default('display');
		});
		create_tablet_btn.addEventListener('click', () => {
			ui_create_display_setting_from_default('umpire');
		});
		const display_settings_table = uiu.el(main, 'table');
		const display_settings_tbody = uiu.el(display_settings_table, 'tbody');
		const tr = uiu.el(display_settings_tbody, 'tr');
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displaysettings:name'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displaysettings:mode'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displaysettings:actions'));

		for (const s of curt.displaysettings) {
			const tr = uiu.el(display_settings_tbody, 'tr', { 'data-displaysetting_id': s.id });
			render_general_displaysetting_line(tr, s, used_configs);
		}
	}

	function render_general_displaysetting_line(parrent, s, used_configs) {		
		uiu.el(parrent, 'th', {}, s.description ||s.id);
		uiu.el(parrent, 'td', {}, format_general_displaysetting_mode(s));
		const actions_td = uiu.el(parrent, 'td', {});
		const is_default_setting = s.id === curt.displaysettings_general || s.id === curt.displaysettings_general_tablet;
		const edit_btn = uiu.el(actions_td, 'button', {
			'data-display_setting_id': s.id,
		}, 'Edit');

		edit_btn.addEventListener('click', (e) => {				
			on_edit_display_setting_button_click(e);
		});


		const delete_btn = uiu.el(actions_td, 'button', {
			'data-display-setting-id': s.id,
		}, 'Delete');

		if (used_configs.has(s.id) || is_default_setting) {
			delete_btn.setAttribute('disabled', 'disabled');
		}

		delete_btn.addEventListener('click', (e) => {
			const del_btn = e.target;
			const setting_id = del_btn.getAttribute('data-display-setting-id');

			send_with_live_status({
				type: 'delete_display_setting',
				tournament_key: curt.key,
				setting_id: setting_id,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function format_general_displaysetting_mode(s) {
		if (!s) {
			return '';
		}
		if (s.devicemode === 'umpire') {
			const tablet_mode = s.tablet_mode || 'umpire';
			return ci18n(
				'settings:tablet_mode:' + tablet_mode,
				undefined,
				ci18n('display_setting:tablet_mode:' + tablet_mode, undefined, s.devicemode)
			);
		}
		if (s.devicemode === 'display') {
			const style = s.displaymode_style || '';
			const style_label = ci18n('displaymode|' + style, undefined, style);
			return ci18n('Scoreboard', undefined, 'Display') + (style_label ? ' (' + style_label + ')' : '');
		}
		return s.devicemode || '';
	}

	function _cancel_ui_edit_display_setting() {
		const dlg = document.querySelector('.display_setting_edit_dialog');
		if (!dlg) {
			return; // Already cancelled
		}
		cbts_utils.esc_stack_pop();
		uiu.remove(dlg);
	
		ui_edit();
	}

	function on_edit_display_setting_button_click(e) {
		const btn = e.target;
		const display_setting_id = btn.getAttribute('data-display_setting_id');
		ui_edit_display_setting(display_setting_id);
	}

	function _build_new_display_setting_id(base_id, devicemode) {
		const normalized_base = String(base_id || devicemode || 'display')
			.replace(/\s+/g, '_')
			.replace(/[^-a-zA-Z0-9_]/g, '');
		return `${normalized_base}_${Date.now()}`;
	}

	function ui_create_display_setting_from_default(devicemode) {
		const default_setting_id = devicemode === 'umpire'
			? curt.displaysettings_general_tablet
			: curt.displaysettings_general;
		const base_setting = structuredClone(utils.find(curt.displaysettings, d => d.id === default_setting_id));
		if (!base_setting) {
			alert('Keine passende Standardeinstellung gefunden.');
			return;
		}
		base_setting.id = _build_new_display_setting_id(base_setting.id, devicemode);
		base_setting.description = `${base_setting.description || base_setting.id} Kopie`;
		base_setting.devicemode = devicemode;
		ui_edit_display_setting(base_setting.id, {
			display_setting: base_setting,
			is_new: true,
		});
	}

	function ui_edit_display_setting(display_setting_id, opts = {}) {
		const is_new = !!opts.is_new;
		const display_setting = structuredClone(opts.display_setting || utils.find(curt.displaysettings, d => d.id === display_setting_id));
		if (!display_setting) {
			return;
		}
		if (!is_new) {
			crouting.set('t/' + curt.key + '/edit/s/' + display_setting_id, {}, _cancel_ui_edit_display_setting);
		}

		cbts_utils.esc_stack_push(_cancel_ui_edit_display_setting);

		const body = uiu.qs('body');
		const dialog_bg = uiu.el(body, 'div', 'dialog_bg display_setting_edit_dialog', {
		 	'data-display_setting_id': display_setting_id,
			'data-is-new': is_new ? 'true' : 'false',
		});
		const dialog = uiu.el(dialog_bg, 'div', 'dialog display_setting_dialog');

		uiu.el(dialog, 'h3', {}, is_new ? 'Displayeinstellung anlegen' : ci18n('Edit display setting'));

		const form = uiu.el(dialog, 'form');
		uiu.el(form, 'input', {
			type: 'hidden',
			name: 'display_setting_id',
			value: display_setting.id,
		});
		render_edit_display_setting(form, display_setting);

		const buttons = uiu.el(form, 'div', {
			style: 'margin-top: 2em; display: flex; gap: 0.75em; align-items: center; justify-content: center;',
		});

		const btn = uiu.el(buttons, 'button', {
			'class': 'match_save_button',
			role: 'submit',
		}, ci18n('Change'));

		form_utils.onsubmit(form, function(d) {
			const displaysetting = create_displaysettings_object(d);

			send_with_live_status({
				type: is_new ? 'create_display_setting' : 'edit_display_setting',
				tournament_key: curt.key,
				displaysetting: displaysetting,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
				_cancel_ui_edit_display_setting();
			});
		});

		const cancel_btn = uiu.el(buttons, 'button', {
			type: 'button',
			class: 'match_save_button',
		}, ci18n('Cancel'));
		cancel_btn.addEventListener('click', _cancel_ui_edit_display_setting);
	}
	crouting.register(/t\/([a-z0-9]+)\/edit\/s\/([-a-zA-Z0-9_ ]+)$/, function(m) {
		ctournament.switch_tournament(m[1], function() {
			ui_edit_display_setting(m[2]);
		});
	}, change.default_handler(() => {
		const dlg = uiu.qs('.display_setting_edit_dialog');
		const display_setting_id = dlg.getAttribute('data-display_setting_id');
		ui_edit_display_setting(display_setting_id);
	}));

	function build_display_setting_preview_event() {
		return {
			tournament_name: curt && (curt.name || curt.key) || 'Turnier',
			team_competition: false,
			team_names: ['Links', 'Rechts'],
			courts: [{
				id: 1,
				court_id: 1,
				num: 1,
				label: '1',
				match_id: 'preview_match',
			}],
			matches: [{
				setup: {
					match_id: 'preview_match',
					counting: '3x21',
					match_num: 42,
					match_name: 'Finale',
					event_name: 'MX O55',
					is_doubles: true,
					teams: [{
						name: 'TV Musterstadt',
						players: [{
							name: 'Max Emil Mustermann',
							firstname: 'Max',
							middlename: 'Emil',
							lastname: 'Mustermann',
							nationality: 'GER',
						}, {
							name: 'Lena Beispiel',
							firstname: 'Lena',
							lastname: 'Beispiel',
							nationality: 'GER',
						}],
					}, {
						name: 'BC Beispielheim',
						players: [{
							name: 'Timo Testfeld',
							firstname: 'Timo',
							lastname: 'Testfeld',
							nationality: 'GER',
						}, {
							name: 'Mia Sophie Demo',
							firstname: 'Mia',
							middlename: 'Sophie',
							lastname: 'Demo',
							nationality: 'GER',
						}],
					}],
				},
				network_score: [[21, 18], [7, 7]],
				network_team1_serving: true,
				network_teams_player1_even: [true, false],
			}],
		};
	}

	function get_display_setting_primary_score_sequence() {
		return [
			[12, 5],
			[13, 5],
			[13, 6],
			[14, 6],
			[15, 6],
			[15, 7],
			[16, 7],
			[17, 7],
			[17, 8],
			[18, 8],
			[18, 9],
			[19, 9],
			[20, 9],
			[20, 10],
			[21, 10],
		];
	}

	function get_display_setting_preview_score(previewState, options = {}) {
		if (!previewState) {
			return [11, 8];
		}
		if (previewState.previewType === 'live') {
			const nowTs = Date.now();
			const phases = [
				{ score: [10, 4], durationMs: 2500 },
				{ score: [11, 4], durationMs: 80000 },
				{ score: [11, 5], durationMs: 4000 },
			];
			const currentPhaseIndex = Math.max(0, Math.min(previewState.livePhaseIndex || 0, phases.length - 1));
			if (!previewState.livePhaseStartedAt) {
				previewState.livePhaseStartedAt = nowTs;
			}
			const currentPhase = phases[currentPhaseIndex];
			if (options.advance && (nowTs - previewState.livePhaseStartedAt) >= currentPhase.durationMs) {
				previewState.livePhaseIndex = (currentPhaseIndex + 1) % phases.length;
				previewState.livePhaseStartedAt = nowTs;
				return phases[previewState.livePhaseIndex].score;
			}
			return currentPhase.score;
		}
		const seq = get_display_setting_primary_score_sequence();
		if (!previewState.primaryStepStartedAt) {
			previewState.primaryStepStartedAt = Date.now();
		}
		let idx = Math.max(0, Math.min(previewState.sequenceIndex || 0, seq.length - 1));
		if (options.advance && (Date.now() - previewState.primaryStepStartedAt) >= 2500) {
			idx = (idx + 1) % seq.length;
			previewState.sequenceIndex = idx;
			previewState.primaryStepStartedAt = Date.now();
		}
		return seq[idx];
	}

	function get_display_preview_next_update_delay(previewState) {
		if (!previewState) {
			return 2500;
		}
		if (previewState.previewType === 'live') {
			const phases = [
				{ durationMs: 2500 },
				{ durationMs: 80000 },
				{ durationMs: 4000 },
			];
			const currentPhaseIndex = Math.max(0, Math.min(previewState.livePhaseIndex || 0, phases.length - 1));
			const currentPhase = phases[currentPhaseIndex];
			const startedAt = Number.isFinite(previewState.livePhaseStartedAt) ? previewState.livePhaseStartedAt : Date.now();
			const remainingMs = currentPhase.durationMs - (Date.now() - startedAt);
			return Math.max(100, remainingMs);
		}
		const startedAt = Number.isFinite(previewState.primaryStepStartedAt) ? previewState.primaryStepStartedAt : Date.now();
		const remainingMs = 2500 - (Date.now() - startedAt);
		return Math.max(100, remainingMs);
	}

	function get_display_setting_form_style(form) {
		const devicemodeInput = form.querySelector('[name="devicemode"]');
		const displayStyleInput = form.querySelector('[name="displaymode_style"]');
		if (devicemodeInput && devicemodeInput.value === 'umpire') {
			return 'umpire';
		}
		return displayStyleInput ? displayStyleInput.value : true;
	}

	function build_bup_preview_presses(setup) {
		const team1Left = true;
		const isDoubles = !!(setup && setup.is_doubles);
		return [{
			type: 'pick_side',
			team1_left: team1Left,
			timestamp: Date.now() - 120000,
		}, {
			type: 'pick_server',
			team_id: 0,
			player_id: 0,
			timestamp: Date.now() - 118000,
		}, {
			type: 'pick_receiver',
			team_id: 1,
			player_id: isDoubles ? 1 : 0,
			timestamp: Date.now() - 116000,
		}, {
			type: 'love-all',
			timestamp: Date.now() - 114000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 108000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 104000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 98000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 94000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 90000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 86000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 82000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 78000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 76000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 72000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 68000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 64000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 60000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 56000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 52000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 48000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 44000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 40000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 36000,
		}, {
			type: 'shuttle',
			timestamp: Date.now() - 32000,
		}];
	}

	function build_bup_preview_pause_presses(setup) {
		const team1Left = true;
		const isDoubles = !!(setup && setup.is_doubles);
		return [{
			type: 'pick_side',
			team1_left: team1Left,
			timestamp: Date.now() - 90000,
		}, {
			type: 'pick_server',
			team_id: 0,
			player_id: 0,
			timestamp: Date.now() - 88000,
		}, {
			type: 'pick_receiver',
			team_id: 1,
			player_id: isDoubles ? 1 : 0,
			timestamp: Date.now() - 86000,
		}, {
			type: 'love-all',
			timestamp: Date.now() - 84000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 78000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 74000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 70000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 66000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 62000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 58000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 54000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 50000,
		}, {
			type: 'score',
			side: 'right',
			timestamp: Date.now() - 46000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 42000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 38000,
		}, {
			type: 'score',
			side: 'left',
			timestamp: Date.now() - 8000,
		}, {
			type: 'shuttle',
			timestamp: Date.now() - 5000,
		}];
	}

	function format_display_setting_preview_name(player, settings) {
		if (!player) {
			return '';
		}
		if (player.firstname && player.lastname) {
			let firstNames = String(player.firstname).split(/\s+/).filter(Boolean);
			if (!(settings && settings.d_show_middle_name)) {
				firstNames = firstNames.slice(0, 1);
			}
			if (settings && settings.d_abbreviate_first_name) {
				firstNames = firstNames.map((firstName) => firstName.replace(/[a-zäöüß]+/g, '.'));
			}
			return `${firstNames.join(' ')} ${player.lastname}`.trim();
		}
		return player.name || '';
	}

	function render_display_setting_badge(container, text, style) {
		uiu.el(container, 'span', {
			style: [
				'display:inline-flex',
				'align-items:center',
				'padding:0.18em 0.55em',
				'border-radius:999px',
				'font-size:0.8em',
				'font-weight:600',
				style || '',
			].join(';'),
		}, text);
	}

	function build_display_preview_bup_settings(previewSettings) {
		return Object.assign({}, previewSettings, {
			court_id: 'tdemo_5',
			displaymode_court_id: 'tdemo_5',
			court_description: '',
			language: previewSettings.language || 'de',
		});
	}

	function ensure_display_preview_visible(iframeWindow) {
		try {
			if (!iframeWindow || !iframeWindow.document || !iframeWindow.state) {
				return false;
			}
			const state = iframeWindow.state;
			state.ui = state.ui || {};
			state.ui.displaymode_visible = true;

			const doc = iframeWindow.document;
			const displayLayout = doc.querySelector('.displaymode_layout');
			if (!displayLayout) {
				return false;
			}

			// The preview renders V2 DTOs directly. Calling displaymode.show() would
			// subscribe to the normal BUP network path and briefly overwrite the preview.
			displayLayout.classList.remove('default-invisible');
			displayLayout.removeAttribute('data-uiu-display');
			displayLayout.style.display = '';

			[
				'.settings_layout',
				'.render_layout',
				'.refmode_layout',
				'.scorecard_layout',
			].forEach((selector) => {
				const layout = doc.querySelector(selector);
				if (layout && layout !== displayLayout) {
					layout.style.display = 'none';
				}
			});
			return true;
		} catch (_err) {
			return false;
		}
	}

	function get_display_preview_match(iframeWindow) {
		const event = iframeWindow && iframeWindow.state && iframeWindow.state.event;
		if (!event || !Array.isArray(event.matches)) {
			return null;
		}
		return event.matches.find((match) => match && match.setup && match.setup.match_id === 'tdemo_match_42')
			|| event.matches[0]
			|| null;
	}

	function get_display_preview_court(iframeWindow) {
		const event = iframeWindow && iframeWindow.state && iframeWindow.state.event;
		if (!event || !Array.isArray(event.courts)) {
			return null;
		}
		return event.courts.find((court) => court && court.court_id === 'tdemo_5')
			|| event.courts[0]
			|| null;
	}

	function get_display_preview_match_for_court(event, court) {
		if (!event || !court || !Array.isArray(event.matches)) {
			return null;
		}
		const courtMatchId = court.match_id || court.matchId || null;
		const courtId = court.court_id || court._id || court.id || null;
		return event.matches.find((match) => match && match.setup && (
			(courtMatchId && match.setup.match_id === courtMatchId) ||
			(courtId && match.setup.court_id === courtId)
		)) || null;
	}

	function clone_display_preview_event(event) {
		if (!event) {
			return null;
		}
		if (typeof structuredClone === 'function') {
			return structuredClone(event);
		}
		return JSON.parse(JSON.stringify(event));
	}

	function normalize_display_preview_match_data(match) {
		if (!match || !match.setup || !Array.isArray(match.setup.teams)) {
			return;
		}
		const fallbackTeams = [
			{
				name: 'TV Musterstadt',
				players: [
					{ name: 'Max Emil Mustermann', firstname: 'Max', middlename: 'Emil', lastname: 'Mustermann', nationality: 'GER' },
					{ name: 'Lena Beispiel', firstname: 'Lena', middlename: '', lastname: 'Beispiel', nationality: 'GER' },
				],
			},
			{
				name: 'BC Beispielheim',
				players: [
					{ name: 'Timo Testfeld', firstname: 'Timo', middlename: '', lastname: 'Testfeld', nationality: 'GER' },
					{ name: 'Mia Sophie Demo', firstname: 'Mia', middlename: 'Sophie', lastname: 'Demo', nationality: 'GER' },
				],
			},
		];
		match.setup.teams.forEach((team, teamIdx) => {
			const fallbackTeam = fallbackTeams[teamIdx] || { name: '', players: [] };
			team.name = fallbackTeam.name;
			if (!Array.isArray(team.players)) {
				team.players = [];
			}
			while (team.players.length < fallbackTeam.players.length) {
				team.players.push({});
			}
			team.players.forEach((player, playerIdx) => {
				const fallbackPlayer = fallbackTeam.players[playerIdx] || {};
				if (!fallbackPlayer.name) {
					return;
				}
				player.name = fallbackPlayer.name;
				player.firstname = fallbackPlayer.firstname || '';
				player.middlename = fallbackPlayer.middlename || '';
				player.lastname = fallbackPlayer.lastname || '';
			});
		});
	}

	function normalize_display_preview_event_data(iframeWindow) {
		const event = iframeWindow && iframeWindow.state && iframeWindow.state.event;
		if (!event || !Array.isArray(event.matches)) {
			return;
		}
		event.matches.forEach((match) => {
			if (match && match.setup && match.setup.match_id === 'tdemo_match_42') {
				normalize_display_preview_match_data(match);
			}
		});
	}

	function normalize_tablet_preview_match_data(match) {
		normalize_display_preview_match_data(match);
		if (match && match.setup) {
			match.setup.umpire_name = 'Ulli Unparteiisch';
		}
	}

	function normalize_tablet_preview_event_data(iframeWindow) {
		const event = iframeWindow && iframeWindow.state && iframeWindow.state.event;
		if (!event || !Array.isArray(event.matches)) {
			return;
		}
		event.matches.forEach((match) => {
			if (match && match.setup && match.setup.match_id === 'tdemo_match_42') {
				normalize_tablet_preview_match_data(match);
			}
		});
	}

	function build_display_preview_full_score_sequence() {
		return [
			[1, 0],
			[1, 1],
			[2, 1],
			[3, 1],
			[3, 2],
			[4, 2],
			[5, 2],
			[5, 3],
			[6, 3],
			[7, 3],
			[8, 3],
			[8, 4],
			[9, 4],
			[10, 4],
			[11, 4],
			[11, 5],
			[12, 5],
			[13, 5],
			[13, 6],
			[14, 6],
			[15, 6],
			[15, 7],
			[16, 7],
			[17, 7],
			[17, 8],
			[18, 8],
			[18, 9],
			[19, 9],
			[20, 9],
			[20, 10],
			[21, 10],
		];
	}

	function build_display_preview_presses(targetScore, options = {}) {
		const sequence = build_display_preview_full_score_sequence();
		const targetIndex = sequence.findIndex((score) => score[0] === targetScore[0] && score[1] === targetScore[1]);
		const usedSequence = targetIndex >= 0 ? sequence.slice(0, targetIndex + 1) : sequence;
		const nowTs = Date.now();
		const fixedLastScoreTs = Number.isFinite(options.lastScoreTimestamp) ? options.lastScoreTimestamp : null;
		const startTs = fixedLastScoreTs != null
			? (fixedLastScoreTs - Math.max(usedSequence.length - 1, 0) * 1000 - 1000)
			: (nowTs - (usedSequence.length + 10) * 1000);
		const presses = [{
			type: 'editmode_set-finished_games',
			scores: [[21, 18]],
			by_side: false,
			timestamp: startTs,
		}, {
			type: 'pick_side',
			team1_left: true,
			timestamp: startTs + 100,
		}, {
			type: 'pick_server',
			team_id: 0,
			player_id: 0,
			timestamp: startTs + 200,
		}, {
			type: 'pick_receiver',
			team_id: 1,
			player_id: 0,
			timestamp: startTs + 300,
		}, {
			type: 'love-all',
			timestamp: startTs + 400,
		}];
		let previousScore = [0, 0];
		usedSequence.forEach((score, idx) => {
			let side = 'left';
			if (score[1] > previousScore[1]) {
				side = 'right';
			}
			presses.push({
				type: 'score',
				side,
				timestamp: startTs + 1000 + idx * 1000,
			});
			previousScore = score;
		});
		return presses;
	}

	function build_display_preview_network_state(match, targetScore, options = {}) {
		const presses = build_display_preview_presses(targetScore, options);
		const setup = Object.assign({}, match.setup, {
			counting: match.setup.counting || '3x21',
			match_id: match.setup.match_id || 'tdemo_match_42',
		});
		match.setup.counting = setup.counting;
		match.setup.match_id = setup.match_id;
		const tempState = {
			setup,
			metadata: {
				id: setup.match_id,
				start: null,
				end: null,
				updated: Date.now(),
			},
		};
		calc.init_state(tempState, null, presses, true);
		calc.state(tempState);
		return {
			presses,
			network_score: calc.netscore(tempState, true),
			network_team1_serving: tempState.game.team1_serving,
			network_teams_player1_even: tempState.game.teams_player1_even.slice(),
			network_team0_left: tempState.game.team1_left,
		};
	}

	function build_display_preview_v2_player(player) {
		const firstName = player && player.firstname ? player.firstname : '';
		const middleName = player && player.middlename ? player.middlename : '';
		const lastName = player && (player.lastname || player.surname) ? (player.lastname || player.surname) : '';
		const fullName = player && player.name ? player.name : [firstName, middleName, lastName].filter(Boolean).join(' ');
		return {
			name: fullName || 'N.N.',
			firstname: [firstName, middleName].filter(Boolean).join(' '),
			lastname: lastName,
			nationality: player && player.nationality ? player.nationality : '',
		};
	}

	function build_display_preview_v2_team(team, teamIdx) {
		const players = Array.isArray(team && team.players) ? team.players : [];
		const playerDetails = players.map(build_display_preview_v2_player);
		return {
			side: teamIdx === 0 ? 'left' : 'right',
			name: (team && team.name) || playerDetails.map((player) => player.name).filter(Boolean).join(' / ') || 'N.N.',
			players: playerDetails.map((player) => player.name),
			player_details: playerDetails,
			is_winner: false,
		};
	}

	function build_display_preview_v2_side_score(score) {
		return {
			left: Number(score && score[0] || 0),
			right: Number(score && score[1] || 0),
		};
	}

	function build_display_preview_v2_score(match) {
		const networkScore = Array.isArray(match && match.network_score) ? match.network_score : [];
		if (!networkScore.length) {
			return {
				finished_sets: [],
				current_set: null,
				sets_won: { left: 0, right: 0 },
			};
		}
		const finishedSets = networkScore.slice(0, -1).map(build_display_preview_v2_side_score);
		const setsWon = { left: 0, right: 0 };
		finishedSets.forEach((score) => {
			if (score.left > score.right) {
				setsWon.left += 1;
			} else if (score.right > score.left) {
				setsWon.right += 1;
			}
		});
		return {
			finished_sets: finishedSets,
			current_set: build_display_preview_v2_side_score(networkScore[networkScore.length - 1]),
			current_set_finished: false,
			current_set_winner_side: null,
			sets_won: setsWon,
		};
	}

	function build_display_preview_v2_court(court, fallbackIdx) {
		const label = court && (court.label != null ? court.label : court.num);
		return {
			id: (court && (court.court_id || court._id || court.id)) || `tdemo_${fallbackIdx + 5}`,
			num: Number.isFinite(Number(label)) ? Number(label) : null,
			label: label != null ? String(label) : String(fallbackIdx + 5),
		};
	}

	function build_display_preview_v2_secondary_match(court) {
		return {
			setup: {
				incomplete: false,
				is_doubles: false,
				match_num: 43,
				counting: '3x21',
				team_competition: false,
				match_name: '5/16',
				event_name: 'JE U17',
				umpire_name: 'Ulli Unparteiisch',
				teams: [
					{
						name: 'TV Musterstadt',
						players: [{
							name: 'Finn Beispiel',
							firstname: 'Finn',
							middlename: '',
							lastname: 'Beispiel',
							nationality: 'GER',
						}],
					},
					{
						name: 'BC Beispielheim',
						players: [{
							name: 'Nora Testfeld',
							firstname: 'Nora',
							middlename: '',
							lastname: 'Testfeld',
							nationality: 'GER',
						}],
					},
				],
				scheduled_time_str: '14:00',
				court_id: (court && (court.court_id || court._id || court.id)) || 'tdemo_6',
				match_id: 'tdemo_match_43',
			},
		};
	}

	function build_display_preview_v2_timer(previewState, idx) {
		if (!previewState || previewState.previewType !== 'live') {
			return null;
		}
		if (idx !== 0) {
			return null;
		}
		const phaseIndex = previewState.livePhaseIndex || 0;
		if (phaseIndex !== 1) {
			return null;
		}
		const startedAt = Number.isFinite(previewState.livePhaseStartedAt)
			? previewState.livePhaseStartedAt
			: Date.now();
		return {
			start: startedAt,
			duration: 60000,
			exigent: 20000,
			upwards: false,
			restart: false,
		};
	}

	function build_display_preview_v2_court_state(event, match, court, idx, previewState) {
		const setup = match && match.setup ? match.setup : {};
		const teams = Array.isArray(setup.teams) ? setup.teams : [];
		const serverTeamIdx = match && match.network_team1_serving === false ? 1 : 0;
		const receiverTeamIdx = serverTeamIdx === 0 ? 1 : 0;
		const courtPayload = build_display_preview_v2_court(court, idx);
		const previewTimer = build_display_preview_v2_timer(previewState, idx);
		return {
			type: 'display_state',
			version: 1,
			tournament: {
				key: event && event.id ? event.id : 'tdemo',
				name: event && event.tournament_name ? event.tournament_name : 'Test-Turnier',
			},
			court: courtPayload,
			view: { screen: match ? 'live_match' : 'idle' },
			match: match ? {
				id: setup.match_id || `tdemo_match_${idx}`,
				status: setup.state || 'oncourt',
				event_name: setup.event_name || '',
				round_name: setup.match_name || '',
				counting: setup.counting || '3x21',
				scoring_format: setup.scoring_format || null,
				scheduled_date: setup.scheduled_date || null,
				scheduled_time: setup.scheduled_time_str || null,
				called_timestamp: setup.called_timestamp || null,
				start_timestamp: null,
				end_timestamp: null,
				best_of: Number(setup.best_of || 3) || 3,
				is_doubles: !!setup.is_doubles,
				team_competition: !!setup.team_competition,
				nation_competition: !!setup.nation_competition,
			} : null,
			teams: teams.map(build_display_preview_v2_team),
			score: build_display_preview_v2_score(match),
			service: {
				server: match ? {
					side: serverTeamIdx === 0 ? 'left' : 'right',
					team_index: serverTeamIdx,
					player_index: 0,
				} : null,
				receiver: match ? {
					side: receiverTeamIdx === 0 ? 'left' : 'right',
					team_index: receiverTeamIdx,
					player_index: 0,
				} : null,
			},
			timers: {
				match_duration_sec: null,
				pause_remaining_sec: previewTimer ? Math.max(0, Math.ceil((previewTimer.start + previewTimer.duration - Date.now()) / 1000)) : null,
				active_timer: previewTimer,
			},
		};
	}

	function build_display_preview_v2_single_state(event, match, court, previewState) {
		const courtState = build_display_preview_v2_court_state(event, match, court, 0, previewState);
		return Object.assign({}, courtState, {
			client_mode: 'display',
			display: {
				client_id: 'preview',
				hostname: 'preview',
				monitor_label: 'preview',
				preview: true,
			},
			display_settings: (
				previewState &&
				previewState.iframe &&
				previewState.iframe.contentWindow &&
				previewState.iframe.contentWindow.state
			) ? previewState.iframe.contentWindow.state.settings : {},
		});
	}

	function is_display_preview_v2_multi_style(style) {
		return !!(
			style &&
			displaymode &&
			Array.isArray(displaymode.MULTI_COURT_STYLES) &&
			displaymode.MULTI_COURT_STYLES.includes(style)
		);
	}

	function build_display_preview_v2_multi_court_state(event, primaryMatch, primaryCourt, previewState) {
		const state = previewState && previewState.iframe && previewState.iframe.contentWindow && previewState.iframe.contentWindow.state;
		const style = state && state.settings && state.settings.displaymode_style;
		if (style === '2court' || style === 'castall' || style === 'stream') {
			return [{
				court_id: 'tdemo_1',
				id: 'tdemo_1',
				num: 1,
				label: '1',
			}, {
				court_id: 'tdemo_2',
				id: 'tdemo_2',
				num: 2,
				label: '2',
			}].map((court, idx) => {
				let courtMatch = idx === 0
					? clone_display_preview_event({ matches: [primaryMatch] }).matches[0]
					: build_display_preview_v2_secondary_match(court);
				if (courtMatch && courtMatch.setup) {
					courtMatch.setup.court_id = court.court_id;
					if (!Array.isArray(courtMatch.network_score) || !courtMatch.network_score.length) {
						const networkState = build_display_preview_network_state(courtMatch, idx === 0 ? [12, 5] : [8, 3], {});
						courtMatch.presses = networkState.presses;
						courtMatch.presses_json = JSON.stringify(networkState.presses);
						courtMatch.network_score = networkState.network_score;
						courtMatch.network_team1_serving = networkState.network_team1_serving;
						courtMatch.network_teams_player1_even = networkState.network_teams_player1_even;
						courtMatch.network_team0_left = networkState.network_team0_left;
					}
				}
				return build_display_preview_v2_court_state(event, courtMatch, court, idx, previewState);
			});
		}

		const courtIdx = event.courts.indexOf(primaryCourt);
		const secondaryCourt = event.courts.find((court) => court && court.court_id === 'tdemo_6')
			|| event.courts[courtIdx + 1]
			|| { court_id: 'tdemo_6', label: 6 };
		const previewCourts = event.courts.slice();
		if (!previewCourts.includes(secondaryCourt)) {
			previewCourts.push(secondaryCourt);
		}
		return previewCourts.map((court, idx) => {
			const courtId = court && (court.court_id || court._id || court.id);
			let courtMatch = get_display_preview_match_for_court(event, court);
			if (!courtMatch && court === primaryCourt) {
				courtMatch = primaryMatch;
			}
			if (!courtMatch && court === secondaryCourt) {
				courtMatch = build_display_preview_v2_secondary_match(court);
			}
			if (courtMatch && courtMatch !== primaryMatch) {
				courtMatch = clone_display_preview_event({ matches: [courtMatch] }).matches[0];
			}
			if (courtMatch && courtMatch.setup) {
				courtMatch.setup.court_id = courtId || `tdemo_${idx + 5}`;
				if (!Array.isArray(courtMatch.network_score) || !courtMatch.network_score.length) {
					const secondaryNetworkState = build_display_preview_network_state(courtMatch, idx === 0 ? [12, 5] : [8, 3], {});
					courtMatch.presses = secondaryNetworkState.presses;
					courtMatch.presses_json = JSON.stringify(secondaryNetworkState.presses);
					courtMatch.network_score = secondaryNetworkState.network_score;
					courtMatch.network_team1_serving = secondaryNetworkState.network_team1_serving;
					courtMatch.network_teams_player1_even = secondaryNetworkState.network_teams_player1_even;
					courtMatch.network_team0_left = secondaryNetworkState.network_team0_left;
				}
			}
			return build_display_preview_v2_court_state(event, courtMatch, court, idx, previewState);
		});
	}

	function render_display_preview_v2_if_needed(previewState) {
		const iframeWindow = previewState && previewState.iframe && previewState.iframe.contentWindow;
		const state = iframeWindow && iframeWindow.state;
		const event = state && state.event;
		const style = state && state.settings && state.settings.displaymode_style;
		if (
			!iframeWindow ||
			!state ||
			!state.settings ||
			!style ||
			!iframeWindow.displaymode ||
			typeof iframeWindow.displaymode.render_v2_display_state !== 'function' ||
			!event ||
			!Array.isArray(event.matches) ||
			!Array.isArray(event.courts)
		) {
			return false;
		}
		const match = get_display_preview_match(iframeWindow);
		const primaryCourt = get_display_preview_court(iframeWindow);
		if (!match || !primaryCourt) {
			return false;
		}
		const useScorePatch = !!(
			previewState.sceneInitialized &&
			previewState.lastRenderedStyle === style &&
			typeof iframeWindow.displaymode.render_v2_display_score_update === 'function'
		);
		const renderDto = (dto) => {
			try {
				const rendered = useScorePatch
					? iframeWindow.displaymode.render_v2_display_score_update(state, dto)
					: iframeWindow.displaymode.render_v2_display_state(state, dto);
				if (rendered) {
					previewState.lastRenderedStyle = style;
				}
				return rendered;
			} catch (_err) {
				return false;
			}
		};
		if (!is_display_preview_v2_multi_style(style)) {
			return renderDto(build_display_preview_v2_single_state(event, match, primaryCourt, previewState));
		}
		return renderDto({
			type: 'display_multi_state',
			version: 1,
			client_mode: 'display',
			tournament: {
				key: event.id || 'tdemo',
				name: event.tournament_name || 'Test-Turnier',
			},
			display: {
				client_id: 'preview',
				hostname: 'preview',
				monitor_label: 'preview',
				preview: true,
			},
			selected_court_id: primaryCourt.court_id || primaryCourt._id || 'tdemo_5',
			display_settings: state.settings,
			court_states: build_display_preview_v2_multi_court_state(event, match, primaryCourt, previewState),
		});
	}

	function prepare_display_preview_v2_state(previewState, effectiveSettings) {
		const iframeWindow = previewState && previewState.iframe && previewState.iframe.contentWindow;
		if (
			!iframeWindow ||
			!iframeWindow.state ||
			!iframeWindow.displaymode ||
			typeof iframeWindow.displaymode.render_v2_display_state !== 'function'
		) {
			return false;
		}
		iframeWindow.state.settings = Object.assign({}, iframeWindow.state.settings || {}, effectiveSettings, {
			devicemode: 'display',
			court_id: effectiveSettings.court_id || 'tdemo_5',
			displaymode_court_id: effectiveSettings.displaymode_court_id || 'tdemo_5',
		});
		const event = iframeWindow.state.event;
		const eventReady = !!(
			event &&
			Array.isArray(event.matches) &&
			Array.isArray(event.courts) &&
			get_display_preview_match(iframeWindow) &&
			get_display_preview_court(iframeWindow)
		);
		if (!eventReady) {
			iframeWindow.state.event = build_display_setting_preview_event();
		}
		if (previewState.preparedPreviewStyle && previewState.preparedPreviewStyle !== effectiveSettings.displaymode_style) {
			previewState.sceneInitialized = false;
			previewState.lastRenderedStyle = null;
		}
		previewState.preparedPreviewStyle = effectiveSettings.displaymode_style || '';
		ensure_display_preview_visible(iframeWindow);
		previewState.v2Only = true;
		return true;
	}

	function update_display_preview_match(previewState, options = {}) {
		if (!previewState || !previewState.iframe || !previewState.iframe.contentWindow) {
			return false;
		}
		const iframe = previewState.iframe;
		const iframeWindow = iframe.contentWindow;
		const nextEvent = clone_display_preview_event(iframeWindow.state && iframeWindow.state.event);
		if (!nextEvent) {
			return false;
		}
		const match = Array.isArray(nextEvent.matches)
			? (nextEvent.matches.find((candidate) => candidate && candidate.setup && candidate.setup.match_id === 'tdemo_match_42') || nextEvent.matches[0] || null)
			: null;
		const court = Array.isArray(nextEvent.courts)
			? (nextEvent.courts.find((candidate) => candidate && candidate.court_id === 'tdemo_5') || nextEvent.courts[0] || null)
			: null;
		if (!match || !match.setup || !court) {
			return false;
		}

		const score = get_display_setting_preview_score(previewState, options);
		let lastScoreTimestamp = null;
		if (previewState.previewType === 'live' && Number.isFinite(previewState.livePhaseStartedAt)) {
			if ((previewState.livePhaseIndex || 0) === 0) {
				lastScoreTimestamp = previewState.livePhaseStartedAt - 1000;
			} else if ((previewState.livePhaseIndex || 0) === 1) {
				lastScoreTimestamp = previewState.livePhaseStartedAt;
			} else {
				lastScoreTimestamp = previewState.livePhaseStartedAt;
			}
		}
		const networkState = build_display_preview_network_state(match, score, {
			lastScoreTimestamp,
		});
		match.setup.court_id = 'tdemo_5';
		match.presses = networkState.presses;
		match.presses_json = JSON.stringify(networkState.presses);
		match.network_score = networkState.network_score;
		match.network_team1_serving = networkState.network_team1_serving;
		match.network_teams_player1_even = networkState.network_teams_player1_even;
		match.network_team0_left = networkState.network_team0_left;
		court.match_id = match.setup.match_id;
		iframeWindow.state.event = nextEvent;

		return render_display_preview_v2_if_needed(previewState);
	}

	function schedule_display_preview_match_resync(previewState) {
		if (!previewState) {
			return;
		}
		const delays = [80, 220, 500, 1000];
		delays.forEach((delayMs) => {
			window.setTimeout(() => {
				update_display_preview_match(previewState, { advance: false });
			}, delayMs);
		});
	}

	function apply_display_preview_settings(iframe, previewSettings, previewType) {
		if (!iframe || !iframe.contentWindow) {
			return false;
		}
		const iframeWindow = iframe.contentWindow;
		const iframeDocument = iframeWindow.document;
		if (!iframeDocument || iframeDocument.readyState !== 'complete') {
			return false;
		}

		const effectiveSettings = build_display_preview_bup_settings(previewSettings);
		const previewState = iframe._previewState || {
			iframe,
			previewType,
			sequenceIndex: 0,
		};
		previewState.lastEffectiveSettings = effectiveSettings;
		if (prepare_display_preview_v2_state(previewState, effectiveSettings)) {
			const updated = update_display_preview_match(previewState, { advance: false });
			if (updated) {
				previewState.sceneInitialized = true;
			}
			return updated;
		}
		return false;
	}

	function schedule_display_preview_refresh(existingState, previewSettings, options = {}) {
		if (!existingState || !existingState.iframe) {
			return;
		}
		if (existingState.refreshTimerId) {
			window.clearTimeout(existingState.refreshTimerId);
			existingState.refreshTimerId = null;
		}
		existingState.refreshAttempt = options.reset ? 0 : (existingState.refreshAttempt || 0);

		const tryApply = () => {
			if (!existingState || !existingState.iframe) {
				return;
			}
			const applied = apply_display_preview_settings(
				existingState.iframe,
				previewSettings,
				existingState.previewType
			);
			if (applied) {
				existingState.refreshTimerId = null;
				existingState.refreshAttempt = 0;
				ensure_display_preview_animation(existingState);
				return;
			}
			existingState.refreshAttempt = (existingState.refreshAttempt || 0) + 1;
			if (existingState.refreshAttempt >= 40) {
				existingState.refreshTimerId = null;
				return;
			}
			existingState.refreshTimerId = window.setTimeout(tryApply, 150);
		};

		tryApply();
	}

	function ensure_display_preview_animation(existingState) {
		if (!existingState || existingState.timerIntervalId) {
			return;
		}
		const scheduleNextTick = () => {
			if (!existingState) {
				return;
			}
			existingState.timerIntervalId = window.setTimeout(() => {
				existingState.timerIntervalId = null;
				update_display_preview_match(existingState, { advance: true });
				scheduleNextTick();
			}, get_display_preview_next_update_delay(existingState));
		};
		scheduleNextTick();
	}

	function ensure_display_preview_sync(existingState) {
		if (!existingState || existingState.syncIntervalId) {
			return;
		}
		existingState.syncIntervalId = window.setInterval(() => {
			update_display_preview_match(existingState, { advance: false });
		}, 500);
	}

	function ensure_display_preview_iframe(previewBody, previewSettings, previewType) {
		const existing = previewBody._displayPreviewState;
		if (existing && existing.iframe && existing.previewType === previewType) {
			schedule_display_preview_refresh(existing, previewSettings, { reset: true });
			return true;
		}

		if (previewBody._tabletPreviewState) {
			clear_preview_runtime_state(previewBody);
		}

		if (existing && existing.timerIntervalId) {
			window.clearTimeout(existing.timerIntervalId);
		}
		if (existing && existing.syncIntervalId) {
			window.clearInterval(existing.syncIntervalId);
		}

		uiu.empty(previewBody);
		const outer = uiu.el(previewBody, 'div', {
			class: 'bup_preview_outer',
			style: 'width:100%;',
		});
		const previews = uiu.el(outer, 'div', {
			class: 'bup_preview_panels',
			style: 'display:flex;flex-direction:column;gap:1rem;',
		});
		const panel = uiu.el(previews, 'div', {
			class: previewType === 'live' ? 'bup_preview_panel_live' : 'bup_preview_panel_primary',
		});
		const frame = uiu.el(panel, 'div', {
			style: [
				'position:relative',
				'width:100%',
				'padding:0.85rem',
				'border-radius:22px',
				'background:#0f0f10',
				'box-shadow:0 14px 30px rgba(0,0,0,0.18)',
			].join(';'),
		});
		const viewport = uiu.el(frame, 'div', {
			class: 'bup_preview_viewport',
			style: [
				'position:relative',
				'background:#111',
				'border-radius:18px',
				'overflow:hidden',
				'aspect-ratio:16 / 9',
				'width:100%',
			].join(';'),
		});
		const iframe = uiu.el(viewport, 'iframe', {
			class: 'bup_preview_frame',
			src: previewType === 'primary'
				? `${window.location.origin}/bup/#btspreview_primary&lang=de`
				: `${window.location.origin}/bup/#btspreview_live&lang=de`,
			title: 'BUP Display Vorschau',
			tabindex: '-1',
		});
		iframe.style.position = 'absolute';
		iframe.style.inset = '0';
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		iframe.style.border = '0';
		iframe.style.display = 'block';
		iframe.style.pointerEvents = 'none';
		iframe.style.background = '#111';

		previewBody._displayPreviewState = {
			previewType,
			iframe,
			timerIntervalId: null,
			syncIntervalId: null,
			refreshTimerId: null,
			refreshAttempt: 0,
			sequenceIndex: 0,
			sceneInitialized: false,
			primaryStepStartedAt: null,
			livePhaseIndex: 0,
			livePhaseStartedAt: null,
		};
		iframe._previewState = previewBody._displayPreviewState;

		iframe.addEventListener('load', () => {
			window.setTimeout(() => {
				schedule_display_preview_refresh(previewBody._displayPreviewState, previewSettings, { reset: true });
			}, 150);
		});

		const previewLabel = previewType === 'primary'
			? 'Vorschau: 2. Satz von 12:5 -> 21:10'
			: 'Vorschau: Pause im 2. Satz';
		uiu.el(previews, 'div', {
			style: 'font-size:0.92rem;color:#555;text-align:center;margin-top:-0.15rem;',
		}, previewLabel);

		return true;
	}

	function render_display_mode_preview(target, settings, previewType = 'primary') {
		const event = build_display_setting_preview_event();
		const match = event.matches[0];
		const colors = displaymode.calc_colors(settings, event, match);
		const score = get_display_setting_preview_score(previewType);
		match.network_score = [[21, 18], score.slice()];

		uiu.empty(target);

		target.style.background = colors.bg;
		target.style.color = colors.fg;
		target.style.border = `1px solid ${colors.border}`;
		target.style.borderRadius = '18px';
		target.style.padding = '1rem';
		target.style.minHeight = '0';
		target.style.height = '100%';
		target.style.width = '100%';
		target.style.boxSizing = 'border-box';
		target.style.position = 'relative';
		target.style.overflow = 'hidden';
		target.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.05)';

		if (settings.d_show_competition || settings.d_show_round || settings.d_show_court_number) {
			const meta = uiu.el(target, 'div', {
				style: 'display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;margin-bottom:0.85rem;',
			});
			if (settings.d_show_competition) {
				render_display_setting_badge(meta, match.setup.event_name, `background:${colors.bg3};color:${colors.fg};`);
			}
			if (settings.d_show_round) {
				render_display_setting_badge(meta, match.setup.match_name, `background:${colors.bg4};color:${colors.fg2};`);
			}
			if (settings.d_show_court_number) {
				render_display_setting_badge(meta, `Feld ${event.courts[0].label}`, `background:${colors.bg2};color:${colors.fgdark};`);
			}
		}

		const grid = uiu.el(target, 'div', {
			style: 'display:grid;grid-template-columns:1fr auto 1fr;gap:1rem;align-items:stretch;',
		});

		const renderTeam = (team, teamId) => {
			const teamForeground = colors[String(teamId)] || colors.fg;
			const teamBackground = colors['b' + teamId] || colors.bg3;
			const box = uiu.el(grid, 'div', {
				style: [
					'border-radius:14px',
					'padding:0.85rem',
					'min-height:150px',
					`background:${teamBackground}`,
					`color:${teamForeground}`,
					'display:flex',
					'flex-direction:column',
					'justify-content:space-between',
				].join(';'),
			});
			uiu.el(box, 'div', {
				style: 'font-size:0.78rem;opacity:0.9;text-transform:uppercase;letter-spacing:0.06em;',
			}, team.name);
			if (settings.d_show_players !== false) {
				const players = uiu.el(box, 'div', {
					style: 'display:flex;flex-direction:column;gap:0.4rem;margin:0.7rem 0;',
				});
				team.players.forEach((player, playerIdx) => {
					const isServing = teamId === 0 && playerIdx === 0;
					const isReceiving = settings.d_show_doubles_receiving && teamId === 1 && playerIdx === 0;
					uiu.el(players, 'div', {
						style: [
							'display:flex',
							'align-items:center',
							'justify-content:space-between',
							'gap:0.5rem',
							`color:${isServing ? colors.serv2 : isReceiving ? colors.recv : teamForeground}`,
							'font-weight:600',
						].join(';'),
					}, format_display_setting_preview_name(player, settings));
				});
			}
			if (settings.d_show_pause && previewType === 'live') {
				const timerRow = uiu.el(box, 'div', {
					style: 'display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;',
				});
				uiu.el(timerRow, 'span', {
					style: `color:${colors.tim_blue};`,
				}, 'Pause');
				uiu.el(timerRow, 'span', {
					style: `color:${colors.tim_active};font-weight:700;`,
				}, '00:37');
			}
			return box;
		};

		renderTeam(match.setup.teams[0], 0);

		const scoreBox = uiu.el(grid, 'div', {
			style: 'display:flex;flex-direction:column;justify-content:center;align-items:center;min-width:90px;gap:0.35rem;',
		});
		uiu.el(scoreBox, 'div', {
			style: `font-size:2.4rem;font-weight:800;color:${colors.fg};line-height:1;`,
		}, `${score[0]}:${score[1]}`);
		uiu.el(scoreBox, 'div', {
			style: `font-size:0.8rem;color:${colors.fg2};text-transform:uppercase;letter-spacing:0.08em;`,
		}, settings.displaymode_style || 'top+list');
		renderTeam(match.setup.teams[1], 1);
	}

	function render_umpire_mode_preview(target, settings, previewType = 'primary') {
		uiu.empty(target);
		target.style.background = '#151515';
		target.style.color = '#f5f5f5';
		target.style.border = '1px solid #333';
		target.style.borderRadius = '18px';
		target.style.padding = '1rem';
		target.style.minHeight = '260px';
		target.style.boxSizing = 'border-box';

		if (previewType === 'primary') {
			const top = uiu.el(target, 'div', {
				style: 'display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:0.9rem;',
			});
			const labels = uiu.el(top, 'div', {
				style: 'display:flex;gap:0.5rem;flex-wrap:wrap;',
			});
			render_display_setting_badge(labels, `Tablet: ${settings.style || 'default'}`, 'background:#2b2b2b;color:#fff;');
			if (settings.neversettings) {
				render_display_setting_badge(labels, 'Settings gesperrt', 'background:#8b1e1e;color:#fff;');
			}
			uiu.el(top, 'div', {
				style: 'font-size:0.9rem;color:#bdbdbd;',
			}, 'Spielauswahl');

			const matches = uiu.el(target, 'div', {
				style: 'display:flex;flex-direction:column;gap:0.6rem;',
			});
			[
				{ event: 'ME U17 HF', court: 'Feld 1', state: 'aktiv' },
				{ event: 'JE U13 Finale', court: 'Feld 2', state: 'bereit' },
				{ event: 'GD O19', court: 'Feld 3', state: 'wartet' },
			].forEach((row, index) => {
				const item = uiu.el(matches, 'div', {
					style: [
						'display:grid',
						'grid-template-columns:minmax(0,1fr) auto auto',
						'gap:0.75rem',
						'align-items:center',
						'border-radius:12px',
						'padding:0.8rem 0.9rem',
						`background:${index === 0 ? '#2b5d8a' : '#222'}`
					].join(';'),
				});
				uiu.el(item, 'div', { style: 'font-weight:700;' }, row.event);
				uiu.el(item, 'div', { style: 'color:#cfd8dc;font-size:0.9rem;' }, row.court);
				uiu.el(item, 'div', { style: 'color:#cfd8dc;font-size:0.9rem;text-transform:uppercase;' }, row.state);
			});
			return;
		}

		const top = uiu.el(target, 'div', {
			style: 'display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:0.9rem;',
		});
		const labels = uiu.el(top, 'div', {
			style: 'display:flex;gap:0.5rem;flex-wrap:wrap;',
		});
		render_display_setting_badge(labels, settings.shuttle_counter ? 'Federballzähler' : 'Live-Spiel', 'background:#2b2b2b;color:#fff;');
		if (settings.editmode_doubleclick) {
			render_display_setting_badge(labels, 'Doubleclick', 'background:#1b4965;color:#fff;');
		}
		uiu.el(top, 'div', {
			style: 'font-size:0.9rem;color:#bdbdbd;',
		}, `Klickmodus: ${settings.click_mode || 'auto'}`);

		const score = uiu.el(target, 'div', {
			style: 'display:grid;grid-template-columns:1fr auto 1fr;gap:0.75rem;align-items:center;margin-bottom:1rem;',
		});
		const left = uiu.el(score, 'div', {
			style: 'background:#222;border-radius:14px;padding:0.8rem;',
		});
		uiu.el(left, 'div', { style: 'font-size:0.78rem;color:#a0a0a0;margin-bottom:0.35rem;' }, 'Heim');
		uiu.el(left, 'div', { style: 'font-size:1rem;font-weight:700;' }, 'Max Mustermann / Paul Beispiel');
		const center = uiu.el(score, 'div', {
			style: 'font-size:2rem;font-weight:800;letter-spacing:0.04em;',
		}, '19:17');
		center.style.color = settings.negative_timers ? '#ffcc66' : '#ffffff';
		const right = uiu.el(score, 'div', {
			style: 'background:#222;border-radius:14px;padding:0.8rem;text-align:right;',
		});
		uiu.el(right, 'div', { style: 'font-size:0.78rem;color:#a0a0a0;margin-bottom:0.35rem;' }, 'Gast');
		uiu.el(right, 'div', { style: 'font-size:1rem;font-weight:700;' }, 'Jan Vorbild / Tom Muster');

		const controls = uiu.el(target, 'div', {
			style: 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0.55rem;',
		});
		[
			{ label: settings.shuttle_counter ? 'Shuttles 3' : 'Punkt Links', bg: settings.shuttle_counter ? '#3b3b3b' : '#1f7a45' },
			{ label: settings.negative_timers ? '-00:12' : 'Punkt Rechts', bg: settings.negative_timers ? '#7a5a1f' : '#9b3d1e' },
			{ label: settings.editmode_doubleclick ? 'Manuell: Doppelklick' : 'Pause', bg: settings.editmode_doubleclick ? '#1b4965' : '#2b5d8a' },
			{ label: settings.show_announcements && settings.show_announcements !== 'none' ? 'Ansage aktiv' : 'Ansage aus', bg: '#4a2b5d' },
		].forEach((button) => {
			uiu.el(controls, 'div', {
				style: [
					`background:${button.bg}`,
					'border-radius:12px',
					'padding:0.8rem 0.65rem',
					'text-align:center',
					'font-weight:700',
				].join(';'),
			}, button.label);
		});
	}

	function create_tablet_preview_demo_state(nowTs, options = {}) {
		const score = Array.isArray(options.score) ? options.score.slice(0, 2) : [10, 8];
		const intervalRemainingMs = options.intervalRemainingMs;
		const hasInterval = Number.isFinite(intervalRemainingMs);
		const intervalDurationMs = 60000;
		const boundedRemainingMs = hasInterval
			? Math.max(-60000, Math.min(intervalDurationMs, intervalRemainingMs))
			: null;
		const scoreTimestamp = hasInterval
			? nowTs - (intervalDurationMs - boundedRemainingMs)
			: nowTs - 1000;
		return {
			metadata: {
				id: 'tdemo_match_42',
				updated: nowTs,
			},
			setup: {
				incomplete: false,
				is_doubles: true,
				match_num: 42,
				counting: '3x21',
				team_competition: false,
				match_name: 'Finale',
				event_name: 'MX O55',
				umpire_name: 'Ulli Unparteiisch',
				teams: [
					{
						players: [
							{ name: 'Max Emil Mustermann', firstname: 'Max', middlename: 'Emil', lastname: 'Mustermann', nationality: 'GER' },
							{ name: 'Lena Beispiel', nationality: 'GER' },
						],
					},
					{
						players: [
							{ name: 'Timo Testfeld', nationality: 'GER' },
							{ name: 'Mia Sophie Demo', firstname: 'Mia', middlename: 'Sophie', lastname: 'Demo', nationality: 'GER' },
						],
					},
				],
				scheduled_time_str: '14:00',
				court_id: 'tdemo_5',
				match_id: 'tdemo_match_42',
			},
			presses: [
				{
					type: 'pick_side',
					team1_left: true,
					timestamp: scoreTimestamp - 3000,
				},
				{
					type: 'pick_server',
					team_id: 0,
					player_id: 0,
					timestamp: scoreTimestamp - 2000,
				},
				{
					type: 'pick_receiver',
					team_id: 1,
					player_id: 0,
					timestamp: scoreTimestamp - 1000,
				},
				{
					type: 'editmode_set-finished_games',
					scores: [[21, 18]],
					by_side: false,
					timestamp: scoreTimestamp - 500,
				},
				{
					type: 'editmode_set-score',
					score,
					by_side: false,
					resumed: true,
					timestamp: scoreTimestamp,
				},
			],
		};
	}

	function update_live_tablet_preview_match(iframe, options = {}) {
		if (!iframe || !iframe.contentWindow) {
			return false;
		}
		const iframeWindow = iframe.contentWindow;
		normalize_tablet_preview_event_data(iframeWindow);
		const nowTs = Date.now();
		const demoState = create_tablet_preview_demo_state(nowTs, options);
		try {
			iframeWindow.localStorage.setItem(
				'bup_match_tdemo_match_42',
				JSON.stringify(demoState)
			);
		} catch (_err) {
		}
		try {
			if (
				iframeWindow.control &&
				typeof iframeWindow.control.resume_match === 'function'
			) {
				iframeWindow.control.resume_match(demoState);
				return true;
			}
		} catch (_err) {
		}
		return false;
	}

	function sync_live_tablet_preview_cycle(existingState) {
		if (!existingState || existingState.previewType !== 'live' || !existingState.iframe) {
			return;
		}
		const nowTs = Date.now();
		if (!Number.isFinite(existingState.cycleStartedAt)) {
			existingState.cycleStartedAt = nowTs;
		}
		const pointDelayMs = 1500;
		const intervalDurationMs = 60000;
		const intervalStartTs = existingState.cycleStartedAt + pointDelayMs;
		if (nowTs < intervalStartTs) {
			if (existingState.phase !== 'pregame-score') {
				existingState.phase = 'pregame-score';
				update_live_tablet_preview_match(existingState.iframe, {
					score: [10, 8],
				});
			}
			return;
		}

		const intervalRemainingMs = intervalDurationMs - (nowTs - intervalStartTs);
		if (intervalRemainingMs <= -10000) {
			existingState.cycleStartedAt = nowTs;
			existingState.phase = 'pregame-score';
			update_live_tablet_preview_match(existingState.iframe, {
				score: [10, 8],
			});
			return;
		}

		existingState.phase = 'interval';
		update_live_tablet_preview_match(existingState.iframe, {
			score: [11, 8],
			intervalRemainingMs,
		});
	}

	function ensure_live_tablet_preview_timer(existingState) {
		if (!existingState || existingState.previewType !== 'live' || existingState.timerIntervalId) {
			return;
		}
		sync_live_tablet_preview_cycle(existingState);
		existingState.timerIntervalId = window.setInterval(() => {
			sync_live_tablet_preview_cycle(existingState);
		}, 1000);
	}

	function clear_preview_runtime_state(previewBody) {
		if (!previewBody) {
			return;
		}
		if (previewBody._tabletPreviewState && previewBody._tabletPreviewState.timerIntervalId) {
			window.clearInterval(previewBody._tabletPreviewState.timerIntervalId);
		}
		if (previewBody._displayPreviewState && previewBody._displayPreviewState.timerIntervalId) {
			window.clearTimeout(previewBody._displayPreviewState.timerIntervalId);
		}
		if (previewBody._displayPreviewState && previewBody._displayPreviewState.syncIntervalId) {
			window.clearInterval(previewBody._displayPreviewState.syncIntervalId);
		}
		if (previewBody._displayPreviewState && previewBody._displayPreviewState.refreshTimerId) {
			window.clearTimeout(previewBody._displayPreviewState.refreshTimerId);
		}
		previewBody._tabletPreviewState = null;
		previewBody._displayPreviewState = null;
	}

	function build_tablet_preview_bup_settings(previewSettings, previewType) {
		return Object.assign({}, previewSettings, {
			court_id: previewType === 'live' ? 'tdemo_5' : 'referee',
			court_description: '',
			language: previewSettings.language || 'de',
			style: previewSettings.style || 'default',
			tablet_mode: previewSettings.tablet_mode || 'umpire',
			neversettings: false,
		});
	}

	function set_preview_iframe_field(doc, name, value) {
		const field = doc.querySelector(`.settings [name="${name}"]`);
		if (!field) {
			return;
		}
		const normalizedTag = (field.tagName || '').toLowerCase();
		const normalizedType = (field.type || '').toLowerCase();
		if (normalizedType === 'checkbox') {
			field.checked = !!value;
		} else if (normalizedTag === 'select') {
			const normalizedValue = value == null ? '' : String(value);
			const matchingOption = Array.from(field.options || []).find((option) => option.value === normalizedValue);
			if (matchingOption) {
				const previousDisabled = matchingOption.disabled;
				if (previousDisabled) {
					matchingOption.disabled = false;
				}
				matchingOption.selected = true;
				field.value = normalizedValue;
				if (previousDisabled) {
					matchingOption.disabled = true;
				}
			} else {
				field.value = normalizedValue;
			}
		} else {
			field.value = value == null ? '' : String(value);
		}
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('change', { bubbles: true }));
		if (normalizedTag === 'select') {
			field.dispatchEvent(new Event('blur', { bubbles: true }));
		}
	}

	function apply_tablet_preview_settings(iframe, previewSettings, previewType) {
		if (!iframe || !iframe.contentWindow) {
			return false;
		}
		const iframeWindow = iframe.contentWindow;
		const iframeDocument = iframeWindow.document;
		if (!iframeDocument || iframeDocument.readyState !== 'complete') {
			return false;
		}

		const effectiveSettings = build_tablet_preview_bup_settings(previewSettings, previewType);
		try {
			iframeWindow.localStorage.setItem('bup_settings', JSON.stringify(effectiveSettings));
			normalize_tablet_preview_event_data(iframeWindow);
			if (previewType === 'live') {
				if (iframe._previewState && iframe._previewState.previewType === 'live') {
					sync_live_tablet_preview_cycle(iframe._previewState);
				} else {
					update_live_tablet_preview_match(iframe, {
						score: [10, 8],
					});
				}
			}
		} catch (_err) {
		}

		[
			['language', effectiveSettings.language],
			['fullscreen_ask', effectiveSettings.fullscreen_ask],
			['style', effectiveSettings.style],
			['tablet_mode', effectiveSettings.tablet_mode],
			['neversettings', effectiveSettings.neversettings],
			['negative_timers', effectiveSettings.negative_timers],
			['shuttle_counter', effectiveSettings.shuttle_counter],
			['editmode_doubleclick', effectiveSettings.editmode_doubleclick],
			['show_announcements', effectiveSettings.show_announcements],
			['click_mode', effectiveSettings.click_mode],
			['button_block_timeout', effectiveSettings.button_block_timeout],
		].forEach(([name, value]) => set_preview_iframe_field(iframeDocument, name, value));

		const runtimeSettings = {
			language: effectiveSettings.language,
			fullscreen_ask: effectiveSettings.fullscreen_ask,
			style: effectiveSettings.style,
			tablet_mode: effectiveSettings.tablet_mode,
			neversettings: effectiveSettings.neversettings,
			negative_timers: effectiveSettings.negative_timers,
			shuttle_counter: effectiveSettings.shuttle_counter,
			editmode_doubleclick: effectiveSettings.editmode_doubleclick,
			show_announcements: effectiveSettings.show_announcements,
			click_mode: effectiveSettings.click_mode,
			button_block_timeout: effectiveSettings.button_block_timeout,
			court_id: effectiveSettings.court_id,
			court_description: effectiveSettings.court_description,
		};

		try {
			if (
				iframeWindow.state &&
				iframeWindow.settings &&
				typeof iframeWindow.settings.change_all === 'function'
			) {
				iframeWindow.settings.change_all(iframeWindow.state, runtimeSettings);
				if (typeof iframeWindow.settings.on_mode_change === 'function') {
					iframeWindow.settings.on_mode_change(iframeWindow.state);
				}
				if (
					iframeWindow.displaymode &&
					typeof iframeWindow.displaymode.on_style_change === 'function'
				) {
					iframeWindow.displaymode.on_style_change(iframeWindow.state);
				}
			}
		} catch (_err) {
		}

		if ((previewType === 'live') && iframe._previewState) {
			schedule_display_preview_match_resync(iframe._previewState);
		}

		return true;
	}

	function ensure_tablet_preview_iframe(previewBody, previewSettings, previewType) {
		const existing = previewBody._tabletPreviewState;
		if (existing && existing.iframe && existing.previewType === previewType) {
			if (apply_tablet_preview_settings(existing.iframe, previewSettings, previewType)) {
				ensure_live_tablet_preview_timer(existing);
				return true;
			}
			return true;
		}

		if (previewBody._displayPreviewState) {
			clear_preview_runtime_state(previewBody);
		}

		if (existing && existing.timerIntervalId) {
			window.clearInterval(existing.timerIntervalId);
		}

		uiu.empty(previewBody);
		const outer = uiu.el(previewBody, 'div', {
			class: 'bup_preview_outer',
			style: 'width:100%;',
		});
		const previews = uiu.el(outer, 'div', {
			class: 'bup_preview_panels',
			style: 'display:flex;flex-direction:column;gap:1rem;',
		});
		const panel = uiu.el(previews, 'div', {
			class: previewType === 'live' ? 'bup_preview_panel_live' : 'bup_preview_panel_primary',
		});
		const frame = uiu.el(panel, 'div', {
			style: [
				'position:relative',
				'width:100%',
				'padding:0.45rem',
				'border-radius:16px',
				'background:#0f0f10',
				'box-shadow:0 14px 30px rgba(0,0,0,0.18)',
			].join(';'),
		});
		const viewport = uiu.el(frame, 'div', {
			class: 'bup_preview_viewport',
			style: [
				'position:relative',
				'background:#fff',
				'border-radius:12px',
				'overflow:hidden',
				'width:min(100%, 820px)',
				'height:510px',
			].join(';'),
		});
		const iframeSrc = previewType === 'live'
			? `${window.location.origin}/bup/#tdemo&m=tdemo_match_42`
			: `${window.location.origin}/bup/#tdemo&m=tdemo_match_42&settings&court=referee&lang=de`;
		const iframe = uiu.el(viewport, 'iframe', {
			class: 'bup_preview_frame',
			src: iframeSrc,
			title: 'BUP Vorschau',
			tabindex: '-1',
		});
		iframe.style.position = 'relative';
		iframe.style.width = '200%';
		iframe.style.height = '200%';
		iframe.style.border = '0';
		iframe.style.display = 'block';
		iframe.style.pointerEvents = 'none';
		iframe.style.transform = 'scale(0.5)';
		iframe.style.transformOrigin = 'top left';

		previewBody._tabletPreviewState = {
			previewType,
			iframe,
			timerIntervalId: null,
			cycleStartedAt: previewType === 'live' ? Date.now() : null,
			phase: null,
		};
		iframe._previewState = previewBody._tabletPreviewState;

		iframe.addEventListener('load', () => {
			window.setTimeout(() => {
				apply_tablet_preview_settings(iframe, previewSettings, previewType);
				ensure_live_tablet_preview_timer(previewBody._tabletPreviewState);
			}, 100);
		});

		return true;
	}

	function render_display_setting_preview(previewBody, form, previewType = 'primary') {
		if (!previewBody) {
			return;
		}
		const previewSettings = create_displaysettings_object(Object.fromEntries(new FormData(form).entries()));

		if (previewSettings.devicemode === 'umpire') {
			ensure_tablet_preview_iframe(previewBody, previewSettings, previewType);
			return;
		}
		ensure_display_preview_iframe(previewBody, previewSettings, previewType);
	}

	function render_edit_display_setting(form, display_setting) {
		const edit_display_setting_container = uiu.el(form, 'div', 'edit_display_setting_container');
		let previewRenderTimer = null;
		let previewAnimationTimer = null;
		let lastPreviewRenderSignature = null;
		const createSettingsSection = (title, className = '') => {
			const section = uiu.el(edit_display_setting_container, 'section', {
				class: `display_setting_section ${className}`.trim(),
			});
			if (title) {
				uiu.el(section, 'h4', {
					class: 'display_setting_section_title',
				}, title);
			}
			return section;
		};
		const createPreviewLayout = (settingsTitle, previewTitle, className = '') => {
			const section = createSettingsSection('', `display_setting_preview_layout ${className}`.trim());
			const settingsColumn = uiu.el(section, 'div', {
				class: 'display_setting_section_column display_setting_settings_column',
			});
			let settingsTitleEl = null;
			if (settingsTitle) {
				settingsTitleEl = uiu.el(settingsColumn, 'h4', {
					class: 'display_setting_section_title',
				}, settingsTitle);
			}
			const previewColumn = uiu.el(section, 'div', {
				class: 'display_setting_section_column display_setting_preview_section',
			});
			const previewBody = uiu.el(previewColumn, 'div', {
				class: 'display_setting_preview_body',
			});
			return {
				section,
				settingsColumn,
				settingsTitleEl,
				previewColumn,
				previewBody,
			};
		};
		const metaSection = createSettingsSection('Allgemein', 'display_setting_meta_section');
		const primaryLayout = createPreviewLayout('Spielauswahl', 'Vorschau');
		const secondaryLayout = createPreviewLayout('Live-Spiel', 'Vorschau laufendes Spiel', 'display_setting_live_layout');

		const id_div = uiu.el(metaSection, 'div');
		uiu.el(id_div, 'span', 'display_setting_id', ci18n('display_setting:id'));
		uiu.el(id_div, 'input', {
			type: 'text',
			name: 'display_setting_id',
			size: 24,
			required: 'required',
			value: display_setting.id || '',
			tabindex: 1,
			disabled: 'disabled',
		});


		const description_div = uiu.el(metaSection, 'div');
		uiu.el(description_div, 'span', 'display_setting_description', 'Description:');
		uiu.el(description_div, 'input', {
			type: 'text',
			name: 'display_setting_description',
			placeholder: ci18n('e.g. MX O55'),
			size: 18,
			value: display_setting.description || '',
			tabindex: 2,
		});

		const ALL_DEVICE_MODES = [
			'umpire',
			'display'
		];
		const ALL_BUP_LANGUAGES = [
			ci18n('display_setting:language_automatic'),
			ci18n('display_setting:language_en'),
			ci18n('display_setting:language_de'),
			ci18n('display_setting:language_de-AT'),
			ci18n('display_setting:language_de-CH'),
			ci18n('display_setting:language_fr-CH'),
			ci18n('display_setting:language_nl-BE'),
		];
		const SHORT_BUP_LANGUAGES = [
			'auto',
			'en',
			'de',
			'de-AT',
			'de-CH',
			'fr-CH',
			'nl-BE'
		];
		const ALL_ASK_FULLSCREAN_MODES = [
			'always',
			'auto',
			'never',
		];
		const ALL_ANNOUNCEMENT_MODES = [
			'none',
			'all',
			'except-first',
		];
		const ALL_CLICK_MODES = [
			'auto',
			'click',
			'touchstart',
			'touchend',
		];
		const ALL_TABLET_MODES = [
			'umpire',
			'scorecard',
		];
		const ALL_TABLET_MODE_LABELS = [
			ci18n('display_setting:tablet_mode:umpire'),
			ci18n('display_setting:tablet_mode:scorecard'),
		];
		const ALL_STYLE_MODES = [
			'default',
			'complete',
			'clean',
			'focus',
			'hidden',
		];


		const calculated_style = (display_setting.devicemode === 'umpire' ? 'umpire' : display_setting.displaymode_style);
		const is_default_display_setting = display_setting.id === curt.displaysettings_general;
		const is_default_tablet_setting = display_setting.id === curt.displaysettings_general_tablet;
		const is_protected_default = is_default_display_setting || is_default_tablet_setting;
		const getCurrentDeviceMode = () => {
			const enabledSelect = form.querySelector('select[name="devicemode"]:not([disabled])');
			if (enabledSelect) {
				return enabledSelect.value || '';
			}
			const hiddenInput = form.querySelector('input[name="devicemode"][type="hidden"]');
			if (hiddenInput) {
				return hiddenInput.value || '';
			}
			const anySelect = form.querySelector('select[name="devicemode"]');
			return anySelect ? (anySelect.value || '') : '';
		};
		const isDisplayDeviceMode = () => getCurrentDeviceMode() !== 'umpire';


		const devicemode_select = render_drop_down(
			metaSection,
			ci18n('display_setting:devicemode'),
			'devicemode',
			true,
			ALL_DEVICE_MODES,
			display_setting.devicemode || ''
		);
		if (is_protected_default) {
			devicemode_select.setAttribute('disabled', 'disabled');
			uiu.el(metaSection, 'input', {
				type: 'hidden',
				name: 'devicemode',
				value: display_setting.devicemode || '',
			});
		}
		const displaystyle_labels = displaymode.ALL_STYLES.map((style_id) => ci18n('displaymode|' + style_id, undefined, style_id));
		const displaystyle_select = render_drop_down(primaryLayout.settingsColumn, ci18n('display_setting:style'), 'displaymode_style', (display_setting.devicemode === 'umpire' ? 'umpire' : true), displaymode.ALL_STYLES, display_setting.displaymode_style || '', displaystyle_labels);
		render_check_box(
			secondaryLayout.settingsColumn,
			ci18n('display_setting:reverse_order') || 'Reihenfolge umkehren',
			'displaymode_reverse_order',
			true,
			display_setting.displaymode_reverse_order
		);
		const collectPreviewRenderSignature = () => JSON.stringify(Object.fromEntries(new FormData(form).entries()));
		const renderAllDisplaySettingPreviews = (force = false) => {
			const signature = collectPreviewRenderSignature();
			if (!force && signature === lastPreviewRenderSignature) {
				return;
			}
			lastPreviewRenderSignature = signature;
			render_display_setting_preview(primaryLayout.previewBody, form, 'primary');
			render_display_setting_preview(secondaryLayout.previewBody, form, 'live');
		};
		const scheduleDisplaySettingPreviewRender = (delay = 120, force = false) => {
			if (previewRenderTimer) {
				window.clearTimeout(previewRenderTimer);
			}
			previewRenderTimer = window.setTimeout(() => {
				previewRenderTimer = null;
				renderAllDisplaySettingPreviews(force);
			}, delay);
		};
		const ensureDisplayPreviewAnimation = () => {
			if (previewAnimationTimer) {
				window.clearInterval(previewAnimationTimer);
				previewAnimationTimer = null;
			}
		};
		
		displaystyle_select.addEventListener('change', (e) => {
			const style = e.target;
			update_edit_display_setting(style.value);
			scheduleDisplaySettingPreviewRender(80, true);
		});
		const updateSecondarySectionMode = () => {
			const isTablet = getCurrentDeviceMode() === 'umpire';
			if (secondaryLayout.settingsTitleEl) {
				secondaryLayout.settingsTitleEl.textContent = isTablet ? 'Live-Spiel' : 'Anzeige';
			}
			if (secondaryLayout.previewColumn) {
				secondaryLayout.previewColumn.style.display = 'flex';
			}
			secondaryLayout.section.style.gridTemplateColumns = isTablet
				? 'minmax(11rem, 14rem) minmax(0, 1fr)'
				: 'minmax(11rem, 14rem) minmax(0, 1fr)';
		};
		devicemode_select.addEventListener('change', () => {
			update_edit_display_setting(get_display_setting_form_style(form));
			updateSecondarySectionMode();
			scheduleDisplaySettingPreviewRender(80, true);
		});
		
		render_select_number(primaryLayout.settingsColumn, ci18n('display_setting:scale'), 'scale', calculated_style, display_setting.d_scale, 20, 500);
		
		const select_color_div = uiu.el(primaryLayout.settingsColumn, 'div', { style: 'display: block' });
		const select_color_label = uiu.el(select_color_div, 'label', {}, ci18n('display_setting:colors'));
		render_select_color(select_color_label, 'c0', calculated_style, display_setting.d_c0);
		render_select_color(select_color_label, 'c1', calculated_style, display_setting.d_c1);
		render_select_color(select_color_label, 'cb0', calculated_style, display_setting.d_cb0);
		render_select_color(select_color_label, 'cb1', calculated_style, display_setting.d_cb1);
		render_select_color(select_color_label, 'cbg', calculated_style, display_setting.d_cbg);
		render_select_color(select_color_label, 'cbg2', calculated_style, display_setting.d_cbg2);
		render_select_color(select_color_label, 'cbg3', calculated_style, display_setting.d_cbg3);
		render_select_color(select_color_label, 'cbg4', calculated_style, display_setting.d_cbg4);
		render_select_color(select_color_label, 'cfg', calculated_style, display_setting.d_cfg);
		render_select_color(select_color_label, 'cfg2', calculated_style, display_setting.d_cfg2);
		render_select_color(select_color_label, 'cfg3', calculated_style, display_setting.d_cfg3);
		render_select_color(select_color_label, 'cfg4', calculated_style, display_setting.d_cfg4);
		render_select_color(select_color_label, 'cfgdark', calculated_style, display_setting.d_cfgdark);
		render_select_color(select_color_label, 'cexp', calculated_style, display_setting.d_cexp);
		render_select_color(select_color_label, 'ct', calculated_style, display_setting.d_ct);
		render_select_color(select_color_label, 'cborder', calculated_style, display_setting.d_cborder);
		render_select_color(select_color_label, 'cserv', calculated_style, display_setting.d_cserv);
		render_select_color(select_color_label, 'cserv2', calculated_style, display_setting.d_cserv2);
		render_select_color(select_color_label, 'crecv', calculated_style, display_setting.d_crecv);
		render_select_color(select_color_label, 'ctim_blue', calculated_style, display_setting.d_ctim_blue);
		render_select_color(select_color_label, 'ctim_active', calculated_style, display_setting.d_ctim_active);
		uiu.visible(select_color_div, calculated_style !== 'umpire');
		render_drop_down(primaryLayout.settingsColumn, ci18n('display_setting:language'), 'language', true, SHORT_BUP_LANGUAGES, display_setting.language, ALL_BUP_LANGUAGES);
		uiu.el(form, 'input', {
			type: 'hidden',
			name: 'fullscreen_ask',
			value: 'never',
		});
		render_drop_down(primaryLayout.settingsColumn, ci18n('display_setting:settings_style'), 'style', calculated_style, ALL_STYLE_MODES, display_setting.style || '');
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:neversettings'), 'neversettings', true, display_setting.neversettings);

		// let current_language = '';

		// for (const [i, value] of SHORT_BUP_LANGUAGES.entries()) {
		// 	if ((display_setting.language || '') == value) {
		// 		current_language = ALL_BUP_LANGUAGES[i];
		// 		break;
		// 	}
		// }

		const tablet_mode_select = render_drop_down(
			secondaryLayout.settingsColumn,
			ci18n('display_setting:tablet_mode'),
			'tablet_mode',
			true,
			ALL_TABLET_MODES,
			display_setting.tablet_mode || 'umpire',
			ALL_TABLET_MODE_LABELS
		);
		tablet_mode_select.addEventListener('change', () => {
			update_edit_display_setting(get_display_setting_form_style(form));
			scheduleDisplaySettingPreviewRender(80, true);
		});
		render_check_box(secondaryLayout.settingsColumn, ci18n('display_setting:show_pause'), 'show_pause', calculated_style, display_setting.d_show_pause);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:show_court_number'), 'show_court_number', calculated_style, display_setting.d_show_court_number);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:show_competition'), 'show_competition', calculated_style, display_setting.d_show_competition);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:show_round'), 'show_round', calculated_style, display_setting.d_show_round);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:show_players'), 'show_players', calculated_style, display_setting.d_show_players !== false);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:show_team_name'), 'show_team_name', calculated_style, display_setting.d_show_team_name !== false);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:show_middle_name'), 'show_middle_name', calculated_style, display_setting.d_show_middle_name);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:abbreviate_first_name'), 'abbreviate_first_name', calculated_style, display_setting.d_abbreviate_first_name);
		render_check_box(primaryLayout.settingsColumn, ci18n('display_setting:show_doubles_receiving'), 'show_doubles_receiving', calculated_style, display_setting.d_show_doubles_receiving);
		render_text_input(primaryLayout.settingsColumn, ci18n('display_setting:tournament_overview_courts'), 'tournament_overview_courts', calculated_style, display_setting.d_tournament_overview_courts || '6,5,4,3,2', '6,5,4,3,2');
		render_check_box(secondaryLayout.settingsColumn, ci18n('display_setting:use_team_colors'), 'team_colors', calculated_style, display_setting.d_team_colors);
		render_check_box(secondaryLayout.settingsColumn, ci18n('display_setting:shuttle_counter'), 'shuttle_counter', calculated_style, display_setting.shuttle_counter);
		render_check_box(secondaryLayout.settingsColumn, ci18n('display_setting:negative_timers'), 'negative_timers', calculated_style, display_setting.negative_timers);
		render_check_box(secondaryLayout.settingsColumn, ci18n('display_setting:editmode_doubleclick'), 'editmode_doubleclick', calculated_style, display_setting.editmode_doubleclick);
		render_drop_down(secondaryLayout.settingsColumn, ci18n('display_setting:show_announcements'), 'show_announcements', calculated_style, ALL_ANNOUNCEMENT_MODES, display_setting.show_announcements || '');
		render_drop_down(secondaryLayout.settingsColumn, ci18n('display_setting:click_mode'), 'click_mode', calculated_style, ALL_CLICK_MODES, display_setting.click_mode || '');
		render_select_number(secondaryLayout.settingsColumn, ci18n('display_setting:button_block_timeout'), 'button_block_timeout', calculated_style, display_setting.button_block_timeout, 0, 5000);
		
		const technicalSection = createSettingsSection('Technik', 'display_setting_technical_section');
		render_select_number(technicalSection, ci18n('display_setting:network_timeout'), 'network_timeout', true, display_setting.network_timeout, 1, 600000);
		render_select_number(technicalSection, ci18n('display_setting:network_update_interval'), 'network_update_interval', true, display_setting.network_update_interval, 1, 600000);

		form.addEventListener('input', () => {
			scheduleDisplaySettingPreviewRender(180, false);
		});
		form.addEventListener('change', () => {
			scheduleDisplaySettingPreviewRender(80, false);
		});
		updateSecondarySectionMode();
		update_edit_display_setting(get_display_setting_form_style(form));
		renderAllDisplaySettingPreviews(true);
		ensureDisplayPreviewAnimation();
	}

	function render_drop_down(container, label_text, select_name, displaystyle, values, curval, labels) {
		if(!labels) {
			labels = values;
		}
		
		const div = uiu.el(container, 'div', {field_name: select_name});
		uiu.el(div, 'span', 'label', label_text);
		const select = uiu.el(div, 'select', {
			name: select_name,
			size: 1,
		});
		uiu.empty(select);
		for (const [i, s] of values.entries()) {
			const attrs = {
				value: s,
				label: labels[i] || s,
			};
			if (s === curval) {
				attrs.selected = 'selected';
			}
			uiu.el(select, 'option', attrs, labels[i] || s);
		}

		uiu.visible(div, (displaystyle === true || displaymode.option_applies(displaystyle, select_name)));

		return select;
	}

	function render_check_box(container, label_text, checkbox_name, displaystyle, is_checked) {
		const div = uiu.el(container, 'div', {field_name: checkbox_name});
		const label = uiu.el(div, 'label');
		const attrs = {
			type: 'checkbox',
			name: checkbox_name,
		};

		if (is_checked) {
			attrs.checked = 'checked';
		}

		uiu.el(label, 'input', attrs);
		uiu.el(label, 'span', 'display_setting_label', label_text);

		uiu.visible(div, (displaystyle === true || displaymode.option_applies(displaystyle, checkbox_name)));
	}

	function render_text_input(container, label_text, input_name, displaystyle, value, placeholder) {
		const div = uiu.el(container, 'div', {field_name: input_name});
		uiu.el(div, 'span', 'label', label_text);
		uiu.el(div, 'input', {
			type: 'text',
			name: input_name,
			value: value || '',
			placeholder: placeholder || '',
		});

		uiu.visible(div, (displaystyle === true || displaymode.option_applies(displaystyle, input_name)));
	}

	function render_select_color(container, field_name, displaystyle, value) {
		const input = uiu.el(container, 'input', {
			type: 'color',
			name: field_name,
			title: field_name,
			field_name: field_name,
			value: value || '#000000',
		});

		uiu.visible(input, (displaystyle === true ||displaymode.option_applies(displaystyle, field_name)));
	}

	function render_select_number(container, label_text, input_name, displaystyle, value, min_value, max_value) {
		const div = uiu.el(container, 'div', {field_name: input_name});
		const label = uiu.el(div, 'span', 'label', label_text);
		uiu.el(div, 'input', {
			type: 'number',
			name: input_name,
			min: min_value || 0,
			max: max_value || 0,
			value: value || 0,
		});

		uiu.visible(div, (displaystyle === true ||displaymode.option_applies(displaystyle, input_name)));
	} 

	function create_displaysettings_object(d) {
		const displaysetting  = {
			id: d.display_setting_id,
			description: d.display_setting_description || '',
			devicemode: d.devicemode || 'display',
			displaymode_style: d.displaymode_style || 'tournamentcourt',
			displaymode_court_id: d.displaymode_court_id || '',
			displaymode_reverse_order: d.displaymode_reverse_order == 'on' ? true : false,
			d_tournament_overview_courts: d.tournament_overview_courts || (
				d.displaymode_style === 'tournament_overview_dm'
					? '6,5,4,3,2'
					: ''
			),
			d_show_pause: d.show_pause == 'on' ? true : false,
			d_show_court_number: d.show_court_number == 'on' ? true : false,
			d_show_competition: d.show_competition == 'on' ? true : false,
			d_show_round: d.show_round == 'on' ? true : false,
			d_show_players: (
				!displaymode.option_applies(d.displaymode_style || 'tournamentcourt', 'show_players') ||
				d.show_players == 'on'
			),
			d_show_team_name: (
				!displaymode.option_applies(d.displaymode_style || 'tournamentcourt', 'show_team_name') ||
				d.show_team_name == 'on'
			),
			d_show_middle_name: d.show_middle_name == 'on' ? true : false,
			d_abbreviate_first_name: d.abbreviate_first_name == 'on' ? true : false,
			d_show_doubles_receiving: d.show_doubles_receiving == 'on' ? true : false,
			d_c0: d.c0 || '#50e87d',
			d_c1: d.c1 || '#f76a23',
			d_cb0: d.cb0 || '#000000',
			d_cb1: d.cb1 || '#000000',
			d_cbg: d.cbg || '#000000',
			d_cbg2: d.cbg2 || '#d9d9d9',
			d_cbg3: d.cbg3 || '#252525',
			d_cbg4: d.cbg4 || '#404040',
			d_cfg: d.cfg || '#ffffff',
			d_cfg2: d.cfg2 || '#aaaaaa',
			d_cfg3: d.cfg3 || '#cccccc',
			d_cfg4: d.cfg4 || '#000000',
			d_cfgdark: d.cfgdark || '#000000',
			d_cexp: d.cexp || '#000000',
			d_ct: d.ct || '#80ff00',
			d_cborder: d.cborder || '#444444',
			d_cserv: d.cserv || '#fff200',
			d_cserv2: d.cserv2 || '#dba766',
			d_crecv: d.crecv || '#707676',
			d_ctim_blue: d.ctim_blue || '#0070c0',
			d_ctim_active: d.ctim_active || '#ffc000',
			d_team_colors: d.team_colors == 'on' ? true : false,
			d_scale: d.scale || '100',
			fullscreen_ask: 'never',
			show_announcements: d.show_announcements || 'all', 
			neversettings: d.neversettings == 'on' ? true : false,
			button_block_timeout: d.button_block_timeout || '100',
			negative_timers: d.negative_timers == 'on' ? true : false,
			shuttle_counter: d.shuttle_counter == 'on' ? true : false,
			editmode_doubleclick: d.editmode_doubleclick == 'on' ? true : false,
			click_mode: d.click_mode || 'auto',
			tablet_mode: d.tablet_mode || 'umpire',
			style: d.style || 'complete',
			network_timeout: d.network_timeout || '10000',
			network_update_interval: d.network_update_interval || '10000',
			language: d.language || 'auto',
		}

		//

		return displaysetting;
	}

	function update_edit_display_setting(displaystyle)
	{
		const form = document.querySelector('.display_setting_edit_dialog form');
		const devicemodeInput = form ? form.querySelector('[name="devicemode"]') : null;
		const currentDeviceMode = devicemodeInput ? (devicemodeInput.value || '') : 'display';
		const isDisplayMode = currentDeviceMode !== 'umpire';
		const tabletModeInput = form ? form.querySelector('[name="tablet_mode"]') : null;
		const currentTabletMode = tabletModeInput ? (tabletModeInput.value || 'umpire') : 'umpire';
		const isScorecardTabletMode = currentTabletMode === 'scorecard';
		const umpirePanelOnlyTabletFields = {
			show_announcements: true,
			negative_timers: true,
			shuttle_counter: true,
			editmode_doubleclick: true,
		};
		const names = [ 'displaymode_style', 'displaymode_reverse_order', 'tournament_overview_courts', 'show_pause', 'show_court_number', 'show_competition', 'show_round', 'show_players', 'show_team_name', 'show_middle_name', 'abbreviate_first_name', 'show_doubles_receiving', 
						'c0', 'c1', 'cb0', 'cb1', 'cbg', 'cbg2', 'cbg3', 'cbg4', 'cfg', 'cfg2', 'cfg3', 'cfg4', 'cfgdark', 'cexp', 'ct', 
						'cborder', 'cserv', 'cserv2', 'crecv', 'ctim_blue', 'ctim_active', 'team_colors', 'scale',
						'tablet_mode', 'show_announcements', 'neversettings', 'button_block_timeout', 'negative_timers', 'shuttle_counter', 'editmode_doubleclick', 
						'click_mode', 'style', 'language'];
		
		names.forEach((field_name) => {
			const update = form ? form.querySelector(`[field_name="${field_name}"]`) : null;
			if (!update) {
				return;
			}
			let isVisible = (displaystyle === true || displaymode.option_applies(displaystyle, field_name));
			if (field_name === 'displaymode_style') {
				isVisible = isDisplayMode;
			} else if (field_name === 'displaymode_reverse_order') {
				isVisible = isDisplayMode && displaymode.option_applies(displaystyle, 'reverse_order');
			} else if (field_name === 'tablet_mode') {
				isVisible = !isDisplayMode;
			} else if (umpirePanelOnlyTabletFields[field_name]) {
				isVisible = !isDisplayMode && !isScorecardTabletMode;
			}
			uiu.visible(update, isVisible);
		});
	}

	function update_general_displaysettings(c)
	{	
		//const general_displaysettings_div = uiu.qs('.general_displaysettings');
		const general_displaysettings_div = document.querySelector(".general_displaysettings");
		if(general_displaysettings_div) {
			general_displaysettings_div.innerHTML = '';
			render_general_displaysettings(general_displaysettings_div);
		}
	}

	function render_displaysettings(general_displaysettings_div) {
		uiu.el(general_displaysettings_div, 'h3', 'edit', ci18n('tournament:edit:displays'));

		const display_table = uiu.el(general_displaysettings_div, 'table');
		const display_tbody = uiu.el(display_table, 'tbody', 'display_tbody');
		const tr = uiu.el(display_tbody, 'tr');
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:num'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:hostname'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:batterylevel')); 
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:court'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:setting'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:onlinestatus'));
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:ack_time'));
		uiu.el(tr, 'th', {}, "");
		uiu.el(tr, 'th', {}, "");
		

		const rendered_display_ids = new Set();
		for (const display of curt.displays) {
			if (rendered_display_ids.has(display.client_id)) {
				continue;
			}
			rendered_display_ids.add(display.client_id);
			const tr = uiu.el(display_tbody, 'tr', { 'data-display_id': display.client_id });
			render_display(tr, display);
		}
	}

	function update_display(display) {
		// Do this function only if the Display view (in on edit) is open
		if(!document.querySelectorAll('.display_tbody').length) {
			return;
		}
		
		var nodes = document.querySelectorAll('[data-display_id=' + JSON.stringify(display.client_id) + ']');
		if(nodes.length > 0) {
			for (let i = 1; i < nodes.length; i++) {
				uiu.remove(nodes[i]);
			}
			uiu.qsEach('[data-display_id=' + JSON.stringify(display.client_id) + ']', function (display_tr) {
				display_tr.innerHTML = '';
				render_display(display_tr, display);
			});
		}
		else {
			new_display(display);
		}
	}

	function new_display(display) {
		const display_tbody = document.querySelector(".display_tbody");
		const tr = uiu.el(display_tbody, 'tr', { 'data-display_id': display.client_id });
		render_display(tr, display);

		for (const child of display_tbody.children) {
			const child_id = child.dataset.display_id;
			if(child_id && Number(child_id) > Number(display.client_id))
			{
				display_tbody.insertBefore(tr, child);
			}
		}
	}


	function render_display(tr, display) {
		tr.setAttribute('class', (!display.online) ? 'offline' : (display.wait_for_done ? 'wait_for_done' : 'online'));
		uiu.el(tr, 'th', {}, display.client_id);
		uiu.el(tr, 'th', {}, display.hostname);
		var battery_node = uiu.el(tr, 'td', {}, 'N/A');
		set_battery_state(display.battery, battery_node);
		createCourtSelectBox(uiu.el(tr, 'td', {}, ''), display.client_id, display.court_id, display.displaysetting_id);
		createDisplaySettingsSelectBox(uiu.el(tr, 'td', {}, ''), display.client_id, display.displaysetting_id);
		uiu.el(tr, 'td', {}, (!display.online) ? 'offline' : 'online');
		uiu.el(tr, 'td', {}, format_display_ack_stats(display.display_render_stats));
		const actions_td = uiu.el(tr, 'td', {});
		const reset_btn = uiu.el(actions_td, 'button', {
			'data-display-client-id': display.client_id,
		}, 'Restart');

		if (!display.online) {
			reset_btn.setAttribute('disabled', 'disabled');
		}
		reset_btn.addEventListener('click', function (e) {
			const rst_btn = e.target;
			const display_client_id = rst_btn.getAttribute('data-display-client-id');
			send_with_live_status({
				type: 'display_reset',
				tournament_key: curt.key,
				display_client_id: display_client_id,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
			});
		});

		const delete_td = uiu.el(tr, 'td', {});
		const delete_btn = uiu.el(delete_td, 'button', {
			'data-display-client-id': display.client_id,
		}, 'Delete');
		if (display.online) {
			delete_btn.setAttribute('disabled', 'disabled');
		}
		delete_btn.addEventListener('click', function (e) {
			const del_btn = e.target;
			const display_client_id = del_btn.getAttribute('data-display-client-id');
			send_with_live_status({
				type: 'display_delete',
				tournament_key: curt.key,
				display_client_id: display_client_id,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function format_display_ack_stats(stats) {
		if (!stats || !stats.ack_count || typeof stats.avg_roundtrip_ms !== 'number') {
			return '—';
		}
		return 'Ø ' + stats.avg_roundtrip_ms + ' ms (' + stats.ack_count + ')';
	}

	function delete_display(c) {
		uiu.qsEach('[data-display_id=' + JSON.stringify(c.val) + ']', function (display_tr) {
			display_tr.parentNode.removeChild(display_tr);
		});
	}

	function render_locations(main) {
		const location_div = uiu.el(main, 'div', 'locations_div');
		uiu.el(location_div, 'h2', 'edit', ci18n('tournament:edit:location'));

		const locations_table = uiu.el(location_div, 'table', 'locations_table');
		const locations_tbody = uiu.el(locations_table, 'tbody');

		const tr = uiu.el(locations_tbody, 'tr');
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:location'));
		uiu.el(tr, 'th', {}, 'in Vorbereitung Ergänzung');
		uiu.el(tr, 'th', {}, 'Meetingpoint-Durchsage');
		uiu.el(tr, 'th', {}, 'in Vorbereitung Icon');
		uiu.el(tr, 'th', {}, '');

		let highlight_in_use = [];
		for (const l of curt.locations) {
			if(l.highlight) {
				highlight_in_use.push(l.highlight);
			}
		}

		function resolve_singular_plural_template(text, use_plural) {
			return (text || '').replace(/\{([^{}\/]*)\/([^{}]*)\}/g, function(match, singular, plural) {
				return use_plural ? plural : singular;
			});
		}

		function create_preparation_preview_text(preparation_text, use_plural) {
			const addition = resolve_singular_plural_template(preparation_text, use_plural).trim();
			return ci18n('announcements:preparation') + (addition ? ' ' + addition : '');
		}

		function create_meetingpoint_preview_text(meetingpoint_text, use_plural) {
			return resolve_singular_plural_template(meetingpoint_text, use_plural).trim() || ci18n('announcements:meetingpoint');
		}

		function create_second_preparation_call_preview_text(name, preparation_text, use_plural) {
			const addition = resolve_singular_plural_template(preparation_text, use_plural).trim();
			return ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation') + ' ' + ci18n('announcements:second_call_for') + ':' + name + (addition ? ' ' + addition : '') + '!';
		}

		function create_tablet_meetingpoint_preview_text(name, meetingpoint_text, use_plural) {
			let meetingpoint = create_meetingpoint_preview_text(meetingpoint_text, use_plural);
			meetingpoint = meetingpoint.replace("bitte meldet euch ", "");
			meetingpoint = meetingpoint.replace("Bitte meldet euch ", "");
			meetingpoint = meetingpoint.replace("!", "");
			return name + ', ' + ci18n('announcements:please_as_tablet_service') + ' ' + meetingpoint + 'melden!';
		}

		function join_announcement_preview_parts(parts) {
			return parts.filter(part => part != null && part !== '').join(' ');
		}

		function create_location_announcement_input(td, location, field) {
			const textarea = create_textarea_input("textarea", td, field);
			textarea.value = location[field] || '';
			textarea.setAttribute('data-location-id', location._id);
			textarea.setAttribute('maxlength', 175);
			textarea.setAttribute('placeholder', 'Optional: {Einzahl/Mehrzahl}');
			textarea.addEventListener('input', (e) => {
				update_location_announcement_preview(e.target.parentNode.parentNode, e.target.getAttribute('data-location-id'));
			});
			textarea.addEventListener('focusout', (e) => {
				send_location_to_admin(e.target.parentNode.parentNode, e.target.getAttribute('data-location-id'));
			});
			return textarea;
		}

		function update_location_announcement_preview(parent, location_id) {
			const preparation_text = parent.querySelector("#preparation_addition").value.trim();
			const meetingpoint_input = parent.querySelector("#meetingpoint_announcement");
			const meetingpoint_text = meetingpoint_input.value.trim();
			const preview = document.querySelector('[data-location-preview="announcement_messages"][data-location-id=' + JSON.stringify(location_id) + ']');
			if (!preview) {
				return;
			}
			preview.innerHTML = '';
			const meetingpoint_enabled = !!curt.preparation_meetingpoint_enabled;
			meetingpoint_input.disabled = !meetingpoint_enabled;
			meetingpoint_input.parentNode.classList.toggle('location_announcement_disabled', !meetingpoint_enabled);
			add_location_preview_item(preview, 'Erster Vorbereitungsaufruf', [
				join_announcement_preview_parts([
					create_preparation_preview_text(preparation_text, true),
					'[für Feld 1!]',
					'Max Mustermann gegen Erika Beispiel!',
					meetingpoint_enabled ? create_meetingpoint_preview_text(meetingpoint_text, true) : create_preparation_preview_text(preparation_text, true),
				]),
			]);
			if (meetingpoint_enabled) {
				add_location_preview_item(preview, 'Zweiter Aufruf Spieler', [
					join_announcement_preview_parts([
						create_second_preparation_call_preview_text('Max Mustermann', preparation_text, false),
						'Max Mustermann ' + create_meetingpoint_preview_text(meetingpoint_text, false),
					]),
					join_announcement_preview_parts([
						create_second_preparation_call_preview_text('Max Mustermann / Erika Beispiel', preparation_text, true),
						'Max Mustermann / Erika Beispiel ' + create_meetingpoint_preview_text(meetingpoint_text, true),
					]),
				]);
				add_location_preview_item(preview, 'Zweiter Aufruf Schiedsrichter / Service Judge', [
					join_announcement_preview_parts([
						ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation') + ' ' + ci18n('announcements:second_call_for') + ':Schiedsrichter Max!',
						'Schiedsrichter Max ' + create_meetingpoint_preview_text(meetingpoint_text, false),
					]),
				]);
				add_location_preview_item(preview, 'Zweiter Aufruf Tabletbediener', [
					join_announcement_preview_parts([
						ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation') + ' ' + ci18n('announcements:second_call_for') + ':Tabletbediener Max!',
						create_tablet_meetingpoint_preview_text('Tabletbediener Max', meetingpoint_text, false),
					]),
					join_announcement_preview_parts([
						ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation') + ' ' + ci18n('announcements:second_call_for') + ':Tabletbediener Max / Tabletbediener Erika!',
						create_tablet_meetingpoint_preview_text('Tabletbediener Max / Tabletbediener Erika', meetingpoint_text, true),
					]),
				]);
			} else {
				add_location_preview_item(preview, 'Zweiter Aufruf Spieler', [
					create_second_preparation_call_preview_text('Max Mustermann', preparation_text, false),
					create_second_preparation_call_preview_text('Max Mustermann / Erika Beispiel', preparation_text, true),
				]);
			}
		}

		function add_location_preview_item(parent, label, messages) {
			const item = uiu.el(parent, 'div', 'location_announcement_preview_item');
			uiu.el(item, 'div', 'location_announcement_preview_label', label);
			for (const message of messages) {
				uiu.el(item, 'strong', {}, message);
			}
		}

		refresh_location_announcement_previews = function() {
			uiu.qsEach('.locations_table tr[data-location-id]', function(row) {
				if (row.querySelector("#preparation_addition") && row.querySelector("#meetingpoint_announcement")) {
					update_location_announcement_preview(row, row.getAttribute('data-location-id'));
				}
			});
		};

		for (const l of curt.locations) {
			const tr = uiu.el(locations_tbody, 'tr', {'data-location-id': l._id});
			const name_th = uiu.el(tr, 'th', {});
			uiu.el(name_th, 'div', {}, l.name);

			const content = [1, 2, 3, 4, 5, 6];
			const selected = l.highlight;
			const select_color = uiu.el(name_th, 'select', {id: 'select_highlight', class: 'highlight_' + selected, 'data-location_id': l._id});
			for (const item of content) {			
					const attrs = {
						'data-display-setting-id': item,
						value: item,
						class: 'highlight_' + item,
						style: (highlight_in_use.includes(item) && selected !== item) ? 'display:none;' : '',
					}
					if ((selected === item)) {
						attrs.selected = 'selected';
					}
					uiu.el(select_color, 'option', attrs);
				//}
			}

			select_color.addEventListener('change', (e) => {
				e.target.classList = [e.target.value];
				send_location_to_admin(e.target.parentNode.parentNode, e.target.getAttribute('data-location_id'));
			});
				
			const preparation_td = uiu.el(tr, 'td', {});
			create_location_announcement_input(preparation_td, l, 'preparation_addition');

			const meetinpoint_td = uiu.el(tr, 'td', {});
			create_location_announcement_input(meetinpoint_td, l, 'meetingpoint_announcement');
			const icon_td = uiu.el(tr, 'td', 'icon_td');
			uiu.el(icon_td, 'img', {
				style: 'height: 40px;',
				src: l.logo_id ? '/h/' + encodeURIComponent(curt.key) + '/logo/' + l.logo_id : '/static/icons/preparation.svg',
				name: 'location_logo_img',
				'data-location_id': l._id
			});

			const logo_form = uiu.el(icon_td, 'form', 'logo_form');
			const logo_button_id = l._id +'_logo_upload_input';

			const filename_display = uiu.el(logo_form, 'div', {
				class: 'upload_filename_location',
				'data-location_id': l._id,
			}, l.logo_name ? l.logo_name : 'preparation.svg');

			const custom_label = uiu.el(logo_form, 'label', {
				for: logo_button_id,
				style: (
					'display:inline-block;padding:3px 8px;cursor:pointer; border:1px solid;' +
					'background:#eeeeee;color:black;border-radius:4px;margin:5px;font-size:small;'
				),
			}, 'ändern');

			const logo_button = uiu.el(logo_form, 'input', {
				id: logo_button_id,
				type: 'file',
				accept: 'image/*',
				style: 'display:none;',
				'data-location_id': l._id, 
			});
			logo_button.addEventListener('change', (e) => {
				_upload_location_logo(e);
			});

			const actions_td = uiu.el(tr, 'td', {});
			const del_btn = uiu.el(actions_td, 'button', {
				'data-location-id': l._id,
			}, 'Delete');
			del_btn.addEventListener('click', function (e) {
				const del_btn = e.target;
				const location_id = del_btn.getAttribute('data-location-id');
				if (confirm('Do you really want to delete ' + location_id + '? (Will not do anything yet!)')) {
					debug.log('TODO: would now delete court');
				}
			});

			const preview_tr = uiu.el(locations_tbody, 'tr', {
				class: 'location_announcement_preview_row',
				'data-location-preview-row': l._id,
			});
			const preview_td = uiu.el(preview_tr, 'td', {colspan: 5});
			const announcement_preview = uiu.el(preview_td, 'div', 'location_announcement_preview');
			uiu.el(announcement_preview, 'div', 'location_announcement_preview_title', 'Aktuell mögliche Durchsagen');
			uiu.el(announcement_preview, 'div', {
				'data-location-preview': 'announcement_messages',
				'data-location-id': l._id,
			}, '');
			update_location_announcement_preview(tr, l._id);
		}
	}

	function _upload_location_logo(e) {
		const input = e.target;
		const location_id = e.target.getAttribute('data-location_id');
		if (!input.files.length) return;

		const reader = new FileReader();
		reader.readAsDataURL(input.files[0]);
		reader.onload = () => {
			send_with_live_status({
				type: 'tournament_upload_location_logo',
				tournament_key: curt.key,
				data_url: reader.result,
				name: e.target.files[0].name,
				location_id
			}, (err) => {
				if (err) {
					return cerror.net(err);
				}`
				input.closest('form').reset();`
			});
		};
		reader.onerror = (e) => {
			alert('Failed to upload: ' + e);
		};
	}

	function update_location_logo(location_id, logo_id, logo_name) {
		switch (get_admin_subpage()){
			case 'edit':
				const location_logo_img = document.querySelector(`[name="location_logo_img"][data-location_id="${location_id}"]`);
				location_logo_img.setAttribute('src', '/h/' + encodeURIComponent(curt.key) + '/logo/' + logo_id);
				const filename_display = document.querySelector(`.upload_filename_location[data-location_id="${location_id}"]`);
				filename_display.textContent = logo_name;
				break;
			default:
				break;
		}
		return;
	}

	function send_location_to_admin(parent, location_id) {
		const highlight = parseInt(parent.querySelector("#select_highlight").value, 10);
		const preparation_addition = parent.querySelector("#preparation_addition").value;
		const meetingpoint_announcement = parent.querySelector("#meetingpoint_announcement").value;

		send_with_live_status({
			type: 'location_changed',
			tournament_key: curt.key,
			location_id,
			highlight: highlight,
			preparation_addition,
			meetingpoint_announcement,
		}, function (err, response) {
			if (err) {
				return cerror.net(err);
			}
		});
	}

	function update_location(location_id, highlight, preparation_addition, meetingpoint_announcement) {
		switch (get_admin_subpage()){
			case 'edit':
				update_edit_locations_and_courts();
				break;
			default:
				break;
		}
		return;
	};

	function update_edit_locations_and_courts() {
		if (current_view !== 'edit') {
			return;
		}
		let section = document.querySelector('.location_settings_section');
		if (!section) {
			const locations_div = document.querySelector('.locations_div');
			section = locations_div ? locations_div.parentElement : null;
		}
		if (!section) {
			return;
		}
		section.innerHTML = '';
		section.classList.add('location_settings_section');
		render_locations(section);
		render_courts(section);
		update_edit_dependencies();
	}

/* ============================================================
 * DROP-ZONES (schmale Reihen zum Droppen)
 * ============================================================ */

function add_drop_zones_to_tbody(tbody, {
  row_selector = '.officials_row',
  zone_class = 'drop-zone',
  zone_active_class = 'drop-zones-active',
  is_header_row = (row) => row.classList.contains('officials_list_header'),
  col_count = 3,
  on_zone_dragover = (tbody, insertBeforeRow, e) => {},
} = {}) {
  for (const z of [...tbody.querySelectorAll(`.${zone_class}`)]) z.remove();
  tbody.classList.add(zone_active_class);

  const rows = [...tbody.querySelectorAll(row_selector)];
  const header = rows.find(is_header_row) || null;

  const dataRows = rows.filter(row =>
    row !== header &&
    row.getAttribute('data-official-id') &&
    !row.classList.contains(zone_class)
  );

  function makeZone(insertBeforeRow) {
    const zone = document.createElement('div');
    zone.className = `officials_drop_zone ${zone_class}`;
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      on_zone_dragover(tbody, insertBeforeRow, e);
    });
    zone.addEventListener('drop', (e) => e.preventDefault());
    zone.addEventListener('dragenter', () => zone.classList.add('drop-zone-hover'));
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-zone-hover'));
    return zone;
  }

  const topZone = makeZone(dataRows[0] || null);
  if (header) {
    if (header.nextSibling) tbody.insertBefore(topZone, header.nextSibling);
    else tbody.appendChild(topZone);
  } else {
    tbody.insertBefore(topZone, tbody.firstChild);
  }

  for (let i = 0; i < dataRows.length; i++) {
    const current = dataRows[i];
    const next = dataRows[i + 1] || null;
    const zone = makeZone(next);
    if (current.nextSibling) tbody.insertBefore(zone, current.nextSibling);
    else tbody.appendChild(zone);
  }
}


function remove_drop_zones_from_tbody(tbody, {
  zone_class = 'drop-zone',
  zone_active_class = 'drop-zones-active',
} = {}) {
  tbody.classList.remove(zone_active_class);
  for (const z of [...tbody.querySelectorAll(`.${zone_class}`)]) {
    z.remove();
  }
}

/* ============================================================
 * MULTI-TABLE DND (mit Drop-Zones, zwischen Tabellen)
 * ============================================================ */

function enable_multitable_row_dragdrop(tbodies, {
  row_selector = '.officials_row',
  table_id_attr = 'data-table-id',
  row_id_attr = 'data-official-id',
  is_header_row = (row) => row.classList.contains('officials_list_header'),
  can_drag_row = (row) => !is_header_row(row) && !row.classList.contains('drop-zone'),
  col_count = 3,
  on_move = ({ row_id, from_table, to_table, from_order, to_order }) => {},
} = {}) {
  let dragged_tr = null;
  let from_tbody = null;

  function set_dragging(tr, isDragging) {
    if (!tr) return;
    tr.classList.toggle('dragging', !!isDragging);
  }

  function get_table_id(tbody) {
    return tbody?.getAttribute(table_id_attr) || '';
  }

  function get_order_ids(tbody) {
    if (!tbody) return [];
    return [...tbody.querySelectorAll(row_selector)]
      .filter(row => !is_header_row(row) && !row.classList.contains('drop-zone'))
      .map(row => row.getAttribute(row_id_attr))
      .filter(Boolean);
  }

  function insert_dragged_into_tbody(tbody, insertBeforeRow) {
    if (!dragged_tr) return;

    if (insertBeforeRow == null) {
      tbody.appendChild(dragged_tr);
    } else {
      tbody.insertBefore(dragged_tr, insertBeforeRow);
    }
  }

  // Drop-Zones beim Start aktivieren
  function activate_drop_zones() {
    for (const tbody of tbodies) {
      add_drop_zones_to_tbody(tbody, {
        row_selector,
        is_header_row,
        col_count,
        on_zone_dragover: (target_tbody, insertBeforeRow, e) => {
          if (!dragged_tr) return;
          insert_dragged_into_tbody(target_tbody, insertBeforeRow);
        }
      });
    }
  }

  function deactivate_drop_zones() {
    for (const tbody of tbodies) {
      remove_drop_zones_from_tbody(tbody);
    }
  }

  // Rows draggable machen
  for (const tbody of tbodies) {
    for (const tr of tbody.querySelectorAll(row_selector)) {
      if (!can_drag_row(tr)) continue;

      tr.draggable = true;

      tr.addEventListener('dragstart', (e) => {
        dragged_tr = tr;
        from_tbody = tr.closest('tbody');
        set_dragging(tr, true);

        // Drop-Zones global aktivieren
        activate_drop_zones();

        // Firefox benötigt Daten im dataTransfer
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tr.getAttribute(row_id_attr) || '');
        }
      });

      tr.addEventListener('dragend', () => {
        if (!dragged_tr) return;

        set_dragging(dragged_tr, false);

        // Drop-Zones entfernen
        deactivate_drop_zones();

        const row_id = dragged_tr.getAttribute(row_id_attr) || '';
        const to_tbody = dragged_tr.closest('tbody');

      const from_table = get_table_id(from_tbody);
      const to_table = get_table_id(to_tbody);

      const from_order = get_order_ids(from_tbody);
      const to_order = get_order_ids(to_tbody);

      if (
        skip_next_official_list_move &&
        skip_next_official_list_move.row_id === row_id &&
        skip_next_official_list_move.from_table === from_table
      ) {
        skip_next_official_list_move = null;
        dragged_tr = null;
        from_tbody = null;
        return;
      }

      dragged_tr = null;
      from_tbody = null;

        on_move({ row_id, from_table, to_table, from_order, to_order });
      });
    }
  }

for (const tbody of tbodies) {
  tbody.addEventListener('dragover', (e) => {
    if (!dragged_tr) return;
    e.preventDefault();

    // 1) Wenn wir über dem Spacer sind: vor Spacer einfügen (Preview korrekt)
    const header_tr = e.target.closest ? e.target.closest('.officials_row') : null;
    const isHeader = header_tr && is_header_row(header_tr);
    if (isHeader) {
      const first_data = tbody.querySelector(`${row_selector}[${row_id_attr}]:not(.drop-zone)`);
      if (first_data) {
        tbody.insertBefore(dragged_tr, first_data);
      } else {
        tbody.appendChild(dragged_tr);
      }
      return;
    }

    const data_tr = e.target.closest ? e.target.closest(`${row_selector}[${row_id_attr}]`) : null;
    if (data_tr && data_tr !== dragged_tr) {
      const box = data_tr.getBoundingClientRect();
      const before = e.clientY < (box.top + box.height / 2);
      if (before) tbody.insertBefore(dragged_tr, data_tr);
      else tbody.insertBefore(dragged_tr, data_tr.nextSibling);
      return;
    }

    // sonst nichts tun: Drop-Zones übernehmen die Präzision
  });

  tbody.addEventListener('drop', (e) => {
    if (!dragged_tr) return;
    e.preventDefault();
  });
}
}


/* ============================================================
 * DEINE TABELLE (pro Feld) - gibt TBODY zurück
 * ============================================================ */

function create_official_role_checkbox(host, official, field) {
  const wrap = uiu.el(host, 'div', 'officials_role_toggle');
  const cb = create_simple_checkbox(
    wrap,
    { name: `${field}_cb`, 'data-official-id': official._id || '' },
    !!official[field]
  );
  if (!official._id) {
    cb.disabled = true;
    return cb;
  }
  cb.addEventListener('change', (e) => {
    send_with_live_status({
      type: 'official_edit',
      tournament_key: official.tournament_key,
      official_id: official._id,
      field,
      value: e.target.checked
    }, err => { if (err) return cerror.net(err); });
  });
  return cb;
}

function render_officials_table(main, {
  title = null,
  rows,
  table_id,
  name_header = 'Name',
  first_cell_render = null,
  leading_header = null,
  leading_cell_render = null
}) {
  if (title) {
    uiu.el(main, 'h2', 'edit', title);
  }

  const list = uiu.el(main, 'div', 'officials_list');
  list.setAttribute('data-table-id', table_id);

  const header = uiu.el(list, 'div', 'officials_row officials_list_header');
  if (leading_header !== null) {
    uiu.el(header, 'div', 'officials_cell officials_cell_leading', leading_header);
  }
  uiu.el(header, 'div', 'officials_cell officials_cell_name', name_header);
  const umpireHead = uiu.el(header, 'div', 'officials_cell officials_cell_role');
  uiu.el(umpireHead, 'div', { class: 'umpire' });
  const serviceHead = uiu.el(header, 'div', 'officials_cell officials_cell_role');
  uiu.el(serviceHead, 'div', { class: 'service_judge' });

  rows.forEach((o) => {
    const row = uiu.el(list, 'div', 'officials_row', { 'data-official-id': o._id || '' });

    if (leading_cell_render) {
      const leading = uiu.el(row, 'div', 'officials_cell officials_cell_leading');
      leading_cell_render(leading, o);
    }

    const nameCell = uiu.el(row, 'div', 'officials_cell officials_cell_name');
    if (first_cell_render) {
      first_cell_render(nameCell, o);
    } else {
      uiu.text(nameCell, o.name || `${o.firstname} ${o.surname}`.trim());
    }

    create_official_role_checkbox(uiu.el(row, 'div', 'officials_cell officials_cell_role'), o, 'is_umpire');
    create_official_role_checkbox(uiu.el(row, 'div', 'officials_cell officials_cell_role'), o, 'is_service_judge');
  });

  return { table: list, tbody: list };
}

function render_officials_by_timestamp(main, {
  title = null,
  officials,
  timestamp_field,
  min_height_px = 240,
  name_header = 'Name',
  first_cell_render = null,
  leading_header = null,
  leading_cell_render = null
}) {
  const rows = officials
    .filter(o => o[timestamp_field] !== null)
    .sort((a, b) => a[timestamp_field] - b[timestamp_field]);

  return render_officials_table(main, {
    title,
    rows,
    table_id: timestamp_field,
    min_height_px,
    name_header,
    first_cell_render,
    leading_header,
    leading_cell_render
  });
}

function render_officials_by_filter(main, {
  title = null,
  officials,
  table_id,
  filter_fn,
  sort_fn = null,
  min_height_px = 240,
  name_header = 'Name',
  first_cell_render = null,
  leading_header = null,
  leading_cell_render = null
}) {
  const rows = officials.filter(filter_fn);
  if (sort_fn) {
    rows.sort(sort_fn);
  } else {
    rows.sort((a, b) => cbts_utils.natcmp(a.name || '', b.name || ''));
  }

  return render_officials_table(main, {
    title,
    rows,
    table_id,
    min_height_px,
    name_header,
    first_cell_render,
    leading_header,
    leading_cell_render
  });
}

function render_official_role_split_section(main, {
  title,
  left_table_id,
  right_table_id,
  left_filter_fn,
  right_filter_fn,
  first_cell_render = null,
  left_leading_header = null,
  left_leading_cell_render = null,
  sort_fn = null,
  min_height_px = 240
}) {
  uiu.el(main, 'h3', 'edit', title);
  const section_div = uiu.el(main, 'div', 'official_split_section');

  const left_div = uiu.el(section_div, 'div', 'official_role_split_column');
  const left = render_officials_by_filter(left_div, {
    officials: curt.umpires,
    table_id: left_table_id,
    filter_fn: left_filter_fn,
    sort_fn,
    min_height_px,
    name_header: ci18n('Umpire'),
    first_cell_render,
    leading_header: left_leading_header,
    leading_cell_render: left_leading_cell_render
  });

  uiu.el(section_div, 'div', 'official_role_split_space');

  const right_div = uiu.el(section_div, 'div', 'official_role_split_column');
  const right = render_officials_by_filter(right_div, {
    officials: curt.umpires,
    table_id: right_table_id,
    filter_fn: right_filter_fn,
    sort_fn,
    min_height_px,
    name_header: ci18n('Service judge'),
    first_cell_render
  });

  return { left, right };
}

function render_on_court_officials_table(main, {
  rows,
  table_id,
  min_height_px = 240,
  table_class = 'officials_table_on_court',
  leading_cell_render = null
}) {
  const table = uiu.el(main, 'div', `officials_dual_list ${table_class}`, { 'data-table-id': table_id });

  const head = uiu.el(table, 'div', 'officials_dual_row officials_dual_header');
  uiu.el(head, 'div', 'officials_dual_cell officials_cell_leading', '');
  uiu.el(head, 'div', 'officials_dual_cell officials_cell_name', ci18n('Umpire'));
  const headLeftUmpire = uiu.el(head, 'div', 'officials_dual_cell officials_cell_role');
  uiu.el(headLeftUmpire, 'div', { class: 'umpire' });
  const headLeftService = uiu.el(head, 'div', 'officials_dual_cell officials_cell_role');
  uiu.el(headLeftService, 'div', { class: 'service_judge' });
  uiu.el(head, 'div', 'officials_dual_cell officials_dual_center_space', '');
  uiu.el(head, 'div', 'officials_dual_cell officials_cell_name', ci18n('Service judge'));
  const headRightUmpire = uiu.el(head, 'div', 'officials_dual_cell officials_cell_role');
  uiu.el(headRightUmpire, 'div', { class: 'umpire' });
  const headRightService = uiu.el(head, 'div', 'officials_dual_cell officials_cell_role');
  uiu.el(headRightService, 'div', { class: 'service_judge' });

  for (const row of rows) {
    const tr = uiu.el(table, 'div', 'officials_dual_row');
    if (row.is_inactive_court) {
      tr.classList.add('officials_dual_row_inactive');
    }
    if (row.match_id) {
      tr.setAttribute('data-match-id', row.match_id);
    }
    const leftOfficial = row.left;
    const rightOfficial = row.right;

    const leadingTd = uiu.el(tr, 'div', 'officials_dual_cell officials_cell_leading');
    if (leading_cell_render) {
      leading_cell_render(leadingTd, row, leftOfficial, rightOfficial);
    } else {
      const courtClass = leftOfficial._is_empty_on_court_slot ? 'court officials_table_court_inactive' : 'court';
      uiu.el(leadingTd, 'div', courtClass, row.court_num || '');
    }

    const leftNameTd = uiu.el(tr, 'div', row.match_id ? {
      class: 'officials_dual_cell officials_cell_name official_assignment_slot',
      'data-match-id': row.match_id,
      'data-role': 'umpire',
      'data-slot-group': `${row.match_id}:umpire`,
      'data-official-id': leftOfficial._id || ''
    } : { class: 'officials_dual_cell officials_cell_name' });
    uiu.text(leftNameTd, leftOfficial.name || `${leftOfficial.firstname} ${leftOfficial.surname}`.trim());

    const leftUmpireTd = uiu.el(tr, 'div', 'officials_dual_cell officials_cell_role');
    if (!row.match_id && !leftOfficial._id) {
      // leerer On-Court-Slot: keine Checkbox anzeigen
    } else if (!row.match_id || leftOfficial._id) {
      create_official_role_checkbox(leftUmpireTd, leftOfficial, 'is_umpire');
    } else {
      leftUmpireTd.classList.add('official_assignment_slot');
      leftUmpireTd.setAttribute('data-match-id', row.match_id);
      leftUmpireTd.setAttribute('data-role', 'umpire');
      leftUmpireTd.setAttribute('data-slot-group', `${row.match_id}:umpire`);
      leftUmpireTd.setAttribute('data-official-id', '');
    }

    const leftServiceTd = uiu.el(tr, 'div', 'officials_dual_cell officials_cell_role');
    if (!row.match_id && !leftOfficial._id) {
      // leerer On-Court-Slot: keine Checkbox anzeigen
    } else if (!row.match_id || leftOfficial._id) {
      create_official_role_checkbox(leftServiceTd, leftOfficial, 'is_service_judge');
    } else {
      leftServiceTd.classList.add('official_assignment_slot');
      leftServiceTd.setAttribute('data-match-id', row.match_id);
      leftServiceTd.setAttribute('data-role', 'umpire');
      leftServiceTd.setAttribute('data-slot-group', `${row.match_id}:umpire`);
      leftServiceTd.setAttribute('data-official-id', '');
    }

    uiu.el(tr, 'div', 'officials_dual_cell officials_dual_center_space', '');

    const rightNameTd = uiu.el(tr, 'div', row.match_id ? {
      class: 'officials_dual_cell officials_cell_name official_assignment_slot',
      'data-match-id': row.match_id,
      'data-role': 'service_judge',
      'data-slot-group': `${row.match_id}:service_judge`,
      'data-official-id': rightOfficial._id || ''
    } : { class: 'officials_dual_cell officials_cell_name' });
    uiu.text(rightNameTd, rightOfficial.name || `${rightOfficial.firstname} ${rightOfficial.surname}`.trim());

    const rightUmpireTd = uiu.el(tr, 'div', 'officials_dual_cell officials_cell_role');
    if (!row.match_id && !rightOfficial._id) {
      // leerer On-Court-Slot: keine Checkbox anzeigen
    } else if (!row.match_id || rightOfficial._id) {
      create_official_role_checkbox(rightUmpireTd, rightOfficial, 'is_umpire');
    } else {
      rightUmpireTd.classList.add('official_assignment_slot');
      rightUmpireTd.setAttribute('data-match-id', row.match_id);
      rightUmpireTd.setAttribute('data-role', 'service_judge');
      rightUmpireTd.setAttribute('data-slot-group', `${row.match_id}:service_judge`);
      rightUmpireTd.setAttribute('data-official-id', '');
    }

    const rightServiceTd = uiu.el(tr, 'div', 'officials_dual_cell officials_cell_role');
    if (!row.match_id && !rightOfficial._id) {
      // leerer On-Court-Slot: keine Checkbox anzeigen
    } else if (!row.match_id || rightOfficial._id) {
      create_official_role_checkbox(rightServiceTd, rightOfficial, 'is_service_judge');
    } else {
      rightServiceTd.classList.add('official_assignment_slot');
      rightServiceTd.setAttribute('data-match-id', row.match_id);
      rightServiceTd.setAttribute('data-role', 'service_judge');
      rightServiceTd.setAttribute('data-slot-group', `${row.match_id}:service_judge`);
      rightServiceTd.setAttribute('data-official-id', '');
    }
  }

  return { table, tbody: table };
}

function enable_min_height_resize_recalc(tables) {
  return tables;
}

function enable_preparation_official_dragdrop(preparation_table, lower_tbodies, officialById) {
  if (!preparation_table) return;

  const set_drag_meta = (meta) => {
    window._dragged_official_meta = meta;
  };
  const clear_drag_meta = () => {
    window._dragged_official_meta = null;
  };
  const set_slot_group_hover = (slot, active) => {
    const group = slot.getAttribute('data-slot-group');
    if (!group) return;
    preparation_table.querySelectorAll(`.official_assignment_slot[data-slot-group=${JSON.stringify(group)}]`).forEach((groupSlot) => {
      groupSlot.classList.toggle('drop-zone-hover', !!active);
    });
  };
  const set_slot_group_dragging = (slot, active) => {
    const group = slot.getAttribute('data-slot-group');
    if (!group) return;
    preparation_table.querySelectorAll(`.official_assignment_slot[data-slot-group=${JSON.stringify(group)}]`).forEach((groupSlot) => {
      groupSlot.classList.toggle('dragging', !!active);
    });
  };
  const set_lower_dropzones_active = (active) => {
    for (const tbody of lower_tbodies) {
      if (active) {
        add_drop_zones_to_tbody(tbody, {
          col_count: 3,
          on_zone_dragover: () => {}
        });
      } else {
        remove_drop_zones_from_tbody(tbody);
      }
    }
  };
  const remove_official_drag_image = () => {
    if (official_drag_image_el && official_drag_image_el.parentNode) {
      official_drag_image_el.parentNode.removeChild(official_drag_image_el);
    }
    official_drag_image_el = null;
  };
  const create_official_drag_image = (slot) => {
    remove_official_drag_image();
    const group = slot.getAttribute('data-slot-group');
    if (!group) return null;
    const groupSlots = [...preparation_table.querySelectorAll(`.official_assignment_slot[data-slot-group=${JSON.stringify(group)}]`)];
    if (!groupSlots.length) return null;

    const table = document.createElement('table');
    table.className = 'official_drag_image_table';
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    table.appendChild(tbody);
    tbody.appendChild(tr);

    groupSlots.forEach((groupSlot) => {
      const clone = groupSlot.cloneNode(true);
      clone.classList.remove('drop-zone-hover');
      clone.classList.add('official_drag_image_cell');
      clone.style.width = `${Math.ceil(groupSlot.getBoundingClientRect().width)}px`;
      clone.style.height = `${Math.ceil(groupSlot.getBoundingClientRect().height)}px`;
      tr.appendChild(clone);
    });

    table.style.position = 'fixed';
    table.style.left = '-10000px';
    table.style.top = '-10000px';
    table.style.pointerEvents = 'none';
    table.style.zIndex = '9999';
    document.body.appendChild(table);
    official_drag_image_el = table;
    return table;
  };

  for (const tbody of lower_tbodies) {
    for (const tr of tbody.querySelectorAll('.officials_row[data-official-id]')) {
      tr.addEventListener('dragstart', () => {
        const official_id = tr.getAttribute('data-official-id');
        if (!official_id) return;
        set_drag_meta({
          source_type: 'list',
          official_id,
          from_table: tbody.getAttribute('data-table-id') || '',
          official: officialById.get(official_id) || null
        });
        preparation_table.classList.add('drop-zones-active');
      });
      tr.addEventListener('dragend', () => {
        clear_drag_meta();
        preparation_table.classList.remove('drop-zones-active');
        preparation_table.querySelectorAll('.official_assignment_slot.drop-zone-hover').forEach((slot) => {
          slot.classList.remove('drop-zone-hover');
        });
      });
    }

    tbody.addEventListener('dragover', (e) => {
      const meta = window._dragged_official_meta;
      if (!meta || meta.source_type !== 'match') return;
      e.preventDefault();
    });
    tbody.addEventListener('drop', (e) => {
      const meta = window._dragged_official_meta;
      if (!meta || meta.source_type !== 'match') return;
      e.preventDefault();
      clear_drag_meta();
      send_with_live_status({
        type: 'remove_official_from_preparation_match',
        tournament_key: curt.key,
        official_id: meta.official_id,
        match_id: meta.match_id,
        role: meta.role,
        to_list: tbody.getAttribute('data-table-id') || ''
      }, (err) => {
        if (err) return cerror.net(err);
      });
    });
  }

  for (const slot of preparation_table.querySelectorAll('.official_assignment_slot')) {
    const official_id = slot.getAttribute('data-official-id');
    const match_id = slot.getAttribute('data-match-id');
    const role = slot.getAttribute('data-role');

    if (official_id) {
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => {
        set_drag_meta({
          source_type: 'match',
          official_id,
          match_id,
          role
        });
        set_slot_group_dragging(slot, true);
        preparation_table.classList.add('drop-zones-active');
        set_lower_dropzones_active(true);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', official_id);
          const dragImage = create_official_drag_image(slot);
          if (dragImage) {
            e.dataTransfer.setDragImage(dragImage, 10, 10);
          }
        }
      });
      slot.addEventListener('dragend', () => {
        clear_drag_meta();
        set_slot_group_dragging(slot, false);
        preparation_table.classList.remove('drop-zones-active');
        set_lower_dropzones_active(false);
        remove_official_drag_image();
      });
    } else {
      slot.classList.add('drop-zone');
    }

    slot.addEventListener('dragover', (e) => {
      const meta = window._dragged_official_meta;
      if (!meta || meta.source_type !== 'list' || slot.getAttribute('data-official-id')) return;
      if (!meta.official) return;
      if (role === 'umpire' && !meta.official.is_umpire) return;
      if (role === 'service_judge' && !meta.official.is_service_judge) return;
      e.preventDefault();
      set_slot_group_hover(slot, true);
    });

    slot.addEventListener('dragenter', (e) => {
      const meta = window._dragged_official_meta;
      if (!meta || meta.source_type !== 'list' || slot.getAttribute('data-official-id')) return;
      if (!meta.official) return;
      if (role === 'umpire' && !meta.official.is_umpire) return;
      if (role === 'service_judge' && !meta.official.is_service_judge) return;
      e.preventDefault();
      set_slot_group_hover(slot, true);
    });

    slot.addEventListener('dragleave', () => {
      set_slot_group_hover(slot, false);
    });

    slot.addEventListener('drop', (e) => {
      const meta = window._dragged_official_meta;
      if (!meta || meta.source_type !== 'list' || slot.getAttribute('data-official-id')) return;
      if (!meta.official) return;
      if (role === 'umpire' && !meta.official.is_umpire) return;
      if (role === 'service_judge' && !meta.official.is_service_judge) return;
      e.preventDefault();
      set_slot_group_hover(slot, false);
      clear_drag_meta();
      set_slot_group_dragging(slot, false);
      preparation_table.classList.remove('drop-zones-active');
      set_lower_dropzones_active(false);
      remove_official_drag_image();
      skip_next_official_list_move = {
        row_id: meta.official_id,
        from_table: meta.from_table || ''
      };
      send_with_live_status({
        type: 'assign_official_to_preparation_match',
        tournament_key: curt.key,
        official_id: meta.official_id,
        match_id,
        role
      }, (err) => {
        if (err) return cerror.net(err);
      });
    });
  }
}

function update_official_tables(officials_host) {
  officials_host.innerHTML = '';

  const official_rotation_mode = curt.official_rotation_mode || 'umpire_and_service_judge';
  const include_service_judges = official_rotation_mode === 'umpire_and_service_judge';
  const officials_div = uiu.el(officials_host, 'div', 'settings');
  if (!include_service_judges) {
    officials_div.classList.add('official_rotation_mode_umpire_only');
  }
  uiu.el(officials_div, 'h2', 'edit', ci18n('Technical officials rotation:'));
  const official_rotation_mode_label = uiu.el(officials_div, 'label', 'official_rotation_mode_control');
  uiu.el(official_rotation_mode_label, 'span', {}, ci18n('tournament:edit:official_rotation_mode'));
  const official_rotation_mode_select = uiu.el(official_rotation_mode_label, 'select', {
    name: 'official_rotation_mode',
  });
  [
    'disabled',
    'umpire_only',
    'umpire_and_service_judge',
  ].forEach((mode) => {
    const attrs = { value: mode };
    if (official_rotation_mode === mode) {
      attrs.selected = 'selected';
    }
    uiu.el(official_rotation_mode_select, 'option', attrs, ci18n(`tournament:edit:official_rotation_mode:${mode}`));
  });
  bind_live_prop(official_rotation_mode_select, 'official_rotation_mode');

  if (official_rotation_mode === 'disabled') {
    return;
  }

  const technical_official_auto_assignment_mode = curt.technical_official_auto_assignment_mode || 'manual_only';
  const technical_official_auto_assignment_mode_label = uiu.el(officials_div, 'label', 'official_rotation_mode_control');
  uiu.el(technical_official_auto_assignment_mode_label, 'span', {}, ci18n('tournament:edit:technical_official_auto_assignment_mode'));
  const technical_official_auto_assignment_mode_select = uiu.el(technical_official_auto_assignment_mode_label, 'select', {
    name: 'technical_official_auto_assignment_mode',
  });
  [
    'manual_only',
    'on_match_call_if_possible',
    'on_preparation_call',
    'when_available',
  ].forEach((mode) => {
    const attrs = { value: mode };
    if (technical_official_auto_assignment_mode === mode) {
      attrs.selected = 'selected';
    }
    uiu.el(
      technical_official_auto_assignment_mode_select,
      'option',
      attrs,
      ci18n(`tournament:edit:technical_official_auto_assignment_mode:${mode}`)
    );
  });
  bind_live_prop(technical_official_auto_assignment_mode_select, 'technical_official_auto_assignment_mode');

  const technical_official_break_after_assignment_seconds_label = uiu.el(officials_div, 'label', 'official_rotation_mode_control');
  uiu.el(technical_official_break_after_assignment_seconds_label, 'span', {}, ci18n('tournament:edit:technical_official_break_after_assignment_seconds'));
  const technical_official_break_after_assignment_seconds_input = uiu.el(technical_official_break_after_assignment_seconds_label, 'input', {
    type: 'number',
    name: 'technical_official_break_after_assignment_seconds',
    value: curt.technical_official_break_after_assignment_seconds || 0,
    min: 0,
    max: 3600,
    step: 1,
  });
  bind_live_prop(technical_official_break_after_assignment_seconds_input, 'technical_official_break_after_assignment_seconds', {
    get_value: input_el => Number(input_el.value),
  });

  const all_officials = (curt.umpires || []).filter((official) => {
    if (!(official && official._id)) {
      return false;
    }
    return include_service_judges || !!official.is_umpire;
  });
  const officialById = new Map(all_officials.map((official) => [official._id, official]));
  let dragged_meta = null;
  const sorted_courts = [...(curt.courts || [])].sort((a, b) => cbts_utils.natcmp(String(a.num || ''), String(b.num || '')));
  const preparation_matches = [...(curt.matches || [])]
    .filter((match) => (match.setup || {}).state === 'preparation')
    .sort((a, b) => (a.setup?.preparation_call_timestamp || 0) - (b.setup?.preparation_call_timestamp || 0));
  const assigned_matches = [...(curt.matches || [])]
    .filter((match) => {
      const setup = match.setup || {};
      return setup.state !== 'preparation'
        && !['oncourt', 'blocked', 'finished'].includes(setup.state)
        && ((setup.umpire && setup.umpire._id) || (include_service_judges && setup.service_judge && setup.service_judge._id));
    })
    .sort((a, b) => cbts_utils.natcmp(String(a.setup?.match_num || ''), String(b.setup?.match_num || '')));
  const visible_official_ids = new Set();
  const mark_visible = (official) => {
    if (official && official._id) {
      visible_official_ids.add(official._id);
    }
  };

  const official_display_name = (official) => official.name || `${official.firstname || ''} ${official.surname || ''}`.trim();
  const get_official_pause_sort_ts = (official, role) => {
    const auto_pause = official?.[`${role}_pause`];
    if (auto_pause != null) {
      return Number(auto_pause) || 0;
    }
    const manual_pause = official?.[`${role}_manual_pause`];
    return Number(manual_pause) || 0;
  };
  const create_official_pause_timer_state = (official, role) => {
    const pause_target_ts = Number(official?.[`${role}_pause`]);
    if (!Number.isFinite(pause_target_ts)) {
      return null;
    }
    const now_ms = get_effective_test_clock_now_ms();
    const remaining_ms = Math.max(0, pause_target_ts - now_ms);
    return {
      settings: {
        negative_timers: false,
      },
      lang: 'de',
      timer: {
        duration: remaining_ms,
        start: now_ms,
        upwards: false,
        exigent: false,
      },
      bgColor: '#ff0000',
    };
  };
  const official_card_variant_class = (variant, official = null) => {
    switch (variant) {
      case 'on_court':
        return 'official_card_variant_on_court';
      case 'assignment':
        return official && official.checked_in
          ? 'official_card_variant_checked_in'
          : 'official_card_variant_not_checked_in';
      case 'list':
      default:
        return 'official_card_variant_list';
    }
  };
  const role_state_from_official = (official) => {
    if (!!official.is_umpire && !!official.is_service_judge) return 'all';
    if (!!official.is_umpire) return 'umpire_only';
    if (!!official.is_service_judge) return 'service_only';
    return 'all';
  };
  const cycle_role_state = (official, current_state) => {
    if (current_state === 'all') {
      return official.is_umpire ? 'umpire_only' : 'service_only';
    }
    if (current_state === 'umpire_only') return 'service_only';
    return 'all';
  };
  const clear_same_stack_active_drop = () => {
    officials_div.querySelectorAll('.official_card_drop_hover_expand').forEach((el) => {
      el.classList.remove('official_card_drop_hover_expand', 'official_card_drop_hover');
    });
    officials_div.querySelectorAll('.official_card_stack_has_nonterminal_hover').forEach((el) => {
      el.classList.remove('official_card_stack_has_nonterminal_hover');
    });
    if (dragged_meta) {
      dragged_meta.active_drop = null;
    }
  };
  const activate_drop_target = (drop) => {
    if (!dragged_meta || !drop) return;
    if (dragged_meta.active_drop === drop) return;
    if (dragged_meta.active_drop) {
      const previous_stack = dragged_meta.active_drop.parentElement;
      if (previous_stack?.classList.contains('official_card_stack')) {
        previous_stack.classList.remove('official_card_stack_has_nonterminal_hover');
      }
      dragged_meta.active_drop.classList.remove('official_card_drop_hover', 'official_card_drop_hover_expand');
    }
    dragged_meta.active_drop = drop;
    drop.classList.add('official_card_drop_hover');
    if (drop.parentElement?.classList.contains('official_card_stack')) {
      if (!drop.classList.contains('official_card_drop_terminal')) {
        drop.parentElement.classList.add('official_card_stack_has_nonterminal_hover');
      }
      drop.classList.add('official_card_drop_hover_expand');
    }
  };
  const set_source_placeholder_state = (state) => {
    if (!dragged_meta?.source_card) return;
    const card = dragged_meta.source_card;
    const in_stack = !!dragged_meta.source_stack;
    card.classList.remove(
      'official_card_placeholder_compact',
      'official_card_placeholder_activelike',
      'official_card_placeholder_hoverlike'
    );
    if (state === 'hover') {
      card.classList.add('official_card_placeholder_hoverlike');
      return;
    }
    if (state === 'active') {
      card.classList.add('official_card_placeholder_activelike');
      if (in_stack) {
        card.classList.add('official_card_placeholder_compact');
      }
    }
  };
  const set_drop_highlight = (drop, active) => {
    if (drop.classList.contains('official_card_drop_suppressed')) {
      drop.classList.remove('official_card_drop_hover', 'official_card_drop_hover_expand');
      return;
    }
    const same_stack = !!dragged_meta?.source_stack && drop.parentElement === dragged_meta.source_stack;
    if (!same_stack) {
      if (active) {
        activate_drop_target(drop);
        set_source_placeholder_state('active');
      } else if (dragged_meta?.active_drop !== drop) {
        drop.classList.remove('official_card_drop_hover', 'official_card_drop_hover_expand');
      }
      document.querySelectorAll('.official_card_drop_suppressed').forEach((el) => {
        el.classList.remove('official_card_drop_suppressed');
      });
      if (!dragged_meta?.active_drop) {
        set_source_placeholder_state('hover');
      }
      update_source_placeholder_suppression();
      return;
    }
    if (active) {
      activate_drop_target(drop);
      update_source_placeholder_suppression();
      set_source_placeholder_state('active');
    } else {
      if (!dragged_meta?.active_drop) {
        set_source_placeholder_state('hover');
        document.querySelectorAll('.official_card_drop_suppressed').forEach((el) => {
          el.classList.remove('official_card_drop_suppressed');
        });
        update_source_placeholder_suppression();
      }
    }
  };
  const register_drop_target = (drop, can_drop) => {
    drop._officialCanDrop = can_drop;
  };
  const update_source_placeholder_suppression = () => {
    document.querySelectorAll('.official_card_drop_suppressed').forEach((drop) => {
      drop.classList.remove('official_card_drop_suppressed');
    });
    if (!dragged_meta?.source_card) {
      return;
    }
    const card = dragged_meta.source_card;
    if (card.previousElementSibling && card.previousElementSibling.classList.contains('official_card_drop')) {
      card.previousElementSibling.classList.add('official_card_drop_suppressed');
    }
    if (card.nextElementSibling && card.nextElementSibling.classList.contains('official_card_drop')) {
      card.nextElementSibling.classList.add('official_card_drop_suppressed');
    }
  };
  const move_placeholder_relative_to_card = (target_card, place_after) => {
    if (!dragged_meta?.source_stack) {
      return;
    }
    if (target_card.parentElement !== dragged_meta.source_stack) {
      return;
    }
    const target_drop = place_after
      ? target_card.nextElementSibling
      : target_card.previousElementSibling;
    if (target_drop && target_drop.classList.contains('official_card_drop')) {
      set_drop_highlight(target_drop, true);
    }
  };
  const set_all_drop_targets_active = (active) => {
    officials_div.classList.toggle('officials_drag_active', !!active && !!dragged_meta);
    officials_div.querySelectorAll('.official_card_drop').forEach((drop) => {
      if (drop.classList.contains('official_card_drop_suppressed')) {
        drop.classList.remove('official_card_drop_active');
        return;
      }
      const can_drop = typeof drop._officialCanDrop === 'function' ? drop._officialCanDrop(dragged_meta) : false;
      drop.classList.toggle('official_card_drop_active', !!active && !!dragged_meta && can_drop);
    });
  };
  const clear_all_drop_states = () => {
    officials_div.classList.remove('officials_drag_active');
    document.querySelectorAll('.official_card_drop_active').forEach((drop) => {
      drop.classList.remove('official_card_drop_active');
    });
    document.querySelectorAll('.official_card_drop_hover').forEach((drop) => {
      drop.classList.remove('official_card_drop_hover');
    });
    document.querySelectorAll('.official_card_drop_hover_expand').forEach((drop) => {
      drop.classList.remove('official_card_drop_hover_expand');
    });
    document.querySelectorAll('.official_card_placeholder').forEach((card) => {
      card.classList.remove('official_card_placeholder');
    });
    document.querySelectorAll('.official_card_placeholder_compact').forEach((card) => {
      card.classList.remove('official_card_placeholder_compact');
    });
    document.querySelectorAll('.official_card_placeholder_hoverlike').forEach((card) => {
      card.classList.remove('official_card_placeholder_hoverlike');
    });
    document.querySelectorAll('.official_card_drop_suppressed').forEach((drop) => {
      drop.classList.remove('official_card_drop_suppressed');
    });
    document.querySelectorAll('.official_card_stack_has_nonterminal_hover').forEach((stack) => {
      stack.classList.remove('official_card_stack_has_nonterminal_hover');
    });
    document.querySelectorAll('.official_section_body_stacklist').forEach((section) => {
      section.style.height = '';
    });
  };
  const freeze_stack_section_heights = () => {
    officials_div.querySelectorAll('.official_section_body_stacklist').forEach((section) => {
      section.style.height = `${Math.ceil(section.getBoundingClientRect().height)}px`;
    });
  };
  const apply_stack_section_base_heights = () => {
    officials_div.querySelectorAll('.official_section_body_stacklist').forEach((section) => {
      section.style.height = '';
      section.style.minHeight = '';
      const content_height = section.scrollHeight;
      const bottom_buffer_px = 6;
      section.style.minHeight = `${Math.ceil(content_height + bottom_buffer_px)}px`;
    });
  };
  const clear_drop_states_global = () => {
    dragged_meta = null;
    official_drag_active = false;
    clear_all_drop_states();
    if (official_drag_refresh_pending) {
      official_drag_refresh_pending = false;
      setTimeout(() => {
        if (current_view === 'edit') {
          ctournament.update_officials();
        }
      }, 0);
    }
  };
  const document_drop_cleanup = () => setTimeout(() => clear_drop_states_global(), 0);
  const window_dragend_cleanup = () => clear_drop_states_global();
  document.addEventListener('drop', document_drop_cleanup, true);
  window.addEventListener('dragend', window_dragend_cleanup, true);
  update_official_tables._document_drop_cleanup = document_drop_cleanup;
  update_official_tables._window_dragend_cleanup = window_dragend_cleanup;
  const get_stack_card_ids = (stack) => [...stack.querySelectorAll('.official_card_frame[data-official-id]')].map((card) => card.getAttribute('data-official-id')).filter(Boolean);
  const move_meta_to_list = (stack, meta, to_list, error_handler = cerror.net) => {
    const ids = get_stack_card_ids(stack);
    const virtual_ids = ids.filter((id) => id !== meta.official_id);
    virtual_ids.push(meta.official_id);
    const idx = virtual_ids.indexOf(meta.official_id);
    const prev_id = idx > 0 ? virtual_ids[idx - 1] : null;
    const next_id = idx >= 0 && idx < virtual_ids.length - 1 ? virtual_ids[idx + 1] : null;
    send_with_live_status({
      type: 'official_list_move',
      tournament_key: curt.key,
      official_id: meta.official_id,
      from_list: meta.from_list,
      to_list,
      prev_btp_id: prev_id ? officialById.get(prev_id)?.btp_id : null,
      next_btp_id: next_id ? officialById.get(next_id)?.btp_id : null
    }, (err) => {
      if (err) return error_handler(err);
    });
  };
  const remove_meta_from_match_to_list = (stack, meta, to_list, before_official_id = null, error_handler = cerror.net) => {
    const type = meta.source_type === 'assigned'
      ? 'remove_official_from_match'
      : 'remove_official_from_preparation_match';
    const ids = get_stack_card_ids(stack);
    const virtual_ids = ids.filter((id) => id !== meta.official_id);
    const insert_at = before_official_id ? virtual_ids.indexOf(before_official_id) : virtual_ids.length;
    if (insert_at < 0) {
      virtual_ids.push(meta.official_id);
    } else {
      virtual_ids.splice(insert_at, 0, meta.official_id);
    }
    send_with_live_status({
      type,
      tournament_key: curt.key,
      official_id: meta.official_id,
      match_id: meta.match_id,
      role: meta.role,
      to_list,
      ordered_official_ids: virtual_ids
    }, (err) => {
      if (err) return error_handler(err);
    });
  };
  const render_official_card = (parent, official, icon_class, drag_meta_factory = null, stack_drop_options = null, variant = 'list', timer_state = null) => {
    const card = uiu.el(parent, 'div', `official_card_frame official_card_skin ${official_card_variant_class(variant, official)}`);
    card.setAttribute('data-official-id', official._id);
    card.draggable = !!drag_meta_factory;
    uiu.el(card, 'div', `official_card_icon ${icon_class}`);
    uiu.el(card, 'div', 'official_card_name', official_display_name(official));
    if (timer_state) {
      const timer_host = uiu.el(card, 'div', 'official_card_timer');
      cmatch.create_timer(timer_state, timer_host, '#ffffff', '#ffffff');
    }
    const icon_trail = uiu.el(card, 'div', 'official_card_trail');
    icon_trail.setAttribute('data-state', role_state_from_official(official));
    icon_trail.draggable = false;
    uiu.el(icon_trail, 'div', 'official_card_trail_icon umpire');
    uiu.el(icon_trail, 'div', 'official_card_trail_swap', '⇄');
    uiu.el(icon_trail, 'div', 'official_card_trail_icon service_judge');
    icon_trail.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    icon_trail.addEventListener('dragstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    icon_trail.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = icon_trail.getAttribute('data-state') || 'all';
      const next = cycle_role_state(official, current);
      const previous_values = {
        is_umpire: !!official.is_umpire,
        is_service_judge: !!official.is_service_judge
      };
      icon_trail.setAttribute('data-state', next);
      const next_values = next === 'all'
        ? { is_umpire: true, is_service_judge: true }
        : next === 'umpire_only'
          ? { is_umpire: true, is_service_judge: false }
          : { is_umpire: false, is_service_judge: true };
      official.is_umpire = next_values.is_umpire;
      official.is_service_judge = next_values.is_service_judge;
      set_pending_official_role_override(official._id, next_values);
      ctournament.update_officials();
      send_with_live_status({
        type: 'official_roles_edit',
        tournament_key: curt.key,
        official_id: official._id,
        is_umpire: next_values.is_umpire,
        is_service_judge: next_values.is_service_judge
      }, (err) => {
        if (err) {
          official.is_umpire = previous_values.is_umpire;
          official.is_service_judge = previous_values.is_service_judge;
          set_pending_official_role_override(official._id, previous_values);
          ctournament.update_officials();
          return cerror.net(err);
        }
      });
    });
    if (drag_meta_factory) {
      card.addEventListener('dragstart', (e) => {
        if (icon_trail.contains(e.target)) {
          e.preventDefault();
          return;
        }
        dragged_meta = drag_meta_factory(official);
        official_drag_active = true;
        dragged_meta.source_card = card;
        dragged_meta.source_stack = parent.classList.contains('official_card_stack') ? parent : null;
        dragged_meta.active_drop = null;
        let drag_image = null;
        if (e.dataTransfer) {
          drag_image = card.cloneNode(true);
          drag_image.classList.remove('official_card_dragging', 'official_card_placeholder');
          drag_image.style.position = 'fixed';
          drag_image.style.top = '-1000px';
          drag_image.style.left = '-1000px';
          drag_image.style.pointerEvents = 'none';
          drag_image.style.width = `${card.offsetWidth}px`;
          drag_image.style.height = `${card.offsetHeight}px`;
          document.body.appendChild(drag_image);
        }
        card.classList.add('official_card_dragging', 'official_card_placeholder');
        set_source_placeholder_state('hover');
        set_all_drop_targets_active(true);
        update_source_placeholder_suppression();
        freeze_stack_section_heights();
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', official._id);
          e.dataTransfer.setDragImage(drag_image, 20, 19);
          setTimeout(() => drag_image.remove(), 0);
        }
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('official_card_dragging');
        dragged_meta = null;
        clear_all_drop_states();
      });
    }
    if (parent.classList.contains('official_card_stack')) {
      card.addEventListener('dragover', (e) => {
        if (!dragged_meta) {
          return;
        }
        const same_stack_drag = !!dragged_meta.source_stack && dragged_meta.source_stack === parent;
        const can_drop_here = stack_drop_options && stack_drop_options.can_drop(dragged_meta);
        if (!same_stack_drag && !can_drop_here) {
          return;
        }
        if (dragged_meta.source_card === card) {
          e.preventDefault();
          clear_same_stack_active_drop();
          set_source_placeholder_state('hover');
          update_source_placeholder_suppression();
          return;
        }
        e.preventDefault();
        const rect = card.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const deadzone = Math.min(8, rect.height * 0.2);
        if (Math.abs(e.clientY - midpoint) <= deadzone && dragged_meta.active_drop) {
          return;
        }
        const place_after = e.clientY > midpoint;
        move_placeholder_relative_to_card(card, place_after);
      });
      card.addEventListener('drop', (e) => {
        if (!dragged_meta || !stack_drop_options || !stack_drop_options.can_drop(dragged_meta)) {
          return;
        }
        if (dragged_meta.source_card === card) {
          e.preventDefault();
          clear_all_drop_states();
          return;
        }
        e.preventDefault();
        const rect = card.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const place_after = e.clientY > midpoint;
        let before_official_id = official._id;
        if (place_after) {
          const cards_in_stack = [...parent.querySelectorAll('.official_card_frame[data-official-id]')];
          const current_index = cards_in_stack.indexOf(card);
          const next_card = current_index >= 0 ? cards_in_stack[current_index + 1] : null;
          before_official_id = next_card ? next_card.getAttribute('data-official-id') : null;
        }
        clear_all_drop_states();
        stack_drop_options.on_drop(dragged_meta, before_official_id);
      });
    }
    return card;
  };
  const render_card_stack_with_drops = (parent, icon_class, officials, options) => {
    const append_drop = (before_official_id = null) => {
      const drop = uiu.el(parent, 'div', 'official_card_frame official_card_drop');
      if (before_official_id == null) {
        drop.classList.add('official_card_drop_terminal');
      }
      register_drop_target(drop, options.can_drop);
      drop.addEventListener('dragover', (e) => {
        if (!dragged_meta || !options.can_drop(dragged_meta)) return;
        e.preventDefault();
        set_drop_highlight(drop, true);
      });
      drop.addEventListener('dragleave', () => {
        set_drop_highlight(drop, false);
      });
      drop.addEventListener('drop', (e) => {
        if (!dragged_meta || !options.can_drop(dragged_meta)) return;
        e.preventDefault();
        set_drop_highlight(drop, false);
        clear_all_drop_states();
        options.on_drop(dragged_meta, before_official_id);
      });
      return drop;
    };
    const filtered_officials = officials.filter(Boolean);
    append_drop(filtered_officials[0]?._id || null);
    filtered_officials.forEach((official, index) => {
      render_official_card(
        parent,
        official,
        icon_class,
        options.drag_meta_factory,
        options,
        options.variant || 'list',
        options.timer_state_factory ? options.timer_state_factory(official) : null
      );
      append_drop(filtered_officials[index + 1]?._id || null);
    });
  };
  const create_official_section = (title) => {
    uiu.el(officials_div, 'h3', 'edit', title);
    return uiu.el(officials_div, 'div', 'official_section_body');
  };
  const send_list_reorder = (meta, to_list, virtual_ids, error_handler = cerror.net) => {
    const idx = virtual_ids.indexOf(meta.official_id);
    const prev_id = idx > 0 ? virtual_ids[idx - 1] : null;
    const next_id = idx >= 0 && idx < virtual_ids.length - 1 ? virtual_ids[idx + 1] : null;
    send_with_live_status({
      type: 'official_list_move',
      tournament_key: curt.key,
      official_id: meta.official_id,
      from_list: meta.from_list,
      to_list,
      ordered_official_ids: virtual_ids,
      prev_official_id: prev_id,
      next_official_id: next_id,
      prev_btp_id: prev_id ? (officialById.get(prev_id)?.btp_id ?? null) : null,
      next_btp_id: next_id ? (officialById.get(next_id)?.btp_id ?? null) : null
    }, (err) => {
      if (err) return error_handler(err);
    });
  };
  const build_reordered_ids = (stack, official_id, before_official_id = null) => {
    const ids = get_stack_card_ids(stack);
    const virtual_ids = ids.filter((id) => id !== official_id);
    const insert_at = before_official_id ? virtual_ids.indexOf(before_official_id) : virtual_ids.length;
    if (insert_at < 0) {
      virtual_ids.push(official_id);
    } else {
      virtual_ids.splice(insert_at, 0, official_id);
    }
    return virtual_ids;
  };
  const meta_can_fill_role = (meta, role) => {
    if (!meta) return false;
    const official = meta.official || officialById.get(meta.official_id);
    if (role === 'umpire') return !!official?.is_umpire;
    if (role === 'service_judge') return !!official?.is_service_judge;
    return false;
  };
  const role_from_list_name = (list_name) => {
    if (list_name === 'umpire_wait' || list_name === 'umpire_pause') return 'umpire';
    if (list_name === 'service_judge_wait' || list_name === 'service_judge_pause') return 'service_judge';
    return null;
  };
  const meta_can_drop_to_list = (meta, to_list) => {
    if (!meta) return false;
    if (to_list === 'inactive_list') {
      return meta.source_type === 'list' || meta.source_type === 'preparation' || meta.source_type === 'assigned';
    }
    const role = role_from_list_name(to_list);
    return !!role && meta_can_fill_role(meta, role);
  };
  const render_match_assignment_row = (section, match, source_type, assign_type) => {
    const setup = match.setup || {};
    mark_visible(setup.umpire);
    if (include_service_judges) {
      mark_visible(setup.service_judge);
    }
    const row = uiu.el(section, 'div', `official_on_court_row${include_service_judges ? '' : ' official_on_court_row_single_role'}`);
    const leading = uiu.el(row, 'div', 'official_on_court_leading official_preparation_leading');
    uiu.text(leading, `#${setup.match_num || ''}`);
    const render_assignment_slot = (role, icon_class) => {
      const slot = uiu.el(row, 'div', 'official_card_frame official_card_drop');
      const slot_enabled = () => role !== 'service_judge' || !!(setup.umpire && setup.umpire._id);
      register_drop_target(slot, (meta) => {
        if (!slot_enabled()) return false;
        if (!meta || !['list', 'preparation', 'assigned'].includes(meta.source_type)) return false;
        if (!meta_can_fill_role(meta, role)) return false;
        if (slot.querySelector('[data-official-id]')) return false;
        return true;
      });
      if (!slot_enabled() && !setup[role]) {
        slot.classList.add('official_card_drop_disabled');
      }
      slot.addEventListener('dragover', (e) => {
        if (!dragged_meta || !['list', 'preparation', 'assigned'].includes(dragged_meta.source_type)) return;
        if (!slot_enabled()) return;
        if (!meta_can_fill_role(dragged_meta, role)) return;
        if (slot.querySelector('[data-official-id]')) return;
        e.preventDefault();
        set_drop_highlight(slot, true);
      });
      slot.addEventListener('dragleave', () => set_drop_highlight(slot, false));
      slot.addEventListener('drop', (e) => {
        if (!dragged_meta || !['list', 'preparation', 'assigned'].includes(dragged_meta.source_type)) return;
        if (!slot_enabled()) return;
        if (!meta_can_fill_role(dragged_meta, role)) return;
        if (slot.querySelector('[data-official-id]')) return;
        e.preventDefault();
        set_drop_highlight(slot, false);
        clear_all_drop_states();
        const payload = {
          type: assign_type,
          tournament_key: curt.key,
          official_id: dragged_meta.official_id,
          match_id: match._id,
          role
        };
        if (dragged_meta.source_type === 'preparation' || dragged_meta.source_type === 'assigned') {
          payload.source_match_id = dragged_meta.match_id;
          payload.source_type = dragged_meta.source_type;
          payload.source_role = dragged_meta.role;
        }
        send_with_live_status(payload, (err) => {
          if (err) return cerror.net(err);
        });
      });
      const official = setup[role];
      if (official) {
        const live_official = officialById.get(official._id) || official;
        const assignment_official = {
          ...live_official,
          checked_in: official.checked_in
        };
        render_official_card(
          slot,
          assignment_official,
          icon_class,
          (assigned_official) => ({
            source_type,
            official_id: assigned_official._id,
            official: assignment_official,
            match_id: match._id,
            role
          }),
          null,
          'assignment'
        );
      }
    };
    render_assignment_slot('umpire', 'umpire');
    if (include_service_judges) {
      render_assignment_slot('service_judge', 'service_judge');
    }
  };
  const render_vertical_list_section = (title, specs, row_class = '') => {
    const section = create_official_section(title);
    section.classList.add('official_section_body_stacklist');
    const row = uiu.el(section, 'div', `official_on_court_row${include_service_judges ? '' : ' official_on_court_row_single_role'}${row_class ? ' ' + row_class : ''}`);
    uiu.el(row, 'div', 'official_on_court_leading official_preparation_leading');
    specs.forEach((spec) => {
      const stack = uiu.el(row, 'div', 'official_card_stack');
      spec.items.forEach(mark_visible);
      render_card_stack_with_drops(stack, spec.icon_class, spec.items, {
        can_drop: (meta) => meta_can_drop_to_list(meta, spec.to_list),
        drag_meta_factory: (official) => ({ source_type: 'list', official_id: official._id, from_list: spec.to_list, official }),
        variant: spec.variant || 'list',
        timer_state_factory: spec.timer_state_factory,
        on_drop: (meta, before_official_id) => {
          if (meta.source_type === 'preparation' || meta.source_type === 'assigned') {
            remove_meta_from_match_to_list(stack, meta, spec.to_list, before_official_id);
            return;
          }
          send_list_reorder(meta, spec.to_list, build_reordered_ids(stack, meta.official_id, before_official_id));
        }
      });
    });
    return { section, row };
  };
  const on_court_placeholder_row = create_official_section(ci18n('On court:'));
  sorted_courts.forEach((court) => {
    const court_umpire = curt.umpires.find((official) => official.umpire_on_court === court._id);
    const court_service_judge = include_service_judges
      ? curt.umpires.find((official) => official.service_judge_on_court === court._id)
      : null;
    const has_match_on_court = !!court.match_id;
    mark_visible(court_umpire);
    if (include_service_judges) {
      mark_visible(court_service_judge);
    }
    const court_row = uiu.el(on_court_placeholder_row, 'div', `official_on_court_row${include_service_judges ? '' : ' official_on_court_row_single_role'}`);
    if (court.is_active === false) {
      court_row.classList.add('official_on_court_row_inactive');
    }
    const court_leading = uiu.el(court_row, 'div', 'official_on_court_leading');
    const is_active_court = court.is_active !== false;
    const should_dim_court_icon = !has_match_on_court || !is_active_court;
    const court_icon_class = [
      is_active_court ? 'court' : 'court_inactive',
      should_dim_court_icon ? 'officials_table_court_inactive' : ''
    ].filter(Boolean).join(' ');
    uiu.el(court_leading, 'div', court_icon_class, is_active_court ? String(court.num || '') : '');
    const umpire_slot = uiu.el(court_row, 'div', 'official_on_court_slot official_card_frame official_card_drop official_card_drop_disabled');
    const service_judge_slot = include_service_judges
      ? uiu.el(court_row, 'div', 'official_on_court_slot official_card_frame official_card_drop official_card_drop_disabled')
      : null;
    register_drop_target(umpire_slot, () => false);
    if (service_judge_slot) {
      register_drop_target(service_judge_slot, () => false);
    }
    if (!has_match_on_court) {
      umpire_slot.classList.add('official_card_drop_disabled');
      if (service_judge_slot) {
        service_judge_slot.classList.add('official_card_drop_disabled');
      }
    }
    if (court_umpire) {
      render_official_card(
        umpire_slot,
        court_umpire,
        'umpire',
        null,
        null,
        'on_court'
      );
    }
    if (court_service_judge && service_judge_slot) {
      render_official_card(
        service_judge_slot,
        court_service_judge,
        'service_judge',
        null,
        null,
        'on_court'
      );
    }
  });
  if (preparation_matches.length > 0) {
    const in_preparation_section = create_official_section(ci18n('In preparation:'));
    preparation_matches.forEach((match) => {
      render_match_assignment_row(in_preparation_section, match, 'preparation', 'assign_official_to_preparation_match');
    });
  }
  if (assigned_matches.length > 0) {
    const assigned_section = create_official_section(ci18n('Assigned to a match:'));
    assigned_matches.forEach((match) => {
      render_match_assignment_row(assigned_section, match, 'assigned', 'assign_official_to_match');
    });
  }
  const should_render_in_lower_lists = (official) => !visible_official_ids.has(official._id);
  const waiting_umpires = [...(curt.umpires || [])]
    .filter((official) => official.umpire_wait && should_render_in_lower_lists(official))
    .sort((a, b) => (a.umpire_wait || 0) - (b.umpire_wait || 0));
  const waiting_service_judges = include_service_judges
    ? [...(curt.umpires || [])]
      .filter((official) => official.service_judge_wait && should_render_in_lower_lists(official))
      .sort((a, b) => (a.service_judge_wait || 0) - (b.service_judge_wait || 0))
    : [];
  const paused_umpires = [...(curt.umpires || [])]
    .filter((official) => (official.umpire_pause != null || official.umpire_manual_pause != null) && should_render_in_lower_lists(official))
    .sort((a, b) => get_official_pause_sort_ts(a, 'umpire') - get_official_pause_sort_ts(b, 'umpire'));
  const paused_service_judges = include_service_judges
    ? [...(curt.umpires || [])]
      .filter((official) => (official.service_judge_pause != null || official.service_judge_manual_pause != null) && should_render_in_lower_lists(official))
      .sort((a, b) => get_official_pause_sort_ts(a, 'service_judge') - get_official_pause_sort_ts(b, 'service_judge'))
    : [];
  const inactive_officials = [...(curt.umpires || [])]
    .filter((official) => official.inactive_list && should_render_in_lower_lists(official))
    .sort((a, b) => (a.inactive_list || 0) - (b.inactive_list || 0));
  render_vertical_list_section(ci18n('Waiting for the next game:'), [
    { items: waiting_umpires, icon_class: 'umpire', to_list: 'umpire_wait' },
    ...(include_service_judges ? [{ items: waiting_service_judges, icon_class: 'service_judge', to_list: 'service_judge_wait' }] : [])
  ]);
  render_vertical_list_section(ci18n('Currently on break:'), [
    { items: paused_umpires, icon_class: 'umpire', to_list: 'umpire_pause', timer_state_factory: (official) => create_official_pause_timer_state(official, 'umpire') },
    ...(include_service_judges ? [{ items: paused_service_judges, icon_class: 'service_judge', to_list: 'service_judge_pause', timer_state_factory: (official) => create_official_pause_timer_state(official, 'service_judge') }] : [])
  ]);
  const inactive_section = create_official_section(ci18n('Not available:'));
  inactive_section.classList.add('official_section_body_stacklist');
  const inactive_row = uiu.el(inactive_section, 'div', 'official_on_court_row official_inactive_row');
  uiu.el(inactive_row, 'div', 'official_on_court_leading official_preparation_leading');
  const inactive_stack = uiu.el(inactive_row, 'div', 'official_card_stack');
  const fallback_inactive_officials = all_officials
    .filter((official) => !visible_official_ids.has(official._id))
    .filter((official) => official.umpire_wait == null && official.service_judge_wait == null && official.umpire_pause == null && official.service_judge_pause == null && official.umpire_manual_pause == null && official.service_judge_manual_pause == null && official.inactive_list == null)
    .sort((a, b) => cbts_utils.natcmp(String(official_display_name(a)), String(official_display_name(b))));
  const all_inactive_officials = [...inactive_officials];
  fallback_inactive_officials.forEach((official) => {
    if (!all_inactive_officials.some((existing) => existing._id === official._id)) {
      all_inactive_officials.push(official);
    }
  });
  render_card_stack_with_drops(inactive_stack, 'umpire', all_inactive_officials, {
    can_drop: (meta) => meta_can_drop_to_list(meta, 'inactive_list'),
    drag_meta_factory: (official) => ({ source_type: 'list', official_id: official._id, from_list: 'inactive_list', official }),
    on_drop: (meta, before_official_id) => {
      if (meta.source_type === 'preparation' || meta.source_type === 'assigned') {
        remove_meta_from_match_to_list(inactive_stack, meta, 'inactive_list', before_official_id);
        return;
      }
      send_list_reorder(meta, 'inactive_list', build_reordered_ids(inactive_stack, meta.official_id, before_official_id));
    }
  });
  apply_stack_section_base_heights();
}

function update_officials() {
	if(current_view === 'edit') {
		if (official_drag_active) {
			official_drag_refresh_pending = true;
			return;
		}
		if (update_official_tables._document_drop_cleanup) {
			document.removeEventListener('drop', update_official_tables._document_drop_cleanup, true);
			update_official_tables._document_drop_cleanup = null;
		}
		if (update_official_tables._window_dragend_cleanup) {
			window.removeEventListener('dragend', update_official_tables._window_dragend_cleanup, true);
			update_official_tables._window_dragend_cleanup = null;
		}
		update_official_tables(document.getElementById('officials_host'));
	}
	return;
}


	function render_courts(main) {
		uiu.el(main, 'h2', 'edit', ci18n('tournament:edit:courts'));

		const courts_table = uiu.el(main, 'table', 'courts_table');
		const courts_tbody = uiu.el(courts_table, 'tbody');
		const tr = uiu.el(courts_tbody, 'tr');
		uiu.el(tr, 'th', {}, 'Spielort');
		uiu.el(tr, 'th', {}, 'Nummer');
		//uiu.el(tr, 'th', {}, 'Name');
		uiu.el(tr, 'th', {}, 'Aktiv');
		uiu.el(tr, 'th', {}, 'Schiedsrichter');
		uiu.el(tr, 'th', {}, 'Aufschlagrichter');
		uiu.el(tr, 'th', {}, '');
		
		var l = {_id : ''};

		for (const c of curt.courts) {
			const tr = uiu.el(courts_tbody, 'tr');
			if(l._id != c.location_id) {
				l = utils.find(curt.locations, l => l._id === c.location_id);
			}

			uiu.el(tr, 'th', {}, l.name);
			uiu.el(tr, 'th', {}, c.num);
			//uiu.el(tr, 'td', {}, c.name || '');
			const active_td = uiu.el(tr, 'td', {});
			const active_cb = create_simple_checkbox(active_td, {'name' : 'active_cb', 'data-court-id': c._id,}, c.is_active);
			active_cb.addEventListener('change', (e) => {
				const court_id = e.target.getAttribute('data-court-id');
				send_with_live_status({
					type: 'court_edit',
					tournament_key: curt.key,
					is_active: e.target.checked,
					court_id: court_id,
				}, err => {
					if (err) {
						return cerror.net(err);
					}
				});
			});
			const umpire_td = uiu.el(tr, 'td', {});
			const umpire_cb = create_simple_checkbox(umpire_td, {'name' : 'umpire_cb', 'data-court-id': c._id}, c.has_umpire !== false);
			umpire_cb.addEventListener('change', (e) => {
				const court_id = e.target.getAttribute('data-court-id');
				const court = utils.find(curt.courts, (entry) => entry._id === court_id);
				if (court) {
					court.has_umpire = e.target.checked;
					update_court(court);
				}
				send_with_live_status({
					type: 'court_edit',
					tournament_key: curt.key,
					has_umpire: e.target.checked,
					court_id,
				}, err => {
					if (err) {
						return cerror.net(err);
					}
				});
			});
			const service_judge_td = uiu.el(tr, 'td', {});
			const service_judge_cb = create_simple_checkbox(service_judge_td, {'name' : 'service_judge_cb', 'data-court-id': c._id}, c.has_service_judge !== false);
			service_judge_cb.addEventListener('change', (e) => {
				const court_id = e.target.getAttribute('data-court-id');
				const court = utils.find(curt.courts, (entry) => entry._id === court_id);
				if (court) {
					court.has_service_judge = e.target.checked;
					update_court(court);
				}
				send_with_live_status({
					type: 'court_edit',
					tournament_key: curt.key,
					has_service_judge: e.target.checked,
					court_id,
				}, err => {
					if (err) {
						return cerror.net(err);
					}
				});
			});
			const actions_td = uiu.el(tr, 'td', {});
			const del_btn = uiu.el(actions_td, 'button', {
				'data-court-id': c._id,
			}, 'Delete');
			del_btn.addEventListener('click', function (e) {
				const del_btn = e.target;
				const court_id = del_btn.getAttribute('data-court-id');
				if (confirm('Do you really want to delete ' + court_id + '? (Will not do anything yet!)')) {
					debug.log('TODO: would now delete court');
				}
			});
		}

		const nums = curt.courts.map(c => parseInt(c.num));
		const maxnum = Math.max(0, Math.max.apply(null, nums));
		apply_court_official_checkbox_dependencies();
	}

	function create_simple_checkbox(parant_el, attrs, is_checked) {
		attrs.type = 'checkbox';
		if(is_checked){
			attrs.checked = 'checked';
		}
		const result = uiu.el(parant_el, 'input', attrs);
		return result;
	}

	function get_effective_court_official_checkbox_state(court) {
		const rotation_mode = curt.official_rotation_mode || 'umpire_and_service_judge';
		const is_active = court && court.is_active !== false;
		const stored_has_umpire = court && court.has_umpire !== false;
		const stored_has_service_judge = court && court.has_service_judge !== false;

		if (!is_active) {
			return {
				umpire_checked: false,
				umpire_disabled: true,
				service_judge_checked: false,
				service_judge_disabled: true,
			};
		}

		if (rotation_mode === 'disabled') {
			return {
				umpire_checked: false,
				umpire_disabled: true,
				service_judge_checked: false,
				service_judge_disabled: true,
			};
		}

		if (rotation_mode === 'umpire_only') {
			return {
				umpire_checked: stored_has_umpire,
				umpire_disabled: false,
				service_judge_checked: false,
				service_judge_disabled: true,
			};
		}

		return {
			umpire_checked: stored_has_umpire,
			umpire_disabled: false,
			service_judge_checked: stored_has_umpire ? stored_has_service_judge : false,
			service_judge_disabled: !stored_has_umpire,
		};
	}

	function apply_court_official_checkbox_dependencies(court = null) {
		const courts_table = uiu.qs('.courts_table');
		if (!courts_table) {
			return;
		}

		const courts = court ? [court] : (curt.courts || []);
		courts.forEach((current_court) => {
			if (!current_court || !current_court._id) {
				return;
			}
			const state = get_effective_court_official_checkbox_state(current_court);
			const umpire_checkbox = courts_table.querySelector(`[name="umpire_cb"][data-court-id="${current_court._id}"]`);
			if (umpire_checkbox) {
				umpire_checkbox.checked = !!state.umpire_checked;
				umpire_checkbox.disabled = !!state.umpire_disabled;
			}
			const service_judge_checkbox = courts_table.querySelector(`[name="service_judge_cb"][data-court-id="${current_court._id}"]`);
			if (service_judge_checkbox) {
				service_judge_checkbox.checked = !!state.service_judge_checked;
				service_judge_checkbox.disabled = !!state.service_judge_disabled;
			}
		});
	}

	function update_court(court) {
		switch (get_admin_subpage()){
			case 'edit':
				const courts_table = uiu.qs('.courts_table');
				if (!courts_table || !court) {
					break;
				}
				const active_checkbox = courts_table.querySelector(`[name="active_cb"][data-court-id="${court._id}"]`);
				if (active_checkbox) {
					active_checkbox.checked = court.is_active;
				}
				const umpire_checkbox = courts_table.querySelector(`[name="umpire_cb"][data-court-id="${court._id}"]`);
				if (umpire_checkbox) {
					umpire_checkbox.checked = court.has_umpire !== false;
				}
				const service_judge_checkbox = courts_table.querySelector(`[name="service_judge_cb"][data-court-id="${court._id}"]`);
				if (service_judge_checkbox) {
					service_judge_checkbox.checked = court.has_service_judge !== false;
				}
				apply_court_official_checkbox_dependencies(court);
				break;
			default:
				cmatch.update_court(court);
				break;
		} 
	}

	function create_checkbox(curt, parent_el, filed_id, label_class) {
		const label = uiu.el(parent_el, 'label', label_class);
		const attrs = {
			type: 'checkbox',
			name: filed_id,
		};
		if (curt[filed_id]) {
			attrs.checked = 'checked';
		}
			const result = uiu.el(label, 'input', attrs);
			uiu.el(label, 'span', {}, ci18n('tournament:edit:' + filed_id));
			bind_live_prop(result, filed_id);
			return result;
		}

	function create_input(curt, type, parent_el, filed_id) {
		const text_input = uiu.el(parent_el, 'label');
		uiu.el(text_input, 'span', {}, ci18n('tournament:edit:' + filed_id));
			const result = uiu.el(text_input, 'input', {
				type: type,
				name: filed_id,
				value: curt[filed_id] || '',
			});
			bind_live_prop(result, filed_id, {
				event_name: (type === 'text') ? 'blur' : 'change',
				get_value: type === 'number' ? input_el => Number(input_el.value) : undefined,
			});
			return result;
		}

	function create_undecorated_input(type, parent_el, filed_id) {
		return (
			uiu.el(parent_el, 'input', {
				type: type,
				name: filed_id,
				id: filed_id,
				value: '',
			})
		);
	}

	function create_textarea_input(type, parent_el, filed_id) {
		return (
			uiu.el(parent_el, 'textarea', {
				type: type,
				name: filed_id,
				id: filed_id,
				value: '',
			})
		);
	}

	function create_numeric_input(curt, parent_el, filed_id, min_value, max_value, default_value, step_value) {
		const text_input = uiu.el(parent_el, 'label');
		uiu.el(text_input, 'span', {}, ci18n('tournament:edit:' + filed_id));
			const result = uiu.el(text_input, 'input', {
				type: "number",
				name: filed_id,
				value: curt[filed_id] || default_value,
				min: min_value,
				max: max_value,
				step: step_value
			});
			bind_live_prop(result, filed_id, {
				get_value: input_el => Number(input_el.value),
			});
			return result;
		}

	function create_select_input(curt, parent_el, filed_id, values) {
		const label = uiu.el(parent_el, 'label');
		uiu.el(label, 'span', {}, ci18n('tournament:edit:' + filed_id));
		const result = uiu.el(label, 'select', {
			name: filed_id,
		});
		const current_value = curt[filed_id] == null ? 'none' : String(curt[filed_id]);
		for (const value of values) {
			const value_str = String(value);
			const attrs = { value: value_str };
			if (current_value === value_str) {
				attrs.selected = 'selected';
			}
			uiu.el(result, 'option', attrs, ci18n(`tournament:edit:option:${filed_id}:${value_str}`));
		}
		bind_live_prop(result, filed_id, {
			get_value: input_el => input_el.value === 'none' ? 'none' : Number(input_el.value),
		});
		return result;
	}

	function create_rule_select_input(curt, parent_el, filed_id, values, fallback_value_fn) {
		const box = uiu.el(parent_el, 'fieldset', 'automation_rule_box');
		const legend = uiu.el(box, 'legend');
		uiu.el(legend, 'span', {}, ci18n('tournament:edit:' + filed_id));
		const value_label = uiu.el(box, 'label', 'automation_rule_value');
		uiu.el(value_label, 'span', {}, ci18n('tournament:edit:' + filed_id + ':value'));
		const result = uiu.el(value_label, 'select', {
			name: filed_id,
		});
		const fallback_value = typeof fallback_value_fn === 'function' ? fallback_value_fn() : 'disabled';
		const current_value = curt[filed_id] == null ? String(fallback_value) : String(curt[filed_id]);
		for (const value of values) {
			const attrs = { value };
			if (current_value === value) {
				attrs.selected = 'selected';
			}
			uiu.el(result, 'option', attrs, ci18n(`tournament:edit:option:${filed_id}:${value}`));
		}
		bind_live_prop(result, filed_id, {
			get_value: input_el => input_el.value,
		});
		result.rule_box = box;
		return result;
	}

	function create_rule_limit_input(curt, parent_el, enabled_field_id, value_field_id, default_value, min_value, max_value, step_value, unit_label_key) {
		const value_is_set = curt[value_field_id] != null && curt[value_field_id] !== 'none' && curt[value_field_id] !== '';
		const enabled_value = curt[enabled_field_id] != null ? !!curt[enabled_field_id] : value_is_set;
		const numeric_value = value_is_set ? Number(curt[value_field_id]) : default_value;

		const box = uiu.el(parent_el, 'fieldset', 'automation_rule_box');
		const legend = uiu.el(box, 'legend');
		const enabled_input = uiu.el(legend, 'input', {
			type: 'checkbox',
			name: enabled_field_id,
		});
		if (enabled_value) {
			enabled_input.checked = true;
		}
		uiu.el(legend, 'span', {}, ci18n('tournament:edit:' + enabled_field_id));

		const value_label = uiu.el(box, 'label', 'automation_rule_value');
		uiu.el(value_label, 'span', {}, ci18n('tournament:edit:' + value_field_id));
		const value_input = uiu.el(value_label, 'input', {
			type: 'number',
			name: value_field_id,
			value: Number.isFinite(numeric_value) ? numeric_value : default_value,
			min: min_value,
			max: max_value,
			step: step_value,
		});
		if (unit_label_key) {
			uiu.el(value_label, 'span', 'automation_rule_unit', ci18n(unit_label_key));
		}

		const sync_disabled = () => {
			value_input.disabled = !enabled_input.checked;
		};
		sync_disabled();
		enabled_input.addEventListener('change', sync_disabled);

		bind_live_prop(enabled_input, enabled_field_id);
		bind_live_prop(value_input, value_field_id, {
			get_value: input_el => Number(input_el.value),
		});

		return {
			box,
			enabled_input,
			value_input,
		};
	}

	function create_duration_seconds_input(curt, parent_el, filed_id, min_seconds, max_seconds, default_seconds, step_seconds) {
		const text_input = uiu.el(parent_el, 'label');
		uiu.el(text_input, 'span', {}, ci18n('tournament:edit:' + filed_id));
		const current_ms = Number(curt[filed_id]);
		const value_seconds = Number.isFinite(current_ms) && current_ms > 0 ? (current_ms / 1000) : default_seconds;
		const result = uiu.el(text_input, 'input', {
			type: "number",
			name: filed_id,
			value: value_seconds,
			min: min_seconds,
			max: max_seconds,
			step: step_seconds
		});
		bind_live_prop(result, filed_id, {
			get_value: input_el => Number(input_el.value) * 1000,
		});
		return result;
	}

	function isMultiCourtDisplaysetting(displaysetting_id) {
		const displaysetting = utils.find(curt.displaysettings || [], d => d.id === displaysetting_id)
			|| utils.find(curt.displaysettings || [], d => d.id === curt.displaysettings_general);
		const style = displaysetting && displaysetting.displaymode_style;
		return !!style && Array.isArray(displaymode.FIELDLESS_MULTI_COURT_STYLES)
			&& displaymode.FIELDLESS_MULTI_COURT_STYLES.indexOf(style) >= 0;
	}

	function isTwoCourtDisplaysetting(displaysetting_id) {
		const displaysetting = utils.find(curt.displaysettings || [], d => d.id === displaysetting_id)
			|| utils.find(curt.displaysettings || [], d => d.id === curt.displaysettings_general);
		return displaysetting && ['2court', 'castall', 'stream'].includes(displaysetting.displaymode_style);
	}

	function createCourtSelectBox(parentEl, parent_id, court_id, displaysetting_id) {
		const court_select_box = uiu.el(parentEl, 'select', {
			name: 'court_' + parent_id,
		});

		const empty_id = "--";
		const multi_id = "__multi__";
		const is_multi_displaysetting = isMultiCourtDisplaysetting(displaysetting_id) || court_id === multi_id;
		const is_two_court_displaysetting = isTwoCourtDisplaysetting(displaysetting_id);
		const is_legacy_field_on_multi_displaysetting = is_multi_displaysetting && court_id && court_id !== empty_id && court_id !== multi_id;
		const attrs = {
			'data-display-setting-id': court_id,
			value: empty_id,
		}

		if (!court_id || empty_id === court_id) {
			attrs.selected = 'selected';
		}
		uiu.el(court_select_box, 'option', attrs, empty_id);

		if (is_multi_displaysetting) {
			const multi_attrs = {
				'data-display-setting-id': court_id,
				value: multi_id,
			};
			if (court_id === multi_id || is_legacy_field_on_multi_displaysetting) {
				multi_attrs.selected = 'selected';
			}
			uiu.el(court_select_box, 'option', multi_attrs, 'Multi');
		} else if (is_two_court_displaysetting) {
			for (let court_idx = 0; court_idx < Math.max(0, curt.courts.length - 1); court_idx++) {
				const first_court = curt.courts[court_idx];
				const second_court = curt.courts[court_idx + 1];
				const attrs = {
					'data-display-setting-id': court_id,
					value: first_court._id,
				};
				if (court_id === first_court._id || (court_idx === curt.courts.length - 2 && court_id === second_court._id)) {
					attrs.selected = 'selected';
				}
				uiu.el(court_select_box, 'option', attrs, first_court.num + ' & ' + second_court.num);
			}
		} else {
			for (const court of curt.courts) {
				const attrs = {
					'data-display-setting-id': court_id,
					value: court._id,
				}

				if ((court_id === court._id)) {
					attrs.selected = 'selected';
				}
				uiu.el(court_select_box, 'option', attrs, court.num);
			}
		}

		court_select_box.addEventListener('change', (e) => {
			const select_box = e.target;
			const display_setting_id = select_box.name.split("_")[1];
			send_with_live_status({
				type: 'relocate_display',
				tournament_key: curt.key,
				new_court_id: e.srcElement.value,
				display_setting_id: display_setting_id,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function createDisplaySettingsSelectBox(parentEl, parent_id, displaysettings_id) {
		const displaysettings_select_box = uiu.el(parentEl, 'select', {
			name: 'displaysettings_' + parent_id,
		});

		createSelectBoxContent(displaysettings_select_box, curt.displaysettings, displaysettings_id);

		displaysettings_select_box.addEventListener('change', (e) => {
			const select_box = e.target;
			const display_setting_id = select_box.name.split("_")[1];
			send_with_live_status({
				type: 'change_display_mode',
				tournament_key: curt.key,
				new_displaysettings_id: e.srcElement.value,
				display_setting_id: display_setting_id,
			}, err => {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function createGeneralDisplaySettingsSelectBox(parentEl, displaysettings_id, opts = {}) {
		const fieldName = opts.fieldName || 'displaysettings_general';
		const displaysettings_select_box = uiu.el(parentEl, 'select', {
			name: fieldName
		});
		createSelectBoxContent(displaysettings_select_box, curt.displaysettings, displaysettings_id, opts);
		return displaysettings_select_box;	
	}
	function createSelectBoxContent(select_box, content, selected_id, opts = {}) {
		const filterFn = opts.filterFn || (() => true);
		if (opts.includeEmptyOption) {
			const empty_attrs = {
				value: '',
				label: '-',
			};
			if (!selected_id) {
				empty_attrs.selected = 'selected';
			}
			uiu.el(select_box, 'option', empty_attrs, '-');
		}
		for (const item of content) {
			if (!filterFn(item)) {
				continue;
			}
			const attrs = {
				'data-display-setting-id': selected_id,
				value: item.id,
				label: item.description,
			}
			if ((selected_id === item.id)) {
				attrs.selected = 'selected';
			}
			uiu.el(select_box, 'option', attrs, item.id);
		}
	}

	function render_upcoming(container) {
		cmatch.prepare_render(curt);
		const courts_container = uiu.el(container, 'div', 'courts_container');
		cmatch.render_courts(courts_container, 'public');
		const upcoming_container = uiu.el(container, 'div', 'upcoming_container');
		cmatch.render_upcoming_matches(upcoming_container);
	}

	function render_current_matches(container) {
		cmatch.prepare_render(curt);
		const courts_container = uiu.el(container, 'div', 'courts_container');
		cmatch.render_courts(courts_container, 'public');
	}

	function render_next_matches(container) {
		cmatch.prepare_render(curt);
		const upcoming_container = uiu.el(container, 'div', 'upcoming_container');
		cmatch.render_upcoming_matches(upcoming_container);
	}

	function get_location_name_filter() {
		const params = new URLSearchParams(window.location.search);
		return params.get('location');
	}

	function match_matches_selected_location(match) {
		const param_location = get_location_name_filter();
		if (!param_location) {
			return true;
		}

		const loc = utils.find(curt.locations, l => l._id === match.setup.location_id);
		if (!loc) {
			return true;
		}
		return loc.name === param_location;
	}

	function person_display_name(person) {
		if (!person) {
			return '';
		}
		if (person.name) {
			return person.name;
		}
		const surname = person.lastname || person.surname || '';
		return [person.firstname, surname].filter(Boolean).join(' ');
	}

	function split_person_name_parts(person) {
		const firstname = (person && person.firstname ? person.firstname : '').trim();
		const surname = ((person && (person.lastname || person.surname)) ? (person.lastname || person.surname) : '').trim();
		if (firstname || surname) {
			return {
				first_parts: firstname ? firstname.split(/\s+/).filter(Boolean) : [],
				surname,
			};
		}

		const fallback = person_display_name(person).trim();
		if (!fallback) {
			return { first_parts: [], surname: '' };
		}
		const parts = fallback.split(/\s+/).filter(Boolean);
		if (parts.length <= 1) {
			return { first_parts: parts, surname: '' };
		}
		return {
			first_parts: parts.slice(0, -1),
			surname: parts[parts.length - 1],
		};
	}

	function build_person_name_variants(person) {
		const { first_parts, surname } = split_person_name_parts(person);
		if (first_parts.length === 0) {
			return [person_display_name(person)];
		}

		const variants = [];
		const push_variant = (first_name_parts) => {
			const label = [...first_name_parts, surname].filter(Boolean).join(' ').trim();
			if (label && !variants.includes(label)) {
				variants.push(label);
			}
		};

		push_variant(first_parts);

		if (first_parts.length > 1) {
			push_variant([
				first_parts[0],
				...first_parts.slice(1).map(name => name[0] + '.'),
			]);
			push_variant([first_parts[0]]);
		}

		push_variant([first_parts[0][0] + '.']);
		return variants;
	}

	function get_self_check_in_matches() {
		return curt.matches
			.filter(m => m.setup && m.setup.state === 'preparation' && m.setup.is_match && match_matches_selected_location(m))
			.sort((a, b) => (a.setup.preparation_call_timestamp || 0) - (b.setup.preparation_call_timestamp || 0));
	}

	function self_check_in_match_structure_signature(match) {
		if (!match || !match.setup || !match.setup.is_match || match.setup.state !== 'preparation' || !match_matches_selected_location(match)) {
			return null;
		}

		return JSON.stringify({
			match_id: match._id,
			match_num: match.setup.match_num,
			event_name: match.setup.event_name,
			scheduled_time_str: match.setup.scheduled_time_str,
			location_id: match.setup.location_id,
			participants: self_check_in_participants(match).map(participant => ({
				key: participant.key,
				label: participant.label,
				role_label: participant.role_label || '',
			})),
		});
	}

	function self_check_in_match_status_signature(match) {
		if (!match || !match.setup || !match.setup.is_match || match.setup.state !== 'preparation' || !match_matches_selected_location(match)) {
			return null;
		}
		return JSON.stringify({
			match_id: match._id,
			participants: self_check_in_participants(match).map((participant) => ({
				key: participant.key,
				checked_in: participant.checked_in,
				now_tablet_on_court: participant.now_tablet_on_court || false,
				waiting_as_tabletoperator: participant.waiting_as_tabletoperator || false,
			})),
		});
	}

	function update_self_check_in_match_status(match_id) {
		const list = document.querySelector('.self_check_in_list');
		const match = utils.find(curt.matches, m => m._id === match_id);
		if (!list || !match) {
			_update_all_ui_elements_self_check_in();
			return;
		}
		const card = list.querySelector('.self_check_in_match[data-match-id="' + match_id + '"]');
		if (!card) {
			_update_all_ui_elements_self_check_in();
			return;
		}

		const participants = self_check_in_participants(match);
		const chips = Array.from(card.querySelectorAll('.self_check_in_chip'));
		if (chips.length !== participants.length) {
			update_self_check_in_match_card(match_id);
			return;
		}

		const chips_by_key = new Map(
			chips.map((chip) => [chip.getAttribute('data-participant-key'), chip])
		);
		for (const participant of participants) {
			const chip = chips_by_key.get(participant.key);
			if (!chip) {
				update_self_check_in_match_card(match_id);
				return;
			}
			const check_in_locked = is_self_check_in_participant_locked(participant);
			chip.classList.toggle('self_check_in_chip_ready', !!participant.checked_in);
			chip.classList.toggle('self_check_in_chip_waiting', !participant.checked_in);
			chip.classList.toggle('self_check_in_chip_locked', check_in_locked);
			chip.disabled = check_in_locked;
		}

		const all_ready = participants.length > 0 && participants.every((participant) => participant.checked_in);
		card.classList.toggle('self_check_in_match_ready', all_ready);
		card.classList.toggle('self_check_in_match_waiting', !all_ready);
		const status_el = card.querySelector('.self_check_in_match_status');
		if (status_el) {
			status_el.textContent = ci18n(all_ready ? 'Self-Check-In: ready' : 'Self-Check-In: waiting');
		}
	}

	function rerender_self_check_in_if_needed(before_structure_signature, before_status_signature, match_id) {
		const container = document.querySelector('.self_check_in_container');
		const match = utils.find(curt.matches, m => m._id === match_id);
		const after_structure_signature = self_check_in_match_structure_signature(match);
		const after_status_signature = self_check_in_match_status_signature(match);
		if (before_structure_signature !== after_structure_signature) {
			if (!container || !after_structure_signature) {
				_update_all_ui_elements_self_check_in();
				return;
			}
			const visible_before_ids = Array.from(container.querySelectorAll('.self_check_in_match')).map((card) => String(card.getAttribute('data-match-id')));
			const visible_after_ids = get_self_check_in_matches().map((m) => String(m._id));
			if (
				visible_before_ids.length !== visible_after_ids.length ||
				visible_before_ids.some((id, index) => id !== visible_after_ids[index])
			) {
				_update_all_ui_elements_self_check_in();
				return;
			}
			update_self_check_in_match_card(match_id);
			return;
		}

		if (before_status_signature !== after_status_signature) {
			update_self_check_in_match_status(match_id);
		}
	}

	function self_check_in_participants(match) {
		const participants = [];
		match.setup.teams.forEach((team, team_index) => {
			team.players.forEach((player, player_index) => {
			participants.push({
				key: 'player_' + team_index + '_' + player_index + '_' + player.btp_id,
				role: 'player',
				match_id: match._id,
				participant_id: player.btp_id,
				label: person_display_name(player),
				label_variants: build_person_name_variants(player),
				checked_in: !!player.checked_in,
				now_tablet_on_court: player.now_tablet_on_court || false,
				waiting_as_tabletoperator: is_player_waiting_as_tabletoperator(player),
			});
		});
	});

		if (match.setup.umpire && match.setup.umpire.btp_id != null) {
			participants.push({
				key: 'umpire_' + match.setup.umpire.btp_id,
				role: 'umpire',
				match_id: match._id,
				participant_id: match.setup.umpire.btp_id,
				label: person_display_name(match.setup.umpire),
				label_variants: build_person_name_variants(match.setup.umpire),
				checked_in: !!match.setup.umpire.checked_in,
				role_label: ci18n('Umpire'),
			});
		}

		if (match.setup.service_judge && match.setup.service_judge.btp_id != null) {
			participants.push({
				key: 'service_judge_' + match.setup.service_judge.btp_id,
				role: 'service_judge',
				match_id: match._id,
				participant_id: match.setup.service_judge.btp_id,
				label: person_display_name(match.setup.service_judge),
				label_variants: build_person_name_variants(match.setup.service_judge),
				checked_in: !!match.setup.service_judge.checked_in,
				role_label: ci18n('Service judge'),
			});
		}

		if (Array.isArray(match.setup.tabletoperators)) {
			match.setup.tabletoperators.forEach((operator, index) => {
				participants.push({
					key: 'tabletoperator_' + index + '_' + operator.btp_id,
					role: 'tabletoperator',
					match_id: match._id,
					participant_id: operator.btp_id,
					label: person_display_name(operator),
					label_variants: build_person_name_variants(operator),
					checked_in: !!operator.checked_in,
					role_label: ci18n('Tablet operator'),
				});
			});
		}

		return participants;
	}

	function resolve_self_check_in_court_label(match) {
		const current_match = utils.find(curt.matches, (m) => m._id === match._id) || match;
		const court_id = (match.setup && match.setup.court_id) || (current_match.setup && current_match.setup.court_id);
		let court = null;
		if (court_id && curt.courts_by_id && curt.courts_by_id[court_id]) {
			court = curt.courts_by_id[court_id];
		}
		if (!court && Array.isArray(curt.courts)) {
			court = curt.courts.find((c) => c._id === court_id)
				|| curt.courts.find((c) => c.match_id === match._id)
				|| curt.courts.find((c) => current_match && c.match_id === current_match._id)
				|| curt.courts.find((c) => match.btp_id && c.match_id === ('btp_' + match.btp_id))
				|| curt.courts.find((c) => current_match && current_match.btp_id && c.match_id === ('btp_' + current_match.btp_id));
		}
		if (!court || !court.num) {
			return '';
		}
		return ci18n('Court') + ' ' + court.num;
	}

	function render_self_check_in_chip(container, participant) {
		const check_in_locked = is_self_check_in_participant_locked(participant);
		const attrs = {
			type: 'button',
			'class': 'self_check_in_chip self_check_in_chip_' + (participant.checked_in ? 'ready' : 'waiting') + (participant.role_label ? ' self_check_in_chip_with_role' : '') + (check_in_locked ? ' self_check_in_chip_locked' : ''),
			'data-role': participant.role,
			'data-match_id': participant.match_id,
			'data-participant_id': participant.participant_id,
			'data-participant-key': participant.key,
		};
		if (check_in_locked) {
			attrs.disabled = 'disabled';
		}
		const chip = uiu.el(container, 'button', attrs);
		if (participant.role_label) {
			uiu.el(chip, 'span', 'self_check_in_chip_role', participant.role_label);
		}
		const cached_fit = self_check_in_chip_fit_cache[participant.key];
		const initial_label = cached_fit ? cached_fit.label : participant.label;
		const name_el = uiu.el(chip, 'span', 'self_check_in_chip_name', initial_label);
		chip._name_el = name_el;
		chip._label_variants = participant.label_variants || [participant.label];
		chip._participant_key = participant.key;
		if (cached_fit && cached_fit.font_size) {
			name_el.style.fontSize = cached_fit.font_size;
		}
		chip.addEventListener('click', function(ev) {
			ev.stopPropagation();
			if (check_in_locked) {
				ev.preventDefault();
				return;
			}
			const checked_in = !chip.classList.contains('self_check_in_chip_ready');
			const payload = {
				tournament_key: curt.key,
				match_id: participant.match_id,
				checked_in,
			};

			if (participant.role === 'player') {
				payload.type = 'match_player_check_in';
				payload.player_id = participant.participant_id;
			} else {
				payload.type = 'match_participant_check_in';
				payload.role = participant.role;
				payload.participant_id = participant.participant_id;
			}

			send(payload, function(err) {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function is_self_check_in_participant_locked(participant) {
		return participant && participant.role === 'player' && !!(participant.now_tablet_on_court || participant.waiting_as_tabletoperator);
	}

	function is_player_waiting_as_tabletoperator(player) {
		const player_btp_id = player && player.btp_id;
		if (player_btp_id == null || !Array.isArray(curt && curt.tabletoperators)) {
			return false;
		}

		return curt.tabletoperators.some((entry) => {
			if (!entry || entry.court != null || !Array.isArray(entry.tabletoperator)) {
				return false;
			}

			return entry.tabletoperator.some((operator) => operator && String(operator.btp_id) === String(player_btp_id));
		});
	}

	function fit_self_check_in_chip(chip) {
		const name_el = chip._name_el;
		const variants = chip._label_variants || [name_el.textContent];
		if (!name_el.dataset.baseFontSize) {
			const previous_font_size = name_el.style.fontSize;
			name_el.style.fontSize = '';
			name_el.dataset.baseFontSize = String(parseFloat(window.getComputedStyle(name_el).fontSize));
			name_el.style.fontSize = previous_font_size;
		}
		const chip_style = window.getComputedStyle(chip);
		const css_base_font_size = Number(name_el.dataset.baseFontSize) || 16;
		const role_el = chip.querySelector('.self_check_in_chip_role');
		const available_height = chip.clientHeight
			- parseFloat(chip_style.paddingTop || 0)
			- parseFloat(chip_style.paddingBottom || 0)
			- (role_el ? role_el.offsetHeight + parseFloat(chip_style.gap || 0) : 0);
		const height_based_font_size = Math.max(
			css_base_font_size,
			available_height * (role_el ? 0.58 : 0.7)
		);
		const base_font_size = height_based_font_size;
		const available_width = chip.clientWidth
			- parseFloat(chip_style.paddingLeft || 0)
			- parseFloat(chip_style.paddingRight || 0);
		const measure_text_width = (text, font_size_px) => {
			if (!self_check_in_measure_probe) {
				self_check_in_measure_probe = document.createElement('span');
				self_check_in_measure_probe.style.position = 'absolute';
				self_check_in_measure_probe.style.visibility = 'hidden';
				self_check_in_measure_probe.style.pointerEvents = 'none';
				self_check_in_measure_probe.style.whiteSpace = 'nowrap';
				self_check_in_measure_probe.style.left = '-99999px';
				self_check_in_measure_probe.style.top = '0';
				document.body.appendChild(self_check_in_measure_probe);
			}
			const probe = self_check_in_measure_probe;
			probe.textContent = text;
			const name_style = window.getComputedStyle(name_el);
			probe.style.fontFamily = name_style.fontFamily;
			probe.style.fontWeight = name_style.fontWeight;
			probe.style.fontStyle = name_style.fontStyle;
			probe.style.fontStretch = name_style.fontStretch;
			probe.style.fontVariant = name_style.fontVariant;
			probe.style.fontSize = font_size_px + 'px';
			probe.style.lineHeight = name_style.lineHeight;
			probe.style.letterSpacing = window.getComputedStyle(name_el).letterSpacing;
			const width = probe.getBoundingClientRect().width;
			return width;
		};
		const min_font_size = Math.max(base_font_size * 0.18, 8);
		const line_height_factor = 1.2;
		const max_font_by_height = Math.max(min_font_size, (available_height / line_height_factor) * 0.98);
		const layout_fit_cache_key = JSON.stringify({
			variants,
			width: Math.round(available_width),
			height: Math.round(available_height),
			base_font_size: Math.round(base_font_size * 10) / 10,
			min_font_size: Math.round(min_font_size * 10) / 10,
			max_font_by_height: Math.round(max_font_by_height * 10) / 10,
		});
		const cached_layout_fit = self_check_in_layout_fit_cache.get(layout_fit_cache_key);
		if (cached_layout_fit) {
			name_el.textContent = cached_layout_fit.label;
			name_el.style.fontSize = cached_layout_fit.font_size;
			self_check_in_chip_fit_cache[chip._participant_key] = cached_layout_fit;
			return;
		}
		let best = null;

		for (const variant of variants) {
			const width_at_base = measure_text_width(variant, base_font_size);
			const width_ratio = available_width / Math.max(width_at_base, 1);
			const width_limited_font_size = base_font_size * width_ratio * 0.98;
			const fitted_font_size = Math.max(
				min_font_size,
				Math.min(base_font_size, max_font_by_height, width_limited_font_size)
			);

			if (!best || fitted_font_size > best.font_size + 0.05) {
				best = {
					label: variant,
					font_size: fitted_font_size,
				};
			}
		}

		const chosen = best || {
			label: variants[variants.length - 1],
			font_size: min_font_size,
		};
		name_el.textContent = chosen.label;
		name_el.style.fontSize = chosen.font_size + 'px';
		const chosen_fit = {
			label: chosen.label,
			font_size: name_el.style.fontSize,
		};
		self_check_in_layout_fit_cache.set(layout_fit_cache_key, chosen_fit);
		self_check_in_chip_fit_cache[chip._participant_key] = chosen_fit;
	}

	function fit_self_check_in_card(card) {
		const card_height = card.clientHeight || 0;
		if (card_height > 0) {
			const header_height = Math.max(56, Math.min(card_height * 0.26, 140));
			card.style.setProperty('--self-check-in-header-height', header_height + 'px');
			card.style.setProperty('--self-check-in-header-gap', Math.max(4, Math.min(header_height * 0.06, 12)) + 'px');
			card.style.setProperty('--self-check-in-number-font-size', Math.max(18, Math.min(header_height * 0.18, 34)) + 'px');
			card.style.setProperty('--self-check-in-event-font-size', Math.max(26, Math.min(header_height * 0.3, 54)) + 'px');
			card.style.setProperty('--self-check-in-meta-font-size', Math.max(18, Math.min(header_height * 0.18, 34)) + 'px');
			card.style.setProperty('--self-check-in-status-font-size', Math.max(18, Math.min(header_height * 0.18, 34)) + 'px');
			const heading = card.querySelector('.self_check_in_match_heading');
			const header_gap = Math.max(4, Math.min(header_height * 0.06, 12));
			if (heading) {
				const available_header_height = Math.max(24, header_height - header_gap);
				if (heading.scrollHeight > available_header_height + 1) {
					const ratio = available_header_height / Math.max(heading.scrollHeight, 1);
					card.style.setProperty('--self-check-in-number-font-size', Math.max(14, Math.min(header_height * 0.18 * ratio * 0.98, 34)) + 'px');
					card.style.setProperty('--self-check-in-event-font-size', Math.max(18, Math.min(header_height * 0.3 * ratio * 0.98, 54)) + 'px');
					card.style.setProperty('--self-check-in-meta-font-size', Math.max(14, Math.min(header_height * 0.18 * ratio * 0.98, 34)) + 'px');
					card.style.setProperty('--self-check-in-status-font-size', Math.max(14, Math.min(header_height * 0.18 * ratio * 0.98, 34)) + 'px');
				}
			}
		}
		card.querySelectorAll('.self_check_in_chip').forEach(fit_self_check_in_chip);
		card.style.visibility = 'visible';
	}

	function update_self_check_in_match_card(match_id) {
		const list = document.querySelector('.self_check_in_list');
		const match = utils.find(curt.matches, m => m._id === match_id);
		if (!list || !match) {
			_update_all_ui_elements_self_check_in();
			return;
		}
		const current_card = list.querySelector('.self_check_in_match[data-match-id="' + match_id + '"]');
		if (!current_card) {
			_update_all_ui_elements_self_check_in();
			return;
		}
		const temp = document.createElement('div');
		render_self_check_in_match_card(temp, match, false);
		const new_card = temp.firstElementChild;
		if (!new_card) {
			_update_all_ui_elements_self_check_in();
			return;
		}
		[
			'--self-check-in-header-height',
			'--self-check-in-header-gap',
			'--self-check-in-number-font-size',
			'--self-check-in-event-font-size',
			'--self-check-in-meta-font-size',
			'--self-check-in-status-font-size',
		].forEach((prop) => {
			const value = current_card.style.getPropertyValue(prop);
			if (value) {
				new_card.style.setProperty(prop, value);
			}
		});
		current_card.replaceWith(new_card);
		schedule_fit_self_check_in_cards(new_card);
	}

	function render_self_check_in_match_card(container, match, do_fit) {
		if (do_fit === undefined) {
			do_fit = true;
		}
		const participants = self_check_in_participants(match);
		const all_ready = participants.length > 0 && participants.every(p => p.checked_in);
		const columns = participants.length <= 3 ? 1 : 2;
		const rows = Math.ceil(participants.length / columns);
		const has_officials = participants.some((participant) => !!participant.role_label);
		const card = uiu.el(container, 'section', {
			'class': 'self_check_in_match ' + (all_ready ? 'self_check_in_match_ready' : 'self_check_in_match_waiting'),
		});
		card.setAttribute('data-match-id', String(match._id));
		card.setAttribute('data-rows', String(rows));
		card.style.visibility = 'hidden';

		const heading = uiu.el(card, 'div', 'self_check_in_match_heading');
		const left = uiu.el(heading, 'div', 'self_check_in_match_heading_left');
		const top_row = uiu.el(left, 'div', 'self_check_in_match_top_row');
		uiu.el(top_row, 'div', 'self_check_in_match_number', '#' + match.setup.match_num);
		uiu.el(top_row, 'div', 'self_check_in_match_status', ci18n(all_ready ? 'Self-Check-In: ready' : 'Self-Check-In: waiting'));
		const event_row = uiu.el(left, 'div', 'self_check_in_match_event_row');
		uiu.el(event_row, 'div', 'self_check_in_match_event', match.setup.event_name || '');
		uiu.el(event_row, 'div', 'self_check_in_match_court', resolve_self_check_in_court_label(match));

		const meta = [];
		if (match.setup.scheduled_time_str) {
			meta.push(match.setup.scheduled_time_str);
		}
		if (match.setup.location_id) {
			const loc = utils.find(curt.locations, l => l._id === match.setup.location_id);
			if (loc && loc.name) {
				meta.push(loc.name);
			}
		}
		if (meta.length > 0) {
			uiu.el(left, 'div', 'self_check_in_match_meta', meta.join(' • '));
		}

		const chips = uiu.el(card, 'div', 'self_check_in_chips');
		chips.setAttribute('data-columns', String(columns));
		chips.setAttribute('data-rows', String(rows));
		chips.setAttribute('data-has-officials', has_officials ? '1' : '0');
		if (rows === 3) {
			chips.style.setProperty('--self-check-in-chip-name-scale-row', '1.12');
			chips.style.setProperty('--self-check-in-chip-box-scale-row', '1.04');
		} else if (rows === 2) {
			chips.style.setProperty('--self-check-in-chip-name-scale-row', '0.80');
			chips.style.setProperty('--self-check-in-chip-box-scale-row', '0.98');
		} else {
			chips.style.setProperty('--self-check-in-chip-name-scale-row', '1');
			chips.style.setProperty('--self-check-in-chip-box-scale-row', '1');
		}
		participants.forEach((participant) => render_self_check_in_chip(chips, participant));
		if (do_fit) {
			schedule_fit_self_check_in_cards(card);
		}
	}

	function calc_self_check_in_grid(match_count) {
		if (match_count <= 1) {
			return { cols: 1, rows: 1 };
		}

		let best = null;
		for (let cols = 1; cols <= match_count; cols++) {
			for (let rows = 1; rows <= cols; rows++) {
				const area = cols * rows;
				if (area < match_count) {
					continue;
				}

				const candidate = {
					cols,
					rows,
					area,
					diff: cols - rows,
				};

				if (
					!best ||
					candidate.cols < best.cols ||
					(candidate.cols === best.cols && candidate.area < best.area) ||
					(candidate.cols === best.cols && candidate.area === best.area && candidate.diff < best.diff)
				) {
					best = candidate;
				}
			}
			if (best && best.cols === cols) {
				break;
			}
		}

		return { cols: best.cols, rows: best.rows };
	}

	function render_self_check_in(container) {
		uiu.empty(container);

		const matches = get_self_check_in_matches();
		container.setAttribute('data-match-count', String(matches.length));
		if (matches.length === 0) {
			uiu.el(container, 'div', 'self_check_in_empty', ci18n('Self-Check-In: empty'));
			return;
		}

		const list = uiu.el(container, 'div', 'self_check_in_list');
		const grid = calc_self_check_in_grid(matches.length);
		const display_cols = grid.rows;
		const display_rows = grid.cols;
		const density = Math.max(display_cols, display_rows);
		let scale = Math.max(0.42, Math.min(1, 1.75 / density));
		if (display_cols === 2) {
			scale *= 1.5;
		} else if (display_cols === 1) {
			scale *= 2;
		}
		scale = Math.min(scale, 2);
		const chip_name_scale = Math.max(0.9, Math.min(1.75, 3 / display_rows));
		const chip_box_scale = Math.max(0.72, Math.min(1.6, 2.4 / display_rows));
		list.style.gridTemplateColumns = 'repeat(' + display_cols + ', minmax(0, 1fr))';
		list.style.gridTemplateRows = 'repeat(' + display_rows + ', minmax(0, 1fr))';
		list.style.setProperty('--self-check-in-scale', String(scale));
		list.style.setProperty('--self-check-in-chip-name-scale', String(chip_name_scale));
		list.style.setProperty('--self-check-in-chip-box-scale', String(chip_box_scale));
		matches.forEach((match) => render_self_check_in_match_card(list, match, false));
		schedule_fit_self_check_in_cards(list);
	}

	function show_self_check_in_called_match(match) {
		const container = document.querySelector('.self_check_in_container');
		if (!container || !match || !match.setup) {
			return;
		}

		const existing = container.querySelector('.self_check_in_called_overlay');
		if (existing) {
			existing.remove();
		}

		const overlay = uiu.el(container, 'div', 'self_check_in_called_overlay');
		const backdrop = uiu.el(overlay, 'div', 'self_check_in_called_overlay_backdrop');
		backdrop.addEventListener('click', () => overlay.remove());
		const card_host = uiu.el(overlay, 'div', 'self_check_in_called_overlay_host');
		render_self_check_in_match_card(card_host, match, false);
		const card = card_host.querySelector('.self_check_in_match');
		if (card) {
			card.classList.add('self_check_in_called_overlay_card');
			const status_el = card.querySelector('.self_check_in_match_status');
			if (status_el) {
				status_el.textContent = ci18n('Self-Check-In: called');
			}
			schedule_fit_self_check_in_cards(card);
		}

		if (self_check_in_called_overlay_timeout) {
			clearTimeout(self_check_in_called_overlay_timeout);
		}
		const overlay_duration_ms = Math.max(1000, Number(curt.self_check_in_called_overlay_duration_ms || 12000));
		self_check_in_called_overlay_timeout = setTimeout(() => {
			if (overlay.isConnected) {
				overlay.remove();
			}
			self_check_in_called_overlay_timeout = null;
		}, overlay_duration_ms);
	}

	function ui_upcoming() {
		current_view = 'upcoming';
		const main = ui_match_screens('t/:key/upcoming');
		render_upcoming(main);
	}

	function ui_current_matches() {
		current_view = 'current_matches';
		const main = ui_match_screens('t/:key/current_matches');
		render_current_matches(main);
	}

	function ui_next_matches() {
		current_view = 'next_matches';
		const main = ui_match_screens('t/:key/next_matches');
		render_next_matches(main);
	}

	function ui_self_check_in() {
		current_view = 'self_check_in';
		const main = ui_match_screens('t/:key/self_check_in', {
			enable_fullscreen_toggle: false,
			main_class: 'main_self_check_in',
		});
		const container = uiu.el(main, 'div', 'self_check_in_container');
		render_self_check_in(container);
	}

	function ui_match_screens(route, options) {
		options = options || {};
		crouting.set(route, { key: curt.key });
		toprow.hide();
		update_test_clock_body_state();
		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.remove('main_upcoming', 'main_self_check_in');
		main.classList.add(options.main_class || 'main_upcoming');
		main.onclick = null;
		if (options.enable_fullscreen_toggle !== false) {
			main.onclick = () => fullscreen.toggle();
		}
		return main;
	}

	function handle_view_announcement(kind, payload) {
		if (current_view === 'self_check_in') {
			if (kind === 'match_called_on_court') {
				show_self_check_in_called_match(payload);
			}
			return true;
		}
		return false;
	}

	_route_single(/t\/([a-z0-9]+)\/upcoming/, ui_upcoming, change.default_handler(_update_all_ui_elements_upcoming, {
		score: update_score,
		court_current_match: update_upcoming_current_match,
		match_edit: update_upcoming_match,
		update_player_status: update_player_status, 
	}));

	_route_single(/t\/([a-z0-9]+)\/current_matches/, ui_current_matches, change.default_handler(_update_all_ui_elements_current_matches, {
		score: update_score,
		court_current_match: update_upcoming_current_match,
		match_edit: update_upcoming_match,
		update_player_status: update_player_status,
	}));
	_route_single(/t\/([a-z0-9]+)\/next_matches/, ui_next_matches, change.default_handler(_update_all_ui_elements_next_matches, {
		score: update_score,
		court_current_match: update_upcoming_current_match,
		match_edit: update_upcoming_match,
		update_player_status: update_player_status,
	}));

	function _update_all_ui_elements_self_check_in() {
		render_self_check_in(uiu.qs('.self_check_in_container'));
	}

	function schedule_fit_self_check_in_cards(scope) {
		self_check_in_fit_roots.add(scope || document);
		if (self_check_in_fit_scheduled) {
			return;
		}
		self_check_in_fit_scheduled = true;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const cards = new Set();
				self_check_in_fit_roots.forEach((root) => {
					if (!root) {
						return;
					}
					if (root.classList && root.classList.contains('self_check_in_match')) {
						cards.add(root);
					}
					root.querySelectorAll?.('.self_check_in_match').forEach((card) => cards.add(card));
				});
				self_check_in_fit_roots.clear();
				self_check_in_fit_scheduled = false;
				cards.forEach((card) => {
					if (card && card.isConnected) {
						fit_self_check_in_card(card);
					}
				});
			});
		});
	}

	function schedule_self_check_in_resize_recalc() {
		if (current_view !== 'self_check_in') {
			return;
		}
		if (self_check_in_resize_frame) {
			cancelAnimationFrame(self_check_in_resize_frame);
		}
		self_check_in_resize_frame = requestAnimationFrame(() => {
			self_check_in_resize_frame = null;
			self_check_in_chip_fit_cache = Object.create(null);
			self_check_in_layout_fit_cache = new Map();
			const container = document.querySelector('.self_check_in_container');
			if (container) {
				render_self_check_in(container);
			}
		});
	}

	window.addEventListener('resize', schedule_self_check_in_resize_recalc);

	_route_single(/t\/([a-z0-9]+)\/self_check_in/, ui_self_check_in, change.default_handler(_update_all_ui_elements_self_check_in, {
		score: function(c) {
			const before_structure_signature = self_check_in_match_structure_signature(utils.find(curt.matches, m => m._id === c.val.match_id));
			const before_status_signature = self_check_in_match_status_signature(utils.find(curt.matches, m => m._id === c.val.match_id));
			update_score(c);
			rerender_self_check_in_if_needed(before_structure_signature, before_status_signature, c.val.match_id);
		},
		court_current_match: function(c) {
			const before_structure_signature = self_check_in_match_structure_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			const before_status_signature = self_check_in_match_status_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			update_upcoming_current_match(c);
			rerender_self_check_in_if_needed(before_structure_signature, before_status_signature, c.val.match__id);
		},
		match_edit: function(c) {
			const before_structure_signature = self_check_in_match_structure_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			const before_status_signature = self_check_in_match_status_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			update_match(c);
			rerender_self_check_in_if_needed(before_structure_signature, before_status_signature, c.val.match__id);
		},
		update_player_status: function(c) {
			const before_structure_signature = self_check_in_match_structure_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			const before_status_signature = self_check_in_match_status_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			update_player_status(c);
			rerender_self_check_in_if_needed(before_structure_signature, before_status_signature, c.val.match__id);
		},
		match_preparation_call: function(c) {
			const before_structure_signature = self_check_in_match_structure_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			const before_status_signature = self_check_in_match_status_signature(utils.find(curt.matches, m => m._id === c.val.match__id));
			const changed_match = c.val.match;
			const cur_match = utils.find(curt.matches, m => m._id === c.val.match__id);
			if (cur_match && changed_match) {
				cur_match.setup = changed_match.setup;
				cur_match.btp_winner = changed_match.btp_winner;
				cur_match.team1_won = changed_match.team1_won;
				cur_match.network_score = changed_match.network_score;
			}
			rerender_self_check_in_if_needed(before_structure_signature, before_status_signature, c.val.match__id);
		},
	}));


	function init() {
		send({
			type: 'tournament_list',
		}, function (err, response) {
			if (err) {
				return cerror.net(err);
			}

			const tournaments = response.tournaments;
			if (tournaments.length === 1) {
				switch_tournament(tournaments[0].key, ui_show);
			} else {
				list_show(tournaments);
			}
		});
	}
	crouting.register(/^$/, init, change.default_handler);

	function _cancel_ui_allscoresheets() {
		const dlg = document.querySelector('.allscoresheets_dialog');
		if (!dlg) {
			return; // Already cancelled
		}
		cbts_utils.esc_stack_pop();
		uiu.remove(dlg);
		ui_show();
	}

	function _pad(n, width, z) {
		z = z || '0';
		n = n + '';
		return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
	}


	function _render_scoresheet(task, pos, cb) {
		const {
			container,
			status,
			progress,
			matches,
			pseudo_state,
			tournament_name,
			zip } = task;

		if (pos >= matches.length) {
			return cb();
		}

		progress.value = pos;
		uiu.text(status, 'Rendere ' + (pos + 1) + ' / ' + (matches.length));

		const match = matches[pos];
		const setup = utils.deep_copy(match.setup);
		setup.tournament_name = curt.name;
		let s = null;
		try {
			s = calc.remote_state(pseudo_state, setup, match.presses);
		} catch (err) {
			console.error(`[bts] bulk scoresheet remote_state failed for #${setup.match_num || '?'} (${match._id})`, err);
			cerror.silent(`Scoresheet for #${setup.match_num || '?'} skipped: ${err.message}`);
			return render_next_scoresheet(task, pos + 1, cb);
		}
		s.ui = {};

		scoresheet.load_sheet(scoresheet.sheet_name(setup), function (xml) {
			var svg = scoresheet.make_sheet_node(s, xml);
			svg.setAttribute('class', 'scoresheet single_scoresheet');
			// Usually we'd call importNode here to import the document here, but IE/Edge then ignores the styles
			container.appendChild(svg);
			scoresheet.sheet_render(s, svg);

			const title = (
				tournament_name + ' ' + _pad(setup.match_num, 3, ' ') + ' ' +
				setup.event_name + ' ' + setup.match_name + ' ' +
				pronunciation.teamtext_internal(s, 0) + ' v ' +
				pronunciation.teamtext_internal(s, 1));
			const props = {
				title,
				subject: 'Schiedsrichterzettel',
				creator: 'bts with bup (https://github.com/phihag/bts/)',
			};
			const pdf = svg2pdf.make([svg], props, 'landscape');

			const ab = pdf.output('arraybuffer');
			zip.file(title.replace(/\s*\/\s*/g, ', ') + '.pdf', ab);

			uiu.empty(container);
			progress.value = pos + 1;
			setTimeout(function () {
				_render_scoresheet(task, pos + 1, cb);
			}, 0);
		}, '/bupdev/');
	}

	function get_admin_subpage() {
		const path = window.location.pathname;
		const parts = path.split('/').filter(Boolean); // Entfernt leere Einträge (z. B. durch führendes '/')
	
		// Erwartet: ['admin', 't', 'TurnierName', 'subpage?']
		if (parts.length < 3 || parts[0] !== 'admin' || parts[1] !== 't') {
			return null; // Nicht im erwarteten Admin-Pfad
		}
	
		const subpage = parts[3]; // Kann undefined sein
	
		switch (subpage) {
			case undefined:
				return 'tournament-control';
			default:
				return subpage;
		}
	}

	function ui_allscoresheets() {
		crouting.set('t/' + curt.key + '/allscoresheets', {}, _cancel_ui_allscoresheets);

		cbts_utils.esc_stack_push(_cancel_ui_allscoresheets);

		const body = uiu.qs('body');
		const dialog_bg = uiu.el(body, 'div', 'dialog_bg allscoresheets_dialog');
		const dialog = uiu.el(dialog_bg, 'div', 'dialog');

		uiu.el(dialog, 'h3', {}, 'Generiere Schiedsrichterzettel');

		const status = uiu.el(dialog, 'div', {}, 'Lade Daten ...');

		const progress = uiu.el(dialog, 'progress', {
			style: 'min-width: 60vw;',
		});
		send({
			type: 'fetch_allscoresheets_data',
			tournament_key: curt.key,
		}, function (err, response) {
			if (err) {
				return cerror.net(err);
			}

			const matches = response.matches;
			progress.max = matches.length;
			uiu.text(status, 'Starte Rendering (' + matches.length + ' Spiele)');

			const zip = new JSZip();
			const container = uiu.el(dialog, 'div', {
				'class': 'allscoresheets_svg_container',
			});
			printing.set_orientation('landscape');

			const lang = 'en';
			const pseudo_state = {
				settings: {
					shuttle_counter: true,
				},
				lang,
			};
			i18n.update_state(pseudo_state, lang);
			i18n.register_lang(i18n_de);
			i18n.register_lang(i18n_en);

			const task = {
				container,
				status,
				progress,
				matches,
				pseudo_state,
				tournament_name: curt.name,
				zip,
			};

			_render_scoresheet(task, 0, function () {
				uiu.text(status, 'Generiere Zip.');
				const zip_fn = curt.name + ' Schiedsrichterzettel.zip';
				zip.generateAsync({ type: 'blob' }).then(function (blob) {
					uiu.text(status, 'Starte  Download.');

					save_file(blob, zip_fn);
					uiu.text(status, 'Fertig.');
				}).catch(function (error) {
					uiu.text(status, 'Fehler: ' + error.stack);
				});
			});
		});

		const cancel_btn = uiu.el(dialog, 'div', 'vlink', 'Zurück');
		cancel_btn.addEventListener('click', _cancel_ui_allscoresheets);
	}
	crouting.register(/t\/([a-z0-9]+)\/allscoresheets$/, function (m) {
		ctournament.switch_tournament(m[1], function () {
			ui_allscoresheets();
		});
	}, change.default_handler(ui_allscoresheets));


	return {
		init,
		// For other modules
		switch_tournament,
		ui_show,
		ui_list,
		add_match,
		update_match,
		update_officials,
		update_upcoming_match,
		update_location_preparation_need_labels,
		update_logo,
		update_display,
		update_location,
		update_location_logo,
		update_edit_locations_and_courts,
		update_show_location_controls,
		update_court,
		update_emergency_btn,
		update_scoring_formats,
		update_stages_scoring_formats,
		apply_pending_official_role_override,
		set_pending_official_role_override,
		btp_status_changed,
		ticker_status_changed,
		bts_status_changed,
		remove_normalization,
		add_normalization,
		remove_advertisement,
		add_advertisement,
			update_general_displaysettings,
			update_metadata_settings,
			update_edit_dependencies,
			update_btp_settings_ui,
			update_show_tabletoperators,
			update_show_automation_controls,
			request_location_preparation_selections,
			update_test_clock_controls,
			close_scoring_format_dialog_if_open,
			refresh_current_view,
			handle_view_announcement,
			delete_display,
		};

})();

/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var calc = require('../bup/js/calc');
	var displaymode = require('../bup/js/displaymode');
	var cbts_utils = require('./cbts_utils');
	var ccsvexport = require('./ccsvexport');
	var cerror = require('./cerror');
	var change = require('./change');
	var ci18n = require('./ci18n');
	var cmatch = require('./cmatch');
	var crouting = require('./crouting');
	var cumpires = require('./cumpires');
	var ctabletoperator = require('./ctabletoperator');
	var debug = require('./debug');
	var form_utils = require('./form_utils');
	var i18n = require('../bup/js/i18n');
	var i18n_de = require('../bup/js/i18n_de');
	var i18n_en = require('../bup/js/i18n_en');
	var printing = require('../bup/js/printing');
	var pronunciation = require('../bup/js/pronunciation');
	var scoresheet = require('../bup/js/scoresheet');
	var svg2pdf = require('../bup/js/svg2pdf');
	var toprow = require('./toprow');
	var uiu = require('../bup/js/uiu');
	var utils = require('../bup/bup/js/utils.js');
	var save_file = require('../bup/bup/js/save_file.js');
	var timezones = require('./timezones.js');

	var JSZip = null; // External library

	module.exports = ctournament;
}
/*/@DEV*/
