'use strict';

var ctabletoperator = (function() {

let resize_handler_bound = false;
let fit_resize_observer = null;
let fit_request_pending = false;
let fit_second_pass_pending = false;

function render_unassigned(container) {
	remove_tabletoperator_suggestions();
	uiu.empty(container);
	uiu.el(container, 'h3', {}, ci18n('tabletoperator:unassigned'));
	const unassigned_tabletoperators = curt.tabletoperators.filter(m => m.court == null);

	unassigned_tabletoperators.sort((a, b) => {
		return a.start_ts - b.start_ts;
	});

	const tableoperator_content = uiu.el(container, 'div', 'unassigned_tableoperators_content');
	render_tabletoperator_table(tableoperator_content, unassigned_tabletoperators);
	render_tabletoperator_formular(container);
	schedule_fit_unassigned_tableoperators(container);
	bind_resize_handler_once();
	observe_unassigned_tableoperator_layout(container);
}

function render_tabletoperator_table(container, tabletoperators) {
	
	const table = uiu.el(container, 'table', 'tabletoperators_table');
	//render_tabletoperator_table_header(table);
	const tbody = uiu.el(table, 'tbody');

	tabletoperators.forEach((t, index) => {

		const tr = uiu.el(tbody, 'tr');
		render_tabletoperator_row(tr, t, index === 0, index >= (tabletoperators.length - 1));
	});
}

function render_tabletoperator_table_header(table) {
	const thead = uiu.el(table, 'thead');
	const title_tr = uiu.el(thead, 'tr');
	uiu.el(title_tr, 'th', {}, ci18n('tabletoperator:name'));
}
function render_tabletoperator_row(tr, tabletoperator, is_fist_entry, is_last_entry) {
	const to = tabletoperator.tabletoperator;
	const to_td = uiu.el(tr, 'td');
	const tablet_div = uiu.el(to_td, 'div', 'tablet_operator', '');
	uiu.el(tablet_div, 'div', 'tablet', '');
	const operators_div = uiu.el(tablet_div, 'div', 'operators');
	const person_div = uiu.el(operators_div, 'div', 'person');
	uiu.el(person_div, 'span', 'match_no_umpire', to[0].name);
	if (to.length > 1) {
		
		uiu.el(person_div, 'span', 'match_no_umpire', ' \u200B/ ');
		const person2_div = uiu.el(operators_div, 'div', 'person');
		uiu.el(person2_div, 'span', 'match_no_umpire', to[1].name );

	}

	const court = curt.courts_by_id[tabletoperator.played_on_court];
	const court_td = uiu.el(tr, 'td', 'court_played');
	
	
	uiu.el(court_td, 'div', court ? 'court_history' : '', court ? court.num : '');

	if (tabletoperator.court == null) {
		const buttonbar = uiu.el(tr, 'td');
		if(!is_fist_entry) {
			create_tabletoperator_button(buttonbar, 'vlink tabletoperator_move_up_button', 'tabletoperator:move_up', on_move_up_button_click, tabletoperator._id);
		}
	}

	if (tabletoperator.court == null) {
		const buttonbar = uiu.el(tr, 'td');
		if(! is_last_entry) {
			create_tabletoperator_button(buttonbar, 'vlink tabletoperator_move_down_button', 'tabletoperator:move_down', on_move_down_button_click, tabletoperator._id);
		}
	}

	if (tabletoperator.court == null) {
		const buttonbar = uiu.el(tr, 'td');
		create_tabletoperator_button(buttonbar, 'vlink tabletoperator_remove_button', 'tabletoperator:remove', on_remove_from_list_button_click, tabletoperator._id);
	}
}

function on_move_up_button_click(e) {
	const to = fetchTabletOperatorFromEvent(e);
	if (to != null) {
		send({
			type: 'tabletoperator_move_up',
			tournament_key: curt.key,
			tabletoperator: to,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function on_move_down_button_click(e) {
	const to = fetchTabletOperatorFromEvent(e);
	if (to != null) {
		send({
			type: 'tabletoperator_move_down',
			tournament_key: curt.key,
			tabletoperator: to,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function on_remove_from_list_button_click(e) {
	const to = fetchTabletOperatorFromEvent(e);
	if (to != null) {
		send({
			type: 'tabletoperator_remove',
			tournament_key: curt.key,
			tabletoperator: to,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function fetchTabletOperatorFromEvent(e) {
	const btn = e.target;
	const to_id = btn.getAttribute('data-tabletoperator_id');
	const to = utils.find(curt.tabletoperators, to => to._id === to_id);
	if (!to) {
		cerror.silent('Tabletoperator ' + to_id + ' konnte nicht gefunden werden');
		return null;
	} else {
		return to;
	}
}
function create_tabletoperator_button(targetEl, cssClass, title, listener, tabletoperatorID) {
	const btn = uiu.el(targetEl, 'div', {
		'class': cssClass,
		'title': ci18n(title),
		'data-tabletoperator_id': tabletoperatorID,
	});
	btn.addEventListener('click', listener);
}

function render_tabletoperator_formular(target) {
		const announcements = uiu.el(target, 'div', '_tabletoperator_container');
		const form = uiu.el(announcements, 'form');
		cmatch.render_tabletoperator_player_picker(form, {
			input_name: 'tabletoperator_name',
			btp_id_name: 'tabletoperator_btp_id',
			placeholder: ci18n('tabletoperator:replacement_placeholder'),
			input_class: 'tabletoperator_add_custom_input',
			input_style: 'width: 290px;',
		});
		const btp_fetch_btn = uiu.el(form, 'button', {
			class: 'vlink tabletoperator_add_custom_button',
			role: 'submit',
		});
		form_utils.onsubmit(form, function (d) {
			add_to_tabletoperator(null, null, d.tabletoperator_name, d.tabletoperator_btp_id)
		});
}

function add_to_tabletoperator(match, team_num, tabletoperator_name, tabletoperator_btp_id) {
	if (match != null || tabletoperator_name) {
		send({
			type: 'tabletoperator_add',
			tournament_key: curt.key,
			team_id: team_num,
			tabletoperator_name: tabletoperator_name,
			tabletoperator_btp_id: tabletoperator_btp_id || null,
			match: match,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
		});
	}
}

function remove_tabletoperator_suggestions() {
	uiu.qsEach('.tabletoperator_replacement_suggestions', (suggestions_el) => {
		uiu.remove(suggestions_el);
	});
}

function bind_resize_handler_once() {
	if (resize_handler_bound) {
		return;
	}
	resize_handler_bound = true;
	window.addEventListener('resize', () => {
		schedule_fit_unassigned_tableoperators(uiu.qs('.unassigned_tableoperators_container'));
	});
}

function observe_unassigned_tableoperator_layout(container) {
	if (typeof ResizeObserver === 'undefined' || !container || !container.parentNode) {
		return;
	}
	if (fit_resize_observer) {
		fit_resize_observer.disconnect();
	}
	fit_resize_observer = new ResizeObserver(() => {
		schedule_fit_unassigned_tableoperators(uiu.qs('.unassigned_tableoperators_container'));
	});
	const parent = container.parentNode;
	fit_resize_observer.observe(parent);
	Array.prototype.forEach.call(parent.children, (child) => {
		if (child !== container) {
			fit_resize_observer.observe(child);
		}
	});
}

function schedule_fit_unassigned_tableoperators(container) {
	if (!container) {
		return;
	}
	if (fit_request_pending) {
		return;
	}
	fit_request_pending = true;
	window.requestAnimationFrame(() => {
		fit_request_pending = false;
		fit_unassigned_tableoperators(container, true);
	});
}

function fit_unassigned_tableoperators(container, allow_second_pass) {
	const parent = container.parentNode;
	const content = container.querySelector('.unassigned_tableoperators_content');
	const heading = container.querySelector('h3');
	const form_container = container.querySelector('._tabletoperator_container');
	if (!parent || !content || !heading || !form_container) {
		return;
	}
	const previous_container_height = container.style.height;
	const previous_container_max_height = container.style.maxHeight;
	const previous_container_position = container.style.position;
	const previous_container_visibility = container.style.visibility;
	const previous_container_overflow = container.style.overflow;
	const previous_content_height = content.style.height;
	const previous_content_max_height = content.style.maxHeight;
	container.style.position = 'absolute';
	container.style.visibility = 'hidden';
	container.style.overflow = 'hidden';
	container.style.height = '0px';
	container.style.maxHeight = '0px';
	content.style.height = '0px';
	content.style.maxHeight = '0px';

	let sibling_height = 0;
	Array.prototype.forEach.call(parent.children, (child) => {
		if (child === container) {
			return;
		}
		sibling_height = Math.max(sibling_height, child.getBoundingClientRect().height);
	});
	const target_height = Math.max(90, Math.round(sibling_height || 130));

	container.style.height = previous_container_height;
	container.style.maxHeight = previous_container_max_height;
	container.style.position = previous_container_position;
	container.style.visibility = previous_container_visibility;
	container.style.overflow = previous_container_overflow;
	content.style.height = previous_content_height;
	content.style.maxHeight = previous_content_max_height;

	const heading_height = heading.getBoundingClientRect().height;
	const form_height = form_container.getBoundingClientRect().height;
	const content_height = Math.max(35, target_height - heading_height - form_height - 8);
	container.style.height = target_height + 'px';
	container.style.maxHeight = target_height + 'px';
	content.style.height = content_height + 'px';
	content.style.maxHeight = content_height + 'px';

	if (allow_second_pass && !fit_second_pass_pending) {
		fit_second_pass_pending = true;
		window.requestAnimationFrame(() => {
			fit_second_pass_pending = false;
			fit_unassigned_tableoperators(container, false);
		});
	}
}

return {
	render_unassigned,
	add_to_tabletoperator
};

})();

/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var cflags = require('./cflags');
	var ci18n = require('./ci18n.js');
	var change = require('./change.js');
	var cmatch = require('./cmatch.js');
	var crouting = require('./crouting.js');
	var ctournament = require('./ctournament.js');
	var toprow = require('./toprow.js');
	var uiu = require('../bup/js/uiu.js');
	var utils = require('../bup/js/utils.js');

	module.exports = ctabletoperator;
}
/*/@DEV*/
