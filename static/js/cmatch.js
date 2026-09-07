'use strict';

var cmatch = (function() {

var has_resize_event = false;
var scroll_timer = setTimeout(auto_scroll, 4000);
var scroll_down = true;
let is_paused = false;

const OVERRIDE_COLORS_KEYS = ['', 'bg'];

function _network_score_str(netscore) {
	if (!netscore) {
		return '';
	}
	return netscore.map(game => game[0] + ':' + game[1]).join(' ');
}

function calc_score_str(match) {
	if (match && match.score_status === 'no_match') {
		return ci18n('match:edit:result_status:no_match');
	}
	if (match && match.score_status && match.score_status !== 'normal') {
		const score = _network_score_str(match.score_status_network_score || match.network_score);
		const status = ci18n('match:edit:result_status:' + match.score_status);
		return score ? score + ' ' + status : status;
	}
	return _network_score_str(match.network_score);
}

function calc_section(m) {
	if (typeof m.team1_won === 'boolean') {
		return 'finished';
	}
	if (m.setup.court_id && m.setup.now_on_court) {
		return 'court_' + m.setup.court_id;
	}
	return 'unassigned';
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

function get_bts_today_scheduled_date() {
	const time_zone = (curt && curt.system_timezone) || 'Europe/Berlin';
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: time_zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date(get_effective_test_clock_now_ms()));
}

function is_match_scheduled_for_bts_today(match) {
	return !!(match && match.setup && match.setup.scheduled_date)
		&& match.setup.scheduled_date === get_bts_today_scheduled_date();
}

function should_limit_upcoming_matches_to_bts_today() {
	return !!(curt && curt.upcoming_matches_today_only_enabled);
}

function resolve_match_court(match, court) {
	if (court) {
		return court;
	}
	if (!match || !match.setup || !match.setup.court_id || !curt) {
		return null;
	}
	return (curt.courts_by_id && curt.courts_by_id[match.setup.court_id])
		|| utils.find(curt.courts || [], (c) => c._id == match.setup.court_id)
		|| null;
}

function auto_scroll() {
	if (is_paused) {
		return;
	}

	const scroll_speed = parseInt((curt && curt.upcoming_matches_animation_speed) ? curt.upcoming_matches_animation_speed : 2);
	if (scroll_speed == 0) {
		return;
	}

	const scroll_object = document.querySelectorAll('.main_upcoming');
	let new_top = 0;
	let height = 0;
	let child_higth = 0;
	
	scroll_object.forEach((item) =>{

		let old_top = 0;
		if(item.style.top) {
			old_top = parseInt(item.style.top);
		}

		if(scroll_down) {
			item.style.top = (old_top - scroll_speed)+'px';
		} else {
			item.style.top = (old_top + scroll_speed)+'px';
		}

		new_top = parseInt(item.style.top);

		for (const child of item.children) {
			child_higth += child.offsetHeight;
		}

		height = item.offsetHeight;
	});

	if(new_top >= 0) {
		scroll_down = true;
		pause_scroll(); 
	} else if (height >= child_higth) {
		scroll_down = false;
		pause_scroll(); 
	}

	requestAnimationFrame(auto_scroll); // Verwendet eine gleichmäßige Animation
}
function pause_scroll() {
	is_paused = true;
	setTimeout(() => {
		is_paused = false;
		auto_scroll();
	}, parseInt((curt && curt.upcoming_matches_animation_pause) ? curt.upcoming_matches_animation_pause : 4) * 1000);
}

function resize_table(resizable_rows, table_width_factor) {
	resizable_rows.forEach((row) => {
		row.fixed_width_elements.forEach((item, index) => {
			auto_size(item, row.fixed_width[index]);
		});
	});
	
	resizable_rows.forEach((row) => {
		let fixed_size = 0;

		for (const child of row.tr.children) {
			if(!row.variable_width_elements.includes(child)) {
				fixed_size += child.offsetWidth;
			}
		}

		let width_factor_sum = 0;
		for(const width_factor of row.variable_width_factor) {
			width_factor_sum += width_factor;
		}

		row.variable_width_elements.forEach((item, index) => {
			resizable_auto_size(item, row.variable_width_factor[index] / width_factor_sum, fixed_size, table_width_factor);
		});

	});
}

function resizable_auto_size(parrent_el, factor, fixed_size, table_width_factor) {
	parrent_el.classList.add("auto_size_parrent");
	parrent_el.style.width = (table_width_factor *  window.innerWidth - fixed_size) * factor + 'px';
	parrent_el.setAttribute('resize_factor', factor);
	parrent_el.setAttribute('fixed_size', fixed_size);
	parrent_el.setAttribute('table_width_factor', table_width_factor);
	
	auto_size(parrent_el, (table_width_factor * window.innerWidth - fixed_size) * factor);

	if(!has_resize_event) {
		window.addEventListener('resize', (ev) => {
			const resize_parrents = document.querySelectorAll('.auto_size_parrent');
			resize_parrents.forEach((item) => {

				const factor = item.getAttribute('resize_factor');
				const fixed_size = item.getAttribute('fixed_size');
				const table_width_factor = item.getAttribute('table_width_factor');

				item.style.width = (table_width_factor *  window.innerWidth - fixed_size) * factor + 'px';
				auto_size(item, (table_width_factor * window.innerWidth - fixed_size) * factor);
			});
		});
		
		has_resize_event = true;
	}

}


function auto_size(parrent_el, parrent_width)	{	
	if(!parrent_width) {
		parrent_width = parrent_el.clientWidth;
	}

	var child_width = 0;
	for(const child of parrent_el.children) {
		child_width += child.offsetWidth + 10;
	}

	for(const child of parrent_el.children) {
		var style = window.getComputedStyle(child, null).getPropertyValue('font-size');
		var fontSize = parseFloat(style);
		if(!child.hasAttribute('original_font_size')){
			child.setAttribute('original_font_size', fontSize);
		}

		const originalFontSize = child.getAttribute('original_font_size');

		child.style.fontSize = Math.min(((fontSize + 1) * parrent_width/child_width), originalFontSize) + 'px';
	}

	/*
	if(!has_resize_event) {
		window.addEventListener('resize', (ev) => {
			const resize_parrents = document.querySelectorAll('.auto_size_parrent');
			resize_parrents.forEach((item) => {
				auto_size(item);
			});
		});
		
		has_resize_event = true;
	}
	*/
}


function render_match_table_header(table) {
	const thead = uiu.el(table, 'thead');
	const title_tr = uiu.el(thead, 'tr');
	uiu.el(title_tr, 'th');
	uiu.el(title_tr, 'th', {}, ci18n('Court'));
	uiu.el(title_tr, 'th', 'match_num', '#');
	uiu.el(title_tr, 'th', {}, ci18n('Match'));
	uiu.el(title_tr, 'th', {
		class: ('players'),
		colspan: 3,
	}, ci18n('Players'));
	uiu.el(title_tr, 'th', {}, ci18n('Umpire'));
	uiu.el(title_tr, 'th', {}, '');
	uiu.el(title_tr, 'th', {}, '');
}

function render_match_row(tr, match, court, style, show_player_status, show_add_tabletoperator) {	
	var resizable_elements = {	tr: tr,
								variable_width_elements : [],
								variable_width_factor: [],
								fixed_width_elements: [],
								fixed_width: []};

	if(!match.setup.is_match) {
		return;
	}

	court = resolve_match_court(match, court);
	if (style === 'unasigned') {
		court = null;
	}

	const completeMatch = (match.setup.teams[0].players.length >= 1 && match.setup.teams[1].players.length >= 1);

	if (style === 'unasigned') {
		if(completeMatch){
			tr.setAttribute('draggable', 'true');
			tr.addEventListener("dragstart", drag);
			tr.addEventListener("dragend", dragend);
			tr.classList.add('complete');
		}
	}

	//if(! completeMatch) {
	//	tr.classList.add('incomplete');
	//}

	const waitForMatchStart = 	match.setup.called_timestamp && 
							(	match.network_score == undefined ||
								( 	match.network_score[0] && 
									(match.network_score[0][0] + match.network_score[0][1] < 1)
								)
							);
	const activeMatch = court && match.btp_winner != undefined;
	const setup = match.setup;
	tr.classList.toggle('preparation_call_deferred', setup.preparation_call_deferred === true);

	tr.setAttribute('data-match_id', match._id);
	tr.setAttribute('data-style', style);

	if (style === 'default' || style === 'plain' || style === 'unasigned') {
		const actions_td = uiu.el(tr, 'td', 'actions');
		create_match_button(actions_td, 'vlink match_edit_button', 'match:edit', on_edit_button_click, match._id);
		if(completeMatch) {
			create_match_button(actions_td, 'vlink match_scoresheet_button', 'match:scoresheet', on_scoresheet_button_click, match._id);
		}
		uiu.el(actions_td, 'a', {
			'class': 'match_rawinfo',
			'title': ci18n('match:rawinfo'),
			'href': '/h/' + encodeURIComponent(curt.key) + '/m/' + encodeURIComponent(match._id) + '/info',
		});
	}

	if (style === 'default' || style === 'unasigned') {
		const court_number_td = uiu.el(tr, 'td','court_number');
		if(court) {
			uiu.el(court_number_td, 'span', 'court_history', court.num);
		} else if (match.setup.location_id){
			const location = utils.find(curt.locations, l => l._id === match.setup.location_id);
			uiu.el(court_number_td, 'span', 'location', "[" + (location?.short_name || location?.name || match.setup.location_id) + "]");
		} 

		if(match.setup.location_id) {
			tr.setAttribute('data-location_id', match.setup.location_id);
		} else {
			tr.removeAttribute('data-location_id');
		}

		if (match.setup.location_id && !(window.localStorage.getItem('show_location_courts_' + match.setup.location_id) !== 'false')) {
			tr.classList.add('do_not_show');
		} else {
			tr.classList.remove('do_not_show');
		}
	}


	if (style === 'plain') {
		const court_number_td = uiu.el(tr, "td", 'court_number');
		if(!court)
			console.warn('no court');
		if(court.is_active) {
			create_court_button(court_number_td, 'court_num', 'inactivate_court', on_inactivate_court_button_click, court._id, court.num);
		} else {
			create_court_button(court_number_td, 'court_inactive', 'activate_court', on_activate_court_button_click, court._id, '');
		}
	}

	if(style === 'public') {
		const court_number_td = uiu.el(tr, "td", {'class':'court_number', "data-court_id":court._id});
		if(court.is_active){
			uiu.el(court_number_td, "div", 'court_num', court.num);
		} else {
			uiu.el(court_number_td, "div", 'court_inactive', "");
		}
	}

	if (style === 'default' || style === 'plain' || style === 'unasigned') {
		const match_str = (setup.scheduled_time_str ? (setup.scheduled_time_str + ' ') : '') + (setup.match_name ? (setup.match_name + ' ') : '') + setup.event_name;
		uiu.el(tr, 'td', 'match_num', setup.match_num);
		const match_properties_td = uiu.el(tr, 'td', 'match_properties', match_str);
		if(! completeMatch) {
			match_properties_td.classList.add('incomplete');
		}
	} else if (style === 'upcoming') {
		const court_number_td = uiu.el(tr, 'td','court_number_upcoming');
		if(court) {
			uiu.el(court_number_td, 'span', 'court_upcoming', court.num);
		}
		uiu.el(tr, 'td', 'match_number_upcoming', `#${setup.match_num}`);
		uiu.el(tr, 'td', 'match_scheduled_upcoming', setup.scheduled_time_str || '');
		const event_td = uiu.el(tr, 'td', 'match_event_upcoming');
		uiu.el(event_td, 'span', 'match_event_upcoming', setup.event_name);
	}
	const players0 = uiu.el(tr, 'td', {
		'class': ((match.team1_won === true) ? 'match_team_won' : 'match_team1'),
		style: 'text-align: right;',
	});

	if(setup.teams[0].players.length < 1) {
		players0.classList.add('incomplete');
	}

	if (style === 'default' || style === 'plain' || style === 'unasigned') {
		if (!show_add_tabletoperator) {
			create_match_button(players0, 'vlink match_second_call_button', 'match:secondcallteamone', on_second_call_team_one_button_click, match._id);
		}

		if(style === 'unasigned' && match.setup.highlight >= 1){
			create_match_button(players0, 'vlink match_second_preparation_call_button', 'match:secondcallteamone', on_second_preparation_call_team_one_button_click, match._id);
		}
	}
	
	render_players_el(players0, setup, 0, match, show_player_status, style);
	uiu.el(tr, 'td', 'match_vs', 'v');
	const players1 = uiu.el(tr, 'td', ((match.team1_won === false) ? 'match_team_won ' : '') + 'match_team2');

	if(setup.teams[1].players.length < 1) {
		players1.classList.add('incomplete');
	}

	render_players_el(players1, setup, 1, match, show_player_status, style);
	if (style === 'default' || style === 'plain' || style === 'unasigned') {
		if(style === 'unasigned' && match.setup.highlight >= 1){
			create_match_button(players1, 'vlink match_second_preparation_call_button', 'match:secondcallteamtwo', on_second_preparation_call_team_two_button_click, match._id);
		}
		
		if (!show_add_tabletoperator) {
			create_match_button(players1, 'vlink match_second_call_button', 'match:secondcallteamtwo', on_second_call_team_two_button_click, match._id);
		}
	}

	if(style === 'public' || style === 'upcoming') {

		if(style === 'upcoming') {
			players0.classList.add('match_team1_upcoming');
			players1.classList.add('match_team2_upcoming');
		} else {
			players0.classList.add('match_team1_public');
			players1.classList.add('match_team2_public');
		}

		resizable_elements.variable_width_elements.push(players0);
		resizable_elements.variable_width_factor.push(1);

		resizable_elements.variable_width_elements.push(players1);
		resizable_elements.variable_width_factor.push(1);
	}

		if(style != 'public') {		
			const to_td = uiu.el(tr, 'td', 'umpire_and_tablet');
			const show_participant_check_in_status = (style === 'unasigned');
			if (style === 'default' || style === 'plain' || style === 'unasigned') {
				if (setup.umpire && setup.umpire.name) {
					const umpire_span = render_match_participant_el(to_td, setup.umpire, match._id, 'umpire', 'umpire', show_participant_check_in_status);

					if (style === 'unasigned' && match.setup.highlight >= 1) {
						create_match_button(umpire_span, 'vlink match_second_preparation_call_button', 'match:secondcallumpire', on_second_preparation_call_umpire_button_click, match._id);
					}
					create_match_button(umpire_span, 'vlink match_second_call_button', 'match:secondcallumpire', on_second_call_umpire_button_click, match._id);

					if (setup.service_judge && setup.service_judge.name) {
						const service_judge_span = render_match_participant_el(to_td, setup.service_judge, match._id, 'service_judge', 'service_judge', show_participant_check_in_status);
						if (style === 'unasigned' && match.setup.highlight >= 1) {
							create_match_button(service_judge_span, 'vlink match_second_preparation_call_button', 'match:secondcallservicejudge', on_second_preparation_call_servicejudge_button_click, match._id);
						}
						create_match_button(service_judge_span, 'vlink match_second_call_button', 'match:secondcallservicejudge', on_second_call_servicejudge_button_click, match._id);
					} else {
						const umpire_icon = umpire_span.querySelector('.umpire');
						if (umpire_icon) {
							umpire_icon.classList.add('can_add_service_judge');
							umpire_icon.setAttribute('title', ci18n('match:add_service_judge'));
							umpire_icon.setAttribute('data-match_id', match._id);
							umpire_icon.addEventListener('click', on_add_service_judge_button);
						}
					}
				}
				if (setup.tabletoperators && setup.tabletoperators.length > 0) {
					const tablet_div = uiu.el(to_td, 'div', 'tablet_operator', '');
					
					const operators_div = uiu.el(tablet_div, 'div', 'operators');
					setup.tabletoperators.forEach((operator) => {
						render_match_participant_el(operators_div, operator, match._id, 'tabletoperator', 'tablet', show_participant_check_in_status);
					});

					if(style === 'unasigned' && match.setup.highlight >= 1){
						create_match_button(tablet_div, 'vlink match_second_preparation_call_button', 'match:secondcaltabletoperator', on_second_preparation_call_tabletoperator_button_click, match._id);
					}

				if (style === 'default' || style === 'plain' || style === 'unasigned') {
					create_match_button(tablet_div, 'vlink match_second_call_button', 'match:secondcaltabletoperator', on_second_call_tabletoperator_button_click, match._id);
				}
			}

			if (!setup.umpire && (!setup.tabletoperators || setup.tabletoperators.length == 0)) {
				const no_umpire_span = uiu.el(to_td, 'span', 'person');
				const no_umpire_button_class = style === 'unasigned' ? 'vlink no_umpire no_umpire_add' : 'vlink no_umpire';
				create_match_button(no_umpire_span, no_umpire_button_class, 'match:add_umpire', on_add_officials_button, match._id);
				uiu.el(no_umpire_span, 'span', 'match_no_umpire', ci18n('No umpire'));
			
			}
		} else if(style === 'upcoming' && setup.highlight >= 1) {
			var preparation_container = uiu.el(to_td, 'div', 'preparation_container'); 
			uiu.el(preparation_container, 'span', 'preparation', 'in Vorbereitung' + (setup.location_id ? "" : "!")); 

			if(setup.location_id) {
        		const l = utils.find(curt.locations, l => l._id === setup.location_id);
        		if(l) {
					uiu.el(preparation_container, 'span', 'preparation', l.preparation_addition); //TODO: Hie die Halle mit ausgeben!
        		}
    		}
			
		}
	}	
		

	if(style != 'upcoming') {
		const score_td = uiu.el(tr, 'td', 'score');
		if(style === 'public') {
			score_td.classList.add('score_public');
		}
	

		const score_span = uiu.el(score_td, 'span', {
			'class': ('match_score' + ((match.setup.now_on_court === true) ? ' match_score_current' : '')),
			'data-match_id': match._id,
		}, calc_score_str(match));
		
		if(style === 'public' && calc_score_str(match) === '') {
			if (setup.umpire && setup.umpire.firstname && setup.umpire.surname) {
				const umpire_icon = uiu.el(score_span, 'div', 'umpire', '');
				const umpire_name_div = uiu.el(score_span, 'div', 'umpire_name_public');
				uiu.el(umpire_name_div, 'span', {}, short_name(setup.umpire.firstname, setup.umpire.surname));
				if (setup.service_judge && setup.service_judge.firstname && setup.service_judge.surname) {
					uiu.el(umpire_name_div, 'span', {}, ' \u200B+ ');
					uiu.el(umpire_name_div, 'span', {}, short_name(setup.service_judge.firstname, setup.service_judge.surname));
				}
			
				let parrent_width = score_span.clientWidth;
				parrent_width -= parseFloat(window.getComputedStyle(score_span, null).getPropertyValue('padding-left'));
				parrent_width -= parseFloat(window.getComputedStyle(score_span, null).getPropertyValue('padding-right'));
			
				//auto_size(umpire_name_div, parrent_width - umpire_icon.offsetWidth - 20);
				resizable_elements.fixed_width_elements.push(umpire_name_div);
				resizable_elements.fixed_width.push(parrent_width - umpire_icon.offsetWidth - 20);
			
			} else if (setup.tabletoperators && setup.tabletoperators.length > 0){
				const tablet_icon = uiu.el(score_span, 'div', 'tablet', '');
				const operators_div = uiu.el(score_span, 'div', 'operators_public')
				uiu.el(operators_div, 'span', 'match_no_umpire', short_name(setup.tabletoperators[0].firstname, setup.tabletoperators[0].lastname, setup.tabletoperators[0].name));
				if (setup.tabletoperators.length > 1) {
					uiu.el(operators_div, 'span', 'match_no_umpire', ' \u200B/ ');
					uiu.el(operators_div, 'span', 'match_no_umpire', short_name(setup.tabletoperators[1].firstname, setup.tabletoperators[1].lastname, setup.tabletoperators[1].name));
				}
			
				let parrent_width = score_span.clientWidth;
				parrent_width -= parseFloat(window.getComputedStyle(score_span, null).getPropertyValue('padding-left'));
				parrent_width -= parseFloat(window.getComputedStyle(score_span, null).getPropertyValue('padding-right'));
			
				//auto_size(operators_div, parrent_width - tablet_icon.offsetWidth - 20);

				resizable_elements.fixed_width_elements.push(operators_div);
				resizable_elements.fixed_width.push(parrent_width - tablet_icon.offsetWidth - 20 - 20);
			}
		}
	}

	if ((style === 'default' || style === 'plain')) {
		const shuttle_td = uiu.el(tr, 'td', {'class': 'match_shuttle_count', 'data-match_id': match._id});
		if(match.shuttle_count) {
			shuttle_td.classList.add('match_shuttle_count_display_active');
		}

		uiu.el(shuttle_td, 'span', {
			'class': (
				'match_shuttle_count_number'
			),
			'data-match_id': match._id,
		}, match.shuttle_count || '');

		const shuttle_image = uiu.el(shuttle_td, 'div', {
			'class' : (
				'match_shuttle_image'
			),
			'data-match_id': match._id});
		if(!match.shuttle_count) {
			shuttle_image.style.display = 'none';
		}
		else {
			shuttle_image.style.display = 'inline-block';
		}
	}

	if ((style === 'default' || style === 'plain' || style === 'unasigned')){
		const timer_td = uiu.el(tr, 'td', {'class': 'match_timer', 'data-match_id': match._id});

		var timer_state = _extract_match_timer_state(match);
		var timer = create_timer(timer_state, timer_td, "#cccccc", "#ff0000");
		if (timer) {
			active_timers.matches[match._id] = timer;
		} else {
			var preparation_timer_state = _extract_preparation_timer_state(match);
			var preparation_timer = create_timer(preparation_timer_state, timer_td, "#cccccc", "#ff0000");
			if (preparation_timer) {
				active_timers.matches[match._id] = preparation_timer;
			}
		}

		if(style == 'plain' && match_scoring.is_match_over(match.network_score, match.setup.scoring_format)) {
			create_match_button(timer_td, 'vlink match_confirm_button', 'Confirm_Finish', on_match_confirm_button_click, match._id);
		}
	}

	if (style === 'default' || style === 'plain' || style === 'unasigned') {
		const call_td = uiu.el(tr, 'td', 'call_td');

		if (style === 'unasigned' && completeMatch && match?.setup?.preparation_call_deferred === true) {
			uiu.el(call_td, 'span', 'preparation_call_deferred_badge', ci18n('match:status:deferred'));
		} else if (style === 'unasigned' && completeMatch) {
			const locations = curt.locations;
			locations.forEach((l)=> {
				if(window.localStorage.getItem('show_location_courts_' + l._id) !== 'false') {
					create_match_prepparation_button(call_td, 'vlink match_preparation_call_button', 'match:preparationcall', on_announce_preparation_matchbutton_click, match._id, l);
				}
			});
		} else if ((style === 'default' || style === 'plain') && court) {
			create_match_button(call_td, 'vlink match_manual_call_button', 'match:manualcall', on_announce_match_manually_button_click, match._id);
			create_match_button(call_td, 'vlink match_begin_to_play_button', 'match:begintoplay', on_begin_to_play_button_click, match._id);
		}
	}

	if(!waitForMatchStart) {
		uiu.qsEach('.match_second_call_button[data-match_id=' + JSON.stringify(match._id) + ']', (button_el) => {
			if(match.setup.now_on_court) {
				button_el.style.visibility = 'hidden';
			} else {
				uiu.hide(button_el);
			}
		});
		uiu.qsEach('.match_begin_to_play_button[data-match_id=' + JSON.stringify(match._id) + ']', (button_el) => {
			if(match.setup.now_on_court) {
				button_el.style.visibility = 'hidden';
			} else {
				uiu.hide(button_el);
			}
		});
		uiu.qsEach('.match_manual_call_button[data-match_id=' + JSON.stringify(match._id) + ']', (button_el) => {
			if (match.setup.now_on_court) {
				button_el.style.visibility = 'hidden';
			} else {
				uiu.hide(button_el);
			}
		});
	}

	return resizable_elements;
}

const on_add_officials_button = (e) => {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'add_officials_to_match',
			tournament_key: curt.key,
			match_id: match._id,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
};

const on_add_service_judge_button = (e) => {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'add_service_judge_to_match',
			tournament_key: curt.key,
			match_id: match._id,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
};

function short_name (first_names, last_name, name) {
	if(first_names && last_name){
		const split_name = first_names.split(" ");
		return split_name[0][0] + '. ' + last_name;
	}
	return name;
}

function create_match_button(targetEl, cssClass, title, listener, matchId,) {
	const btn = uiu.el(targetEl, 'div', {
		'class': cssClass,
		'title': ci18n(title),
		'data-match_id': matchId,
	});
	btn.draggable = false;
	btn.addEventListener('mousedown', function (ev) {
		ev.stopPropagation();
	});
	btn.addEventListener('dragstart', function (ev) {
		ev.preventDefault();
		ev.stopPropagation();
	});
	btn.addEventListener('click', function (ev) {
		ev.stopPropagation();
		listener(ev);
	});
}

function create_match_prepparation_button(targetEl, cssClass, title, listener, matchId, location){
	const btn = uiu.el(targetEl, 'div', {
		'class': cssClass,
		'title': ci18n(title) + (location.preparation_addition ? ' ' + location.preparation_addition : ''),
		'data-match_id': matchId,
		'data-location_id': location._id,
	});

	uiu.el(btn, 'img', {
		style: 'height: 1.2em; margin-top: 0.2em;',
		src: location.logo_id ? '/h/' + encodeURIComponent(curt.key) + '/logo/' + location.logo_id : '/static/icons/preparation.svg',
		name: 'location_logo_img',
		'data-match_id': matchId,
		'data-location_id': location._id
	});

	btn.addEventListener('click', listener);
}

		function _add_match_dom_id(ids, id) {
			if (id === undefined || id === null || id === '') {
				return;
			}
			const value = String(id);
			ids.add(value);
			if (value.startsWith('bts_btp_')) {
				ids.add(value.substring(4));
			} else if (value.startsWith('btp_')) {
				ids.add('bts_' + value);
			}
		}

		function _match_dom_ids(match_or_id) {
			const ids = new Set();
			if (typeof match_or_id === 'string' || typeof match_or_id === 'number') {
				_add_match_dom_id(ids, match_or_id);
				return ids;
			}
			if (!match_or_id) {
				return ids;
			}
			_add_match_dom_id(ids, match_or_id._id);
			_add_match_dom_id(ids, match_or_id.match_id);
			_add_match_dom_id(ids, match_or_id.btp_match_id);
			if (Array.isArray(match_or_id.btp_match_ids)) {
				match_or_id.btp_match_ids.forEach((entry) => {
					if (!entry) return;
					_add_match_dom_id(ids, entry.planning);
					_add_match_dom_id(ids, entry.match_id);
					_add_match_dom_id(ids, entry.id);
				});
			}
			if (match_or_id.setup) {
				_add_match_dom_id(ids, match_or_id.setup.match_id);
				_add_match_dom_id(ids, match_or_id.setup._match_id);
			}
			return ids;
		}

			function _for_each_match_bound_element(selector, match_or_id, cb) {
				const ids = _match_dom_ids(match_or_id);
				uiu.qsEach(selector, function(el) {
					if (ids.has(el.getAttribute('data-match_id'))) {
						cb(el);
				}
			});
		}

		function count_match_score_targets(match_or_id) {
			let count = 0;
			_for_each_match_bound_element('.match_score', match_or_id, function() {
				count += 1;
			});
			return count;
		}

		function count_match_timer_targets(match_or_id) {
			let count = 0;
			_for_each_match_bound_element('.match_timer', match_or_id, function() {
				count += 1;
			});
			return count;
		}

		function update_match_score(m) {
			_for_each_match_bound_element('.match_score', m, function(score_el) {
				uiu.text(score_el, calc_score_str(m));
			});

			_for_each_match_bound_element('.match_timer', m, (timer_td) => {
			while (timer_td.firstChild) {
				timer_td.removeChild(timer_td.lastChild);
			}

		var timer_state = _extract_match_timer_state(m);
		var timer = create_timer(timer_state, timer_td, "#cccccc", "#ff0000");
		if (timer) {
			active_timers.matches[m._id] = timer;
		} else {
			var preparation_timer_state = _extract_preparation_timer_state(m);
			var preparation_timer = create_timer(preparation_timer_state, timer_td, "#cccccc", "#ff0000");
			if (preparation_timer) {
				active_timers.matches[m._id] = preparation_timer;
			}
		}
		
		if (match_scoring.is_match_over(m.network_score, m.setup.scoring_format)) {
			create_match_button(timer_td, 'vlink match_confirm_button', 'Confirm_Finish', on_match_confirm_button_click, m._id);
		}
	});
	
		if(	m.network_score && m.network_score.length > 0 && 
			m.network_score[0].length > 1 && 
			(m.network_score[0][0] > 0 || m.network_score[0][1] > 0) ) {
			_for_each_match_bound_element('.match_second_call_button', m, (button_el) => {
				button_el.style.visibility = 'hidden';
			});
			_for_each_match_bound_element('.match_begin_to_play_button', m, (button_el) => {
				button_el.style.visibility = 'hidden';
			});
			_for_each_match_bound_element('.match_manual_call_button', m, (button_el) => {
				button_el.style.visibility = 'hidden';
			});
		} else {
			_for_each_match_bound_element('.match_second_call_button', m, (button_el) => {
				button_el.style.visibility = 'visible';
			});
			_for_each_match_bound_element('.match_begin_to_play_button', m, (button_el) => {
				button_el.style.visibility = 'visible';
			});
			_for_each_match_bound_element('.match_manual_call_button', m, (button_el) => {
				button_el.style.visibility = 'visible';
			});
		}

		_for_each_match_bound_element('.match_shuttle_count', m, function(el) {
			uiu.setClass(el, 'match_shuttle_count_display_active', !!m.shuttle_count);
		});
		
		_for_each_match_bound_element('.match_shuttle_count_number', m, function(el) {
			uiu.text(el, m.shuttle_count || '');
		});

		_for_each_match_bound_element('.match_shuttle_image', m, function(shuttle_image) {
			if(!m.shuttle_count) {
				shuttle_image.style.display = 'none';
			}
		else {
			shuttle_image.style.display = 'inline-block';
		}
			
	});
}

function on_match_confirm_button_click(e) {
	const match_id = e.target.getAttribute('data-match_id');
	const match = utils.find(curt.matches, m => m._id === match_id);
	if (match) {
		send({
			type: 'confirm_match_finished',
			match_id: match_id,
			tournament_key: match.tournament_key,
			court_id: match.setup.court_id
		}, function (err) {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function _get_match_planning_id(match) {
	return match && match.btp_match_ids && match.btp_match_ids[0] ? match.btp_match_ids[0].planning : null;
}

function _same_dependency_pair(links_a, links_b) {
	if (!links_a || !links_b) {
		return false;
	}
	return links_a.from1 == links_b.from1 && links_a.from2 == links_b.from2;
}

function _get_source_planning_for_team(match, team_id) {
	const links = match && match.setup ? match.setup.links : null;
	if (!links) {
		return null;
	}
	return team_id === 0 ? links.from1 : links.from2;
}

function _find_direct_predecessor_match(match, team_id, matches) {
	const source_planning = _get_source_planning_for_team(match, team_id);
	if (source_planning == null) {
		return null;
	}
	const source_candidates = (matches || []).filter((candidate) => {
		if (!candidate || candidate._id === match._id || !candidate.setup) {
			return false;
		}
		return _get_match_planning_id(candidate) == source_planning;
	});

	const direct_match = utils.find(source_candidates, (candidate) => candidate.setup.is_match);
	if (direct_match) {
		return direct_match;
	}

	const placeholder = source_candidates[0];
	if (!placeholder || !placeholder.setup || !placeholder.setup.links) {
		return null;
	}

	return utils.find(matches || [], (candidate) => {
		if (!candidate || candidate._id === match._id || !candidate.setup || !candidate.setup.is_match) {
			return false;
		}
		return _same_dependency_pair(candidate.setup.links, placeholder.setup.links);
	}) || null;
}

function _find_matches_feeding_planning(source_planning, matches) {
	if (source_planning == null) {
		return [];
	}
	const seen = new Set();
	const incoming = [];
	(matches || []).forEach((candidate) => {
		if (!candidate || !candidate._id || !candidate.setup || !candidate.setup.is_match || !candidate.setup.links) {
			return;
		}
		let relation = null;
		if (candidate.setup.links.winner_to == source_planning) {
			relation = 'Winner';
		} else if (candidate.setup.links.loser_to == source_planning) {
			relation = 'Loser';
		}
		if (!relation || seen.has(candidate._id)) {
			return;
		}
		seen.add(candidate._id);
		incoming.push({ match: candidate, relation });
	});
	return incoming;
}

function _format_dependency_from_incoming_edges(source_planning, matches) {
	const incoming = _find_matches_feeding_planning(source_planning, matches);
	if (incoming.length === 0) {
		return null;
	}
	if (incoming.length > 1) {
		const unique_relations = [...new Set(incoming.map((entry) => entry.relation))];
		const incoming_plannings = incoming
			.map((entry) => _get_match_planning_id(entry.match))
			.filter((planning) => planning != null);
		if (unique_relations.length === 1 && incoming_plannings.length === incoming.length) {
			const consolidation_match = utils.find(matches || [], (candidate) => {
				if (!candidate || !candidate.setup || !candidate.setup.is_match || !candidate.setup.links) {
					return false;
				}
				const candidate_sources = [candidate.setup.links.from1, candidate.setup.links.from2];
				return incoming_plannings.every((planning) => candidate_sources.includes(planning));
			});
			if (consolidation_match) {
				return ci18n(unique_relations[0]) + " #" + consolidation_match.setup.match_num + " - " + consolidation_match.setup.scheduled_date + " " + consolidation_match.setup.scheduled_time_str;
			}
		}
	}
	if (incoming.length === 1) {
		const entry = incoming[0];
		return ci18n(entry.relation) + " #" + entry.match.setup.match_num + " - " + entry.match.setup.scheduled_date + " " + entry.match.setup.scheduled_time_str;
	}

	const unique_relations = [...new Set(incoming.map((entry) => entry.relation))];
	const match_refs = incoming
		.map((entry) => "#" + entry.match.setup.match_num)
		.sort((a, b) => cbts_utils.cmp(a, b));
	if (unique_relations.length === 1) {
		return ci18n(unique_relations[0]) + " " + match_refs.join(' / ');
	}
	return match_refs.join(' / ');
}

function _format_participant_dependency(match, team_id, matches) {
	const links = match && match.setup ? match.setup.links : null;
	if (!links) {
		return '???';
	}

	const direct_link_label = team_id === 0 ? links.from1_link : links.from2_link;
	if (direct_link_label) {
		return direct_link_label;
	}

	const predecessor = _find_direct_predecessor_match(match, team_id, matches);
	if (predecessor && predecessor.setup && predecessor.setup.links) {
		const current_planning = _get_match_planning_id(match);
		if (current_planning != null && predecessor.setup.links.winner_to == current_planning) {
			return ci18n('Winner') + " #" + predecessor.setup.match_num + " - " + predecessor.setup.scheduled_date + " " + predecessor.setup.scheduled_time_str;
		}
		if (current_planning != null && predecessor.setup.links.loser_to == current_planning) {
			return ci18n('Loser') + " #" + predecessor.setup.match_num + " - " + predecessor.setup.scheduled_date + " " + predecessor.setup.scheduled_time_str;
		}
	}
	const source_planning = _get_source_planning_for_team(match, team_id);
	const incoming_dependency = _format_dependency_from_incoming_edges(source_planning, matches);
	if (incoming_dependency) {
		return incoming_dependency;
	}
	return '???';
}

function render_players_el(parentNode, setup, team_id, match, show_player_status, style) {
	const team = setup.teams[team_id];

	const nat0 = team.players[0] && team.players[0].nationality;
	if (curt.is_nation_competition && nat0) {
		cflags.render_flag_el(parentNode, nat0);
	}

	if (team.players.length > 0) {
		if(team.entry_status !== "<none>"){
			uiu.el(parentNode, 'span', {}, team.entry_status);
		}
		render_player_el(parentNode, team.players[0], match._id, setup.now_on_court, show_player_status, style, team.players.length > 1 ? true : false);
	} else {
		const dependency = _format_participant_dependency(match, team_id, curt.matches);
		uiu.el(parentNode, 'span', {}, dependency);
	}

	if (team.players.length > 1) {
		uiu.el(parentNode, 'span', {}, ' / ');

		const nat1 = team.players[1] && team.players[1].nationality;
		const p1_el = uiu.el(parentNode, 'span', {
			'style': 'white-space: pre',
		});
		if (curt.is_nation_competition && nat1 && (nat1 !== nat0)) {
			cflags.render_flag_el(p1_el, nat1);
		}

		render_player_el(parentNode, team.players[1], match._id, setup.now_on_court, show_player_status, style, true);	
	}
}

function render_match_participant_el(parentNode, participant, match_id, role, icon_class, show_check_in_status = true) {
	const technical_official_check_in_locked =
		(role === 'umpire' || role === 'service_judge') &&
		curt &&
		curt.btp_settings &&
		curt.btp_settings.check_in_per_match === false;
	const participant_checked_in = technical_official_check_in_locked ? true : !!(participant && participant.checked_in);
	const participant_status = show_check_in_status && participant_checked_in ? 'checked_in' : (show_check_in_status ? 'not_checked_in' : 'no_status');
	const participant_el = uiu.el(parentNode, 'span', {
		'class': 'person ' + participant_status,
		'data-btp_id': participant.btp_id,
		'data-match_id': match_id,
	}, participant.name || short_name(participant.firstname, participant.lastname || participant.surname, participant.name));

	participant_el.innerHTML = '';
	uiu.el(participant_el, 'div', icon_class, '');
	const name_el = uiu.el(participant_el, 'span', 'name', participant.name || short_name(participant.firstname, participant.lastname || participant.surname, participant.name));

	if (show_check_in_status && participant.btp_id != null && participant.btp_id >= 0 && !technical_official_check_in_locked) {
		if (participant_status === 'checked_in') {
			participant_el.classList.add('can_check_out');
		} else {
			participant_el.classList.add('can_check_in');
		}

		name_el.classList.add('person_status_target');
		name_el.addEventListener('click', function(ev) {
			send({
				type: 'match_participant_check_in',
				match_id,
				role,
				participant_id: participant.btp_id,
				checked_in: participant_status === 'not_checked_in',
				tournament_key: curt.key
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
			});
			ev.stopPropagation();
			ev.preventDefault();
		}, false);
	}

	return participant_el;
}

function render_player_el(parentNode, player, match_id, now_on_court, show_player_status, style, is_doubles) {
	let player_status = get_player_status(player, now_on_court, show_player_status);
	const player_check_in_locked = is_player_check_in_locked(player);
	const tablet_court = active_tabletoperator_court_for_player(player);
	const player_name = (style === 'public' || style === 'upcoming' && is_doubles) ?  short_name(player.firstname, player.lastname) : player.name;
	let player_element = uiu.el(parentNode, 'span', {
		'class' : 'person player ' + player_status + (style === 'public' || style === 'upcoming' ? '_public' : ''),
		'data-btp_id' : player.btp_id, 
		'data-match_id': match_id,
	}, player_name.replace(' ', '\xa0'));

	if(player.check_in_per_match && !player_check_in_locked) {
		if(player_status == "checked_in") {
			player_element.classList.add("can_check_out");
		} else if (player_status == "not_checked_in") {
			player_element.classList.add("can_check_in");
		}
	}


	player_element.addEventListener("click", (ev) => {
		if(curt.btp_settings.check_in_per_match && !player_check_in_locked) {
			send({
				type: 'match_player_check_in',
				match_id,
				player_id: player.btp_id,
				checked_in: (player_status == "not_checked_in"),
				tournament_key: curt.key
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
			});
		}
		ev.stopPropagation();
		ev.preventDefault();
	}, false);


	if ((player.now_playing_on_court && player_status != "now_on_court") && player_status != "no_status") {
		let parts = player.now_playing_on_court.split("_");
		let court_number = parts[parts.length - 1];
		uiu.el(player_element, 'div', 'court', court_number);
	}

	if(tablet_court) {
		let parts = tablet_court.split("_");
		let court_number = parts[parts.length - 1];
		uiu.el(player_element, 'div', 'tablet_inline', court_number);
	}

	if(is_player_waiting_as_tabletoperator(player)) {
		uiu.el(player_element, 'div', 'tabletoperator_waiting_inline', '');
	}

	if(show_player_status && player_status != "now_on_court") {
		var timer_state = _extract_player_timer_state(player);
		var timer = create_timer(timer_state, player_element, "#ffffff", "#ffffff");
	}
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

function active_tabletoperator_court_for_player(player) {
	if (!player) {
		return false;
	}
	const player_btp_id = player.btp_id;
	if (player_btp_id != null && Array.isArray(curt && curt.matches)) {
		for (const match of curt.matches) {
			const setup = match && match.setup;
			if (!setup || !Array.isArray(setup.tabletoperators)) {
				continue;
			}
			for (const operator of setup.tabletoperators) {
				if (operator && String(operator.btp_id) === String(player_btp_id) && operator.now_tablet_on_court) {
					return operator.now_tablet_on_court;
				}
			}
		}
	}
	return player.now_tablet_on_court || false;
}

function is_player_check_in_locked(player) {
	return !!(player && (active_tabletoperator_court_for_player(player) || is_player_waiting_as_tabletoperator(player)));
}

function get_player_status(player, now_on_court, show_player_status) {
	let player_status = "";
	if (!show_player_status) {
		player_status = "no_status";
	} else if(now_on_court) {
		player_status = "now_on_court";
	} else if (player.now_playing_on_court) {
		player_status = "now_playing";
	} else if (player.checked_in) {
		player_status = "checked_in";
	} else {
		player_status = "not_checked_in";
	}

	

	return player_status;
}

function update_players(m) {
	if(m.setup.teams) {
		m.setup.teams.forEach((team) => {
			if(team.players) {
				team.players.forEach((player) => {
					update_player(m._id, player, m.setup.now_on_court, m.btp_winner === undefined);
				});
			}
		});
	}

}

function update_player(match_id, player, now_on_court, show_player_status) {
	const player_btp_id = player && player.btp_id;
	if (player_btp_id == null) {
		return;
	}
	const tablet_court = active_tabletoperator_court_for_player(player);
	uiu.qsEach('.player[data-match_id=' + JSON.stringify(match_id) + ']', function(player_el) {
		if (String(player_el.getAttribute('data-btp_id')) !== String(player_btp_id)) {
			return;
		}
		let player_status = get_player_status(player, now_on_court, show_player_status);
		const player_check_in_locked = is_player_check_in_locked(player);

		player_el.classList.remove("now_on_court", "now_playing", "checked_in", "not_checked_in", "no_status", "can_check_out", "can_check_in");
		player_el.classList.add(player_status);
		if(player.check_in_per_match && !player_check_in_locked) {
			if(player_status == "checked_in") {
				player_el.classList.add("can_check_out");
			} else if (player_status == "not_checked_in") {
				player_el.classList.add("can_check_in");
			}
		}

		//The only Child should be the now_playing_on_court icon or the now_tablet_on_court icon
		while (player_el.firstElementChild) {
			player_el.removeChild(player_el.lastElementChild);
		}

		if ((player.now_playing_on_court && player_status != "now_on_court") && player_status != "no_status") {
			let parts = player.now_playing_on_court.split("_");
			let court_number = parts[parts.length - 1];
			uiu.el(player_el, 'div', 'court', court_number);
		}
	
		if(tablet_court) {
			let parts = tablet_court.split("_");
			let court_number = parts[parts.length - 1];
			uiu.el(player_el, 'div', 'tablet_inline', court_number);
		}

		if(is_player_waiting_as_tabletoperator(player)) {
			uiu.el(player_el, 'div', 'tabletoperator_waiting_inline', '');
		}

		if(show_player_status && player_status != "now_on_court") {
			var timer_state = _extract_player_timer_state(player);
			var timer = create_timer(timer_state, player_el, "#ffffff", "#ffffff");
		}

	});
}

function update_all_player_status_indicators() {
	if (!Array.isArray(curt && curt.matches)) {
		return;
	}
	curt.matches.forEach((match) => {
		if (match && match.setup) {
			update_players(match);
		}
	});
}

	function remove_match_from_gui(m, old_section) {
		switch (old_section) {
			case 'finished':
			case 'unassigned':
				uiu.qsEach('.match[data-match_id=' + JSON.stringify(m._id) + ']', (match_row_el) => {
					match_row_el.remove();
				});
				break;
			default:
				const old_court_id = old_section.slice(6, old_section.length);
				const old_court = utils.find(curt.courts, c => c._id === old_court_id);
				const main_container = document.getElementsByClassName('main_upcoming');
				if (main_container.length > 0){
					uiu.qsEach('.court_row[data-court_id=' + JSON.stringify(old_court_id) + ']', (match_row_el) => {
						match_row_el.innerHTML = "";
						render_empty_court_row(match_row_el, old_court, 'public', false);
					});
				} else {
					uiu.qsEach('.court_row[data-court_id=' + JSON.stringify(old_court_id) + ']', (match_row_el) => {
						match_row_el.innerHTML = "";
						render_empty_court_row(match_row_el, old_court, 'plain', true);
					});
				}
				break;
		}
	}

function add_match(m, section) {
	insert_new_match_row(m, section);
}
	
function insert_new_match_row(m, section) {
	switch (section) {
		case 'finished':
			uiu.qsEach('.finished_container', (finished_container) => {
				const tbody = finished_container.querySelector('.match_table > tbody');
				const match_row_el = uiu.el(tbody, 'tr', {'class' : 'match highlight_' + m.setup.highlight , 'data-match_id': m._id});
				render_match_row(match_row_el, m, null, 'default', false, curt.tabletoperator_enabled);
				for (const child of tbody.children) {
					if (child === match_row_el) {
						continue;
					}
					const child_match = utils.find(curt.matches, m => m._id === child.dataset.match_id);
					if(child_match && cmp_finished_match_order(m, child_match) < 0) {
						tbody.insertBefore(match_row_el, child);
						break;
					}
				}
			});
			break;
		case 'unassigned':
			uiu.qsEach('.unassigned_container', (unassigned_container) => {
				const tbody = unassigned_container.querySelector('.match_table > tbody');
				const match_row_el = uiu.el(tbody, 'tr', {'class' : 'match highlight_' + m.setup.highlight , 'data-match_id': m._id});
				render_match_row(match_row_el, m, null, 'unasigned', true, curt.tabletoperator_enabled);
				for (const child of tbody.children) {
					const child_btp_id = child.dataset.match_id;
					const child_match = utils.find(curt.matches, m => m._id === child_btp_id);
					if(child_match) {
						if(cmp_scheduled_match_order(m, child_match) < 0) {
							tbody.insertBefore(match_row_el, child);
							break;
						}
					}
				}
			});
			break;
		default:
			const court = utils.find(curt.courts, c => c._id === m.setup.court_id);
			uiu.qsEach('.court_row[data-court_id=' + JSON.stringify(m.setup.court_id) + ']', (match_row_el) => {
				match_row_el.innerHTML = "";
				const closest = match_row_el.closest('.main_upcoming');
				if(Boolean(closest)) {
					render_match_row(match_row_el, m, court, 'public', );
				} else {
					render_match_row(match_row_el, m, court, 'plain', false, false);
				}
			});
			break;
	}
}

function update_match_row(m, new_section) {
	uiu.qsEach('tr[data-match_id=' + JSON.stringify(m._id) + ']', (match_row_el) => {
		match_row_el.innerHTML = '';
		
		switch (new_section) {
			case 'finished':
				render_match_row(match_row_el, m, null, 'default', false, curt.tabletoperator_enabled);
				reorder_finished_match_row(m);
				break;
			case 'unassigned':
				match_row_el.setAttribute('class', 'match highlight_' + (m.setup.highlight ? m.setup.highlight : 0));
				render_match_row(match_row_el, m, null, 'unasigned', true, curt.tabletoperator_enabled);
				break;
			default:
				const court = utils.find(curt.courts, c => c._id === m.setup.court_id);	
				const closest = match_row_el.closest('.main_upcoming');
				if(Boolean(closest)) {
					render_match_row(match_row_el, m, court, 'public');
				} else {
					render_match_row(match_row_el, m, court, 'plain', false, false);
				}
				break;
		}
	});
}

function reorder_finished_match_row(m) {
	uiu.qsEach('.finished_container .match_table > tbody', (tbody) => {
		const match_row_el = tbody.querySelector('.match[data-match_id=' + JSON.stringify(m._id) + ']');
		if (!match_row_el) {
			return;
		}
		for (const child of tbody.children) {
			if (child === match_row_el) {
				continue;
			}
			const child_match = utils.find(curt.matches, candidate => candidate._id === child.dataset.match_id);
			if (child_match && cmp_finished_match_order(m, child_match) < 0) {
				tbody.insertBefore(match_row_el, child);
				return;
			}
		}
		tbody.appendChild(match_row_el);
	});
}

function update_match(m, old_section, new_section) {	
	if(old_section != new_section) {
		remove_match_from_gui(m, old_section);
		insert_new_match_row(m, new_section);
	} else {
		update_match_row(m, new_section);
	}
	refresh_unassigned_status_context();
}

var active_timers = {'matches': {}, 'players' : {}};

function create_timer(timer_state, parent, default_color, exigent_color) {
	
	if (!timer_state) {
		return;
	}

	var tv = timer.calc(timer_state, get_effective_test_clock_now_ms());
		
	if(!tv || !tv.visible){
		return;
	}


	var bgColor = timer_state.bgColor;
	let el = uiu.el(parent, 'div', { class: 'timer', style: ('background-color:' + bgColor +'; color:' + default_color +';')}, tv.str);
	
	var tobj = {};
	var has_been_attached = false;

	var clear_pending_update = function() {
		if (tobj.timeout != null) {
			clearTimeout(tobj.timeout);
			tobj.timeout = null;
		}
	};

	var update = function() {
		const is_attached = document.body.contains(el);
		if (is_attached) {
			has_been_attached = true;
		} else if (has_been_attached) {
			clear_pending_update();
			return;
		}

		var tv = timer.calc(timer_state, get_effective_test_clock_now_ms());
		if (!tv) {
			clear_pending_update();
			el.style.display = "none";
			return;
		}

		var visible = tv.visible;

		uiu.text (el, tv.str);
		el.style.color = (tv.exigent && exigent_color) ? exigent_color : default_color;

		clear_pending_update();
		if (visible) {
			const requested_delay = Number(tv.next);
			const next_delay = Number.isFinite(requested_delay)
				? Math.max(250, Math.min(1000, requested_delay))
				: 1000;
			tobj.timeout = setTimeout(update, next_delay);
			el.style.display = "inline-block";
		} else {
			el.style.display = "none";
		}
	};

	update();

	return tobj;
}

function _extract_player_timer_state(player) {
	let s = {};
	s.settings = {};
	s.settings.negative_timers = false;
	s.lang = "de";
	s.timer = {};
	s.timer.duration = (curt &&  curt.btp_settings && curt.btp_settings.pause_duration_ms) ? curt.btp_settings.pause_duration_ms : 0;
	s.timer.start = (player.last_time_on_court_ts ? player.last_time_on_court_ts : false);
	s.timer.upwards = false;
	s.timer.exigent = false;

	if (player.tablet_break_active) {
		s.bgColor = "#0000ff";
	} else {
		s.bgColor = "#ff0000";
	}
	
	return s;
}

function _extract_preparation_timer_state(match) {
	if (!match || !match.setup) {
		return null;
	}
	if (match.setup.state !== 'preparation') {
		return null;
	}
	if (!match.setup.highlight || match.setup.highlight <= 0) {
		return null;
	}
	if (!match.setup.preparation_call_timestamp) {
		return null;
	}

	let s = {};
	s.settings = {};
	s.settings.negative_timers = false;
	s.lang = "de";
	s.timer = {};
	s.timer.start = match.setup.preparation_call_timestamp;
	s.timer.upwards = true;
	s.timer.exigent = false;
	s.bgColor = "#00000033";
	return s;
}

function _extract_match_timer_state(match) {
	var presses = match.presses;

	let s = {};
	s.settings = {};
	s.settings.negative_timers = true;
	s.lang = (curt && curt.btp_settings && curt.btp_settings.language && curt.btp_settings.language !== 'auto') ? curt.btp_settings.language : "de";

	try {
		return calc.remote_state(s, match.setup, presses);
	} catch (err) {
		const label = match && match.setup && match.setup.match_num ? `#${match.setup.match_num}` : (match && match._id ? match._id : '<unknown>');
		console.error(`[bts] calc.remote_state failed for ${label}`, err);
		if (typeof cerror !== 'undefined' && cerror && cerror.silent) {
			cerror.silent(`Timer state for ${label} could not be calculated: ${err.message}`);
		}
		return false;
	}
}

function cmp_scheduled_match_order(m1, m2) {
	const time_str1 = m1.setup.scheduled_time_str;
	const time_str2 = m2.setup.scheduled_time_str;

	if (time_str1 && !time_str2) {
		return -1;
	} else if (time_str2 && !time_str1) {
		return 1;
	}

	const cmp1 = cbts_utils.cmp(m1.setup.scheduled_date, m2.setup.scheduled_date);
	if (cmp1 != 0) return cmp1;
	
	if (time_str1 === '00:00' && time_str2 === '00:00') {
		return cbts_utils.cmp(m1.setup.match_num, m2.setup.match_num);
	} else if (time_str1 === '00:00' && time_str2 !== '00:00') {
		return 1;
	} else if (time_str2 === '00:00' && time_str1 !== '00:00') {
		return -1;
	}

	const cmp2 = cbts_utils.cmp(time_str1, time_str2);
	if (cmp2 != 0) return cmp2;

	if ((m1.match_order !== undefined) && (m2.match_order !== undefined)) {
		const cmp_result = cbts_utils.cmp(m1.match_order, m2.match_order);
		if (cmp_result != 0) return cmp_result;
	}

	return cbts_utils.cmp(m1.setup.match_num, m2.setup.match_num);
}

function get_finished_sort_ts(m) {
	const end_ts = Number(m && m.end_ts);
	if (Number.isFinite(end_ts) && end_ts > 0) {
		return end_ts;
	}
	return zoned_time_to_utc_timestamp(m.setup.scheduled_date, m.setup.scheduled_time_str, 'Europe/Berlin');
}

function cmp_finished_match_order(m1, m2) {
	const ts_diff = get_finished_sort_ts(m2) - get_finished_sort_ts(m1);
	if (ts_diff !== 0) {
		return ts_diff;
	}
	return cmp_scheduled_match_order(m2, m1);
}

function prepare_render(t) {
	t.matches.sort((m1, m2) => {return cmp_scheduled_match_order(m1, m2)});

	t.courts_by_id = {};
	for (const c of t.courts) {
		t.courts_by_id[c._id] = c;
	}
}

function on_edit_button_click(e) {
	const btn = e.target;
	const match_id = btn.getAttribute('data-match_id');
	ui_edit(match_id);
}

function on_scoresheet_button_click(e) {
	const btn = e.target;
	const match_id = btn.getAttribute('data-match_id');
	ui_scoresheet(match_id);
}
function on_announce_preparation_matchbutton_click(e) {
	const match = fetchMatchFromEvent(e);
	const location = fetchLocationFromEvent(e);

	if (match != null && location != null) {
		send({
			type: 'match_preparation_call',
			match: match,
			location_id : location._id,
			tournament_key: match.tournament_key,
		}, function (err) {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}
function on_second_call_team_one_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_call_team_one',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}
function on_second_call_team_two_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_call_team_two',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}
function on_second_preparation_call_team_one_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_preparation_call_team_one',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}
function on_second_preparation_call_team_two_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_preparation_call_team_two',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}
function on_second_call_tabletoperator_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_call_tabletoperator',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}	
function on_second_preparation_call_tabletoperator_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_preparation_call_tabletoperator',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function on_second_call_umpire_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_call_umpire',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}


function on_second_preparation_call_umpire_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_preparation_call_umpire',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function on_second_call_servicejudge_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_call_servicejudge',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}


function on_second_preparation_call_servicejudge_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'second_preparation_call_servicejudge',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}



function on_begin_to_play_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'begin_to_play_call',
			tournament_key: curt.key,
			setup: match.setup,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function on_announce_match_manually_button_click(e) {
	const match = fetchMatchFromEvent(e);
	if (match != null) {
		send({
			type: 'announce_match_manually',
			tournament_key: curt.key,
			match: match,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}
function fetchMatchFromEvent(e) {
	const btn = (e.currentTarget && e.currentTarget.getAttribute && e.currentTarget.getAttribute('data-match_id'))
		? e.currentTarget
		: (e.target && e.target.closest ? e.target.closest('[data-match_id]') : null);
	const match_id = btn ? btn.getAttribute('data-match_id') : null;
	const match = utils.find(curt.matches, m => m._id === match_id);
	if (!match) {
		cerror.silent('Match ' + match_id + ' konnte nicht gefunden werden');
		return null;
	} else {
		return match;
	}
}
function fetchLocationFromEvent(e) {
	const btn = e.target;
	const location_id = btn.getAttribute('data-location_id');
	const location = utils.find(curt.locations, l => l._id === location_id);
	if (!location) {
		cerror.silent('Location ' + location_id + ' konnte nicht gefunden werden');
		return null;
	} else {
		return location;
	}
}
function _nation_team_name(nat0, nat1) {
	if (nat1 && nat0 && (nat0 != nat1)) {
		return countries.lookup(nat0) + ' / ' + countries.lookup(nat1);
	}
	if (nat0) {
		return countries.lookup(nat0);
	}
	return '';
}

function _pack_official_for_match_setup(official) {
	if (!official) {
		return official;
	}
	return {
		_id: official._id,
		btp_id: official.btp_id,
		name: official.name,
		firstname: official.firstname,
		surname: official.surname,
		country: official.country,
		is_umpire: !!official.is_umpire,
		is_service_judge: !!official.is_service_judge,
		checked_in: false,
	};
}

function _parse_match_status_form_value(d) {
	const raw_status = d.match_status || (d.now_on_court ? 'on_court' : (d.preparation_location_id ? 'preparation' : 'scheduled'));
	if (raw_status === 'no_match_team1' || raw_status === 'no_match_team2') {
		return {
			status: 'scheduled',
			preparation_location_id: null,
		};
	}
	if (typeof raw_status === 'string' && raw_status.startsWith('preparation:')) {
		return {
			status: 'preparation',
			preparation_location_id: raw_status.slice('preparation:'.length),
		};
	}
	return {
		status: raw_status,
		preparation_location_id: d.preparation_location_id,
	};
}

function _is_dbv_special_result_status(score_status) {
	return score_status === 'retired' || score_status === 'disqualified' || score_status === 'no_match';
}

function _normalize_match_score_status_from_form(score_status) {
	if (score_status === 'no_match_team1' || score_status === 'no_match_team2') {
		return 'no_match';
	}
	return score_status || 'normal';
}

function _no_match_losing_team_from_form(score_status) {
	if (score_status === 'no_match_team1') {
		return 0;
	}
	if (score_status === 'no_match_team2') {
		return 1;
	}
	return null;
}

function _score_status_forwards_loser_from_form(score_status) {
	return _is_dbv_special_result_status(_normalize_match_score_status_from_form(score_status));
}

function _score_status_select_value(match) {
	if ((match.score_status || 'normal') === 'no_match' || (match.score_status || 'normal') === 'walkover') {
		if (match.no_match_losing_team === 0 || match.team1_won === false) {
			return 'no_match_team1';
		}
		if (match.no_match_losing_team === 1 || match.team1_won === true) {
			return 'no_match_team2';
		}
	}
	return match.score_status || 'normal';
}

function _score_status_from_match_status_form(match_status, source_match) {
	if (match_status === 'no_match_team1' || match_status === 'no_match_team2') {
		return match_status;
	}
	const source_score_status = source_match?.score_status || 'normal';
	if (source_score_status === 'no_match' || source_score_status === 'walkover') {
		return 'normal';
	}
	return source_score_status;
}

function _team_status_label(setup, team_index, fallback) {
	const players = Array.isArray(setup?.teams?.[team_index]?.players) ? setup.teams[team_index].players : [];
	const label = players
		.map((player) => [player?.firstname, player?.lastname].filter(Boolean).join(' ').trim())
		.filter(Boolean)
		.join(' / ');
	return label || fallback;
}

function _match_has_played_result_for_manual_btp_stage_status(match) {
	const score_status = match?.score_status || 'normal';
	if (score_status === 'walkover' || score_status === 'no_match') {
		return false;
	}
	if (score_status === 'retired' || score_status === 'disqualified') {
		return Array.isArray(match.score_status_network_score) && match.score_status_network_score.length > 0;
	}
	return !!match?.network_score || !!match?.end_ts || !!match?.setup?.end_ts;
}

function _team_has_prior_played_match_in_event_for_manual_btp_stage_status(source_match, team_index) {
	if (!curt || !Array.isArray(curt.matches)) {
		return false;
	}
	const source_setup = source_match?.setup || {};
	const source_ids = new Set((source_setup.teams?.[team_index]?.players || [])
		.map((player) => player?.btp_id)
		.filter((btp_id) => btp_id != null));
	if (source_ids.size === 0) {
		return false;
	}
	return curt.matches.some((match) => {
		if (!match || match._id === source_match._id || match?.setup?.event_name !== source_setup.event_name) {
			return false;
		}
		const has_team_player = (match.setup?.teams || []).some((team) => (team?.players || [])
			.some((player) => source_ids.has(player?.btp_id)));
		return has_team_player && _match_has_played_result_for_manual_btp_stage_status(match);
	});
}

function _manual_btp_stage_status_target_for_edit(match, raw_status, losing_team_index) {
	if (raw_status !== 'no_match_team1' && raw_status !== 'no_match_team2') {
		return _manual_btp_stage_status_target(match);
	}
	if (_match_has_played_result_for_manual_btp_stage_status(match)) {
		return ci18n('tournament:manual_btp_stage_status:target_wdn');
	}
	return _team_has_prior_played_match_in_event_for_manual_btp_stage_status(match, losing_team_index)
		? ci18n('tournament:manual_btp_stage_status:target_wdn')
		: ci18n('tournament:manual_btp_stage_status:target_dns');
}

function _manual_btp_stage_status_hint(match, raw_status) {
	const losing_team_index = _no_match_losing_team_from_form(raw_status);
	if (losing_team_index == null) {
		return '';
	}
	const setup = match?.setup || {};
	const players = Array.isArray(setup?.teams?.[losing_team_index]?.players)
		? setup.teams[losing_team_index].players
		: [];
	const target_status = _manual_btp_stage_status_target_for_edit(match, raw_status, losing_team_index);
	const all_statuses_done = players.length > 0
		&& players.every((player) => _player_has_done_btp_stage_status_for_match(match, player, target_status));
	if (all_statuses_done) {
		return '';
	}
	const losing_team = _team_status_label(setup, losing_team_index, ci18n(`match:edit:team${losing_team_index + 1}`));
	return ci18n('match:edit:manual_btp_stage_status_entry', {
		name: losing_team,
		event_name: setup.event_name || ci18n('tournament:manual_btp_stage_status:unknown_event'),
		status: target_status,
	});
}

function _btp_stage_status_is_dns(status) {
	return status === 'DNS' || status === 108 || status === '108';
}

function _btp_stage_status_is_wdn(status) {
	return status === 'WDN' || status === 109 || status === '109';
}

function _btp_stage_status_done(status) {
	return _btp_stage_status_is_dns(status) || _btp_stage_status_is_wdn(status);
}

function _btp_stage_status_matches_target(status, target_status) {
	if (target_status === ci18n('tournament:manual_btp_stage_status:target_dns')) {
		return _btp_stage_status_is_dns(status);
	}
	if (target_status === ci18n('tournament:manual_btp_stage_status:target_wdn')) {
		return _btp_stage_status_is_wdn(status);
	}
	return _btp_stage_status_done(status);
}

function _btp_draw_ids_for_match(match) {
	return (match && Array.isArray(match.btp_match_ids) ? match.btp_match_ids : [])
		.map((entry) => entry && entry.draw)
		.filter((draw_id) => draw_id != null)
		.map(String);
}

function _player_has_done_btp_stage_status_for_match(match, player, target_status) {
	const entries = player && player.entries;
	if (!entries) {
		return false;
	}
	return _btp_draw_ids_for_match(match).some((draw_id) => (
		target_status
			? _btp_stage_status_matches_target(entries[draw_id], target_status)
			: _btp_stage_status_done(entries[draw_id])
	));
}

function _manual_btp_stage_status_target(match) {
	if (match && match.score_status === 'walkover') {
		return ci18n('tournament:manual_btp_stage_status:target_dns');
	}
	return ci18n('tournament:manual_btp_stage_status:target_wdn');
}

function _match_needs_manual_btp_stage_status(match) {
	return !!match && (
		match.score_status === 'no_match' ||
		match.score_status === 'walkover' ||
		match.score_status === 'retired'
	);
}

function _manual_btp_stage_status_losing_team_index(match) {
	if (!match) {
		return null;
	}
	if (match.no_match_losing_team === 0 || match.no_match_losing_team === 1) {
		return match.no_match_losing_team;
	}
	if (match.score_status === 'retired' && typeof match.team1_won === 'boolean') {
		return match.team1_won ? 1 : 0;
	}
	return null;
}

function get_manual_btp_stage_status_warnings() {
	if (!curt || !Array.isArray(curt.matches)) {
		return [];
	}
	const warnings_by_key = new Map();
	curt.matches.forEach((match) => {
		if (!_match_needs_manual_btp_stage_status(match)) {
			return;
		}
		const losing_team_index = _manual_btp_stage_status_losing_team_index(match);
		if (losing_team_index !== 0 && losing_team_index !== 1) {
			return;
		}
		const setup = match.setup;
		const players = Array.isArray(setup?.teams?.[losing_team_index]?.players)
			? setup.teams[losing_team_index].players
			: [];
		if (!players.length) {
			return;
		}
		const target_status = _manual_btp_stage_status_target(match);
		const all_statuses_done = players.every((player) => _player_has_done_btp_stage_status_for_match(match, player, target_status));
		if (all_statuses_done) {
			return;
		}
		const player_ids = players.map((player) => player?.btp_id || player?.name).filter(Boolean).join('/');
		const event_name = setup?.event_name || '';
		const key = [event_name, player_ids].join('|');
		if (!warnings_by_key.has(key)) {
			warnings_by_key.set(key, {
				name: _team_status_label(setup, losing_team_index, ci18n(`match:edit:team${losing_team_index + 1}`)),
				event_name,
				match_num: setup && setup.match_num,
				target_status,
			});
		}
	});
	return Array.from(warnings_by_key.values());
}

function render_manual_btp_stage_status_warnings(container) {
	const warnings = get_manual_btp_stage_status_warnings();
	if (!warnings.length) {
		return;
	}
	const warning_container = uiu.el(container, 'div', 'manual_btp_stage_status_warning');
	uiu.el(warning_container, 'div', 'manual_btp_stage_status_warning_title', ci18n('tournament:manual_btp_stage_status:title'));
	warnings.forEach((warning) => {
		uiu.el(warning_container, 'div', 'manual_btp_stage_status_warning_entry', ci18n('tournament:manual_btp_stage_status:entry', {
			name: warning.name,
			event_name: warning.event_name || ci18n('tournament:manual_btp_stage_status:unknown_event'),
			match_num: warning.match_num != null ? ('#' + warning.match_num) : '-',
			status: warning.target_status,
		}));
	});
}

function refresh_manual_btp_stage_status_warnings() {
	uiu.qsEach('.unassigned_container', (container) => {
		container.querySelectorAll('.manual_btp_stage_status_warning').forEach((warning_el) => warning_el.remove());
		const first_child = container.firstChild;
		render_manual_btp_stage_status_warnings(container);
		const warning_el = container.querySelector('.manual_btp_stage_status_warning');
		if (warning_el && first_child && warning_el !== first_child) {
			container.insertBefore(warning_el, first_child);
		}
	});
}

function refresh_unassigned_status_context() {
	refresh_manual_btp_stage_status_warnings();
}

function _update_setup(setup, d) {
	if(!setup) {
		return _make_setup(d);
	}

	const result = setup;

	let override_colors = undefined;
	if (d.override_colors_checkbox) {
		override_colors = {};
		for (let team_id = 0;team_id < 2;team_id++) {
			const team_override_colors = {};
			for (const key of OVERRIDE_COLORS_KEYS) {
				override_colors[key + team_id] = d[`override_colors_${team_id}_${key}`];
			}
		}
	}

	const match_status_state = _parse_match_status_form_value(d);
	const match_status = match_status_state.status;
	const preparation_location_id = match_status_state.preparation_location_id;
	result.court_id           = d.court_id;
	result.now_on_court       = match_status === 'on_court';
	if (match_status === 'deferred') {
		result.state = 'scheduled';
		result.highlight = 0;
		result.preparation_call_deferred = true;
		delete result.location_id;
		delete result.preparation_call_timestamp;
	} else {
		delete result.preparation_call_deferred;
	}
	if (match_status === 'preparation' && preparation_location_id) {
		result.state = 'preparation';
		result.location_id = preparation_location_id;
		if (!result.preparation_call_timestamp) {
			result.preparation_call_timestamp = get_effective_test_clock_now_ms();
		}
	} else if (result.state === 'preparation') {
		result.state = 'scheduled';
		result.highlight = 0;
		delete result.location_id;
		delete result.preparation_call_timestamp;
	}

	if(!d.umpire_name) {
		delete result.umpire;
	}

	if(!d.service_judge_name) {
		delete result.service_judge;
	}

	for (const u of curt.umpires) {
		if (u.name === d.umpire_name) {
			result.umpire = _pack_official_for_match_setup(u);
		}

		if (u.name === d.service_judge_name) {
			result.service_judge = _pack_official_for_match_setup(u);
		}
	}

	result.override_colors    = override_colors;

	return result;
}

function _make_setup(d) {
	const is_doubles = !! d.team0player1lastname;
	const teams = [_make_team(d, 0), _make_team(d, 1)];
	if (d.team0name) {
		teams[0].name = d.team0name;
	} else if (curt.is_nation_competition) {
		teams[0].name = _nation_team_name(d.team0player0nationality, d.team0player1nationality);
	}
	if (d.team1name) {
		teams[1].name = d.team1name;
	} else if (curt.is_nation_competition) {
		teams[1].name = _nation_team_name(d.team1player0nationality, d.team1player1nationality);
	}
	const player_count = is_doubles ? 2 : 1;
	const incomplete = !teams.every(team => (team.players.length === player_count));

	let override_colors = undefined;
	if (d.override_colors_checkbox) {
		override_colors = {};
		for (let team_id = 0;team_id < 2;team_id++) {
			const team_override_colors = {};
			for (const key of OVERRIDE_COLORS_KEYS) {
				override_colors[key + team_id] = d[`override_colors_${team_id}_${key}`];
			}
		}
	}

	const match_status_state = _parse_match_status_form_value(d);
	const match_status = match_status_state.status;
	const preparation_location_id = match_status_state.preparation_location_id;
	const setup = {
		court_id: d.court_id,
		now_on_court: match_status === 'on_court',
		match_num: parseInt(d.match_num),
		match_name: d.match_name,
		scheduled_time_str: d.scheduled_time_str,
		event_name: d.event_name,
		umpire_name: d.umpire_name,
		service_judge_name: d.service_judge_name,
		override_colors,
		teams,
		is_doubles,
		incomplete,
	};
	if (match_status === 'deferred') {
		setup.state = 'scheduled';
		setup.preparation_call_deferred = true;
	}
	if (match_status === 'preparation' && preparation_location_id) {
		setup.state = 'preparation';
		setup.location_id = preparation_location_id;
		setup.preparation_call_timestamp = get_effective_test_clock_now_ms();
	}
	return setup;
}

function _cancel_ui_edit() {
	const dlg = document.querySelector('.match_edit_dialog');
	if (!dlg) {
		return; // Already cancelled
	}
	_remove_tabletoperator_replacement_suggestions();
	cbts_utils.esc_stack_pop();
	uiu.remove(dlg);

	crouting.set('t/:key/', { key: curt.key });
}

function _remove_tabletoperator_replacement_suggestions() {
	uiu.qsEach('.tabletoperator_replacement_suggestions, .tabletoperator_assignment_suggestions', (suggestions_el) => {
		uiu.remove(suggestions_el);
	});
}

function _delete_match_btn_click(e) {
	const match_id = e.target.getAttribute('data-match_id');
	if (! confirm(ci18n('match:delete:really', {match_id}))) return;

	send({
		type: 'match_delete',
		id: match_id,
		tournament_key: curt.key,
	}, function (err) {
		if (err) {
			return cerror.net(err);
		}
		_cancel_ui_edit();
	});
}
	function _finish_ui_edit(e) {
		const match_id = e.target.getAttribute('data-match_id');
		const match = utils.find(curt.matches, m => m._id === match_id);
		if (match) {
			send({
				type: 'confirm_match_finished',
				match_id: match_id,
				tournament_key: match.tournament_key,
				court_id: match.setup.court_id
			}, function (err) {
				if (err) {
					return cerror.net(err);
				}
			});
		}
		_cancel_ui_edit();
	}

function ui_edit(match_id) {
	const source_match = utils.find(curt.matches, m => m._id === match_id);
	if (!source_match) {
		cerror.silent('Match ' + match_id + ' konnte nicht gefunden werden');
		return;
	}
	const old_dialog = document.querySelector('.match_edit_dialog');
	if (old_dialog) {
		_remove_tabletoperator_replacement_suggestions();
		cbts_utils.esc_stack_pop();
		uiu.remove(old_dialog);
	}

	const match = structuredClone(source_match);
	let old_court = structuredClone(match.setup.court_id);

	if(!old_court) {
		old_court = "not_on_court"
	}

	crouting.set('t/' + curt.key + '/m/' + match_id + '/edit', {}, _cancel_ui_edit);

	cbts_utils.esc_stack_push(_cancel_ui_edit);

	const body = uiu.qs('body');
	const dialog_bg = uiu.el(body, 'div', 'dialog_bg match_edit_dialog', {
		'data-edit-match_id': match_id,
	});
	const dialog = uiu.el(dialog_bg, 'div', 'dialog');
	
	uiu.el(dialog, 'h3', {}, ci18n('Edit match'));

	const form = uiu.el(dialog, 'form');
	uiu.el(form, 'input', {
		type: 'hidden',
		name: 'match_id',
		value: match_id,
	});
	render_edit(form, match);

	const buttons = uiu.el(form, 'div', 'match_edit_actions');
	if (curt.btp_enabled) {
		const sendbtp_label = uiu.el(buttons, 'label', 'match_edit_btp_update');

		uiu.el(sendbtp_label, 'input', {
			type: 'checkbox',
			name: 'btp_update',
			checked: 'true',
		});
		sendbtp_label.appendChild(document.createTextNode('auch in BTP ändern'));
	}

	const btn = uiu.el(buttons, 'button', {
		'class': 'match_save_button match_edit_action_button match_edit_action_primary',
		role: 'submit',
	}, ci18n('Change'));

	form_utils.onsubmit(form, function(d) {
		if (!d.umpire_name && d.service_judge_name) {
			cerror.silent(ci18n('match:edit:error:service_judge_requires_umpire'));
			return;
		}
		const previous_setup = structuredClone(match.setup);
		match.setup = _update_setup(match.setup, d);
		const raw_score_status = _score_status_from_match_status_form(d.match_status, source_match);
		match.score_status = _normalize_match_score_status_from_form(raw_score_status);
		match.forward_loser = _score_status_forwards_loser_from_form(raw_score_status);
		const no_match_losing_team = _no_match_losing_team_from_form(raw_score_status);
		if (no_match_losing_team == null) {
			delete match.no_match_losing_team;
			if ((source_match.score_status || 'normal') !== 'normal') {
				delete match.team1_won;
				delete match.btp_winner;
				delete match.network_score;
				delete match.score_status_network_score;
			}
		} else {
			match.no_match_losing_team = no_match_losing_team;
			match.team1_won = no_match_losing_team === 1;
			match.btp_winner = match.team1_won ? 1 : 2;
			delete match.network_score;
			delete match.score_status_network_score;
		}
		const force_btp_update =
			(previous_setup.state || null) !== (match.setup.state || null) ||
			(previous_setup.location_id || null) !== (match.setup.location_id || null) ||
			(previous_setup.highlight || 0) !== (match.setup.highlight || 0) ||
			(source_match.score_status || 'normal') !== match.score_status ||
			(source_match.no_match_losing_team == null ? null : source_match.no_match_losing_team) !== (match.no_match_losing_team == null ? null : match.no_match_losing_team) ||
			(source_match.team1_won == null ? null : source_match.team1_won) !== (match.team1_won == null ? null : match.team1_won) ||
			(source_match.forward_loser === true) !== match.forward_loser;
		btn.setAttribute('disabled', 'disabled');
		send({
			type: 'match_edit',
			id: d.match_id,
			match,
			old_court,
			tournament_key: curt.key,
			tabletoperator_assignment_id: d.tabletoperator_assignment_id || null,
			tabletoperator_replacement_name: d.tabletoperator_replacement_name || null,
			tabletoperator_replacement_btp_id: d.tabletoperator_replacement_btp_id || null,
			btp_update: (curt.btp_enabled && (!! d.btp_update || force_btp_update)),
		}, function match_edit_callback(err) {
			btn.removeAttribute('disabled');
			if (err) {
				return cerror.net(err);
			}
			_cancel_ui_edit();
		});
	});

	const delete_btn = uiu.el(buttons, 'button', {
		type: 'button',
		class: 'match_edit_delete_button match_edit_action_button match_edit_action_danger',
		'data-match_id': match_id,
	}, ci18n('match:edit:delete'));
	delete_btn.addEventListener('click', _delete_match_btn_click);

	const finish_btn = uiu.el(buttons, 'button', {
		type: 'button',
		'class': 'match_edit_action_button match_edit_action_secondary',
		'data-match_id': match._id
	}, ci18n('Confirm_Finish'));
	finish_btn.addEventListener('click', _finish_ui_edit);

	const cancel_btn = uiu.el(buttons, 'button', {
		type: 'button',
		class: 'match_edit_action_button match_edit_action_secondary',
	}, ci18n('Cancel'));
	cancel_btn.addEventListener('click', _cancel_ui_edit);
}
crouting.register(/t\/([a-z0-9]+)\/m\/([-a-zA-Z0-9_ ]+)\/edit$/, function(m) {
	ctournament.switch_tournament(m[1], function() {
		ui_edit(m[2]);
	});
}, change.default_handler(() => {
	const dlg = uiu.qs('.match_edit_dialog');
	if (!dlg) {
		return;
	}
	const match_id = dlg.getAttribute('data-edit-match_id');
	ui_edit(match_id);
}));


function _cancel_ui_scoresheet() {
	const dlg = document.querySelector('.match_scoresheet_dialog');
	if (!dlg) {
		return; // Already cancelled
	}
	cbts_utils.esc_stack_pop();
	uiu.remove(dlg);
	uiu.show_qs('.main');
	ctournament.ui_show();
}

function ui_scoresheet(match_id) {
	const match = utils.find(curt.matches, m => m._id === match_id);
	if (!match) {
		cerror.silent('Match ' + match_id + ' konnte nicht gefunden werden');
		return;
	}
	crouting.set('t/' + curt.key + '/m/' + match_id + '/scoresheet', {}, _cancel_ui_scoresheet);

	cbts_utils.esc_stack_push(_cancel_ui_scoresheet);

	uiu.hide_qs('.main');
	const body = uiu.qs('body');
	const dialog = uiu.el(body, 'div', {
		'class': 'match_scoresheet_dialog',
		'data-match_id': match_id,
	});

	const container = uiu.el(dialog, 'div');
	const lang = ci18n.get_lang();
	const pseudo_state = {
		settings: {
			shuttle_counter: true,
		},
		lang,
	};
	i18n.update_state(pseudo_state, lang);
	i18n.register_lang(i18n_de);
	i18n.register_lang(i18n_en);
	const setup = utils.deep_copy(match.setup);
	setup.tournament_name = curt.name;
	let s = null;
	try {
		s = calc.remote_state(pseudo_state, setup, match.presses);
	} catch (err) {
		console.error(`[bts] scoresheet remote_state failed for #${setup.match_num || '?'} (${match._id})`, err);
		return cerror.silent(`Scoresheet for #${setup.match_num || '?'} cannot be rendered: ${err.message}`);
	}
	s.ui = {};

	printing.set_orientation('landscape');
	scoresheet.load_sheet(scoresheet.sheet_name(s.setup), function(xml) {
		var svg = scoresheet.make_sheet_node(s, xml);
		svg.setAttribute('class', 'scoresheet single_scoresheet');
		// Usually we'd call importNode here to import the document here, but IE/Edge then ignores the styles
		container.appendChild(svg);
		scoresheet.sheet_render(s, svg);
	}, '/bupdev/');

	const scoresheet_buttons = uiu.el(dialog, 'div', 'match_scoresheet_buttons');

	const cancel_btn = uiu.el(scoresheet_buttons, 'div', 'vlink', ci18n('Back'));
	cancel_btn.addEventListener('click', _cancel_ui_scoresheet);	

	const pdf_btn = uiu.el(scoresheet_buttons, 'button', {}, ci18n('PDF'));
	pdf_btn.addEventListener('click', function() {
		const svg_nodes = document.querySelectorAll('.single_scoresheet');
		scoresheet.save_pdf(s, svg_nodes);
	});

	const print_btn = uiu.el(scoresheet_buttons, 'button', {}, ci18n('Print'));
	print_btn.addEventListener('click', function() {
		window.print();
	});
}
crouting.register(/t\/([a-z0-9]+)\/m\/([-a-zA-Z0-9_ ]+)\/scoresheet$/, function(m) {
	ctournament.switch_tournament(m[1], function() {
		ui_scoresheet(m[2]);
	});
}, change.default_handler(() => {
	const dlg = uiu.qs('.match_scoresheet_dialog');
	const match_id = dlg.getAttribute('data-match_id');
	ui_scoresheet(match_id);
}));

function render_match_table(container, matches, style, show_player_status, show_add_tabletoperator) {
	if(!show_player_status)
	{
		show_player_status = false;
	}

	if(! style) {
		style = 'default';
	}
	
	const table = uiu.el(container, 'table', 'match_table');
	render_match_table_header(table, true);
	const tbody = uiu.el(table, 'tbody');

	for (const m of matches) {
		if(m.setup.is_match) {
			const tr = uiu.el(tbody, 'tr', {'class' : 'match highlight_' + m.setup.highlight , 'data-match_id': m._id});
			render_match_row(tr, m, null, style, show_player_status, show_add_tabletoperator);
		}
	}

}

function get_preparation_callable_match_ids() {
	const result = new Set();
	const selections_by_location_id = (curt && curt.location_preparation_selection_by_location_id) || {};
	for (const selection of Object.values(selections_by_location_id)) {
		const display_match_ids = (selection && selection.display_candidate_match_ids) || selection?.candidate_match_ids || [];
		for (const match_id of display_match_ids) {
			if (match_id != null) {
				result.add(String(match_id));
			}
		}
	}
	return result;
}

function get_preparation_cutoff_match_ids() {
	const result = new Set();
	const selections_by_location_id = (curt && curt.location_preparation_selection_by_location_id) || {};
	for (const selection of Object.values(selections_by_location_id)) {
		const cutoff_match_id = selection && selection.display_cutoff_match_id;
		if (cutoff_match_id != null) {
			result.add(String(cutoff_match_id));
		}
	}
	return result;
}

function get_preparation_frontier_match_ids() {
	const result = new Set();
	const selections_by_location_id = (curt && curt.location_preparation_selection_by_location_id) || {};
	for (const selection of Object.values(selections_by_location_id)) {
		const frontier_match_id = selection && selection.display_frontier_match_id;
		if (frontier_match_id != null) {
			result.add(String(frontier_match_id));
		}
	}
	return result;
}

function get_preparation_demand_court_ids() {
	const result = new Set();
	const selections_by_location_id = (curt && curt.location_preparation_selection_by_location_id) || {};
	for (const selection of Object.values(selections_by_location_id)) {
		const court_ids = (selection && selection.demand_court_ids) || [];
		for (const court_id of court_ids) {
			if (court_id != null) {
				result.add(String(court_id));
			}
		}
	}
	return result;
}

function update_preparation_demand_court_markers() {
	const demand_court_ids = get_preparation_demand_court_ids();
	uiu.qsEach('.court_row[data-court_id]', (row) => {
		const court_id = row.getAttribute('data-court_id');
		if (demand_court_ids.has(String(court_id))) {
			row.classList.add('preparation_demand_court');
			row.setAttribute('data-preparation-demand-court', 'true');
		} else {
			row.classList.remove('preparation_demand_court');
			row.removeAttribute('data-preparation-demand-court');
		}
	});
}

function get_preparation_frontier_debug_entries() {
	const selections_by_location_id = (curt && curt.location_preparation_selection_by_location_id) || {};
	const locations_by_id = new Map((curt && curt.locations || []).map((location) => [String(location._id), location]));
	const courts_by_id = new Map((curt && curt.courts || []).map((court) => [String(court._id), court]));
	const format_match_nums = (nums) => {
		const values = (Array.isArray(nums) ? nums : []).filter((num) => num != null);
		return values.length ? values.map((num) => '#' + num).join(', ') : '-';
	};
	const format_court_ids = (court_ids) => {
		const values = (Array.isArray(court_ids) ? court_ids : [])
			.map((court_id) => {
				const court = courts_by_id.get(String(court_id));
				return court && court.num != null ? String(court.num) : String(court_id);
			});
		return values.length ? values.join(', ') : '-';
	};
	return Object.entries(selections_by_location_id)
		.map(([location_id, selection]) => {
			const location = locations_by_id.get(String(location_id));
			const location_name = location ? (location.name || location.short_name || ('Standort ' + location_id)) : ('Standort ' + location_id);
			const frontier_match_num = selection && selection.display_frontier_match_num;
			const required = selection && selection.required_preparation_count != null ? selection.required_preparation_count : 0;
			const current = selection && selection.current_preparation_count != null ? selection.current_preparation_count : 0;
			const missing = selection && selection.missing_preparation_count != null ? selection.missing_preparation_count : 0;
			const auto_required = selection && selection.effective_required_preparation_count != null ? selection.effective_required_preparation_count : 0;
			const auto_missing = selection && selection.effective_missing_preparation_count != null ? selection.effective_missing_preparation_count : 0;
			return {
				location_id: String(location_id),
				location_name,
				text: location_name
					+ ': Bedarf ' + current + '/' + required
					+ ', fehlt ' + missing
					+ ', Auto ' + auto_missing + '/' + auto_required
					+ ', gruen Felder ' + format_court_ids(selection && selection.demand_court_ids)
					+ ' (Nachfolger ' + format_court_ids(selection && selection.successor_court_ids)
					+ ', frei ' + format_court_ids(selection && selection.free_court_ids) + ')'
					+ ', Frontier ' + (frontier_match_num != null ? ('#' + frontier_match_num) : 'keine')
					+ ', Grenze ' + (selection && selection.display_cutoff_match_num != null ? ('#' + selection.display_cutoff_match_num) : '-')
					+ ', Kandidaten ' + format_match_nums(selection && selection.display_candidate_match_nums)
					+ ', Auswahl ' + format_match_nums(selection && selection.selected_match_nums)
					+ ', Auto-Auswahl ' + format_match_nums(selection && selection.auto_selected_match_nums),
			};
		})
		.sort((a, b) => a.location_name.localeCompare(b.location_name, 'de'));
}

const PREPARATION_DEBUG_RULE_LABELS = {
	state_scheduled: 'Status ist angesetzt',
	not_deferred: 'Vorbereitungsaufruf nicht zurueckgestellt',
	score_status_normal: 'Keine Sonderwertung am Spiel',
	is_match: 'Ist ein echtes Spiel',
	not_incomplete: 'Spiel ist nicht unvollstaendig markiert',
	participants_complete: 'Alle Teilnehmer stehen fest',
	not_finished: 'Spiel ist nicht beendet',
	location: 'Spiel passt zum Standort',
	participant_dependencies: 'Keine offenen Vorgaenger oder frueheren Spielerteilnahmen',
	time_before_scheduled: 'Zeitfenster vor geplanter Startzeit erreicht',
	special_result_same_discipline: 'Keine blockierende Sonderwertung in derselben Disziplin',
	not_playing_on_court: 'Kein Spieler spielt gerade',
	player_pause: 'Spielerpausen sind abgelaufen',
	not_waiting_tabletoperator: 'Kein Spieler wartet als Tabletbediener',
	not_active_tabletoperator: 'Kein Spieler bedient gerade ein Tablet',
	technical_officials_available: 'Schiedsrichterregeln erfuellt',
	frontier_block_limit: 'Blockgrenze ab Frontier eingehalten',
	frontier_time_limit: 'Zeitgrenze ab Frontier eingehalten',
	frontier_match_limit: 'Spielanzahlgrenze ab Frontier eingehalten',
};

const CALL_ON_COURT_DEBUG_RULE_LABELS = {
	...PREPARATION_DEBUG_RULE_LABELS,
	court_active_free: 'Feld ist aktiv und frei',
	state_scheduled_or_preparation: 'Status ist angesetzt oder in Vorbereitung',
	not_on_court: 'Spiel ist noch nicht auf dem Feld',
	call_on_court_preparation_age: 'Mindestzeit in Vorbereitung erreicht',
	call_on_court_time_before_scheduled: 'Zeitfenster vor geplanter Startzeit erreicht',
	players_checked_in: 'Alle Spieler sind eingecheckt',
	call_on_court_officials_checked_in: 'Schiedsrichter sind eingecheckt',
	call_on_court_officials_available: 'Schiedsrichter sind verfuegbar',
	call_on_court_official_assignment_possible: 'Schiedsrichter koennen auf diesem Feld eingesetzt werden',
	call_on_court_assigned_official_space: 'Feld hat Platz fuer zugewiesene Schiedsrichter',
	call_on_court_frontier_block_limit: 'Blockgrenze ab Aufruf-Frontier eingehalten',
	call_on_court_frontier_time_limit: 'Zeitgrenze ab Aufruf-Frontier eingehalten',
	call_on_court_frontier_match_limit: 'Spielanzahlgrenze ab Aufruf-Frontier eingehalten',
};

function get_preparation_debug_location_name(location_id) {
	const location = (curt && Array.isArray(curt.locations))
		? curt.locations.find((candidate) => String(candidate?._id) === String(location_id))
		: null;
	if (location) {
		return location.name || location.short_name || ('Standort ' + location_id);
	}
	return location_id != null ? ('Standort ' + location_id) : 'Standort';
}

function get_preparation_debug_diagnostics_for_match(match) {
	if (!match || match._id == null) {
		return [];
	}
	const match_id = String(match._id);
	const selections_by_location_id = (curt && curt.location_preparation_selection_by_location_id) || {};
	return Object.entries(selections_by_location_id)
		.map(([location_id, selection]) => {
			const diagnostics_by_match_id = (selection && selection.diagnostics_by_match_id) || {};
			const diagnostics = diagnostics_by_match_id[match_id];
			if (!diagnostics) {
				return null;
			}
			return {
				location_id,
				location_name: get_preparation_debug_location_name(location_id),
				diagnostics,
			};
		})
		.filter((entry) => entry != null)
		.sort((a, b) => a.location_name.localeCompare(b.location_name, 'de'));
}

function get_call_on_court_debug_entries_for_match(match) {
	if (!match || match._id == null) {
		return [];
	}
	const match_id = String(match._id);
	const selections_by_location_id = (curt && curt.location_preparation_selection_by_location_id) || {};
	return Object.entries(selections_by_location_id)
		.map(([location_id, selection]) => {
			const diagnostics_by_match_id = (selection && selection.call_on_court_diagnostics_by_match_id) || {};
			const diagnostics = diagnostics_by_match_id[match_id];
			if (!diagnostics) {
				return null;
			}
			return {
				location_id,
				location_name: get_preparation_debug_location_name(location_id),
				diagnostics,
			};
		})
		.filter((entry) => entry != null)
		.sort((a, b) => a.location_name.localeCompare(b.location_name, 'de'));
}

function get_call_on_court_debug_status(match) {
	const entries = get_call_on_court_debug_entries_for_match(match);
	if (entries.length === 0) {
		return null;
	}
	return entries.some((entry) => entry.diagnostics?.eligible === true) ? 'ready' : 'blocked';
}

function get_preparation_debug_window_status(match) {
	const entries = get_preparation_debug_diagnostics_for_match(match);
	const window_entries = entries.filter((entry) => entry.diagnostics?.within_call_window === true);
	if (window_entries.length === 0) {
		return null;
	}
	if (window_entries.some((entry) => entry.diagnostics?.criteria_eligible === true)) {
		return 'ok';
	}
	return 'blocked';
}

function format_preparation_debug_rule(rule, labels = PREPARATION_DEBUG_RULE_LABELS) {
	if (rule && rule.enabled === false) {
		const label = labels[rule.key] || rule.key || 'Regel';
		return '- (deaktiviert) ' + label;
	}
	const marker = rule && rule.passed ? '\u2713' : '\u2717';
	const label = labels[rule && rule.key] || (rule && rule.key) || 'Regel';
	return marker + ' ' + label + (rule && rule.detail ? ' (' + rule.detail + ')' : '');
}

function preparation_debug_rules_pass(rules) {
	return rules.every((rule) => rule && (rule.enabled === false || rule.passed === true));
}

function append_preparation_debug_rule_section(lines, title, passed, rules, labels = PREPARATION_DEBUG_RULE_LABELS) {
	lines.push(title + ': ' + (passed ? 'ja' : 'nein'));
	if (rules.length === 0) {
		lines.push('- keine Regeln');
		return;
	}
	rules.forEach((rule) => {
		lines.push(format_preparation_debug_rule(rule, labels));
	});
}

function count_failed_enabled_debug_rules(rules) {
	return rules.filter((rule) => rule && rule.enabled !== false && rule.passed !== true).length;
}

function select_call_on_court_debug_diagnostics(court_diagnostics) {
	if (!Array.isArray(court_diagnostics) || court_diagnostics.length === 0) {
		return null;
	}
	const sorted = [...court_diagnostics].sort((a, b) => {
		if (a?.eligible === true && b?.eligible !== true) return -1;
		if (b?.eligible === true && a?.eligible !== true) return 1;
		const a_rules = Array.isArray(a?.rules) ? a.rules : [];
		const b_rules = Array.isArray(b?.rules) ? b.rules : [];
		return count_failed_enabled_debug_rules(a_rules) - count_failed_enabled_debug_rules(b_rules);
	});
	return sorted[0] || null;
}

function format_preparation_debug_tooltip(match, entries) {
	const match_num = match?.setup?.match_num != null ? ('#' + match.setup.match_num) : 'Spiel';
	const lines = [match_num + ' Vorbereitungsauswahl'];
	entries.forEach((entry, index) => {
		if (index > 0) {
			lines.push('');
		}
		lines.push(entry.location_name);
		const rules = Array.isArray(entry.diagnostics?.rules) ? entry.diagnostics.rules : [];
		if (rules.length === 0) {
			lines.push('\u2717 Keine Detailregeln empfangen');
			return;
		}
		const criteria_rules = rules.filter((rule) => !rule || rule.group !== 'window');
		const window_rules = rules.filter((rule) => rule && rule.group === 'window');
		const criteria_eligible = entry.diagnostics?.criteria_eligible ?? preparation_debug_rules_pass(criteria_rules);
		const within_call_window = entry.diagnostics?.within_call_window ?? preparation_debug_rules_pass(window_rules);
		append_preparation_debug_rule_section(lines, 'Grundsaetzlich aufrufbar', criteria_eligible, criteria_rules, PREPARATION_DEBUG_RULE_LABELS);
		lines.push('');
		append_preparation_debug_rule_section(lines, 'Innerhalb Aufrufgrenze', within_call_window, window_rules, PREPARATION_DEBUG_RULE_LABELS);
	});
	return lines.join('\n');
}

function format_call_on_court_debug_tooltip(match, entries) {
	const match_num = match?.setup?.match_num != null ? ('#' + match.setup.match_num) : 'Spiel';
	const lines = [match_num + ' Aufruf aufs Feld'];
	entries.forEach((entry, index) => {
		if (index > 0) {
			lines.push('');
		}
		const diagnostics = entry.diagnostics || {};
		lines.push(entry.location_name);
		const court_diagnostics = Array.isArray(diagnostics.court_diagnostics) ? diagnostics.court_diagnostics : [];
		const selected_diagnostics = select_call_on_court_debug_diagnostics(court_diagnostics);
		lines.push('Aufrufkriterien erfuellt: ' + (diagnostics.eligible ? 'ja' : 'nein'));
		if (court_diagnostics.length === 0) {
			lines.push('\u2717 Keine Detaildaten fuer diesen Standort');
			return;
		}
		const rules = Array.isArray(selected_diagnostics?.rules) ? selected_diagnostics.rules : [];
		const criteria_rules = rules.filter((rule) => !rule || rule.group !== 'window');
		const window_rules = rules.filter((rule) => rule && rule.group === 'window');
		append_preparation_debug_rule_section(
			lines,
			'Kriterien',
			selected_diagnostics?.criteria_eligible ?? preparation_debug_rules_pass(criteria_rules),
			criteria_rules,
			CALL_ON_COURT_DEBUG_RULE_LABELS
		);
		lines.push('');
		append_preparation_debug_rule_section(
			lines,
			'Innerhalb Aufrufgrenze',
			selected_diagnostics?.within_call_window ?? preparation_debug_rules_pass(window_rules),
			window_rules,
			CALL_ON_COURT_DEBUG_RULE_LABELS
		);
	});
	return lines.join('\n');
}

function render_debug_icon(td, css_class, title) {
	uiu.el(td, 'span', {
		class: 'preparation_debug_icon ' + css_class,
		title,
	}, 'i');
}

function render_call_on_court_debug_cell(tr, match) {
	const td = tr && tr.querySelector('td.call_td');
	if (!td) {
		return;
	}
	td.classList.add('preparation_debug_call_td');
	const entries = get_call_on_court_debug_entries_for_match(match);
	if (entries.length === 0) {
		render_debug_icon(td, 'preparation_debug_icon_unknown', 'Keine Aufruf-Detaildaten fuer dieses Spiel vorhanden.');
		return;
	}
	const is_ready = entries.some((entry) => entry.diagnostics?.eligible === true);
	render_debug_icon(
		td,
		is_ready ? 'preparation_debug_icon_ok' : 'preparation_debug_icon_fail',
		format_call_on_court_debug_tooltip(match, entries)
	);
}

function render_preparation_debug_cell(tr, match) {
	if (match?.setup?.state === 'preparation') {
		render_call_on_court_debug_cell(tr, match);
		return;
	}
	const td = tr && tr.querySelector('td.call_td');
	if (!td) {
		return;
	}
	td.classList.add('preparation_debug_call_td');
	const entries = get_preparation_debug_diagnostics_for_match(match);
	if (entries.length === 0) {
		render_debug_icon(td, 'preparation_debug_icon_unknown', 'Keine Detaildaten fuer dieses Spiel vorhanden.');
		return;
	}
	const has_failed_rule = entries.some((entry) => {
		const rules = Array.isArray(entry.diagnostics?.rules) ? entry.diagnostics.rules : [];
		return rules.some((rule) => !rule || rule.passed !== true);
	});
	render_debug_icon(
		td,
		has_failed_rule ? 'preparation_debug_icon_fail' : 'preparation_debug_icon_ok',
		format_preparation_debug_tooltip(match, entries)
	);
}

function preparation_call_debug_text_enabled() {
	return !!(curt && curt.preparation_call_debug_output_enabled);
}

function preparation_call_debug_icons_enabled() {
	return !!(curt && curt.preparation_call_debug_icons_enabled);
}

function preparation_call_debug_data_enabled() {
	return preparation_call_debug_text_enabled() || preparation_call_debug_icons_enabled();
}

function render_unassigned(container) {
	uiu.empty(container);
	render_manual_btp_stage_status_warnings(container);
	uiu.el(container, 'h3', 'section', ci18n('Unassigned Matches'));

	if (preparation_call_debug_data_enabled()
		&& curt
		&& !curt.location_preparation_selection_by_location_id
		&& ctournament
		&& typeof ctournament.request_location_preparation_selections === 'function') {
		ctournament.request_location_preparation_selections();
	}

	const frontier_debug_entries = preparation_call_debug_text_enabled() ? get_preparation_frontier_debug_entries() : [];
	if (preparation_call_debug_text_enabled()) {
		const debug_container = uiu.el(container, 'div', 'preparation_frontier_debug');
		uiu.el(debug_container, 'span', 'preparation_frontier_debug_label', 'Vorbereitungs-Debug:');
		if (frontier_debug_entries.length) {
			frontier_debug_entries.forEach((entry) => {
				uiu.el(debug_container, 'span', 'preparation_frontier_debug_entry', entry.text);
			});
		} else {
			const has_locations = curt && Array.isArray(curt.locations) && curt.locations.length > 0;
			uiu.el(
				debug_container,
				'span',
				'preparation_frontier_debug_entry',
				has_locations
					? 'Keine Debugdaten verfügbar.'
					: 'Keine Austragungsorte geladen. Debugdaten werden nach dem nächsten Sync verfügbar.',
			);
		}
	}

	const unassigned_matches = curt.matches.filter((m) => {
		if (calc_section(m) !== 'unassigned') {
			return false;
		}
		if (should_limit_upcoming_matches_to_bts_today() && !is_match_scheduled_for_bts_today(m)) {
			return false;
		}
		return true;
	});
	const show_preparation_debug_icons = preparation_call_debug_icons_enabled();
	const callable_match_ids = show_preparation_debug_icons ? get_preparation_callable_match_ids() : new Set();
	const cutoff_match_ids = show_preparation_debug_icons ? get_preparation_cutoff_match_ids() : new Set();
	const frontier_match_ids = show_preparation_debug_icons ? get_preparation_frontier_match_ids() : new Set();

	const table = uiu.el(container, 'table', 'match_table');
	render_match_table_header(table, true);
	const tbody = uiu.el(table, 'tbody');

	unassigned_matches.forEach((match) => {
		if (!match.setup.is_match) {
			return;
		}
		const is_callable_for_preparation = callable_match_ids.has(String(match._id));
		const is_cutoff_for_preparation = cutoff_match_ids.has(String(match._id));
		const is_frontier_for_preparation = frontier_match_ids.has(String(match._id));
		const preparation_window_status = show_preparation_debug_icons ? get_preparation_debug_window_status(match) : null;
		const call_on_court_status = show_preparation_debug_icons && match?.setup?.state === 'preparation'
			? get_call_on_court_debug_status(match)
			: null;
		const tr = uiu.el(tbody, 'tr', {
			'class': 'match highlight_' + match.setup.highlight
				+ (is_frontier_for_preparation ? ' preparation_frontier' : '')
				+ (is_callable_for_preparation ? ' preparation_callable' : '')
				+ (preparation_window_status === 'ok' ? ' preparation_debug_window_ok' : '')
				+ (preparation_window_status === 'blocked' ? ' preparation_debug_window_blocked' : '')
				+ (call_on_court_status === 'ready' ? ' call_on_court_debug_ready' : '')
				+ (call_on_court_status === 'blocked' ? ' call_on_court_debug_blocked' : '')
				+ (is_cutoff_for_preparation ? ' preparation_call_cutoff' : ''),
			'data-match_id': match._id,
		});
		if (is_callable_for_preparation) {
			tr.setAttribute('data-preparation-callable', 'true');
		}
		render_match_row(tr, match, null, 'unasigned', true, curt.tabletoperator_enabled);
		if (show_preparation_debug_icons) {
			render_preparation_debug_cell(tr, match);
		}
	});
}

function render_upcoming_matches(container) {
	const UPCOMING_MATCH_COUNT = parseInt(curt.upcoming_matches_max_count ? curt.upcoming_matches_max_count : 15);
	uiu.empty(container);

	uiu.el(container, 'h2', {
		style: 'text-align: center;',
	}, ci18n('Next Matches'));	

	const upcoming_table = uiu.el(container, 'table', 'upcoming_table');
	const upcoming_tbody = uiu.el(upcoming_table, 'tbody', 'upcoming_tbody');

	const locationById = Object.fromEntries(
		curt.locations.map(l => [l._id, l])
	);

	const params = new URLSearchParams(window.location.search);
	const param_location = params.get("location");

	const unassigned_matches = curt.matches.filter(m => {
		if (calc_section(m) !== 'unassigned') return false;
		if (should_limit_upcoming_matches_to_bts_today() && !is_match_scheduled_for_bts_today(m)) return false;
		if (!param_location) return true;

		const loc = locationById[m.setup.location_id];

		// KEINE Location → trotzdem anzeigen
		if (!loc) return true;

		// Location vorhanden → muss matchen
		return loc.name === param_location;
	});
	
	var resizable_rows = [];
	for (const match of unassigned_matches.slice(0, UPCOMING_MATCH_COUNT)) {
		const tr = uiu.el(upcoming_tbody, 'tr', {
			style: 'padding-top: 1em;',
		});
		resizable_rows.push(render_match_row(tr, match, null, 'upcoming'));
	}
	resize_table(resizable_rows, 0.98);
	const qr = uiu.el(container, 'img', {
		type: 'img',
		id: 'main_q_code_upcoming',
		src: curt.mainQrCode,
		style: 'position: absolute; right: 20px; bottom: 20px;'
	});
}


function zoned_time_to_utc_timestamp(dateStr, timeStr, timeZone) {
    if (!dateStr) {
		return 0;
	}

	if (!timeStr) {
		return 0;
	}

	const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);

    // "Guess": als ob die eingegebene Zeit UTC wäre
    const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0);

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    // Wie sieht dieser utcGuess in der Ziel-Zeitzone aus?
    const parts = Object.fromEntries(
        formatter.formatToParts(new Date(utcGuessMs)).map(p => [p.type, p.value])
    );

    // Diese "Zonen-Zeit" interpretieren wir als UTC, um den Offset zu bekommen
    const asIfUtcMs = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
    );

    // Offset = (Zonen-Darstellung als UTC) - (echte UTC)
    const offsetMs = asIfUtcMs - utcGuessMs;

    // Gesucht: Zeitpunkt, der in der Zone die gewünschte lokale Zeit ergibt
    return utcGuessMs - offsetMs;
}


function render_finished(container) {
	uiu.empty(container);
	uiu.el(container, 'h3', 'section', ci18n('Finished Matches'));

	const matches = curt.matches.filter(m => calc_section(m) === 'finished').sort(cmp_finished_match_order);
	render_match_table(container, matches, 'default', false, curt.tabletoperator_enabled);
}

function render_courts(container, style) {
	style = style || 'plain';
	uiu.empty(container);
	if(style === 'public') {
		uiu.el(container, 'h2', {}, 'Aktuelle Spiele');
	}
	const table = uiu.el(container, 'table', 'match_table');
	const tbody = uiu.el(table, 'tbody');
	var resizable_rows = [];

	const locationById = Object.fromEntries(
		curt.locations.map(l => [l._id, l])
	);

	const params = new URLSearchParams(window.location.search);
	const param_location = params.get("location");


	const courts = curt.courts.filter(c => {
		if (!param_location) return true;

		const loc = locationById[c.location_id];

		// KEINE Location → trotzdem anzeigen
		if (!loc) return true;

		// Location vorhanden → muss matchen
		return loc.name === param_location;
	});

	for (const c of courts) {
		const expected_section = 'court_' + c._id;
		const court_matches = curt.matches.filter(m => calc_section(m) === expected_section);

		const tr = uiu.el(tbody, 'tr', {class:"court_row", "data-court_id":c._id, "data-location_id":c.location_id} );
		if (get_preparation_demand_court_ids().has(String(c._id))) {
			tr.classList.add('preparation_demand_court');
			tr.setAttribute('data-preparation-demand-court', 'true');
		}
		const rowspan = Math.max(1, court_matches.length);
		//uiu.el(tr, 'th', {
		//	'class': 'court_num',
		//	rowspan,
		//	title: c._id,
		//}, c.num);

		//const court_number_td = uiu.el(tr, "td", 'court_number');
		//uiu.el(court_number_td, "div", "court_num", c.num);


		if (court_matches.length === 0) {
			render_empty_court_row(tr, c, style, true);
		} else {
			let i = 0;
			for (const cm of court_matches) {
				const my_tr = (i > 0) ? uiu.el(tbody, 'tr') : tr;
				resizable_rows.push(render_match_row(my_tr, cm, c, style));
				i++;
			}
		}

		if(!(window.localStorage.getItem('show_location_courts_' + c.location_id) !== 'false')) {
			tr.classList.add('do_not_show');
		}
	}

	if(style === 'public') {
		resize_table(resizable_rows, 0.98);
	}
	update_preparation_demand_court_markers();
}

function update_tables(location_id, enabled) {
	// Alle Elemente mit dem passenden data-location_id Attribut finden
	const elements = document.querySelectorAll(`[data-location_id="${location_id}"]`);

	elements.forEach(el => {
		if (enabled === true) {
			el.classList.remove('do_not_show');
		} else {
			el.classList.add('do_not_show');
		}
	});
}

function render_empty_court_row(tr, court, style, is_droppable) {
	tr.setAttribute("data-style", style);
	
	if (!court) {
		console.warn('court is not set!');

	}

	const is_active = court.is_active;
	
	if(style != 'public') {
		const lead_target_td = uiu.el(tr, 'td', {class: (is_active ? "droppable " : "inactive " ) + "actions", colspan: 1, "data-court_id":court._id, "data-state" : (is_active ? "droppable" : "inactive" )}, '');

		if(is_active){
			lead_target_td.addEventListener("drop", drop);
    		lead_target_td.addEventListener("dragover", allowDrop);
		}

		const court_number_td = uiu.el(tr, "td", {'class':'court_number', "data-court_id":court._id, "data-state" : (is_active ? "droppable" : "inactive")});
		if(is_active) {
			create_court_button(court_number_td, 'court_num', 'inactivate_court', on_inactivate_court_button_click, court._id, court.num);
		} else {
			create_court_button(court_number_td, 'court_inactive', 'activate_court', on_activate_court_button_click, court._id, '');
		}

		const target_td = uiu.el(tr, 'td', {class: 'empty_element', colspan: 11, "data-court_id":court._id}, '');
		if(is_active) {
			court_number_td.classList.add('droppable');
			target_td.classList.add('droppable');
			target_td.setAttribute('data-state', 'droppable')

			court_number_td.addEventListener("drop", drop);
			court_number_td.addEventListener("dragover", allowDrop);
			target_td.addEventListener("drop", drop);
    		target_td.addEventListener("dragover", allowDrop);
		} else {
			court_number_td.classList.add('inactive');
			target_td.classList.add('inactive');

			target_td.setAttribute('data-state', 'inactive')
		}
	} else {
		const court_number_td = uiu.el(tr, "td", {'class':'court_number', "data-court_id":court._id});
		if(is_active){
			uiu.el(court_number_td, "div", 'court_num', court.num);
		} else {
			uiu.el(court_number_td, "div", 'court_inactive', "");
		}

		const target_td = uiu.el(tr, 'td', {class: 'empty_element', colspan: 11, "data-court_id":court._id}, '');
	}
}

function update_court(court) {
	const tr = uiu.qs(`tr[data-court_id="${court._id}"]`);
	if (!tr) {
		return;
	}
	const match_id = tr.getAttribute('data-match_id');
	const style = tr.getAttribute("data-style");
	tr.innerHTML = "";
	if(match_id == null) {
		render_empty_court_row(tr, court, style, true);
		return;
	}
	const m = utils.find(curt.matches, m => m._id === match_id);
	if (!m || !m.setup || m.setup.now_on_court !== true || ['finished'].includes(m.setup.state)) {
		tr.removeAttribute('data-match_id');
		render_empty_court_row(tr, court, style, true);
		return;
	}
	render_match_row(tr, m, court, style);
}


function on_inactivate_court_button_click(e) {
	const btn = e.target;
	const court_id = btn.getAttribute('data-court_id');
	send({
		type: 'court_edit',
		tournament_key: curt.key,
		is_active: false,
		court_id: court_id,
	}, err => {
		if (err) {
			return cerror.net(err);
		}
	});
}

function on_activate_court_button_click(e) {
	const btn = e.target;
	const court_id = btn.getAttribute('data-court_id');
	send({
		type: 'court_edit',
		tournament_key: curt.key,
		is_active: true,
		court_id: court_id,
	}, err => {
		if (err) {
			return cerror.net(err);
		}
	});
}


function create_court_button(targetEl, cssClass, title, listener, court_id, text) {
	const btn = uiu.el(targetEl, 'div', {
		'class': cssClass,
		'title': ci18n(title),
		'data-court_id': court_id,
		'data-state': cssClass,
	}, text);
	btn.addEventListener('click', listener);
}


function allowDrop(ev) {
  	ev.preventDefault();
	ev.stopPropagation();
}

function validate_match_complete(match_id) {
	const m = utils.find(curt.matches, m => m._id === match_id);
	if (!m) {
		cerror.silent('Cannot find match to call on court. ID: ' + JSON.stringify(match_id));
		return false;
	}

	if (m.setup.teams[0].players.length == 0 || m.setup.teams[1].players.length == 0) {
		cerror.silent("Match cannot be called one or more Teams are not set.")
		return false;
	}
	return true;
}

function drag(ev) {
	const drag_source = ev.currentTarget || ev.target;
	let match_id = drag_source && drag_source.getAttribute ? drag_source.getAttribute("data-match_id") : null;
	if (validate_match_complete(match_id)) {
		ev.dataTransfer.setData('text', match_id);

		for (const dropp_row of document.getElementsByClassName ("droppable")) {
			dropp_row.classList.add("droppable_active");
		}
	}
}

function dragend(ev) {
	for (const dropp_row of document.getElementsByClassName ("droppable")) {
		dropp_row.classList.remove("droppable_active");
	}
}

function drop(ev) {
	ev.preventDefault();
	ev.stopPropagation();
	let match_id = ev.dataTransfer.getData('text');
	const drop_target = ev.currentTarget || ev.target;
	const court_target = drop_target && drop_target.closest ? drop_target.closest('[data-court_id]') : drop_target;
	const court_id = court_target && court_target.getAttribute ? court_target.getAttribute('data-court_id') : null;
	if (validate_match_complete(match_id)) {
		send({
			type: 'match_call_on_court',
			court_id: court_id,
			match_id: match_id,
			tournament_key: curt.key,
		}, function (err) {
			if (err) {
				return cerror.net(err);
			}
		});

		for (const dropp_row of document.getElementsByClassName("droppable")) {
			dropp_row.setAttribute("class", "droppable");
		}
	}
}

function _make_player(d, team_idx, player_idx) {
	const firstname = d['team' + team_idx + 'player' + player_idx + 'firstname'];
	const lastname = d['team' + team_idx + 'player' + player_idx + 'lastname'];
	const nationality = d['team' + team_idx + 'player' + player_idx + 'nationality'];

	if (!lastname) return null;

	return {
		firstname,
		lastname,
		nationality,
		name: firstname + ' ' + lastname,
	};
}

function _make_team(d, team_idx) {
	const players = [];
	const p1 = _make_player(d, team_idx, 0);
	if (p1) {
		players.push(p1);
	}
	const p2 = _make_player(d, team_idx, 1);
	if (p2) {
		players.push(p2);
	}
	return {players};
}

function _extract_players(setup) {
	const res = {
		team0player0: {name: '', nationality: '', firstname: '', lastname: ''},
		team0player1: {name: '', nationality: '', firstname: '', lastname: ''},
		team1player0: {name: '', nationality: '', firstname: '', lastname: ''},
		team1player1: {name: '', nationality: '', firstname: '', lastname: ''},
	};
	const teams = setup.teams || [];
	teams.forEach(function(team, team_idx) {
		if (!team) return;
		if (!team.players) return;

		team.players.forEach(function(player, player_idx) {
			if (!player) return;
			utils.annotate_lastname(player);

			res['team' + team_idx + 'player' + player_idx] = player;
		});
	});
	return res;
}

function render_edit(form, match) {
	const setup = match.setup || {};
	const player_names = _extract_players(setup);

	const edit_match_container = uiu.el(form, 'div', 'edit_match_container');
	const details_card = uiu.el(edit_match_container, 'section', 'match_edit_card match_edit_overview_card');
	uiu.el(details_card, 'h4', 'match_edit_card_title', ci18n('match:edit:section:match'));
	const details_grid = uiu.el(details_card, 'div', 'match_edit_details_grid');

	const render_detail = (label, input_options) => {
		const item = uiu.el(details_grid, 'label', 'match_edit_field');
		uiu.el(item, 'span', 'match_edit_field_label', label);
		uiu.el(item, 'input', Object.assign({
			type: 'text',
			disabled: 'disabled',
		}, input_options));
	};

	render_detail(ci18n('Number:'), {
		name: 'match_num',
		pattern: '^[0-9]+$',
		required: 'required',
		value: setup.match_num || '',
		tabindex: 1,
	});
	render_detail('Event:', {
		name: 'event_name',
		placeholder: ci18n('e.g. MX O55'),
		value: setup.event_name || '',
	});
	render_detail('Match:', {
		name: 'match_name',
		placeholder: ci18n('e.g. semi-finals'),
		value: setup.match_name || '',
	});
	render_detail(ci18n('match:edit:scheduled_date'), {
		name: 'scheduled_date',
		pattern: '^[0-9]{4,}-(?:0[0-9]|10|11|12)-(?:[012][0-9]|30|31)$',
		title: 'Date in ISO8601 format, e.g. 2020-05-30',
		value: setup.scheduled_date || '',
	});
	render_detail(ci18n('Time:'), {
		name: 'scheduled_time_str',
		pattern: '^[0-9]{2}:[0-9]{2}$',
		title: 'Time in 24 hour format, e.g. 09:23',
		value: setup.scheduled_time_str || '',
	});

	const teams_grid = uiu.el(edit_match_container, 'div', 'match_edit_teams_grid');
	const render_player_line = (card, player, team_index, player_index, required, tabindex) => {
		const line = uiu.el(card, 'div', 'match_edit_player_line');
		uiu.el(line, 'input', {
			maxlength: 3,
			size: 3,
			name: `team${team_index}player${player_index}nationality`,
			value: player.nationality || '',
			disabled: 'disabled',
		});
		uiu.el(line, 'input', {
			type: 'text',
			name: `team${team_index}player${player_index}firstname`,
			required: required ? 'required' : undefined,
			value: player.firstname,
			tabindex,
			disabled: 'disabled',
		});
		uiu.el(line, 'input', {
			type: 'text',
			name: `team${team_index}player${player_index}lastname`,
			required: required ? 'required' : undefined,
			placeholder: required ? undefined : ci18n('(Singles)'),
			value: player.lastname,
			tabindex,
			disabled: 'disabled',
		});
	};
	const render_team_card = (team_index, title, p0, p1, first_tabindex) => {
		const card = uiu.el(teams_grid, 'section', 'match_edit_card match_edit_team_card');
		uiu.el(card, 'h4', {}, title);
		render_player_line(card, p0, team_index, 0, true, first_tabindex);
		render_player_line(card, p1, team_index, 1, false, first_tabindex + 1);
		if (curt.is_team) {
			const team_line = uiu.el(card, 'label', 'match_edit_team_name');
			uiu.el(team_line, 'span', 'match_edit_field_label', 'Team');
			uiu.el(team_line, 'input', {
				type: 'text',
				name: `team${team_index}name`,
				required: 'required',
				value: (setup.teams && setup.teams[team_index] && setup.teams[team_index].name) ? setup.teams[team_index].name : '',
				tabindex: first_tabindex + 2,
			});
		}
	};
	render_team_card(0, ci18n('match:edit:team1'), player_names.team0player0, player_names.team0player1, 20);
	render_team_card(1, ci18n('match:edit:team2'), player_names.team1player0, player_names.team1player1, 30);

	const assigned = uiu.el(edit_match_container, 'section', 'match_edit_card match_edit_form_grid');
	uiu.el(assigned, 'h4', 'match_edit_card_title', ci18n('match:edit:section:status'));
	const locations = Array.isArray(curt && curt.locations) ? curt.locations : [];
	const current_match_status = setup.preparation_call_deferred
		? 'deferred'
		: (setup.now_on_court ? 'on_court' : (setup.state === 'preparation' ? 'preparation' : 'scheduled'));
	const current_score_status = _score_status_select_value(match);
	const current_status_value = ((match.score_status || 'normal') === 'no_match' || (match.score_status || 'normal') === 'walkover')
		? current_score_status
		: (current_match_status === 'preparation'
			? `preparation:${setup.location_id || (locations[0] && locations[0]._id) || ''}`
			: current_match_status);
	const status_field = uiu.el(assigned, 'label', 'match_edit_field');
	uiu.el(status_field, 'span', 'match_edit_field_label', ci18n('match:edit:status'));
	const status_select = uiu.el(status_field, 'select', {
		name: 'match_status',
		size: 1,
	});
	const status_options = [
		['scheduled', ci18n('match:edit:status:scheduled')],
	];
	if (locations.length > 0) {
		locations.forEach((location) => {
			status_options.push([
				`preparation:${location._id}`,
				ci18n('match:edit:in_preparation_for', { location_name: location.name || location._id }),
			]);
		});
	} else {
		status_options.push(['preparation:', ci18n('match:edit:status:preparation')]);
	}
	status_options.push(
		['on_court', ci18n('match:edit:status:on_court')],
		['deferred', ci18n('match:edit:status:deferred')],
		[
			'no_match_team1',
			ci18n('match:edit:result_status:no_match_team1', {
				name: _team_status_label(setup, 0, ci18n('match:edit:team1')),
			}),
		],
		[
			'no_match_team2',
			ci18n('match:edit:result_status:no_match_team2', {
				name: _team_status_label(setup, 1, ci18n('match:edit:team2')),
			}),
		],
	);
	status_options.forEach(([value, label]) => {
		const attrs = { value };
		if (value === current_status_value) {
			attrs.selected = 'selected';
		}
		uiu.el(status_select, 'option', attrs, label);
	});
	const manual_btp_status_hint = uiu.el(assigned, 'div', 'match_edit_manual_btp_hint');
	const update_manual_btp_status_hint = () => {
		const hint = _manual_btp_stage_status_hint(match, status_select.value);
		manual_btp_status_hint.textContent = '';
		if (hint) {
			uiu.el(manual_btp_status_hint, 'div', 'manual_btp_stage_status_warning_title', ci18n('tournament:manual_btp_stage_status:title'));
			uiu.el(manual_btp_status_hint, 'div', 'manual_btp_stage_status_warning_entry', hint);
		}
		manual_btp_status_hint.style.display = hint ? 'block' : 'none';
	};
	status_select.addEventListener('change', update_manual_btp_status_hint);
	update_manual_btp_status_hint();
	const court_field = uiu.el(assigned, 'label', 'match_edit_field');
	uiu.el(court_field, 'span', 'match_edit_field_label', 'Court:');
	const court_select = uiu.el(court_field, 'select', {
		'class': 'court_selector',
		name: 'court_id',
		size: 1,
	});
	uiu.el(court_select, 'option', {
		value: '',
	}, ci18n('Not assigned'));
	if (curt) {
		for (const court of curt.courts) {
			const attrs = {
				value: court._id,
			};
			if (court._id === setup.court_id) {
				attrs.selected = 'selected';
			}
			uiu.el(court_select, 'option', attrs, court.num);
		}
	}
	// TO stuff
	const tos_container = uiu.el(edit_match_container, 'section', 'match_edit_card match_edit_form_grid');
	uiu.el(tos_container, 'h4', 'match_edit_card_title', ci18n('match:edit:section:officials'));

	// Umpire
	const umpire_field = uiu.el(tos_container, 'label', 'match_edit_field');
	uiu.el(umpire_field, 'span', 'match_edit_field_label', ci18n('Umpire:'));
	const umpire_select = uiu.el(umpire_field, 'select', {
		name: 'umpire_name',
		size: 1,
	});

	// Service judge
	const service_judge_field = uiu.el(tos_container, 'label', 'match_edit_field');
	uiu.el(service_judge_field, 'span', 'match_edit_field_label', ci18n('Service judge:'));
	const service_judge_select = uiu.el(service_judge_field, 'select', {
		name: 'service_judge_name',
		size: 1,
	});
	const show_all_officials_label = uiu.el(tos_container, 'label', {
		class: 'match_edit_checkbox_field',
	});
	const show_all_officials_checkbox = uiu.el(show_all_officials_label, 'input', {
		type: 'checkbox',
		name: 'show_all_officials',
	});
	show_all_officials_label.appendChild(document.createTextNode(' ' + ci18n('match:edit:show_all_officials')));
	let current_umpire_value = (setup.umpire && setup.umpire.name) ? setup.umpire.name : '';
	let current_service_judge_value = (setup.service_judge && setup.service_judge.name) ? setup.service_judge.name : '';
	const rerender_official_selects = () => {
		const umpire_value = current_umpire_value;
		if (!umpire_value) {
			current_service_judge_value = '';
		}
		const service_judge_value = current_service_judge_value;
		render_umpire_options(
			umpire_select,
			umpire_value,
			false,
			!!show_all_officials_checkbox.checked,
			service_judge_value,
			service_judge_value
		);
		render_umpire_options(
			service_judge_select,
			service_judge_value,
			true,
			!!show_all_officials_checkbox.checked,
			umpire_value,
			umpire_value
		);
		service_judge_select.disabled = !umpire_value;
	};
	show_all_officials_checkbox.addEventListener('change', rerender_official_selects);
	umpire_select.addEventListener('change', () => {
		const previous_umpire_value = current_umpire_value;
		const previous_service_judge_value = current_service_judge_value;
		current_umpire_value = umpire_select.value;
		if (current_umpire_value && current_umpire_value === previous_service_judge_value) {
			current_service_judge_value = previous_umpire_value;
		} else if (current_umpire_value && current_umpire_value === current_service_judge_value) {
			current_service_judge_value = '';
		}
		rerender_official_selects();
	});
	service_judge_select.addEventListener('change', () => {
		const previous_umpire_value = current_umpire_value;
		const previous_service_judge_value = current_service_judge_value;
		current_service_judge_value = service_judge_select.value;
		if (current_service_judge_value && current_service_judge_value === previous_umpire_value) {
			current_umpire_value = previous_service_judge_value;
		} else if (current_service_judge_value && current_service_judge_value === current_umpire_value) {
			current_umpire_value = '';
		}
		rerender_official_selects();
	});
	rerender_official_selects();

	if (curt && curt.tabletoperator_enabled) {
		const tabletoperator_container = uiu.el(edit_match_container, 'section', 'match_edit_card match_edit_form_grid match_edit_tabletoperator_card');
		uiu.el(tabletoperator_container, 'h4', 'match_edit_card_title', ci18n('match:edit:section:tabletoperator'));
		const tabletoperator_field = uiu.el(tabletoperator_container, 'label', 'match_edit_field');
		uiu.el(tabletoperator_field, 'span', 'match_edit_field_label', ci18n('match:edit:tabletoperator_assignment'));
		const current_tabletoperators = Array.isArray(setup.tabletoperators)
			? setup.tabletoperators
			: [];
		const unassigned_tabletoperators = (curt.tabletoperators || [])
			.filter((entry) => entry && entry.court == null)
			.sort((a, b) => (a.start_ts || 0) - (b.start_ts || 0));
		_render_tabletoperator_assignment_picker(tabletoperator_field, {
			current_tabletoperators,
			unassigned_tabletoperators,
			court_id: setup.court_id,
		});
		uiu.el(tabletoperator_container, 'span', {
			class: 'match_edit_hint match_edit_wide_field',
		}, ci18n('tabletoperator:assignment_hint'));
	}

	const appearance_container = uiu.el(edit_match_container, 'section', 'match_edit_card');
	uiu.el(appearance_container, 'h4', 'match_edit_card_title', ci18n('match:edit:section:appearance'));
	render_override_colors(appearance_container, setup);
}

function _tabletoperator_status_court_number(court_id) {
	if (!court_id || typeof court_id !== 'string') {
		return '';
	}
	const parts = court_id.split('_');
	return parts[parts.length - 1] || '';
}

function _normalize_tabletoperator_suggestion_text(value) {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLocaleLowerCase();
}

function _render_tabletoperator_replacement_picker(tabletoperator_container) {
	const replacement_row = uiu.el(tabletoperator_container, 'label', 'match_edit_field match_edit_wide_field');
	uiu.el(replacement_row, 'span', 'match_edit_field_label', ci18n('tabletoperator:replacement_label'));
	render_tabletoperator_player_picker(replacement_row, {
		input_name: 'tabletoperator_replacement_name',
		btp_id_name: 'tabletoperator_replacement_btp_id',
		placeholder: ci18n('tabletoperator:replacement_placeholder'),
		input_class: 'match_edit_search_input',
	});
	uiu.el(replacement_row, 'span', {
		class: 'match_edit_hint',
	}, ci18n('tabletoperator:replacement_hint'));
}

function _tabletoperator_participant_name(participant, fallback) {
	return (participant && (participant.name || short_name(participant.firstname, participant.lastname, participant.name))) || fallback || '';
}

function _tabletoperator_participants_label(participants) {
	return (participants || [])
		.map((participant) => _tabletoperator_participant_name(participant))
		.filter(Boolean)
		.join(' / ');
}

function _tabletoperator_participant_key(participant) {
	if (!participant) {
		return '';
	}
	const btp_id = Number(participant.btp_id);
	if (Number.isFinite(btp_id) && btp_id !== -1) {
		return 'btp:' + btp_id;
	}
	return 'name:' + _normalize_tabletoperator_suggestion_text(_tabletoperator_participant_name(participant));
}

function _tabletoperator_icon(parent, kind, text) {
	const icon = uiu.el(parent, 'span', 'tabletoperator_assignment_icon');
	if (kind === 'current') {
		uiu.el(icon, 'span', 'tablet_inline', text || '');
	} else if (kind === 'waitlist') {
		uiu.el(icon, 'span', 'tabletoperator_waitlist_badge', text || '');
	} else if (kind === 'clear') {
		uiu.el(icon, 'span', 'tabletoperator_clear_icon');
	}
	return icon;
}

function _tabletoperator_upcoming_match_info(match) {
	const setup = match && match.setup ? match.setup : {};
	if (!setup || setup.now_on_court || setup.end_ts || (match && match.end_ts)) {
		return null;
	}
	if (['done', 'finished', 'completed'].includes(setup.state)) {
		return null;
	}
	const ts = zoned_time_to_utc_timestamp(setup.scheduled_date, setup.scheduled_time_str, 'Europe/Berlin');
	return {
		ts: Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER,
		label: [
			setup.scheduled_time_str || '',
			setup.match_num != null ? ('#' + setup.match_num) : '',
		].filter(Boolean).join(' '),
	};
}

function _tabletoperator_better_next_match(current_info, next_info) {
	if (!next_info || !next_info.label) {
		return current_info || null;
	}
	if (!current_info) {
		return next_info;
	}
	if (next_info.ts !== current_info.ts) {
		return next_info.ts < current_info.ts ? next_info : current_info;
	}
	return String(next_info.label).localeCompare(String(current_info.label)) < 0 ? next_info : current_info;
}

function _tabletoperator_search_option_label(participant) {
	const next_match_label = participant && participant.next_match && participant.next_match.label;
	return next_match_label ? participant.name + ' (' + next_match_label + ')' : participant.name;
}

function _render_tabletoperator_assignment_picker(container, options) {
	options = options || {};
	const current_tabletoperators = options.current_tabletoperators || [];
	const current_assignment = _tabletoperator_participants_label(current_tabletoperators);
	const input_wrap = uiu.el(container, 'span', 'tabletoperator_assignment_picker');
	const selected_icon = uiu.el(input_wrap, 'span', 'tabletoperator_assignment_selected_icon');
	const visible_input = uiu.el(input_wrap, 'input', {
		type: 'text',
		class: 'match_edit_search_input tabletoperator_assignment_input',
		placeholder: ci18n('tabletoperator:assignment_placeholder'),
		autocomplete: 'off',
		value: current_assignment || ci18n('match:edit:tabletoperator_assignment_clear_option'),
	});
	const initial_visible_value = visible_input.value;
	const assignment_input = uiu.el(input_wrap, 'input', {
		type: 'hidden',
		name: 'tabletoperator_assignment_id',
		value: '',
	});
	const replacement_input = uiu.el(input_wrap, 'input', {
		type: 'hidden',
		name: 'tabletoperator_replacement_name',
		value: '',
	});
	const replacement_btp_id_input = uiu.el(input_wrap, 'input', {
		type: 'hidden',
		name: 'tabletoperator_replacement_btp_id',
		value: '',
	});
	const suggestion_list = uiu.el(uiu.qs('body'), 'div', {
		class: 'tabletoperator_assignment_suggestions',
		style: 'display: none; position: fixed; width: 420px; max-height: 18em; overflow: auto; background: white; border: 1px solid #999; box-shadow: 0 2px 6px rgba(0,0,0,0.25); z-index: 20000; text-align: left;',
	});
	const player_suggestions = _tabletoperator_player_suggestions();
	const current_participant_keys = new Set();
	const unavailable_participant_keys = new Set();
	current_tabletoperators.forEach((participant) => {
		const key = _tabletoperator_participant_key(participant);
		if (key) {
			current_participant_keys.add(key);
			unavailable_participant_keys.add(key);
		}
	});
	(options.unassigned_tabletoperators || []).forEach((entry) => {
		(entry.tabletoperator || []).forEach((participant) => {
			const key = _tabletoperator_participant_key(participant);
			if (key) {
				unavailable_participant_keys.add(key);
			}
		});
	});
	const set_selected_icon = (kind, text) => {
		uiu.empty(selected_icon);
		_tabletoperator_icon(selected_icon, kind, text);
	};
	const select_option = (option) => {
		visible_input.value = option.selected_label || option.replacement_name || option.label;
		assignment_input.value = option.assignment_id || '';
		replacement_input.value = option.replacement_name || '';
		replacement_btp_id_input.value = option.btp_id || '';
		set_selected_icon(option.icon_kind, option.icon_text);
		suggestion_list.style.display = 'none';
	};
	const action_options = () => {
		const result = [];
		if (current_assignment) {
			result.push({
				type: 'current',
				label: ci18n('match:edit:tabletoperator_assignment_current_option', { name: current_assignment }),
				selected_label: current_assignment,
				icon_kind: 'current',
				icon_text: _tabletoperator_status_court_number((current_tabletoperators[0] && current_tabletoperators[0].now_tablet_on_court) || options.court_id),
				assignment_id: '',
			});
		}
		if (current_tabletoperators.length > 1) {
			current_tabletoperators.forEach((participant, index) => {
				const participant_name = _tabletoperator_participant_name(participant, '#' + (index + 1));
				result.push({
					type: 'clear',
					label: ci18n('tabletoperator:release_participant_from_match', { name: participant_name }),
					icon_kind: 'clear',
					assignment_id: '__release_tabletoperator__:' + index,
				});
			});
		}
	(options.unassigned_tabletoperators || []).forEach((entry, index) => {
		if ((entry.tabletoperator || []).some((participant) => current_participant_keys.has(_tabletoperator_participant_key(participant)))) {
			return;
		}
		const names = _tabletoperator_participants_label(entry.tabletoperator);
		if (!names) {
			return;
		}
			result.push({
				type: 'waitlist',
				label: names,
				icon_kind: 'waitlist',
				icon_text: String(index + 1),
				assignment_id: entry._id,
			});
		});
		result.push({
			type: 'clear',
			label: ci18n('match:edit:tabletoperator_assignment_clear_option'),
			icon_kind: 'clear',
			assignment_id: '__release_tabletoperators__',
		});
		return result;
	};
	const hide_suggestions = () => {
		suggestion_list.style.display = 'none';
	};
	const remove_suggestions_if_detached = () => {
		if (!document.body.contains(visible_input) && suggestion_list.parentNode) {
			suggestion_list.parentNode.removeChild(suggestion_list);
		}
	};
	const position_suggestions = () => {
		const input_rect = visible_input.getBoundingClientRect();
		const below_space = window.innerHeight - input_rect.bottom;
		const above_space = input_rect.top;
		const open_up = below_space < 290 && above_space > below_space;
		const max_height = Math.max(130, Math.min(290, (open_up ? above_space : below_space) - 20));
		suggestion_list.style.left = input_rect.left + 'px';
		suggestion_list.style.top = (open_up ? input_rect.top - max_height : input_rect.bottom) + 'px';
		suggestion_list.style.maxHeight = max_height + 'px';
	};
	const render_option_row = (option) => {
		const row = uiu.el(suggestion_list, 'div', 'tabletoperator_assignment_option');
		row.addEventListener('mousedown', (ev) => {
			ev.preventDefault();
			select_option(option);
		});
		if (option.icon_kind) {
			_tabletoperator_icon(row, option.icon_kind, option.icon_text);
		} else {
			const icon = uiu.el(row, 'span', 'tabletoperator_assignment_icon');
			if (option.participant && option.participant.now_playing_on_court) {
				uiu.el(icon, 'div', 'court', _tabletoperator_status_court_number(option.participant.now_playing_on_court));
			}
			if (option.participant && option.participant.now_tablet_on_court) {
				uiu.el(icon, 'div', 'tablet_inline', _tabletoperator_status_court_number(option.participant.now_tablet_on_court));
			}
		}
		uiu.el(row, 'span', 'tabletoperator_assignment_label', option.label);
	};
	const render_suggestions = () => {
		remove_suggestions_if_detached();
		uiu.empty(suggestion_list);
		const actions = action_options();
		const clear_actions = actions.filter((option) => option.type === 'clear' && option.assignment_id === '__release_tabletoperators__');
		actions
			.filter((option) => !(option.type === 'clear' && option.assignment_id === '__release_tabletoperators__'))
			.forEach(render_option_row);
		const needle = _normalize_tabletoperator_suggestion_text(visible_input.value);
		if (needle.length >= 2) {
			player_suggestions
				.filter((participant) => _normalize_tabletoperator_suggestion_text(participant.name).includes(needle))
				.filter((participant) => !unavailable_participant_keys.has(_tabletoperator_participant_key(participant)))
				.forEach((participant) => {
					const btp_id = Number(participant.btp_id);
					render_option_row({
						type: 'player',
						label: _tabletoperator_search_option_label(participant),
						selected_label: participant.name,
						icon_kind: '',
						replacement_name: participant.name,
						btp_id: Number.isFinite(btp_id) && btp_id !== -1 ? String(btp_id) : '',
						participant,
					});
				});
		}
		clear_actions.forEach(render_option_row);
		position_suggestions();
		suggestion_list.style.display = suggestion_list.children.length ? '' : 'none';
	};

	set_selected_icon(current_assignment ? 'current' : 'clear', current_assignment ? _tabletoperator_status_court_number((current_tabletoperators[0] && current_tabletoperators[0].now_tablet_on_court) || options.court_id) : '');
	visible_input.addEventListener('input', () => {
		assignment_input.value = '';
		replacement_btp_id_input.value = '';
		replacement_input.value = visible_input.value;
		uiu.empty(selected_icon);
		render_suggestions();
	});
	visible_input.addEventListener('focus', () => {
		render_suggestions();
		window.setTimeout(() => visible_input.select(), 0);
	});
	visible_input.addEventListener('blur', () => {
		if (!assignment_input.value && !replacement_input.value && !replacement_btp_id_input.value) {
			visible_input.value = initial_visible_value;
			set_selected_icon(current_assignment ? 'current' : 'clear', current_assignment ? _tabletoperator_status_court_number((current_tabletoperators[0] && current_tabletoperators[0].now_tablet_on_court) || options.court_id) : '');
		}
		setTimeout(hide_suggestions, 150);
	});
	window.addEventListener('resize', position_suggestions);
	document.querySelector('.match_edit_dialog')?.addEventListener('scroll', position_suggestions, true);
}

function render_tabletoperator_player_picker(container, options) {
	options = options || {};
	const input_wrap = uiu.el(container, 'span', {
		style: 'display: inline-block; position: relative;',
	});
	const replacement_input = uiu.el(input_wrap, 'input', {
		type: 'text',
		class: options.input_class || '',
		name: options.input_name || 'tabletoperator_player_name',
		placeholder: options.placeholder || ci18n('tabletoperator:replacement_placeholder'),
		autocomplete: 'off',
		style: options.input_style || 'width: 268px;',
	});
	const replacement_btp_id_input = uiu.el(input_wrap, 'input', {
		type: 'hidden',
		name: options.btp_id_name || 'tabletoperator_player_btp_id',
		value: '',
	});
	const suggestion_list = uiu.el(uiu.qs('body'), 'div', {
		class: 'tabletoperator_replacement_suggestions',
		style: 'display: none; position: fixed; width: 360px; max-height: 16em; overflow: auto; background: white; border: 1px solid #999; box-shadow: 0 2px 6px rgba(0,0,0,0.25); z-index: 20000; text-align: left;',
	});
	const hide_suggestions = () => {
		suggestion_list.style.display = 'none';
	};
	const remove_suggestions_if_detached = () => {
		if (!document.body.contains(replacement_input) && suggestion_list.parentNode) {
			suggestion_list.parentNode.removeChild(suggestion_list);
		}
	};
	const position_suggestions = () => {
		const input_rect = replacement_input.getBoundingClientRect();
		const below_space = window.innerHeight - input_rect.bottom;
		const above_space = input_rect.top;
		const open_up = below_space < 260 && above_space > below_space;
		const max_height = Math.max(120, Math.min(260, (open_up ? above_space : below_space) - 20));
		suggestion_list.style.left = input_rect.left + 'px';
		suggestion_list.style.top = (open_up ? input_rect.top - max_height : input_rect.bottom) + 'px';
		suggestion_list.style.maxHeight = max_height + 'px';
	};
	const render_suggestions = () => {
		remove_suggestions_if_detached();
		uiu.empty(suggestion_list);
		const needle = _normalize_tabletoperator_suggestion_text(replacement_input.value);
		if (needle.length < 2) {
			hide_suggestions();
			return;
		}
		const suggestions = _tabletoperator_player_suggestions();
		const filtered = suggestions
			.filter((participant) => _normalize_tabletoperator_suggestion_text(participant.name).includes(needle));
		if (!filtered.length) {
			hide_suggestions();
			return;
		}
		filtered.forEach((participant) => {
			const row = uiu.el(suggestion_list, 'div', {
				style: 'display: flex; align-items: center; gap: 0.35em; padding: 0.15em 0.35em; cursor: pointer; white-space: nowrap;',
			});
			row.addEventListener('mouseover', () => {
				row.style.backgroundColor = '#eef';
			});
			row.addEventListener('mouseout', () => {
				row.style.backgroundColor = '';
			});
			row.addEventListener('mousedown', (ev) => {
				ev.preventDefault();
				replacement_input.value = participant.name;
				const btp_id = Number(participant.btp_id);
				replacement_btp_id_input.value = Number.isFinite(btp_id) && btp_id !== -1 ? String(btp_id) : '';
				hide_suggestions();
			});
			uiu.el(row, 'span', {
				style: 'flex: 1; overflow: hidden; text-overflow: ellipsis;',
			}, participant.name);
			if (participant.now_playing_on_court) {
				uiu.el(row, 'div', 'court', _tabletoperator_status_court_number(participant.now_playing_on_court));
			}
			if (participant.now_tablet_on_court) {
				uiu.el(row, 'div', 'tablet_inline', _tabletoperator_status_court_number(participant.now_tablet_on_court));
			}
		});
		position_suggestions();
		suggestion_list.style.display = '';
	};

	replacement_input.addEventListener('input', () => {
		replacement_btp_id_input.value = '';
		render_suggestions();
	});
	replacement_input.addEventListener('focus', render_suggestions);
	replacement_input.addEventListener('blur', () => {
		setTimeout(hide_suggestions, 150);
	});
	window.addEventListener('resize', position_suggestions);
	document.querySelector('.match_edit_dialog')?.addEventListener('scroll', position_suggestions, true);
	return {
		input: replacement_input,
		btp_id_input: replacement_btp_id_input,
	};
}

function _tabletoperator_player_suggestions() {
	const by_key = new Map();
	const add_participant = (participant, status) => {
		status = status || {};
		if (!participant) {
			return;
		}
		const name = participant.name || short_name(participant.firstname, participant.lastname, participant.name);
		if (!name) {
			return;
		}
		const btp_id = Number(participant.btp_id);
		const key = Number.isFinite(btp_id) && btp_id !== -1 ? 'btp:' + btp_id : 'name:' + name.toLocaleLowerCase();
		const next_playing_court = status.now_playing_on_court || participant.now_playing_on_court;
		const next_tablet_court = status.now_tablet_on_court || participant.now_tablet_on_court;
		const next_match = status.next_match || participant.next_match || null;
		const existing = by_key.get(key);
		if (existing) {
			existing.now_playing_on_court = existing.now_playing_on_court || next_playing_court;
			existing.now_tablet_on_court = existing.now_tablet_on_court || next_tablet_court;
			existing.next_match = _tabletoperator_better_next_match(existing.next_match, next_match);
			return;
		}
		by_key.set(key, {
			name,
			firstname: participant.firstname,
			lastname: participant.lastname,
			btp_id: participant.btp_id,
			now_playing_on_court: next_playing_court,
			now_tablet_on_court: next_tablet_court,
			next_match,
		});
	};
	(curt.matches || []).forEach((candidate_match) => {
		const setup = candidate_match.setup || {};
		const playing_court = setup.now_on_court && setup.court_id ? setup.court_id : false;
		const next_match = _tabletoperator_upcoming_match_info(candidate_match);
		((candidate_match.setup && candidate_match.setup.teams) || []).forEach((team) => {
			(team.players || []).forEach((player) => {
				add_participant(player, {
					now_playing_on_court: playing_court,
					next_match,
				});
			});
		});
		(setup.tabletoperators || []).forEach((participant) => {
			add_participant(participant, {
				now_tablet_on_court: participant.now_tablet_on_court || setup.court_id || false,
			});
		});
	});
	return [...by_key.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function render_override_colors(outer_container, setup) {
	let colors = setup.override_colors;
	const container = uiu.el(outer_container, 'div', {
		style: 'margin-top: 1em; margin-bottom: 1em;',
	});

	const checkbox_label = uiu.el(container, 'label');
	const cb_attrs = {
		type: 'checkbox',
		name: 'override_colors_checkbox',
	};
	if (colors) {
		cb_attrs.checked = 'checked';
	}
	const checkbox = uiu.el(checkbox_label, 'input', cb_attrs);
	checkbox.addEventListener('change', update_override_color_checkbox);
	uiu.el(checkbox_label, 'span', {
		'class': 'match_label',
		'style': 'user-select: none;',
	}, ci18n('match:override_colors'));

	if (! colors) {
		const {default_settings} = settings;
		colors = {
			'0': default_settings.d_c0,
			'bg0': default_settings.c_bg0,
			'1': default_settings.d_c1,
			'bg1': default_settings.c_bg1,
		};
	}

	const color_container = uiu.el(container, 'div', {style: 'display: inline-block; padding-left: 1em;'});
	for (let team_id = 0; team_id < 2;team_id++) {
		if (team_id === 1) {
			uiu.el(color_container, 'div', {style: 'display: inline-block; width: 1.5em'});
		}

		for (const key of OVERRIDE_COLORS_KEYS) {
			const options = {
				type: 'color',
				value: colors[key + team_id],
				name: `override_colors_${team_id}_${key}`,
				title: `${key}${team_id}`,
			};
			if (!setup.override_colors) {
				options.disabled = 'disabled';
			}

			uiu.el(color_container, 'input', options);
		}
	}
}

function update_override_color_checkbox(e) {
	const checkbox = e.target;
	for (const el of checkbox.parentNode.parentNode.querySelectorAll('input[type="color"]')) {
		el.disabled = !checkbox.checked;
	}
}

function build_official_select_entries(tournament, is_service_judge, show_all_officials) {
	const primary_role = is_service_judge ? 'service_judge' : 'umpire';
	const secondary_role = is_service_judge ? 'umpire' : 'service_judge';
	const role_label = (role) => role === 'umpire' ? ci18n('Umpire') : ci18n('Service judge');
	const with_role_label = (official, role) => `${official.name} (${role_label(role)})`;
	const entries = [];
	const append_separator = (label) => {
		entries.push({
			type: 'separator',
			label: `--- ${label} ---`
		});
	};
	const is_waiting_list_label = (label) =>
		label === ci18n('Waiting list umpire') || label === ci18n('Waiting list service judge');
	const append_options = (items, role, secondary_mode = false) => {
		for (const official of items) {
			entries.push({
				type: 'option',
				value: official.name,
				label: secondary_mode ? with_role_label(official, role) : official.name
			});
		}
	};
	if (show_all_officials) {
		const visible_official_ids = new Set();
		const mark_visible = (official) => {
			if (official && official._id) {
				visible_official_ids.add(official._id);
			}
		};
		const sort_by_name = (items) => [...items].sort((a, b) => cbts_utils.natcmp(a.name || '', b.name || ''));
		const sort_by_wait = (items, field) => [...items].sort((a, b) => {
			const ts_a = a[field] || 0;
			const ts_b = b[field] || 0;
			if (ts_a !== ts_b) return ts_a - ts_b;
			return cbts_utils.natcmp(a.name || '', b.name || '');
		});
		const all_officials = tournament.umpires || [];
		const should_render_in_lower_lists = (official) => !visible_official_ids.has(official._id);
		const primary_wait_field = `${primary_role}_wait`;
		const secondary_wait_field = `${secondary_role}_wait`;
		const primary_pause_field = `${primary_role}_pause`;
		const secondary_pause_field = `${secondary_role}_pause`;
		const primary_manual_pause_field = `${primary_role}_manual_pause`;
		const secondary_manual_pause_field = `${secondary_role}_manual_pause`;
		const preparation_matches = [...(curt.matches || [])]
			.filter((match) => (match.setup || {}).state === 'preparation')
			.sort((a, b) => (a.setup?.preparation_call_timestamp || 0) - (b.setup?.preparation_call_timestamp || 0));
		const assigned_matches = [...(curt.matches || [])]
			.filter((match) => {
				const setup = match.setup || {};
				return setup.state !== 'preparation'
					&& !['oncourt', 'blocked', 'finished'].includes(setup.state)
					&& ((setup.umpire && setup.umpire._id) || (setup.service_judge && setup.service_judge._id));
			})
			.sort((a, b) => cbts_utils.natcmp(String(a.setup?.match_num || ''), String(b.setup?.match_num || '')));
		preparation_matches.forEach((match) => {
			mark_visible(match.setup && match.setup.umpire);
			mark_visible(match.setup && match.setup.service_judge);
		});
		assigned_matches.forEach((match) => {
			mark_visible(match.setup && match.setup.umpire);
			mark_visible(match.setup && match.setup.service_judge);
		});
		for (const official of all_officials) {
			if (official.umpire_on_court != null || official.service_judge_on_court != null) {
				mark_visible(official);
			}
		}
		const primary_wait_items = sort_by_wait(
			all_officials.filter((u) => u[primary_wait_field] != null && should_render_in_lower_lists(u)),
			primary_wait_field
		);
		const secondary_wait_items = sort_by_wait(
			all_officials.filter((u) => u[secondary_wait_field] != null && should_render_in_lower_lists(u)),
			secondary_wait_field
		);
		const primary_pause_items = sort_by_wait(
			all_officials.filter((u) => (u[primary_pause_field] != null || u[primary_manual_pause_field] != null) && should_render_in_lower_lists(u)),
			primary_pause_field
		);
		const secondary_pause_items = sort_by_wait(
			all_officials.filter((u) => (u[secondary_pause_field] != null || u[secondary_manual_pause_field] != null) && should_render_in_lower_lists(u)),
			secondary_pause_field
		);
		const preparation_primary = sort_by_name(preparation_matches.map((match) => match.setup && match.setup[primary_role]).filter(Boolean));
		const preparation_secondary = sort_by_name(preparation_matches.map((match) => match.setup && match.setup[secondary_role]).filter(Boolean));
		const assigned_primary = sort_by_name(assigned_matches.map((match) => match.setup && match.setup[primary_role]).filter(Boolean));
		const assigned_secondary = sort_by_name(assigned_matches.map((match) => match.setup && match.setup[secondary_role]).filter(Boolean));
		const inactive_primary = sort_by_wait(
			all_officials.filter((u) => u.inactive_list != null && should_render_in_lower_lists(u) && !(u.is_service_judge && !u.is_umpire)),
			'inactive_list'
		);
		const inactive_secondary = sort_by_wait(
			all_officials.filter((u) => u.inactive_list != null && should_render_in_lower_lists(u) && u.is_service_judge && !u.is_umpire),
			'inactive_list'
		);
		const fallback_inactive_officials = all_officials
			.filter((u) => !visible_official_ids.has(u._id))
			.filter((u) => u.umpire_wait == null && u.service_judge_wait == null && u.umpire_pause == null && u.service_judge_pause == null && u.umpire_manual_pause == null && u.service_judge_manual_pause == null && u.inactive_list == null)
			.sort((a, b) => cbts_utils.natcmp(a.name || '', b.name || ''));
		fallback_inactive_officials.forEach((official) => {
			if (official.is_umpire && !official.is_service_judge) {
				inactive_primary.push(official);
				return;
			}
			if (official.is_service_judge && !official.is_umpire) {
				inactive_secondary.push(official);
				return;
			}
			inactive_primary.push(official);
		});
		const on_court_primary = sort_by_name(all_officials.filter((u) => u[`${primary_role}_on_court`] != null));
		const on_court_secondary = sort_by_name(all_officials.filter((u) => u[`${secondary_role}_on_court`] != null));
		const sections = [
			{ label: primary_role === 'umpire' ? ci18n('Waiting list umpire') : ci18n('Waiting list service judge'), items: primary_wait_items, role: primary_role, secondary_mode: false },
			{ label: secondary_role === 'umpire' ? ci18n('Waiting list umpire') : ci18n('Waiting list service judge'), items: secondary_wait_items, role: secondary_role, secondary_mode: true },
			{ label: ci18n('Currently on break:') + ' ' + role_label(primary_role), items: primary_pause_items, role: primary_role, secondary_mode: false },
			{ label: ci18n('Currently on break:') + ' ' + role_label(secondary_role), items: secondary_pause_items, role: secondary_role, secondary_mode: true },
			{ label: ci18n('Assigned to a match:'), items: assigned_primary, role: primary_role, secondary_mode: false },
			{ label: ci18n('Assigned to a match:'), items: assigned_secondary, role: secondary_role, secondary_mode: true },
			{ label: ci18n('Not available:'), items: inactive_primary, role: primary_role, secondary_mode: false },
			{ label: ci18n('Not available:'), items: inactive_secondary, role: secondary_role, secondary_mode: true },
			{ label: ci18n('In preparation:'), items: preparation_primary, role: primary_role, secondary_mode: false },
			{ label: ci18n('In preparation:'), items: preparation_secondary, role: secondary_role, secondary_mode: true },
			{ label: ci18n('On court:'), items: on_court_primary, role: primary_role, secondary_mode: false },
			{ label: ci18n('On court:'), items: on_court_secondary, role: secondary_role, secondary_mode: true },
		];
		let rendered_any = false;
		sections.forEach((section) => {
			if (!section.items.length) return;
			if (rendered_any || !is_waiting_list_label(section.label)) {
				append_separator(section.label.replace(/:$/, ''));
			}
			append_options(section.items, section.role, section.secondary_mode);
			rendered_any = true;
		});
		return entries;
	}
	const primary_wait_field = is_service_judge ? 'service_judge_wait' : 'umpire_wait';
	const secondary_wait_field = is_service_judge ? 'umpire_wait' : 'service_judge_wait';
	const sort_wait_list = (wait_field) => [...(tournament.umpires || [])]
		.filter((u) => u[wait_field] != null)
		.sort((a, b) => {
			const ts_a = a[wait_field] || 0;
			const ts_b = b[wait_field] || 0;
			if (ts_a !== ts_b) return ts_a - ts_b;
			return cbts_utils.natcmp(a.name || '', b.name || '');
		});
	const officials = [
		...sort_wait_list(primary_wait_field).map((u) => ({ official: u, label: u.name })),
		...sort_wait_list(secondary_wait_field).map((u) => ({ official: u, label: with_role_label(u, secondary_wait_field === 'umpire_wait' ? 'umpire' : 'service_judge') }))
	];
	const primary_count = sort_wait_list(primary_wait_field).length;
	const secondary_label = secondary_wait_field === 'umpire_wait'
		? '--- ' + ci18n('Waiting list umpire') + ' ---'
		: '--- ' + ci18n('Waiting list service judge') + ' ---';
	for (const [index, entry] of officials.entries()) {
		if (index === primary_count && officials.length > primary_count) {
			entries.push({
				type: 'separator',
				label: secondary_label
			});
		}
		entries.push({
			type: 'option',
			value: entry.official.name,
			label: entry.label
		});
	}
	return entries;
}

function render_umpire_options(select, curval, is_service_judge, show_all_officials, disabled_value, swap_value) {
	uiu.empty(select);
	uiu.el(select, 'option', {
		value: '',
		style: 'font-style: italic;',
	}, is_service_judge ? ci18n('No service judge') : ci18n('No umpire'));
	const entries = build_official_select_entries(curt, is_service_judge, show_all_officials);
	const has_option = (value) => !!value && entries.some((entry) => entry.type === 'option' && entry.value === value);
	const has_current_option = has_option(curval);
	if (!!curval && !has_current_option) {
		uiu.el(select, 'option', {
			value: curval,
			selected: 'selected',
		}, curval);
	}
	if (!!swap_value && swap_value !== curval && !has_option(swap_value)) {
		uiu.el(select, 'option', {
			value: swap_value,
		}, `${swap_value} (${ci18n('match:edit:swap_hint')})`);
	}
	for (const entry of entries) {
		if (entry.type === 'separator') {
			uiu.el(select, 'option', {
				value: '',
				disabled: 'disabled',
				style: 'font-style: italic;',
			}, entry.label);
			continue;
		}
		const attrs = {
			value: entry.value,
		};
		if (disabled_value && entry.value === disabled_value && entry.value !== curval && entry.value !== swap_value) {
			attrs.disabled = 'disabled';
		}
		if (entry.value === curval) {
			attrs.selected = 'selected';
		}
		uiu.el(select, 'option', attrs, entry.label);
	}
}

function render_create(container) {
	/*
	uiu.empty(container);
	const form = uiu.el(container, 'form');

	render_edit(form, {});

	const btn_container = uiu.el(form, 'div', {rowspan: 2});
	const btn = uiu.el(btn_container, 'button', {
		'class': 'match_save_button',
		role: 'submit',
	}, ci18n('Add Match'));

	form_utils.onsubmit(form, function(d) {
		const setup = _make_setup(d);
		btn.setAttribute('disabled', 'disabled');
		send({
			type: 'match_add',
			setup,
			tournament_key: curt.key,
		}, function(err) {
			btn.removeAttribute('disabled');
			if (err) {
				return cerror.net(err);
			}
			uiu.empty(container);
			render_create(container);
		});
	});
	*/
}

return {
	add_match,
	calc_section,
	cmp_match_order: cmp_scheduled_match_order,
	prepare_render,
	render_create,
	render_finished,
	render_unassigned,
	render_courts,
	update_preparation_demand_court_markers,
	render_umpire_options,
		render_upcoming_matches,
		update_court,
		update_match_score,
		count_match_score_targets,
		count_match_timer_targets,
		update_match,
	remove_match_from_gui,
	update_players,
	update_all_player_status_indicators,
	create_timer,
	update_tables,
	_build_official_select_entries: build_official_select_entries,
	_format_participant_dependency,
	render_tabletoperator_player_picker,
	refresh_unassigned_status_context,
};

})();


/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var cbts_utils = require('./cbts_utils');
	var cerror = require('../bup/js/cerror');
	var cflags = require('./cflags');
	var change = require('./change');
	var ci18n = require('./ci18n');
	var countries = require('./countries');
	var crouting = require('./crouting');
	var ctournament = require('./ctournament');
	var form_utils = require('../bup/js/form_utils');
	var uiu = require('../bup/js/uiu');
	var utils = require('../bup/js/utils');
	var scoresheet = require('../bup/js/scoresheet');
	var calc = require('../bup/js/calc');
	var i18n = require('../bup/js/i18n');
	var i18n_de = require('../bup/js/i18n_de');
	var i18n_en = require('../bup/js/i18n_en');
	var match_scoring = require('./match_scoring');
	var printing = require('../bup/js/printing');
	var settings = require('../bup/js/settings');
	var timer = require('../bup/js/timer');

    module.exports = cmatch;
}
/*/@DEV*/
