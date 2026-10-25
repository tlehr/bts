'use strict';

const xlsx = require('node-xlsx');

function text(value) {
	return value == null ? '' : String(value).trim();
}

function norm(value) {
	return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function member_id(value) {
	return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function number(value) {
	if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
	const str = text(value).replace(/\s/g, '');
	if (!str) return null;
	const result = Number(str.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
	return Number.isFinite(result) && result >= 0 ? result : null;
}

function parse(buffer) {
	const rows = [];
	let found_header = false;
	for (const sheet of xlsx.parse(buffer)) {
		const data = sheet.data || [];
		const header_index = data.findIndex(row => {
			const labels = row.map(norm);
			return labels.includes('dis') && labels.includes('spielerid') &&
				labels.includes('nachname') && labels.includes('vorname') &&
				(labels.includes('points') || labels.includes('punkte'));
		});
		if (header_index < 0) continue;
		found_header = true;
		const header = {};
		data[header_index].forEach((label, i) => { header[norm(label)] = i; });
		for (const row of data.slice(header_index + 1)) {
			const discipline = text(row[header.dis]).toUpperCase();
			if (!['HE', 'DE', 'HD', 'DD', 'HM', 'DM', 'MX'].includes(discipline)) continue;
			const player_name = [text(row[header.vorname]), text(row[header.nachname])].filter(Boolean).join(' ');
			const points = number(row[header.points ?? header.punkte]);
			if (!player_name || points === null) throw new Error('Ungültiger DBV-Ranglisteneintrag: ' + player_name);
			rows.push({
				discipline,
				member_id: text(row[header.spielerid]),
				player_name,
				reversed_name: [text(row[header.nachname]), text(row[header.vorname])].filter(Boolean).join(' '),
				gender: text(row[header.gs]).toUpperCase(),
				birth_year: number(row[header.gjahr]),
				club: text(row[header.verein]),
				points,
				ranking_place: number(row[header.ranglistenplatz ?? header.rang]),
			});
		}
	}
	if (!found_header || !rows.length) throw new Error('Die Excel-Datei enthält keine lesbare DBV-Rangliste.');
	return rows;
}

function event_family(event) {
	const age = /\bU\s*(\d{1,2})\b/i.exec(text(event.name));
	if (age) return Number(age[1]) <= 19 ? 'u19' : 'o19';
	if (Number(event.max_age) > 0 && Number(event.max_age) <= 19) return 'u19';
	return 'o19';
}

function event_discipline(event, player) {
	const name = text(event.name).toUpperCase();
	const mixed_discipline = () => {
		if (/^(w|f)$/i.test(text(player.gender)) || Number(player.gender_id) === 2) return 'DM';
		if (/^m$/i.test(text(player.gender)) || Number(player.gender_id) === 1) return 'HM';
		return '';
	};
	if (/\b(MX|GD|HM|DM|MIXED)\b/.test(name)) {
		return mixed_discipline();
	}
	const code = /\b(HE|DE|HD|DD|JE|ME|JD|MD)\b/.exec(name);
	if (code) return ({ JE: 'HE', ME: 'DE', JD: 'HD', MD: 'DD' })[code[1]] || code[1];
	const gender = Number(event.gender_id);
	const game = Number(event.game_type_id);
	if (gender === 3) return mixed_discipline();
	if (game === 1 && (gender === 1 || gender === 2)) return gender === 1 ? 'HE' : 'DE';
	if ((game === 2 || game === 3) && (gender === 1 || gender === 2)) return gender === 1 ? 'HD' : 'DD';
	return '';
}

function event_key(event) {
	return String(event.id ?? event.name);
}

function collect_candidates(tournament, family, event_keys) {
	const candidates = [];
	for (const event of tournament.events?.events || []) {
		if (event_keys ? !event_keys.includes(event_key(event)) : event_family(event) !== family) continue;
		for (const stage of event.stages || []) {
			for (const entry of stage.entries || []) {
				for (const [index, player] of (entry.team?.players || []).entries()) {
					const key = String(entry.stage_entry_id || entry.entry_id || 'entry') + ':' + String(player.btp_id ?? index);
					const details = tournament.registration_xlsx_metadata?.by_registration_key?.[key];
					candidates.push({
						key,
						event_key: event_key(event),
						discipline: event_discipline(event, { ...player, gender: player.gender || details?.gender }),
						event_name: event.name,
						player_name: player.name || [player.firstname, player.lastname].filter(Boolean).join(' '),
						member_id: player.member_id || details?.member_id || '',
						birth_year: Number(text(player.date_of_birth || details?.date_of_birth).slice(0, 4)) || null,
						club: player.club || details?.club || '',
					});
				}
			}
		}
	}
	return candidates;
}

function match(rows, candidates) {
	const by_id = new Map(), by_name = new Map();
	function add(map, key, row) {
		if (!map.has(key)) map.set(key, new Set());
		map.get(key).add(row);
	}
	for (const row of rows) {
		if (member_id(row.member_id)) add(by_id, row.discipline + ':' + member_id(row.member_id), row);
		add(by_name, row.discipline + ':' + norm(row.player_name), row);
		add(by_name, row.discipline + ':' + norm(row.reversed_name), row);
	}
	const by_registration_key = {}, unmatched = [];
	let matched_count = 0;
	for (const candidate of candidates) {
		const id = member_id(candidate.member_id);
		let matching = [...((id ? by_id.get(candidate.discipline + ':' + id) :
			by_name.get(candidate.discipline + ':' + norm(candidate.player_name))) || [])];
		if (!id) {
			matching = matching.filter(row => (!candidate.birth_year || !row.birth_year || candidate.birth_year === row.birth_year) &&
				(!norm(candidate.club) || !norm(row.club) || norm(row.club) === norm(candidate.club)));
		}
		// Even duplicate IDs must agree on the imported values.
		const unique = new Map(matching.map(row => [JSON.stringify([row.member_id, row.player_name, row.points, row.ranking_place]), row]));
		const row = unique.size === 1 ? unique.values().next().value : null;
		const missing = !!candidate.discipline && unique.size === 0;
		by_registration_key[candidate.key] = {
			player_name: candidate.player_name,
			member_id: candidate.member_id || '',
			discipline: candidate.discipline,
			points: row ? row.points : missing ? 0 : null,
			ranking_place: row ? row.ranking_place : null,
		};
		if (row) matched_count++;
		else unmatched.push({
			event_key: candidate.event_key,
			event_name: candidate.event_name,
			player_name: candidate.player_name,
			reason: !candidate.discipline ? 'Disziplin nicht erkannt' : unique.size > 1 ? 'Mehrdeutiger Treffer' : 'Kein Ranglisteneintrag – 0 Punkte',
		});
	}
	return { by_registration_key, matched_count, candidate_count: candidates.length, unmatched_count: unmatched.length, unmatched };
}

module.exports = { parse, match, collect_candidates, event_family, event_key };
