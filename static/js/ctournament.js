'use strict';

var curt; // current tournament

var ctournament = (function() {
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
			if (curt.language && curt.language !== 'auto') {
				ci18n.switch_language(curt.language);
			}
			success_cb();
		});
	}

	function ui_create() {
		const main = uiu.qs('.main');

		uiu.empty(main);
		const form = uiu.el(main, 'form');
		uiu.el(form, 'h2', {}, ci18n('Create tournament'));
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

	function update_score(c) {
		const cval = c.val;
		const match_id = cval.match_id;

		// Find the match
		const m = utils.find(curt.matches, m => m._id === match_id);
		if (!m) {
			cerror.silent('Cannot find match to update score, ID: ' + JSON.stringify(match_id));
			return;
		}

		const old_section = cmatch.calc_section(m);
		m.network_score = cval.network_score;
		m.presses = cval.presses;
		m.team1_won = cval.team1_won;
		m.shuttle_count = cval.shuttle_count;
		const new_section = cmatch.calc_section(m);

		if (old_section === new_section) {
			cmatch.update_match_score(m);
		} else {
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
			return;
		}
		m.btp_winner = cval.btp_winner;
		m.setup = cval.setup;

		cmatch.update_players(m);
	}

	function remove_match(c) {
		const cval = c.val;
		const match_id = cval.match__id;

		const m = utils.find(curt.matches, m => m._id === match_id);
		if (!m) {
			cerror.silent('Cannot find match to update, ID: ' + JSON.stringify(match_id));
			return;
		}
		const section = cmatch.calc_section(m);
		cmatch.remove_match_from_gui(m, section);

	}
	function update_match(c) {
		const cval = c.val;

		const match_id = cval.match__id;

		// Find the match
		const m = utils.find(curt.matches, m => m._id === match_id);
		if (!m) {
			cerror.silent('Cannot find match to update, ID: ' + JSON.stringify(match_id));
			return;
		}
		const old_section = cmatch.calc_section(m);
		if (cval.match) {
			if('network_score' in cval.match){
				m.network_score = cval.match.network_score;
			}
			m.presses = cval.match.presses;
			m.team1_won = cval.match.team1_won;
			m.shuttle_count = cval.match.shuttle_count;
			m.setup = cval.match.setup;
			m.btp_winner = cval.match.btp_winner;
		}
		const new_section = cmatch.calc_section(m);
		cmatch.update_match(m, old_section, new_section);
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
		m.network_score = cval.match.network_score;
		m.presses = cval.match.presses;
		m.team1_won = cval.match.team1_won;
		m.shuttle_count = cval.match.shuttle_count;
		m.setup = cval.match.setup;
		m.btp_winner = cval.match.btp_winner;
		const new_section = cmatch.calc_section(m);
		cmatch.update_match(m, old_section, new_section);

		console.log(new_section);

		if (old_section != new_section || new_section == 'unassigned') {
			uiu.qsEach('.upcoming_container', (upcoming_container) => {
				cmatch.render_upcoming_matches(upcoming_container);
			});
		}
	}

	function tabletoperator_add(c) {
		curt.tabletoperators.push(c.val.tabletoperator);
		_show_render_tabletoperators();
	}

	function tabletoperator_moved_up(c) {
		const changed_t = utils.find(curt.tabletoperators, m => m._id === c.val.tabletoperator._id);
		if (changed_t) {
			changed_t.start_ts = c.val.tabletoperator.start_ts;
		}
		_show_render_tabletoperators();
	}

	function tabletoperator_moved_down(c) {
		const changed_t = utils.find(curt.tabletoperators, m => m._id === c.val.tabletoperator._id);
		if (changed_t) {
			changed_t.start_ts = c.val.tabletoperator.start_ts;
		}
		_show_render_tabletoperators();
	}

	function tabletoperator_removed(c) {
		const changed_t = utils.find(curt.tabletoperators, m => m._id === c.val.tabletoperator._id);
		if (changed_t) {
			changed_t.court = c.val.tabletoperator.court;
		}
		_show_render_tabletoperators();
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
		uiu.qsEach('.normalizations_values_div',(div_el) => {
			div_el.innerHTML = "";
			render_normalisation_values(div_el);
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
	function _update_all_ui_elements_upcoming() {
		cmatch.render_courts(uiu.qs('.courts_container'), 'public');
		cmatch.render_upcoming_matches(uiu.qs('.upcoming_container'));
	}

	function _show_render_matches() {
		cmatch.render_courts(uiu.qs('.courts_container'));
		cmatch.render_unassigned(uiu.qs('.unassigned_container'));
		cmatch.render_finished(uiu.qs('.finished_container'));
	}
	function _show_render_tabletoperators() {
		ctabletoperator.render_unassigned(uiu.qs('.unassigned_tableoperators_container'));
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

	function render_announcement_formular(target) {
		const announcements = uiu.el(target, 'div', 'announcements_container');
		const heading = uiu.el(announcements, 'h3', {}, 'Freie Ansage');
		const form = uiu.el(announcements, 'form');
		uiu.el(form, 'textarea', {
			type: 'textarea',
			id: 'custom_announcement',
			name: 'custom_announcement',
			cols: '50',
			rows: '4',
			maxlength: '175'
		});
		const btp_fetch_btn = uiu.el(form, 'button', {
			'class': 'match_save_button',
			role: 'submit',
		}, 'Ansage abspielen');
		form_utils.onsubmit(form, function (d) {
			//announce([d.custom_announcement]);
			send({
				type: 'free_announce',
				tournament_key: curt.key,
				text: d.custom_announcement,
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
			});
		});
	}

	function render_enable_announcement(target) {
		const announcements = uiu.el(target, 'div', 'enable_announcements_container');
		const heading = uiu.el(announcements, 'h3', {}, 'Ansagen auf diesem Gerät');
		const form = uiu.el(announcements, 'form');
		const enable_announcements = uiu.el(form, 'input', {
			type: 'checkbox',
			id: 'enable_announcements',
			name: 'enable_announcements'
		});

		enable_announcements.checked = (window.localStorage.getItem('enable_announcements') === 'true');
		uiu.el(form, 'label', { for: 'enable_announcements' }, 'aktiv');
		enable_announcements.addEventListener('change', change_announcements);
	}

	function change_announcements(e) {
		let enable_announcements = document.getElementById('enable_announcements');
		console.log(enable_announcements.checked);
		window.localStorage.setItem('enable_announcements', enable_announcements.checked);
	}

	function ui_show() {
		crouting.set('t/:key/', { key: curt.key });
		const bup_lang = ((curt.language && curt.language !== 'auto') ? '&lang=' + encodeURIComponent(curt.language) : '');
		const bup_dm_style = '&dm_style=' + encodeURIComponent(curt.dm_style || 'international');
		toprow.set([{
			label: ci18n('Tournaments'),
			func: ui_list,
		}, {
			label: curt.name || curt.key,
			func: ui_show,
			'class': 'ct_name',
		}], [{
			label: 'Scoreboard',
			href: '/bup/#btsh_e=' + encodeURIComponent(curt.key) + '&display' + bup_dm_style + bup_lang,
		}, {
			label: 'Umpire Panel',
			href: '/bup/#btsh_e=' + encodeURIComponent(curt.key) + bup_lang,
		}, {
			label: ci18n('Next Matches'),
			href: '/admin/t/' + encodeURIComponent(curt.key) + '/upcoming',
		},]);

		const main = uiu.qs('.main');
		uiu.empty(main);

		const meta_div = uiu.el(main, 'div', 'metadata_container');

		uiu.el(meta_div, 'div', 'unassigned_tableoperators_container');
		uiu.el(meta_div, 'div', 'umpire_container');
		render_announcement_formular(meta_div);

		const meta_right_div = uiu.el(meta_div, 'div', 'metadata_right_container');

		render_enable_announcement(meta_right_div);

		render_settings(meta_right_div);
		
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
		tabletoperator_add: tabletoperator_add,
		tabletoperator_moved_up: tabletoperator_moved_up,
		tabletoperator_moved_down: tabletoperator_moved_down,
		tabletoperator_removed: tabletoperator_removed,
		btp_status: btp_status_changed,
		ticker_status: ticker_status_changed,
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

		uiu.el(settings_div, 'div', 'errors');
	}

	function btp_status_changed(c) {
		set_service_status('btp_status', c);
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
		}
	}
	
	function _upload_logo(e) {
		const input = e.target;
		if (!input.files.length) return;

		const reader = new FileReader();
		reader.readAsDataURL(input.files[0]);
		reader.onload = () => {
			send({
				type: 'tournament_upload_logo',
				tournament_key: curt.key,
				data_url: reader.result,
			}, (err) => {
				if (err) {
					return cerror.net(err);
				}
				input.closest('form').reset();
			});
		};
		reader.onerror = (e) => {
			alert('Failed to upload: ' + e);
		};
	}

	function ui_edit() {
		crouting.set('t/:key/edit', { key: curt.key });
		toprow.set([{
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

		const main = uiu.qs('.main');
		uiu.empty(main);

		const form = uiu.el(main, 'form', 'tournament_settings');
		const key_label = uiu.el(form, 'label');
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

		const name_label = uiu.el(form, 'label');
		uiu.el(name_label, 'span', {}, ci18n('tournament:edit:name'));
		uiu.el(name_label, 'input', {
			type: 'text',
			name: 'name',
			required: 'required',
			value: curt.name || curt.key,
			'class': 'ct_name',
		});


		const name_tguid = uiu.el(form, 'label');
		uiu.el(name_tguid, 'span', {}, ci18n('tournament:edit:tguid'));
		uiu.el(name_tguid, 'input', {
			type: 'text',
			name: 'tguid',
			value: curt.tguid ? curt.tguid : "",
			'class': 'ct_tguid',
		});

		// Tournament language selection
		const language_label = uiu.el(form, 'label');
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

		// Team competition?
		const is_team_label = uiu.el(form, 'label');
		const is_team_attrs = {
			type: 'checkbox',
			name: 'is_team',
		};
		if (curt.is_team) {
			is_team_attrs.checked = 'checked';
		}
		uiu.el(is_team_label, 'input', is_team_attrs);
		uiu.el(is_team_label, 'span', {}, ci18n('team competition'));

		// Nation competition?
		const is_nation_competition_label = uiu.el(form, 'label');
		const is_nation_competition_attrs = {
			type: 'checkbox',
			name: 'is_nation_competition',
		};
		if (curt.is_nation_competition) {
			is_nation_competition_attrs.checked = 'checked';
		}
		uiu.el(is_nation_competition_label, 'input', is_nation_competition_attrs);
		uiu.el(is_nation_competition_label, 'span', {}, ci18n('nation competition'));

		// Default display
		const cur_dm_style = curt.dm_style || 'international';
		const dm_style_label = uiu.el(form, 'label');
		uiu.el(dm_style_label, 'span', {}, ci18n('tournament:edit:dm_style'));
		const dm_style_select = uiu.el(dm_style_label, 'select', {
			name: 'dm_style',
			required: 'required',
		});
		const all_dm_styles = displaymode.ALL_STYLES;
		for (const s of all_dm_styles) {
			const s_attrs = {
				value: s,
			};
			if (s === cur_dm_style) {
				s_attrs.selected = 'selected';
			}
			uiu.el(dm_style_select, 'option', s_attrs, s);
		}

		const displaysettings_style_label = uiu.el(form, 'label');
		uiu.el(displaysettings_style_label, 'span', {}, ci18n('tournament:edit:displaysettings_general'));
		createGeneralDisplaySettingsSelectBox(displaysettings_style_label, curt.displaysettings_general ? curt.displaysettings_general : "default");

			

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

		const warmup_timer_label = uiu.el(form, 'label');
		uiu.el(warmup_timer_label, 'span', {}, ci18n('tournament:edit:warmup_timer_behavior'));
		const warmup_timer_select = uiu.el(warmup_timer_label, 'select', {
			name: 'warmup',
		});
		uiu.el(warmup_timer_select, 'option', { value: warmup_options[0][0] }, ci18n('tournament:edit:warmup_timer_behavior:' + warmup_options[0][0]), { wo: warmup_options[0][0] });
		let warmup_marked = false;

		const warmup_ready = uiu.el(form, 'label');
		uiu.el(warmup_ready, 'span', {}, ci18n('tournament:edit:warmup_ready'));
		var warmup_ready_input = uiu.el(warmup_ready, 'input', {
			type: 'number',
			name: 'warmup_ready',
			required: 'required',
			disabled: warmup_options[0][3],
			value: warmup_options[0][1],
			'class': 'ct_name',
		});

		const warmup_start = uiu.el(form, 'label');
		uiu.el(warmup_start, 'span', {}, ci18n('tournament:edit:warmup_start'));
		var warmup_start_input = uiu.el(warmup_start, 'input', {
			type: 'number',
			name: 'warmup_start',
			required: 'required',
			disabled: warmup_options[0][3],
			value: warmup_options[0][2],
			'class': 'ct_name',
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
		};

		// BTP
		const btp_fieldset = uiu.el(form, 'fieldset');
		uiu.el(btp_fieldset, 'h2', {}, ci18n('tournament:edit:btp'));
		const btp_enabled_label = uiu.el(btp_fieldset, 'label');
		const ba_attrs = {
			type: 'checkbox',
			name: 'btp_enabled',
		};
		if (curt.btp_enabled) {
			ba_attrs.checked = 'checked';
		}
		uiu.el(btp_enabled_label, 'input', ba_attrs);
		uiu.el(btp_enabled_label, 'span', {}, ci18n('tournament:edit:btp:enabled'));

		const btp_autofetch_enabled_label = uiu.el(btp_fieldset, 'label');
		const bae_attrs = {
			type: 'checkbox',
			name: 'btp_autofetch_enabled',
		};
		if (curt.btp_autofetch_enabled) {
			bae_attrs.checked = 'checked';
		}
		uiu.el(btp_autofetch_enabled_label, 'input', bae_attrs);
		uiu.el(btp_autofetch_enabled_label, 'span', {}, ci18n('tournament:edit:btp:autofetch_enabled'));

		const btp_readonly_label = uiu.el(btp_fieldset, 'label');
		const bro_attrs = {
			type: 'checkbox',
			name: 'btp_readonly',
		};
		if (curt.btp_readonly) {
			bro_attrs.checked = 'checked';
		}
		uiu.el(btp_readonly_label, 'input', bro_attrs);
		uiu.el(btp_readonly_label, 'span', {}, ci18n('tournament:edit:btp:readonly'));

		const btp_ip_label = uiu.el(btp_fieldset, 'label');
		uiu.el(btp_ip_label, 'span', {}, ci18n('tournament:edit:btp:ip'));
		uiu.el(btp_ip_label, 'input', {
			type: 'text',
			name: 'btp_ip',
			value: (curt.btp_ip || ''),
		});

		const btp_password_label = uiu.el(btp_fieldset, 'label');
		uiu.el(btp_password_label, 'span', {}, ci18n('tournament:edit:btp:password'));
		uiu.el(btp_password_label, 'input', {
			type: 'text',
			name: 'btp_password',
			value: (curt.btp_password || ''),
		});

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

		// Ticker
		const ticker_fieldset = uiu.el(form, 'fieldset');
		uiu.el(ticker_fieldset, 'h2', {}, ci18n('tournament:edit:ticker'));
		const ticker_enabled_label = uiu.el(ticker_fieldset, 'label');
		const te_attrs = {
			type: 'checkbox',
			name: 'ticker_enabled',
		};
		if (curt.ticker_enabled) {
			te_attrs.checked = 'checked';
		}
		uiu.el(ticker_enabled_label, 'input', te_attrs);
		uiu.el(ticker_enabled_label, 'span', {}, ci18n('tournament:edit:ticker_enabled'));

		const ticker_url_label = uiu.el(ticker_fieldset, 'label');
		uiu.el(ticker_url_label, 'span', {}, ci18n('tournament:edit:ticker_url'));
		uiu.el(ticker_url_label, 'input', {
			type: 'text',
			name: 'ticker_url',
			value: (curt.ticker_url || ''),
		});

		const ticker_password_label = uiu.el(ticker_fieldset, 'label');
		uiu.el(ticker_password_label, 'span', {}, ci18n('tournament:edit:ticker_password'));
		uiu.el(ticker_password_label, 'input', {
			type: 'text',
			name: 'ticker_password',
			value: (curt.ticker_password || ''),
		});



		const tablet_fieldset = uiu.el(form, 'fieldset');
		uiu.el(tablet_fieldset, 'h2', {}, ci18n('tournament:edit:tablets'));
		create_checkbox(curt, tablet_fieldset, 'tabletoperator_enabled');
		create_checkbox(curt, tablet_fieldset, 'tabletoperator_with_umpire_enabled');
		create_checkbox(curt, tablet_fieldset, 'tabletoperator_winner_of_quaterfinals_enabled');
		create_checkbox(curt, tablet_fieldset, 'tabletoperator_use_manual_counting_boards_enabled');
		create_checkbox(curt, tablet_fieldset, 'tabletoperator_split_doubles');
		create_checkbox(curt, tablet_fieldset, 'tabletoperator_with_state_enabled');
		create_checkbox(curt, tablet_fieldset, 'tabletoperator_set_break_after_tabletservice');
		create_checkbox(curt, tablet_fieldset, 'preparation_meetingpoint_enabled');
		create_checkbox(curt, tablet_fieldset, 'preparation_tabletoperator_setup_enabled');
		if (!curt.tabletoperator_break_seconds) {
			curt.tabletoperator_break_seconds = 300;
		}
		create_input(curt, "number", tablet_fieldset, 'tabletoperator_break_seconds')
		create_numeric_input(curt, tablet_fieldset, 'announcement_speed', 0.8, 1.3, 1.05,0.01);



		uiu.el(form, 'button', {
			role: 'submit',
		}, ci18n('Change'));
		form_utils.onsubmit(form, function (data) {
			const props = {
				name: data.name,
				tguid: data.tguid,
				language: data.language,
				is_team: (!!data.is_team),
				is_nation_competition: (!!data.is_nation_competition),
				btp_enabled: (!!data.btp_enabled),
				btp_autofetch_enabled: (!!data.btp_autofetch_enabled),
				btp_readonly: (!!data.btp_readonly),
				btp_ip: data.btp_ip,
				btp_password: data.btp_password,
				btp_timezone: data.btp_timezone,
				dm_style: data.dm_style,
				displaysettings_general: data.displaysettings_general,
				warmup: data.warmup,
				warmup_ready: data.warmup_ready,
				warmup_start: data.warmup_start,
				ticker_enabled: (!!data.ticker_enabled),
				ticker_url: data.ticker_url,
				ticker_password: data.ticker_password,
				tabletoperator_with_umpire_enabled: (!!data.tabletoperator_with_umpire_enabled),
				tabletoperator_winner_of_quaterfinals_enabled: (!!data.tabletoperator_winner_of_quaterfinals_enabled),
				tabletoperator_split_doubles: (!!data.tabletoperator_split_doubles),
				tabletoperator_with_state_enabled: (!!data.tabletoperator_with_state_enabled),
				tabletoperator_set_break_after_tabletservice: (!!data.tabletoperator_set_break_after_tabletservice),
				tabletoperator_use_manual_counting_boards_enabled: (!!data.tabletoperator_use_manual_counting_boards_enabled),
				tabletoperator_enabled: (!!data.tabletoperator_enabled),
				tabletoperator_break_seconds: data.tabletoperator_break_seconds,
				announcement_speed: data.announcement_speed,
				preparation_meetingpoint_enabled: (!!data.preparation_meetingpoint_enabled),
				preparation_tabletoperator_setup_enabled: (!!data.preparation_tabletoperator_setup_enabled)
			};
			send({
				type: 'tournament_edit_props',
				key: curt.key,
				props: props,
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
				ui_show();
			});
		});

		const logo_preview_container = uiu.el(main, 'div', {
			style: (
				'float:right;position:relative;text-align:center;' +
				'height: 216px; width: 384px; font-size: 35px;' +
				'background:' + (curt.logo_background_color || '#000000') + ';' +
				'color:' + (curt.logo_foreground_color || '#aaaaaa') + ';'
			),
		});
		if (curt.logo_id) {
			uiu.el(logo_preview_container, 'img', {
				style: 'height: 151px;',
				src: '/h/' + encodeURIComponent(curt.key) + '/logo/' + curt.logo_id,
			});
			uiu.el(logo_preview_container, 'div', {}, 'Court 42');
		}

		uiu.el(main, 'h2', {}, ci18n('tournament:edit:logo'));
		const logo_form = uiu.el(main, 'form');
		const logo_button = uiu.el(logo_form, 'input', {
			type: 'file',
			accept: 'image/*',
		});
		logo_button.addEventListener('change', _upload_logo);
		const logo_colors_container = uiu.el(logo_form, 'div', { style: 'display: block' });
		const bg_col_label = uiu.el(logo_colors_container, 'label', {}, ci18n('tournament:edit:logo:background'));
		const logo_background_color_input = uiu.el(bg_col_label, 'input', {
			type: 'color',
			name: 'logo_background_color',
			value: curt.logo_background_color || '#000000',
		});
		logo_background_color_input.addEventListener('change', (e) => {
			send({
				type: 'tournament_edit_props',
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
		fg_col_input.addEventListener('change', (e) => {
			send({
				type: 'tournament_edit_props',
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

		
		render_courts(main);
		render_displaysettings(main);
		render_normalisation_values(uiu.el(main, 'div','normalizations_values_div'));
	}
	_route_single(/t\/([a-z0-9]+)\/edit$/, ui_edit);

	function render_normalisation_values(main) {
		uiu.el(main, 'h2', {}, ci18n('tournament:edit:normalizations'));

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
		create_undecorated_input("text", uiu.el(tr_input, 'td', {}), 'normalizations_language');
		const actions_td = uiu.el(tr_input, 'td', {});
		const add_btn = uiu.el(actions_td, 'button', {}, 'Add');
		add_btn.addEventListener('click', function (e) {

			var new_normalization = {}
			new_normalization.origin = document.getElementById('normalizations_origin').value;
			new_normalization.replace = document.getElementById('normalizations_replace').value;
			new_normalization.language = document.getElementById('normalizations_language').value;

			send({
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
			}, 'Delete');
						
			delete_btn.addEventListener('click', function (e) {
				const del_btn = e.target;
				const normalization_id = del_btn.getAttribute('data-normalization-id');
				send({
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


	function render_displaysettings(main) {
		uiu.el(main, 'h2', {}, ci18n('tournament:edit:displays'));

		const display_table = uiu.el(main, 'table');
		const display_tbody = uiu.el(display_table, 'tbody');
		const tr = uiu.el(display_tbody, 'tr');
		uiu.el(tr, 'th', {}, ci18n('tournament:edit:displays:num'));
		uiu.el(tr, 'td', {}, ci18n('tournament:edit:displays:court'));
		uiu.el(tr, 'td', {}, ci18n('tournament:edit:displays:setting'));
		uiu.el(tr, 'td', {}, ci18n('tournament:edit:displays:onlinestatus'));

		for (const c of curt.displays) {
			const tr = uiu.el(display_tbody, 'tr');
			uiu.el(tr, 'th', {}, c.client_id);
			createCourtSelectBox(uiu.el(tr, 'td', {}, ''), c.client_id, c.court_id);
			createDisplaySettingsSelectBox(uiu.el(tr, 'td', {}, ''), c.client_id, c.displaysetting_id);
			uiu.el(tr, 'td', {}, (!c.online) ? 'offline' : 'online');
			const actions_td = uiu.el(tr, 'td', {});
			const reset_btn = uiu.el(actions_td, 'button', {
				'data-display-setting-id': c.client_id,
			}, 'Restart');

			if (!c.online) {
				reset_btn.setAttribute('disabled', 'disabled');
			}
			reset_btn.addEventListener('click', function (e) {
				const del_btn = e.target;
				const display_setting_id = del_btn.getAttribute('data-display-setting-id');
				send({
					type: 'reset_display',
					tournament_key: curt.key,
					display_setting_id: display_setting_id,
				}, err => {
					if (err) {
						return cerror.net(err);
					}
				});
			});
		}
	}

	function render_courts(main) {
		uiu.el(main, 'h2', {}, ci18n('tournament:edit:courts'));

		const courts_table = uiu.el(main, 'table');
		const courts_tbody = uiu.el(courts_table, 'tbody');
		for (const c of curt.courts) {
			const tr = uiu.el(courts_tbody, 'tr');
			uiu.el(tr, 'th', {}, c.num);
			uiu.el(tr, 'td', {}, c.name || '');
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

		const courts_add_form = uiu.el(main, 'form');
		uiu.el(courts_add_form, 'input', {
			type: 'number',
			name: 'count',
			min: 1,
			max: 99,
			value: 1,
		});
		const courts_add_button = uiu.el(courts_add_form, 'button', {
			role: 'button',
		}, 'Add Courts');
		form_utils.onsubmit(courts_add_form, function (data) {
			courts_add_button.setAttribute('disabled', 'disabled');
			const court_count = parseInt(data.count);
			const nums = [];
			for (let court_num = maxnum + 1; court_num <= maxnum + court_count; court_num++) {
				nums.push(court_num);
			}

			send({
				type: 'courts_add',
				tournament_key: curt.key,
				nums,
			}, function (err, response) {
				if (err) {
					courts_add_button.removeAttribute('disabled');
					return cerror.net(err);
				}
				Array.prototype.push.apply(curt.courts, response.added_courts);
				ui_edit();
			});
		});
	}

	function create_checkbox(curt, parent_el, filed_id) {
		const label = uiu.el(parent_el, 'label');
		const attrs = {
			type: 'checkbox',
			name: filed_id,
		};
		if (curt[filed_id]) {
			attrs.checked = 'checked';
		}
		uiu.el(label, 'input', attrs);
		uiu.el(label, 'span', {}, ci18n('tournament:edit:' + filed_id));
	}

	function create_input(curt, type, parent_el, filed_id) {
		const text_input = uiu.el(parent_el, 'label');
		uiu.el(text_input, 'span', {}, ci18n('tournament:edit:' + filed_id));
		uiu.el(text_input, 'input', {
			type: type,
			name: filed_id,
			value: curt[filed_id] || '',
		});
	}

	function create_undecorated_input(type, parent_el, filed_id) {
		uiu.el(parent_el, 'input', {
			type: type,
			name: filed_id,
			id: filed_id,
			value: '',
		});
	}

	function create_numeric_input(curt, parent_el, filed_id, min_value, max_value, default_value, step_value) {
		const text_input = uiu.el(parent_el, 'label');
		uiu.el(text_input, 'span', {}, ci18n('tournament:edit:' + filed_id));
		uiu.el(text_input, 'input', {
			type: "number",
			name: filed_id,
			value: curt[filed_id] || default_value,
			min: min_value,
			max: max_value,
			step: step_value
		});
	}

	function createCourtSelectBox(parentEl, parent_id, court_id) {
		const court_select_box = uiu.el(parentEl, 'select', {
			name: 'court_' + parent_id,
		});

		const empty_id = "--";
		const attrs = {
			'data-display-setting-id': court_id,
			value: empty_id,
		}

		if (!court_id || empty_id === court_id) {
			attrs.selected = 'selected';
		}
		uiu.el(court_select_box, 'option', attrs, empty_id);

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


		court_select_box.addEventListener('change', (e) => {
			const select_box = e.target;
			const display_setting_id = select_box.name.split("_")[1];
			send({
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
			send({
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

	function createGeneralDisplaySettingsSelectBox(parentEl, displaysettings_id) {
		const displaysettings_select_box = uiu.el(parentEl, 'select', {
			name: 'displaysettings_general'
		});
		createSelectBoxContent(displaysettings_select_box, curt.displaysettings, displaysettings_id);
				
	}
	function createSelectBoxContent(select_box, content, selected_id) {
		for (const item of content) {
			const attrs = {
				'data-display-setting-id': selected_id,
				value: item.id,
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

	function render_upcoming_psv(container) {
		cmatch.prepare_render(curt);
		const courts_container = uiu.el(container, 'div', 'courts_container');
		cmatch.render_courts(courts_container, 'public', 7, 13);

		const upcoming_container = uiu.el(container, 'div', 'upcoming_container');
		cmatch.render_upcoming_matches(upcoming_container);
	}

	function render_upcoming_bts(container) {
		cmatch.prepare_render(curt);
		const courts_container = uiu.el(container, 'div', 'courts_container');
		cmatch.render_courts(courts_container, 'public', 1, 6);

		const upcoming_container = uiu.el(container, 'div', 'upcoming_container');
		cmatch.render_upcoming_matches(upcoming_container);
	}


	function ui_upcoming() {
		crouting.set('t/:key/upcoming', { key: curt.key });
		toprow.hide();

		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.add('main_upcoming');

		render_upcoming(main);
		main.addEventListener('click', () => {
			fullscreen.toggle();
		});
	}
	_route_single(/t\/([a-z0-9]+)\/upcoming/, ui_upcoming, change.default_handler(_update_all_ui_elements_upcoming, {
		score: update_score,
		court_current_match: update_upcoming_current_match,
		match_edit: update_upcoming_match,
	}));

	function ui_upcoming_psv() {
		crouting.set('t/:key/psv_upcoming', { key: curt.key });
		toprow.hide();

		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.add('main_upcoming');

		render_upcoming_psv(main);
		main.addEventListener('click', () => {
			fullscreen.toggle();
		});
	}
	_route_single(/t\/([a-z0-9]+)\/psv_upcoming/, ui_upcoming_psv, change.default_handler(_update_all_ui_elements_upcoming, {
		score: update_score,
		court_current_match: update_upcoming_current_match,
		match_edit: update_upcoming_match,
	}));

	function ui_upcoming_bts() {
		crouting.set('t/:key/bts_upcoming', { key: curt.key });
		toprow.hide();

		const main = uiu.qs('.main');
		uiu.empty(main);
		main.classList.add('main_upcoming');

		render_upcoming_bts(main);
		main.addEventListener('click', () => {
			fullscreen.toggle();
		});
	}
	_route_single(/t\/([a-z0-9]+)\/bts_upcoming/, ui_upcoming_bts, change.default_handler(_update_all_ui_elements_upcoming, {
		score: update_score,
		court_current_match: update_upcoming_current_match,
		match_edit: update_upcoming_match,
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
		const s = calc.remote_state(pseudo_state, setup, match.presses);
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
		update_match,
		update_upcoming_match,
		btp_status_changed,
		ticker_status_changed,
		bts_status_changed,
		remove_normalization,
		add_normalization,
		
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
