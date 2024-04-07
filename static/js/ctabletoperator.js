'use strict';

var ctabletoperator = (function() {

function render_unassigned(container) {
	uiu.empty(container);
	uiu.el(container, 'h3', {}, ci18n('tabletoperator:unassigned'));
	const unassigned_tabletoperators = curt.tabletoperators.filter(m => m.court == null);
	render_tabletoperator_table(container, unassigned_tabletoperators);
	render_tabletoperator_formular(container);
}

function render_tabletoperator_table(container, tabletoperators) {
	
	const table = uiu.el(container, 'table', 'tabletoperators_table');
	render_tabletoperator_table_header(table);
	const tbody = uiu.el(table, 'tbody');

	for (const t of tabletoperators) {
		const tr = uiu.el(tbody, 'tr');
		render_tabletoperator_row(tr, t);
	}
}

function render_tabletoperator_table_header(table) {
	const thead = uiu.el(table, 'thead');
	const title_tr = uiu.el(thead, 'tr');
	uiu.el(title_tr, 'th', {}, ci18n('tabletoperator:name'));
}
function render_tabletoperator_row(tr, tabletoperator) {
	const to = tabletoperator.tabletoperator;
	const to_td = uiu.el(tr, 'td');
	uiu.el(to_td, 'div', 'tablet', '');
	uiu.el(to_td, 'span', 'match_no_umpire', to[0].name);
	if (to.length > 1) {
		uiu.el(to_td, 'span', 'match_no_umpire', ' \u200B/ ');
		uiu.el(to_td, 'span', 'match_no_umpire', to[1].name);
	}
	if (tabletoperator.court == null) {
		const buttonbar = uiu.el(tr, 'td');
		create_tabletoperator_button(buttonbar, 'vlink tabletoperator_remove_button', 'tabletoperator:remove', on_remove_from_list_button_click, tabletoperator._id);
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
		uiu.el(form, 'input', {
			type: 'input',
			id: 'tabletoperator_name',
			name: 'tabletoperator_name'
		});
		const btp_fetch_btn = uiu.el(form, 'button', {
			'class': 'vlink tabletoperator_add_custom_button',
			height: 50,
			role: 'submit',
		});
		form_utils.onsubmit(form, function (d) {
			add_to_tabletoperator(null, null, d.tabletoperator_name)
		});
}

function add_to_tabletoperator(match, team_num, tabletoperator_name) {
	if ((match != null && team_num) || tabletoperator_name) {
		send({
			type: 'tabletoperator_add',
			tournament_key: curt.key,
			team_id: team_num,
			tabletoperator_name: tabletoperator_name,
			match: match,
		}, err => {
			if (err) {
				return cerror.net(err);
			}
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
