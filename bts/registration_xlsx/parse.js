'use strict';

const xlsx = require('node-xlsx');
const utils = require('../utils');

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


module.exports = { parse: _registration_xlsx_parse, text: _registration_xlsx_text, norm: _registration_xlsx_norm };
