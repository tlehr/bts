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
let accounting_tree_expansion_state = new Map();
let accounting_tree_search_value = '';
let accounting_tree_balance_filter = 'all';
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
			case 'registration_check':
				ui_registration_check();
				break;
			case 'registration_control':
				ui_registration_control();
				break;
			case 'accounting':
				ui_accounting();
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
			{
				label: 'Anmeldung',
				href: base_path + '/registration_check',
			}, {
				label: 'Meldungskontrolle',
				href: base_path + '/registration_control',
			}, {
				label: 'Buchhaltung',
				href: base_path + '/accounting',
			},
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
		const initialMaxPlace = Number(curt.certificate_export_max_place || 3);
		function normalize_certificate_age_class_splits_for_ui(value) {
			const result = {};
			if (!value || typeof value !== 'object') return result;
			Object.entries(value).forEach(([event_name, age_groups]) => {
				if (!event_name || !Array.isArray(age_groups)) return;
				const normalized = [...new Set(age_groups
					.map((age_group) => String(age_group || '').replace(/\s+/g, '').toUpperCase())
					.filter(Boolean))]
					.sort((a, b) => cbts_utils.natcmp(a, b));
				if (normalized.length > 0) {
					result[event_name] = normalized;
				}
			});
			return result;
			}
			let certificateAgeClassSplits = normalize_certificate_age_class_splits_for_ui(curt.certificate_age_class_splits);
			function normalize_certificate_discipline_code_for_ui(value) {
				const normalized = String(value || '').trim().toUpperCase();
				if (!normalized || normalized === '*' || normalized === 'ALL') return '';
				return normalized.replace(/\s+/g, '');
			}
				function normalize_certificate_discipline_replacements_for_ui(value) {
					if (!Array.isArray(value)) return [];
					return value
						.map((replacement) => ({
							discipline: normalize_certificate_discipline_code_for_ui(replacement?.discipline),
							replace: String(replacement?.replace || '').trim(),
						}))
						.filter((replacement) => replacement.discipline && replacement.replace);
				}
				let certificateDisciplineReplacements = normalize_certificate_discipline_replacements_for_ui(curt.certificate_discipline_replacements);
			const event_options = ccsvexport.get_certificate_event_options(curt.matches, {
			include_age_class_splits: true,
			max_place: initialMaxPlace,
			tournament: curt,
			certificate_age_class_splits: certificateAgeClassSplits,
		});
		const today = new Date(get_effective_test_clock_now_ms());
			let certificateSettingsSaveTimer = null;
			let pendingCertificateSettingsChanges = {};
			let refreshCertificateEventList = null;
			let updateCertificateEventStatuses = null;

			function save_certificate_export_settings(changes) {
				Object.assign(curt, changes);
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

			function get_certificate_export_discipline_codes() {
				const codes = new Set();
				function add_event_name(event_name) {
					const info = ccsvexport.parse_event_name(event_name);
					if (info.code) {
						codes.add(info.code);
					}
				}
				if (Array.isArray(curt.events?.events)) {
					curt.events.events.forEach((event) => add_event_name(event.name));
				} else if (Array.isArray(curt.events)) {
					curt.events.forEach((event) => add_event_name(event.name));
				}
				(curt.matches || []).forEach((match) => add_event_name(match?.setup?.event_name));
				return [...codes].sort((a, b) => cbts_utils.natcmp(a, b));
			}

			function render_certificate_discipline_select(parent, selected_value) {
				const select = uiu.el(parent, 'select', {
					style: 'max-width: 7em;',
				});
				const selected = normalize_certificate_discipline_code_for_ui(selected_value);
				const codes = get_certificate_export_discipline_codes();
				if (selected && !codes.includes(selected)) {
					codes.push(selected);
					codes.sort((a, b) => cbts_utils.natcmp(a, b));
				}
				codes.forEach((code) => {
					const attrs = { value: code };
					if (selected === code) {
						attrs.selected = 'selected';
					}
					uiu.el(select, 'option', attrs, code);
				});
				return select;
			}

				function save_certificate_discipline_replacements(next) {
					certificateDisciplineReplacements = normalize_certificate_discipline_replacements_for_ui(next);
					save_certificate_export_settings({
						certificate_discipline_replacements: certificateDisciplineReplacements,
					});
					if (updateCertificateEventStatuses) {
						updateCertificateEventStatuses();
					}
				}

		function certificate_age_class_split_enabled(event_name, age_group) {
			return (certificateAgeClassSplits[event_name] || []).includes(age_group);
		}

		function set_certificate_age_class_split(event_name, age_group, enabled) {
			const next = normalize_certificate_age_class_splits_for_ui(certificateAgeClassSplits);
			const selected = new Set(next[event_name] || []);
			if (enabled) {
				selected.add(age_group);
			} else {
				selected.delete(age_group);
			}
			const selected_list = [...selected].sort((a, b) => cbts_utils.natcmp(a, b));
			if (selected_list.length > 0) {
				next[event_name] = selected_list;
			} else {
				delete next[event_name];
			}
			certificateAgeClassSplits = next;
			save_certificate_export_settings({
				certificate_age_class_splits: next,
			});
			if (refreshCertificateEventList) {
				refreshCertificateEventList();
			}
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

			const locationLabel = uiu.el(form, 'label');
			locationLabel.style.display = 'block';
			locationLabel.style.marginBottom = '0.75em';
			uiu.el(locationLabel, 'span', {}, 'Ort');
			const locationInput = uiu.el(locationLabel, 'input', {
				type: 'text',
				name: 'ort',
				value: curt.certificate_export_location || '',
			});
			locationInput.style.display = 'block';
			locationInput.style.width = '100%';
			locationInput.style.boxSizing = 'border-box';

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

		const doubleSwappedLabel = uiu.el(form, 'label', {
			style: 'display: flex; gap: 0.5em; align-items: center; width: fit-content; clear: both; margin: 0.25em 0 1em 0;',
			title: 'Erzeugt fuer Doppelpaare zusaetzlich eine zweite Exportzeile mit vertauschter Spielerreihenfolge.',
		});
		const doubleSwappedInput = uiu.el(doubleSwappedLabel, 'input', {
			type: 'checkbox',
			name: 'certificate_export_double_swapped_entries_enabled',
		});
			if (curt.certificate_export_double_swapped_entries_enabled) {
				doubleSwappedInput.checked = true;
			}
			uiu.el(doubleSwappedLabel, 'span', {}, 'Doppel mit getauschten Spielern doppelt exportieren');

				const disciplineReplacementWrap = uiu.el(form, 'div', {
					style: 'margin: 0.25em 0 1em 0;',
				});

				function render_certificate_discipline_replacements() {
					while (disciplineReplacementWrap.firstChild) {
						disciplineReplacementWrap.removeChild(disciplineReplacementWrap.firstChild);
					}
					uiu.el(disciplineReplacementWrap, 'h4', {
						style: 'margin: 0 0 0.4em 0;',
					}, 'Disziplintexte');
					const table = uiu.el(disciplineReplacementWrap, 'table', {
						style: 'border-collapse: collapse;',
					});
					const tbody = uiu.el(table, 'tbody');
					const header = uiu.el(tbody, 'tr');
					uiu.el(header, 'th', {}, 'Disziplin');
					uiu.el(header, 'th', {}, 'Ersetzung');
					uiu.el(header, 'th', {}, '');
					certificateDisciplineReplacements.forEach((replacement, index) => {
						const row = uiu.el(tbody, 'tr');
						uiu.el(row, 'td', {
							style: 'padding-right: 0.4em;',
						}, replacement.discipline);
						uiu.el(row, 'td', {
							style: 'padding-right: 0.4em;',
						}, replacement.replace);
						const actionCell = uiu.el(row, 'td');
						const deleteBtn = uiu.el(actionCell, 'button', {
							type: 'button',
						}, 'Löschen');
						deleteBtn.addEventListener('click', () => {
							const next = certificateDisciplineReplacements.filter((_, replacementIndex) => replacementIndex !== index);
							save_certificate_discipline_replacements(next);
							render_certificate_discipline_replacements();
						});
					});
					const inputRow = uiu.el(tbody, 'tr');
					const disciplineCell = uiu.el(inputRow, 'td', {
						style: 'padding-right: 0.4em;',
					});
					const disciplineSelect = render_certificate_discipline_select(disciplineCell, '');
					const replaceCell = uiu.el(inputRow, 'td', {
						style: 'padding-right: 0.4em;',
					});
					const replaceInput = uiu.el(replaceCell, 'input', {
						type: 'text',
						placeholder: 'Ersetzung',
						style: 'width: 11em;',
					});
					const addCell = uiu.el(inputRow, 'td');
					const addBtn = uiu.el(addCell, 'button', {
						type: 'button',
					}, 'Hinzufügen');
					addBtn.addEventListener('click', () => {
						const normalized = normalize_certificate_discipline_replacements_for_ui([{
							discipline: disciplineSelect.value,
							replace: replaceInput.value,
						}]);
						if (normalized.length === 0) {
							return;
						}
						const next = certificateDisciplineReplacements
							.filter((replacement) => replacement.discipline !== normalized[0].discipline);
						next.push(normalized[0]);
						save_certificate_discipline_replacements(next);
						render_certificate_discipline_replacements();
					});
				}
				render_certificate_discipline_replacements();

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

			let eventCheckboxes = [];

			function get_certificate_event_options_for_dialog() {
				return ccsvexport.get_certificate_event_options(curt.matches, {
					include_age_class_splits: true,
					max_place: Number(countInput.value || 0) || initialMaxPlace,
					tournament: curt,
					certificate_age_class_splits: certificateAgeClassSplits,
				});
			}

			function render_certificate_event_list() {
				const previousChecked = new Map(eventCheckboxes.map((entry) => [
					entry.checkbox.getAttribute('data-certificate-key'),
					entry.checkbox.checked,
				]));
				eventCheckboxes = [];
				while (eventList.firstChild) {
					eventList.removeChild(eventList.firstChild);
				}
				get_certificate_event_options_for_dialog().forEach((event_option) => {
					const certificate_key = event_option.key || event_option.event_name;
					const checked = previousChecked.has(certificate_key)
						? previousChecked.get(certificate_key)
						: true;
					const row = uiu.el(eventList, 'div', {
						style: `display: flex; gap: 0.75em; align-items: flex-start; margin: 0.4em 0;${event_option.is_age_class_split ? ' padding-left: 1.8em;' : ''}`,
					});
					const selector = uiu.el(row, 'label', {
						style: 'display: flex; gap: 0.75em; align-items: flex-start; flex: 1 1 auto;',
					});
					const checkboxAttrs = {
						type: 'checkbox',
						'data-certificate-key': certificate_key,
					};
					if (checked) {
						checkboxAttrs.checked = 'checked';
					}
					const checkbox = uiu.el(selector, 'input', checkboxAttrs);
					const infoWrap = uiu.el(selector, 'div', { style: 'display: block; flex: 1 1 auto;' });
					const titleLine = uiu.el(infoWrap, 'div', {
						style: 'display: flex; flex-wrap: wrap; align-items: center; gap: 0.35em 0.4em;',
					});
					const titleText = uiu.el(titleLine, 'span', {}, event_option.label);
					const detailLine = uiu.el(infoWrap, 'div', {
						style: 'display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 0.4em; margin-top: 0.18em;',
					});
					if (!event_option.is_age_class_split && Array.isArray(event_option.age_class_candidates) && event_option.age_class_candidates.length > 0) {
						const splitLine = uiu.el(infoWrap, 'div', {
							style: 'display: flex; flex-wrap: wrap; align-items: center; gap: 0.35em 0.5em; margin-top: 0.18em; color: #333; font-size: 0.86em;',
						});
						splitLine.addEventListener('click', (event) => {
							event.stopPropagation();
						});
						uiu.el(splitLine, 'span', {}, 'Separate Wertung:');
						event_option.age_class_candidates.forEach((age_group) => {
							const splitLabel = uiu.el(splitLine, 'label', {
								style: 'display: inline-flex; gap: 0.3em; align-items: center;',
								title: `${age_group}-Urkundenwertung aus ${event_option.label} erzeugen`,
							});
							const splitInputAttrs = {
								type: 'checkbox',
							};
							if (certificate_age_class_split_enabled(event_option.event_name, age_group)) {
								splitInputAttrs.checked = 'checked';
							}
							const splitInput = uiu.el(splitLabel, 'input', splitInputAttrs);
							uiu.el(splitLabel, 'span', {}, age_group);
							splitInput.addEventListener('change', (event) => {
								event.stopPropagation();
								set_certificate_age_class_split(event_option.event_name, age_group, splitInput.checked);
							});
						});
					}
					const resetBtn = uiu.el(row, 'button', {
						type: 'button',
						style: 'margin-left: 0.5em;',
					}, 'Zurücksetzen');
					resetBtn.addEventListener('click', () => {
						send({
							type: 'certificate_export_reset',
							tournament_key: curt.key,
							event_name: certificate_key,
						}, (err, response) => {
							if (err) {
								return cerror.net(err);
							}
							curt.certificate_exports = response && response.certificate_exports ? response.certificate_exports : {};
							update_event_statuses();
						});
					});
					eventCheckboxes.push({
						checkbox,
						event_option,
						titleLine,
						titleText,
						detailLine,
						resetBtn,
					});
				});
			}

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

			function format_certificate_preview_tooltip(certificate_key, max_place, exported_at_display) {
				const rows = ccsvexport.build_certificate_rows(curt.matches, curt, {
					max_place,
					selected_certificate_keys: new Set([certificate_key]),
					ort: locationInput.value,
					certificate_export_double_swapped_entries_enabled: doubleSwappedInput.checked,
					certificate_discipline_replacements: certificateDisciplineReplacements,
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
					const certificate_key = event_option.key || event_option.event_name;
					const is_complete = ccsvexport.event_is_complete_for_max_place(event_option, max_place);
					const exported_at = export_state[certificate_key] || null;
					const exported_at_display = format_certificate_export_timestamp(exported_at);
					const available_places = ccsvexport.get_relevant_certificate_available_places(event_option, max_place).join(', ');
					const pending_place_ranges = ccsvexport.get_relevant_certificate_pending_ranges(event_option, max_place);
					entry.checkbox.dataset.complete = is_complete ? 'true' : 'false';
					entry.checkbox.dataset.exported = exported_at ? 'true' : 'false';
					entry.checkbox.dataset.kind = event_option.kind || '';
					entry.checkbox.dataset.latestScheduledDate = event_option.latest_scheduled_date || '';
					while (entry.titleLine.childNodes.length > 1) {
						entry.titleLine.removeChild(entry.titleLine.lastChild);
					}
					while (entry.detailLine.firstChild) {
						entry.detailLine.removeChild(entry.detailLine.firstChild);
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
						entry.detailLine,
						`Plätze: ${available_places || '—'}`,
						'certificate_export_badge_places'
					);
					if (event_option.starter_count) {
						render_status_badge(
							entry.detailLine,
							`Starter: ${event_option.starter_count}`,
							'certificate_export_badge_places'
						);
					}
					if (pending_place_ranges.length > 0) {
						render_status_badge(
							entry.detailLine,
							`Ausstehend: ${pending_place_ranges.map((range) => range.label || `${range.place_from}/${range.place_to}`).join(', ')}`,
							'certificate_export_badge_pending'
						);
					}
					if (event_option.latest_scheduled_date) {
						const latestDisplay = event_option.latest_scheduled_time
							? `${event_option.latest_scheduled_date} ${event_option.latest_scheduled_time}`
							: event_option.latest_scheduled_date;
						render_status_badge(
							entry.detailLine,
							`Letztes Spiel: ${latestDisplay}`,
							'certificate_export_badge_places'
						);
					}
					const previewTitle = format_certificate_preview_tooltip(
						certificate_key,
						max_place,
						exported_at ? exported_at_display : ''
					);
					entry.titleLine.title = previewTitle;
					entry.titleText.title = previewTitle;
					entry.checkbox.title = previewTitle;
				});
			}
			updateCertificateEventStatuses = update_event_statuses;

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

			refreshCertificateEventList = () => {
				render_certificate_event_list();
				update_event_statuses();
				apply_quick_filters();
			};

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
			locationInput.addEventListener('input', () => {
				schedule_certificate_export_settings_save({
					certificate_export_location: locationInput.value,
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
			doubleSwappedInput.addEventListener('change', () => {
				save_certificate_export_settings({
					certificate_export_double_swapped_entries_enabled: doubleSwappedInput.checked,
				});
				update_event_statuses();
			});
			refreshCertificateEventList();

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
				const selected_certificate_keys = new Set(
					eventCheckboxes
						.filter((entry) => entry.checkbox.checked)
						.map((entry) => entry.checkbox.getAttribute('data-certificate-key'))
						.filter(Boolean)
				);
				if (selected_certificate_keys.size === 0) {
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
							ort: locationInput.value,
							datum: dateInput.value,
							max_place: Number(countInput.value || 0),
						selected_certificate_keys,
						certificate_export_double_swapped_entries_enabled: doubleSwappedInput.checked,
							certificate_discipline_replacements: certificateDisciplineReplacements,
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
						certificate_export_location: locationInput.value,
						certificate_export_date: dateInput.value,
					certificate_export_max_place: Number(countInput.value || 0) || 3,
					certificate_export_double_swapped_entries_enabled: doubleSwappedInput.checked,
						certificate_discipline_replacements: certificateDisciplineReplacements,
				});
				send({
					type: 'certificate_export_mark',
					tournament_key: curt.key,
					event_names: [...selected_certificate_keys],
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
		main.classList.remove('main_upcoming', 'main_self_check_in', 'main_registration', 'main_registration_control', 'main_accounting');

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
		update_btp_events: update_show_registration_events,
		registration_player_status: update_registration_player_status,
		registration_player_status_reset: update_registration_player_status_reset,
		registration_open_events: update_registration_open_events,
		registration_player_comment: update_registration_player_comment,
		registration_player_comment_read: update_registration_player_comment_read,
		registration_stage_comment: update_registration_stage_comment,
		registration_stage_comment_read: update_registration_stage_comment_read,
		registration_xlsx_metadata: update_registration_xlsx_metadata,
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
		main.classList.remove('main_upcoming', 'main_self_check_in', 'main_registration', 'main_registration_control', 'main_accounting');

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

	function render_registration_tablet_preview(previewBody) {
		clear_preview_runtime_state(previewBody);
		uiu.empty(previewBody);
		const outer = uiu.el(previewBody, 'div', 'bup_preview_outer display_setting_registration_preview');
		const frame = uiu.el(outer, 'div', 'display_setting_registration_tablet');
		const screen = uiu.el(frame, 'div', 'display_setting_registration_screen');
		const page = uiu.el(screen, 'div', 'display_setting_registration_page');
		const header = uiu.el(page, 'div', 'display_setting_registration_header');
		uiu.el(header, 'h1', {}, 'Anmeldung');
		uiu.el(header, 'span', 'display_setting_registration_summary', '5 / 22 bearbeitet');
		const search = uiu.el(page, 'div', 'display_setting_registration_search', 'Name, Verein, Landesverband, Disziplin');
		search.setAttribute('aria-hidden', 'true');
		const filters = uiu.el(page, 'div', 'display_setting_registration_filters');
		[
			'JE U17 (14)',
			'BSC Hastedt (5)',
			'OT Bremen (4)',
			'Bremen (13)',
			'Niedersachsen (9)',
		].forEach((label) => {
			uiu.el(filters, 'span', 'display_setting_registration_chip', label);
		});
		const card = uiu.el(page, 'section', 'display_setting_registration_card');
		uiu.el(card, 'h2', {}, 'JE U17 - Hauptfeld (14)');
		[
			{ name: 'Adrian Rohr', detail: 'OT Bremen, Bremen', state: 'present' },
			{ name: 'Arne Berneisch', detail: 'Delmenhorster FC, Niedersachsen', state: 'absent', badge: 'Bereits angemeldet: JD U17' },
			{ name: 'Emil Ruder', detail: 'OT Bremen, Bremen', state: 'present' },
			{ name: 'Henri Voigt', detail: 'Delmenhorster FC, Niedersachsen' },
		].forEach((player) => {
			const row = uiu.el(card, 'div', 'display_setting_registration_row' + (player.state ? ' display_setting_registration_' + player.state : ''));
			const info = uiu.el(row, 'div', 'display_setting_registration_player');
			uiu.el(info, 'strong', {}, player.name);
			uiu.el(info, 'span', {}, player.detail);
			if (player.badge) {
				uiu.el(info, 'em', {}, player.badge);
			}
			const actions = uiu.el(row, 'div', 'display_setting_registration_actions');
			uiu.el(actions, 'span', 'display_setting_registration_note', '□');
			uiu.el(actions, 'span', 'display_setting_registration_ok', '✓');
			uiu.el(actions, 'span', 'display_setting_registration_no', '×');
		});
	}

	function render_display_setting_preview(previewBody, form, previewType = 'primary') {
		if (!previewBody) {
			return;
		}
		const previewSettings = create_displaysettings_object(Object.fromEntries(new FormData(form).entries()));
		const isRegistrationTabletMode =
			previewSettings.devicemode === 'umpire' &&
			previewSettings.tablet_mode === 'registration_check';
		previewBody.classList.toggle('display_setting_registration_preview_body', isRegistrationTabletMode);

		if (isRegistrationTabletMode) {
			render_registration_tablet_preview(previewBody);
			return;
		}

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
		const primaryLayout = createPreviewLayout('Spielauswahl', 'Vorschau', 'display_setting_primary_layout');
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
		const ALL_DEVICE_MODE_LABELS = [
			ci18n('display_setting:devicemode:umpire'),
			ci18n('display_setting:devicemode:display'),
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
			'registration_check',
		];
		const ALL_TABLET_MODE_LABELS = [
			ci18n('display_setting:tablet_mode:umpire'),
			ci18n('display_setting:tablet_mode:scorecard'),
			ci18n('display_setting:tablet_mode:registration_check'),
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
			display_setting.devicemode || '',
			ALL_DEVICE_MODE_LABELS
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
			const tabletModeInput = form.querySelector('[name="tablet_mode"]');
			const isRegistrationTabletMode = isTablet && tabletModeInput && tabletModeInput.value === 'registration_check';
			if (secondaryLayout.settingsTitleEl) {
				secondaryLayout.settingsTitleEl.textContent = isRegistrationTabletMode ? 'Anmeldung' : (isTablet ? 'Live-Spiel' : 'Anzeige');
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
			updateSecondarySectionMode();
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
		const isRegistrationTabletMode = !isDisplayMode && currentTabletMode === 'registration_check';
		const primarySection = form ? form.querySelector('.display_setting_primary_layout') : null;
		const technicalSection = form ? form.querySelector('.display_setting_technical_section') : null;
		if (primarySection) {
			uiu.visible(primarySection, !isRegistrationTabletMode);
		}
		if (technicalSection) {
			uiu.visible(technicalSection, !isRegistrationTabletMode);
		}
		const umpirePanelOnlyTabletFields = {
			show_announcements: true,
			negative_timers: true,
			shuttle_counter: true,
			editmode_doubleclick: true,
		};
		const registrationHiddenFields = {
			displaymode_style: true,
			displaymode_reverse_order: true,
			tournament_overview_courts: true,
			show_pause: true,
			show_court_number: true,
			show_competition: true,
			show_round: true,
			show_players: true,
			show_team_name: true,
			show_middle_name: true,
			abbreviate_first_name: true,
			show_doubles_receiving: true,
			team_colors: true,
			scale: true,
			show_announcements: true,
			neversettings: true,
			button_block_timeout: true,
			negative_timers: true,
			shuttle_counter: true,
			editmode_doubleclick: true,
			click_mode: true,
			style: true,
			language: true,
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
			} else if (isRegistrationTabletMode && registrationHiddenFields[field_name]) {
				isVisible = false;
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

	function get_registration_events(options = {}) {
		return (curt?.events?.events || [])
			.filter((event) => !options.only_open || (is_registration_event_open(event) && !is_registration_event_drawn(event)))
			.map((event) => ({
				...event,
				stages: registration_visible_stages(event, options),
			}))
			.filter((event) => event.stages.some((stage) => (stage.entries || []).length > 0));
	}

	function registration_visible_stages(event, options) {
		const stages = event.stages || [];
		const main_stages = stages.filter(is_registration_stage_main);
		if (!options.include_reserve) {
			return main_stages;
		}

		const main_entry_signatures = new Set();
		main_stages.forEach((stage) => {
			(stage.entries || []).forEach((entry) => {
				main_entry_signatures.add(registration_entry_signature(entry));
			});
		});

		const reserve_entries = [];
		const reserve_entry_signatures = new Set();
		stages
			.filter((stage) => is_registration_stage_reserve(stage) || is_registration_stage_secondary_reserve(stage))
			.forEach((stage) => {
				(stage.entries || []).forEach((entry) => {
					const signature = registration_entry_signature(entry);
					if (!signature || main_entry_signatures.has(signature) || reserve_entry_signatures.has(signature)) {
						return;
					}
					reserve_entry_signatures.add(signature);
					reserve_entries.push(entry);
				});
			});

		if (reserve_entries.length === 0) {
			return main_stages;
		}
		return [
			...main_stages,
			{
				id: 900000000 + Number(event.id || 0),
				name: 'Reserve',
				event_id: event.id,
				stage_type: 9998,
				display_order: 9998,
				entry_count: reserve_entries.length,
				entries: reserve_entries,
			},
		];
	}

	function registration_event_key(event) {
		return registration_key_part(event?.id ?? event?.key ?? event?.name);
	}

	function registration_key_part(value) {
		return String(value ?? '')
			.trim()
			.replace(/[^A-Za-z0-9:_-]/g, '_')
			.slice(0, 120);
	}

	function is_registration_event_open(event) {
		const open_events = curt?.registration_open_events;
		if (!open_events || typeof open_events !== 'object') {
			return false;
		}
		return open_events[registration_event_key(event)] === true;
	}

	function ensure_registration_open_events_initialized() {
		if (curt.registration_open_events && typeof curt.registration_open_events === 'object') {
			return;
		}
		curt.registration_open_events = {};
	}

	function set_registration_event_open(event, is_open) {
		const event_key = registration_event_key(event);
		if (!event_key) {
			return;
		}
		ensure_registration_open_events_initialized();
		if (is_open) {
			curt.registration_open_events[event_key] = true;
		} else {
			delete curt.registration_open_events[event_key];
		}
		send({
			type: 'registration_open_event',
			tournament_key: curt.key,
			event_key,
			is_open,
		}, function(err) {
			if (err) {
				cerror.net(err);
			}
		});
	}

	function registration_stage_rank(stage) {
		if (is_registration_stage_main(stage)) return 1;
		if (is_registration_stage_reserve(stage)) return 2;
		return 9;
	}

	function sorted_registration_stages(event) {
		return [...(event.stages || [])].sort((a, b) =>
			registration_stage_rank(a) - registration_stage_rank(b) ||
			Number(a.display_order || 0) - Number(b.display_order || 0) ||
			Number(a.id || 0) - Number(b.id || 0)
		);
	}

	function registration_stage_kind(stage) {
		if (is_registration_stage_main(stage)) return 'main';
		if (is_registration_stage_reserve(stage)) return 'reserve';
		return 'other';
	}

	function registration_entry_name(entry) {
		const players = entry?.team?.players || [];
		const name = players.map(person_display_name).filter(Boolean).join(' / ');
		return name || ('Meldung ' + (entry?.entry_id || '?'));
	}

	function registration_entry_detail(entry) {
		const players = entry?.team?.players || [];
		const details = players
			.map((player) => [player.club, player.state].filter(Boolean).join(', '))
			.filter(Boolean);
		return [...new Set(details)].join(' / ');
	}

	function registration_entry_values(entry, field) {
		const values = (entry?.team?.players || [])
			.map((player) => player && player[field])
			.filter(Boolean);
		return [...new Set(values)];
	}

	function registration_entry_signature(entry) {
		const players = entry?.team?.players || [];
		return players
			.map((player, index) =>
				player?.btp_id != null
					? 'id:' + String(player.btp_id)
					: 'name:' + registration_filter_text(person_display_name(player) || index)
			)
			.sort()
			.join('|');
	}

	function registration_player_values(events, field) {
		const values = [];
		events.forEach((event) => {
			sorted_registration_stages(event).forEach((stage) => {
				(stage.entries || []).forEach((entry) => {
					(entry?.team?.players || []).forEach((player) => {
						if (player && player[field]) {
							values.push(player[field]);
						}
					});
				});
			});
		});
		return values;
	}

	function registration_filter_text(value) {
		return String(value || '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');
	}

	function registration_entry_search_text(event, stage, entry) {
		return registration_filter_text([
			event.name,
			registration_stage_label(stage),
			registration_entry_name(entry),
			registration_entry_detail(entry),
			...registration_entry_values(entry, 'club'),
			...registration_entry_values(entry, 'state'),
		].join(' '));
	}

	function registration_player_search_text(event, stage, entry, player) {
		const player_index = (entry?.team?.players || []).indexOf(player);
		const control_comment = player_index >= 0 ? get_registration_player_comment(entry, player, player_index, 'control_to_check') : null;
		const check_comment = player_index >= 0 ? get_registration_player_comment(entry, player, player_index, 'check_to_control') : null;
		return registration_filter_text([
			event.name,
			registration_stage_label(stage),
			person_display_name(player),
			registration_entry_name(entry),
			registration_partner_label(entry, player_index),
			player?.club,
			player?.state,
			control_comment?.comment,
			check_comment?.comment,
		].join(' '));
	}

	function collect_registration_filter_counts(events, field) {
		const counts = new Map();
		registration_player_values(events, field).forEach((value) => {
			counts.set(value, (counts.get(value) || 0) + 1);
		});
		return [...counts.entries()]
			.sort((a, b) => a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }))
			.slice(0, 12);
	}

	function collect_registration_event_filter_counts(events) {
		return events
			.map((event) => [
				event.name || registration_event_key(event),
				sorted_registration_stages(event).reduce((sum, stage) =>
					sum + (stage.entries || []).reduce((entry_sum, entry) =>
						entry_sum + (entry?.team?.players || []).length, 0), 0),
			])
			.filter(([label]) => !!label)
			.sort((a, b) => a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }));
	}

	function registration_stage_label(stage) {
		if (is_registration_stage_main(stage)) return 'Hauptfeld';
		if (is_registration_stage_reserve(stage)) return 'Reserve';
		return stage.name || 'Liste';
	}

	function is_registration_event_drawn(event) {
		if (event?.is_drawn === true || Number(event?.match_count || 0) > 0) {
			return true;
		}
		const event_name = String(event?.name || '');
		if (!event_name || !Array.isArray(curt?.matches)) {
			return false;
		}
		return curt.matches.some((match) => {
			const match_event_name = String(match?.setup?.event_name || '');
			return match_event_name === event_name || match_event_name.startsWith(event_name + ' - ');
		});
	}

	function registration_stage_name_text(stage) {
		return registration_filter_text([stage?.name, stage?.stage_name].filter(Boolean).join(' '));
	}

	function is_registration_stage_main(stage) {
		const type = Number(stage?.stage_type);
		const name = registration_stage_name_text(stage);
		return type === 1 || name.includes('hauptfeld') || name.includes('main');
	}

	function is_registration_stage_reserve(stage) {
		const type = Number(stage?.stage_type);
		const name = registration_stage_name_text(stage);
		return type === 9998 || name.includes('reserve');
	}

	function is_registration_stage_excluded(stage) {
		const type = Number(stage?.stage_type);
		const name = registration_stage_name_text(stage);
		return type === 9999 || name.includes('aussch') || name.includes('exclud');
	}

	function is_registration_stage_secondary_reserve(stage) {
		return !is_registration_stage_main(stage) &&
			!is_registration_stage_excluded(stage) &&
			!is_registration_stage_reserve(stage);
	}

	function registration_player_status_key(entry, player, player_index) {
		const player_id = player?.btp_id != null ? player.btp_id : player_index;
		return String(entry?.stage_entry_id || entry?.entry_id || 'entry') + ':' + String(player_id);
	}

	function registration_status_matches_player(status, player) {
		if (player?.btp_id != null && status?.player_id != null && status.player_id !== '') {
			if (String(status.player_id) === String(player.btp_id)) {
				return true;
			}
		}
		const player_name = registration_filter_text(person_display_name(player));
		return !!player_name && registration_filter_text(status?.player_name || '') === player_name;
	}

	function registration_other_present_events(event, entry, player, player_index) {
		const current_key = registration_player_status_key(entry, player, player_index);
		const current_event_name = String(event?.name || '');
		const labels = new Set();
		Object.entries(curt?.registration_player_statuses || {}).forEach(([key, status]) => {
			if (!status || status.status !== 'present' || key === current_key) {
				return;
			}
			if (!registration_status_matches_player(status, player)) {
				return;
			}
			const event_name = String(status.event_name || '');
			if (!event_name || event_name === current_event_name) {
				return;
			}
			labels.add(event_name);
		});
		return [...labels].sort((a, b) => a.localeCompare(b, 'de'));
	}

	function update_registration_other_present_badge(row) {
		const badge = row.querySelector('.registration_entry_other_present');
		if (!badge || !row._registration_event || !row._registration_entry || !row._registration_player) {
			return;
		}
		const labels = registration_other_present_events(
			row._registration_event,
			row._registration_entry,
			row._registration_player,
			Number(row.getAttribute('data-player-index') || 0)
		);
		badge.hidden = labels.length === 0;
		uiu.text(badge, labels.length === 0 ? '' : 'Bereits angemeldet: ' + labels.join(', '));
	}

	function update_registration_other_present_badges(scope) {
		(scope || document).querySelectorAll('.registration_player_check').forEach(update_registration_other_present_badge);
	}

	function registration_stage_comment_key(event, stage) {
		const event_key = registration_event_key(event);
		if (!stage) {
			return (event_key || 'event') + ':discipline';
		}
		const stage_key = registration_key_part(stage?.id ?? stage?.stage_id ?? stage?.name ?? stage?.stage_name ?? stage?.stage_type);
		return (event_key || 'event') + ':stage_' + (stage_key || 'stage');
	}

	function get_registration_player_status(entry, player, player_index) {
		const key = registration_player_status_key(entry, player, player_index);
		const saved = curt?.registration_player_statuses?.[key];
		const status = saved && saved.status;
		return ['present', 'absent'].includes(status) ? status : '';
	}

	function registration_player_status_payload(event, stage, entry, player, player_index, status) {
		const player_id = player?.btp_id != null ? player.btp_id : player_index;
		return {
			stage_entry_id: entry?.stage_entry_id || null,
			entry_id: entry?.entry_id || null,
			entry_name: registration_entry_name(entry),
			player_id,
			player_index,
			player_name: person_display_name(player),
			event_name: event?.name || '',
			stage_id: stage?.id || null,
			stage_name: stage?.name || '',
			stage_type: Number(stage?.stage_type),
			club: player?.club || '',
			state: player?.state || '',
			partner: registration_partner_label(entry, player_index),
			status,
		};
	}

	function get_registration_player_comment(entry, player, player_index, direction) {
		const key = registration_player_status_key(entry, player, player_index);
		const comment = curt?.registration_player_comments?.[key]?.[direction];
		if (!comment || !comment.comment) {
			return null;
		}
		return comment;
	}

	function get_registration_stage_comment(event, stage, direction) {
		const key = registration_stage_comment_key(event, stage);
		const comment = curt?.registration_stage_comments?.[key]?.[direction];
		if (!comment || !comment.comment) {
			return null;
		}
		return comment;
	}

	function registration_player_comment_payload(event, stage, entry, player, player_index, comment) {
		const player_id = player?.btp_id != null ? player.btp_id : player_index;
		return {
			stage_entry_id: entry?.stage_entry_id || null,
			entry_id: entry?.entry_id || null,
			entry_name: registration_entry_name(entry),
			player_id,
			player_index,
			player_name: person_display_name(player),
			event_name: event?.name || '',
			stage_id: stage?.id || null,
			stage_name: stage?.name || '',
			stage_type: Number(stage?.stage_type),
			club: player?.club || '',
			state: player?.state || '',
			partner: registration_partner_label(entry, player_index),
			comment,
		};
	}

	function registration_stage_comment_payload(event, stage, comment) {
		return {
			event_id: event?.id || null,
			event_name: event?.name || '',
			stage_id: stage?.id || null,
			stage_name: stage?.name || '',
			stage_type: Number(stage?.stage_type),
			stage_label: stage ? registration_stage_label(stage) : 'Disziplin',
			comment,
		};
	}

	function set_registration_player_comment(event, stage, entry, player, player_index, direction, comment) {
		const key = registration_player_status_key(entry, player, player_index);
		const normalized_comment = String(comment || '').trim();
		if (!curt.registration_player_comments) {
			curt.registration_player_comments = {};
		}
		if (!curt.registration_player_comments[key]) {
			curt.registration_player_comments[key] = {};
		}
		if (normalized_comment) {
			curt.registration_player_comments[key][direction] = {
				key,
				comment: normalized_comment,
				read: false,
				read_at: null,
				...registration_player_comment_payload(event, stage, entry, player, player_index, normalized_comment),
			};
		} else {
			delete curt.registration_player_comments[key][direction];
			if (Object.keys(curt.registration_player_comments[key]).length === 0) {
				delete curt.registration_player_comments[key];
			}
		}
		send({
			type: 'registration_player_comment',
			tournament_key: curt.key,
			key,
			direction,
			comment: normalized_comment,
			registration_comment: registration_player_comment_payload(event, stage, entry, player, player_index, normalized_comment),
		}, function(err) {
			if (err) {
				cerror.net(err);
			}
		});
	}

	function mark_registration_player_comment_read(key, direction) {
		if (curt.registration_player_comments?.[key]?.[direction]) {
			curt.registration_player_comments[key][direction].read = true;
		}
		send({
			type: 'registration_player_comment_read',
			tournament_key: curt.key,
			key,
			direction,
		}, function(err) {
			if (err) {
				cerror.net(err);
			}
		});
	}

	function set_registration_stage_comment(event, stage, direction, comment) {
		const key = registration_stage_comment_key(event, stage);
		const normalized_comment = String(comment || '').trim();
		if (!curt.registration_stage_comments) {
			curt.registration_stage_comments = {};
		}
		if (!curt.registration_stage_comments[key]) {
			curt.registration_stage_comments[key] = {};
		}
		if (normalized_comment) {
			curt.registration_stage_comments[key][direction] = {
				key,
				comment: normalized_comment,
				read: false,
				read_at: null,
				...registration_stage_comment_payload(event, stage, normalized_comment),
			};
		} else {
			delete curt.registration_stage_comments[key][direction];
			if (Object.keys(curt.registration_stage_comments[key]).length === 0) {
				delete curt.registration_stage_comments[key];
			}
		}
		send({
			type: 'registration_stage_comment',
			tournament_key: curt.key,
			key,
			direction,
			comment: normalized_comment,
			registration_comment: registration_stage_comment_payload(event, stage, normalized_comment),
		}, function(err) {
			if (err) {
				cerror.net(err);
			}
		});
	}

	function mark_registration_stage_comment_read(key, direction) {
		if (curt.registration_stage_comments?.[key]?.[direction]) {
			curt.registration_stage_comments[key][direction].read = true;
		}
		send({
			type: 'registration_stage_comment_read',
			tournament_key: curt.key,
			key,
			direction,
		}, function(err) {
			if (err) {
				cerror.net(err);
			}
		});
	}

	function set_registration_player_status(event, stage, entry, player, player_index, status) {
		const key = registration_player_status_key(entry, player, player_index);
		if (!curt.registration_player_statuses) {
			curt.registration_player_statuses = {};
		}
		if (status) {
			curt.registration_player_statuses[key] = {
				key,
				status,
				...registration_player_status_payload(event, stage, entry, player, player_index, status),
			};
		} else {
			delete curt.registration_player_statuses[key];
		}
		send({
			type: 'registration_player_status',
			tournament_key: curt.key,
			key,
			status,
			registration_status: registration_player_status_payload(event, stage, entry, player, player_index, status),
		}, function(err) {
			if (err) {
				cerror.net(err);
			}
		});
	}

	function reset_registration_player_statuses() {
		curt.registration_player_statuses = {};
		send({
			type: 'registration_player_status_reset',
			tournament_key: curt.key,
		}, function(err) {
			if (err) {
				cerror.net(err);
			}
		});
		if (current_view === 'registration_control') {
			ui_registration_control();
		}
	}

	function registration_player_detail(player) {
		return [player?.club, player?.state].filter(Boolean).join(', ');
	}

	function registration_partner_label(entry, player_index) {
		const players = entry?.team?.players || [];
		if (players.length < 2) {
			return '';
		}
		return 'Doppel: ' + players
			.map((player, index) => index === player_index ? null : person_display_name(player))
			.filter(Boolean)
			.join(' / ');
	}

	function registration_accounting_player_id(player, fallback) {
		if (player?.btp_id !== undefined && player?.btp_id !== null && String(player.btp_id) !== '') {
			return String(player.btp_id);
		}
		return 'local_' + registration_key_part(person_display_name(player) || fallback || 'player');
	}

	function registration_accounting_entries() {
		return Array.isArray(curt?.accounting_entries) ? curt.accounting_entries : [];
	}

	function registration_accounting_items() {
		return Array.isArray(curt?.accounting_items) ? curt.accounting_items : [];
	}

	function registration_accounting_documents() {
		return Array.isArray(curt?.accounting_documents) ? curt.accounting_documents : [];
	}

	function registration_btp_payments() {
		return Array.isArray(curt?.btp_payments?.payments) ? curt.btp_payments.payments : [];
	}

	function registration_money_number(value) {
		const number = Number(String(value ?? '').replace(',', '.'));
		return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
	}

	function registration_money_label(value) {
		return registration_money_number(value).toLocaleString('de-DE', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}) + ' EUR';
	}

	function accounting_item_sale_unit(item) {
		return String(item?.sale_unit || item?.unit || 'Stk.').trim() || 'Stk.';
	}

	function accounting_item_billing_type(item) {
		const type = String(item?.billing_type || '').trim();
		if (['optional', 'required_player', 'required_discipline'].includes(type)) {
			return type;
		}
		if (type === 'required') {
			return 'required_player';
		}
		return item?.required ? 'required_player' : 'optional';
	}

	function accounting_item_billing_label(item) {
		const type = accounting_item_billing_type(item);
		if (type === 'required_player') {
			return 'Pflichtartikel je Spieler';
		}
		if (type === 'required_discipline') {
			return 'Pflichtartikel je Disziplin';
		}
		return 'Optionaler Artikel';
	}

	function accounting_item_overview_category(item) {
		return String(item?.overview_category || '') === 'fee' ? 'fee' : 'item';
	}

	function accounting_item_overview_label(item) {
		return accounting_item_overview_category(item) === 'fee' ? 'Meldegeld' : 'Artikel';
	}

	function accounting_account_key(account_type, account_id) {
		return String(account_type || 'player') + ':' + String(account_id || '');
	}

	function accounting_club_id(club) {
		return 'club_' + registration_key_part(club || 'verein');
	}

	function accounting_state_id(state) {
		return 'state_' + registration_key_part(state || 'bundesland');
	}

	function accounting_entry_buyer_type(entry) {
		const type = String(entry?.buyer_type || '').trim();
		if (['player', 'club', 'state', 'none'].includes(type)) {
			return type;
		}
		return 'player';
	}

	function accounting_entry_buyer_id(entry) {
		const buyer_type = accounting_entry_buyer_type(entry);
		if (buyer_type === 'none') {
			return 'none';
		}
		return String(entry?.buyer_id || entry?.player_id || '').trim();
	}

	function accounting_account_label(account) {
		if (account?.account_type === 'none') {
			return 'Ohne Käufer';
		}
		return account?.display_name || account?.buyer_name || account?.player_name || account?.club || account?.state || account?.account_id || '';
	}

	const accounting_entry_fee_modes = {
		registered: {
			label: 'Je gemeldeter Disziplin',
			short_label: 'gemeldet',
		},
		main_draw: {
			label: 'Je Disziplin im Hauptfeld',
			short_label: 'Hauptfeld',
		},
		main_draw_with_excluded: {
			label: 'Je Disziplin im Hauptfeld + Ausschlussliste',
			short_label: 'Hauptfeld + Ausschluss',
		},
		drawn: {
			label: 'Je Teilnahme (ausgelost)',
			short_label: 'ausgelost',
		},
	};

	const accounting_invoice_treatment_modes = {
		unpaid: 'nicht gezahlt',
		paid: 'gezahlt',
	};

	const accounting_document_signature_modes = {
		stamp: 'Unterschrift & Stempel',
		signature: 'Unterschrift',
		none: 'Nicht anzeigen',
	};

	const accounting_payment_default_details = {
		recipient: 'Bremer Badminton Verband e.V.',
		bank: 'Die Sparkasse Bremen AG',
		iban: 'DE33 2905 0101 0082 3932 81',
		bic: 'SBREDE22XXX',
		due_days: 14,
	};

	const accounting_letterhead_default_layout = {
		first: {
			address: { x: 20, y: 64, width: 95, height: 25 },
			document_title: { x: 20, y: 94, width: 95, height: 9 },
			document_number: { x: 20, y: 105, width: 70, height: 5 },
			document_date: { x: 20, y: 111, width: 70, height: 5 },
			event_title: { x: 20, y: 116, width: 168, height: 7 },
			content: { x: 20, y: 126, width: 168, height: 129 },
			footer: { x: 155, y: 278, width: 35, height: 8 },
		},
		follow: {
			content: { x: 20, y: 55, width: 168, height: 205 },
			footer: { x: 155, y: 278, width: 35, height: 8 },
		},
	};

	const accounting_letterhead_page_labels = {
		first: 'Erste Seite',
		follow: 'Folgeseiten',
	};

	const accounting_letterhead_area_labels = {
		address: 'Adresse',
		document_title: 'Überschrift',
		document_number: 'Nummer',
		document_date: 'Datum',
		event_title: 'Veranstaltung',
		content: 'Druckbereich',
		footer: 'Seitenzahl',
	};

	const accounting_letterhead_area_fields = {
		address: [
			['x', 'X'],
			['y', 'Y'],
			['width', 'Breite'],
			['height', 'Höhe'],
		],
		content: [
			['x', 'X'],
			['y', 'Y'],
			['width', 'Breite'],
			['height', 'Höhe'],
		],
		document_title: [
			['x', 'X'],
			['y', 'Y'],
		],
		document_number: [
			['x', 'X'],
			['y', 'Y'],
		],
		document_date: [
			['x', 'X'],
			['y', 'Y'],
		],
		event_title: [
			['x', 'X'],
			['y', 'Y'],
		],
		footer: [
			['x', 'X'],
			['y', 'Y'],
		],
	};

	const accounting_letterhead_preview_font_sizes = {
		address: 10,
		document_title: 19,
		document_number: 10,
		document_date: 9,
		event_title: 12,
		content: 9,
		footer: 8,
	};

	const accounting_letterhead_preview_bold_areas = new Set([
		'address',
		'document_title',
		'document_number',
		'event_title',
		'content',
	]);

	function accounting_entry_fee_mode() {
		const mode = String(curt?.accounting_entry_fee_mode || '');
		return accounting_entry_fee_modes[mode] ? mode : 'main_draw';
	}

	function accounting_invoice_treatment_mode() {
		const mode = String(curt?.accounting_invoice_treatment || '');
		return accounting_invoice_treatment_modes[mode] ? mode : 'unpaid';
	}

	function accounting_payment_settings() {
		const due_days = Number(curt?.accounting_invoice_due_days);
		const signature_mode = accounting_document_signature_modes[curt?.accounting_document_signature_mode]
			? curt.accounting_document_signature_mode
			: (curt?.accounting_document_stamp_enabled === true ? 'stamp' : 'signature');
		return {
			recipient: String(curt?.accounting_payment_recipient || accounting_payment_default_details.recipient).trim(),
			bank: String(curt?.accounting_payment_bank || accounting_payment_default_details.bank).trim(),
			iban: String(curt?.accounting_payment_iban || accounting_payment_default_details.iban).trim(),
			bic: String(curt?.accounting_payment_bic || accounting_payment_default_details.bic).trim(),
			due_days: Number.isFinite(due_days) && due_days >= 0 ? Math.round(due_days) : accounting_payment_default_details.due_days,
			signature_mode,
			stamp_enabled: signature_mode === 'stamp',
			event_period_enabled: curt?.accounting_event_period_enabled === true,
			event_period_text: String(curt?.accounting_event_period_text || '').trim(),
		};
	}

	function accounting_format_date_label(value) {
		const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!match) {
			return '';
		}
		return match[3] + '.' + match[2] + '.' + match[1];
	}

	function accounting_automatic_event_period_label() {
		const dates = Array.from(new Set((curt?.matches || [])
			.map((match) => String(match?.setup?.scheduled_date || '').slice(0, 10))
			.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))))
			.sort();
		if (dates.length === 0) {
			return '';
		}
		const first = accounting_format_date_label(dates[0]);
		const last = accounting_format_date_label(dates[dates.length - 1]);
		return first === last ? first : first + ' - ' + last;
	}

	function accounting_event_period_label() {
		const settings = accounting_payment_settings();
		if (!settings.event_period_enabled) {
			return '';
		}
		return settings.event_period_text || accounting_automatic_event_period_label();
	}

	function accounting_first_page_number_enabled() {
		return curt?.accounting_letterhead_first_page_number_enabled !== false;
	}

	function accounting_entry_counts_for_fee(event, stage, entry, mode) {
		if (mode === 'registered') {
			return true;
		}
		if (mode === 'main_draw_with_excluded') {
			return is_registration_stage_main(stage) ||
				is_registration_stage_excluded(stage);
		}
		if (mode === 'drawn') {
			return is_registration_stage_main(stage) && is_registration_event_drawn(event);
		}
		return is_registration_stage_main(stage);
	}

	function set_accounting_entry_fee_mode(mode) {
		if (!accounting_entry_fee_modes[mode]) {
			return;
		}
		curt.accounting_entry_fee_mode = mode;
		send_single_prop('accounting_entry_fee_mode', mode, function(err) {
			if (err) {
				return cerror.net(err);
			}
			if (current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function set_accounting_invoice_treatment_mode(mode) {
		if (!accounting_invoice_treatment_modes[mode]) {
			return;
		}
		curt.accounting_invoice_treatment = mode;
		send_single_prop('accounting_invoice_treatment', mode, function(err) {
			if (err) {
				return cerror.net(err);
			}
			if (current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function normalize_accounting_document_code(value) {
		return String(value || '')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toUpperCase()
			.replace(/[^A-Z0-9]+/g, '')
			.slice(0, 16);
	}

	function set_accounting_document_code(input) {
		const previous_code = String(curt?.accounting_document_code || '');
		const next_code = normalize_accounting_document_code(input.value);
		if (next_code === previous_code) {
			input.value = next_code;
			return;
		}
		if (
			registration_accounting_documents().length > 0 &&
			!confirm('Rechnungskürzel ändern? Bereits erstellte Dokumentnummern bleiben unverändert. Neue Rechnungen und Quittungen verwenden das neue Kürzel.')
		) {
			input.value = previous_code;
			return;
		}
		curt.accounting_document_code = next_code;
		input.value = next_code;
		send_single_prop('accounting_document_code', next_code, function(err) {
			if (err) {
				curt.accounting_document_code = previous_code;
				input.value = previous_code;
				cerror.net(err);
			}
		});
	}

	function render_accounting_payment_settings(parent) {
		const settings = accounting_payment_settings();
		const form = uiu.el(parent, 'form', 'accounting_payment_settings');
		uiu.el(form, 'h2', {}, 'Rechnung');
		const fields = uiu.el(form, 'div', 'accounting_payment_settings_fields');
		function add_field(name, label, value, attrs = {}) {
			const field = uiu.el(fields, 'label', 'accounting_payment_settings_field');
			uiu.el(field, 'span', {}, label);
			return uiu.el(field, 'input', {
				name,
				value,
				autocomplete: 'off',
				spellcheck: 'false',
				...attrs,
			});
		}
		function add_select(name, label, options, selected_value) {
			const field = uiu.el(fields, 'label', 'accounting_payment_settings_field');
			uiu.el(field, 'span', {}, label);
			const select = uiu.el(field, 'select', { name });
			Object.entries(options).forEach(([value, option_label]) => {
				const attrs = { value };
				if (value === selected_value) {
					attrs.selected = 'selected';
				}
				uiu.el(select, 'option', attrs, option_label);
			});
			return select;
		}
		const recipient = add_field('accounting_payment_recipient', 'Empfänger', settings.recipient, { maxlength: '200' });
		const bank = add_field('accounting_payment_bank', 'Bank', settings.bank, { maxlength: '200' });
		const iban = add_field('accounting_payment_iban', 'IBAN', settings.iban, { maxlength: '80' });
		const bic = add_field('accounting_payment_bic', 'BIC', settings.bic, { maxlength: '40' });
		const due_days = add_field('accounting_invoice_due_days', 'Zahlungsfrist (Tage)', String(settings.due_days), {
			type: 'number',
			min: '0',
			max: '365',
			step: '1',
		});
		const period_enabled_label = uiu.el(fields, 'label', 'accounting_payment_settings_field accounting_payment_settings_checkbox');
		const period_enabled_attrs = {
			type: 'checkbox',
			name: 'accounting_event_period_enabled',
		};
		if (settings.event_period_enabled) {
			period_enabled_attrs.checked = 'checked';
		}
		const event_period_enabled = uiu.el(period_enabled_label, 'input', period_enabled_attrs);
		uiu.el(period_enabled_label, 'span', {}, 'Veranstaltungszeitraum anzeigen');
		const auto_period = accounting_automatic_event_period_label();
		const event_period_text = add_field(
			'accounting_event_period_text',
			auto_period ? 'Veranstaltungszeitraum (leer = ' + auto_period + ')' : 'Veranstaltungszeitraum',
			settings.event_period_text,
			{
				maxlength: '120',
				placeholder: auto_period || 'z.B. 20.09.2026 - 21.09.2026',
				},
			);
		const signature_mode = add_select(
			'accounting_document_signature_mode',
			'Unterschriftfeld',
			accounting_document_signature_modes,
			settings.signature_mode,
		);
		const actions = uiu.el(form, 'div', 'accounting_payment_settings_actions');
		const status = uiu.el(actions, 'span', 'accounting_payment_settings_status', '');
		uiu.el(actions, 'button', { type: 'submit' }, 'Speichern');
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			const next_due_days = Math.round(Number(due_days.value));
			if (!Number.isFinite(next_due_days) || next_due_days < 0 || next_due_days > 365) {
				uiu.text(status, 'Zahlungsfrist muss zwischen 0 und 365 Tagen liegen.');
				due_days.focus();
				return;
			}
			const props = {
				accounting_payment_recipient: recipient.value.trim(),
				accounting_payment_bank: bank.value.trim(),
					accounting_payment_iban: iban.value.trim(),
					accounting_payment_bic: bic.value.trim(),
					accounting_invoice_due_days: next_due_days,
					accounting_document_signature_mode: signature_mode.value,
					accounting_document_stamp_enabled: signature_mode.value === 'stamp',
					accounting_event_period_enabled: event_period_enabled.checked,
					accounting_event_period_text: event_period_text.value.trim(),
				};
			Object.assign(curt, props);
			uiu.text(status, 'Speichert...');
			send_with_live_status({
				type: 'tournament_edit_props',
				key: curt.key,
				props,
			}, (err) => {
				if (err) {
					uiu.text(status, 'Fehler beim Speichern.');
					cerror.net(err);
					return;
				}
				due_days.value = String(next_due_days);
				uiu.text(status, 'Gespeichert.');
			});
		});
	}

	function collect_registration_accounting_accounts() {
		const fee_mode = accounting_entry_fee_mode();
		const accounts = new Map();
		const ensure_account = (account_type, account_id, data) => {
			data = data || {};
			const type = String(account_type || 'player');
			const id = String(account_id || '').trim();
			if (!id) {
				return null;
			}
			const key = accounting_account_key(type, id);
			if (!accounts.has(key)) {
				accounts.set(key, {
					account_type: type,
					account_id: id,
					player_id: type === 'player' ? id : '',
					player: data.player || null,
					player_name: data.player_name || (data.player ? person_display_name(data.player) : ''),
					buyer_name: data.buyer_name || '',
					display_name: data.display_name || data.buyer_name || data.player_name || '',
					club: data.club || '',
					state: data.state || '',
					fee_items: [],
					mandatory_items: [],
					btp_payments: [],
					local_entries: [],
					fee_total: 0,
					mandatory_charge_total: 0,
					local_charge_total: 0,
					btp_paid_total: 0,
					local_paid_total: 0,
					overview_fee_total: 0,
					overview_item_total: 0,
				});
			}
			const account = accounts.get(key);
			if (!account.player_name && data.player) {
				account.player_name = person_display_name(data.player);
			}
			if (!account.display_name) {
				account.display_name = data.display_name || data.buyer_name || account.player_name || '';
			}
			if (!account.buyer_name && data.buyer_name) {
				account.buyer_name = data.buyer_name;
			}
			if (!account.player && data.player) {
				account.player = data.player;
			}
			if (!account.club && data.club) {
				account.club = data.club;
			}
			if (!account.state && data.state) {
				account.state = data.state;
			}
			return account;
		};
		const ensure_player_account = (player, fallback) => ensure_account('player', registration_accounting_player_id(player, fallback), {
			player,
			player_name: person_display_name(player),
			display_name: person_display_name(player),
			club: player?.club || '',
			state: player?.state || '',
		});
		const clubs = new Map();
		const states = new Map();
		const remember_buyer_groups = (player) => {
			const club = String(player?.club || '').trim();
			if (club) {
				clubs.set(accounting_club_id(club), {
					display_name: club,
					buyer_name: club,
					club,
					state: player?.state || '',
				});
			}
			const state = String(player?.state || '').trim();
			if (state) {
				states.set(accounting_state_id(state), {
					display_name: state,
					buyer_name: state,
					state,
				});
			}
		};
		(curt?.events?.events || []).forEach((event) => {
			sorted_registration_stages(event).forEach((stage) => {
				(stage.entries || []).forEach((entry) => {
					(entry?.team?.players || []).forEach(remember_buyer_groups);
				});
			});
		});
		clubs.forEach((club, id) => ensure_account('club', id, club));
		states.forEach((state, id) => ensure_account('state', id, state));
		ensure_account('none', 'none', {
			display_name: 'Ohne Käufer',
			buyer_name: 'Ohne Käufer',
		});
		const fee_keys = new Set();
		(curt?.events?.events || []).forEach((event) => {
			const fee = registration_money_number(event?.fee);
			if (fee <= 0) {
				return;
			}
			sorted_registration_stages(event).forEach((stage) => {
				(stage.entries || []).forEach((entry) => {
					if (!accounting_entry_counts_for_fee(event, stage, entry, fee_mode)) {
						return;
					}
					(entry?.team?.players || []).forEach((player, player_index) => {
						const player_id = registration_accounting_player_id(player, player_index);
						const key = player_id + ':' + String(event?.id || event?.name || '');
						if (fee_keys.has(key)) {
							return;
						}
						fee_keys.add(key);
						const account = ensure_player_account(player, player_index);
						if (!account) {
							return;
						}
						account.fee_total += fee;
						account.overview_fee_total += fee;
						const event_id = String(event?.id || event?.name || '');
						account.fee_items.push({
							position_id: ['fee', player_id, event_id, fee_mode].join(':'),
							description: 'Meldegeld ' + (event?.name || ''),
							amount: fee,
							event_name: event?.name || '',
							mode: fee_mode,
							caused_by: [{
								label: person_display_name(player),
								player_name: person_display_name(player),
								club: player?.club || '',
								state: player?.state || '',
								detail: event?.name || '',
								amount: fee,
							}],
						});
					});
				});
			});
		});
		registration_accounting_items()
			.filter((item) => item && item.active !== false && accounting_item_billing_type(item) !== 'optional')
			.forEach((item) => {
				accounts.forEach((account) => {
					if (account.account_type !== 'player') {
						return;
					}
					if (registration_money_number(account.fee_total) <= 0) {
						return;
					}
					const billing_type = accounting_item_billing_type(item);
					const quantity = billing_type === 'required_discipline'
						? Math.max(0, (account.fee_items || []).length)
						: 1;
					const unit_price = registration_money_number(item.unit_price || 0);
					if (quantity <= 0 || unit_price < 0) {
						return;
					}
					const amount = registration_money_number(quantity * unit_price);
					const overview_category = accounting_item_overview_category(item);
					account.mandatory_charge_total += amount;
					if (overview_category === 'fee') {
						account.overview_fee_total += amount;
					} else {
						account.overview_item_total += amount;
					}
					account.mandatory_items.push({
						position_id: ['required', account.account_id, item.id, billing_type].join(':'),
						item_id: item.id,
						description: item.name || 'Artikel',
						input_type: item.input_type || 'quantity',
						sale_unit: accounting_item_sale_unit(item),
						quantity,
						unit_price,
						amount,
						required: true,
						billing_type,
						overview_category,
						caused_by: billing_type === 'required_discipline'
							? (account.fee_items || []).map((fee_item) => ({
								label: account.player_name,
								player_name: account.player_name,
								club: account.club || '',
								state: account.state || '',
								detail: fee_item.event_name || '',
								amount: unit_price,
							}))
							: [{
								label: account.player_name || accounting_account_label(account),
								player_name: account.player_name || '',
								club: account.club || '',
								state: account.state || '',
								amount,
							}],
					});
				});
			});
		const accounting_items_by_id = new Map(registration_accounting_items()
			.filter((item) => item && item.id)
			.map((item) => [String(item.id), item]));
		const local_accounting_entries = registration_accounting_entries().filter(Boolean);
		const add_local_entry_to_account = (entry, account, amount) => {
			account.local_entries.push({...entry, amount});
			if (entry.kind === 'payment') {
				account.local_paid_total += amount;
			} else if (entry.kind === 'charge') {
				account.local_charge_total += amount;
				const catalog_item = accounting_items_by_id.get(String(entry.item_id || ''));
				const overview_category = String(entry.item_overview_category || '') ||
					accounting_item_overview_category(catalog_item);
				if (overview_category === 'fee') {
					account.overview_fee_total += amount;
				} else {
					account.overview_item_total += amount;
				}
			}
		};
		local_accounting_entries
			.filter((entry) => entry.kind !== 'payment')
			.forEach((entry) => {
				const buyer_type = accounting_entry_buyer_type(entry);
				const buyer_id = accounting_entry_buyer_id(entry);
				const account = ensure_account(buyer_type, buyer_id, {
					player_name: entry.player_name || '',
					buyer_name: entry.buyer_name || entry.player_name || '',
					display_name: entry.buyer_name || entry.player_name || '',
					club: entry.club || '',
					state: entry.state || '',
				});
				if (!account) {
					return;
				}
				add_local_entry_to_account(entry, account, registration_money_number(entry.amount));
			});
		const position_accounts = new Map();
		const remember_position_account = (position_id, account, amount) => {
			const id = String(position_id || '').trim();
			const value = registration_money_number(amount || 0);
			if (!id || !account || value <= 0) {
				return;
			}
			if (!position_accounts.has(id)) {
				position_accounts.set(id, []);
			}
			position_accounts.get(id).push({ account, amount: value });
		};
		accounts.forEach((account) => {
			(account.fee_items || []).forEach((entry) => {
				remember_position_account(entry.position_id, account, entry.amount);
			});
			(account.mandatory_items || []).forEach((entry) => {
				remember_position_account(entry.position_id, account, entry.amount);
			});
			(account.local_entries || []).forEach((entry) => {
				if (entry.kind === 'charge') {
					remember_position_account('local:' + String(entry.id || ''), account, entry.amount);
				}
			});
		});
			const imported_btp_payment_guids = new Set(registration_btp_payments()
				.map((payment) => String(payment?.guid ?? payment?.GUID ?? '').trim())
				.filter(Boolean));
			const local_btp_payment_coverage_by_player = new Map();
			local_accounting_entries
				.filter((entry) => entry && entry.kind === 'payment' && !entry.is_cancellation)
				.forEach((entry) => {
					(Array.isArray(entry.btp_payment_transfers) ? entry.btp_payment_transfers : [])
						.forEach((transfer) => {
							const player_id = String(transfer?.player_id ?? transfer?.PlayerID ?? '').trim();
							const amount = registration_money_number(transfer?.amount ?? transfer?.Amount);
							if (!player_id || amount <= 0) {
								return;
							}
							local_btp_payment_coverage_by_player.set(
								player_id,
								registration_money_number((local_btp_payment_coverage_by_player.get(player_id) || 0) + amount)
							);
						});
				});
		const add_payment_share_to_account = (entry, target_account, amount, position_ids, allocation) => {
			const share = registration_money_number(amount);
			if (!target_account || share <= 0) {
				return;
			}
			const distributed_entry = {
				...entry,
				amount: share,
				unit_price: share,
				quantity: 1,
				buyer_type: target_account.account_type,
				buyer_id: target_account.account_id,
				buyer_name: accounting_account_label(target_account),
				player_id: target_account.player_id || '',
				player_name: target_account.player_name || '',
				club: target_account.club || '',
				state: target_account.state || '',
				paid_position_ids: position_ids,
				payment_allocations: allocation ? [{
					...allocation,
					amount: share,
					position_ids,
				}] : accounting_payment_allocations(entry),
				accounting_distributed_payment: true,
				payment_distributed_from_id: entry.id || '',
			};
			add_local_entry_to_account(distributed_entry, target_account, share);
		};
		const distribute_payment_entry = (entry) => {
			const transfer_guids = (Array.isArray(entry?.btp_payment_transfers) ? entry.btp_payment_transfers : [])
				.map((transfer) => String(transfer?.guid || '').trim())
				.filter(Boolean);
			if (transfer_guids.length > 0 && transfer_guids.every((guid) => imported_btp_payment_guids.has(guid))) {
				return;
			}
			const amount = registration_money_number(entry.amount);
			const allocations = accounting_payment_allocations(entry);
			let distributed_total = 0;
			allocations.forEach((allocation) => {
				const allocation_amount = registration_money_number(allocation.amount);
				const position_ids = (allocation.position_ids || [])
					.map((id) => String(id || '').trim())
					.filter(Boolean);
				const targets = [];
				const seen_targets = new Set();
				position_ids.forEach((position_id) => {
					(position_accounts.get(position_id) || []).forEach((target) => {
						const target_key = [
							position_id,
							target.account.account_type,
							target.account.account_id,
						].join('|');
						if (seen_targets.has(target_key)) {
							return;
						}
						seen_targets.add(target_key);
						targets.push({
							...target,
							position_id,
						});
					});
				});
				const target_total = registration_money_number(targets.reduce((sum, target) => sum + registration_money_number(target.amount), 0));
				if (allocation_amount <= 0 || target_total <= 0 || targets.length === 0) {
					return;
				}
				let assigned = 0;
				const shares_by_account = new Map();
				targets.forEach((target, target_index) => {
					const share = target_index === targets.length - 1
						? registration_money_number(allocation_amount - assigned)
						: registration_money_number(allocation_amount * registration_money_number(target.amount) / target_total);
					assigned = registration_money_number(assigned + share);
					if (share <= 0) {
						return;
					}
					const account_key = accounting_account_key(target.account.account_type, target.account.account_id);
					if (!shares_by_account.has(account_key)) {
						shares_by_account.set(account_key, {
							account: target.account,
							amount: 0,
							position_ids: [],
						});
					}
					const account_share = shares_by_account.get(account_key);
					account_share.amount = registration_money_number(account_share.amount + share);
					if (!account_share.position_ids.includes(target.position_id)) {
						account_share.position_ids.push(target.position_id);
					}
				});
				shares_by_account.forEach((account_share) => {
					add_payment_share_to_account(entry, account_share.account, account_share.amount, account_share.position_ids, allocation);
					distributed_total = registration_money_number(distributed_total + account_share.amount);
				});
			});
			const remaining = registration_money_number(amount - distributed_total);
			if (remaining <= 0) {
				return;
			}
			const buyer_type = accounting_entry_buyer_type(entry);
			const buyer_id = accounting_entry_buyer_id(entry);
			const account = ensure_account(buyer_type, buyer_id, {
				player_name: entry.player_name || '',
				buyer_name: entry.buyer_name || entry.player_name || '',
				display_name: entry.buyer_name || entry.player_name || '',
				club: entry.club || '',
				state: entry.state || '',
			});
			if (account) {
				add_local_entry_to_account(entry, account, remaining);
			}
		};
			const btp_payment_totals_by_player = new Map();
			registration_btp_payments().forEach((payment) => {
				const player_id = String(payment?.player_id ?? payment?.PlayerID ?? payment?.playerID ?? '').trim();
				const amount = registration_money_number(payment?.amount ?? payment?.Amount);
				if (!player_id || amount === 0) {
					return;
				}
				if (!btp_payment_totals_by_player.has(player_id)) {
					btp_payment_totals_by_player.set(player_id, {
						amount: 0,
						payment_type: payment?.payment_type ?? payment?.PaymentType ?? '',
						payment_date: payment?.payment_date ?? payment?.PaymentDate ?? '',
						count: 0,
					});
				}
				const total = btp_payment_totals_by_player.get(player_id);
				total.amount = registration_money_number(total.amount + amount);
				total.count += 1;
				if (!total.payment_date && (payment?.payment_date || payment?.PaymentDate)) {
					total.payment_date = payment?.payment_date ?? payment?.PaymentDate ?? '';
				}
			});
			btp_payment_totals_by_player.forEach((payment, player_id) => {
				const account = ensure_account('player', player_id);
				if (!account) {
					return;
				}
				const local_coverage = registration_money_number(local_btp_payment_coverage_by_player.get(player_id) || 0);
				const amount = payment.amount > 0 && local_coverage > 0
					? registration_money_number(payment.amount - Math.min(payment.amount, local_coverage))
					: registration_money_number(payment.amount);
				if (amount === 0) {
					return;
				}
				account.btp_paid_total += amount;
				account.btp_payments.push({
					id: 'net:' + player_id,
					position_id: 'btp:' + [
						player_id,
						'net',
						payment.payment_date || '',
						amount,
					].join(':'),
					amount,
					payment_type: payment.payment_type || '',
					payment_date: payment.payment_date || '',
					btp_payment_count: payment.count,
					source: 'btp',
				});
			});
		local_accounting_entries
			.filter((entry) => entry.kind === 'payment')
			.forEach(distribute_payment_entry);
		accounts.forEach((account) => {
			account.item_total = registration_money_number(account.mandatory_charge_total + account.local_charge_total);
			account.overview_fee_total = registration_money_number(account.overview_fee_total || 0);
			account.overview_item_total = registration_money_number(account.overview_item_total || 0);
			account.due_total = registration_money_number(account.fee_total + account.item_total);
			account.paid_total = registration_money_number(account.btp_paid_total + account.local_paid_total);
			account.open_total = registration_money_number(account.due_total - account.paid_total);
		});
		return accounts;
	}

	function remember_registration_accounting_entry(entry) {
		if (!entry || !entry.id) {
			return;
		}
		if (!Array.isArray(curt.accounting_entries)) {
			curt.accounting_entries = [];
		}
		const existing_index = curt.accounting_entries.findIndex((candidate) => candidate && candidate.id === entry.id);
		if (existing_index >= 0) {
			curt.accounting_entries[existing_index] = entry;
		} else {
			curt.accounting_entries.push(entry);
		}
	}

	function remember_registration_accounting_item(item) {
		if (!item || !item.id) {
			return;
		}
		if (!Array.isArray(curt.accounting_items)) {
			curt.accounting_items = [];
		}
		const existing_index = curt.accounting_items.findIndex((candidate) => candidate && candidate.id === item.id);
		if (existing_index >= 0) {
			curt.accounting_items[existing_index] = item;
		} else {
			curt.accounting_items.push(item);
		}
	}

	function remember_registration_accounting_document(document) {
		if (!document || !document.id) {
			return;
		}
		if (!Array.isArray(curt.accounting_documents)) {
			curt.accounting_documents = [];
		}
		const existing_index = curt.accounting_documents.findIndex((candidate) => candidate && candidate.id === document.id);
		if (existing_index >= 0) {
			curt.accounting_documents[existing_index] = document;
		} else {
			curt.accounting_documents.push(document);
		}
	}

	function add_registration_accounting_entry(entry, callback, options = {}) {
		send_with_live_status({
			type: 'registration_accounting_entry',
			tournament_key: curt.key,
			entry,
		}, function(err, response) {
			if (err) {
				cerror.net(err);
				if (callback) callback(err);
				return;
			}
			if (response && response.entry) {
				remember_registration_accounting_entry(response.entry);
			}
			if (callback) callback(null, response);
			if (options.refresh !== false && current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function update_registration_accounting_entry_record(entry_id, entry, callback) {
		send_with_live_status({
			type: 'registration_accounting_entry_update',
			tournament_key: curt.key,
			entry_id,
			entry,
		}, function(err, response) {
			if (err) {
				cerror.net(err);
				if (callback) callback(err);
				return;
			}
			if (response && response.entry) {
				remember_registration_accounting_entry(response.entry);
			}
			if (callback) callback(null, response);
			if (current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function add_registration_accounting_item(item, callback) {
		send_with_live_status({
			type: 'registration_accounting_item',
			tournament_key: curt.key,
			item,
		}, function(err, response) {
			if (err) {
				cerror.net(err);
				if (callback) callback(err);
				return;
			}
			if (response && response.item) {
				remember_registration_accounting_item(response.item);
			}
			if (callback) callback(null, response);
			if (current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function update_registration_accounting_item_record(item_id, item, callback) {
		send_with_live_status({
			type: 'registration_accounting_item_update',
			tournament_key: curt.key,
			item_id,
			item,
		}, function(err, response) {
			if (err) {
				cerror.net(err);
				if (callback) callback(err);
				return;
			}
			if (response && response.item) {
				remember_registration_accounting_item(response.item);
			}
			if (callback) callback(null, response);
			if (current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function add_registration_accounting_document(document, callback, options = {}) {
		send_with_live_status({
			type: 'registration_accounting_document',
			tournament_key: curt.key,
			document,
		}, function(err, response) {
			if (err) {
				cerror.net(err);
				if (callback) callback(err);
				return;
			}
			if (response && response.document) {
				remember_registration_accounting_document(response.document);
			}
			if (callback) callback(null, response);
			if (options.refresh !== false && current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function remove_registration_accounting_entry(entry_id, callback) {
		if (!entry_id) {
			if (callback) callback(new Error('Missing accounting entry id'));
			return;
		}
		send_with_live_status({
			type: 'registration_accounting_entry_remove',
			tournament_key: curt.key,
			entry_id,
		}, function(err) {
			if (err) {
				if (callback) callback(err);
				return cerror.net(err);
			}
			if (Array.isArray(curt.accounting_entries)) {
				curt.accounting_entries = curt.accounting_entries.filter((entry) => entry && entry.id !== entry_id);
			}
			if (callback) callback(null);
			if (current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function remove_registration_accounting_item(item_id) {
		if (!item_id) {
			return;
		}
		send_with_live_status({
			type: 'registration_accounting_item_remove',
			tournament_key: curt.key,
			item_id,
		}, function(err) {
			if (err) {
				return cerror.net(err);
			}
			if (Array.isArray(curt.accounting_items)) {
				curt.accounting_items = curt.accounting_items.filter((item) => item && item.id !== item_id);
			}
			if (current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function prompt_registration_money(message, default_value) {
		const raw = prompt(message, String(default_value ?? '').replace('.', ','));
		if (raw === null) {
			return null;
		}
		const value = Number(String(raw).replace(',', '.'));
		return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
	}

	function registration_datetime_display_value(value) {
		const date = value ? new Date(value) : new Date();
		if (!Number.isFinite(date.getTime())) {
			return '-';
		}
		return date.toLocaleString('de-DE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function registration_date_display_value(value) {
		const date = value ? new Date(value) : new Date();
		if (!Number.isFinite(date.getTime())) {
			return '-';
		}
		return date.toLocaleDateString('de-DE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
		});
	}

	function registration_datetime_storage_value(value) {
		const date = value ? new Date(value) : new Date();
		return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
	}

	function accounting_invoice_due_at(issued_at, due_days = accounting_payment_settings().due_days) {
		const date = issued_at ? new Date(issued_at) : new Date();
		const base = Number.isFinite(date.getTime()) ? date : new Date();
		base.setDate(base.getDate() + registration_money_number(due_days));
		return base.toISOString();
	}

	function accounting_document_payment_details(document) {
		const settings = accounting_payment_settings();
		return {
			recipient: document?.payment_recipient || settings.recipient,
			bank: document?.payment_bank || settings.bank,
			iban: document?.payment_iban || settings.iban,
			bic: document?.payment_bic || settings.bic,
			due_at: document?.due_at || accounting_invoice_due_at(document?.issued_at || document?.created_at),
		};
	}

	function registration_accounting_sale_id() {
		return 'sale_' + Date.now() + '_' + Math.random().toString(36).slice(2);
	}

	function accounting_document_buyer_payload(account) {
		return {
			buyer_type: account?.account_type || 'player',
			buyer_id: account?.account_id || account?.player_id || '',
			buyer_name: accounting_account_label(account),
			player_id: account?.player_id || '',
			player_name: account?.player_name || '',
			club: account?.club || '',
			state: account?.state || '',
		};
	}

	function accounting_document_used_position_ids(document_type) {
		const used = new Set();
		registration_accounting_documents()
			.filter((document) => document && document.document_type === document_type)
			.forEach((document) => {
				(document.lines || []).forEach((line) => {
					(Array.isArray(line.position_ids) ? line.position_ids : [line.position_id || line.entry_id])
						.map((id) => String(id || '').trim())
						.filter(Boolean)
						.forEach((id) => used.add(id));
				});
		});
		return used;
	}

	function accounting_line_position_ids(line) {
		return (Array.isArray(line?.position_ids) ? line.position_ids : [line?.position_id || line?.entry_id])
			.map((id) => String(id || '').trim())
			.filter(Boolean);
	}

	function accounting_document_position_ids(document) {
		const ids = [];
		(document?.lines || []).forEach((line) => {
			accounting_line_position_ids(line).forEach((id) => {
				if (!ids.includes(id)) {
					ids.push(id);
				}
			});
		});
		return ids;
	}

	function accounting_payment_entries_for_invoice(document) {
		const invoice_id = String(document?.id || '').trim();
		const invoice_number = String(document?.document_number || '').trim();
		return registration_accounting_entries()
			.filter((entry) => {
				if (!entry || entry.kind !== 'payment' || entry.is_cancellation) {
					return false;
				}
				if (String(entry.payment_target_type || '') !== 'invoice') {
					return false;
				}
				return (invoice_id && String(entry.invoice_id || '') === invoice_id) ||
					(invoice_number && String(entry.invoice_number || '') === invoice_number);
			});
	}

	function accounting_payment_allocations(entry) {
		if (Array.isArray(entry?.payment_allocations) && entry.payment_allocations.length > 0) {
			return entry.payment_allocations
				.map((allocation) => ({
					target_type: String(allocation?.target_type || allocation?.payment_target_type || ''),
					amount: registration_money_number(allocation?.amount || 0),
					invoice_id: String(allocation?.invoice_id || '').trim(),
					invoice_number: String(allocation?.invoice_number || '').trim(),
					position_ids: (Array.isArray(allocation?.position_ids) ? allocation.position_ids : allocation?.paid_position_ids || [])
						.map((id) => String(id || '').trim())
						.filter(Boolean),
				}))
				.filter((allocation) => allocation.amount > 0);
		}
		if (!entry || entry.kind !== 'payment') {
			return [];
		}
		const target_type = String(entry.payment_target_type || '');
		if (!['invoice', 'open'].includes(target_type)) {
			return [];
		}
		return [{
			target_type,
			amount: registration_money_number(entry.amount || 0),
			invoice_id: String(entry.invoice_id || '').trim(),
			invoice_number: String(entry.invoice_number || '').trim(),
			position_ids: (Array.isArray(entry.paid_position_ids) ? entry.paid_position_ids : [])
				.map((id) => String(id || '').trim())
				.filter(Boolean),
		}].filter((allocation) => allocation.amount > 0);
	}

	function accounting_payment_btp_transfers_for_allocations(allocations) {
		const accounts = collect_registration_accounting_accounts();
		const position_accounts = new Map();
		const remember_position_account = (position_id, account, amount) => {
			const id = String(position_id || '').trim();
			const value = registration_money_number(amount || 0);
			if (!id || !account || value <= 0) {
				return;
			}
			if (!position_accounts.has(id)) {
				position_accounts.set(id, []);
			}
			position_accounts.get(id).push({ account, amount: value });
		};
		accounts.forEach((account) => {
			(account.fee_items || []).forEach((entry) => {
				remember_position_account(entry.position_id, account, entry.amount);
			});
			(account.mandatory_items || []).forEach((entry) => {
				remember_position_account(entry.position_id, account, entry.amount);
			});
			(account.local_entries || []).forEach((entry) => {
				if (entry.kind === 'charge') {
					remember_position_account('local:' + String(entry.id || ''), account, entry.amount);
				}
			});
		});
		const shares_by_player = new Map();
		(allocations || []).forEach((allocation) => {
			const allocation_amount = registration_money_number(allocation?.amount || 0);
			const position_ids = (allocation?.position_ids || [])
				.map((id) => String(id || '').trim())
				.filter(Boolean);
			const targets = [];
			const seen_targets = new Set();
			position_ids.forEach((position_id) => {
				(position_accounts.get(position_id) || []).forEach((target) => {
					if (target.account?.account_type !== 'player' || !/^\d+$/.test(String(target.account.player_id || ''))) {
						return;
					}
					const target_key = [
						position_id,
						target.account.account_type,
						target.account.account_id,
					].join('|');
					if (seen_targets.has(target_key)) {
						return;
					}
					seen_targets.add(target_key);
					targets.push({
						...target,
						position_id,
					});
				});
			});
			const target_total = registration_money_number(targets.reduce((sum, target) => sum + registration_money_number(target.amount), 0));
			if (allocation_amount <= 0 || target_total <= 0 || targets.length === 0) {
				return;
			}
			let assigned = 0;
			targets.forEach((target, target_index) => {
				const share = target_index === targets.length - 1
					? registration_money_number(allocation_amount - assigned)
					: registration_money_number(allocation_amount * registration_money_number(target.amount) / target_total);
				assigned = registration_money_number(assigned + share);
				if (share <= 0) {
					return;
				}
				const player_id = String(target.account.player_id || '').trim();
				if (!shares_by_player.has(player_id)) {
					shares_by_player.set(player_id, {
						player_id,
						player_name: target.account.player_name || '',
						amount: 0,
						position_ids: [],
					});
				}
				const player_share = shares_by_player.get(player_id);
				player_share.amount = registration_money_number(player_share.amount + share);
				if (!player_share.position_ids.includes(target.position_id)) {
					player_share.position_ids.push(target.position_id);
				}
			});
		});
		return [...shares_by_player.values()].filter((transfer) => transfer.amount > 0);
	}

	function accounting_join_sentence_parts(parts, conjunction = 'und') {
		const values = (parts || [])
			.map((part) => String(part || '').trim())
			.filter(Boolean);
		if (values.length <= 1) {
			return values[0] || '';
		}
		if (values.length === 2) {
			return values[0] + ' ' + conjunction + ' ' + values[1];
		}
		return values.slice(0, -1).join(', ') + ' ' + conjunction + ' ' + values[values.length - 1];
	}

	function accounting_receipt_settlement_sentence(allocations) {
		const invoice_numbers = (allocations || [])
			.filter((allocation) => allocation.target_type === 'invoice')
			.map((allocation) => String(allocation.invoice_number || '').trim())
			.filter(Boolean)
			.filter((number, index, numbers) => numbers.indexOf(number) === index);
		const has_open_positions = (allocations || []).some((allocation) => allocation.target_type === 'open');
		const parts = [];
		if (invoice_numbers.length === 1) {
			parts.push('die Rechnung ' + invoice_numbers[0]);
		} else if (invoice_numbers.length > 1) {
			parts.push('die Rechnungen ' + accounting_join_sentence_parts(invoice_numbers));
		}
		if (has_open_positions) {
			parts.push('bisher nicht in Rechnung gestellte Posten');
		}
		if (parts.length === 0) {
			return '';
		}
		const single_invoice_only = invoice_numbers.length === 1 && !has_open_positions;
		return 'Mit dieser Zahlung ' + (single_invoice_only ? 'wurde ' : 'wurden ') + accounting_join_sentence_parts(parts, 'sowie') + ' beglichen.';
	}

	function accounting_paid_position_ids() {
		const used = new Set();
		registration_accounting_entries()
			.filter((entry) => entry && entry.kind === 'payment' && !entry.is_cancellation)
			.forEach((entry) => {
				accounting_payment_allocations(entry).forEach((allocation) => {
					(allocation.position_ids || []).forEach((id) => used.add(id));
				});
			});
		return used;
	}

	function accounting_unavailable_charge_position_ids() {
		return new Set([
			...accounting_document_used_position_ids('invoice'),
			...accounting_paid_position_ids(),
		]);
	}

	function accounting_invoice_paid_total(document) {
		const invoice_id = String(document?.id || '').trim();
		const invoice_number = String(document?.document_number || '').trim();
		let paid_total = 0;
		registration_accounting_entries()
			.filter((entry) => entry && entry.kind === 'payment' && !entry.is_cancellation)
			.forEach((entry) => {
				accounting_payment_allocations(entry).forEach((allocation) => {
					if (allocation.target_type !== 'invoice') {
						return;
					}
					if (
						(invoice_id && allocation.invoice_id === invoice_id) ||
						(invoice_number && allocation.invoice_number === invoice_number)
					) {
						paid_total = registration_money_number(paid_total + allocation.amount);
					}
				});
			});
		return paid_total;
	}

	function accounting_document_with_payment_status(document) {
		if (!document || document.document_type !== 'invoice') {
			return document;
		}
		const total = registration_money_number(document.total || 0);
		const paid_total = accounting_invoice_paid_total(document);
		const open_total = Math.max(0, registration_money_number(total - paid_total));
		return {
			...document,
			paid_total,
			open_total,
			status: open_total <= 0 ? 'paid' : 'issued',
		};
	}

	function accounting_receipt_display_lines(document) {
		if (!document || document.document_type !== 'receipt') {
			return accounting_document_merge_lines(document?.lines || []);
		}
		const allocations = Array.isArray(document.payment_allocations)
			? document.payment_allocations
			: [];
		if (allocations.length === 0) {
			return accounting_document_merge_lines(document.lines || []);
		}
		const lines = [];
		allocations.forEach((allocation) => {
			if (allocation.target_type !== 'invoice') {
				return;
			}
			const invoice = registration_accounting_documents().find((candidate) => candidate && candidate.document_type === 'invoice' && (
				(allocation.invoice_id && candidate.id === allocation.invoice_id) ||
				(allocation.invoice_number && candidate.document_number === allocation.invoice_number)
			));
			const invoice_lines = accounting_document_merge_lines(invoice?.lines || []);
			if (invoice_lines.length > 0 && registration_money_number(invoice?.total || 0) === registration_money_number(allocation.amount || 0)) {
				lines.push(...invoice_lines);
			}
		});
		const open_position_ids = new Set(allocations
			.filter((allocation) => allocation.target_type === 'open')
			.flatMap((allocation) => allocation.position_ids || []));
		accounting_document_merge_lines(document.lines || []).forEach((line) => {
			const line_ids = accounting_line_position_ids(line);
			if (line_ids.length === 0 || line_ids.some((id) => open_position_ids.has(id))) {
				lines.push(line);
			}
		});
		return lines.length > 0 ? accounting_document_merge_lines(lines) : accounting_document_merge_lines(document.lines || []);
	}

	function accounting_account_open_invoices(account) {
		return accounting_documents_for_account(account)
			.filter((document) => document && document.document_type === 'invoice')
			.map(accounting_document_with_payment_status)
			.filter((document) => registration_money_number(document.open_total || 0) > 0);
	}

	function accounting_uninvoiced_charge_summaries(account) {
		return accounting_position_summaries(account, false, undefined, {
			excluded_position_ids: accounting_unavailable_charge_position_ids(),
			kind_filter: 'charge',
		}).filter((summary) => registration_money_number(summary.amount || 0) > 0);
	}

	function accounting_summary_position_ids(summaries) {
		const ids = [];
		(summaries || []).forEach((summary) => {
			(summary.position_ids || [])
				.map((id) => String(id || '').trim())
				.filter(Boolean)
				.forEach((id) => {
					if (!ids.includes(id)) {
						ids.push(id);
					}
				});
		});
		return ids;
	}

	function accounting_charge_position_amounts(account) {
		const amounts = new Map();
		function add_position_amount(position_id, amount) {
			const id = String(position_id || '').trim();
			const value = registration_money_number(amount || 0);
			if (!id || value <= 0) {
				return;
			}
			amounts.set(id, registration_money_number((amounts.get(id) || 0) + value));
		}
		(account?.summary_fee_items || account?.fee_items || []).forEach((entry) => {
			add_position_amount(entry?.position_id, entry?.amount);
		});
		(account?.summary_mandatory_items || account?.mandatory_items || []).forEach((entry) => {
			add_position_amount(entry?.position_id, entry?.amount);
		});
		const local_entries = account?.summary_local_entries || account?.local_entries || [];
		const voided_entry_ids = new Set(local_entries
			.filter((entry) => entry && entry.is_cancellation && entry.voids_entry_id)
			.map((entry) => String(entry.voids_entry_id)));
		local_entries.forEach((entry) => {
			if (!entry || entry.kind !== 'charge' || entry.is_cancellation || voided_entry_ids.has(String(entry.id || ''))) {
				return;
			}
			add_position_amount(entry.id ? 'local:' + entry.id : '', entry.amount);
		});
		return amounts;
	}

	function accounting_invoiced_total(account) {
		const used_position_ids = accounting_document_used_position_ids('invoice');
		let total = 0;
		accounting_charge_position_amounts(account).forEach((amount, position_id) => {
			if (used_position_ids.has(position_id)) {
				total = registration_money_number(total + amount);
			}
		});
		return total;
	}

	function accounting_display_open_total(account, invoiced_total) {
		const open_total = registration_money_number(account?.open_total || 0);
		if (accounting_invoice_treatment_mode() !== 'paid') {
			return open_total;
		}
		return registration_money_number(open_total - registration_money_number(invoiced_total || 0));
	}

	function accounting_document_line_from_summary(summary) {
		return {
			description: accounting_summary_document_label(summary),
			quantity: summary.quantity || 1,
			unit_price: summary.quantity ? registration_money_number(summary.amount / summary.quantity) : summary.amount,
			amount: summary.amount,
			sale_unit: summary.sale_unit || (summary.category === 'fee' ? 'Meldung' : ''),
			position_id: (summary.position_ids || [])[0] || '',
			position_ids: summary.position_ids || [],
			caused_by: accounting_group_causes_by_label(summary.caused_by || []),
		};
	}

	function accounting_document_merge_lines(lines) {
		const merged = [];
		const by_key = new Map();
		(lines || []).forEach((line) => {
			const quantity = registration_money_number(line?.quantity || 1);
			const amount = registration_money_number(line?.amount || 0);
			const unit_price = registration_money_number(line?.unit_price || (quantity ? amount / quantity : amount));
			const sale_unit = String(line?.sale_unit || '').trim();
			const description = accounting_document_display_description(line);
			const key = [
				description,
				sale_unit,
				unit_price.toFixed(4),
			].join('\u0001');
			const already_merged = by_key.has(key);
			if (!already_merged) {
				const copy = {
					...line,
					description,
					quantity,
					unit_price,
					amount,
					sale_unit,
					position_id: line?.position_id || '',
					position_ids: [],
					caused_by: [],
				};
				by_key.set(key, copy);
				merged.push(copy);
			}
			const target = by_key.get(key);
			if (already_merged) {
				target.quantity = registration_money_number(target.quantity + quantity);
				target.amount = registration_money_number(target.amount + amount);
			}
			(Array.isArray(line?.position_ids) ? line.position_ids : [line?.position_id || line?.entry_id])
				.map((id) => String(id || '').trim())
				.filter(Boolean)
				.forEach((id) => {
					if (!target.position_ids.includes(id)) {
						target.position_ids.push(id);
					}
				});
			(Array.isArray(line?.caused_by) ? line.caused_by : []).forEach((cause) => {
				accounting_push_cause(target.caused_by, cause);
			});
			target.position_id = target.position_ids[0] || target.position_id || '';
		});
		return merged.map((line) => ({
			...line,
			caused_by: accounting_group_causes_by_label(line.caused_by),
		}));
	}

	function accounting_document_summary_group(label, summaries, checked) {
		return {
			label,
			checked: checked !== false,
			summaries: (summaries || []).filter((summary) => registration_money_number(summary.amount) > 0),
			nodes: [],
		};
	}

	function accounting_document_summary_for(account, document_type, source, category_filter, excluded_position_ids, item_key_filter) {
		return accounting_position_summaries(account, document_type === 'receipt', source, {
			excluded_position_ids,
			kind_filter: document_type === 'invoice' ? 'charge' : 'payment',
			category_filter,
			item_key_filter,
		}).filter((summary) => registration_money_number(summary.amount) > 0);
	}

	function accounting_document_selection_node(label, summaries, children, checked, options = {}) {
		children = children || [];
		return {
			label,
			summaries: summaries || [],
			children: children.filter((child) => child && (child.summaries.length > 0 || child.children.length > 0)),
			checked,
			expanded: !!options.expanded,
			prefer_children: !!options.prefer_children,
		};
	}

	function accounting_document_splits_local_charges(document_type, category_filter) {
		const categories = Array.isArray(category_filter) ? category_filter : [category_filter];
		return document_type === 'invoice' && categories.includes('local_charge');
	}

	function accounting_document_find_tree_node(account) {
		const tree = build_accounting_tree([...collect_registration_accounting_accounts().values()]);
		const wanted_key = accounting_account_key(account?.account_type, account?.account_id);
		for (const state of tree.states) {
			const state_key = accounting_account_key(state.rollup_account?.account_type, state.rollup_account?.account_id);
			if (state_key === wanted_key) {
				return { type: 'state', state };
			}
			for (const club of state.clubs) {
				const club_key = accounting_account_key(club.rollup_account?.account_type, club.rollup_account?.account_id);
				if (club_key === wanted_key) {
					return { type: 'club', club };
				}
			}
		}
		return null;
	}

	function accounting_document_local_charge_item_key(entry, label, sale_unit) {
		return entry.item_id || [label, sale_unit, entry.unit_price || ''].join(':');
	}

	function accounting_document_local_charge_entry_summaries(account, excluded_position_ids, item_key_filter) {
		const excluded = excluded_position_ids || new Set();
		const item_keys = item_key_filter
			? new Set(Array.isArray(item_key_filter) ? item_key_filter : [item_key_filter])
			: null;
		const entries = Array.isArray(account?.local_entries) ? account.local_entries : [];
		const voided_entry_ids = new Set(entries
			.filter((entry) => entry && entry.is_cancellation && entry.voids_entry_id)
			.map((entry) => String(entry.voids_entry_id)));
		return entries
			.filter((entry) => {
				if (!entry || entry.kind !== 'charge' || entry.is_cancellation || voided_entry_ids.has(String(entry.id || ''))) {
					return false;
				}
				const amount = registration_money_number(entry.amount || 0);
				if (amount <= 0) {
					return false;
				}
				const position_id = entry.id ? 'local:' + entry.id : '';
				if (position_id && excluded.has(position_id)) {
					return false;
				}
				const label = entry.description || 'Buchung';
				const sale_unit = entry.item_sale_unit || 'Stk.';
				const item_key = accounting_document_local_charge_item_key(entry, label, sale_unit);
				return !item_keys || item_keys.has(item_key);
			})
			.sort((a, b) => String(a.purchase_at || a.created_at || '').localeCompare(String(b.purchase_at || b.created_at || '')))
			.map((entry) => {
				const label = entry.description || 'Buchung';
				const sale_unit = entry.item_sale_unit || 'Stk.';
				const time_label = registration_datetime_display_value(entry.purchase_at || entry.created_at);
				return {
					kind: 'charge',
					category: 'local_charge',
					item_key: accounting_document_local_charge_item_key(entry, label, sale_unit),
					class_name: 'accounting_entry_line_local',
					label,
					prefix: time_label,
					sale_unit,
					quantity: entry.quantity || 1,
					amount: entry.amount,
					local_entry_ids: entry.id ? [entry.id] : [],
					position_ids: entry.id ? ['local:' + entry.id] : [],
					caused_by: [{
						label: accounting_cause_label(entry) || accounting_account_label(account),
						detail: [time_label, accounting_document_quantity_label(entry.quantity || 1, sale_unit)].filter(Boolean).join(', '),
						amount: entry.amount,
					}],
				};
			});
	}

	function accounting_document_account_node(account, label, document_type, category_filter, excluded_position_ids, item_key_filter, checked) {
		const summaries = accounting_document_summary_for(account, document_type, 'direct', category_filter, excluded_position_ids, item_key_filter);
		const split_local_charges = accounting_document_splits_local_charges(document_type, category_filter);
		const children = split_local_charges
			? accounting_document_local_charge_entry_summaries(account, excluded_position_ids, item_key_filter)
				.map((summary) => accounting_document_selection_node(accounting_summary_label(summary), [summary], [], checked))
			: [];
		return accounting_document_selection_node(label, summaries, children, checked, {
			expanded: children.length > 0,
			prefer_children: children.length > 0,
		});
	}

	function accounting_document_player_nodes(players, document_type, category_filter, excluded_position_ids, item_key_filter) {
		return (players || []).map((player_account) => accounting_document_account_node(
			player_account,
			accounting_account_label(player_account),
			document_type,
			category_filter,
			excluded_position_ids,
			item_key_filter,
		)).filter((node) => node.summaries.length > 0 || node.children.length > 0);
	}

	function accounting_document_club_child_nodes(club, document_type, category_filter, excluded_position_ids, item_key_filter) {
		const children = [];
		const direct = accounting_document_account_node(
			club.account,
			accounting_account_label(club.account),
			document_type,
			category_filter,
			excluded_position_ids,
			item_key_filter,
		);
		if (direct.summaries.length > 0 || direct.children.length > 0) {
			children.push(direct);
		}
		children.push(...accounting_document_player_nodes(club.players, document_type, category_filter, excluded_position_ids, item_key_filter));
		return children;
	}

	function accounting_document_rollup_nodes(account, document_type, category_filter, excluded_position_ids, item_key_filter) {
		const tree_node = accounting_document_find_tree_node(account);
		if (!tree_node) {
			return [];
		}
		if (tree_node.type === 'club') {
			return accounting_document_player_nodes(tree_node.club.players, document_type, category_filter, excluded_position_ids, item_key_filter);
		}
		const split_local_charges = accounting_document_splits_local_charges(document_type, category_filter);
		return tree_node.state.clubs.map((club) => accounting_document_selection_node(
			accounting_account_label(club.account),
			accounting_document_summary_for(club.rollup_account, document_type, undefined, category_filter, excluded_position_ids, item_key_filter),
			accounting_document_club_child_nodes(club, document_type, category_filter, excluded_position_ids, item_key_filter),
			undefined,
			{ prefer_children: split_local_charges },
		)).filter((node) => node.summaries.length > 0 || node.children.length > 0);
	}

	function accounting_document_group_nodes(account, document_type, category_filter, excluded_position_ids, item_key_filter, direct_checked, children_checked) {
		const nodes = [];
		const direct = accounting_document_account_node(
			account,
			accounting_account_label(account),
			document_type,
			category_filter,
			excluded_position_ids,
			item_key_filter,
			direct_checked,
		);
		if (direct.summaries.length > 0 || direct.children.length > 0) {
			nodes.push(direct);
		}
		const child_nodes = accounting_document_rollup_nodes(account, document_type, category_filter, excluded_position_ids, item_key_filter);
		function set_default_checked(node) {
			node.checked = children_checked;
			(node.children || []).forEach(set_default_checked);
			return node;
		}
		nodes.push(...child_nodes.map(set_default_checked));
		return nodes;
	}

	function accounting_document_charge_summary_groups(account) {
		const excluded_position_ids = accounting_unavailable_charge_position_ids();
		const groups = [];
		const fee_summaries = accounting_position_summaries(account, false, undefined, {
			excluded_position_ids,
			kind_filter: 'charge',
			category_filter: 'fee',
		});
		const fee_group = accounting_document_summary_group('Meldegeld', fee_summaries, true);
		fee_group.nodes = accounting_document_group_nodes(account, 'invoice', 'fee', excluded_position_ids, undefined, true, true);
		groups.push(fee_group);
		[
			['mandatory', true],
			['local_charge', false],
		].forEach(([category, children_checked]) => {
			accounting_position_summaries(account, false, undefined, {
				excluded_position_ids,
				kind_filter: 'charge',
				category_filter: category,
			}).forEach((summary) => {
				const label = summary.label + (summary.sale_unit ? ' je ' + summary.sale_unit : '');
				const group = accounting_document_summary_group(label, [summary], false);
				group.nodes = accounting_document_group_nodes(account, 'invoice', category, excluded_position_ids, summary.item_key, true, children_checked);
				group.prefer_children = category === 'local_charge';
				groups.push(group);
			});
		});
		return groups.filter((group) => group.summaries.length > 0);
	}

	function accounting_document_payment_summary_groups(account) {
		const excluded_position_ids = accounting_document_used_position_ids('receipt');
		const group = accounting_document_summary_group('Zahlungen', accounting_position_summaries(account, true, undefined, {
			excluded_position_ids,
			kind_filter: 'payment',
		}), false);
		group.nodes = accounting_document_group_nodes(account, 'receipt', ['local_payment', 'btp_payment'], excluded_position_ids, undefined, true, false);
		const groups = [group];
		return groups.filter((group) => group.summaries.length > 0);
	}

	function accounting_documents_for_account(account) {
		const key = accounting_account_key(account?.account_type || 'player', account?.account_id || account?.player_id || '');
		return registration_accounting_documents()
			.filter((document) => accounting_account_key(document?.buyer_type || 'player', document?.buyer_id || document?.player_id || '') === key)
			.sort((a, b) => String(b.issued_at || b.created_at || '').localeCompare(String(a.issued_at || a.created_at || '')));
	}

	function registration_accounting_base_entry(event, player) {
		const player_id = registration_accounting_player_id(player);
		const player_name = person_display_name(player);
		return {
			buyer_type: 'player',
			buyer_id: player_id,
			buyer_name: player_name,
			player_id,
			player_name,
			club: player?.club || '',
			state: player?.state || '',
			event_name: event?.name || '',
			payment_method: 'cash',
		};
	}

	function accounting_account_base_entry(event, account) {
		if (!account || account.account_type === 'player' || !account.account_type) {
			return registration_accounting_base_entry(event, account?.player || account);
		}
		const buyer_name = accounting_account_label(account);
		return {
			buyer_type: account.account_type,
			buyer_id: account.account_id,
			buyer_name,
			player_id: account.account_id,
			player_name: buyer_name,
			club: account.account_type === 'club' ? buyer_name : account.club || '',
			state: account.account_type === 'state' ? buyer_name : account.state || '',
			event_name: event?.name || '',
			payment_method: 'cash',
		};
	}

	function accounting_payment_method_label(value) {
		switch (String(value || '').trim()) {
			case 'cash':
				return 'Bar';
			case 'transfer':
				return 'Überweisung';
			case 'card':
				return 'Karte';
			case 'other':
				return 'Sonstiges';
			default:
				return String(value || '').trim() || 'Zahlung';
		}
	}

	function accounting_payment_method_receipt_phrase(value) {
		switch (String(value || '').trim()) {
			case 'cash':
				return 'als Barzahlung';
			case 'transfer':
				return 'per Überweisung';
			case 'card':
				return 'per Kartenzahlung';
			case 'other':
				return 'als sonstige Zahlung';
			default:
				return 'als Zahlung';
		}
	}

	function close_registration_payment_dialog() {
		const dialog = document.querySelector('.registration_payment_dialog');
		if (!dialog) {
			return;
		}
		uiu.remove(dialog);
		cbts_utils.esc_stack_pop();
	}

	function create_registration_receipt_document(account, payment_entry, callback, context = {}) {
		const amount = registration_money_number(payment_entry?.amount || 0);
		const target_type = String(payment_entry?.payment_target_type || context.payment_target_type || '');
		const invoice = context.invoice || null;
		const allocations = Array.isArray(context.payment_allocations)
			? context.payment_allocations
			: accounting_payment_allocations(payment_entry);
		const open_lines = context.open_summaries
			? accounting_document_merge_lines(context.open_summaries.map(accounting_document_line_from_summary))
			: [];
		const open_total = registration_money_number(open_lines.reduce((sum, line) => sum + registration_money_number(line.amount), 0));
		let lines = [];
		const invoice_allocations = allocations.filter((allocation) => allocation.target_type === 'invoice');
		function invoice_for_allocation(allocation) {
			return registration_accounting_documents()
				.find((document) => document && document.document_type === 'invoice' && (
					(allocation.invoice_id && document.id === allocation.invoice_id) ||
					(allocation.invoice_number && document.document_number === allocation.invoice_number)
				)) || null;
		}
		if (invoice_allocations.length > 0) {
			invoice_allocations.forEach((allocation) => {
				const paid_invoice = invoice_for_allocation(allocation);
				const invoice_lines = accounting_document_merge_lines(paid_invoice?.lines || []);
				const invoice_open_total = registration_money_number(accounting_document_with_payment_status(paid_invoice)?.open_total || 0);
				if (paid_invoice && invoice_lines.length > 0 && invoice_open_total === allocation.amount) {
					lines.push(...invoice_lines);
					return;
				}
				lines.push({
					description: 'Zahlung zu Rechnung ' + (allocation.invoice_number || ''),
					quantity: 1,
					unit_price: allocation.amount,
					amount: allocation.amount,
					position_ids: allocation.position_ids || [],
				});
			});
		}
		if (open_lines.length > 0 && open_total > 0) {
			lines.push(...open_lines);
		}
		if (lines.length === 0) {
			if (target_type === 'open' && open_lines.length > 0 && open_total === amount) {
				lines = open_lines;
			} else {
				lines = [{
					description: target_type === 'invoice' && (payment_entry?.invoice_number || invoice?.document_number)
						? 'Zahlung zu Rechnung ' + (payment_entry?.invoice_number || invoice?.document_number)
						: (payment_entry?.description || 'Zahlung'),
					quantity: 1,
					unit_price: amount,
					amount,
					position_id: payment_entry?.id ? 'local:' + payment_entry.id : '',
					position_ids: payment_entry?.id ? ['local:' + payment_entry.id] : [],
				}];
			}
		} else {
			lines = accounting_document_merge_lines(lines);
		}
		const note_parts = [];
		const payment_date = payment_entry?.purchase_at || payment_entry?.created_at || registration_datetime_storage_value();
		note_parts.push('Ich bestätige den Zahlungseingang über ' + registration_money_label(amount) + ' am ' + registration_date_display_value(payment_date) + ' ' + accounting_payment_method_receipt_phrase(payment_entry?.payment_method) + '.');
		const settlement_sentence = accounting_receipt_settlement_sentence(allocations);
		if (settlement_sentence) {
			note_parts.push(settlement_sentence);
		}
		if (payment_entry?.note) {
			note_parts.push(payment_entry.note);
		}
		add_registration_accounting_document({
			...accounting_document_buyer_payload(account),
			document_type: 'receipt',
			status: 'paid',
			payment_entry_id: payment_entry?.id || '',
			payment_target_type: target_type,
			linked_invoice_id: payment_entry?.invoice_id || invoice?.id || '',
			linked_invoice_number: payment_entry?.invoice_number || invoice?.document_number || '',
			paid_position_ids: payment_entry?.paid_position_ids || [],
			payment_allocations: allocations,
			lines,
			total: amount,
			paid_total: amount,
			open_total: 0,
			note: note_parts.join('\n'),
			issued_at: payment_date,
		}, callback);
	}

	function add_registration_payment(event, account) {
		close_registration_payment_dialog();
		cbts_utils.esc_stack_push(close_registration_payment_dialog);
		const open_invoices = accounting_account_open_invoices(account);
		const open_position_groups = accounting_document_charge_summary_groups(account);
		const dialog_bg = uiu.el(uiu.qs('body'), 'div', 'dialog_bg registration_payment_dialog');
		dialog_bg.addEventListener('click', (e) => {
			if (e.target === dialog_bg) {
				close_registration_payment_dialog();
			}
		});
		const dialog = uiu.el(dialog_bg, 'div', 'dialog registration_payment_box');
		uiu.el(dialog, 'h3', {}, 'Zahlung annehmen');
		uiu.el(dialog, 'p', 'registration_receipt_player', accounting_account_label(account));
		if (open_invoices.length === 0 && open_position_groups.length === 0) {
			uiu.el(dialog, 'p', 'registration_empty', 'Keine offenen Rechnungen oder nicht fakturierten Positionen vorhanden.');
			const actions = uiu.el(dialog, 'div', 'registration_item_actions');
			const close_btn = uiu.el(actions, 'button', { type: 'button' }, 'Schließen');
			close_btn.addEventListener('click', close_registration_payment_dialog);
			close_btn.focus();
			return;
		}
		const form = uiu.el(dialog, 'form', 'registration_payment_form');
		uiu.el(form, 'span', 'registration_form_label', 'Zahlung zuordnen');
		const target_tree = uiu.el(form, 'div', 'accounting_document_selection accounting_payment_target_tree');
		const target_rows = uiu.el(target_tree, 'div', 'accounting_document_selection_rows');
		const amount_label = uiu.el(form, 'label');
		uiu.el(amount_label, 'span', {}, 'Betrag');
		const amount_input = uiu.el(amount_label, 'input', {
			type: 'text',
			name: 'amount',
			value: '0',
			inputmode: 'decimal',
			required: 'required',
			readonly: 'readonly',
		});
		const invoice_nodes = open_invoices.map((invoice) => ({
			type: 'invoice',
			invoice,
			amount: registration_money_number(invoice.open_total || 0),
			position_ids: accounting_document_position_ids(invoice),
			label: 'Rechnung ' + (invoice.document_number || ''),
			checked: true,
		}));
		function summary_amount(summaries) {
			return (summaries || []).reduce((sum, summary) => sum + registration_money_number(summary.amount), 0);
		}
		function node_amount(node) {
			if (node.type === 'invoice') {
				return node.amount;
			}
			return summary_amount(node.summaries);
		}
		function node_has_selection(node) {
			return !!node?.checkbox && (node.checkbox.checked || node.checkbox.indeterminate);
		}
		function node_is_fully_selected(node) {
			return !!node?.checkbox && node.checkbox.checked && !node.checkbox.indeterminate;
		}
		function update_parent_state(parent_checkbox, children) {
			const selected_count = children.filter(node_has_selection).length;
			const full_count = children.filter(node_is_fully_selected).length;
			parent_checkbox.checked = selected_count > 0 && full_count === children.length;
			parent_checkbox.indeterminate = selected_count > 0 && !parent_checkbox.checked;
		}
		function set_node_checked(node, checked) {
			if (!node?.checkbox) {
				return;
			}
			node.checkbox.checked = checked;
			node.checkbox.indeterminate = false;
			(node.children || []).forEach((child) => set_node_checked(child, checked));
		}
		function selected_summaries_from_node(node) {
			if (!node?.checkbox || (!node.checkbox.checked && !node.checkbox.indeterminate)) {
				return [];
			}
			const child_summaries = (node.children || []).flatMap(selected_summaries_from_node);
			if (node.checkbox.indeterminate || (node.prefer_children && child_summaries.length > 0)) {
				return child_summaries;
			}
			return node.summaries || [];
		}
		function selected_open_summaries() {
			const summaries = [];
			const keys = new Set();
			open_position_groups.forEach((group) => {
				if (!group.checkbox || (!group.checkbox.checked && !group.checkbox.indeterminate)) {
					return;
				}
				const child_summaries = (group.nodes || []).flatMap(selected_summaries_from_node);
				const picked = group.checkbox.indeterminate || (group.prefer_children && child_summaries.length > 0)
					? child_summaries
					: group.summaries;
				picked.forEach((summary) => {
					const key = (summary.position_ids || []).join('|') || [summary.category, summary.item_key, summary.label].join('|');
					if (!keys.has(key)) {
						keys.add(key);
						summaries.push(summary);
					}
				});
			});
			return summaries;
		}
		function selected_invoice_allocations() {
			return invoice_nodes
				.filter((node) => node.checkbox?.checked)
				.map((node) => ({
					target_type: 'invoice',
					amount: node.amount,
					invoice_id: node.invoice?.id || '',
					invoice_number: node.invoice?.document_number || '',
					position_ids: node.position_ids || [],
				}));
		}
		function selected_payment_allocations() {
			const allocations = selected_invoice_allocations();
			const summaries = selected_open_summaries();
			const open_amount = registration_money_number(summary_amount(summaries));
			if (open_amount > 0) {
				allocations.push({
					target_type: 'open',
					amount: open_amount,
					position_ids: accounting_summary_position_ids(summaries),
				});
			}
			return allocations;
		}
		function update_amount() {
			const amount = registration_money_number(selected_payment_allocations()
				.reduce((sum, allocation) => sum + registration_money_number(allocation.amount), 0));
			amount_input.value = String(amount || '').replace('.', ',');
			submit_btn.disabled = amount <= 0;
		}
		function render_payment_node(parent_el, node, level, checked, on_change) {
			const row = uiu.el(parent_el, 'div', 'accounting_document_selection_row accounting_document_selection_level_' + level);
			const has_children = (node.children || []).length > 0;
			const toggle = uiu.el(row, 'button', {
				type: 'button',
				'class': 'accounting_document_selection_toggle' + (has_children ? '' : ' accounting_document_selection_toggle_empty'),
			}, has_children ? (node.expanded ? '-' : '+') : '');
			const checkbox_attrs = { type: 'checkbox' };
			const node_checked = typeof node.checked === 'boolean' ? node.checked : checked;
			if (node_checked) {
				checkbox_attrs.checked = 'checked';
			}
			const checkbox = uiu.el(row, 'input', checkbox_attrs);
			node.checkbox = checkbox;
			uiu.el(row, 'span', {}, node.label);
			uiu.el(row, 'strong', {}, registration_money_label(node_amount(node)));
			const child_wrap = uiu.el(parent_el, 'div', 'accounting_document_selection_children');
			child_wrap.hidden = !node.expanded;
			(node.children || []).forEach((child) => render_payment_node(child_wrap, child, level + 1, node_checked, () => {
				update_parent_state(checkbox, node.children);
				on_change();
			}));
			toggle.addEventListener('click', () => {
				if (!has_children) {
					return;
				}
				child_wrap.hidden = !child_wrap.hidden;
				uiu.text(toggle, child_wrap.hidden ? '+' : '-');
			});
			checkbox.addEventListener('change', () => {
				checkbox.indeterminate = false;
				(node.children || []).forEach((child) => set_node_checked(child, checkbox.checked));
				on_change();
			});
		}
		if (invoice_nodes.length > 0) {
			const group = uiu.el(target_rows, 'section', 'accounting_document_selection_group');
			const header = uiu.el(group, 'div', 'accounting_document_selection_group_header');
			const toggle = uiu.el(header, 'button', { type: 'button', 'class': 'accounting_document_selection_toggle' }, '+');
			const checkbox = uiu.el(header, 'input', { type: 'checkbox', checked: 'checked' });
			uiu.el(header, 'span', {}, 'Offene Rechnungen');
			uiu.el(header, 'strong', {}, registration_money_label(invoice_nodes.reduce((sum, node) => sum + node.amount, 0)));
			const rows = uiu.el(group, 'div', 'accounting_document_selection_group_rows');
			rows.hidden = true;
			invoice_nodes.forEach((node) => render_payment_node(rows, node, 0, true, () => {
				update_parent_state(checkbox, invoice_nodes);
				update_amount();
			}));
			toggle.addEventListener('click', () => {
				rows.hidden = !rows.hidden;
				uiu.text(toggle, rows.hidden ? '+' : '-');
			});
			checkbox.addEventListener('change', () => {
				checkbox.indeterminate = false;
				invoice_nodes.forEach((node) => set_node_checked(node, checkbox.checked));
				update_amount();
			});
			update_parent_state(checkbox, invoice_nodes);
		}
		open_position_groups.forEach((group) => {
			group.checked = invoice_nodes.length === 0;
			const group_el = uiu.el(target_rows, 'section', 'accounting_document_selection_group');
			const group_header = uiu.el(group_el, 'div', 'accounting_document_selection_group_header');
			const has_children = group.nodes.length > 0;
			const toggle = uiu.el(group_header, 'button', {
				type: 'button',
				'class': 'accounting_document_selection_toggle' + (has_children ? '' : ' accounting_document_selection_toggle_empty'),
			}, has_children ? '+' : '');
			const checkbox_attrs = { type: 'checkbox' };
			if (group.checked) {
				checkbox_attrs.checked = 'checked';
			}
			const checkbox = uiu.el(group_header, 'input', checkbox_attrs);
			group.checkbox = checkbox;
			uiu.el(group_header, 'span', {}, 'Offene Posten: ' + group.label);
			uiu.el(group_header, 'strong', {}, registration_money_label(summary_amount(group.summaries)));
			const group_rows = uiu.el(group_el, 'div', 'accounting_document_selection_group_rows');
			group_rows.hidden = true;
			group.nodes.forEach((node) => render_payment_node(group_rows, node, 0, group.checked, () => {
				update_parent_state(checkbox, group.nodes);
				update_amount();
			}));
			toggle.addEventListener('click', () => {
				if (!has_children) {
					return;
				}
				group_rows.hidden = !group_rows.hidden;
				uiu.text(toggle, group_rows.hidden ? '+' : '-');
			});
			checkbox.addEventListener('change', () => {
				checkbox.indeterminate = false;
				group.nodes.forEach((node) => set_node_checked(node, checkbox.checked));
				update_amount();
			});
			update_parent_state(checkbox, group.nodes);
		});
		const method_label = uiu.el(form, 'label');
		uiu.el(method_label, 'span', {}, 'Zahlungsart');
		const method_select = uiu.el(method_label, 'select', { name: 'payment_method' });
		[
			['cash', 'Bar'],
			['transfer', 'Überweisung'],
			['card', 'Karte'],
			['other', 'Sonstiges'],
		].forEach(([value, label]) => uiu.el(method_select, 'option', { value }, label));
		const note_label = uiu.el(form, 'label');
		uiu.el(note_label, 'span', {}, 'Notiz');
		const note_input = uiu.el(note_label, 'input', {
			type: 'text',
			name: 'note',
			maxlength: '500',
			placeholder: 'Notiz',
		});
		uiu.el(form, 'p', 'accounting_payment_receipt_hint', 'Die Quittung wird automatisch erstellt.');
		const actions = uiu.el(form, 'div', 'registration_item_actions');
		const submit_btn = uiu.el(actions, 'button', { type: 'submit' }, 'Zahlung buchen');
		const close_btn = uiu.el(actions, 'button', { type: 'button' }, 'Schließen');
		close_btn.addEventListener('click', close_registration_payment_dialog);
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const allocations = selected_payment_allocations();
			const amount = registration_money_number(amount_input.value || 0);
			if (amount <= 0 || allocations.length === 0) {
				amount_input.focus();
				return;
			}
			const selected_open = selected_open_summaries();
			const invoice_allocations = allocations.filter((allocation) => allocation.target_type === 'invoice');
			const payment_target_type = allocations.length === 1 ? allocations[0].target_type : 'mixed';
			const paid_position_ids = [];
			allocations.forEach((allocation) => {
				(allocation.position_ids || []).forEach((id) => {
					if (!paid_position_ids.includes(id)) {
						paid_position_ids.push(id);
					}
				});
			});
			const btp_payment_transfers = accounting_payment_btp_transfers_for_allocations(allocations);
			const purchase_at = registration_datetime_storage_value();
			add_registration_accounting_entry({
				...accounting_account_base_entry(event, account),
				kind: 'payment',
				type: account?.account_type === 'player' ? 'entry_fee' : 'other',
				description: invoice_allocations.length === 1 && allocations.length === 1
					? 'Zahlung zu Rechnung ' + invoice_allocations[0].invoice_number
					: 'Zahlung',
				quantity: 1,
				unit_price: amount,
				amount,
				payment_method: method_select.value,
				payment_target_type,
				invoice_id: invoice_allocations.length === 1 ? invoice_allocations[0].invoice_id : '',
				invoice_number: invoice_allocations.length === 1 ? invoice_allocations[0].invoice_number : '',
				paid_position_ids,
				payment_allocations: allocations,
				btp_payment_transfers,
				note: note_input.value || '',
				purchase_at,
			}, function(err, response) {
				if (err) {
					return;
				}
				const payment_entry = response?.entry;
				if (payment_entry) {
					create_registration_receipt_document(account, payment_entry, function() {
						close_registration_payment_dialog();
					}, {
						payment_allocations: allocations,
						open_summaries: selected_open,
					});
				} else {
					close_registration_payment_dialog();
				}
			}, { refresh: false });
		});
		update_amount();
		submit_btn.focus();
	}

	function add_registration_catalog_item(event, account) {
		show_registration_item_bookings(account, { focus_new: true });
	}

	function close_registration_receipt_dialog() {
		const dialog = document.querySelector('.registration_receipt_dialog');
		if (!dialog) {
			return;
		}
		uiu.remove(dialog);
		cbts_utils.esc_stack_pop();
	}

	function render_registration_receipt_line(parent, label, amount, class_name) {
		const line = uiu.el(parent, 'div', 'registration_receipt_line ' + (class_name || ''));
		uiu.el(line, 'span', {}, label);
		uiu.el(line, 'strong', {}, registration_money_label(amount));
		return line;
	}

	function render_accounting_document_preview_header(parent) {
		const header = uiu.el(parent, 'div', 'accounting_document_preview_table_header');
		uiu.el(header, 'span', {}, 'Position');
		uiu.el(header, 'span', {}, 'Menge');
		uiu.el(header, 'span', {}, 'Einzelpreis');
		uiu.el(header, 'span', {}, 'Betrag');
	}

	function render_accounting_document_preview_position(parent, document, line) {
		const row = uiu.el(parent, 'div', 'accounting_document_preview_line');
		const quantity = registration_money_number(line.quantity || 1);
		uiu.el(row, 'span', 'accounting_document_preview_position', accounting_document_display_description(line));
		uiu.el(row, 'span', 'accounting_document_preview_quantity', accounting_document_quantity_label(quantity, line.sale_unit));
		uiu.el(row, 'span', 'accounting_document_preview_price', registration_money_label(line.unit_price || 0));
		uiu.el(row, 'strong', 'accounting_document_preview_amount', registration_money_label(line.amount || 0));

		accounting_document_visible_causes(document, line).forEach((cause) => {
			const detail = uiu.el(parent, 'div', 'accounting_document_preview_detail');
			uiu.el(detail, 'span', 'accounting_document_preview_position', cause.label);
			uiu.el(detail, 'span', 'accounting_document_preview_quantity', cause.detail || '');
			uiu.el(detail, 'span', 'accounting_document_preview_price', '');
			uiu.el(detail, 'strong', 'accounting_document_preview_amount', cause.amount !== undefined ? registration_money_label(cause.amount) : '');
		});
	}

	function render_accounting_document_preview_total(parent, label, amount, class_name) {
		const line = uiu.el(parent, 'div', 'accounting_document_preview_total_line ' + (class_name || ''));
		uiu.el(line, 'span', 'accounting_document_preview_total_label', label);
		uiu.el(line, 'strong', 'accounting_document_preview_amount', registration_money_label(amount));
	}

	function render_accounting_document_preview_payment(parent, document) {
		const payment = accounting_document_payment_details(document);
		const block = uiu.el(parent, 'div', 'accounting_document_preview_payment');
		uiu.el(block, 'strong', {}, 'Zahlungsfrist: bis ' + registration_date_display_value(payment.due_at));
		uiu.el(block, 'span', {}, 'Überweisung an: ' + payment.recipient);
		uiu.el(block, 'span', {}, 'IBAN: ' + payment.iban + '   BIC: ' + payment.bic);
		uiu.el(block, 'span', {}, 'Bank: ' + payment.bank);
	}

	function render_accounting_document_preview_closing(parent) {
		const settings = accounting_payment_settings();
		if (settings.signature_mode === 'none') {
			return;
		}
		const block = uiu.el(parent, 'div', 'accounting_document_preview_closing');
		const signature = uiu.el(block, 'div', 'accounting_document_preview_signature');
		uiu.el(signature, 'span', {}, accounting_document_signature_modes[settings.signature_mode] || 'Unterschrift');
	}

	function accounting_document_type_label(type) {
		return type === 'invoice' ? 'Rechnung' : 'Quittung';
	}

	function accounting_document_filename(document) {
		const number = String(document?.document_number || accounting_document_type_label(document?.document_type || 'invoice'))
			.replace(/[^A-Za-z0-9_.-]+/g, '_')
			.replace(/^_+|_+$/g, '');
		return (number || 'Beleg') + '.pdf';
	}

	function accounting_pdf_bytes_from_data_url(data_url) {
		const match = String(data_url || '').match(/^data:application\/pdf;base64,(.+)$/);
		if (!match) {
			return null;
		}
		const binary = atob(match[1]);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	function accounting_letterhead_pdf_for_page(page_index) {
		const first = String(curt?.accounting_letterhead_first_pdf || '');
		const follow = String(curt?.accounting_letterhead_follow_pdf || '');
		return page_index === 0 ? first : (follow || first);
	}

	function accounting_pdf_text(value) {
		return String(value == null ? '' : value)
			.replace(/\r/g, '')
			.replace(/[–—]/g, '-')
			.replace(/€/g, 'EUR')
			.replace(/[^\n\t\x20-\x7E\u00A0-\u00FF]/g, '?');
	}

	function accounting_pdf_wrap_text(text, font, size, max_width) {
		const raw_words = accounting_pdf_text(text).split(/\s+/).filter(Boolean);
		const words = [];
		const push_word_part = (part) => {
			if (!part) {
				return;
			}
			if (font.widthOfTextAtSize(part, size) <= max_width) {
				words.push(part);
				return;
			}
			let current_part = '';
			Array.from(part).forEach((char) => {
				const candidate = current_part + char;
				if (font.widthOfTextAtSize(candidate, size) <= max_width || !current_part) {
					current_part = candidate;
				} else {
					words.push(current_part);
					current_part = char;
				}
			});
			if (current_part) {
				words.push(current_part);
			}
		};
		raw_words.forEach((word) => {
			if (font.widthOfTextAtSize(word, size) <= max_width) {
				words.push(word);
				return;
			}
			const parts = word.split(/(?<=-)/);
			if (parts.length > 1) {
				parts.forEach(push_word_part);
			} else {
				push_word_part(word);
			}
		});
		const lines = [];
		let current = '';
		words.forEach((word) => {
			const candidate = current ? current + ' ' + word : word;
			if (font.widthOfTextAtSize(candidate, size) <= max_width || !current) {
				current = candidate;
			} else {
				lines.push(current);
				current = word;
			}
		});
		if (current) {
			lines.push(current);
		}
		return lines.length ? lines : [''];
	}

	function accounting_letterhead_legacy_document_area(header, area_key) {
		if (!header) {
			return null;
		}
		const x = registration_money_number(header.x);
		const y = registration_money_number(header.y);
		const width = registration_money_number(header.width);
		const height = Math.max(0, registration_money_number(header.height));
		if (area_key === 'document_title') {
			return { x, y, width, height: Math.min(height, 10) || 8 };
		}
		if (area_key === 'document_number') {
			return { x, y: y + Math.min(Math.max(height * 0.45, 7), 12), width, height: Math.min(height, 6) || 5 };
		}
		if (area_key === 'document_date') {
			return { x, y: y + Math.min(Math.max(height * 0.68, 12), 18), width, height: Math.min(height, 6) || 5 };
		}
		return null;
	}

	function accounting_letterhead_stored_area(stored, page_key, area_key) {
		const stored_area = stored?.[page_key]?.[area_key];
		if (stored_area) {
			return stored_area;
		}
		if (page_key !== 'first' || stored?.first?.event_title) {
			return null;
		}
		const old_content = stored?.first?.content;
		if (!old_content) {
			return null;
		}
		const x = registration_money_number(old_content.x);
		const y = registration_money_number(old_content.y);
		const width = registration_money_number(old_content.width);
		const height = Math.max(0, registration_money_number(old_content.height));
		if (area_key === 'event_title') {
			return { x, y, width, height: 7 };
		}
		if (area_key === 'content') {
			const offset = 9.5;
			return { x, y: y + offset, width, height: Math.max(10, height - offset) };
		}
		return null;
	}

	function accounting_letterhead_layout() {
		const stored = curt?.accounting_letterhead_layout && typeof curt.accounting_letterhead_layout === 'object'
			? curt.accounting_letterhead_layout
			: {};
		const result = {};
		Object.keys(accounting_letterhead_default_layout).forEach((page_key) => {
			result[page_key] = {};
			Object.keys(accounting_letterhead_default_layout[page_key]).forEach((area_key) => {
				const legacy_area = accounting_letterhead_legacy_document_area(stored?.[page_key]?.header, area_key);
				const stored_area = accounting_letterhead_stored_area(stored, page_key, area_key);
				result[page_key][area_key] = {
					...accounting_letterhead_default_layout[page_key][area_key],
					...(legacy_area || {}),
					...(stored_area || {}),
				};
			});
		});
		return result;
	}

	function accounting_letterhead_area(layout, page_index, area_key) {
		const page_key = page_index === 0 ? 'first' : 'follow';
		return layout?.[page_key]?.[area_key] || accounting_letterhead_default_layout[page_key][area_key];
	}

	function accounting_pdf_mm(value) {
		return registration_money_number(value) * 72 / 25.4;
	}

	function accounting_pdf_rect(page_width, page_height, layout, page_index, area_key) {
		const area = accounting_letterhead_area(layout, page_index, area_key);
		const x = accounting_pdf_mm(area.x);
		const y_top = page_height - accounting_pdf_mm(area.y);
		const width = accounting_pdf_mm(area.width);
		const height = accounting_pdf_mm(area.height);
		return {
			x,
			y_top,
			y_bottom: y_top - height,
			width,
			height,
			right: x + width,
		};
	}

	async function accounting_pdf_add_page(pdf_doc, page_index) {
		const background = accounting_letterhead_pdf_for_page(page_index);
		const background_bytes = accounting_pdf_bytes_from_data_url(background);
		if (background_bytes && typeof PDFLib !== 'undefined') {
			try {
				const background_doc = await PDFLib.PDFDocument.load(background_bytes, { ignoreEncryption: true });
				const [background_page] = await pdf_doc.copyPages(background_doc, [0]);
				pdf_doc.addPage(background_page);
				return background_page;
			} catch (err) {
				console.warn('Briefpapier-PDF konnte nicht gelesen werden', err);
			}
		}
		return pdf_doc.addPage([595.28, 841.89]);
	}

	async function make_accounting_document_pdf(document, options = {}) {
		if (typeof PDFLib === 'undefined' || !PDFLib.PDFDocument) {
			throw new Error('PDF-Bibliothek nicht geladen.');
		}
		document = accounting_document_with_payment_status(document);
		const pdf_doc = await PDFLib.PDFDocument.create();
		if (typeof pdf_doc.setTitle === 'function') {
			pdf_doc.setTitle(accounting_document_filename(document).replace(/\.pdf$/i, ''));
		}
		const font = await pdf_doc.embedFont(PDFLib.StandardFonts.Helvetica);
		const bold = await pdf_doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
		const pages = [];
		const letterhead_layout = options.letterhead_layout
			? clone_accounting_letterhead_layout(options.letterhead_layout)
			: accounting_letterhead_layout();
		const first_page_number_enabled = Object.prototype.hasOwnProperty.call(options, 'first_page_number_enabled')
			? !!options.first_page_number_enabled
			: accounting_first_page_number_enabled();
		let page = null;
		let width = 0;
		let height = 0;
		let y = 0;
		let content_rect = null;
		let document_title_rect = null;
		let document_number_rect = null;
		let document_date_rect = null;
		let event_title_rect = null;
		let address_rect = null;

		const draw = (text, x, line_y, options = {}) => {
			page.drawText(accounting_pdf_text(text), {
				x,
				y: line_y,
				size: options.size || 10,
				font: options.bold ? bold : font,
				color: options.color || PDFLib.rgb(0.12, 0.16, 0.21),
			});
		};
		const draw_right = (text, right, line_y, options = {}) => {
			const size = options.size || 10;
			const use_font = options.bold ? bold : font;
			const safe_text = accounting_pdf_text(text);
			page.drawText(safe_text, {
				x: right - use_font.widthOfTextAtSize(safe_text, size),
				y: line_y,
				size,
				font: use_font,
				color: options.color || PDFLib.rgb(0.12, 0.16, 0.21),
			});
		};
		const draw_line = (from_x, to_x, line_y, color = PDFLib.rgb(0.78, 0.82, 0.86)) => {
			page.drawLine({ start: { x: from_x, y: line_y }, end: { x: to_x, y: line_y }, thickness: 0.6, color });
		};
		const draw_watermark = () => {
			if (!options.watermark) {
				return;
			}
			const text = accounting_pdf_text(options.watermark);
			const size = Math.min(100, width / Math.max(1.7, text.length * 0.36));
			page.drawText(text, {
				x: width * 0.14,
				y: height * 0.36,
				size,
				font: bold,
				color: PDFLib.rgb(0.62, 0.66, 0.70),
				opacity: 0.18,
				rotate: PDFLib.degrees(35),
			});
		};
		const draw_positioned_text = (rect, text, requested_size, is_bold) => {
			if (!rect || !text) {
				return;
			}
			const size = Math.min(requested_size, Math.max(7, rect.height));
			let line_y = rect.y_top - size;
			if (line_y < rect.y_bottom + 1) {
				line_y = rect.y_bottom + 1;
			}
			draw(text, rect.x, line_y, { size, bold: is_bold });
		};
		const draw_document_header = (compact) => {
			draw_positioned_text(document_title_rect, accounting_document_type_label(document.document_type), compact ? 11 : 19, true);
			draw_positioned_text(document_number_rect, document.document_number || '', compact ? 9 : 10, true);
			draw_positioned_text(document_date_rect, registration_date_display_value(document.issued_at || document.created_at), 9, false);
		};
		const draw_address = () => {
			if (!address_rect) {
				return;
			}
			const recipient_name = document.buyer_name || document.player_name || '';
			const lines = [
				document.buyer_type === 'state' && recipient_name ? { text: 'Landesverband', size: 8, bold: false, gap_after: 5 } : null,
				recipient_name ? { text: recipient_name, size: 12, bold: true } : null,
				document.club && document.club !== document.buyer_name ? { text: document.club, size: 9 } : null,
				document.state && document.state !== document.club && document.state !== document.buyer_name ? { text: document.state, size: 9 } : null,
			].filter(Boolean);
			let address_y = address_rect.y_top - 8;
			lines.forEach((line) => {
				const line_font = line.bold ? bold : font;
				accounting_pdf_wrap_text(line.text, line_font, line.size, address_rect.width).forEach((wrapped) => {
					if (address_y < address_rect.y_bottom + line.size) {
						return;
					}
					draw(wrapped, address_rect.x, address_y, { size: line.size, bold: line.bold });
					address_y -= line.size + (line.gap_after || 2);
				});
			});
		};
		const new_page = async () => {
			const page_index = pages.length;
			page = await accounting_pdf_add_page(pdf_doc, page_index);
			pages.push(page);
			({ width, height } = page.getSize());
			content_rect = accounting_pdf_rect(width, height, letterhead_layout, page_index, 'content');
			document_title_rect = accounting_letterhead_area(letterhead_layout, page_index, 'document_title')
				? accounting_pdf_rect(width, height, letterhead_layout, page_index, 'document_title')
				: null;
			document_number_rect = accounting_letterhead_area(letterhead_layout, page_index, 'document_number')
				? accounting_pdf_rect(width, height, letterhead_layout, page_index, 'document_number')
				: null;
			document_date_rect = accounting_letterhead_area(letterhead_layout, page_index, 'document_date')
				? accounting_pdf_rect(width, height, letterhead_layout, page_index, 'document_date')
				: null;
			event_title_rect = accounting_letterhead_area(letterhead_layout, page_index, 'event_title')
				? accounting_pdf_rect(width, height, letterhead_layout, page_index, 'event_title')
				: null;
			address_rect = page_index === 0 ? accounting_pdf_rect(width, height, letterhead_layout, page_index, 'address') : null;
			y = content_rect.y_top;
			draw_watermark();
			if (pages.length > 1) {
				draw_document_header(true);
			}
		};
		const draw_table_header = () => {
			const table_width = content_rect.width;
			const qty_x = content_rect.x + table_width * 0.53;
			const amount_right = content_rect.right;
			const header_y = y - 9;
			draw('Position', content_rect.x, header_y, { size: 9, bold: true });
			draw('Menge', qty_x, header_y, { size: 9, bold: true });
			draw_right('Einzelpreis', amount_right - 70, header_y, { size: 9, bold: true });
			draw_right('Betrag', amount_right, header_y, { size: 9, bold: true });
			draw_line(content_rect.x, amount_right, header_y - 5);
			y = header_y - 20;
			return { table_width, qty_x, amount_right };
		};
		const ensure_space = async (needed) => {
			if (content_rect && y - needed >= content_rect.y_bottom) {
				return;
			}
			await new_page();
			draw_table_header();
		};
		const draw_event_period = () => {
			const event_period = accounting_event_period_label();
			if (!event_period) {
				return;
			}
			const anchor_rect = event_title_rect || content_rect;
			const size = 9;
			const line_gap = 10;
			const period_x = anchor_rect.x;
			const period_width = anchor_rect.width || content_rect.width;
			const period_lines = accounting_pdf_wrap_text(event_period, font, size, period_width);
			let period_y = event_title_rect ? event_title_rect.y_bottom - 4 : y - 2;
			period_lines.forEach((line, index) => {
				draw(line, period_x, period_y - index * line_gap, { size, color: PDFLib.rgb(0.36, 0.42, 0.48) });
			});
			y = Math.min(y, period_y - period_lines.length * line_gap - 2);
		};

		await new_page();
		draw_document_header(false);
		draw_address();
		draw_positioned_text(event_title_rect, curt?.name || 'Turnier', 12, true);
		draw_event_period();

		let columns = draw_table_header();
		for (const line of accounting_receipt_display_lines(document)) {
			const description_lines = accounting_pdf_wrap_text(accounting_document_display_description(line), font, 10, columns.qty_x - content_rect.x - 12);
			const caused_by = accounting_document_visible_causes(document, line);
			const caused_by_chunks = caused_by.map((cause) => ({
				cause,
				lines: accounting_pdf_wrap_text(cause.label, font, 8, columns.amount_right - content_rect.x - 80),
				detail_lines: cause.detail ? accounting_pdf_wrap_text(cause.detail, font, 7, Math.max(40, columns.amount_right - 76 - columns.qty_x)) : [],
			}));
			const row_height = Math.max(18, description_lines.length * 12 + 6);
			const first_caused_by_height = caused_by_chunks.slice(0, 3).reduce((sum, chunk) => {
				return sum + Math.max(chunk.lines.length, chunk.detail_lines.length || 1) * 9;
			}, 0);
			const initial_caused_by_height = caused_by_chunks.length > 0
				? Math.max(9, Math.min(first_caused_by_height, 36)) + 4
				: 4;
			await ensure_space(row_height + initial_caused_by_height);
			columns = {
				table_width: content_rect.width,
				qty_x: content_rect.x + content_rect.width * 0.53,
				amount_right: content_rect.right,
			};
			description_lines.forEach((description_line, index) => {
				draw(description_line, content_rect.x, y - index * 12, { size: 10 });
			});
			const quantity = registration_money_number(line.quantity || 1);
			const quantity_label = accounting_document_quantity_label(quantity, line.sale_unit);
			draw(quantity_label, columns.qty_x, y, { size: 10 });
			draw_right(registration_money_label(line.unit_price || 0), columns.amount_right - 70, y, { size: 10 });
			draw_right(registration_money_label(line.amount || 0), columns.amount_right, y, { size: 10, bold: true });
			if (caused_by_chunks.length === 0) {
				y -= row_height;
				continue;
			}
			y -= Math.max(11, description_lines.length * 12 + 1);
			for (const chunk of caused_by_chunks) {
				const detail_line_count = Math.max(chunk.lines.length, chunk.detail_lines.length || 1);
				await ensure_space(detail_line_count * 9 + 1);
				for (let index = 0; index < detail_line_count; index += 1) {
					const cause_line = chunk.lines[index] || '';
					const detail_line = chunk.detail_lines[index] || '';
					draw(cause_line, content_rect.x + 8, y - index * 9, { size: 8, color: PDFLib.rgb(0.36, 0.42, 0.48) });
					if (detail_line) {
						draw(detail_line, columns.qty_x, y - index * 9, { size: 7, color: PDFLib.rgb(0.46, 0.52, 0.58) });
					}
				}
				if (chunk.cause.amount !== undefined) {
					draw_right(registration_money_label(chunk.cause.amount), columns.amount_right, y, { size: 8, color: PDFLib.rgb(0.36, 0.42, 0.48) });
				}
				y -= detail_line_count * 9;
			}
			y -= 10;
		}

		await ensure_space(document.document_type === 'invoice' ? 150 : 62);
		draw_line(content_rect.x, content_rect.right, y + 7, PDFLib.rgb(0.52, 0.59, 0.66));
		const right = content_rect.right;
		const sum_left = Math.max(content_rect.x, right - 190);
		draw('Summe', sum_left, y - 10, { size: 11, bold: true });
		draw_right(registration_money_label(document.total || 0), right, y - 10, { size: 11, bold: true });
		y -= 26;
		if (document.document_type === 'invoice') {
			draw('Bereits gezahlt', sum_left, y, { size: 10 });
			draw_right(registration_money_label(document.paid_total || 0), right, y, { size: 10 });
			y -= 18;
			draw('Offen', sum_left, y, { size: 12, bold: true });
			draw_right(registration_money_label(document.open_total || 0), right, y, { size: 12, bold: true, color: PDFLib.rgb(0.58, 0.18, 0.11) });
			y -= 30;
			const payment = accounting_document_payment_details(document);
			draw('Zahlungsfrist: bis ' + registration_date_display_value(payment.due_at), content_rect.x, y, { size: 10, bold: true });
			y -= 14;
			draw('Überweisung an: ' + payment.recipient, content_rect.x, y, { size: 10 });
			y -= 12;
			draw('IBAN: ' + payment.iban + '   BIC: ' + payment.bic, content_rect.x, y, { size: 10 });
			y -= 12;
			draw('Bank: ' + payment.bank, content_rect.x, y, { size: 10 });
			y -= 20;
		}
		if (document.note) {
			accounting_pdf_wrap_text(document.note, font, 10, content_rect.width).forEach((note_line) => {
				draw(note_line, content_rect.x, y, { size: 10 });
				y -= 12;
			});
		}
		const signature_mode = accounting_payment_settings().signature_mode;
		if (signature_mode !== 'none') {
			await ensure_space(56);
			y -= document.note ? 16 : 10;
			const signature_width = Math.min(220, content_rect.width * 0.55);
			const signature_y = y - 32;
			draw_line(content_rect.x, content_rect.x + signature_width, signature_y, PDFLib.rgb(0.52, 0.59, 0.66));
			draw(accounting_document_signature_modes[signature_mode] || 'Unterschrift', content_rect.x, signature_y - 12, { size: 8, color: PDFLib.rgb(0.36, 0.42, 0.48) });
		}

		const total_pages = pdf_doc.getPageCount();
		pdf_doc.getPages().forEach((pdf_page, index) => {
			if (index === 0 && !first_page_number_enabled) {
				return;
			}
			const size = pdf_page.getSize();
			const footer_rect = accounting_pdf_rect(size.width, size.height, letterhead_layout, index, 'footer');
			const page_label = 'Seite ' + (index + 1) + ' / ' + total_pages;
			pdf_page.drawText(page_label, {
				x: footer_rect.right - font.widthOfTextAtSize(page_label, 8),
				y: footer_rect.y_bottom + 2,
				size: 8,
				font,
				color: PDFLib.rgb(0.36, 0.42, 0.48),
			});
		});
		return pdf_doc.save();
	}

	async function download_accounting_document_pdf(document, options = {}) {
		const bytes = await make_accounting_document_pdf(document, options);
		save_file(accounting_document_pdf_file(document, bytes), accounting_document_filename(document));
	}

	function accounting_document_pdf_file(document, bytes) {
		const filename = accounting_document_filename(document);
		try {
			return new File([bytes], filename, { type: 'application/pdf' });
		} catch (err) {
			return new Blob([bytes], { type: 'application/pdf' });
		}
	}

	async function open_accounting_document_pdf(document, options = {}) {
		const filename = accounting_document_filename(document);
		const key = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
		const can_use_viewer = typeof BroadcastChannel === 'function';
		let pdf_window = null;
		let channel = null;
		let viewer_ready = false;
		let pending_bytes = null;
		function send_pending_pdf() {
			if (!channel || !viewer_ready || !pending_bytes) {
				return;
			}
			const bytes = pending_bytes;
			const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
			channel.postMessage({ type: 'pdf', filename, bytes: buffer });
			pending_bytes = null;
		}
		try {
			if (can_use_viewer) {
				const viewer_url = '/admin/pdf-viewer/' + encodeURIComponent(filename) +
					'?key=' + encodeURIComponent(key) +
					(options.print_on_load ? '&print=1' : '');
				channel = new BroadcastChannel('bts-accounting-pdf-' + key);
				channel.onmessage = function(event) {
					if (event.data && event.data.type === 'ready') {
						viewer_ready = true;
						send_pending_pdf();
					}
				};
				pdf_window = window.open(viewer_url, '_blank');
			} else {
				pdf_window = window.open('', '_blank');
				if (pdf_window) {
					pdf_window.document.title = filename;
					pdf_window.document.body.textContent = 'PDF wird erstellt ...';
				}
			}
		} catch (err) {
			pdf_window = null;
		}
		let bytes = null;
		try {
			bytes = await make_accounting_document_pdf(document, options);
		} catch (err) {
			if (channel) {
				channel.postMessage({ type: 'error', message: 'PDF konnte nicht erstellt werden.' });
				channel.close();
			}
			if (pdf_window) {
				pdf_window.close();
			}
			throw err;
		}
		const file = accounting_document_pdf_file(document, bytes);
		if (!pdf_window) {
			if (channel) {
				channel.close();
			}
			save_file(file, filename);
			return;
		}
		if (channel) {
			pending_bytes = bytes;
			send_pending_pdf();
			setTimeout(function() {
				if (pending_bytes) {
					pending_bytes = null;
					pdf_window.location.href = URL.createObjectURL(file);
				}
				channel.close();
			}, 5000);
			return;
		}
		const url = URL.createObjectURL(file);
		pdf_window.location.href = url;
	}

	async function print_accounting_document_pdf(accounting_document, options = {}) {
		const bytes = await make_accounting_document_pdf(accounting_document, options);
		const file = accounting_document_pdf_file(accounting_document, bytes);
		const url = URL.createObjectURL(file);
		const frame = window.document.createElement('iframe');
		let cleanup_timer = null;
		function cleanup() {
			if (cleanup_timer) {
				window.clearTimeout(cleanup_timer);
			}
			URL.revokeObjectURL(url);
			uiu.remove(frame);
		}
		frame.setAttribute('aria-hidden', 'true');
		frame.style.border = '0';
		frame.style.height = '1px';
		frame.style.left = '-10000px';
		frame.style.opacity = '0';
		frame.style.position = 'fixed';
		frame.style.top = '0';
		frame.style.width = '1px';
		return new Promise((resolve, reject) => {
			frame.addEventListener('load', function() {
				cleanup_timer = window.setTimeout(cleanup, 120000);
				try {
					if (frame.contentWindow) {
						frame.contentWindow.focus();
						frame.contentWindow.print();
						resolve();
						return;
					}
					cleanup();
					reject(new Error('PDF konnte nicht gedruckt werden.'));
				} catch (err) {
					cleanup();
					reject(err);
				}
			}, { once: true });
			frame.addEventListener('error', function() {
				cleanup();
				reject(new Error('PDF konnte nicht geladen werden.'));
			}, { once: true });
			window.document.body.appendChild(frame);
			frame.src = url;
		});
	}

	function create_registration_invoice_document(account, summaries, callback) {
		const lines = accounting_document_merge_lines((summaries || []).map(accounting_document_line_from_summary))
			.filter((line) => registration_money_number(line.amount) > 0);
		if (lines.length === 0) {
			alert('Keine freien Rechnungspositionen ausgewählt.');
			return;
		}
		const total = registration_money_number(lines.reduce((sum, line) => sum + registration_money_number(line.amount), 0));
		const issued_at = registration_datetime_storage_value();
		const payment = accounting_payment_settings();
		add_registration_accounting_document({
			...accounting_document_buyer_payload(account),
			document_type: 'invoice',
			status: 'issued',
			lines,
			total,
			paid_total: 0,
			open_total: total,
			payment_recipient: payment.recipient,
			payment_bank: payment.bank,
			payment_iban: payment.iban,
			payment_bic: payment.bic,
			due_at: accounting_invoice_due_at(issued_at, payment.due_days),
			note: 'Bitte überweisen Sie den offenen Betrag unter Angabe der Rechnungsnummer.',
			issued_at,
		}, callback);
	}

	function create_registration_paid_total_receipt_document(account, summaries, callback) {
		const lines = accounting_document_merge_lines((summaries || []).map(accounting_document_line_from_summary))
			.filter((line) => registration_money_number(line.amount) > 0);
		if (lines.length === 0) {
			alert('Keine freien Zahlungspositionen ausgewählt.');
			return;
		}
		const amount = registration_money_number(lines.reduce((sum, line) => sum + registration_money_number(line.amount), 0));
		add_registration_accounting_document({
			...accounting_document_buyer_payload(account),
			document_type: 'receipt',
			status: 'paid',
			lines,
			total: amount,
			paid_total: amount,
			open_total: 0,
			issued_at: registration_datetime_storage_value(),
		}, callback);
	}

	function render_accounting_document_preview(parent, document) {
		document = accounting_document_with_payment_status(document);
		const preview = uiu.el(parent, 'section', 'accounting_document_preview');
		const heading = uiu.el(preview, 'div', 'accounting_document_heading');
		uiu.el(heading, 'h4', {}, accounting_document_type_label(document.document_type) + ' ' + (document.document_number || ''));
		uiu.el(heading, 'span', {}, registration_date_display_value(document.issued_at || document.created_at));
		uiu.el(preview, 'p', 'registration_receipt_player', document.buyer_name || document.player_name || '');
		const event_period = accounting_event_period_label();
		if (event_period) {
			const event_info = uiu.el(preview, 'p', 'accounting_document_event_period');
			uiu.el(event_info, 'strong', {}, curt?.name || 'Turnier');
			uiu.el(event_info, 'span', {}, event_period);
		}
		const meta = uiu.el(preview, 'dl', 'accounting_document_meta');
		uiu.el(meta, 'dt', {}, 'Status');
		uiu.el(meta, 'dd', {}, document.status === 'paid' ? 'bezahlt' : 'offen');
		if (document.due_at) {
			uiu.el(meta, 'dt', {}, 'Fällig');
			uiu.el(meta, 'dd', {}, registration_datetime_display_value(document.due_at));
		}
		const lines = uiu.el(preview, 'div', 'registration_receipt_lines accounting_document_preview_lines');
		render_accounting_document_preview_header(lines);
		accounting_receipt_display_lines(document).forEach((line) => {
			render_accounting_document_preview_position(lines, document, line);
		});
		render_accounting_document_preview_total(lines, 'Summe', document.total || 0, 'registration_receipt_total');
		if (document.document_type === 'invoice') {
			render_accounting_document_preview_total(lines, 'Bereits gezahlt', document.paid_total || 0, 'registration_receipt_paid');
			render_accounting_document_preview_total(lines, 'Offen', document.open_total || 0, 'registration_receipt_open');
			render_accounting_document_preview_payment(lines, document);
		}
		if (document.note) {
			uiu.el(preview, 'p', 'accounting_document_note', document.note);
		}
		render_accounting_document_preview_closing(preview);
	}

	function render_accounting_document_selection(parent, account, document_type, callback) {
		uiu.empty(parent);
		const groups = document_type === 'invoice'
			? accounting_document_charge_summary_groups(account)
			: accounting_document_payment_summary_groups(account);
		const title = document_type === 'invoice' ? 'Rechnungspositionen' : 'Zahlungspositionen';
		const form = uiu.el(parent, 'form', 'accounting_document_selection');
		uiu.el(form, 'h4', {}, title);
		if (groups.length === 0) {
			uiu.el(form, 'div', 'accounting_item_empty', document_type === 'invoice'
				? 'Keine freien Rechnungspositionen vorhanden.'
				: 'Keine freien Zahlungspositionen vorhanden.');
			return;
		}
		const rows = uiu.el(form, 'div', 'accounting_document_selection_rows');
		const total = uiu.el(form, 'strong', 'accounting_document_selection_total', '');
		function summary_amount(summaries) {
			return (summaries || []).reduce((sum, summary) => sum + registration_money_number(summary.amount), 0);
		}
		function node_has_selection(node) {
			return !!node?.checkbox && (node.checkbox.checked || node.checkbox.indeterminate);
		}
		function node_is_fully_selected(node) {
			return !!node?.checkbox && node.checkbox.checked && !node.checkbox.indeterminate;
		}
		function selected_summaries_from_node(node) {
			if (!node?.checkbox || (!node.checkbox.checked && !node.checkbox.indeterminate)) {
				return [];
			}
			if (node_is_fully_selected(node) && !node.prefer_children) {
				return node.summaries || [];
			}
			const child_summaries = (node.children || []).flatMap(selected_summaries_from_node);
			return child_summaries.length > 0 ? child_summaries : (node.summaries || []);
		}
		function selected_summaries() {
			return groups.flatMap((group) => {
				if (!group.checkbox || (!group.checkbox.checked && !group.checkbox.indeterminate)) {
					return [];
				}
				if (group.checkbox.checked && !group.checkbox.indeterminate && !group.prefer_children) {
					return group.summaries || [];
				}
				const node_summaries = (group.nodes || []).flatMap(selected_summaries_from_node);
				return node_summaries.length > 0 ? node_summaries : (group.summaries || []);
			});
		}
		function update_total() {
			const amount = selected_summaries().reduce((sum, summary) => sum + registration_money_number(summary.amount), 0);
			uiu.text(total, 'Summe ' + registration_money_label(amount));
		}
		function update_parent_state(parent_checkbox, children) {
			const selected_count = children.filter(node_has_selection).length;
			const full_count = children.filter(node_is_fully_selected).length;
			parent_checkbox.checked = selected_count > 0 && full_count === children.length;
			parent_checkbox.indeterminate = selected_count > 0 && !parent_checkbox.checked;
		}
		function render_node(parent_el, node, level, checked, on_change) {
			const row = uiu.el(parent_el, 'div', 'accounting_document_selection_row accounting_document_selection_level_' + level);
			const has_children = (node.children || []).length > 0;
			const toggle = uiu.el(row, 'button', {
				type: 'button',
				'class': 'accounting_document_selection_toggle' + (has_children ? '' : ' accounting_document_selection_toggle_empty'),
			}, has_children ? (node.expanded ? '-' : '+') : '');
			const checkbox_attrs = { type: 'checkbox' };
			const node_checked = typeof node.checked === 'boolean' ? node.checked : checked;
			if (node_checked) {
				checkbox_attrs.checked = 'checked';
			}
			const checkbox = uiu.el(row, 'input', checkbox_attrs);
			node.checkbox = checkbox;
			uiu.el(row, 'span', {}, node.label);
			uiu.el(row, 'strong', {}, registration_money_label(summary_amount(node.summaries)));
			const child_wrap = uiu.el(parent_el, 'div', 'accounting_document_selection_children');
			child_wrap.hidden = !node.expanded;
			(node.children || []).forEach((child) => render_node(child_wrap, child, level + 1, node_checked, () => {
				update_parent_state(checkbox, node.children);
				on_change();
			}));
			toggle.addEventListener('click', () => {
				if (!has_children) {
					return;
				}
				child_wrap.hidden = !child_wrap.hidden;
				uiu.text(toggle, child_wrap.hidden ? '+' : '-');
			});
			checkbox.addEventListener('change', () => {
				checkbox.indeterminate = false;
				(node.children || []).forEach((child) => set_node_checked(child, checkbox.checked));
				on_change();
			});
			return node;
		}
		function set_node_checked(node, checked) {
			if (!node?.checkbox) {
				return;
			}
			node.checkbox.checked = checked;
			node.checkbox.indeterminate = false;
			(node.children || []).forEach((child) => set_node_checked(child, checked));
		}
		groups.forEach((group, group_index) => {
			const group_el = uiu.el(rows, 'section', 'accounting_document_selection_group');
			if (!Array.isArray(group.nodes) || group.nodes.length === 0) {
				group.nodes = group.summaries.map((summary) => accounting_document_selection_node(accounting_summary_label(summary), [summary]));
			}
			const group_header = uiu.el(group_el, 'div', 'accounting_document_selection_group_header');
			const has_children = group.nodes.length > 0;
			const toggle = uiu.el(group_header, 'button', {
				type: 'button',
				'class': 'accounting_document_selection_toggle' + (has_children ? '' : ' accounting_document_selection_toggle_empty'),
			}, has_children ? '+' : '');
			const group_checkbox_attrs = {
				type: 'checkbox',
			};
			if (group.checked) {
				group_checkbox_attrs.checked = 'checked';
			}
			const group_checkbox = uiu.el(group_header, 'input', group_checkbox_attrs);
			group.checkbox = group_checkbox;
			uiu.el(group_header, 'span', {}, group.label);
			uiu.el(group_header, 'strong', {}, registration_money_label(summary_amount(group.summaries)));
			const group_rows = uiu.el(group_el, 'div', 'accounting_document_selection_group_rows');
			group_rows.hidden = true;
			group.nodes.forEach((node) => render_node(group_rows, node, 0, group.checked, () => {
				update_parent_state(group_checkbox, group.nodes);
				update_total();
			}));
			toggle.addEventListener('click', () => {
				if (!has_children) {
					return;
				}
				group_rows.hidden = !group_rows.hidden;
				uiu.text(toggle, group_rows.hidden ? '+' : '-');
			});
			group_checkbox.addEventListener('change', () => {
				group_checkbox.indeterminate = false;
				group.nodes.forEach((node) => set_node_checked(node, group_checkbox.checked));
				update_total();
			});
			update_parent_state(group_checkbox, group.nodes);
		});
		update_total();
		const actions = uiu.el(form, 'div', 'registration_item_actions');
		const create_btn = uiu.el(actions, 'button', { type: 'submit' }, document_type === 'invoice' ? 'Rechnung erstellen' : 'Quittung erstellen');
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const picked = selected_summaries();
			if (document_type === 'invoice') {
				create_registration_invoice_document(account, picked, callback);
			} else {
				create_registration_paid_total_receipt_document(account, picked, callback);
			}
		});
		create_btn.focus();
	}

	function accounting_summary_quantity_label(quantity) {
		const number = registration_money_number(quantity || 0);
		return number.toLocaleString('de-DE', {
			minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
			maximumFractionDigits: 2,
		}) + 'x';
	}

	function accounting_summary_label(summary) {
		const prefix = summary.prefix ? summary.prefix + ': ' : '';
		const sale_unit = String(summary.sale_unit || '').trim();
		return prefix + accounting_summary_quantity_label(summary.quantity) + ' ' + summary.label +
			(sale_unit ? ' je ' + sale_unit : '');
	}

	function accounting_summary_document_label(summary) {
		const prefix = summary.prefix ? summary.prefix + ': ' : '';
		if (summary.category === 'local_charge') {
			return summary.label || 'Position';
		}
		return prefix + (summary.label || 'Position');
	}

	function accounting_escape_regexp(text) {
		return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function accounting_document_display_description(line) {
		let description = String(line?.description || 'Position').trim();
		description = description.replace(/^\s*\d{2}\.\d{2}\.\d{4},\s*\d{2}:\d{2}:\s*/, '');
		const quantity = registration_money_number(line?.quantity || 0);
		if (quantity > 0) {
			description = description.replace(
				new RegExp('^\\s*' + accounting_escape_regexp(accounting_summary_quantity_label(quantity)) + '\\s+', 'i'),
				''
			);
		}
		const sale_unit = String(line?.sale_unit || '').trim();
		if (sale_unit) {
			description = description.replace(new RegExp('\\s+je\\s+' + accounting_escape_regexp(sale_unit) + '\\s*$', 'i'), '');
		}
		return description || 'Position';
	}

	function accounting_document_detail_from_description(line) {
		const description = String(line?.description || '').trim();
		const match = description.match(/^\s*(\d{2}\.\d{2}\.\d{4},\s*\d{2}:\d{2}):\s*/);
		if (!match) {
			return '';
		}
		const quantity = registration_money_number(line?.quantity || 0);
		const quantity_label = quantity > 0 ? accounting_document_quantity_label(quantity, line?.sale_unit || '') : '';
		return [match[1], quantity_label].filter(Boolean).join(', ');
	}

	function accounting_plural_sale_unit(unit, quantity) {
		const text = String(unit || '').trim();
		const amount = registration_money_number(quantity);
		if (!text || amount === 1) {
			return text;
		}
		const plural_map = {
			Meldung: 'Meldungen',
			Disziplin: 'Disziplinen',
			Rolle: 'Rollen',
			Ball: 'Bälle',
			Teilnehmer: 'Teilnehmer',
			Stk: 'Stk.',
			'Stk.': 'Stk.',
		};
		if (plural_map[text]) {
			return plural_map[text];
		}
		const roll_match = text.match(/^Rolle(\s+.+)$/);
		if (roll_match) {
			return 'Rollen' + roll_match[1];
		}
		if (/ung$/i.test(text)) {
			return text + 'en';
		}
		return text;
	}

	function accounting_document_quantity_label(quantity, sale_unit) {
		const amount = registration_money_number(quantity || 1);
		const amount_label = Number.isInteger(amount) ? String(amount) : String(amount).replace('.', ',');
		const unit = accounting_plural_sale_unit(sale_unit, amount);
		return amount_label + (unit ? ' ' + unit : '');
	}

	function accounting_optional_money_number(value) {
		const raw = String(value ?? '').trim();
		if (!raw) {
			return null;
		}
		const number = Number(raw.replace(',', '.'));
		return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
	}

	function accounting_cause_object(value, fallback_amount) {
		const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
		let detail = raw ? String(raw.detail || raw.event_name || '').trim() : '';
		let label = raw
			? String(raw.label || raw.name || raw.player_name || raw.buyer_name || raw.display_name || '').trim()
			: String(value || '').trim();
		if (!label && raw) {
			label = accounting_cause_label(raw);
		}
		if (!detail && label) {
			const match = label.match(/^(.*),\s*([^,]+)$/);
			if (match && /\b(?:HE|DE|HD|DD|GD|JE|ME|JD|MD|MX|U\d{1,2})\b/i.test(match[2])) {
				label = match[1].trim();
				detail = match[2].trim();
			}
		}
		if (!label) {
			return null;
		}
		const amount = raw ? accounting_optional_money_number(raw.amount) : accounting_optional_money_number(fallback_amount);
		const cause = { label };
		if (detail) {
			cause.detail = detail;
		}
		if (amount !== null) {
			cause.amount = amount;
		}
		if (raw) {
			const club = String(raw.club || '').trim();
			const state = String(raw.state || '').trim();
			if (club) {
				cause.club = club;
			}
			if (state) {
				cause.state = state;
			}
		}
		return cause;
	}

	function accounting_push_cause(list, value, fallback_amount) {
		const cause = accounting_cause_object(value, fallback_amount);
		if (!cause) {
			return;
		}
		const existing = list.find((item) =>
			item.label === cause.label &&
			String(item.detail || '') === String(cause.detail || '') &&
			String(item.club || '') === String(cause.club || '')
		);
		if (existing) {
			if (cause.amount !== undefined) {
				existing.amount = registration_money_number((existing.amount || 0) + cause.amount);
			}
			return;
		}
		list.push(cause);
	}

	function accounting_cause_surname_sort_key(label) {
		const clean_label = String(label || '')
			.replace(/\s*\([^)]*\)\s*$/g, '')
			.trim();
		if (!clean_label) {
			return '';
		}
		const comma_parts = clean_label.split(',').map((part) => part.trim()).filter(Boolean);
		if (comma_parts.length > 1) {
			return comma_parts[0];
		}
		const parts = clean_label.split(/\s+/).filter(Boolean);
		return parts.length > 1 ? parts[parts.length - 1] : clean_label;
	}

	function accounting_compare_grouped_causes(a, b) {
		const surname_compare = accounting_cause_surname_sort_key(a.label)
			.localeCompare(accounting_cause_surname_sort_key(b.label), 'de-DE', { sensitivity: 'base' });
		if (surname_compare !== 0) {
			return surname_compare;
		}
		const label_compare = String(a.label || '').localeCompare(String(b.label || ''), 'de-DE', { sensitivity: 'base' });
		if (label_compare !== 0) {
			return label_compare;
		}
		return (a.index || 0) - (b.index || 0);
	}

	function accounting_group_causes_by_label(causes) {
		const grouped = [];
		const by_label = new Map();
		(causes || []).forEach((value) => {
			const cause = accounting_cause_object(value);
			if (!cause) {
				return;
			}
			const label = cause.label;
			const club = String(cause.club || '').trim();
			const key = label + '\u0001' + club;
			if (!by_label.has(key)) {
				const group = { label, club, state: cause.state || '', details: [], amount: undefined, index: grouped.length };
				by_label.set(key, group);
				grouped.push(group);
			}
			const group = by_label.get(key);
			const detail = String(cause.detail || '').trim();
			if (detail && !group.details.includes(detail)) {
				group.details.push(detail);
			}
			if (cause.amount !== undefined) {
				group.amount = registration_money_number((group.amount || 0) + cause.amount);
			}
		});
		return grouped.sort(accounting_compare_grouped_causes).map((group) => {
			const cause = { label: group.label };
			if (group.club) {
				cause.club = group.club;
			}
			if (group.state) {
				cause.state = group.state;
			}
			if (group.details.length > 0) {
				cause.detail = group.details.join(', ');
			}
			if (group.amount !== undefined) {
				cause.amount = group.amount;
			}
			return cause;
		});
	}

	function accounting_document_caused_by(line) {
		const stored = (Array.isArray(line?.caused_by) ? line.caused_by : [])
			.map((cause) => accounting_cause_object(cause))
			.filter(Boolean);
		if (stored.length > 0) {
			return stored;
		}
		const position_ids = (Array.isArray(line?.position_ids) ? line.position_ids : [line?.position_id || line?.entry_id])
			.map((id) => String(id || '').trim())
			.filter(Boolean);
		if (position_ids.length === 0) {
			return [];
		}
		const wanted = new Set(position_ids);
		const caused_by = [];
		collect_registration_accounting_accounts().forEach((account) => {
			(account.fee_items || []).forEach((entry) => {
				if (wanted.has(String(entry.position_id || ''))) {
					(entry.caused_by || [accounting_cause_label({ ...account, event_name: entry.event_name })]).forEach((cause) => {
						accounting_push_cause(caused_by, cause, entry.amount);
					});
				}
			});
			(account.mandatory_items || []).forEach((entry) => {
				if (wanted.has(String(entry.position_id || ''))) {
					(entry.caused_by || [accounting_cause_label(account)]).forEach((cause) => {
						accounting_push_cause(caused_by, cause, entry.amount);
					});
				}
			});
			(account.local_entries || []).forEach((entry) => {
				if (wanted.has('local:' + String(entry.id || ''))) {
					const sale_unit = entry.item_sale_unit || line?.sale_unit || 'Stk.';
					accounting_push_cause(caused_by, {
						label: accounting_cause_label(entry) || accounting_account_label(account),
						detail: [
							registration_datetime_display_value(entry.purchase_at || entry.created_at),
							accounting_document_quantity_label(entry.quantity || line?.quantity || 1, sale_unit),
						].filter(Boolean).join(', '),
						amount: entry.amount,
					}, entry.amount);
				}
			});
			(account.btp_payments || []).forEach((entry) => {
				if (wanted.has(String(entry.position_id || ''))) {
					accounting_push_cause(caused_by, accounting_account_label(account), entry.amount);
				}
			});
		});
		return caused_by;
	}

	function accounting_document_fee_cause_context(line) {
		const player_ids = (Array.isArray(line?.position_ids) ? line.position_ids : [line?.position_id || line?.entry_id])
			.map((id) => String(id || '').trim().match(/^fee:([^:]+):/))
			.filter(Boolean)
			.map((match) => match[1]);
		if (player_ids.length === 0) {
			return new Map();
		}
		const wanted = new Set(player_ids);
		const by_label = new Map();
		(curt?.events?.events || []).forEach((event) => {
			sorted_registration_stages(event).forEach((stage) => {
				(stage.entries || []).forEach((entry) => {
					(entry?.team?.players || []).forEach((player, player_index) => {
						const player_id = registration_accounting_player_id(player, player_index);
						if (!wanted.has(player_id)) {
							return;
						}
						const label = person_display_name(player);
						if (!label) {
							return;
						}
						by_label.set(label, {
							player_name: label,
							club: player?.club || '',
							state: player?.state || '',
						});
					});
				});
			});
		});
		return by_label;
	}

	function accounting_document_visible_causes(document, line) {
		const causes = accounting_document_caused_by(line);
		if (causes.length === 0) {
			return [];
		}
		const show_club = document?.buyer_type === 'state';
		const cause_context = show_club ? accounting_document_fee_cause_context(line) : new Map();
		const context_causes = show_club
			? causes.map((cause) => {
				const context = cause_context.get(String(cause.label || '').trim()) || {};
				const club = String(cause.club || context.club || '').trim();
				const label = String(cause.label || '').trim();
				if (!club || !label || label.includes('(' + club + ')')) {
					return cause;
				}
				return {
					...cause,
					club,
					state: cause.state || context.state || '',
					label: label + ' (' + club + ')',
				};
			})
			: causes;
		const description_detail = accounting_document_detail_from_description(line);
		const visible_causes = description_detail
			? context_causes.map((cause) => ({ ...cause, detail: cause.detail || description_detail }))
			: context_causes;
		const grouped_causes = accounting_group_causes_by_label(visible_causes);
		if (document?.buyer_type !== 'player') {
			return grouped_causes;
		}
		return visible_causes.length > 1 ? grouped_causes : [];
	}

	function accounting_cause_label(data) {
		const name = String(data?.player_name || data?.buyer_name || data?.display_name || '').trim();
		const event_name = String(data?.event_name || '').trim();
		const club = String(data?.club || '').trim();
		const state = String(data?.state || '').trim();
		let label = name || club || state || '';
		if (event_name && !label.includes(event_name)) {
			label += (label ? ', ' : '') + event_name;
		}
		if (club && label && !label.includes(club)) {
			label += ' (' + club + ')';
		}
		return label;
	}

	function accounting_push_unique_text(list, value) {
		const text = String(value || '').trim();
		if (text && !list.includes(text)) {
			list.push(text);
		}
	}

	function accounting_summary_field(account, field, source) {
		if (source === 'direct') {
			return Array.isArray(account?.[field]) ? account[field] : [];
		}
		const source_prefix = source === 'children' ? 'child_summary_' : 'summary_';
		const summary_field = source_prefix + field;
		if (Array.isArray(account?.[summary_field])) {
			return account[summary_field];
		}
		return source === 'children' ? [] : (Array.isArray(account?.[field]) ? account[field] : []);
	}

	function accounting_position_summaries(account, include_payments, source, options = {}) {
		const excluded_position_ids = options.excluded_position_ids || new Set();
		const kind_filter = options.kind_filter || '';
		const category_filter = options.category_filter
			? new Set(Array.isArray(options.category_filter) ? options.category_filter : [options.category_filter])
			: null;
		const item_key_filter = options.item_key_filter
			? new Set(Array.isArray(options.item_key_filter) ? options.item_key_filter : [options.item_key_filter])
			: null;
		const summaries = new Map();
		function add_summary(key, data) {
			const quantity = registration_money_number(data.quantity || 1);
			const amount = registration_money_number(data.amount || 0);
			const kind = data.kind || 'charge';
			const category = data.category || kind;
			const item_key = data.item_key || '';
			const position_ids = (Array.isArray(data.position_ids) ? data.position_ids : [data.position_id])
				.map((id) => String(id || '').trim())
				.filter(Boolean);
			if (kind_filter && kind !== kind_filter) {
				return;
			}
			if (category_filter && !category_filter.has(category)) {
				return;
			}
			if (item_key_filter && !item_key_filter.has(item_key)) {
				return;
			}
			if (position_ids.length > 0 && position_ids.every((id) => excluded_position_ids.has(id))) {
				return;
			}
			if (!summaries.has(key)) {
				summaries.set(key, {
					kind,
					category,
					item_key,
					class_name: data.class_name || '',
					label: data.label || 'Position',
					prefix: data.prefix || '',
					sale_unit: data.sale_unit || '',
					quantity: 0,
					amount: 0,
					local_entry_ids: [],
					position_ids: [],
					caused_by: [],
				});
			}
			const summary = summaries.get(key);
			summary.quantity = registration_money_number(summary.quantity + quantity);
			summary.amount = registration_money_number(summary.amount + amount);
			if (data.local_entry_id) {
				summary.local_entry_ids.push(data.local_entry_id);
			}
			position_ids.forEach((id) => {
				if (!summary.position_ids.includes(id)) {
					summary.position_ids.push(id);
				}
			});
			(Array.isArray(data.caused_by) ? data.caused_by : [data.caused_by || accounting_cause_label(data)]).forEach((cause) => {
				accounting_push_cause(summary.caused_by, cause, amount);
			});
		}
		const prefix = source === 'children' ? 'Unterkonten' : '';
		accounting_summary_field(account, 'fee_items', source).forEach((entry) => {
			add_summary('charge:fee', {
				kind: 'charge',
				category: 'fee',
				class_name: 'accounting_entry_line_fee',
				label: 'Meldegeld',
				prefix,
				quantity: 1,
				amount: entry.amount,
				position_id: entry.position_id,
				caused_by: entry.caused_by || {
					label: accounting_cause_label({ ...account, event_name: entry.event_name }),
					amount: entry.amount,
				},
			});
		});
		accounting_summary_field(account, 'mandatory_items', source).forEach((entry) => {
			const label = entry.description || 'Artikel';
			const sale_unit = entry.sale_unit || 'Stk.';
			add_summary(['charge:required', entry.item_id || label, sale_unit, entry.unit_price || ''].join(':'), {
				kind: 'charge',
				category: 'mandatory',
				item_key: entry.item_id || [label, sale_unit, entry.unit_price || ''].join(':'),
				class_name: (source === 'children' ? 'accounting_entry_line_rollup ' : '') + 'accounting_entry_line_required',
				label,
				prefix,
				sale_unit,
				quantity: entry.quantity || 1,
				amount: entry.amount,
				position_id: entry.position_id,
				caused_by: entry.caused_by || {
					label: accounting_cause_label(account),
					amount: entry.amount,
				},
			});
		});
		accounting_summary_field(account, 'local_entries', source).forEach((entry) => {
			if (entry.kind === 'payment') {
				if (include_payments) {
					add_summary('payment:local:' + (entry.payment_method || ''), {
						kind: 'payment',
						category: entry.source === 'btp' ? 'btp_payment' : 'local_payment',
						class_name: (source === 'children' ? 'accounting_entry_line_rollup ' : '') + 'accounting_entry_line_local',
						label: entry.description || 'Zahlung',
						prefix,
						quantity: 1,
						amount: entry.amount,
						local_entry_id: entry.id,
						position_id: 'local:' + entry.id,
						caused_by: {
							label: accounting_cause_label(entry) || accounting_account_label(account),
							amount: entry.amount,
						},
					});
				}
				return;
			}
			if (entry.kind !== 'charge') {
				return;
			}
			const label = entry.description || 'Buchung';
			const sale_unit = entry.item_sale_unit || 'Stk.';
			add_summary(['charge:local', entry.item_id || label, sale_unit, entry.unit_price || ''].join(':'), {
				kind: 'charge',
				category: 'local_charge',
				item_key: entry.item_id || [label, sale_unit, entry.unit_price || ''].join(':'),
				class_name: (source === 'children' ? 'accounting_entry_line_rollup ' : '') + 'accounting_entry_line_local',
				label,
				prefix,
				sale_unit,
				quantity: entry.quantity || 1,
				amount: entry.amount,
				local_entry_id: entry.id,
				position_id: 'local:' + entry.id,
				caused_by: {
					label: accounting_cause_label(entry) || accounting_account_label(account),
					amount: entry.amount,
				},
			});
		});
		if (include_payments) {
			accounting_summary_field(account, 'btp_payments', source).forEach((entry) => {
				add_summary('payment:btp', {
					kind: 'payment',
					category: 'btp_payment',
					class_name: (source === 'children' ? 'accounting_entry_line_rollup ' : '') + 'accounting_entry_line_btp',
					label: 'BTP-Zahlung',
					prefix,
					quantity: 1,
					amount: entry.amount,
					position_id: entry.position_id,
					caused_by: {
						label: accounting_account_label(account),
						amount: entry.amount,
					},
				});
			});
		}
		return [...summaries.values()];
	}

	function accounting_render_summary_line(parent, summary, account) {
		const line = uiu.el(parent, 'div', 'accounting_entry_line ' + (summary.class_name || ''));
		uiu.el(line, 'span', {}, accounting_summary_label(summary));
		uiu.el(line, 'strong', {}, registration_money_label(summary.amount));
	}

	function accounting_render_local_remove(parent, entry) {
		if (!entry?.id) {
			return;
		}
		const remove_btn = uiu.el(parent, 'button', {
			type: 'button',
			'class': 'accounting_entry_remove',
			title: 'Lokale Buchung entfernen',
		}, 'Entfernen');
		remove_btn.addEventListener('click', () => {
			if (confirm('Lokale Buchung entfernen?')) {
				remove_registration_accounting_entry(entry.id);
			}
		});
	}

	function show_registration_receipt(player, account) {
		close_registration_receipt_dialog();
		cbts_utils.esc_stack_push(close_registration_receipt_dialog);
		const dialog_bg = uiu.el(uiu.qs('body'), 'div', 'dialog_bg registration_receipt_dialog');
		dialog_bg.addEventListener('click', (e) => {
			if (e.target === dialog_bg) {
				close_registration_receipt_dialog();
			}
		});
		const dialog = uiu.el(dialog_bg, 'div', 'dialog registration_receipt_box');
		uiu.el(dialog, 'h3', {}, 'Belege und Rechnungen');
		uiu.el(dialog, 'p', 'registration_receipt_player', accounting_account_label(account) || person_display_name(player));
		const document_actions = uiu.el(dialog, 'div', 'accounting_document_actions');
		const invoice_btn = uiu.el(document_actions, 'button', { type: 'button' }, 'Rechnung erstellen');
		const receipt_btn = uiu.el(document_actions, 'button', { type: 'button' }, 'Quittung erstellen');
		const documents = accounting_documents_for_account(account);
		const list_header = uiu.el(dialog, 'div', 'accounting_document_list_header');
		uiu.el(list_header, 'strong', {}, 'Bestehende Dokumente');
		uiu.el(list_header, 'span', {}, 'Dokument auswählen');
		const list = uiu.el(dialog, 'div', 'accounting_document_list');
		const current_card = uiu.el(dialog, 'section', 'accounting_document_current_card');
		const toolbar = uiu.el(current_card, 'div', 'accounting_document_toolbar');
		const toolbar_selection = uiu.el(toolbar, 'div', 'accounting_document_toolbar_selection');
		const toolbar_label = uiu.el(toolbar_selection, 'span', {}, 'Aktuell ausgewählt');
		const toolbar_actions = uiu.el(toolbar, 'div', 'accounting_document_toolbar_actions');
		const pdf_btn = uiu.el(toolbar_actions, 'button', { type: 'button' }, 'PDF öffnen');
		const download_btn = uiu.el(toolbar_actions, 'button', { type: 'button' }, 'PDF herunterladen');
		const print_btn = uiu.el(toolbar_actions, 'button', { type: 'button' }, 'Drucken');
		const close_btn = uiu.el(toolbar_actions, 'button', { type: 'button' }, 'Schließen');
		const preview = uiu.el(current_card, 'div', 'accounting_document_preview_host');
		const document_rows = new Map();
		if (documents.length === 0) {
			uiu.el(list, 'div', 'accounting_item_empty', 'Noch keine Dokumente erstellt.');
		}
		let active_document = documents[0] || null;
		function document_key(document) {
			return document?.id || document?.document_number || '';
		}
		function set_document_action_disabled(disabled) {
			pdf_btn.disabled = disabled;
			download_btn.disabled = disabled;
			print_btn.disabled = disabled;
		}
		function update_selected_document() {
			const active_key = document_key(active_document);
			document_rows.forEach((row, key) => {
				const selected = key === active_key;
				row.classList.toggle('accounting_document_row_selected', selected);
				row.setAttribute('aria-pressed', selected ? 'true' : 'false');
			});
			if (active_document) {
				toolbar_label.textContent = 'Aktuell ausgewählt';
				set_document_action_disabled(false);
			} else {
				toolbar_label.textContent = 'Kein Dokument ausgewählt';
				set_document_action_disabled(true);
			}
		}
		function render_active_document(document) {
			active_document = document;
			uiu.empty(preview);
			if (active_document) {
				render_accounting_document_preview(preview, active_document);
			}
			update_selected_document();
		}
		function add_document_row(document, prepend) {
			document = accounting_document_with_payment_status(document);
			const empty = list.querySelector('.accounting_item_empty');
			if (empty) {
				uiu.remove(empty);
			}
			const row = uiu.el(list, 'button', { type: 'button', 'class': 'accounting_document_row' });
			const title = uiu.el(row, 'span', 'accounting_document_row_title');
			uiu.el(title, 'strong', {}, accounting_document_type_label(document.document_type) + ' ' + (document.document_number || ''));
			uiu.el(title, 'span', {}, registration_datetime_display_value(document.issued_at || document.created_at));
			uiu.el(row, 'span', 'accounting_document_row_state', document.status === 'paid' ? 'bezahlt' : 'offen');
			uiu.el(row, 'strong', 'accounting_document_row_amount', registration_money_label(document.total || 0));
			uiu.el(row, 'span', 'accounting_document_row_current', 'Aktuell ausgewählt');
			const key = document_key(document);
			document_rows.set(key, row);
			if (prepend && list.firstChild && list.firstChild !== row) {
				list.insertBefore(row, list.firstChild);
			}
			row.addEventListener('click', () => render_active_document(document));
			update_selected_document();
			return row;
		}
		async function run_document_action(button, action) {
			if (!active_document) {
				return;
			}
			button.disabled = true;
			try {
				await action(active_document);
			} catch (err) {
				cerror.net(err);
				alert('PDF konnte nicht erstellt werden: ' + (err?.message || err));
			} finally {
				button.disabled = false;
				update_selected_document();
			}
		}
		documents.forEach((document) => {
			add_document_row(document, false);
		});
		pdf_btn.addEventListener('click', () => run_document_action(pdf_btn, open_accounting_document_pdf));
		download_btn.addEventListener('click', () => run_document_action(download_btn, download_accounting_document_pdf));
		print_btn.addEventListener('click', () => run_document_action(print_btn, print_accounting_document_pdf));
		close_btn.addEventListener('click', close_registration_receipt_dialog);
		if (active_document) {
			render_active_document(active_document);
		} else {
			update_selected_document();
		}
		invoice_btn.addEventListener('click', () => {
			render_accounting_document_selection(preview, account, 'invoice', function(err, response) {
				if (!err && response?.document) {
					add_document_row(response.document, true);
					render_active_document(response.document);
				}
			});
		});
		receipt_btn.addEventListener('click', () => {
			render_accounting_document_selection(preview, account, 'receipt', function(err, response) {
				if (!err && response?.document) {
					add_document_row(response.document, true);
					render_active_document(response.document);
				}
			});
		});
	}

	function close_registration_item_bookings_dialog() {
		const dialog = document.querySelector('.registration_item_bookings_dialog');
		if (!dialog) {
			return;
		}
		uiu.remove(dialog);
		cbts_utils.esc_stack_pop();
	}

	function registration_optional_accounting_items() {
		return registration_accounting_items()
			.filter((item) => item && item.active !== false && accounting_item_billing_type(item) === 'optional');
	}

	function registration_item_booking_item_label(item) {
		return (item?.name || 'Artikel') + ' - ' + registration_money_label(item?.unit_price || 0) +
			' je ' + accounting_item_sale_unit(item);
	}

	function latest_registration_account(account_key, fallback_account) {
		const accounts = collect_registration_accounting_accounts();
		return accounts.get(account_key) || fallback_account;
	}

	function refresh_registration_item_bookings_dialog(account_key, fallback_account) {
		const account = latest_registration_account(account_key, fallback_account);
		close_registration_item_bookings_dialog();
		show_registration_item_bookings(account);
	}

	function create_registration_item_booking_select(parent, items, entry) {
		const select = uiu.el(parent, 'select', { name: 'item_id' });
		const selected_item_id = String(entry?.item_id || '');
		let selected_found = false;
		items.forEach((item) => {
			const selected = item.id === selected_item_id;
			selected_found = selected_found || selected;
			const option_attrs = { value: item.id };
			if (selected) {
				option_attrs.selected = 'selected';
			}
			uiu.el(select, 'option', option_attrs, registration_item_booking_item_label(item));
		});
		if (entry && !selected_found) {
			const option_attrs = { value: '' };
			if (!selected_item_id) {
				option_attrs.selected = 'selected';
			}
			uiu.el(select, 'option', option_attrs, entry.description || 'Freier Artikel');
		}
		return select;
	}

	function render_registration_item_booking_header(parent) {
		const header = uiu.el(parent, 'div', 'registration_item_booking_header');
		['Artikel', 'Menge', 'Preis', 'Zeit', 'Notiz', 'Betrag', 'Aktionen'].forEach((label) => {
			uiu.el(header, 'span', {}, label);
		});
	}

	function show_registration_item_bookings(account, options = {}) {
		close_registration_item_bookings_dialog();
		cbts_utils.esc_stack_push(close_registration_item_bookings_dialog);
		const account_key = accounting_account_key(account?.account_type || 'player', account?.account_id || account?.player_id || '');
		const items = registration_optional_accounting_items();
		const dialog_bg = uiu.el(uiu.qs('body'), 'div', 'dialog_bg registration_item_bookings_dialog');
		dialog_bg.addEventListener('click', (e) => {
			if (e.target === dialog_bg) {
				close_registration_item_bookings_dialog();
			}
		});
		const dialog = uiu.el(dialog_bg, 'div', 'dialog registration_item_bookings_box');
		uiu.el(dialog, 'h3', {}, 'Artikelkäufe');
		uiu.el(dialog, 'p', 'registration_receipt_player', accounting_account_label(account));
		const new_section = uiu.el(dialog, 'section', 'registration_item_booking_section');
		uiu.el(new_section, 'h4', {}, 'Neuer Kauf');
		if (items.length === 0) {
			uiu.el(new_section, 'div', 'accounting_item_empty', 'Keine optionalen Artikel vorhanden.');
		} else {
			render_registration_item_booking_header(new_section);
			const new_form = uiu.el(new_section, 'form', 'registration_item_purchase_form');
			const purchase_rows = uiu.el(new_form, 'div', 'registration_item_bookings');
			const row_controls = [];
			const purchase_time_label = registration_datetime_display_value();
			function update_purchase_remove_buttons() {
				const active_rows = row_controls.filter((row) => document.body.contains(row.row));
				active_rows.forEach((row) => {
					row.remove_btn.disabled = active_rows.length <= 1;
				});
			}
			function add_purchase_row() {
				const row = uiu.el(purchase_rows, 'div', 'registration_item_booking_row registration_item_booking_new');
				const item_select = create_registration_item_booking_select(row, items);
				const quantity_input = uiu.el(row, 'input', {
					type: 'text',
					name: 'quantity',
					value: '1',
					inputmode: 'decimal',
					placeholder: 'Menge',
				});
				const unit_price_display = uiu.el(row, 'span', 'registration_item_booking_price', '');
				uiu.el(row, 'span', 'registration_item_booking_time', purchase_time_label);
				const note_input = uiu.el(row, 'input', {
					type: 'text',
					name: 'note',
					maxlength: '500',
					placeholder: 'Notiz',
				});
				const amount = uiu.el(row, 'strong', {}, '');
				const row_actions = uiu.el(row, 'span', 'registration_item_booking_actions');
				const remove_btn = uiu.el(row_actions, 'button', { type: 'button' }, 'Zeile entfernen');
				function selected_item() {
					return items.find((item) => item && item.id === item_select.value) || items[0];
				}
				function sync_amount() {
					const item = selected_item();
					const unit_price = registration_money_number(item?.unit_price || 0);
					const quantity = registration_money_number(quantity_input.value || 0);
					unit_price_display.textContent = registration_money_label(unit_price);
					amount.textContent = registration_money_label(quantity * unit_price);
				}
				item_select.addEventListener('change', sync_amount);
				quantity_input.addEventListener('input', sync_amount);
				remove_btn.addEventListener('click', () => {
					uiu.remove(row);
					update_purchase_remove_buttons();
				});
				const controls = {
					row,
					remove_btn,
					selected_item,
					quantity_input,
					note_input,
					amount,
				};
				row_controls.push(controls);
				sync_amount();
				update_purchase_remove_buttons();
				return controls;
			}
			const first_purchase_row = add_purchase_row();
			const purchase_actions = uiu.el(new_form, 'div', 'registration_item_actions registration_item_purchase_actions');
			const add_row_btn = uiu.el(purchase_actions, 'button', { type: 'button' }, '+ Position');
			const submit_btn = uiu.el(purchase_actions, 'button', { type: 'submit' }, 'Kauf buchen');
			add_row_btn.addEventListener('click', () => {
				add_purchase_row().quantity_input.focus();
			});
			new_form.addEventListener('submit', (e) => {
				e.preventDefault();
				const active_rows = row_controls.filter((row) => document.body.contains(row.row));
				const sale_id = registration_accounting_sale_id();
				const purchase_at = registration_datetime_storage_value();
				const entries = active_rows.map((row) => {
					const item = row.selected_item();
					const quantity = registration_money_number(row.quantity_input.value || 0);
					const unit_price = registration_money_number(item?.unit_price || 0);
					return { row, item, quantity, unit_price };
				}).filter((entry) => entry.item && entry.quantity > 0 && entry.unit_price >= 0);
				if (entries.length === 0) {
					return;
				}
				let index = 0;
				function add_next_entry() {
					if (index >= entries.length) {
						if (current_view === 'accounting') {
							ui_accounting();
						}
						refresh_registration_item_bookings_dialog(account_key, account);
						return;
					}
					const entry = entries[index++];
					add_registration_accounting_entry({
						...accounting_account_base_entry(null, account),
						sale_id,
						kind: 'charge',
						type: 'item',
							item_id: entry.item.id,
							item_input_type: entry.item.input_type || 'quantity',
							item_sale_unit: accounting_item_sale_unit(entry.item),
							item_overview_category: accounting_item_overview_category(entry.item),
							description: entry.item.name,
							quantity: entry.quantity,
						unit_price: entry.unit_price,
						amount: registration_money_number(entry.quantity * entry.unit_price),
						note: entry.row.note_input.value || entry.item.note || '',
						purchase_at,
					}, function(err) {
						if (!err) {
							add_next_entry();
						}
					}, { refresh: false });
				}
				add_next_entry();
			});
			if (options.focus_new) {
				first_purchase_row.quantity_input.focus();
			}
		}
		const entries = (account?.local_entries || [])
			.filter((entry) => entry && entry.kind === 'charge' && ['item', 'shuttles', 'other'].includes(String(entry.type || '')));
		const existing_section = uiu.el(dialog, 'section', 'registration_item_booking_section');
		uiu.el(existing_section, 'h4', {}, 'Direkte Buchungen');
		if (entries.length > 0) {
			render_registration_item_booking_header(existing_section);
		}
		const list = uiu.el(existing_section, 'div', 'registration_item_bookings');
		if (entries.length === 0) {
			uiu.el(list, 'div', 'accounting_item_empty', 'Keine direkten Artikelbuchungen vorhanden.');
		}
		const voided_entry_ids = new Set(entries
			.filter((entry) => entry && entry.is_cancellation && entry.voids_entry_id)
			.map((entry) => String(entry.voids_entry_id)));
		entries.forEach((entry) => {
			const row = uiu.el(list, 'div', 'registration_item_booking_row registration_item_booking_existing' + (entry.is_cancellation ? ' registration_item_booking_cancelled' : ''));
			uiu.el(row, 'span', 'registration_item_booking_name', entry.description || 'Artikel');
			uiu.el(row, 'span', {}, accounting_summary_quantity_label(entry.quantity || 1));
			uiu.el(row, 'span', 'registration_item_booking_price', registration_money_label(entry.unit_price || 0));
			uiu.el(row, 'span', 'registration_item_booking_time', registration_datetime_display_value(entry.purchase_at || entry.created_at));
			uiu.el(row, 'span', 'registration_item_booking_note', entry.note || '-');
			uiu.el(row, 'strong', {}, registration_money_label(entry.amount || 0));
			const row_actions = uiu.el(row, 'span', 'registration_item_booking_actions');
			const cancel_btn = uiu.el(row_actions, 'button', {
				type: 'button',
				'class': 'accounting_entry_remove',
			}, entry.is_cancellation ? 'Storno' : voided_entry_ids.has(String(entry.id)) ? 'Storniert' : 'Stornieren');
			if (entry.is_cancellation || voided_entry_ids.has(String(entry.id))) {
				cancel_btn.disabled = true;
			} else {
				cancel_btn.addEventListener('click', () => {
					if (confirm('Artikelbuchung stornieren?')) {
						const quantity = -Math.abs(registration_money_number(entry.quantity || 1));
						const unit_price = registration_money_number(entry.unit_price || 0);
						const amount = -Math.abs(registration_money_number(entry.amount || quantity * unit_price));
						add_registration_accounting_entry({
							...accounting_account_base_entry(null, account),
							sale_id: entry.sale_id || registration_accounting_sale_id(),
							kind: 'charge',
							type: entry.type || 'item',
							item_id: entry.item_id || '',
							item_input_type: entry.item_input_type || 'quantity',
							item_sale_unit: entry.item_sale_unit || 'Stk.',
							description: 'Storno ' + (entry.description || 'Artikel'),
							quantity,
							unit_price,
							amount,
							note: entry.note ? 'Storno zu: ' + entry.note : '',
							purchase_at: registration_datetime_storage_value(),
							is_cancellation: true,
							voids_entry_id: entry.id,
						}, function(err) {
							if (!err) {
								refresh_registration_item_bookings_dialog(account_key, account);
							}
						});
					}
				});
			}
		});
		const actions = uiu.el(dialog, 'div', 'registration_item_actions');
		const close_btn = uiu.el(actions, 'button', { type: 'button' }, 'Schließen');
		close_btn.addEventListener('click', close_registration_item_bookings_dialog);
		close_btn.focus();
	}

	function render_registration_accounting(parent, event, player, account) {
		const wrap = uiu.el(parent, 'span', 'registration_accounting');
		const amounts = uiu.el(wrap, 'span', 'registration_accounting_amounts');
		uiu.el(amounts, 'span', {}, 'Soll ' + registration_money_label(account?.due_total || 0));
		uiu.el(amounts, 'span', {}, 'Gezahlt ' + registration_money_label(account?.paid_total || 0));
		const open = registration_money_number(account?.open_total || 0);
		uiu.el(amounts, 'strong', {
			'class': open > 0 ? 'registration_accounting_open' : 'registration_accounting_done',
		}, 'Offen ' + registration_money_label(open));
		const actions = uiu.el(wrap, 'span', 'registration_accounting_actions');
		const pay_btn = uiu.el(actions, 'button', {
			type: 'button',
			'class': 'registration_accounting_button',
			title: 'Zahlung erfassen',
		}, 'Zahlung');
		pay_btn.addEventListener('click', () => add_registration_payment(event, account));
		const item_btn = uiu.el(actions, 'button', {
			type: 'button',
			'class': 'registration_accounting_button',
			title: 'Artikel buchen',
		}, 'Artikel');
		item_btn.addEventListener('click', () => add_registration_catalog_item(event, account));
		const receipt_btn = uiu.el(actions, 'button', {
			type: 'button',
			'class': 'registration_accounting_button',
			title: 'Beleg anzeigen',
		}, 'Beleg');
		receipt_btn.addEventListener('click', () => show_registration_receipt(accounting_account_player(account), account));
	}

	function accounting_account_player(account) {
		return account?.player || {
			name: accounting_account_label(account),
			btp_id: account?.player_id || '',
			club: account?.club || '',
			state: account?.state || '',
		};
	}

	function render_accounting_entry_lines(parent, account) {
		const lines = uiu.el(parent, 'div', 'accounting_entry_lines');
		accounting_position_summaries(account, false)
			.forEach((summary) => accounting_render_summary_line(lines, summary, account));
		if (lines.children.length === 0) {
			uiu.el(lines, 'div', 'accounting_entry_line accounting_entry_line_empty', '-');
		}
	}

	function render_accounting_balance_cell(parent, account) {
		const cell = uiu.el(parent, 'td', 'accounting_col_balance');
		const balance = uiu.el(cell, 'div', 'accounting_balance');
		const invoiced_total = accounting_invoiced_total(account);
		const display_open_total = accounting_display_open_total(account, invoiced_total);
		const lines = [
			['Soll', account.due_total, ''],
			['In Rechnung gestellt', invoiced_total, 'accounting_invoiced'],
			['Gezahlt', account.paid_total, ''],
			['Offen', display_open_total, display_open_total > 0 ? 'accounting_open' : 'accounting_done'],
		];
		lines.forEach(([label, amount, class_name]) => {
			const line = uiu.el(balance, 'div', 'accounting_balance_line ' + (label === 'Offen' ? 'accounting_balance_open_line ' : '') + class_name);
			uiu.el(line, 'span', {}, label + ':');
			uiu.el(line, 'strong', {}, registration_money_label(amount));
		});
	}

	function accounting_position_list_account_columns(account) {
		const type = String(account?.account_type || '');
		return {
			state: type === 'state' ? accounting_account_label(account) : (account?.state || ''),
			club: type === 'club' ? accounting_account_label(account) : (account?.club || ''),
			name: type === 'player' ? (account?.player_name || accounting_account_label(account)) : (type === 'none' ? accounting_account_label(account) : ''),
		};
	}

	function accounting_position_list_invoice_maps() {
		const by_position_id = new Map();
		const by_invoice_key = new Map();
		registration_accounting_documents()
			.filter((document) => document && document.document_type === 'invoice')
			.forEach((document) => {
				const invoice = accounting_document_with_payment_status(document);
				const due_at = accounting_document_payment_details(invoice).due_at;
				const payload = {
					document: invoice,
					number: invoice.document_number || '',
					issued_at: invoice.issued_at || invoice.created_at || '',
					due_at,
				};
				if (invoice.id) {
					by_invoice_key.set('id:' + invoice.id, payload);
				}
				if (invoice.document_number) {
					by_invoice_key.set('number:' + invoice.document_number, payload);
				}
				accounting_document_position_ids(invoice).forEach((position_id) => {
					if (!by_position_id.has(position_id)) {
						by_position_id.set(position_id, payload);
					}
				});
			});
		return { by_position_id, by_invoice_key };
	}

	function accounting_position_list_payment_date(entry) {
		return entry?.purchase_at || entry?.payment_date || entry?.created_at || '';
	}

	function accounting_position_list_rows() {
		const accounts = [...collect_registration_accounting_accounts().values()]
			.filter((account) => account && !account.accounting_group_only)
			.sort(accounting_sort_by_label);
		const { by_position_id, by_invoice_key } = accounting_position_list_invoice_maps();
		const rows = [];
		const rows_by_position_id = new Map();
		const rows_by_account_key = new Map();
		function remember_row(account, data) {
			const position_ids = (Array.isArray(data.position_ids) ? data.position_ids : [data.position_id])
				.map((id) => String(id || '').trim())
				.filter(Boolean);
			const amount = registration_money_number(data.amount || 0);
			if (position_ids.length === 0 || amount <= 0) {
				return;
			}
			const invoice = position_ids.map((position_id) => by_position_id.get(position_id)).find(Boolean) || null;
			const row = {
				...accounting_position_list_account_columns(account),
				account_key: accounting_account_key(account?.account_type, account?.account_id),
				position_id: position_ids[0],
				position_ids,
				position_amounts: data.position_amounts || Object.fromEntries(position_ids.map((position_id) => [position_id, amount])),
				position_details: data.position_details || Object.fromEntries(position_ids.map((position_id) => [position_id, data.detail || ''])),
				position_paid_amounts: {},
				position_paid_dates: {},
				position: data.position || 'Position',
				detail: data.detail || '',
				amount,
				invoice_number: invoice?.number || '',
				invoiced_at: invoice?.issued_at || '',
				due_at: invoice?.due_at || '',
				paid_amount: 0,
				paid_dates: [],
				open_amount: amount,
			};
			rows.push(row);
			position_ids.forEach((position_id) => rows_by_position_id.set(position_id, row));
			if (!rows_by_account_key.has(row.account_key)) {
				rows_by_account_key.set(row.account_key, []);
			}
			rows_by_account_key.get(row.account_key).push(row);
		}
		accounts.forEach((account) => {
			const fee_items = account.fee_items || [];
			if (fee_items.length > 0) {
				const details = [];
				const position_ids = [];
				const position_amounts = {};
				const position_details = {};
				let amount = 0;
				fee_items.forEach((entry) => {
					const detail = String(entry.event_name || '').trim();
					if (detail && !details.includes(detail)) {
						details.push(detail);
					}
					if (entry.position_id && !position_ids.includes(entry.position_id)) {
						position_ids.push(entry.position_id);
					}
					const entry_amount = registration_money_number(entry.amount || 0);
					if (entry.position_id) {
						position_amounts[entry.position_id] = registration_money_number((position_amounts[entry.position_id] || 0) + entry_amount);
						position_details[entry.position_id] = detail;
					}
					amount = registration_money_number(amount + entry_amount);
				});
				remember_row(account, {
					position_ids,
					position_amounts,
					position_details,
					position: 'Meldegeld',
					detail: details.join(', '),
					amount,
				});
			}
			(account.mandatory_items || []).forEach((entry) => {
				remember_row(account, {
					position_id: entry.position_id,
					position: entry.description || 'Artikel',
					detail: accounting_summary_quantity_label(entry.quantity || 1),
					amount: entry.amount,
				});
			});
			const local_entries = account.local_entries || [];
			const voided_entry_ids = new Set(local_entries
				.filter((entry) => entry && entry.is_cancellation && entry.voids_entry_id)
				.map((entry) => String(entry.voids_entry_id)));
			local_entries.forEach((entry) => {
				if (!entry || entry.kind !== 'charge' || entry.is_cancellation || voided_entry_ids.has(String(entry.id || ''))) {
					return;
				}
				remember_row(account, {
					position_id: entry.id ? 'local:' + entry.id : '',
					position: entry.description || 'Buchung',
					detail: [
						accounting_summary_quantity_label(entry.quantity || 1),
						registration_datetime_display_value(entry.purchase_at || entry.created_at),
					].filter(Boolean).join(', '),
					amount: entry.amount,
				});
			});
		});
		function add_paid_share(row, amount, date, position_ids) {
			if (!row) {
				return;
			}
			const value = registration_money_number(amount || 0);
			if (value === 0) {
				return;
			}
			const target_position_ids = (Array.isArray(position_ids) && position_ids.length > 0 ? position_ids : row.position_ids || [row.position_id])
				.map((id) => String(id || '').trim())
				.filter(Boolean)
				.filter((id, index, ids) => ids.indexOf(id) === index);
			const remaining_total = registration_money_number(target_position_ids.reduce((sum, position_id) => {
				const position_amount = registration_money_number(row.position_amounts?.[position_id] || 0);
				const paid_amount = registration_money_number(row.position_paid_amounts?.[position_id] || 0);
				return sum + Math.max(0, position_amount - paid_amount);
			}, 0));
			const basis_total = remaining_total > 0
				? remaining_total
				: registration_money_number(target_position_ids.reduce((sum, position_id) => sum + registration_money_number(row.position_amounts?.[position_id] || 0), 0));
			if (basis_total <= 0) {
				return;
			}
			let assigned = 0;
			target_position_ids.forEach((position_id, index) => {
				const position_amount = registration_money_number(row.position_amounts?.[position_id] || 0);
				const paid_amount = registration_money_number(row.position_paid_amounts?.[position_id] || 0);
				const basis = remaining_total > 0 ? Math.max(0, position_amount - paid_amount) : position_amount;
				const share = index === target_position_ids.length - 1
					? registration_money_number(value - assigned)
					: registration_money_number(value * basis / basis_total);
				assigned = registration_money_number(assigned + share);
				if (share <= 0) {
					return;
				}
				row.position_paid_amounts[position_id] = Math.max(0, Math.min(position_amount, registration_money_number(paid_amount + share)));
				const date_label = date ? registration_date_display_value(date) : '';
				if (date_label && date_label !== '-') {
					if (!Array.isArray(row.position_paid_dates[position_id])) {
						row.position_paid_dates[position_id] = [];
					}
					if (!row.position_paid_dates[position_id].includes(date_label)) {
						row.position_paid_dates[position_id].push(date_label);
					}
				}
			});
			row.paid_amount = Math.max(0, Math.min(row.amount, registration_money_number(Object.values(row.position_paid_amounts)
				.reduce((sum, paid_amount) => sum + registration_money_number(paid_amount), 0))));
			row.open_amount = Math.max(0, registration_money_number(row.amount - row.paid_amount));
			row.paid_dates = Object.values(row.position_paid_dates)
				.flat()
				.filter((date_label, index, dates) => date_label && dates.indexOf(date_label) === index);
		}
		function allocate_payment_to_positions(position_ids, amount, date) {
			const targets_by_row = new Map();
			(position_ids || [])
				.map((id) => String(id || '').trim())
				.filter(Boolean)
				.forEach((position_id) => {
					const row = rows_by_position_id.get(position_id);
					if (!row) {
						return;
					}
					const current = targets_by_row.get(row) || { row, basis: 0, position_ids: [] };
					current.basis = registration_money_number(current.basis + registration_money_number(row.position_amounts?.[position_id] || 0));
					if (!current.position_ids.includes(position_id)) {
						current.position_ids.push(position_id);
					}
					targets_by_row.set(row, current);
				});
			const targets = [...targets_by_row.values()]
				.map((target) => ({
					row: target.row,
					basis: target.basis > 0 ? target.basis : target.row.amount,
					position_ids: target.position_ids,
				}));
			const value = registration_money_number(amount || 0);
			if (targets.length === 0 || value <= 0) {
				return;
			}
			const remaining_total = registration_money_number(targets.reduce((sum, target) => {
				return sum + Math.min(target.basis, Math.max(0, target.row.amount - target.row.paid_amount));
			}, 0));
			const basis_total = remaining_total > 0
				? remaining_total
				: registration_money_number(targets.reduce((sum, target) => sum + target.basis, 0));
			if (basis_total <= 0) {
				return;
			}
			let assigned = 0;
			targets.forEach((target, index) => {
				const row = target.row;
				const basis = remaining_total > 0
					? Math.min(target.basis, Math.max(0, row.amount - row.paid_amount))
					: target.basis;
				const share = index === targets.length - 1
					? registration_money_number(value - assigned)
					: registration_money_number(value * basis / basis_total);
				assigned = registration_money_number(assigned + share);
				add_paid_share(row, share, date, target.position_ids);
			});
		}
		registration_accounting_entries()
			.filter((entry) => entry && entry.kind === 'payment' && !entry.is_cancellation)
			.forEach((entry) => {
				const date = accounting_position_list_payment_date(entry);
				accounting_payment_allocations(entry).forEach((allocation) => {
					let position_ids = allocation.position_ids || [];
					if (allocation.target_type === 'invoice') {
						const invoice = by_invoice_key.get('id:' + allocation.invoice_id) || by_invoice_key.get('number:' + allocation.invoice_number);
						position_ids = accounting_document_position_ids(invoice?.document);
					}
					allocate_payment_to_positions(position_ids, allocation.amount, date);
				});
			});
		accounts.forEach((account) => {
			const account_rows = rows_by_account_key.get(accounting_account_key(account?.account_type, account?.account_id)) || [];
			(account.btp_payments || []).forEach((payment) => {
				const amount = registration_money_number(payment?.amount || 0);
				if (amount <= 0) {
					return;
				}
				allocate_payment_to_positions(account_rows.flatMap((row) => row.position_ids || [row.position_id]), amount, payment.payment_date || payment.PaymentDate || '');
			});
		});
		function split_position_list_rows(source_rows) {
			const split_rows = [];
			source_rows.forEach((row) => {
				const groups = new Map();
				const remember_group = (position_id, amount, paid, paid_dates) => {
					const invoice = by_position_id.get(position_id) || null;
					const key = [
						invoice?.number || '',
						invoice?.issued_at || '',
						invoice?.due_at || '',
						paid ? 'paid' : 'open',
					].join('\u0001');
					if (!groups.has(key)) {
						groups.set(key, {
							...row,
							position_ids: [],
							position_amounts: {},
							position_details: {},
							amount: 0,
							invoice_number: invoice?.number || '',
							invoiced_at: invoice?.issued_at || '',
							due_at: invoice?.due_at || '',
							paid_amount: 0,
							paid_dates: [],
							open_amount: 0,
						});
					}
					const group = groups.get(key);
					const value = registration_money_number(amount || 0);
					if (value <= 0) {
						return;
					}
					if (!group.position_ids.includes(position_id)) {
						group.position_ids.push(position_id);
					}
					group.position_amounts[position_id] = registration_money_number((group.position_amounts[position_id] || 0) + value);
					group.position_details[position_id] = row.position_details?.[position_id] || row.detail || '';
					group.amount = registration_money_number(group.amount + value);
					if (paid) {
						group.paid_amount = registration_money_number(group.paid_amount + value);
						(paid_dates || []).forEach((date_label) => {
							if (date_label && !group.paid_dates.includes(date_label)) {
								group.paid_dates.push(date_label);
							}
						});
					} else {
						group.open_amount = registration_money_number(group.open_amount + value);
					}
				};
				(row.position_ids || [row.position_id]).forEach((position_id) => {
					const total = registration_money_number(row.position_amounts?.[position_id] || 0);
					const paid = Math.max(0, Math.min(total, registration_money_number(row.position_paid_amounts?.[position_id] || 0)));
					const open = Math.max(0, registration_money_number(total - paid));
					if (paid > 0) {
						remember_group(position_id, paid, true, row.position_paid_dates?.[position_id] || row.paid_dates || []);
					}
					if (open > 0 || paid <= 0) {
						remember_group(position_id, open > 0 ? open : total, false, []);
					}
				});
				groups.forEach((group) => {
					const detail_parts = [];
					group.position_ids.forEach((position_id) => {
						const detail = String(group.position_details?.[position_id] || '').trim();
						if (detail && !detail_parts.includes(detail)) {
							detail_parts.push(detail);
						}
					});
					group.detail = detail_parts.join(', ') || row.detail || '';
					group.position_id = group.position_ids[0] || row.position_id;
					split_rows.push(group);
				});
			});
			return split_rows;
		}
		return split_position_list_rows(rows).sort((a, b) => (
			String(a.state).localeCompare(String(b.state), 'de', { sensitivity: 'base' }) ||
			String(a.club).localeCompare(String(b.club), 'de', { sensitivity: 'base' }) ||
			String(a.name).localeCompare(String(b.name), 'de', { sensitivity: 'base' }) ||
			String(a.position).localeCompare(String(b.position), 'de', { sensitivity: 'base' }) ||
			String(a.detail).localeCompare(String(b.detail), 'de', { numeric: true, sensitivity: 'base' })
		));
	}

	function accounting_position_list_invoice_label(row) {
		if (!row.invoiced_at) {
			return '';
		}
		const issued = registration_date_display_value(row.invoiced_at);
		const due = row.due_at ? registration_date_display_value(row.due_at) : '';
		return due && due !== '-' ? issued + ' (' + due + ')' : issued;
	}

	function accounting_position_list_invoice_compact_label(row) {
		if (!row.invoice_number && !row.invoiced_at) {
			return '-';
		}
		const due = row.due_at ? registration_date_display_value(row.due_at) : '';
		if (row.invoice_number && due && due !== '-') {
			return row.invoice_number + ' / ' + due;
		}
		return row.invoice_number || due || '-';
	}

	function accounting_position_list_invoice_title(row) {
		if (!row.invoice_number && !row.invoiced_at) {
			return 'Nicht in Rechnung gestellt';
		}
		return [
			row.invoice_number ? 'Rechnung: ' + row.invoice_number : '',
			row.invoiced_at ? 'In Rechnung gestellt: ' + registration_date_display_value(row.invoiced_at) : '',
			row.due_at ? 'Zahlungsziel: ' + registration_date_display_value(row.due_at) : '',
		].filter(Boolean).join('\n');
	}

	function accounting_position_list_detail_label(row) {
		const detail = String(row.detail || '').trim();
		if (!detail) {
			return row.position || '-';
		}
		return (row.position || 'Posten') + ': ' + detail;
	}

	function accounting_position_list_is_paid(row) {
		return registration_money_number(row.open_amount || 0) <= 0;
	}

	function accounting_position_list_paid_title(row) {
		if (row.paid_dates.length > 0) {
			return 'Gezahlt am: ' + row.paid_dates.join(', ');
		}
		return accounting_position_list_is_paid(row) ? 'Gezahlt' : 'Noch offen';
	}

	function accounting_position_list_csv(rows) {
		const headers = ['LV', 'Verein', 'Name', 'Posten / Details', 'Betrag', 'Rechnung / Ziel', 'Gezahlt', 'Gezahlt am'];
		const escape = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
		const lines = [headers.map(escape).join(';')];
		rows.forEach((row) => {
			lines.push([
				row.state,
				row.club,
				row.name,
				accounting_position_list_detail_label(row),
				registration_money_label(row.amount),
				accounting_position_list_invoice_compact_label(row),
				accounting_position_list_is_paid(row) ? 'Ja' : 'Nein',
				row.paid_dates.join(', '),
			].map(escape).join(';'));
		});
		return '\ufeff' + lines.join('\r\n');
	}

	function accounting_position_list_filename(extension) {
		return 'Postenliste-' + (curt?.key || 'Turnier') + '.' + extension;
	}

	async function make_accounting_position_list_pdf(rows) {
		if (typeof PDFLib === 'undefined' || !PDFLib.PDFDocument) {
			throw new Error('PDF-Bibliothek nicht geladen.');
		}
		const pdf_doc = await PDFLib.PDFDocument.create();
		if (typeof pdf_doc.setTitle === 'function') {
			pdf_doc.setTitle('Postenliste');
		}
		const font = await pdf_doc.embedFont(PDFLib.StandardFonts.Helvetica);
		const bold = await pdf_doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
		const page_size = [841.89, 595.28];
		const mm_to_pt = 72 / 25.4;
		const margins = {
			left: 10 * mm_to_pt,
			right: 10 * mm_to_pt,
			top: 25 * mm_to_pt,
			bottom: 10 * mm_to_pt,
		};
		const content_left = margins.left;
		const content_right = page_size[0] - margins.right;
		const content_width = content_right - content_left;
		const column_gap = 8;
		const columns = [
			{ key: 'state', label: 'LV', min: 64, max: 124 },
			{ key: 'club', label: 'Verein', min: 82, max: 145 },
			{ key: 'name', label: 'Name', min: 88, max: 150 },
			{ key: 'detail_label', label: 'Posten / Details', min: 130, max: 250, grow: 1 },
			{ key: 'amount', label: 'Betrag', min: 54, max: 68, money: true },
			{ key: 'invoice_compact', label: 'Rechnung / Ziel', min: 70, max: 140, grow: 2 },
			{ key: 'paid_checkbox', label: 'Gezahlt', min: 40, max: 44, checkbox: true },
		];
		let page = null;
		let y = 0;
		const pages = [];
		const text_color = PDFLib.rgb(0.12, 0.16, 0.21);
		const muted = PDFLib.rgb(0.36, 0.42, 0.48);
		const line_color = PDFLib.rgb(0.78, 0.82, 0.86);
		function draw_text(text, x, line_y, options = {}) {
			page.drawText(accounting_pdf_text(text), {
				x,
				y: line_y,
				size: options.size || 7.5,
				font: options.bold ? bold : font,
				color: options.color || text_color,
			});
		}
		function draw_right(text, right, line_y, options = {}) {
			const size = options.size || 7.5;
			const use_font = options.bold ? bold : font;
			const safe_text = accounting_pdf_text(text);
			page.drawText(safe_text, {
				x: right - use_font.widthOfTextAtSize(safe_text, size),
				y: line_y,
				size,
				font: use_font,
				color: options.color || text_color,
			});
		}
		function draw_checkbox(x, box_y, checked) {
			const size = 9;
			page.drawRectangle({
				x,
				y: box_y,
				width: size,
				height: size,
				borderWidth: 0.8,
				borderColor: checked ? PDFLib.rgb(0.18, 0.42, 0.24) : muted,
			});
			if (!checked) {
				return;
			}
			const check_color = PDFLib.rgb(0.18, 0.42, 0.24);
			page.drawLine({
				start: { x: x + 2.0, y: box_y + 4.6 },
				end: { x: x + 3.9, y: box_y + 2.6 },
				thickness: 1.1,
				color: check_color,
			});
			page.drawLine({
				start: { x: x + 3.9, y: box_y + 2.6 },
				end: { x: x + 7.5, y: box_y + 7.2 },
				thickness: 1.1,
				color: check_color,
			});
		}
		function draw_header() {
			const title = 'Postenliste';
			const title_y = page_size[1] - margins.top - 4;
			const title_width = bold.widthOfTextAtSize(title, 15);
			const event_period = accounting_event_period_label() || accounting_automatic_event_period_label();
			const event_label = [curt?.name || 'Turnier', event_period].filter(Boolean).join(' | ');
			draw_text(title, content_left, title_y, { size: 15, bold: true });
			if (event_label) {
				const event_x = content_left + title_width + 16;
				const event_width = Math.max(80, content_right - event_x - 72);
				const event_lines = accounting_pdf_wrap_text(event_label, font, 8.5, event_width).slice(0, 2);
				event_lines.forEach((line, index) => {
					draw_text(line, event_x, title_y + 1 - index * 10, { size: 8.5, color: muted });
				});
			}
			draw_right(registration_date_display_value(new Date()), content_right, page_size[1] - margins.top - 2, { size: 8, color: muted });
			const summary = rows.length + ' Posten | Summe ' +
				registration_money_label(rows.reduce((sum, row) => registration_money_number(sum + row.amount), 0));
			draw_text(summary, content_left, page_size[1] - margins.top - 20, { size: 8, color: muted });
			y = page_size[1] - margins.top - 42;
			let x = content_left;
			columns.forEach((column) => {
				draw_text(column.label, x, y, { size: 8, bold: true });
				x += column.width + column_gap;
			});
			page.drawLine({ start: { x: content_left, y: y - 5 }, end: { x: content_right, y: y - 5 }, thickness: 0.6, color: line_color });
			y -= 17;
		}
		function new_page() {
			page = pdf_doc.addPage(page_size);
			pages.push(page);
			draw_header();
		}
		function row_value(row, column) {
			if (column.key === 'amount' || column.key === 'open_amount') {
				return registration_money_label(row[column.key] || 0);
			}
			if (column.key === 'detail_label') {
				return accounting_position_list_detail_label(row);
			}
			if (column.key === 'invoice_compact') {
				return accounting_position_list_invoice_compact_label(row);
			}
			return row[column.key] || '-';
		}
		function measure_pdf_text(text, use_bold, size) {
			const use_font = use_bold ? bold : font;
			return use_font.widthOfTextAtSize(accounting_pdf_text(text), size);
		}
		function column_content_width(column, row) {
			if (column.checkbox) {
				return measure_pdf_text(column.label, true, 8);
			}
			const size = column.money ? 8.2 : 8.0;
			return measure_pdf_text(row_value(row, column), column.money, size);
		}
		function fit_accounting_position_list_columns() {
			const available_width = content_width - (column_gap * (columns.length - 1));
			columns.forEach((column) => {
				const header_width = measure_pdf_text(column.label, true, 8);
				const content_width = rows.reduce((max_width, row) => Math.max(max_width, column_content_width(column, row)), header_width);
				const desired = Math.ceil(content_width + 8);
				column.width = Math.max(column.min, Math.min(column.max, desired));
			});
			let total_width = columns.reduce((sum, column) => sum + column.width, 0);
			if (total_width > available_width) {
				let overflow = total_width - available_width;
				while (overflow > 0.1) {
					const shrinkable = columns.filter((column) => column.width > column.min + 0.1);
					if (shrinkable.length === 0) {
						break;
					}
					const share = overflow / shrinkable.length;
					shrinkable.forEach((column) => {
						const shrink = Math.min(column.width - column.min, share);
						column.width -= shrink;
						overflow -= shrink;
					});
				}
			} else if (total_width < available_width) {
				let free = available_width - total_width;
				while (free > 0.1) {
					const expandable = columns.filter((column) => (column.grow || 0) > 0 && column.width < column.max - 0.1);
					if (expandable.length === 0) {
						break;
					}
					const grow_total = expandable.reduce((sum, column) => sum + (column.grow || 0), 0);
					expandable.forEach((column) => {
						const grow = Math.min(column.max - column.width, free * ((column.grow || 0) / grow_total));
						column.width += grow;
						free -= grow;
					});
				}
			}
		}
		fit_accounting_position_list_columns();
		new_page();
		rows.forEach((row) => {
			const wrapped = columns.map((column) => {
				if (column.checkbox) {
					return [''];
				}
				const size = column.money ? 8.2 : 8.0;
				return accounting_pdf_wrap_text(row_value(row, column), font, size, column.width - 4);
			});
			const max_lines = Math.max(...wrapped.map((lines) => lines.length), 1);
			const line_height = 10.5;
			const row_height = Math.max(18, max_lines * line_height + 9);
			if (y - row_height < margins.bottom + 18) {
				new_page();
			}
			let x = content_left;
			wrapped.forEach((lines, column_index) => {
				const column = columns[column_index];
				lines.forEach((line, line_index) => {
					const line_y = y - 7.5 - line_index * line_height;
					if (column.money) {
						draw_right(line, x + column.width - 4, line_y, { size: 8.2, bold: true });
					} else if (column.checkbox && line_index === 0) {
						draw_checkbox(x + (column.width - 9) / 2, line_y - 1.5, accounting_position_list_is_paid(row));
					} else {
						draw_text(line, x, line_y, { size: 8.0 });
					}
				});
				x += column.width + column_gap;
			});
			page.drawLine({ start: { x: content_left, y: y - row_height + 4 }, end: { x: content_right, y: y - row_height + 4 }, thickness: 0.25, color: line_color });
			y -= row_height;
		});
		const total_pages = pdf_doc.getPageCount();
		pdf_doc.getPages().forEach((pdf_page, index) => {
			const label = 'Seite ' + (index + 1) + ' / ' + total_pages;
			pdf_page.drawText(label, {
				x: content_right - font.widthOfTextAtSize(label, 7),
				y: margins.bottom - 12,
				size: 7,
				font,
				color: muted,
			});
		});
		return pdf_doc.save();
	}

	async function download_accounting_position_list_pdf(rows) {
		const bytes = await make_accounting_position_list_pdf(rows);
		save_file(new Blob([bytes], { type: 'application/pdf' }), accounting_position_list_filename('pdf'));
	}

	function close_accounting_position_list_dialog() {
		const dialog = document.querySelector('.accounting_position_list_dialog');
		if (!dialog) {
			return;
		}
		uiu.remove(dialog);
		cbts_utils.esc_stack_pop();
	}

	function show_accounting_position_list() {
		close_accounting_position_list_dialog();
		const rows = accounting_position_list_rows();
		cbts_utils.esc_stack_push(close_accounting_position_list_dialog);
		const dialog_bg = uiu.el(uiu.qs('body'), 'div', 'dialog_bg accounting_position_list_dialog');
		dialog_bg.addEventListener('click', (e) => {
			if (e.target === dialog_bg) {
				close_accounting_position_list_dialog();
			}
		});
		const dialog = uiu.el(dialog_bg, 'div', 'dialog accounting_position_list_box');
		const header = uiu.el(dialog, 'div', 'accounting_position_list_header');
		const title = uiu.el(header, 'div');
		uiu.el(title, 'h3', {}, 'Postenliste');
		const total = rows.reduce((sum, row) => registration_money_number(sum + row.amount), 0);
		uiu.el(title, 'p', {}, rows.length + ' Posten | Summe ' + registration_money_label(total));
		const actions = uiu.el(header, 'div', 'accounting_position_list_actions');
		const pdf_btn = uiu.el(actions, 'button', { type: 'button' }, 'PDF herunterladen');
		const csv_btn = uiu.el(actions, 'button', { type: 'button' }, 'CSV herunterladen');
		const close_btn = uiu.el(actions, 'button', { type: 'button' }, 'Schließen');
		const table_wrap = uiu.el(dialog, 'div', 'accounting_position_list_table_wrap');
		const table = uiu.el(table_wrap, 'table', 'accounting_position_list_table');
		const thead = uiu.el(table, 'thead');
		const head_row = uiu.el(thead, 'tr');
		['LV', 'Verein', 'Name', 'Posten / Details', 'Betrag', 'Rechnung / Ziel', 'Gezahlt']
			.forEach((label) => uiu.el(head_row, 'th', {}, label));
		const tbody = uiu.el(table, 'tbody');
		if (rows.length === 0) {
			const empty_row = uiu.el(tbody, 'tr');
			uiu.el(empty_row, 'td', { colspan: '7' }, 'Keine Posten vorhanden.');
		}
		rows.forEach((row) => {
			const tr = uiu.el(tbody, 'tr', row.open_amount > 0 ? 'accounting_position_list_open' : 'accounting_position_list_paid');
			uiu.el(tr, 'td', {}, row.state || '-');
			uiu.el(tr, 'td', {}, row.club || '-');
			uiu.el(tr, 'td', {}, row.name || '-');
			uiu.el(tr, 'td', {}, accounting_position_list_detail_label(row));
			uiu.el(tr, 'td', 'accounting_position_list_money', registration_money_label(row.amount));
			uiu.el(tr, 'td', { title: accounting_position_list_invoice_title(row) }, accounting_position_list_invoice_compact_label(row));
			const paid_cell = uiu.el(tr, 'td', 'accounting_position_list_paid_cell');
			const paid_attrs = {
				type: 'checkbox',
				disabled: 'disabled',
				title: accounting_position_list_paid_title(row),
			};
			if (accounting_position_list_is_paid(row)) {
				paid_attrs.checked = 'checked';
			}
			uiu.el(paid_cell, 'input', paid_attrs);
		});
		pdf_btn.addEventListener('click', async () => {
			pdf_btn.disabled = true;
			try {
				await download_accounting_position_list_pdf(rows);
			} catch (err) {
				cerror.net(err);
				alert('PDF konnte nicht erstellt werden: ' + (err?.message || err));
			} finally {
				pdf_btn.disabled = false;
			}
		});
		csv_btn.addEventListener('click', () => {
			save_file(new Blob([accounting_position_list_csv(rows)], { type: 'text/csv;charset=utf-8' }), accounting_position_list_filename('csv'));
		});
		close_btn.addEventListener('click', close_accounting_position_list_dialog);
		close_btn.focus();
	}

	function render_accounting_item_admin(container) {
		let edit_item_id = null;
		const section = uiu.el(container, 'section', 'accounting_items');
		const header = uiu.el(section, 'div', 'accounting_items_header');
		uiu.el(header, 'h2', {}, 'Artikel');
		const form = uiu.el(section, 'form', 'accounting_item_form');
		const name_input = uiu.el(form, 'input', {
			type: 'text',
			name: 'name',
			placeholder: 'Name',
			maxlength: '160',
			required: 'required',
		});
		const billing_type = uiu.el(form, 'select', { name: 'billing_type' });
		uiu.el(billing_type, 'option', { value: 'optional' }, 'Optionaler Artikel');
		uiu.el(billing_type, 'option', { value: 'required_player' }, 'Pflichtartikel je Spieler');
		uiu.el(billing_type, 'option', { value: 'required_discipline' }, 'Pflichtartikel je Disziplin');
		const overview_category = uiu.el(form, 'select', { name: 'overview_category' });
		uiu.el(overview_category, 'option', { value: 'item' }, 'Zählt als Artikel');
		uiu.el(overview_category, 'option', { value: 'fee' }, 'Zählt als Meldegeld');
		const unit_price = uiu.el(form, 'input', {
			type: 'text',
			name: 'unit_price',
			placeholder: 'Preis je Verkaufseinheit',
			inputmode: 'decimal',
			required: 'required',
		});
		const sale_unit = uiu.el(form, 'input', {
			type: 'text',
			name: 'sale_unit',
			placeholder: 'Verkaufseinheit',
			value: 'Stk.',
		});
		const note = uiu.el(form, 'input', {
			type: 'text',
			name: 'note',
			placeholder: 'Notiz',
			maxlength: '500',
		});
		const form_actions = uiu.el(form, 'div', 'accounting_item_form_actions');
		const add_btn = uiu.el(form_actions, 'button', { type: 'submit' }, 'Hinzufügen');
		const cancel_edit_btn = uiu.el(form_actions, 'button', {
			type: 'button',
			'class': 'accounting_item_cancel_edit',
			hidden: 'hidden',
		}, 'Abbrechen');
		function reset_item_definition_form() {
			edit_item_id = null;
			form.reset();
			overview_category.value = 'item';
			sale_unit.value = 'Stk.';
			add_btn.textContent = 'Hinzufügen';
			cancel_edit_btn.hidden = true;
		}
		function edit_accounting_item(item) {
			edit_item_id = item.id;
			name_input.value = item.name || '';
			billing_type.value = accounting_item_billing_type(item);
			overview_category.value = accounting_item_overview_category(item);
			unit_price.value = String(item.unit_price ?? '').replace('.', ',');
			sale_unit.value = accounting_item_sale_unit(item);
			note.value = item.note || '';
			add_btn.textContent = 'Speichern';
			cancel_edit_btn.hidden = false;
			name_input.focus();
		}
		cancel_edit_btn.addEventListener('click', reset_item_definition_form);
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const payload = {
				name: name_input.value,
				billing_type: billing_type.value,
				overview_category: overview_category.value,
				unit_price: unit_price.value,
				sale_unit: sale_unit.value,
				note: note.value,
			};
			const save = edit_item_id
				? update_registration_accounting_item_record.bind(null, edit_item_id, payload)
				: add_registration_accounting_item.bind(null, payload);
			save(function(err) {
				if (err) {
					return;
				}
				reset_item_definition_form();
			});
		});
		const list = uiu.el(section, 'div', 'accounting_item_list');
		const items = registration_accounting_items()
			.slice()
			.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de', {
				numeric: true,
				sensitivity: 'base',
			}));
		if (items.length === 0) {
			uiu.el(list, 'div', 'accounting_item_empty', 'Noch keine Artikel angelegt.');
		}
		items.forEach((item) => {
			const row = uiu.el(list, 'div', 'accounting_item_row');
			uiu.el(row, 'strong', {}, item.name || 'Artikel');
			uiu.el(row, 'span', {}, accounting_item_billing_label(item));
			uiu.el(row, 'span', {}, accounting_item_overview_label(item));
			uiu.el(row, 'span', {}, registration_money_label(item.unit_price || 0));
			uiu.el(row, 'span', {}, 'je ' + accounting_item_sale_unit(item));
			uiu.el(row, 'span', 'accounting_item_note', item.note || '');
			const action_wrap = uiu.el(row, 'div', 'accounting_item_actions');
			const edit_btn = uiu.el(action_wrap, 'button', {
				type: 'button',
				'class': 'accounting_entry_remove',
			}, 'Bearbeiten');
			edit_btn.addEventListener('click', () => edit_accounting_item(item));
			const remove_btn = uiu.el(action_wrap, 'button', {
				type: 'button',
				'class': 'accounting_entry_remove',
			}, 'Entfernen');
			remove_btn.addEventListener('click', () => {
				if (confirm('Artikel entfernen? Bestehende Buchungen bleiben erhalten.')) {
					remove_registration_accounting_item(item.id);
				}
			});
		});
		add_btn.disabled = false;
	}

	function accounting_letterhead_label(field) {
		return field === 'accounting_letterhead_first_pdf' ? 'Erste Seite' : 'Folgeseiten';
	}

	function accounting_letterhead_has_pdf(field) {
		return /^data:application\/pdf;base64,/.test(String(curt?.[field] || ''));
	}

	function accounting_letterhead_preview_pdf_url(background) {
		const raw = String(background || '').trim();
		if (!/^data:application\/pdf;base64,/.test(raw)) {
			return '';
		}
		return raw + '#toolbar=0&navpanes=0&scrollbar=0&view=Fit';
	}

	function accounting_letterhead_pdf_for_field(field) {
		if (field === 'accounting_letterhead_follow_pdf') {
			return curt?.accounting_letterhead_follow_pdf || curt?.accounting_letterhead_first_pdf || '';
		}
		return curt?.accounting_letterhead_first_pdf || '';
	}

	function accounting_letterhead_status_text(field) {
		if (accounting_letterhead_has_pdf(field)) {
			return 'PDF hinterlegt';
		}
		if (field === 'accounting_letterhead_follow_pdf' && accounting_letterhead_has_pdf('accounting_letterhead_first_pdf')) {
			return 'nutzt Erste Seite';
		}
		return 'kein PDF hinterlegt';
	}

	function update_accounting_letterhead_preview(field, preview_el, status_el) {
		if (status_el) {
			uiu.text(status_el, accounting_letterhead_status_text(field));
		}
		if (!preview_el) {
			return;
		}
		uiu.empty(preview_el);
		const preview_url = accounting_letterhead_preview_pdf_url(accounting_letterhead_pdf_for_field(field));
		if (!preview_url) {
			uiu.el(preview_el, 'span', 'accounting_letterhead_preview_empty', 'Keine Vorschau');
			return;
		}
		uiu.el(preview_el, 'object', {
			'class': 'accounting_letterhead_preview_pdf',
			type: 'application/pdf',
			data: preview_url,
		});
	}

	function set_accounting_letterhead_pdf(field, value, status_el, preview_el) {
		const previous = curt?.[field] || '';
		curt[field] = value || '';
		uiu.text(status_el, value ? 'wird gespeichert...' : 'wird entfernt...');
		send_single_prop(field, curt[field], function(err) {
			if (err) {
				curt[field] = previous;
				uiu.text(status_el, 'Fehler: ' + (err.message || 'Speichern fehlgeschlagen'));
				update_accounting_letterhead_preview(field, preview_el, status_el);
				return;
			}
			update_accounting_letterhead_preview(field, preview_el, status_el);
			if (field === 'accounting_letterhead_first_pdf' && current_view === 'accounting') {
				ui_accounting();
			}
		});
	}

	function read_accounting_letterhead_pdf(field, file, status_el, preview_el) {
		if (!file) {
			return;
		}
		if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
			alert('Bitte eine PDF-Datei auswählen.');
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const value = String(reader.result || '');
			if (!/^data:application\/pdf;base64,/.test(value)) {
				alert('Die Datei konnte nicht als PDF gelesen werden.');
				return;
			}
			set_accounting_letterhead_pdf(field, value, status_el, preview_el);
		};
		reader.onerror = () => {
			uiu.text(status_el, 'Fehler beim Lesen');
		};
		uiu.text(status_el, 'wird gelesen...');
		reader.readAsDataURL(file);
	}

	function close_accounting_letterhead_layout_dialog() {
		const dialog = document.querySelector('.accounting_letterhead_layout_dialog');
		if (!dialog) {
			return;
		}
		uiu.remove(dialog);
		cbts_utils.esc_stack_pop();
	}

	function clone_accounting_letterhead_layout(layout) {
		return JSON.parse(JSON.stringify(layout || accounting_letterhead_default_layout));
	}

	function set_accounting_letterhead_layout(layout, callback) {
		const previous = curt?.accounting_letterhead_layout;
		curt.accounting_letterhead_layout = clone_accounting_letterhead_layout(layout);
		send_single_prop('accounting_letterhead_layout', curt.accounting_letterhead_layout, function(err) {
			if (err) {
				curt.accounting_letterhead_layout = previous;
				cerror.net(err);
				alert('Briefpapier-Layout konnte nicht gespeichert werden: ' + (err.message || err));
				if (typeof callback === 'function') {
					callback(err);
				}
				return;
			}
			if (typeof callback === 'function') {
				callback(null);
			}
		});
	}

	function accounting_letterhead_sample_causes(names, details, amount) {
		return names.map((name, index) => ({
			label: name,
			detail: details[index % details.length],
			amount,
		}));
	}

	function accounting_letterhead_sample_document(document_type) {
		const names = [
			'Anna Musterfrau',
			'Ben Beispiel',
			'Carla Demo',
			'David Platzhalter',
			'Emilia Test',
			'Finn Layout',
			'Greta Vorschau',
			'Hannes Rechnung',
			'Ida Kontrolle',
			'Jonas Blindtext',
			'Klara Satzspiegel',
			'Lukas Papier',
			'Mia Seitenlauf',
			'Nico Druckbereich',
			'Ole Umbruch',
			'Paula Zahlung',
			'Rike Quittung',
			'Sam Tabelle',
			'Tara Kopfzeile',
			'Yannick Fußzeile',
		];
		const event_details = ['JE U11', 'ME U13', 'JD U15', 'HE U17', 'GD U19'];
		const fee_causes = accounting_letterhead_sample_causes(names, event_details, 7);
		const physio_names = names.slice(0, 16);
		const physio_causes = accounting_letterhead_sample_causes(physio_names, [''], 3);
		const dbv_causes = accounting_letterhead_sample_causes(names.concat([
			'Zoe Mehrseite',
			'Max Musterbogen',
			'Lea Layouttest',
			'Noah Beispieltext',
		]), event_details, 1);
		const shirt_causes = accounting_letterhead_sample_causes(names.slice(0, 8), ['Größe XL'], 18);
		const lines = [
			{
				description: 'Meldegeld',
				quantity: fee_causes.length,
				sale_unit: 'Meldung',
				unit_price: 7,
				amount: fee_causes.length * 7,
				caused_by: fee_causes,
			},
			{
				description: 'Physio Umlage',
				quantity: physio_causes.length,
				sale_unit: 'Teilnehmer',
				unit_price: 3,
				amount: physio_causes.length * 3,
				caused_by: physio_causes,
			},
			{
				description: 'DBV Turnierumlage',
				quantity: dbv_causes.length,
				sale_unit: 'Meldung',
				unit_price: 1,
				amount: dbv_causes.length,
				caused_by: dbv_causes,
			},
			{
				description: 'VICTOR GoldChampion',
				quantity: 4,
				sale_unit: 'Rolle à 12 Bälle',
				unit_price: 38,
				amount: 152,
				caused_by: [
					{ label: 'SV Musterstadt', detail: '14.09.2026, 09:12', amount: 76 },
					{ label: 'Anna Musterfrau', detail: '14.09.2026, 10:38', amount: 38 },
					{ label: 'Finn Layout', detail: '14.09.2026, 11:05', amount: 38 },
				],
			},
			{
				description: 'Turnier-Shirt in XL',
				quantity: shirt_causes.length,
				sale_unit: 'Stk.',
				unit_price: 18,
				amount: shirt_causes.length * 18,
				caused_by: shirt_causes,
			},
			{
				description: 'Trainingsfeld-Pauschale',
				quantity: 2,
				sale_unit: 'Stunden',
				unit_price: 25,
				amount: 50,
				caused_by: [
					{ label: 'SV Musterstadt', detail: 'Samstag', amount: 25 },
					{ label: 'SV Musterstadt', detail: 'Sonntag', amount: 25 },
				],
			},
		];
		const total = registration_money_number(lines.reduce((sum, line) => sum + registration_money_number(line.amount), 0));
		const paid_total = document_type === 'invoice' ? 120 : total;
		const issued_at = registration_datetime_storage_value();
		const payment = accounting_payment_settings();
		return {
			id: 'sample-' + document_type,
			document_type,
			document_number: (document_type === 'invoice' ? 'RE' : 'QU') + '-2026-MUSTER-0001',
			status: document_type === 'invoice' ? 'issued' : 'paid',
			buyer_type: 'club',
			buyer_name: 'SV Musterstadt',
			club: 'SV Musterstadt',
			state: 'Musterland',
			issued_at,
			lines,
			total,
			paid_total,
			open_total: Math.max(0, total - paid_total),
			payment_recipient: payment.recipient,
			payment_bank: payment.bank,
			payment_iban: payment.iban,
			payment_bic: payment.bic,
			due_at: document_type === 'invoice' ? accounting_invoice_due_at(issued_at, payment.due_days) : '',
			note: document_type === 'invoice'
				? 'Bitte überweisen Sie den offenen Betrag unter Angabe der Rechnungsnummer. Dies ist Blindtext zur Prüfung von Zeilenumbruch, Satzspiegel und Seitenlauf.'
				: 'Betrag dankend erhalten. Dies ist Blindtext zur Prüfung von Zeilenumbruch, Satzspiegel und Seitenlauf.',
		};
	}

	function open_accounting_letterhead_sample(document_type, layout, first_page_number_input, button) {
		button.disabled = true;
		open_accounting_document_pdf(accounting_letterhead_sample_document(document_type), {
			letterhead_layout: layout,
			first_page_number_enabled: first_page_number_input.checked,
			watermark: 'MUSTER',
		})
			.catch((err) => {
				cerror.net(err);
				alert('Muster-PDF konnte nicht erstellt werden: ' + (err?.message || err));
			})
			.finally(() => {
				button.disabled = false;
			});
	}

	function show_accounting_letterhead_layout_dialog() {
		close_accounting_letterhead_layout_dialog();
		cbts_utils.esc_stack_push(close_accounting_letterhead_layout_dialog);
		const layout = clone_accounting_letterhead_layout(accounting_letterhead_layout());
		const dialog_bg = uiu.el(uiu.qs('body'), 'div', 'dialog_bg accounting_letterhead_layout_dialog');
		dialog_bg.addEventListener('click', (e) => {
			if (e.target === dialog_bg) {
				close_accounting_letterhead_layout_dialog();
			}
		});
		const dialog = uiu.el(dialog_bg, 'div', 'dialog accounting_letterhead_layout_box');
		uiu.el(dialog, 'h3', {}, 'Briefpapier-Layout');
		uiu.el(dialog, 'p', 'accounting_letterhead_layout_hint', 'Alle Werte in mm von oben links auf A4.');
		const form = uiu.el(dialog, 'form', 'accounting_letterhead_layout_form');
		const body = uiu.el(form, 'div', 'accounting_letterhead_layout_body');
		const fields = uiu.el(body, 'div', 'accounting_letterhead_layout_fields');
		const previews = uiu.el(body, 'div', 'accounting_letterhead_layout_previews');
		const options = uiu.el(fields, 'section', 'accounting_letterhead_layout_page_fields accounting_letterhead_layout_options');
		const first_page_number_label = uiu.el(options, 'label', 'accounting_letterhead_layout_checkbox');
		const first_page_number_attrs = {
			type: 'checkbox',
		};
		if (accounting_first_page_number_enabled()) {
			first_page_number_attrs.checked = 'checked';
		}
		const first_page_number_input = uiu.el(first_page_number_label, 'input', first_page_number_attrs);
		uiu.el(first_page_number_label, 'span', {}, 'Seitenzahl auf erster Seite anzeigen');
		const preview_boxes = {};
		const input_controls = [];
		function input_value(input) {
			return registration_money_number(input.value || 0);
		}
		function format_mm(value) {
			return String(registration_money_number(value));
		}
		function sync_preview_font_size(box, area_key) {
			const page = box.closest('.accounting_letterhead_layout_page');
			const page_width = page?.getBoundingClientRect().width || 0;
			const pdf_size = accounting_letterhead_preview_font_sizes[area_key] || 9;
			if (page_width > 0) {
				box.style.fontSize = (pdf_size * page_width / 595.28) + 'px';
			}
		}
		function sync_preview() {
			Object.keys(preview_boxes).forEach((key) => {
				const [page_key, area_key] = key.split(':');
				const area = layout[page_key][area_key];
				if (!area) {
					return;
				}
				const box = preview_boxes[key];
				if (page_key === 'first' && area_key === 'footer') {
					box.hidden = !first_page_number_input.checked;
				}
				box.style.left = (area.x / 210 * 100) + '%';
				box.style.top = (area.y / 297 * 100) + '%';
				box.style.width = (area.width / 210 * 100) + '%';
				box.style.height = (area.height / 297 * 100) + '%';
				sync_preview_font_size(box, area_key);
			});
		}
		function sync_inputs() {
			input_controls.forEach((control) => {
				control.input.value = format_mm(control.area[control.prop]);
			});
			sync_preview();
		}
		Object.keys(accounting_letterhead_page_labels).forEach((page_key) => {
			const page_section = uiu.el(fields, 'section', 'accounting_letterhead_layout_page_fields');
			uiu.el(page_section, 'h4', {}, accounting_letterhead_page_labels[page_key]);
			Object.keys(layout[page_key]).forEach((area_key) => {
				const area = layout[page_key][area_key];
				const fields_for_area = accounting_letterhead_area_fields[area_key] || accounting_letterhead_area_fields.content;
				const row = uiu.el(page_section, 'div', 'accounting_letterhead_layout_area_row' +
					(fields_for_area.length <= 2 ? ' accounting_letterhead_layout_area_row_anchor' : ''));
				uiu.el(row, 'strong', {}, accounting_letterhead_area_labels[area_key]);
				fields_for_area.forEach(([prop, label]) => {
					const wrapper = uiu.el(row, 'label');
					uiu.el(wrapper, 'span', {}, label);
					const input = uiu.el(wrapper, 'input', {
						type: 'number',
						inputmode: 'decimal',
						step: '0.5',
						min: '0',
						max: '300',
						value: format_mm(area[prop]),
					});
					input.addEventListener('input', () => {
						area[prop] = input_value(input);
						sync_preview();
					});
					input_controls.push({ input, area, prop });
				});
			});
		});
		Object.keys(accounting_letterhead_page_labels).forEach((page_key) => {
			const preview = uiu.el(previews, 'section', 'accounting_letterhead_layout_preview');
			uiu.el(preview, 'h4', {}, accounting_letterhead_page_labels[page_key]);
			const page = uiu.el(preview, 'div', 'accounting_letterhead_layout_page');
			const background = page_key === 'first'
				? curt?.accounting_letterhead_first_pdf
				: (curt?.accounting_letterhead_follow_pdf || curt?.accounting_letterhead_first_pdf);
			const background_url = accounting_letterhead_preview_pdf_url(background);
			if (background_url) {
				uiu.el(page, 'object', {
					'class': 'accounting_letterhead_layout_pdf',
					type: 'application/pdf',
					data: background_url,
				});
			}
			Object.keys(layout[page_key]).forEach((area_key) => {
				const box = uiu.el(page, 'div', 'accounting_letterhead_layout_box_area accounting_letterhead_layout_box_' + area_key +
					(accounting_letterhead_preview_bold_areas.has(area_key) ? ' accounting_letterhead_layout_box_bold' : ''));
				uiu.el(box, 'span', {}, accounting_letterhead_area_labels[area_key]);
				preview_boxes[page_key + ':' + area_key] = box;
			});
		});
		sync_preview();
		const resize_observer = typeof ResizeObserver !== 'undefined'
			? new ResizeObserver(sync_preview)
			: null;
		if (resize_observer) {
			dialog.querySelectorAll('.accounting_letterhead_layout_page').forEach((page) => resize_observer.observe(page));
		}
		const actions = uiu.el(form, 'div', 'registration_item_actions accounting_letterhead_layout_actions');
		const sample_invoice_btn = uiu.el(actions, 'button', { type: 'button' }, 'Musterrechnung');
		const sample_receipt_btn = uiu.el(actions, 'button', { type: 'button' }, 'Musterquittung');
		const reset_btn = uiu.el(actions, 'button', { type: 'button' }, 'Standardwerte');
		const save_btn = uiu.el(actions, 'button', { type: 'submit' }, 'Speichern');
		const close_btn = uiu.el(actions, 'button', { type: 'button' }, 'Schließen');
		sample_invoice_btn.addEventListener('click', () => {
			open_accounting_letterhead_sample('invoice', layout, first_page_number_input, sample_invoice_btn);
		});
		sample_receipt_btn.addEventListener('click', () => {
			open_accounting_letterhead_sample('receipt', layout, first_page_number_input, sample_receipt_btn);
		});
		reset_btn.addEventListener('click', () => {
			const defaults = clone_accounting_letterhead_layout(accounting_letterhead_default_layout);
			Object.keys(defaults).forEach((page_key) => {
				Object.keys(defaults[page_key]).forEach((area_key) => {
					Object.assign(layout[page_key][area_key], defaults[page_key][area_key]);
				});
			});
			sync_inputs();
		});
		first_page_number_input.addEventListener('change', () => {
			curt.accounting_letterhead_first_page_number_enabled = first_page_number_input.checked;
			sync_preview();
			send_single_prop('accounting_letterhead_first_page_number_enabled', first_page_number_input.checked, function(err) {
				if (err) {
					curt.accounting_letterhead_first_page_number_enabled = !first_page_number_input.checked;
					first_page_number_input.checked = !first_page_number_input.checked;
					sync_preview();
					cerror.net(err);
				}
			});
		});
		close_btn.addEventListener('click', close_accounting_letterhead_layout_dialog);
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			save_btn.disabled = true;
			set_accounting_letterhead_layout(layout, (err) => {
				if (err) {
					save_btn.disabled = false;
					return;
				}
				close_accounting_letterhead_layout_dialog();
				if (current_view === 'accounting') {
					ui_accounting();
				}
			});
		});
	}

	function render_accounting_letterhead_admin(container) {
		const section = uiu.el(container, 'section', 'accounting_letterhead');
		const header = uiu.el(section, 'div', 'accounting_letterhead_header');
		uiu.el(header, 'h2', {}, 'Briefpapier');
		uiu.el(header, 'span', {}, 'PDF-Hintergrund für Rechnungen und Quittungen');
		const layout_btn = uiu.el(header, 'button', { type: 'button', 'class': 'accounting_letterhead_layout_open' }, 'Layout bearbeiten');
		layout_btn.addEventListener('click', show_accounting_letterhead_layout_dialog);
		const rows = uiu.el(section, 'div', 'accounting_letterhead_rows');
		['accounting_letterhead_first_pdf', 'accounting_letterhead_follow_pdf'].forEach((field) => {
			const row = uiu.el(rows, 'div', 'accounting_letterhead_row');
			const controls = uiu.el(row, 'div', 'accounting_letterhead_controls');
			uiu.el(controls, 'strong', {}, accounting_letterhead_label(field));
			const input = uiu.el(row, 'input', {
				type: 'file',
				accept: 'application/pdf,.pdf',
				'class': 'accounting_letterhead_file',
			});
			const button_row = uiu.el(controls, 'div', 'accounting_letterhead_button_row');
			const pick_btn = uiu.el(button_row, 'button', { type: 'button', 'class': 'accounting_letterhead_pick' }, 'PDF auswählen');
			const remove_btn = uiu.el(button_row, 'button', { type: 'button' }, 'Entfernen');
			const status = uiu.el(controls, 'span', 'accounting_letterhead_status', accounting_letterhead_status_text(field));
			const preview = uiu.el(row, 'div', 'accounting_letterhead_preview');
			update_accounting_letterhead_preview(field, preview, status);
			pick_btn.addEventListener('click', () => input.click());
			input.addEventListener('change', () => read_accounting_letterhead_pdf(field, input.files && input.files[0], status, preview));
			remove_btn.addEventListener('click', () => {
				if (!accounting_letterhead_has_pdf(field) || confirm(accounting_letterhead_label(field) + ' entfernen?')) {
					set_accounting_letterhead_pdf(field, '', status, preview);
					input.value = '';
				}
			});
		});
	}

	function accounting_sort_by_label(a, b) {
		return String(accounting_account_label(a)).localeCompare(String(accounting_account_label(b)), 'de', {
			numeric: true,
			sensitivity: 'base',
		});
	}

	function accounting_tree_is_expanded(key, default_expanded) {
		return accounting_tree_expansion_state.has(key)
			? accounting_tree_expansion_state.get(key)
			: default_expanded;
	}

	function accounting_tree_toggle(key, default_expanded, tbody, search, balance_filter) {
		accounting_tree_expansion_state.set(key, !accounting_tree_is_expanded(key, default_expanded));
		if (tbody && search && balance_filter) {
			update_accounting_tree_visibility(tbody, search.value, balance_filter.value);
		} else {
			ui_accounting();
		}
	}

	function accounting_tree_row_matches_filter(row, needle, balance_mode) {
		const matches_search = !needle || String(row.getAttribute('data-accounting-search') || '').includes(needle);
		const due_total = registration_money_number(row.getAttribute('data-accounting-due') || 0);
		const open_total = registration_money_number(row.getAttribute('data-accounting-open') || 0);
		const matches_balance = balance_mode === 'due'
			? due_total > 0
			: balance_mode === 'open'
				? open_total > 0
				: true;
		return matches_search && matches_balance;
	}

	function update_accounting_tree_visibility(tbody, search_value, balance_mode) {
		const needle = registration_filter_text(search_value);
		const search_active = needle !== '';
		tbody.querySelectorAll('tr.accounting_tree_row').forEach((row) => {
			let parent_keys = [];
			try {
				parent_keys = JSON.parse(row.getAttribute('data-accounting-parent-keys') || '[]');
			} catch (err) {
				parent_keys = [];
			}
			const parents_expanded = search_active || parent_keys.every((key) => {
				const default_expanded = key.indexOf('/club:') < 0;
				return accounting_tree_is_expanded(key, default_expanded);
			});
			row.hidden = !parents_expanded || !accounting_tree_row_matches_filter(row, needle, balance_mode);
		});
		tbody.querySelectorAll('tr.accounting_tree_has_children').forEach((row) => {
			const toggle_key = row.getAttribute('data-accounting-tree-key') || '';
			const default_expanded = row.getAttribute('data-accounting-default-expanded') === 'true';
			const expanded = search_active || accounting_tree_is_expanded(toggle_key, default_expanded);
			const toggle = row.querySelector('.accounting_tree_toggle');
			row.classList.toggle('accounting_tree_expanded', expanded);
			if (toggle) {
				toggle.textContent = expanded ? '-' : '+';
				toggle.title = expanded ? 'Einklappen' : 'Ausklappen';
				toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
			}
		});
	}

	function accounting_group_account(account_type, account_id, label, data) {
		data = data || {};
		return {
			account_type,
			account_id,
			display_name: label,
			buyer_name: label,
			club: data.club || '',
			state: data.state || '',
			fee_items: [],
			mandatory_items: [],
			btp_payments: [],
			local_entries: [],
			fee_total: 0,
			mandatory_charge_total: 0,
			local_charge_total: 0,
			item_total: 0,
			btp_paid_total: 0,
			local_paid_total: 0,
			overview_fee_total: 0,
			overview_item_total: 0,
			due_total: 0,
			paid_total: 0,
			open_total: 0,
			accounting_group_only: true,
		};
	}

	function accounting_rollup_account(account, children) {
		children = children || [];
		const rollup = {
			...account,
			fee_items: [...(account?.fee_items || [])],
			mandatory_items: [...(account?.mandatory_items || [])],
			btp_payments: [...(account?.btp_payments || [])],
			local_entries: [...(account?.local_entries || [])],
			summary_fee_items: [...(account?.summary_fee_items || account?.fee_items || [])],
			summary_mandatory_items: [...(account?.summary_mandatory_items || account?.mandatory_items || [])],
			summary_btp_payments: [...(account?.summary_btp_payments || account?.btp_payments || [])],
			summary_local_entries: [...(account?.summary_local_entries || account?.local_entries || [])],
			child_summary_fee_items: [],
			child_summary_mandatory_items: [],
			child_summary_btp_payments: [],
			child_summary_local_entries: [],
			direct_fee_total: registration_money_number(account?.fee_total || 0),
			direct_item_total: registration_money_number(account?.item_total || 0),
			direct_overview_fee_total: registration_money_number(account?.overview_fee_total || 0),
			direct_overview_item_total: registration_money_number(account?.overview_item_total || 0),
			direct_due_total: registration_money_number(account?.due_total || 0),
			direct_paid_total: registration_money_number(account?.paid_total || 0),
			direct_open_total: registration_money_number(account?.open_total || 0),
			child_fee_total: 0,
			child_item_total: 0,
			child_overview_fee_total: 0,
			child_overview_item_total: 0,
			child_due_total: 0,
			child_paid_total: 0,
			child_open_total: 0,
			accounting_rollup: children.length > 0,
		};
		[
			'fee_total',
			'mandatory_charge_total',
			'local_charge_total',
			'item_total',
			'overview_fee_total',
			'overview_item_total',
			'btp_paid_total',
			'local_paid_total',
			'due_total',
			'paid_total',
			'open_total',
		].forEach((field) => {
			rollup[field] = registration_money_number(account?.[field] || 0);
		});
		children.forEach((child) => {
			const fee_items = child?.summary_fee_items || child?.fee_items || [];
			const mandatory_items = child?.summary_mandatory_items || child?.mandatory_items || [];
			const btp_payments = child?.summary_btp_payments || child?.btp_payments || [];
			const local_entries = child?.summary_local_entries || child?.local_entries || [];
			rollup.summary_fee_items.push(...fee_items);
			rollup.summary_mandatory_items.push(...mandatory_items);
			rollup.summary_btp_payments.push(...btp_payments);
			rollup.summary_local_entries.push(...local_entries);
			rollup.child_summary_fee_items.push(...fee_items);
			rollup.child_summary_mandatory_items.push(...mandatory_items);
			rollup.child_summary_btp_payments.push(...btp_payments);
			rollup.child_summary_local_entries.push(...local_entries);
			rollup.child_fee_total += registration_money_number(child?.fee_total || 0);
			rollup.child_item_total += registration_money_number(child?.item_total || 0);
			rollup.child_overview_fee_total += registration_money_number(child?.overview_fee_total || 0);
			rollup.child_overview_item_total += registration_money_number(child?.overview_item_total || 0);
			rollup.child_due_total += registration_money_number(child?.due_total || 0);
			rollup.child_paid_total += registration_money_number(child?.paid_total || 0);
			rollup.child_open_total += registration_money_number(child?.open_total || 0);
			rollup.fee_total += registration_money_number(child?.fee_total || 0);
			rollup.mandatory_charge_total += registration_money_number(child?.mandatory_charge_total || 0);
			rollup.local_charge_total += registration_money_number(child?.local_charge_total || 0);
			rollup.item_total += registration_money_number(child?.item_total || 0);
			rollup.overview_fee_total += registration_money_number(child?.overview_fee_total || 0);
			rollup.overview_item_total += registration_money_number(child?.overview_item_total || 0);
			rollup.btp_paid_total += registration_money_number(child?.btp_paid_total || 0);
			rollup.local_paid_total += registration_money_number(child?.local_paid_total || 0);
			rollup.due_total += registration_money_number(child?.due_total || 0);
			rollup.paid_total += registration_money_number(child?.paid_total || 0);
			rollup.open_total += registration_money_number(child?.open_total || 0);
		});
		[
			'fee_total',
			'mandatory_charge_total',
			'local_charge_total',
			'item_total',
			'overview_fee_total',
			'overview_item_total',
			'btp_paid_total',
			'local_paid_total',
			'due_total',
			'paid_total',
			'open_total',
			'child_fee_total',
			'child_item_total',
			'child_overview_fee_total',
			'child_overview_item_total',
			'child_due_total',
			'child_paid_total',
			'child_open_total',
		].forEach((field) => {
			rollup[field] = registration_money_number(rollup[field] || 0);
		});
		return rollup;
	}

	function build_accounting_tree(accounts) {
		const state_nodes = new Map();
		const none_accounts = [];
		const state_fallback_id = 'state_without_state';
		const state_fallback_label = 'Ohne Landesverband';
		const club_fallback_id = 'club_without_club';
		const club_fallback_label = 'Ohne Verein';
		function get_state_node(state_name, account) {
			const label = String(state_name || account?.state || account?.display_name || state_fallback_label).trim() || state_fallback_label;
			const id = label === state_fallback_label ? state_fallback_id : accounting_state_id(label);
			if (!state_nodes.has(id)) {
				state_nodes.set(id, {
					account: account || accounting_group_account('state_group', id, label, { state: label }),
					tree_key: 'state:' + id,
					clubs: new Map(),
				});
			}
			const node = state_nodes.get(id);
			if (account && account.account_type === 'state') {
				node.account = account;
			}
			return node;
		}
		function get_club_node(state_node, club_name, account) {
			const label = String(club_name || account?.club || account?.display_name || club_fallback_label).trim() || club_fallback_label;
			const id = label === club_fallback_label ? club_fallback_id : accounting_club_id(label);
			if (!state_node.clubs.has(id)) {
				state_node.clubs.set(id, {
					account: account || accounting_group_account('club_group', id, label, {
						club: label,
						state: state_node.account?.state || '',
					}),
					tree_key: state_node.tree_key + '/club:' + id,
					players: [],
				});
			}
			const node = state_node.clubs.get(id);
			if (account && account.account_type === 'club') {
				node.account = account;
			}
			return node;
		}
		accounts.forEach((account) => {
			if (account.account_type === 'none') {
				none_accounts.push(account);
				return;
			}
			if (account.account_type === 'state') {
				get_state_node(account.state || accounting_account_label(account), account);
			}
		});
		accounts.forEach((account) => {
			if (account.account_type === 'club') {
				const state_node = get_state_node(account.state || state_fallback_label);
				get_club_node(state_node, account.club || accounting_account_label(account), account);
			}
		});
		accounts.forEach((account) => {
			if (account.account_type !== 'player') {
				return;
			}
			const state_node = get_state_node(account.state || state_fallback_label);
			const club_node = get_club_node(state_node, account.club || club_fallback_label);
			club_node.players.push(account);
		});
		const states = [...state_nodes.values()].sort((a, b) => accounting_sort_by_label(a.account, b.account));
		states.forEach((state) => {
			state.clubs = [...state.clubs.values()].sort((a, b) => accounting_sort_by_label(a.account, b.account));
			state.clubs.forEach((club) => {
				club.players.sort(accounting_sort_by_label);
				club.rollup_account = accounting_rollup_account(club.account, club.players);
				club.search_text = registration_filter_text([
					accounting_account_label(club.account),
					club.account?.club,
					club.account?.state,
					...club.players.map((player_account) => [
						accounting_account_label(player_account),
						player_account.club,
						player_account.state,
					].join(' ')),
				].join(' '));
			});
			state.rollup_account = accounting_rollup_account(state.account, state.clubs.map((club) => club.rollup_account));
			state.search_text = registration_filter_text([
				accounting_account_label(state.account),
				state.account?.state,
				...state.clubs.map((club) => club.search_text || accounting_account_label(club.account)),
			].join(' '));
		});
		none_accounts.sort(accounting_sort_by_label);
		return { states, none_accounts };
	}

	function render_accounting_account_row(tbody, account, level, options) {
		options = options || {};
		const invoiced_total = accounting_invoiced_total(account);
		const display_open_total = accounting_display_open_total(account, invoiced_total);
		const row_classes = [
			display_open_total > 0 ? 'accounting_row_open' : 'accounting_row_done',
			'accounting_tree_row',
			'accounting_tree_row_level_' + level,
			'accounting_tree_' + (account.account_type || 'account'),
		];
		if (options.toggle_key) {
			row_classes.push('accounting_tree_has_children');
		}
		if (options.toggle_key && options.expanded) {
			row_classes.push('accounting_tree_expanded');
		}
			const tr = uiu.el(tbody, 'tr', {
				'class': row_classes.join(' '),
				'data-accounting-search': options.search_text || registration_filter_text([
					accounting_account_label(account),
					account.club,
					account.state,
				].join(' ')),
				'data-accounting-due': String(registration_money_number(account.due_total || 0)),
				'data-accounting-open': String(display_open_total),
				'data-accounting-tree-key': options.toggle_key || options.tree_key || '',
				'data-accounting-parent-keys': JSON.stringify(options.parent_keys || []),
				'data-accounting-default-expanded': options.default_expanded ? 'true' : 'false',
			});
		const name_cell = uiu.el(tr, 'td', 'accounting_col_player accounting_tree_cell accounting_tree_level_' + level);
		const label_line = uiu.el(name_cell, 'span', 'accounting_tree_label');
		if (options.toggle_key) {
			const toggle = uiu.el(label_line, 'button', {
				type: 'button',
				'class': 'accounting_tree_toggle',
				title: options.expanded ? 'Einklappen' : 'Ausklappen',
				'aria-expanded': options.expanded ? 'true' : 'false',
			}, options.expanded ? '-' : '+');
			toggle.addEventListener('click', () => accounting_tree_toggle(options.toggle_key, options.default_expanded, tbody, options.search, options.balance_filter));
		} else {
			uiu.el(label_line, 'span', 'accounting_tree_toggle_placeholder');
		}
		uiu.el(label_line, 'strong', {}, accounting_account_label(account) || account.account_id);
		const type_label = {
			player: 'Spieler',
			club: 'Verein',
			state: 'Landesverband',
			club_group: 'Verein',
			state_group: 'Landesverband',
			none: 'Ohne Käufer',
		}[account.account_type] || 'Käufer';
		const detail = [type_label, account.account_type === 'player' ? account.club : '', account.account_type === 'player' ? account.state : '']
			.filter(Boolean)
			.join(', ');
		if (detail) {
			uiu.el(name_cell, 'span', 'accounting_tree_detail', detail);
		}
		if (account.accounting_rollup) {
			const parts = ['inkl. Unterkonten'];
			if (options.child_count) {
				parts.push(String(options.child_count));
			}
			uiu.el(name_cell, 'span', 'accounting_tree_detail', parts.join(' | '));
		}
		const action_cell = uiu.el(tr, 'td', 'accounting_col_actions');
		if (account.accounting_group_only) {
			uiu.el(action_cell, 'span', 'accounting_tree_group_hint', '-');
		} else {
			const pay_btn = uiu.el(action_cell, 'button', {
				type: 'button',
				'class': 'registration_accounting_button',
			}, 'Zahlung');
			pay_btn.addEventListener('click', () => add_registration_payment(null, account));
			const item_btn = uiu.el(action_cell, 'button', {
				type: 'button',
				'class': 'registration_accounting_button',
			}, 'Artikel');
			item_btn.addEventListener('click', () => add_registration_catalog_item(null, account));
			const receipt_btn = uiu.el(action_cell, 'button', {
				type: 'button',
				'class': 'registration_accounting_button',
			}, 'Beleg');
			receipt_btn.addEventListener('click', () => show_registration_receipt(accounting_account_player(account), account));
		}
		render_accounting_balance_cell(tr, account);
		const entries_cell = uiu.el(tr, 'td', 'accounting_col_entries');
		render_accounting_entry_lines(entries_cell, account);
		uiu.el(tr, 'td', 'accounting_col_money', registration_money_label(account.overview_fee_total));
		uiu.el(tr, 'td', 'accounting_col_money', registration_money_label(account.overview_item_total));
	}

	function render_accounting(container) {
		const accounts = [...collect_registration_accounting_accounts().values()]
			.sort(accounting_sort_by_label);
		const header = uiu.el(container, 'div', 'accounting_header');
		const title = uiu.el(header, 'div', 'accounting_title');
		uiu.el(title, 'h1', {}, 'Buchhaltung');
		const due_total = accounts.reduce((sum, account) => sum + registration_money_number(account.due_total), 0);
		const invoiced_total = accounts.reduce((sum, account) => sum + accounting_invoiced_total(account), 0);
		const paid_total = accounts.reduce((sum, account) => sum + registration_money_number(account.paid_total), 0);
		const open_total = accounts.reduce((sum, account) => sum + accounting_display_open_total(account, accounting_invoiced_total(account)), 0);
		uiu.el(title, 'div', 'accounting_summary',
			'Soll ' + registration_money_label(due_total) +
			' | In Rechnung gestellt ' + registration_money_label(invoiced_total) +
			' | Gezahlt ' + registration_money_label(paid_total) +
			' | Offen ' + registration_money_label(open_total));
		const header_actions = uiu.el(title, 'div', 'accounting_header_actions');
		const position_list_btn = uiu.el(header_actions, 'button', { type: 'button' }, 'Postenliste');
		position_list_btn.addEventListener('click', show_accounting_position_list);
		const mode_control = uiu.el(title, 'label', 'accounting_fee_mode');
		uiu.el(mode_control, 'span', {}, 'Meldegeldmodus');
		const mode_select = uiu.el(mode_control, 'select');
		Object.entries(accounting_entry_fee_modes).forEach(([value, config]) => {
			const attrs = { value };
			if (value === accounting_entry_fee_mode()) {
				attrs.selected = 'selected';
			}
			uiu.el(mode_select, 'option', attrs, config.label);
		});
		mode_select.addEventListener('change', () => set_accounting_entry_fee_mode(mode_select.value));
		const invoice_treatment_control = uiu.el(title, 'label', 'accounting_invoice_treatment');
		uiu.el(invoice_treatment_control, 'span', {}, 'In Rechnung gestellt wie');
		const invoice_treatment_select = uiu.el(invoice_treatment_control, 'select');
		Object.entries(accounting_invoice_treatment_modes).forEach(([value, label]) => {
			const attrs = { value };
			if (value === accounting_invoice_treatment_mode()) {
				attrs.selected = 'selected';
			}
			uiu.el(invoice_treatment_select, 'option', attrs, label);
		});
		invoice_treatment_select.addEventListener('change', () => set_accounting_invoice_treatment_mode(invoice_treatment_select.value));
		const code_control = uiu.el(title, 'form', 'accounting_document_code_control');
		uiu.el(code_control, 'span', {}, 'Rechnungskürzel');
		const code_input = uiu.el(code_control, 'input', {
			type: 'text',
			value: curt?.accounting_document_code || '',
			placeholder: 'automatisch',
			autocomplete: 'off',
			spellcheck: 'false',
			maxlength: '24',
		});
		uiu.el(code_control, 'button', { type: 'submit' }, 'Speichern');
		code_control.addEventListener('submit', (e) => {
			e.preventDefault();
			set_accounting_document_code(code_input);
		});
			code_input.addEventListener('blur', () => {
				code_input.value = normalize_accounting_document_code(code_input.value);
			});
			render_accounting_payment_settings(title);
			const filters = uiu.el(header, 'div', 'accounting_filters');
			const balance_filter = uiu.el(filters, 'select', {
				'class': 'accounting_balance_filter',
				'aria-label': 'Konten filtern',
			});
			[
				['all', 'Zeige alle'],
				['due', 'Zeige nur mit Soll'],
				['open', 'Zeige nur Offene'],
			].forEach(([value, label]) => {
				const attrs = { value };
				if (value === accounting_tree_balance_filter) {
					attrs.selected = 'selected';
				}
				uiu.el(balance_filter, 'option', attrs, label);
			});
			const search = uiu.el(filters, 'input', {
				type: 'search',
				'class': 'accounting_search',
				placeholder: 'Käufer, Verein, Landesverband',
				autocomplete: 'off',
				value: accounting_tree_search_value,
			});
		const clear_btn = uiu.el(filters, 'button', {
			type: 'button',
			'class': 'accounting_filter_clear',
		}, 'Löschen');
		render_accounting_letterhead_admin(container);
		render_accounting_item_admin(container);

		if (accounts.length === 0) {
			uiu.el(container, 'div', 'registration_empty', 'Keine Käufer, Meldegelder oder Zahlungen gefunden.');
			return;
		}

		const table_wrap = uiu.el(container, 'div', 'accounting_table_wrap');
		const table = uiu.el(table_wrap, 'table', 'accounting_table');
		const thead = uiu.el(table, 'thead');
		const header_row = uiu.el(thead, 'tr');
		['Käufer', 'Aktionen', 'Zahlungen', 'Positionen', 'Meldegeld', 'Artikel']
			.forEach((label) => uiu.el(header_row, 'th', {}, label));
		const tbody = uiu.el(table, 'tbody');
		const tree = build_accounting_tree(accounts);
		const search_active = registration_filter_text(accounting_tree_search_value) !== '';
		tree.states.forEach((state) => {
			const state_expanded = search_active || accounting_tree_is_expanded(state.tree_key, true);
			render_accounting_account_row(tbody, state.rollup_account || state.account, 0, {
				toggle_key: state.clubs.length > 0 ? state.tree_key : '',
				tree_key: state.tree_key,
				parent_keys: [],
				default_expanded: true,
				expanded: state_expanded,
				child_count: state.clubs.length,
				search_text: state.search_text,
				search,
				balance_filter,
			});
			state.clubs.forEach((club) => {
				const club_expanded = search_active || accounting_tree_is_expanded(club.tree_key, false);
				render_accounting_account_row(tbody, club.rollup_account || club.account, 1, {
					toggle_key: club.players.length > 0 ? club.tree_key : '',
					tree_key: club.tree_key,
					parent_keys: [state.tree_key],
					default_expanded: false,
					expanded: club_expanded,
					child_count: club.players.length,
					search_text: club.search_text,
					search,
					balance_filter,
				});
				club.players.forEach((player_account) => {
					render_accounting_account_row(tbody, player_account, 2, {
						parent_keys: [state.tree_key, club.tree_key],
					});
				});
			});
		});
		tree.none_accounts.forEach((account) => {
			render_accounting_account_row(tbody, account, 0);
		});

			function update_filter() {
				update_accounting_tree_visibility(tbody, search.value, balance_filter.value);
			}
			update_filter();
			balance_filter.addEventListener('change', () => {
				accounting_tree_balance_filter = balance_filter.value;
				update_filter();
			});
			search.addEventListener('input', () => {
				accounting_tree_search_value = search.value;
				update_filter();
			});
		clear_btn.addEventListener('click', () => {
			accounting_tree_search_value = '';
			search.value = '';
			update_filter();
			search.focus();
		});
		if (accounting_tree_search_value) {
			search.focus();
			search.setSelectionRange(search.value.length, search.value.length);
		}
	}

	function render_registration_comment_notice(parent, key, direction, comment, label, mark_read) {
		if (!comment || !comment.comment) {
			return;
		}
		mark_read = mark_read || mark_registration_player_comment_read;
		parent.hidden = false;
		const wrap = uiu.el(parent, 'span', {
			'class': 'registration_comment_notice' + (comment.read ? ' registration_comment_read' : ' registration_comment_unread'),
		});
		uiu.el(wrap, 'span', 'registration_comment_label', label);
		uiu.el(wrap, 'span', 'registration_comment_text', comment.comment);
		if (!comment.read) {
			const read_btn = uiu.el(wrap, 'button', {
				type: 'button',
				'class': 'registration_comment_read_button',
			}, 'Gelesen');
			read_btn.addEventListener('click', () => {
				mark_read(key, direction);
				comment.read = true;
				wrap.classList.remove('registration_comment_unread');
				wrap.classList.add('registration_comment_read');
				read_btn.remove();
			});
		}
	}

	function render_registration_comment_editor(action_parent, content_parent, event, stage, entry, player, player_index, direction, label) {
		const current_comment = get_registration_player_comment(entry, player, player_index, direction);
		if (current_comment) {
			render_registration_comment_notice(content_parent, null, null, {...current_comment, read: true}, label);
		}
		const toggle_btn = uiu.el(action_parent, 'button', {
			type: 'button',
			'class': 'registration_comment_toggle' + (current_comment ? ' registration_comment_toggle_active' : ''),
			title: current_comment ? 'Kommentar bearbeiten' : 'Kommentar',
			'aria-label': current_comment ? 'Kommentar bearbeiten' : 'Kommentar',
		});
		const editor = uiu.el(content_parent, 'span', {
			'class': 'registration_comment_editor',
			hidden: 'hidden',
		});
		const textarea = uiu.el(editor, 'textarea', {
			'class': 'registration_comment_input',
			rows: '2',
			placeholder: label,
		});
		textarea.value = current_comment?.comment || '';
		const save_btn = uiu.el(editor, 'button', {
			type: 'button',
			'class': 'registration_comment_save',
		}, textarea.value ? 'Speichern' : 'Hinzufügen');
		const cancel_btn = uiu.el(editor, 'button', {
			type: 'button',
			'class': 'registration_comment_cancel',
		}, 'Abbrechen');
		toggle_btn.addEventListener('click', () => {
			content_parent.hidden = false;
			editor.hidden = false;
			toggle_btn.hidden = true;
			textarea.focus();
		});
		textarea.addEventListener('input', () => {
			uiu.text(save_btn, textarea.value.trim() ? 'Speichern' : 'Entfernen');
		});
		save_btn.addEventListener('click', () => {
			set_registration_player_comment(event, stage, entry, player, player_index, direction, textarea.value);
			uiu.text(save_btn, textarea.value.trim() ? 'Gespeichert' : 'Entfernt');
			editor.hidden = true;
			toggle_btn.hidden = false;
			toggle_btn.classList.toggle('registration_comment_toggle_active', !!textarea.value.trim());
			toggle_btn.setAttribute('title', textarea.value.trim() ? 'Kommentar bearbeiten' : 'Kommentar');
			toggle_btn.setAttribute('aria-label', textarea.value.trim() ? 'Kommentar bearbeiten' : 'Kommentar');
		});
		cancel_btn.addEventListener('click', () => {
			textarea.value = current_comment?.comment || '';
			editor.hidden = true;
			toggle_btn.hidden = false;
		});
	}

	function render_registration_stage_comment(parent, event, stage, outgoing_direction, incoming_direction, outgoing_label, incoming_label) {
		const key = registration_stage_comment_key(event, stage);
		const incoming_comment = get_registration_stage_comment(event, stage, incoming_direction);
		const current_comment = get_registration_stage_comment(event, stage, outgoing_direction);
		const wrap = uiu.el(parent, 'div', 'registration_stage_comment');
		const notices = uiu.el(wrap, 'div', {
			'class': 'registration_stage_comment_notices',
			hidden: 'hidden',
		});
		render_registration_comment_notice(notices, key, incoming_direction, incoming_comment, incoming_label, mark_registration_stage_comment_read);
		const editor = uiu.el(wrap, 'div', 'registration_stage_comment_editor');
		uiu.el(editor, 'span', 'registration_stage_comment_label', 'Allgemeiner Kommentar');
		const textarea = uiu.el(editor, 'textarea', {
			'class': 'registration_stage_comment_input',
			rows: '2',
			placeholder: outgoing_label,
		});
		textarea.value = current_comment?.comment || '';
		const save_btn = uiu.el(editor, 'button', {
			type: 'button',
			'class': 'registration_stage_comment_save',
		}, textarea.value ? 'Speichern' : 'Hinzufügen');
		textarea.addEventListener('input', () => {
			uiu.text(save_btn, textarea.value.trim() ? 'Speichern' : 'Entfernen');
		});
		save_btn.addEventListener('click', () => {
			set_registration_stage_comment(event, stage, outgoing_direction, textarea.value);
			uiu.text(save_btn, textarea.value.trim() ? 'Gespeichert' : 'Entfernt');
		});
	}

	function render_registration_empty(container) {
		uiu.el(container, 'div', 'registration_empty', 'Keine BTP-Meldelisten gefunden.');
	}

	function render_registration_check(container) {
		const header = uiu.el(container, 'div', 'registration_check_header');
		const title = uiu.el(header, 'div', 'registration_check_title');
		uiu.el(title, 'h1', {}, 'Anmeldung');
		const all_events = get_registration_events({ include_reserve: true });
		const events = get_registration_events({ include_reserve: true, only_open: true });
		if (events.length === 0) {
			if (all_events.length === 0) {
				render_registration_empty(container);
			} else {
				uiu.el(container, 'div', 'registration_empty', 'Aktuell sind keine Meldungen freigegeben.');
			}
			return;
		}

		const summary = uiu.el(title, 'div', 'registration_summary');

		const filters = uiu.el(header, 'div', 'registration_filters');
		const search_row = uiu.el(filters, 'div', 'registration_search_row');
		const search = uiu.el(search_row, 'input', {
			type: 'search',
			'class': 'registration_search',
			placeholder: 'Name, Verein, Landesverband, Disziplin',
			autocomplete: 'off',
		});
		const clear_filter_btn = uiu.el(search_row, 'button', {
			type: 'button',
			'class': 'registration_filter_clear',
			title: 'Filter löschen',
			'aria-label': 'Filter löschen',
		}, 'Löschen');
		const event_filter_counts = collect_registration_event_filter_counts(events);
		const club_filter_counts = collect_registration_filter_counts(events, 'club');
		const state_filter_counts = collect_registration_filter_counts(events, 'state');
		const quick_filters = uiu.el(filters, 'div', 'registration_quick_filters');
		const quick_filter_top = uiu.el(quick_filters, 'div', 'registration_quick_filter_top');
		function add_quick_filter_group(parent, label) {
			const group = uiu.el(parent, 'div', 'registration_quick_filter_group');
			uiu.el(group, 'span', 'registration_quick_filter_label', label);
			return group;
		}
		const event_filters = event_filter_counts.length > 1
			? add_quick_filter_group(quick_filter_top, 'Disziplin')
			: null;
		const state_filters = state_filter_counts.length > 1
			? add_quick_filter_group(quick_filter_top, 'Landesverband')
			: null;
		const club_filters = club_filter_counts.length > 1
			? add_quick_filter_group(quick_filters, 'Verein')
			: null;
		if (club_filters) {
			club_filters.classList.add('registration_quick_filter_full');
		}
		function promote_wrapped_filter_groups() {
			const top_groups = Array.from(quick_filter_top.children)
				.filter((child) => child.classList && child.classList.contains('registration_quick_filter_group'));
			if (top_groups.length === 0) {
				return;
			}
			const promote_group = (group) => {
				group.classList.add('registration_quick_filter_full');
				quick_filters.insertBefore(group, club_filters || null);
			};
			if (top_groups.length > 1) {
				const first_top = top_groups[0].offsetTop;
				const wrapped_groups = top_groups.filter((group) => Math.abs(group.offsetTop - first_top) > 1);
				if (wrapped_groups.length > 0) {
					wrapped_groups.forEach(promote_group);
					window.requestAnimationFrame(promote_wrapped_filter_groups);
					return;
				}
			}
			const overflowing_groups = top_groups.filter((group) => group.scrollWidth > group.clientWidth + 1);
			if (overflowing_groups.length === 0) {
				return;
			}
			const longest_group = overflowing_groups.sort((a, b) => b.scrollWidth - a.scrollWidth)[0];
			promote_group(longest_group);
			window.requestAnimationFrame(promote_wrapped_filter_groups);
		}

		const list = uiu.el(container, 'div', 'registration_check_list');
		const counters = {
			total: 0,
			done: 0,
			visible: 0,
		};

		function update_summary() {
			const filter_suffix = counters.visible === counters.total ? '' : ' | ' + counters.visible + ' sichtbar';
			uiu.text(summary, counters.done + ' / ' + counters.total + ' bearbeitet' + filter_suffix);
		}

		function update_filter() {
			const needle = registration_filter_text(search.value);
			let visible = 0;
			list.querySelectorAll('.registration_player_check').forEach((row) => {
				const matches = !needle || registration_filter_text(row.getAttribute('data-registration-search')).includes(needle);
				row.hidden = !matches;
				if (matches) visible++;
			});
			list.querySelectorAll('.registration_stage').forEach((stage) => {
				const has_visible_entries = !!stage.querySelector('.registration_player_check:not([hidden])');
				stage.hidden = !has_visible_entries;
			});
			list.querySelectorAll('.registration_event').forEach((event) => {
				const has_visible_stages = !!event.querySelector('.registration_stage:not([hidden])');
				event.hidden = !has_visible_stages;
			});
			counters.visible = visible;
			update_summary();
		}

		function add_quick_filter(parent, label, count) {
			const button = uiu.el(parent, 'button', {
				type: 'button',
				'class': 'registration_filter_chip',
			}, label + ' (' + count + ')');
			button.addEventListener('click', () => {
				search.value = label;
				update_filter();
				search.focus();
			});
		}

		event_filter_counts.forEach(([label, count]) => {
			if (event_filters) add_quick_filter(event_filters, label, count);
		});
		state_filter_counts.forEach(([label, count]) => {
			if (state_filters) add_quick_filter(state_filters, label, count);
		});
		club_filter_counts.forEach(([label, count]) => {
			if (club_filters) add_quick_filter(club_filters, label, count);
		});
		if (!event_filters && !state_filters && !club_filters) {
			quick_filters.hidden = true;
		}
		window.requestAnimationFrame(promote_wrapped_filter_groups);
		clear_filter_btn.addEventListener('click', () => {
			search.value = '';
			update_filter();
			search.focus();
		});

		events.forEach((event) => {
			const event_section = uiu.el(list, 'section', 'registration_event');
			sorted_registration_stages(event).forEach((stage) => {
				const entries = stage.entries || [];
				if (entries.length === 0) {
					return;
				}
				const stage_section = uiu.el(event_section, 'section', 'registration_stage registration_stage_' + registration_stage_kind(stage));
				uiu.el(stage_section, 'h3', {}, event.name + ' - ' + registration_stage_label(stage) + ' (' + entries.length + ')');
				entries.forEach((entry) => {
					const players = entry?.team?.players || [];
					const group_class = players.length > 1 ? ' registration_pair_row' : ' registration_single_row';
					players.forEach((player, player_index) => {
						counters.total++;
						const status = get_registration_player_status(entry, player, player_index);
						const comment_key = registration_player_status_key(entry, player, player_index);
						const control_comment = get_registration_player_comment(entry, player, player_index, 'control_to_check');
						if (status) counters.done++;
						const pair_position_class = players.length > 1
							? (player_index === 0
								? ' registration_pair_first'
								: player_index === players.length - 1 ? ' registration_pair_last' : ' registration_pair_middle')
							: '';
						const row = uiu.el(stage_section, 'div', {
							'class': 'registration_entry registration_player_check' + group_class + pair_position_class + (status ? ' registration_player_' + status : ''),
							'data-registration-row-id': entry.stage_entry_id + '_' + player_index,
							'data-registration-status-key': comment_key,
							'data-player-index': player_index,
							'data-registration-search': registration_player_search_text(event, stage, entry, player),
						});
						row._registration_entry = entry;
						row._registration_player = player;
						row._registration_event = event;
						row._registration_stage = stage;

						const text = uiu.el(row, 'span', 'registration_entry_text');
						uiu.el(text, 'span', 'registration_entry_name', person_display_name(player));
						const detail = registration_player_detail(player);
						if (detail) {
							uiu.el(text, 'span', 'registration_entry_detail', detail);
						}
						const partner = registration_partner_label(entry, player_index);
						if (partner) {
							uiu.el(text, 'span', 'registration_entry_partner', partner);
						}
						const other_present = uiu.el(text, 'span', {
							'class': 'registration_entry_other_present',
							hidden: 'hidden',
						});
						uiu.text(other_present, '');
						update_registration_other_present_badge(row);
						const comments = uiu.el(row, 'span', {
							'class': 'registration_comment_column',
							hidden: 'hidden',
						});
						render_registration_comment_notice(comments, comment_key, 'control_to_check', control_comment, 'Turnierleitung');

						const actions = uiu.el(row, 'span', 'registration_status_actions');
						render_registration_comment_editor(actions, comments, event, stage, entry, player, player_index, 'check_to_control', 'An Turnierleitung');
						const present_btn = uiu.el(actions, 'button', {
							type: 'button',
							'class': 'registration_status_button registration_status_present',
							'aria-pressed': status === 'present' ? 'true' : 'false',
							title: 'Anwesend',
							'aria-label': 'Anwesend',
						});
						const absent_btn = uiu.el(actions, 'button', {
							type: 'button',
							'class': 'registration_status_button registration_status_absent',
							'aria-pressed': status === 'absent' ? 'true' : 'false',
							title: 'Abwesend',
							'aria-label': 'Abwesend',
						});

						function apply_status(next_status) {
							const old_status = get_registration_player_status(entry, player, player_index);
							const final_status = old_status === next_status ? '' : next_status;
							set_registration_player_status(event, stage, entry, player, player_index, final_status);
							row.classList.remove('registration_player_present', 'registration_player_absent');
							if (final_status) {
								row.classList.add('registration_player_' + final_status);
							}
							present_btn.setAttribute('aria-pressed', final_status === 'present' ? 'true' : 'false');
							absent_btn.setAttribute('aria-pressed', final_status === 'absent' ? 'true' : 'false');
							if (!old_status && final_status) {
								counters.done++;
							} else if (old_status && !final_status) {
								counters.done--;
							}
							update_registration_other_present_badges(list);
							update_summary();
						}

						present_btn.addEventListener('click', () => apply_status('present'));
						absent_btn.addEventListener('click', () => apply_status('absent'));
					});
				});
			});
			render_registration_stage_comment(event_section, event, null, 'check_to_control', 'control_to_check', 'An Turnierleitung', 'Turnierleitung');
		});

		search.addEventListener('input', update_filter);
		counters.visible = counters.total;
		update_summary();
	}

	function registration_control_player_rows(event) {
		const rows = [];
		let entry_number = 0;
		sorted_registration_stages(event).forEach((stage) => {
			(stage.entries || []).forEach((entry) => {
				entry_number += 1;
				(entry?.team?.players || []).forEach((player, player_index) => {
					rows.push({
						player,
						entry,
						stage,
						entry_number,
						player_index,
						status: get_registration_player_status(entry, player, player_index) || 'open',
					});
				});
			});
		});
		return rows;
	}

	function registration_control_entry_rows(event) {
		const rows = [];
		let entry_number = 0;
		sorted_registration_stages(event).forEach((stage) => {
			(stage.entries || []).forEach((entry) => {
				entry_number += 1;
				rows.push({
					event,
					stage,
					entry,
					entry_number: entry?.entry_order || entry_number,
					players: entry?.team?.players || [],
				});
			});
		});
		return rows;
	}

	function registration_control_status_label(status) {
		if (status === 'present') return 'Da';
		if (status === 'absent') return 'Fehlt';
		return 'Offen';
	}

	function registration_control_entry_seed(row) {
		const seed1 = row.entry?.seed1;
		const seed2 = row.entry?.seed2;
		return [seed1, seed2]
			.filter((seed) => seed !== undefined && seed !== null && seed !== '')
			.join('/');
	}

	function registration_control_player_stack_value(players, field) {
		return players
			.map((player) => player && player[field])
			.filter((value) => value !== undefined && value !== null && String(value) !== '')
			.join(' ');
	}

	function registration_xlsx_metadata_for_player(entry, player, player_index) {
		const key = registration_player_status_key(entry, player, player_index);
		return curt?.registration_xlsx_metadata?.by_registration_key?.[key] || null;
	}

	function registration_control_player_xlsx_stack_value(row, field) {
		return row.players
			.map((player, player_index) => registration_xlsx_metadata_for_player(row.entry, player, player_index)?.[field])
			.filter((value) => value !== undefined && value !== null && String(value) !== '')
			.join(' ');
	}

	function registration_control_numeric_xlsx_value(value) {
		if (value === undefined || value === null || value === '') {
			return null;
		}
		const normalized = String(value)
			.replace(/\./g, '')
			.replace(',', '.')
			.replace(/[^\d.-]/g, '');
		const number = Number(normalized);
		return Number.isFinite(number) ? number : null;
	}

	function registration_control_entry_points(row) {
		const values = row.players
			.map((player, player_index) =>
				registration_control_numeric_xlsx_value(
					registration_xlsx_metadata_for_player(row.entry, player, player_index)?.points
				)
			)
			.filter((value) => value !== null);
		if (values.length === 0) {
			return null;
		}
		return values.reduce((sum, value) => sum + value, 0);
	}

	function registration_control_has_xlsx_value(rows, field) {
		return rows.some((row) =>
			row.players.some((player, player_index) => {
				const value = registration_xlsx_metadata_for_player(row.entry, player, player_index)?.[field];
				return value !== undefined && value !== null && String(value) !== '';
			})
		);
	}

	function registration_control_entry_status_rank(row) {
		const statuses = row.players.map((player, player_index) =>
			get_registration_player_status(row.entry, player, player_index) || 'open');
		if (statuses.includes('absent')) return 1;
		if (statuses.includes('open')) return 2;
		return 3;
	}

	function registration_control_sort_value(row, key) {
		switch (key) {
			case 'nr':
				return Number(row.entry_number || 0);
			case 'entry_id':
				return Number(row.entry?.entry_id || 0);
			case 'player_count':
				return row.players.length;
			case 'name':
				return row.players.map(person_display_name).join(' ');
			case 'seed':
				return Number(row.entry?.seed1 || row.entry?.seed2 || 0);
			case 'status':
				return registration_control_entry_status_rank(row);
			case 'list':
				return registration_stage_label(row.stage);
			case 'gender':
				return registration_control_player_stack_value(row.players, 'gender') ||
					registration_control_player_xlsx_stack_value(row, 'gender');
			case 'strength':
				return registration_control_player_xlsx_stack_value(row, 'strength');
			case 'performance_points':
				return registration_control_player_xlsx_stack_value(row, 'performance_points');
			case 'ranking_place':
				return registration_control_player_xlsx_stack_value(row, 'ranking_place');
			case 'points':
				return registration_control_player_xlsx_stack_value(row, 'points');
			case 'birth':
				return registration_control_player_stack_value(row.players, 'date_of_birth');
			case 'club':
				return registration_control_player_stack_value(row.players, 'club');
			case 'association':
				return registration_control_player_stack_value(row.players, 'association');
			case 'state':
				return registration_control_player_stack_value(row.players, 'state');
			case 'country':
				return registration_control_player_stack_value(row.players, 'nationality');
			case 'date':
				return registration_control_player_xlsx_stack_value(row, 'entered_at');
			default:
				return '';
		}
	}

	function registration_control_compare_values(a, b) {
		const a_number = Number(a);
		const b_number = Number(b);
		if (Number.isFinite(a_number) && Number.isFinite(b_number)) {
			return a_number - b_number;
		}
		return String(a || '').localeCompare(String(b || ''), 'de', {
			numeric: true,
			sensitivity: 'base',
		});
	}

	function registration_control_seed_sort_parts(row) {
		const seed1 = Number(row.entry?.seed1);
		const seed2 = Number(row.entry?.seed2);
		const has_seed1 = Number.isFinite(seed1) && seed1 > 0;
		const has_seed2 = Number.isFinite(seed2) && seed2 > 0;
		if (!has_seed1 && !has_seed2) {
			return null;
		}
		return {
			from: has_seed1 ? seed1 : seed2,
			to: has_seed2 ? seed2 : seed1,
		};
	}

	function compare_registration_control_seeds(a, b) {
		const a_seed = registration_control_seed_sort_parts(a);
		const b_seed = registration_control_seed_sort_parts(b);
		if (!a_seed && !b_seed) {
			return 0;
		}
		if (!a_seed) {
			return 1;
		}
		if (!b_seed) {
			return -1;
		}
		if (a_seed.from !== b_seed.from) {
			return a_seed.from - b_seed.from;
		}
		return a_seed.to - b_seed.to;
	}

	function sort_registration_control_rows(rows, sort_key, sort_direction) {
		const direction = sort_direction === 'desc' ? -1 : 1;
		return [...rows].sort((a, b) => {
			if (sort_key === 'seed') {
				const seed_compare = compare_registration_control_seeds(a, b);
				if (seed_compare !== 0) {
					return seed_compare;
				}
				return registration_control_compare_values(a.entry_number, b.entry_number);
			}
			const primary = registration_control_compare_values(
				registration_control_sort_value(a, sort_key),
				registration_control_sort_value(b, sort_key)
			);
			if (primary !== 0) {
				return primary * direction;
			}
			return registration_control_compare_values(a.entry_number, b.entry_number);
		});
	}

	const registration_control_column_width_storage_key = 'bts_registration_control_column_widths_v1';
	let registration_control_column_widths = null;
	let registration_drawn_open_event_key = '';

	function get_registration_control_column_widths() {
		if (registration_control_column_widths !== null) {
			return registration_control_column_widths;
		}
		try {
			registration_control_column_widths = JSON.parse(localStorage.getItem(registration_control_column_width_storage_key) || '{}') || {};
		} catch (e) {
			registration_control_column_widths = {};
		}
		return registration_control_column_widths;
	}

	function save_registration_control_column_widths() {
		try {
			localStorage.setItem(registration_control_column_width_storage_key, JSON.stringify(get_registration_control_column_widths()));
		} catch (e) {
			// Ignore private-mode storage failures; the current drag still applies until the next render.
		}
	}

	function registration_control_column_css_var(column_key) {
		return '--registration-control-col-' + column_key.replace(/_/g, '-');
	}

	function apply_registration_control_column_widths(container) {
		const widths = get_registration_control_column_widths();
		Object.keys(widths).forEach((key) => {
			const width = Number(widths[key]);
			if (Number.isFinite(width) && width > 0) {
				container.style.setProperty(registration_control_column_css_var(key), width + 'px');
			}
		});
	}

	function resize_registration_control_column(e, container, column, th) {
		if (e.button !== undefined && e.button !== 0) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const start_x = e.clientX;
		const start_width = th.getBoundingClientRect().width;
		const min_width = column.min_width || 28;
		const max_width = column.max_width || 420;
		document.body.classList.add('registration_control_resizing');
		function on_move(move_event) {
			const width = Math.max(min_width, Math.min(max_width, Math.round(start_width + move_event.clientX - start_x)));
			get_registration_control_column_widths()[column.key] = width;
			container.style.setProperty(registration_control_column_css_var(column.key), width + 'px');
		}
		function on_up() {
			document.removeEventListener('pointermove', on_move);
			document.removeEventListener('pointerup', on_up);
			document.body.classList.remove('registration_control_resizing');
			save_registration_control_column_widths();
		}
		document.addEventListener('pointermove', on_move);
		document.addEventListener('pointerup', on_up);
	}

	function add_registration_control_resize_handle(th, table_wrap, column) {
		const control_container = table_wrap.closest('.registration_control_container') || table_wrap;
		const handle = uiu.el(th, 'span', {
			'class': 'registration_control_resize_handle',
			title: 'Spaltenbreite anpassen',
		});
		handle.addEventListener('pointerdown', (e) => resize_registration_control_column(e, control_container, column, th));
	}

	function registration_control_table_columns(rows) {
		return [
			{ key: 'nr', label: 'Nr.', class_name: 'registration_control_col_nr', min_width: 26 },
			{ key: 'name', label: 'Name', class_name: 'registration_control_col_name', min_width: 90 },
			{ key: 'seed', label: 'Setz.', class_name: 'registration_control_col_seed', min_width: 34 },
			{ key: 'gender', label: 'G.', class_name: 'registration_control_col_gender', min_width: 26 },
			...(registration_control_has_xlsx_value(rows, 'strength')
				? [{ key: 'strength', label: 'Stärke', class_name: 'registration_control_col_strength', min_width: 42 }]
				: []),
			...(registration_control_has_xlsx_value(rows, 'performance_points')
				? [{ key: 'performance_points', label: 'Leist.', class_name: 'registration_control_col_performance_points', min_width: 42 }]
				: []),
			...(registration_control_has_xlsx_value(rows, 'ranking_place')
				? [{ key: 'ranking_place', label: 'Rang', class_name: 'registration_control_col_rank', min_width: 42 }]
				: []),
			...(registration_control_has_xlsx_value(rows, 'points')
				? [{ key: 'points', label: 'Punkte', class_name: 'registration_control_col_points', min_width: 48 }]
				: []),
			{ key: 'birth', label: 'Geb.', class_name: 'registration_control_col_birth', min_width: 60 },
			{ key: 'club', label: 'Verein', class_name: 'registration_control_col_club', min_width: 80 },
			{ key: 'association', label: 'Verband', class_name: 'registration_control_col_association', min_width: 80 },
			{ key: 'state', label: 'LV', class_name: 'registration_control_col_state', min_width: 58 },
			{ key: 'country', label: 'Land', class_name: 'registration_control_col_country', min_width: 32 },
			...(registration_control_has_xlsx_value(rows, 'entered_at')
				? [{ key: 'date', label: 'Datum', class_name: 'registration_control_col_date', min_width: 72 }]
				: []),
		];
	}

	function normalize_registration_announcement_text(value) {
		let text = String(value || '').trim();
		if (!text) {
			return '';
		}
		if (typeof normalizeNames === 'function') {
			return normalizeNames(text);
		}
		if (curt.normalizations && curt.normalizations.length > 0) {
			for (const norm of curt.normalizations) {
				if (ci18n('announcements:lang') === norm.language) {
					text = text.replaceAll(norm.origin, norm.replace);
				}
			}
		}
		return text;
	}

	function registration_control_event_announcement_name(event) {
		const raw = String(event?.name || '').trim();
		if (!raw) {
			return '';
		}
		const labels = {
			JE: 'Jungen Einzel',
			JD: 'Jungen Doppel',
			ME: 'Maedchen Einzel',
			MD: 'Maedchen Doppel',
			GD: 'Gemischtes Doppel',
			MX: 'Gemischtes Doppel',
			HE: 'Herren Einzel',
			HD: 'Herren Doppel',
			DE: 'Damen Einzel',
			DD: 'Damen Doppel',
			E: 'Einzel',
			D: 'Doppel',
		};
		const parts = raw.replaceAll('-', ' ').split(/\s+/).filter(Boolean);
		const code_index = parts.findIndex((part) => labels[part.toUpperCase()]);
		if (code_index === -1) {
			return normalize_registration_announcement_text(raw);
		}
		const code = parts[code_index].toUpperCase();
		const rest = parts.filter((_, index) => index !== code_index).join(' ');
		return normalize_registration_announcement_text([labels[code], rest].filter(Boolean).join(' '));
	}

	function registration_control_announcement_text(kind, event, label, destination) {
		const text = String(label || '').trim();
		if (!text) {
			return '';
		}
		const target = destination === 'control' ? 'Turnierleitung' : 'Anmeldung';
		const spoken_text = normalize_registration_announcement_text(text);
		if (kind === 'pair') {
			return 'Die Paarung ' + spoken_text + ' bitte zur ' + target + '. ' + spoken_text + ' bitte!';
		}
		if (kind === 'club') {
			return 'Bitte ein Vertreter vom Verein ' + spoken_text + ' zur ' + target + '. Ein Vertreter vom Verein ' + spoken_text + ' bitte!';
		}
		if (kind === 'state') {
			return 'Bitte ein Vertreter aus ' + spoken_text + ' zur ' + target + '. Ein Vertreter aus ' + spoken_text + ' bitte!';
		}
		return spoken_text + ' bitte zur ' + target + '. ' + spoken_text + ' bitte!';
	}

	function trigger_registration_announcement(text, source_el) {
		const announcement_text = String(text || '').trim();
		if (!announcement_text) {
			return;
		}
		const claim_key = 'registration_control:' + Date.now() + ':' + Math.random().toString(36).slice(2);
		if (source_el) {
			source_el.classList.add('registration_control_call_sent');
			window.setTimeout(() => {
				source_el.classList.remove('registration_control_call_sent');
			}, 900);
		}
		send({
			type: 'free_announce',
			tournament_key: curt.key,
			text: announcement_text,
			announcement_claim_key: claim_key,
		}, function(err) {
			if (err) {
				return cerror.net(err);
			}
		});
	}

	function close_registration_call_dialog() {
		const dialog = document.querySelector('.registration_call_dialog');
		if (!dialog) {
			return;
		}
		uiu.remove(dialog);
		cbts_utils.esc_stack_pop();
	}

	function show_registration_call_dialog(call_context, source_el) {
		const context = call_context || {};
		const label = String(context.display_label || context.label || '').trim();
		const announcement_label = String(context.announcement_label || context.label || label).trim();
		if (!announcement_label) {
			return;
		}
		close_registration_call_dialog();
		cbts_utils.esc_stack_push(close_registration_call_dialog);
		const dialog_bg = uiu.el(uiu.qs('body'), 'div', 'dialog_bg registration_call_dialog');
		dialog_bg.addEventListener('click', (e) => {
			if (e.target === dialog_bg) {
				close_registration_call_dialog();
			}
		});
		const dialog = uiu.el(dialog_bg, 'div', 'dialog registration_call_dialog_box');
		uiu.el(dialog, 'h3', {}, 'Durchsage');
		uiu.el(dialog, 'p', 'registration_call_dialog_target', label || announcement_label);
		const actions = uiu.el(dialog, 'div', 'registration_call_dialog_actions');
		function add_choice(text, destination) {
			const button = uiu.el(actions, 'button', {
				type: 'button',
				'class': 'registration_call_dialog_button',
			}, text);
			button.addEventListener('click', () => {
				const announcement_text = registration_control_announcement_text(
					context.kind,
					context.event,
					announcement_label,
					destination
				);
				close_registration_call_dialog();
				trigger_registration_announcement(announcement_text, source_el);
			});
		}
		add_choice('Zur Anmeldung', 'check');
		add_choice('Zur Turnierleitung', 'control');
		const cancel = uiu.el(actions, 'button', {
			type: 'button',
			'class': 'registration_call_dialog_button registration_call_dialog_cancel',
		}, 'Abbrechen');
		cancel.addEventListener('click', close_registration_call_dialog);
	}

	function render_registration_control_call_button(parent, label, call_context, class_name) {
		const text = String(label || '').trim();
		if (!text) {
			return null;
		}
		const button = uiu.el(parent, 'button', {
			type: 'button',
			'class': 'registration_control_call_button ' + (class_name || ''),
			title: 'Durchsage auswählen',
		}, text);
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			show_registration_call_dialog({
				...(call_context || {}),
				display_label: text,
			}, button);
		});
		return button;
	}

	function render_registration_control_stack_cell(row_el, class_name, values, options) {
		options = options || {};
		const cell = uiu.el(row_el, 'td', class_name);
		values.forEach((value) => {
			const text = value === undefined || value === null ? '' : String(value);
			const line = uiu.el(cell, 'div', { title: text });
			if (options.announcement_type && text) {
				render_registration_control_call_button(
					line,
					text,
					{
						kind: options.announcement_type,
						event: options.event,
						label: text,
					},
					'registration_control_call_' + options.announcement_type
				);
			} else {
				uiu.text(line, text);
			}
		});
		return cell;
	}

	function format_registration_birth_date(value) {
		const text = value === undefined || value === null ? '' : String(value).trim();
		const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!match) {
			return text;
		}
		return match[3] + '.' + match[2] + '.' + match[1];
	}

	function render_registration_control_table(container, event, rows, options) {
		options = options || {};
		const table_wrap = uiu.el(container, 'div', 'registration_control_table_wrap');
		const table = uiu.el(table_wrap, 'table', 'registration_control_table');
		const thead = uiu.el(table, 'thead');
		const header_row = uiu.el(thead, 'tr');
		const columns = options.columns || registration_control_table_columns(rows);
		const has_column = (key) => columns.some((column) => column.key === key);
		let sort_key = 'nr';
		let sort_direction = 'asc';
		columns.forEach((column) => {
			const th = uiu.el(header_row, 'th', column.class_name);
			const button = uiu.el(th, 'button', {
				type: 'button',
				'class': 'registration_control_sort_button',
				'data-sort-key': column.key,
				'data-label': column.label,
				title: 'Sortieren nach ' + column.label,
			}, column.label);
			button.addEventListener('click', () => {
				if (column.key === 'seed') {
					sort_key = column.key;
					sort_direction = 'asc';
				} else if (sort_key === column.key) {
					sort_direction = sort_direction === 'asc' ? 'desc' : 'asc';
				} else {
					sort_key = column.key;
					sort_direction = 'asc';
				}
				render_body();
			});
			add_registration_control_resize_handle(th, table_wrap, column);
		});
		if (options.editable) {
			const comment_column = {
				key: 'comment',
				label: 'Kommentar',
				class_name: 'registration_control_col_comment',
				min_width: 90,
			};
			const comment_th = uiu.el(header_row, 'th', comment_column.class_name, comment_column.label);
			add_registration_control_resize_handle(comment_th, table_wrap, comment_column);
			uiu.el(header_row, 'th', 'registration_control_col_action', '');
		}
		const tbody = uiu.el(table, 'tbody');
		const column_count = columns.length + (options.editable ? 2 : 0);
		function render_stage_heading(stage, stage_rows) {
			const heading_row = uiu.el(tbody, 'tr',
				'registration_control_stage_heading registration_stage_' + registration_stage_kind(stage));
			uiu.el(heading_row, 'th', { colspan: column_count },
				registration_stage_label(stage) + ' (' + stage_rows.length + ')');
		}
		function render_entry_row(row, display_number) {
			const players = row.players.length > 0 ? row.players : [null];
			const statuses = players.map((player, player_index) =>
				player ? (get_registration_player_status(row.entry, player, player_index) || 'open') : 'open');
			const row_status = statuses.includes('absent')
				? 'absent'
				: statuses.includes('open') ? 'open' : 'present';
			const tr = uiu.el(tbody, 'tr',
				'registration_control_table_row registration_drawn_' + row_status + ' registration_stage_' + registration_stage_kind(row.stage));
			uiu.el(tr, 'td', 'registration_control_col_nr', display_number || '');
			const name_cell = uiu.el(tr, 'td', 'registration_control_col_name');
			players.forEach((player, player_index) => {
				const player_line = uiu.el(name_cell, 'div', 'registration_control_table_player');
				const name = player ? person_display_name(player) : registration_entry_name(row.entry);
				render_registration_control_call_button(
					player_line,
					name,
					{
						kind: 'player',
						event,
						label: name,
					},
					'registration_control_call_player'
				);
				if (player) {
					const other_present_events = registration_other_present_events(event, row.entry, player, player_index);
					if (other_present_events.length > 0) {
						uiu.el(player_line, 'span', 'registration_entry_other_present',
							'Bereits angemeldet: ' + other_present_events.join(', '));
					}
				}
			});
			if (players.length > 1) {
				const pair_label = players.map(person_display_name).filter(Boolean).join(' / ');
				const pair_announcement = players.map(person_display_name).filter(Boolean).join(' und ');
				const pair_line = uiu.el(name_cell, 'div', 'registration_control_table_pair');
				uiu.el(pair_line, 'span', 'registration_control_table_pair_label', 'Paarung');
				render_registration_control_call_button(
					pair_line,
					pair_label,
					{
						kind: 'pair',
						event,
						label: pair_announcement,
						announcement_label: pair_announcement,
					},
					'registration_control_call_pair'
				);
			}
			uiu.el(tr, 'td', 'registration_control_col_seed', registration_control_entry_seed(row));
			render_registration_control_stack_cell(tr, 'registration_control_col_gender', players.map((player, player_index) =>
				player?.gender || registration_xlsx_metadata_for_player(row.entry, player, player_index)?.gender || ''));
			if (has_column('strength')) {
				render_registration_control_stack_cell(tr, 'registration_control_col_strength', players.map((player, player_index) =>
					registration_xlsx_metadata_for_player(row.entry, player, player_index)?.strength || ''));
			}
			if (has_column('performance_points')) {
				render_registration_control_stack_cell(tr, 'registration_control_col_performance_points', players.map((player, player_index) =>
					registration_xlsx_metadata_for_player(row.entry, player, player_index)?.performance_points || ''));
			}
			if (has_column('ranking_place')) {
				render_registration_control_stack_cell(tr, 'registration_control_col_rank', players.map((player, player_index) =>
					registration_xlsx_metadata_for_player(row.entry, player, player_index)?.ranking_place || ''));
			}
			if (has_column('points')) {
				render_registration_control_stack_cell(tr, 'registration_control_col_points', players.map((player, player_index) =>
					registration_xlsx_metadata_for_player(row.entry, player, player_index)?.points || ''));
			}
			render_registration_control_stack_cell(tr, 'registration_control_col_birth',
				players.map((player) => format_registration_birth_date(player?.date_of_birth || '')));
			render_registration_control_stack_cell(tr, 'registration_control_col_club', players.map((player) => player?.club || ''), {
				event,
				announcement_type: 'club',
			});
			render_registration_control_stack_cell(tr, 'registration_control_col_association', players.map((player) => player?.association || ''));
			render_registration_control_stack_cell(tr, 'registration_control_col_state', players.map((player) => player?.state || ''), {
				event,
				announcement_type: 'state',
			});
			render_registration_control_stack_cell(tr, 'registration_control_col_country', players.map((player) => player?.nationality || ''));
			if (has_column('date')) {
				render_registration_control_stack_cell(tr, 'registration_control_col_date', players.map((player, player_index) =>
					registration_xlsx_metadata_for_player(row.entry, player, player_index)?.entered_at || ''));
			}
			if (options.editable) {
				const comment_cell = uiu.el(tr, 'td', 'registration_control_col_comment');
				const action_cell = uiu.el(tr, 'td', 'registration_control_col_action');
				players.forEach((player, player_index) => {
					if (!player) return;
					const comment_key = registration_player_status_key(row.entry, player, player_index);
					const check_comment = get_registration_player_comment(row.entry, player, player_index, 'check_to_control');
					const comment_line = uiu.el(comment_cell, 'div', {
						'class': 'registration_comment_column registration_control_table_comment_line',
						hidden: 'hidden',
					});
					render_registration_comment_notice(comment_line, comment_key, 'check_to_control', check_comment, 'Anmeldung');
					const action_line = uiu.el(action_cell, 'div', 'registration_control_table_action_line');
					render_registration_comment_editor(action_line, comment_line, event, row.stage, row.entry, player, player_index, 'control_to_check', 'An Anmeldung');
				});
			}
		}
		function render_body() {
			table.querySelectorAll('.registration_control_sort_button').forEach((button) => {
				const label = button.getAttribute('data-label') || '';
				const key = button.getAttribute('data-sort-key');
				uiu.text(button, label + (key === sort_key ? ' ' + String.fromCharCode(sort_direction === 'asc' ? 8593 : 8595) : ''));
			});
			uiu.empty(tbody);
			const sorted_rows = sort_registration_control_rows(rows, sort_key, sort_direction);
			sorted_registration_stages(event).forEach((stage) => {
				const stage_rows = sorted_rows.filter((row) => row.stage === stage);
				if (stage_rows.length === 0) {
					return;
				}
				render_stage_heading(stage, stage_rows);
				stage_rows.forEach((row, index) => render_entry_row(row, index + 1));
			});
		}
		render_body();
	}

	function registration_control_event_status_counts(event) {
		const rows = registration_control_player_rows(event);
		return {
			present: rows.filter((row) => row.status === 'present').length,
			absent: rows.filter((row) => row.status === 'absent').length,
			open: rows.filter((row) => row.status === 'open').length,
		};
	}

	function registration_control_main_player_rows(event) {
		const rows = [];
		sorted_registration_stages(event)
			.filter(is_registration_stage_main)
			.forEach((stage) => {
				(stage.entries || []).forEach((entry) => {
					(entry?.team?.players || []).forEach((player, player_index) => {
						rows.push({
							stage,
							entry,
							player,
							player_index,
							status: get_registration_player_status(entry, player, player_index) || 'open',
						});
					});
				});
			});
		return rows;
	}

	function registration_control_main_entry_rows(event) {
		const rows = [];
		let entry_number = 0;
		sorted_registration_stages(event)
			.filter(is_registration_stage_main)
			.forEach((stage) => {
				(stage.entries || []).forEach((entry) => {
					entry_number += 1;
					rows.push({
						event,
						stage,
						entry,
						entry_number: entry?.entry_order || entry_number,
						players: entry?.team?.players || [],
					});
				});
			});
		return rows;
	}

	function is_registration_event_completed(event) {
		const main_rows = registration_control_main_player_rows(event);
		return main_rows.length > 0 &&
			main_rows.every((row) => row.status === 'present' || row.status === 'absent');
	}

	function registration_control_unread_check_comment_count(event) {
		let count = 0;
		registration_control_main_player_rows(event).forEach((row) => {
			const comment = get_registration_player_comment(row.entry, row.player, row.player_index, 'check_to_control');
			if (comment && !comment.read) {
				count++;
			}
		});
		const stage_comment = get_registration_stage_comment(event, null, 'check_to_control');
		if (stage_comment && !stage_comment.read) {
			count++;
		}
		return count;
	}

	function registration_control_entry_statuses(row) {
		return row.players.map((player, player_index) =>
			get_registration_player_status(row.entry, player, player_index) || 'open');
	}

	function registration_control_entry_has_absent_player(row) {
		return registration_control_entry_statuses(row).includes('absent');
	}

	function registration_control_entry_has_open_player(row) {
		return registration_control_entry_statuses(row).includes('open');
	}

	function registration_control_seed_issue_todos(event) {
		const rows = registration_control_main_entry_rows(event);
		const seeded_rows = rows.filter((row) => !!registration_control_seed_sort_parts(row));
		if (seeded_rows.length === 0) {
			return [];
		}

		const todos = [];
		const absent_seeded_rows = seeded_rows.filter(registration_control_entry_has_absent_player);
		if (absent_seeded_rows.length > 0) {
			todos.push('Setzplätze in BTP neu setzen: gesetzte Meldung(en) fallen weg: ' +
				absent_seeded_rows.map((row) => registration_entry_name(row.entry) + ' (' + registration_control_entry_seed(row) + ')').join(', ') + '.');
		}

		const point_rows = rows
			.filter((row) => !registration_control_entry_has_absent_player(row) && !registration_control_entry_has_open_player(row))
			.map((row) => ({
				row,
				points: registration_control_entry_points(row),
				seed: registration_control_seed_sort_parts(row),
			}));
		const seed_points = (item) => item.points === null ? Number.NEGATIVE_INFINITY : item.points;
		const points_label = (row) => {
			const points = registration_control_entry_points(row);
			return points === null ? 'keine Punkte' : String(points);
		};

		const seeded_count = seeded_rows.length;
		const expected_seeded_rows = point_rows
			.slice()
			.sort((a, b) => seed_points(b) - seed_points(a) || registration_control_compare_values(a.row.entry_number, b.row.entry_number))
			.slice(0, seeded_count)
			.map((item) => item.row);
		const expected_keys = new Set(expected_seeded_rows.map((row) => registration_entry_signature(row.entry)));
		const present_seeded_rows = point_rows
			.filter((item) => item.seed)
			.map((item) => item.row);
		const actual_keys = new Set(present_seeded_rows.map((row) => registration_entry_signature(row.entry)));
		const missing_seeded_rows = expected_seeded_rows.filter((row) => !actual_keys.has(registration_entry_signature(row.entry)));
		const surplus_seeded_rows = present_seeded_rows.filter((row) => !expected_keys.has(registration_entry_signature(row.entry)));
		if (missing_seeded_rows.length > 0 || surplus_seeded_rows.length > 0) {
			todos.push('Setzplätze in BTP neu setzen: nach Punkten erwartet ' +
				expected_seeded_rows.map((row) => registration_entry_name(row.entry) + ' (' + points_label(row) + ')').join(', ') + '.');
			return todos;
		}

		const sorted_present_seeded_rows = present_seeded_rows
			.slice()
			.sort((a, b) => compare_registration_control_seeds(a, b));
		const seeded_points = sorted_present_seeded_rows.map((row) => {
			const points = registration_control_entry_points(row);
			return points === null ? Number.NEGATIVE_INFINITY : points;
		});
		const seed_order_invalid = seeded_points.some((points, index) =>
			index > 0 && points > seeded_points[index - 1]);
		if (seed_order_invalid) {
			todos.push('Setzplätze in BTP neu setzen: höhere Punktzahl steht hinter niedrigerer Punktzahl.');
		}
		return todos;
	}

	function registration_control_draw_todos(event) {
		const main_rows = registration_control_main_player_rows(event);
		const open_rows = main_rows.filter((row) => row.status === 'open');
		const absent_rows = main_rows.filter((row) => row.status === 'absent');
		const unread_comments = registration_control_unread_check_comment_count(event);
		const todos = [];
		if (open_rows.length > 0) {
			todos.push(open_rows.length + ' Hauptfeldspieler noch als anwesend oder abwesend melden.');
		}
		absent_rows.slice(0, 8).forEach((row) => {
			todos.push('In BTP nach Ausschließen verschieben: ' + person_display_name(row.player));
		});
		if (absent_rows.length > 8) {
			todos.push((absent_rows.length - 8) + ' weitere abwesende Hauptfeldspieler in BTP nach Ausschließen verschieben.');
		}
		todos.push(...registration_control_seed_issue_todos(event));
		if (unread_comments > 0) {
			todos.push(unread_comments + ' Kommentar(e) aus der Anmeldung lesen/prüfen.');
		}
		return todos;
	}

	function render_registration_control_status_counts(container, counts) {
		uiu.el(container, 'span', 'registration_drawn_counts',
			'Da: ' + counts.present + ' | Fehlt: ' + counts.absent + ' | Offen: ' + counts.open);
	}

	function render_registration_event_open_control(parent, event) {
		const is_open = is_registration_event_open(event);
		const label = uiu.el(parent, 'label',
			'registration_event_open_toggle' + (is_open ? ' registration_event_open_toggle_active' : ''));
		const checkbox = uiu.el(label, 'input', {
			type: 'checkbox',
		});
		checkbox.checked = is_open;
		uiu.el(label, 'span', 'registration_event_open_toggle_indicator');
		const text = uiu.el(label, 'span', 'registration_event_open_toggle_text',
			is_open ? 'Meldung freigegeben' : 'Meldung gesperrt');
		checkbox.addEventListener('change', () => {
			set_registration_event_open(event, checkbox.checked);
			label.classList.toggle('registration_event_open_toggle_active', checkbox.checked);
			uiu.text(text, checkbox.checked ? 'Meldung freigegeben' : 'Meldung gesperrt');
			ui_registration_control();
		});
	}

	function close_registration_event_with_absent_players(event) {
		if (!is_registration_event_open(event)) {
			return;
		}
		const open_rows = registration_control_main_player_rows(event)
			.filter((row) => row.status === 'open');
		if (open_rows.length === 0) {
			return;
		}
		if (!confirm('Alle noch offenen Hauptfeldspieler in ' + event.name + ' als abwesend markieren?')) {
			return;
		}
		open_rows.forEach((row) => {
			set_registration_player_status(event, row.stage, row.entry, row.player, row.player_index, 'absent');
		});
		ui_registration_control();
	}

	function render_registration_event_close_control(parent, event) {
		if (!is_registration_event_open(event)) {
			return;
		}
		const open_count = registration_control_main_player_rows(event)
			.filter((row) => row.status === 'open')
			.length;
		if (open_count === 0) {
			return;
		}
		const button = uiu.el(parent, 'button', {
			type: 'button',
			'class': 'registration_event_close_button',
			title: 'Alle offenen Hauptfeldspieler als abwesend markieren',
		}, 'Meldung abschließen');
		button.addEventListener('click', () => close_registration_event_with_absent_players(event));
	}

	function render_registration_control_event_header(parent, heading_tag, event, title) {
		const head = uiu.el(parent, 'div', 'registration_control_event_header');
		uiu.el(head, heading_tag, {}, title || event.name);
		const controls = uiu.el(head, 'div', 'registration_control_event_header_controls');
		render_registration_control_status_counts(controls, registration_control_event_status_counts(event));
		render_registration_event_open_control(controls, event);
		render_registration_event_close_control(controls, event);
		return head;
	}

	function render_registration_draw_todos(parent, event) {
		const todos = registration_control_draw_todos(event);
		const box = uiu.el(parent, 'div',
			'registration_draw_todos ' + (todos.length === 0 ? 'registration_draw_todos_ready' : 'registration_draw_todos_warn'));
		uiu.el(box, 'strong', {}, todos.length === 0 ? 'Bereit zur Auslosung' : 'ToDos vor der Auslosung');
		if (todos.length === 0) {
			uiu.el(box, 'span', {}, 'Hauptfeld vollständig gemeldet, keine abwesenden Hauptfeldspieler mehr in der Liste, Setzplätze nach Punkten plausibel, keine ungelesenen Kommentare.');
			return;
		}
		const list = uiu.el(box, 'ul');
		todos.forEach((todo) => uiu.el(list, 'li', {}, todo));
	}

	function render_registration_completed_overview(container, completed_events, table_columns) {
		if (completed_events.length === 0) {
			return;
		}
		const panel = uiu.el(container, 'section', 'registration_completed_panel');
		uiu.el(panel, 'h2', {}, 'Meldung abgeschlossen');
		completed_events.forEach((event) => {
			const event_box = uiu.el(panel, 'section', 'registration_drawn_event');
			render_registration_control_event_header(event_box, 'h3', event);
			render_registration_draw_todos(event_box, event);
			render_registration_control_table(event_box, event, registration_control_entry_rows(event), {
				editable: true,
				columns: table_columns,
			});
			render_registration_stage_comment(event_box, event, null, 'control_to_check', 'check_to_control', 'An Anmeldung', 'Anmeldung');
		});
	}

	function registration_control_event_state(event) {
		if (!is_registration_event_completed(event)) {
			return is_registration_event_open(event) ? 'opened' : 'closed';
		}
		return registration_control_draw_todos(event).length === 0 ? 'ready' : 'completed';
	}

	function get_registration_main_todos() {
		const events = get_registration_events({ include_reserve: true })
			.filter((event) => !is_registration_event_drawn(event));
		const todos = [];
		events.forEach((event) => {
			const state = registration_control_event_state(event);
			if (state === 'ready') {
				todos.push('ToDo: ' + event.name + ' ist bereit zur Auslosung');
				return;
			}
			if (state !== 'completed') {
				return;
			}
			const todo_count = registration_control_draw_todos(event).length;
			todos.push('ToDo: ' + event.name + ' die Meldung ist abgeschlossen (' +
				todo_count + ' offene ToDos)');
		});
		return todos;
	}

	function render_registration_control_event_box(container, event, table_columns, options) {
		options = options || {};
		const event_section = uiu.el(container, 'section', 'registration_control_event');
		render_registration_control_event_header(event_section, options.heading_tag || 'h3', event);
		if (options.show_todos !== false) {
			render_registration_draw_todos(event_section, event);
		}
		render_registration_control_table(event_section, event, registration_control_entry_rows(event), {
			editable: true,
			columns: table_columns,
		});
		render_registration_stage_comment(event_section, event, null, 'control_to_check', 'check_to_control', 'An Anmeldung', 'Anmeldung');
	}

	function render_registration_control_event_group(container, title, events, table_columns, class_name) {
		if (events.length === 0) {
			return;
		}
		const panel = uiu.el(container, 'section', 'registration_event_group_panel ' + (class_name || ''));
		uiu.el(panel, 'h2', {}, title);
		events.forEach((event) => render_registration_control_event_box(panel, event, table_columns, {
			heading_tag: 'h3',
			show_todos: class_name !== 'registration_event_group_opened' && class_name !== 'registration_event_group_closed',
		}));
	}

	function render_registration_closed_overview(container, closed_events, table_columns) {
		if (closed_events.length === 0) {
			return;
		}
		const panel = uiu.el(container, 'section', 'registration_event_group_panel registration_event_group_closed');
		uiu.el(panel, 'h2', {}, 'Meldung geschlossen');
		closed_events.forEach((event) => {
			const counts = registration_control_event_status_counts(event);
			const event_key = registration_event_key(event);
			const is_open = registration_drawn_open_event_key === event_key;
			const event_box = uiu.el(panel, 'section', 'registration_drawn_event');
			const head = uiu.el(event_box, 'div', 'registration_drawn_event_head');
			const toggle = uiu.el(head, 'button', {
				type: 'button',
				'class': 'registration_drawn_toggle',
				'aria-expanded': is_open ? 'true' : 'false',
			});
			uiu.el(toggle, 'span', 'registration_drawn_toggle_icon', is_open ? String.fromCharCode(9662) : String.fromCharCode(9656));
			uiu.el(toggle, 'span', 'registration_drawn_toggle_label', event.name);
			const controls = uiu.el(head, 'div', 'registration_control_event_header_controls');
			render_registration_control_status_counts(controls, counts);
			render_registration_event_open_control(controls, event);
			render_registration_event_close_control(controls, event);
			const table_holder = uiu.el(event_box, 'div', 'registration_drawn_table_holder');
			if (!is_open) {
				table_holder.hidden = true;
			}
			if (is_open) {
				render_registration_control_table(table_holder, event, registration_control_entry_rows(event), {
					editable: true,
					columns: table_columns,
				});
				render_registration_stage_comment(table_holder, event, null, 'control_to_check', 'check_to_control', 'An Anmeldung', 'Anmeldung');
			}
			toggle.addEventListener('click', () => {
				registration_drawn_open_event_key = is_open ? '' : event_key;
				ui_registration_control();
			});
		});
	}

	function render_registration_drawn_overview(container, drawn_events, table_columns) {
		if (drawn_events.length === 0) {
			return;
		}
		const panel = uiu.el(container, 'section', 'registration_drawn_panel');
		uiu.el(panel, 'h2', {}, 'Bereits gelost');
		drawn_events.forEach((event) => {
			const counts = registration_control_event_status_counts(event);
			const event_key = registration_event_key(event);
			const is_open = registration_drawn_open_event_key === event_key;
			const event_box = uiu.el(panel, 'section', 'registration_drawn_event');
			const head = uiu.el(event_box, 'div', 'registration_drawn_event_head');
			const toggle = uiu.el(head, 'button', {
				type: 'button',
				'class': 'registration_drawn_toggle',
				'aria-expanded': is_open ? 'true' : 'false',
			});
			uiu.el(toggle, 'span', 'registration_drawn_toggle_icon', is_open ? String.fromCharCode(9662) : String.fromCharCode(9656));
			uiu.el(toggle, 'span', 'registration_drawn_toggle_label', event.name);
			render_registration_control_status_counts(head, counts);
			const table_holder = uiu.el(event_box, 'div', 'registration_drawn_table_holder');
			if (!is_open) {
				table_holder.hidden = true;
			}
			if (is_open) {
				render_registration_control_table(table_holder, event, registration_control_entry_rows(event), {
					editable: false,
					columns: table_columns,
				});
			}
			toggle.addEventListener('click', () => {
				registration_drawn_open_event_key = is_open ? '' : event_key;
				ui_registration_control();
			});
		});
	}

	function render_registration_xlsx_import_status(parent, metadata) {
		uiu.empty(parent);
		if (!metadata) {
			return;
		}
		uiu.el(parent, 'span', 'registration_xlsx_status_primary',
			metadata.matched_count + ' / ' + metadata.row_count + ' zugeordnet');
		const imported_at = format_certificate_export_timestamp(metadata.uploaded_at);
		if (imported_at) {
			uiu.el(parent, 'span', 'registration_xlsx_status_secondary',
				'zuletzt importiert: ' + imported_at);
		}
	}

	function upload_registration_xlsx(input, status_el) {
		if (!input.files || input.files.length === 0) {
			return;
		}
		const file = input.files[0];
		const reader = new FileReader();
		uiu.text(status_el, 'Importiere ' + file.name + '...');
		reader.readAsDataURL(file);
		reader.onload = () => {
			send_with_live_status({
				type: 'registration_xlsx_upload',
				tournament_key: curt.key,
				name: file.name,
				data_url: reader.result,
			}, (err, response) => {
				input.value = '';
				if (err) {
					uiu.text(status_el, 'XLSX konnte nicht importiert werden');
					return cerror.net(err);
				}
				if (response && response.metadata) {
					curt.registration_xlsx_metadata = response.metadata;
				}
				const metadata = curt.registration_xlsx_metadata || response?.metadata;
				if (metadata) {
					render_registration_xlsx_import_status(status_el, metadata);
				} else {
					uiu.text(status_el, 'XLSX importiert');
				}
				ui_registration_control();
			});
		};
		reader.onerror = (e) => {
			uiu.text(status_el, 'XLSX konnte nicht gelesen werden');
			alert('Failed to upload XLSX: ' + e);
		};
	}

	function render_registration_control(container) {
		const events = get_registration_events({ include_reserve: true });
		if (events.length === 0) {
			render_registration_empty(container);
			return;
		}
		const open_draw_events = events.filter((event) => !is_registration_event_drawn(event));
		const drawn_events = events.filter(is_registration_event_drawn);
		const ready_registration_events = open_draw_events.filter((event) => registration_control_event_state(event) === 'ready');
		const completed_registration_events = open_draw_events.filter((event) => registration_control_event_state(event) === 'completed');
		const opened_registration_events = open_draw_events.filter((event) => registration_control_event_state(event) === 'opened');
		const closed_registration_events = open_draw_events.filter((event) => registration_control_event_state(event) === 'closed');
		const table_columns = registration_control_table_columns(events.flatMap((event) => registration_control_entry_rows(event)));
		apply_registration_control_column_widths(container);

		const total_entries = open_draw_events.reduce((sum, event) => sum + sorted_registration_stages(event)
			.reduce((stage_sum, stage) => stage_sum + (stage.entries || []).length, 0), 0);
		const header = uiu.el(container, 'div', 'registration_control_header');
		uiu.el(header, 'div', 'registration_summary registration_summary_ok',
			total_entries + ' Meldungen vor Auslosung');
		const header_actions = uiu.el(header, 'div', 'registration_control_actions');
		if (curt.btp_enabled) {
			const fetch_btn = uiu.el(header_actions, 'button', {
				type: 'button',
			}, ci18n('update from BTP'));
			fetch_btn.addEventListener('click', ui_btp_fetch);
		}
		const xlsx_group = uiu.el(header_actions, 'div', 'registration_xlsx_import');
		const xlsx_label = uiu.el(xlsx_group, 'label', 'registration_xlsx_upload_button', 'Spielerdetails aus BTP importieren');
		const xlsx_input = uiu.el(xlsx_label, 'input', {
			type: 'file',
			accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		});
		const xlsx_help = uiu.el(xlsx_group, 'span', 'registration_xlsx_help');
		uiu.el(xlsx_help, 'button', {
			type: 'button',
			'class': 'registration_xlsx_help_button',
			'aria-label': 'Hinweis zum BTP-Import',
		}, '?');
		uiu.el(xlsx_help, 'span', 'registration_xlsx_help_text',
			'In BTP: Bericht -> Meldungen. Im Dialog "Meldungen drucken" links bei den Konkurrenzen "Alle" und rechts bei den Feldern "Alle" auswaehlen. Dann unten auf Excel klicken und die gespeicherte .XLSX hier importieren. Der Import ergaenzt Rang, Punkte, Setzplatzdaten, Verein/Verband/Landesverband/Land und Meldedatum.');
		const xlsx_status = uiu.el(xlsx_group, 'span', 'registration_xlsx_status');
		render_registration_xlsx_import_status(xlsx_status, curt.registration_xlsx_metadata);
		xlsx_input.addEventListener('change', () => upload_registration_xlsx(xlsx_input, xlsx_status));
		const reset_btn = uiu.el(header_actions, 'button', {
			type: 'button',
			'class': 'registration_clear_button',
		}, 'Status zurücksetzen');
		reset_btn.addEventListener('click', reset_registration_player_statuses);

		render_registration_drawn_overview(container, drawn_events, table_columns);
		render_registration_control_event_group(container, 'Bereit zum Losen', ready_registration_events, table_columns, 'registration_event_group_ready');
		render_registration_control_event_group(container, 'Meldung abgeschlossen', completed_registration_events, table_columns, 'registration_event_group_completed');
		render_registration_control_event_group(container, 'Meldung geöffnet', opened_registration_events, table_columns, 'registration_event_group_opened');
		render_registration_closed_overview(container, closed_registration_events, table_columns);
	}

	function apply_btp_events_change(c) {
		if (!curt.events) {
			curt.events = {};
		}
		const events = c?.val?.events || {};
		for (const [key, value] of Object.entries(events)) {
			curt.events[key] = value;
		}
	}

	function update_registration_check_events(c) {
		apply_btp_events_change(c);
		ui_registration_check();
	}

	function update_show_registration_events(c) {
		apply_btp_events_change(c);
		cmatch.refresh_unassigned_status_context();
	}

	function update_registration_control_events(c) {
		apply_btp_events_change(c);
		ui_registration_control();
	}

	function update_registration_xlsx_metadata(c) {
		curt.registration_xlsx_metadata = c?.val?.metadata || null;
		if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
		} else if (current_view === 'registration_control') {
			ui_registration_control();
		}
	}

	function apply_registration_player_status_to_tournament(c) {
		if (!curt.registration_player_statuses) {
			curt.registration_player_statuses = {};
		}
		const key = c?.val?.key;
		if (!key) {
			return;
		}
		if (c.val.status) {
			curt.registration_player_statuses[key] = c.val.status;
		} else {
			delete curt.registration_player_statuses[key];
		}
	}

	function update_registration_check_summary_from_dom() {
		const container = uiu.qs('.registration_check_container');
		if (!container) {
			return;
		}
		const summary = container.querySelector('.registration_summary');
		const rows = [...container.querySelectorAll('.registration_player_check')];
		if (!summary) {
			return;
		}
		const done = rows.filter((row) =>
			row.classList.contains('registration_player_present') ||
			row.classList.contains('registration_player_absent')
		).length;
		const visible = rows.filter((row) => !row.hidden).length;
		const filter_suffix = visible === rows.length ? '' : ' | ' + visible + ' sichtbar';
		uiu.text(summary, done + ' / ' + rows.length + ' bearbeitet' + filter_suffix);
	}

	function update_registration_player_status(c) {
		apply_registration_player_status_to_tournament(c);
		if (current_view === 'registration_control') {
			ui_registration_control();
			return;
		}
		if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
			return;
		}
		if (current_view !== 'registration_check') {
			return;
		}
		const key = c?.val?.key;
		const status = c?.val?.status?.status || '';
		uiu.qsEach('.registration_player_check', (row) => {
			if (row.getAttribute('data-registration-status-key') !== key) {
				return;
			}
			row.classList.remove('registration_player_present', 'registration_player_absent');
			if (status) {
				row.classList.add('registration_player_' + status);
			}
			row.querySelectorAll('.registration_status_button').forEach((button) => {
				const is_active =
					(status === 'present' && button.classList.contains('registration_status_present')) ||
					(status === 'absent' && button.classList.contains('registration_status_absent'));
				button.setAttribute('aria-pressed', is_active ? 'true' : 'false');
			});
		});
		update_registration_other_present_badges();
		update_registration_check_summary_from_dom();
	}

	function update_registration_player_status_reset() {
		curt.registration_player_statuses = {};
		if (current_view === 'registration_check') {
			uiu.qsEach('.registration_player_check', (row) => {
				row.classList.remove('registration_player_present', 'registration_player_absent');
				row.querySelectorAll('.registration_status_button').forEach((button) => {
					button.setAttribute('aria-pressed', 'false');
				});
			});
			update_registration_other_present_badges();
			update_registration_check_summary_from_dom();
		} else if (current_view === 'registration_control') {
			ui_registration_control();
		} else if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
		}
	}

	function apply_registration_open_events_change(c) {
		curt.registration_open_events = c?.val?.open_events || {};
	}

	function update_registration_open_events(c) {
		apply_registration_open_events_change(c);
		if (current_view === 'registration_check') {
			ui_registration_check();
		} else if (current_view === 'registration_control') {
			ui_registration_control();
		} else if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
		}
	}

	function update_registration_accounting_entry(c) {
		if (c?.val?.entry) {
			remember_registration_accounting_entry(c.val.entry);
		}
		if (current_view === 'accounting') {
			ui_accounting();
		}
	}

	function update_registration_accounting_entry_remove(c) {
		if (Array.isArray(curt.accounting_entries)) {
			curt.accounting_entries = curt.accounting_entries.filter((entry) => entry && entry.id !== c?.val?.entry_id);
		}
		if (current_view === 'accounting') {
			ui_accounting();
		}
	}

	function update_registration_accounting_item(c) {
		if (c?.val?.item) {
			remember_registration_accounting_item(c.val.item);
		}
		if (current_view === 'accounting') {
			ui_accounting();
		}
	}

	function update_registration_accounting_item_remove(c) {
		if (Array.isArray(curt.accounting_items)) {
			curt.accounting_items = curt.accounting_items.filter((item) => item && item.id !== c?.val?.item_id);
		}
		if (current_view === 'accounting') {
			ui_accounting();
		}
	}

	function update_registration_accounting_document(c) {
		if (c?.val?.document) {
			remember_registration_accounting_document(c.val.document);
		}
		if (current_view === 'accounting') {
			ui_accounting();
		}
	}

	function update_btp_payments(c) {
		curt.btp_payments = c?.val?.btp_payments || { payments: [] };
		if (current_view === 'accounting') {
			ui_accounting();
		}
	}

	function apply_registration_player_comment_change(c) {
		if (!curt.registration_player_comments) {
			curt.registration_player_comments = {};
		}
		const key = c?.val?.key;
		const direction = c?.val?.direction;
		if (!key || !direction) {
			return;
		}
		if (!curt.registration_player_comments[key]) {
			curt.registration_player_comments[key] = {};
		}
		if (c.val.comment) {
			curt.registration_player_comments[key][direction] = c.val.comment;
		} else {
			delete curt.registration_player_comments[key][direction];
			if (Object.keys(curt.registration_player_comments[key]).length === 0) {
				delete curt.registration_player_comments[key];
			}
		}
	}

	function apply_registration_player_comment_read_change(c) {
		const key = c?.val?.key;
		const direction = c?.val?.direction;
		const comment = curt?.registration_player_comments?.[key]?.[direction];
		if (!comment) {
			return;
		}
		comment.read = true;
		comment.read_at = c.val.read_at || comment.read_at || null;
	}

	function update_registration_player_comment(c) {
		apply_registration_player_comment_change(c);
		if (current_view === 'registration_check') {
			ui_registration_check();
		} else if (current_view === 'registration_control') {
			ui_registration_control();
		} else if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
		}
	}

	function update_registration_player_comment_read(c) {
		apply_registration_player_comment_read_change(c);
		if (current_view === 'registration_check') {
			ui_registration_check();
		} else if (current_view === 'registration_control') {
			ui_registration_control();
		} else if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
		}
	}

	function apply_registration_stage_comment_change(c) {
		if (!curt.registration_stage_comments) {
			curt.registration_stage_comments = {};
		}
		const key = c?.val?.key;
		const direction = c?.val?.direction;
		if (!key || !direction) {
			return;
		}
		if (!curt.registration_stage_comments[key]) {
			curt.registration_stage_comments[key] = {};
		}
		if (c.val.comment) {
			curt.registration_stage_comments[key][direction] = c.val.comment;
		} else {
			delete curt.registration_stage_comments[key][direction];
			if (Object.keys(curt.registration_stage_comments[key]).length === 0) {
				delete curt.registration_stage_comments[key];
			}
		}
	}

	function apply_registration_stage_comment_read_change(c) {
		const key = c?.val?.key;
		const direction = c?.val?.direction;
		const comment = curt?.registration_stage_comments?.[key]?.[direction];
		if (!comment) {
			return;
		}
		comment.read = true;
		comment.read_at = c.val.read_at || comment.read_at || null;
	}

	function update_registration_stage_comment(c) {
		apply_registration_stage_comment_change(c);
		if (current_view === 'registration_check') {
			ui_registration_check();
		} else if (current_view === 'registration_control') {
			ui_registration_control();
		} else if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
		}
	}

	function update_registration_stage_comment_read(c) {
		apply_registration_stage_comment_read_change(c);
		if (current_view === 'registration_check') {
			ui_registration_check();
		} else if (current_view === 'registration_control') {
			ui_registration_control();
		} else if (current_view === 'show') {
			cmatch.refresh_unassigned_status_context();
		}
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

	function ui_registration_check() {
		current_view = 'registration_check';
		crouting.set('t/:key/registration_check', { key: curt.key });
		toprow.hide();
		update_test_clock_body_state();
		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.remove('main_upcoming', 'main_self_check_in', 'main_registration', 'main_registration_control', 'main_accounting');
		main.classList.add('main_registration');
		const container = uiu.el(main, 'div', 'registration_container registration_check_container');
		render_registration_check(container);
	}

	function ui_registration_control() {
		current_view = 'registration_control';
		crouting.set('t/:key/registration_control', { key: curt.key });
		render_show_toprow();
		update_test_clock_body_state();
		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.remove('main_upcoming', 'main_self_check_in', 'main_registration', 'main_registration_control', 'main_accounting');
		main.classList.add('main_registration', 'main_registration_control');
		const container = uiu.el(main, 'div', 'registration_container registration_control_container');
		uiu.el(container, 'h1', {}, 'Hauptfeld-Kontrolle');
		render_registration_control(container);
	}

	function ui_accounting() {
		current_view = 'accounting';
		crouting.set('t/:key/accounting', { key: curt.key });
		render_show_toprow();
		update_test_clock_body_state();
		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.remove('main_upcoming', 'main_self_check_in', 'main_registration', 'main_registration_control', 'main_accounting');
		main.classList.add('main_accounting');
		const container = uiu.el(main, 'div', 'accounting_container');
		render_accounting(container);
	}

	function ui_match_screens(route, options) {
		options = options || {};
		crouting.set(route, { key: curt.key });
		toprow.hide();
		update_test_clock_body_state();
		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.remove('main_upcoming', 'main_self_check_in', 'main_registration', 'main_registration_control', 'main_accounting');
		main.classList.add(options.main_class || 'main_upcoming');
		main.onclick = null;
		if (options.enable_fullscreen_toggle !== false) {
			main.onclick = () => fullscreen.toggle();
		}
		return main;
	}

	function handle_view_announcement(kind, payload) {
		if (current_view === 'registration_check') {
			return true;
		}
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

	_route_single(/t\/([a-z0-9]+)\/registration_check/, ui_registration_check, change.default_handler(ui_registration_check, {
		update_btp_events: update_registration_check_events,
		registration_player_status: update_registration_player_status,
		registration_player_status_reset: update_registration_player_status_reset,
		registration_open_events: update_registration_open_events,
		registration_player_comment: update_registration_player_comment,
		registration_player_comment_read: update_registration_player_comment_read,
		registration_stage_comment: update_registration_stage_comment,
		registration_stage_comment_read: update_registration_stage_comment_read,
		registration_xlsx_metadata: update_registration_xlsx_metadata,
		registration_accounting_entry: update_registration_accounting_entry,
		registration_accounting_entry_remove: update_registration_accounting_entry_remove,
		registration_accounting_item: update_registration_accounting_item,
		registration_accounting_item_remove: update_registration_accounting_item_remove,
		registration_accounting_document: update_registration_accounting_document,
		update_btp_payments,
	}));

	_route_single(/t\/([a-z0-9]+)\/registration_control/, ui_registration_control, change.default_handler(ui_registration_control, {
		update_btp_events: update_registration_control_events,
		registration_player_status: update_registration_player_status,
		registration_player_status_reset: update_registration_player_status_reset,
		registration_open_events: update_registration_open_events,
		registration_player_comment: update_registration_player_comment,
		registration_player_comment_read: update_registration_player_comment_read,
		registration_stage_comment: update_registration_stage_comment,
		registration_stage_comment_read: update_registration_stage_comment_read,
		registration_xlsx_metadata: update_registration_xlsx_metadata,
	}));

	_route_single(/t\/([a-z0-9]+)\/accounting/, ui_accounting, change.default_handler(ui_accounting, {
		update_btp_events: function(c) {
			curt.events = c.val.events || {};
			ui_accounting();
		},
		registration_accounting_entry: update_registration_accounting_entry,
		registration_accounting_entry_remove: update_registration_accounting_entry_remove,
		registration_accounting_item: update_registration_accounting_item,
		registration_accounting_item_remove: update_registration_accounting_item_remove,
		registration_accounting_document: update_registration_accounting_document,
		update_btp_payments,
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
			get_registration_main_todos,
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
