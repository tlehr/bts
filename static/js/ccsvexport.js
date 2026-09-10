'use strict';

var ccsvexport = (function() {

function get_xlsx_api() {
	if (typeof xlsx !== 'undefined' && xlsx) {
		return xlsx;
	}
	if (typeof XLSX !== 'undefined' && XLSX) {
		return XLSX;
	}
	throw new Error('XLSX library is not available');
}

function pad(value, len) {
	let str = String(value);
	while (str.length < len) {
		str = '0' + str;
	}
	return str;
}

function make_csv(table) {
	return table.map((row) => {
		return row.map((val) => {
			const str = '' + (val == null ? '' : val);
			if (/^[-:#_a-z0-9A-Z. ]*$/.test(str)) {
				return str;
			}
			return '"' + str.replace(/"/g, '""') + '"';
		}).join(';');
	}).join('\r\n');
}

function format_date_for_certificate(date) {
	const day = pad(date.getDate(), 2);
	const month = pad(date.getMonth() + 1, 2);
	const year = date.getFullYear();
	return `${day}.${month}.${year}`;
}

function normalize_certificate_date(value, fallback_date) {
	const raw = String(value || '').trim();
	if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
		return raw;
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
		const [year, month, day] = raw.split('-');
		return `${day}.${month}.${year}`;
	}
	return format_date_for_certificate(fallback_date || new Date());
}

function split_tournament_title(tournament_name, tournament) {
	if (tournament?.certificate_title_line_1 || tournament?.certificate_title_line_2) {
		return {
			veranstaltung_1: tournament.certificate_title_line_1 || '',
			veranstaltung_2: tournament.certificate_title_line_2 || '',
		};
	}

	const raw = String(tournament_name || '').trim();
	if (raw.includes('\n')) {
		const parts = raw.split(/\r?\n/);
		return {
			veranstaltung_1: (parts[0] || '').trim(),
			veranstaltung_2: parts.slice(1).join(' ').trim(),
		};
	}

	const dash_index = raw.indexOf(' - ');
	if (dash_index !== -1) {
		return {
			veranstaltung_1: raw.slice(0, dash_index).trim(),
			veranstaltung_2: raw.slice(dash_index + 3).trim(),
		};
	}

	return {
		veranstaltung_1: raw,
		veranstaltung_2: '',
	};
}

function normalize_certificate_event_name(event_name) {
	const normalized = String(event_name || '').trim();
	if (normalized === '') return '';
	const separatorIndex = normalized.indexOf(' - ');
	if (separatorIndex === -1) return normalized;
	return normalized.slice(0, separatorIndex).trim();
}

function stage_sort_key(meta) {
	const display_order = Number(meta?.stage_display_order);
	if (Number.isFinite(display_order)) {
		return display_order;
	}
	const draw_position = Number(meta?.draw_position);
	if (Number.isFinite(draw_position)) {
		return draw_position;
	}
	return Number.MAX_SAFE_INTEGER;
}

function get_stage_group_key(match) {
	const setup = match?.setup || {};
	if (setup.stage_id != null) {
		return `stage:${setup.stage_id}`;
	}
	return `event:${normalize_certificate_event_name(setup.event_name)}`;
}

function build_event_match_index(matches) {
	const event_map = new Map();
	for (const match of matches || []) {
		const event_name = normalize_certificate_event_name(match?.setup?.event_name);
		if (event_name === '') continue;
		if (!event_map.has(event_name)) {
			event_map.set(event_name, []);
		}
		event_map.get(event_name).push(match);
	}
	return event_map;
}

function group_matches_by_stage(matches, event_name) {
	const groups = new Map();
	for (const match of matches || []) {
		const setup = match?.setup;
		if (!setup) continue;
		if (normalize_certificate_event_name(setup.event_name) !== event_name) continue;
		const key = get_stage_group_key(match);
		if (!groups.has(key)) {
			groups.set(key, {
				key,
				stage_id: setup.stage_id,
				stage_name: setup.stage_name,
				stage_type: setup.stage_type,
				stage_display_order: setup.stage_display_order,
				draw_position: setup.draw_position,
				matches: [],
			});
		}
		groups.get(key).matches.push(match);
	}
	return [...groups.values()].sort((a, b) => {
		const cmp = stage_sort_key(a) - stage_sort_key(b);
		if (cmp !== 0) return cmp;
		return String(a.key).localeCompare(String(b.key));
	});
}

function get_certificate_placement_stage_matches(matches, event_name) {
	const stage_groups = group_matches_by_stage(matches, event_name);
	const first_stage_group = stage_groups[0];
	if (!first_stage_group) return [];
	const selected_stage_id = first_stage_group.stage_id;
	if (selected_stage_id != null) {
		return stage_groups
			.filter((stage_group) => stage_group.stage_id === selected_stage_id)
			.flatMap((stage_group) => stage_group.matches);
	}
	const selected_sort_key = stage_sort_key(first_stage_group);
	return stage_groups
		.filter((stage_group) => stage_sort_key(stage_group) === selected_sort_key)
		.flatMap((stage_group) => stage_group.matches);
}

function stage_matches_are_complete(matches) {
	return (matches || []).length > 0 && (matches || []).every((match) => get_winner_team_index(match) != null);
}

function get_group_match_context(matches, event_name) {
	const relevant_matches = (matches || []).filter((match) => {
		if (!match?.setup) return false;
		if (normalize_certificate_event_name(match.setup.event_name) !== event_name) return false;
		return is_group_match(match);
	});

	if (relevant_matches.length === 0) {
		return { valid: false, relevant_matches: [], standings: new Map(), complete: false };
	}

	const standings = new Map();
	const pair_results = new Map();
	let complete = true;

	for (const match of relevant_matches) {
		if (!match?.setup?.teams || match.setup.teams.length < 2) {
			return { valid: false, relevant_matches, standings: new Map(), complete: false };
		}
		const team_keys = match.setup.teams.slice(0, 2).map(get_team_key);
		if (!team_keys[0] || !team_keys[1] || team_keys[0] === team_keys[1]) {
			return { valid: false, relevant_matches, standings: new Map(), complete: false };
		}

		for (let team_index = 0; team_index < 2; team_index += 1) {
			const team_key = team_keys[team_index];
			if (!standings.has(team_key)) {
				standings.set(team_key, {
					team_key,
					team: clone_team(match.setup.teams[team_index]),
					matches_played: 0,
					matches_won: 0,
					matches_lost: 0,
					remaining_matches: 0,
					sets_for: 0,
					sets_against: 0,
					points_for: 0,
					points_against: 0,
				});
			}
		}

		const winner_team_index = get_winner_team_index(match);
		if (winner_team_index == null) {
			complete = false;
			standings.get(team_keys[0]).remaining_matches += 1;
			standings.get(team_keys[1]).remaining_matches += 1;
			continue;
		}

		const loser_team_index = winner_team_index === 0 ? 1 : 0;
		const score_totals = get_score_totals(match);
		const team1 = standings.get(team_keys[0]);
		const team2 = standings.get(team_keys[1]);
		team1.matches_played += 1;
		team2.matches_played += 1;
		team1.matches_won += winner_team_index === 0 ? 1 : 0;
		team2.matches_won += winner_team_index === 1 ? 1 : 0;
		team1.matches_lost += loser_team_index === 0 ? 1 : 0;
		team2.matches_lost += loser_team_index === 1 ? 1 : 0;
		team1.sets_for += score_totals.sets_for[0];
		team1.sets_against += score_totals.sets_for[1];
		team2.sets_for += score_totals.sets_for[1];
		team2.sets_against += score_totals.sets_for[0];
		team1.points_for += score_totals.points_for[0];
		team1.points_against += score_totals.points_for[1];
		team2.points_for += score_totals.points_for[1];
		team2.points_against += score_totals.points_for[0];

		const pair_key = [...team_keys].sort().join('::');
		pair_results.set(pair_key, {
			winner_team_key: team_keys[winner_team_index],
		});
	}

	const team_count = standings.size;
	const expected_matches = (team_count * (team_count - 1)) / 2;
	if (team_count < 2 || relevant_matches.length !== expected_matches) {
		return { valid: false, relevant_matches, standings, pair_results, complete };
	}

	return { valid: true, relevant_matches, standings, pair_results, complete };
}

	function parse_event_name(event_name) {
	const normalized = normalize_certificate_event_name(event_name);
	const match = /^([A-Z]+)\s+([OU]\s*\d+)\b/i.exec(normalized);
	const code = match ? match[1].toUpperCase() : normalized.split(/\s+/)[0].toUpperCase();
	const ak = match ? match[2].replace(/\s+/g, '') : '';
	const kind = ({
		HE: 'single',
		DE: 'single',
		JE: 'single',
		ME: 'single',
		E: 'single',
		S: 'single',
		HD: 'double',
		DD: 'double',
		JD: 'double',
		MD: 'double',
		D: 'double',
		GD: 'double',
		MX: 'double',
	})[code] || null;

	const discipline = {
		HE: 'Herreneinzel',
		DE: 'Dameneinzel',
		HD: 'Herrendoppel',
		DD: 'Damendoppel',
		GD: 'Gemischtes Doppel',
		MX: 'Gemischtes Doppel',
		JE: 'Jungeneinzel',
		ME: 'Mädcheneinzel',
		JD: 'Jungendoppel',
		MD: 'Mädchendoppel',
		E: 'Einzel',
		D: 'Doppel',
		S: 'Einzel',
	}[code] || normalized;

	return {
		disziplin: discipline,
		ak,
		code,
		kind,
	};
}

function parse_age_group_number(age_group) {
	const match = /^[UO]\s*(\d+)$/i.exec(String(age_group || '').trim());
	return match ? Number(match[1]) : null;
}

function parse_age_group_type(age_group) {
	const match = /^([UO])\s*\d+$/i.exec(String(age_group || '').trim());
	return match ? match[1].toUpperCase() : '';
}

function format_age_group(age_number) {
	return Number.isFinite(Number(age_number)) ? `U${Number(age_number)}` : '';
}

const CERTIFICATE_YOUTH_AGE_NUMBERS = [9, 11, 13, 15, 17, 19, 22];

function get_possible_certificate_youth_age_numbers(source_age_number, candidate_age_numbers = []) {
	const source = Number(source_age_number);
	if (!Number.isFinite(source)) return [];
	return [...new Set([
		source,
		...candidate_age_numbers,
		...CERTIFICATE_YOUTH_AGE_NUMBERS.filter((age_number) => age_number < source),
	])]
		.filter((age_number) => Number.isFinite(Number(age_number)))
		.sort((a, b) => a - b);
}

function get_youth_birth_year_range(age_number, age_reference_year) {
	const number = Number(age_number);
	const year = Number(age_reference_year);
	if (!Number.isFinite(number) || !Number.isFinite(year)) return null;
	return {
		from: year - number + 1,
		to: year - number + 2,
	};
}

function get_player_birth_year(player) {
	const direct = Number(player?.birth_year);
	if (Number.isFinite(direct)) return direct;
	const raw_date = String(player?.date_of_birth || '').trim();
	const match = /^(\d{4})/.exec(raw_date);
	return match ? Number(match[1]) : null;
}

function birth_year_matches_youth_age_group(birth_year, age_number, age_reference_year) {
	const range = get_youth_birth_year_range(age_number, age_reference_year);
	return !!range && birth_year >= range.from && birth_year <= range.to;
}

function infer_certificate_age_reference_year(matches) {
	const draw_event_names = get_draw_event_name_index(matches);
	const score_by_year = new Map();
	const seen_samples = new Set();
	for (const match of matches || []) {
		for (const team of match?.setup?.teams || []) {
			for (const player of team?.players || []) {
				const birth_year = get_player_birth_year(player);
				if (birth_year == null || !player?.entries) continue;
				for (const draw_id of Object.keys(player.entries)) {
					const event_name = draw_event_names.get(String(draw_id));
					if (!event_name) continue;
					const event_info = parse_event_name(event_name);
					if (parse_age_group_type(event_info.ak) !== 'U') continue;
					const age_number = parse_age_group_number(event_info.ak);
					if (age_number == null) continue;
					const sample_key = `${player.btp_id || player.name || JSON.stringify(player)}:${draw_id}:${birth_year}:${age_number}`;
					if (seen_samples.has(sample_key)) continue;
					seen_samples.add(sample_key);
					for (const candidate_year of [birth_year + age_number - 1, birth_year + age_number - 2]) {
						score_by_year.set(candidate_year, (score_by_year.get(candidate_year) || 0) + 1);
					}
				}
			}
		}
	}
	let best_year = null;
	let best_score = 0;
	let tied = false;
	for (const [year, score] of score_by_year) {
		if (score > best_score) {
			best_year = year;
			best_score = score;
			tied = false;
		} else if (score === best_score) {
			tied = true;
		}
	}
	return best_score > 0 && !tied ? best_year : null;
}

function get_youth_age_number_from_birth_year(birth_year, age_reference_year, possible_age_numbers) {
	const year = Number(birth_year);
	if (!Number.isFinite(year) || !Number.isFinite(Number(age_reference_year))) return null;
	const age_numbers = [...new Set((possible_age_numbers || [])
		.map((age_number) => Number(age_number))
		.filter((age_number) => Number.isFinite(age_number)))]
		.sort((a, b) => a - b);
	for (let index = 0; index < age_numbers.length; index += 1) {
		const age_number = age_numbers[index];
		const range = get_youth_birth_year_range(age_number, age_reference_year);
		if (!range) continue;
		if (index === 0 && year >= range.from) {
			return age_number;
		}
		const younger_range = get_youth_birth_year_range(age_numbers[index - 1], age_reference_year);
		if (younger_range && year >= range.from && year < younger_range.from) {
			return age_number;
		}
	}
	return null;
}

function normalize_certificate_discipline_code(value) {
	const normalized = String(value || '').trim().toUpperCase();
	if (!normalized || normalized === '*' || normalized === 'ALL') {
		return '';
	}
	return normalized.replace(/\s+/g, '');
}

function normalize_certificate_discipline_replacements(value) {
	const result = [];
	if (!Array.isArray(value)) {
		return result;
	}
	for (const replacement of value) {
		if (!replacement || typeof replacement !== 'object') continue;
		const discipline = normalize_certificate_discipline_code(replacement.discipline);
		const replace = String(replacement.replace || '').trim();
		if (!discipline || !replace) continue;
		result.push({
			discipline,
			replace,
		});
	}
	return result;
}

function get_certificate_discipline_replacements(tournament, options = {}) {
	if (Array.isArray(options.certificate_discipline_replacements)) {
		return normalize_certificate_discipline_replacements(options.certificate_discipline_replacements);
	}
	return normalize_certificate_discipline_replacements(tournament?.certificate_discipline_replacements);
}

function get_certificate_discipline_label(event_info, replacements) {
	const code = normalize_certificate_discipline_code(event_info?.code);
	for (const replacement of replacements || []) {
		if (replacement.discipline === code) {
			return replacement.replace;
		}
	}
	return event_info?.disziplin || '';
}

function parse_place_range(match_name) {
	const normalized = String(match_name || '').trim();
	const direct_match = /^(\d+)\s*\/\s*(\d+)$/.exec(normalized);
	if (direct_match) {
		return {
			place_from: Number(direct_match[1]),
			place_to: Number(direct_match[2]),
		};
	}

	const named_places = new Map([
		['Finale', [1, 2]],
		['3/4', [3, 4]],
		['5/6', [5, 6]],
		['7/8', [7, 8]],
		['9/10', [9, 10]],
		['11/12', [11, 12]],
		['13/14', [13, 14]],
		['15/16', [15, 16]],
		['17/18', [17, 18]],
		['19/20', [19, 20]],
		['21/22', [21, 22]],
		['23/24', [23, 24]],
		['25/26', [25, 26]],
		['27/28', [27, 28]],
		['29/30', [29, 30]],
		['31/32', [31, 32]],
	]);
	const named_range = named_places.get(normalized);
	if (!named_range) return null;
	return {
		place_from: named_range[0],
		place_to: named_range[1],
	};
}

function get_winner_team_index(match) {
	if (typeof match?.team1_won === 'boolean') {
		return match.team1_won ? 0 : 1;
	}
	if (match?.btp_winner === 1 || match?.btp_winner === 2) {
		return match.btp_winner - 1;
	}
	return null;
}

function is_group_match(match) {
	const match_name = String(match?.setup?.match_name || '').trim();
	const phase_block_key = String(match?.setup?.phase_block_key || '').trim();
	return /^G\d+$/i.test(match_name) || /^G\d+$/i.test(phase_block_key);
}

function get_team_key(team) {
	const players = Array.isArray(team?.players) ? team.players : [];
	return players.map((player) => {
		if (player?.btp_id != null) return `btp:${player.btp_id}`;
		if (player?.name) return `name:${player.name}`;
		return `player:${JSON.stringify(player || null)}`;
	}).join('|');
}

function get_draw_event_name_index(matches) {
	const draw_event_names = new Map();
	for (const match of matches || []) {
		const setup = match?.setup || {};
		if (setup.draw_id == null) continue;
		const event_name = normalize_certificate_event_name(setup.event_name);
		if (event_name) {
			draw_event_names.set(String(setup.draw_id), event_name);
		}
	}
	return draw_event_names;
}

function certificate_event_codes_are_compatible(source_info, candidate_info) {
	if (!source_info || !candidate_info) return false;
	if (!source_info.kind || source_info.kind !== candidate_info.kind) return false;
	if (source_info.code === candidate_info.code) return true;
	if (source_info.kind === 'single') {
		return ['E', 'S'].includes(candidate_info.code) || ['E', 'S'].includes(source_info.code);
	}
	if (source_info.kind === 'double') {
		return candidate_info.code === 'D' || source_info.code === 'D';
	}
	return false;
}

function certificate_entry_can_identify_age(source_info, entry_info) {
	if (!source_info || !entry_info) return false;
	if (source_info.kind === 'single') {
		return entry_info.kind === 'single';
	}
	if (source_info.kind === 'double') {
		return entry_info.kind === 'double' || entry_info.kind === 'single';
	}
	return true;
}

function get_tournament_certificate_events(tournament) {
	if (Array.isArray(tournament?.events?.events)) return tournament.events.events;
	if (Array.isArray(tournament?.events)) return tournament.events;
	return [];
}

function get_certificate_age_class_candidates(
	event_entry,
	tournament,
	event_matches = [],
	draw_event_names = new Map(),
	age_reference_year = null,
	existing_event_names = []
) {
	const source_info = parse_event_name(event_entry?.event_name);
	const source_age_number = parse_age_group_number(source_info.ak);
	if (source_age_number == null) return [];
	const candidates = new Set();
	const existing_age_numbers = new Set();
	for (const event_name of existing_event_names || []) {
		const normalized_event_name = normalize_certificate_event_name(event_name);
		if (!normalized_event_name || normalized_event_name === event_entry?.event_name) continue;
		const candidate_info = parse_event_name(normalized_event_name);
		const candidate_age_number = parse_age_group_number(candidate_info.ak);
		if (candidate_age_number == null || candidate_age_number >= source_age_number) continue;
		if (!certificate_event_codes_are_compatible(source_info, candidate_info)) continue;
		existing_age_numbers.add(candidate_age_number);
	}
	if (parse_age_group_type(source_info.ak) === 'U' && age_reference_year != null) {
		const possible_age_numbers = get_possible_certificate_youth_age_numbers(source_age_number, existing_age_numbers);
		for (const match of event_matches || []) {
			if (normalize_certificate_event_name(match?.setup?.event_name) !== event_entry?.event_name) continue;
			for (const team of match?.setup?.teams || []) {
				if (!is_certificate_starter_team(team)) continue;
				const age_number = get_team_certificate_age_number(
					team,
					draw_event_names,
					event_entry.event_name,
					possible_age_numbers,
					age_reference_year
				);
				for (const candidate_age_number of possible_age_numbers) {
					if (
						age_number != null
						&& age_number <= candidate_age_number
						&& candidate_age_number < source_age_number
						&& !existing_age_numbers.has(candidate_age_number)
					) {
						candidates.add(candidate_age_number);
					}
				}
			}
		}
	}
	return [...candidates].sort((a, b) => a - b);
}

function normalize_certificate_age_class_splits(value) {
	const result = new Map();
	if (!value || typeof value !== 'object') return result;
	for (const [event_name, age_groups] of Object.entries(value)) {
		const normalized_event_name = normalize_certificate_event_name(event_name);
		if (!normalized_event_name || !Array.isArray(age_groups)) continue;
		const normalized_age_groups = [...new Set(age_groups
			.map((age_group) => String(age_group || '').replace(/\s+/g, '').toUpperCase())
			.filter((age_group) => /^[UO]\d+$/.test(age_group)))]
			.sort((a, b) => cbts_utils.natcmp(a, b));
		if (normalized_age_groups.length > 0) {
			result.set(normalized_event_name, new Set(normalized_age_groups));
		}
	}
	return result;
}

function get_enabled_certificate_age_class_splits(tournament, options = {}) {
	if (options.certificate_age_class_splits instanceof Map) {
		return options.certificate_age_class_splits;
	}
	return normalize_certificate_age_class_splits(
		options.certificate_age_class_splits || tournament?.certificate_age_class_splits
	);
}

function get_player_certificate_age_number(
	player,
	draw_event_names,
	fallback_event_name,
	candidate_age_numbers = [],
	age_reference_year = null
) {
	const fallback_info = parse_event_name(fallback_event_name);
	const fallback_age_number = parse_age_group_number(fallback_info.ak);
	const birth_year = get_player_birth_year(player);
	if (birth_year != null && age_reference_year != null) {
		const birth_age_number = get_youth_age_number_from_birth_year(
			birth_year,
			age_reference_year,
			[fallback_age_number, ...candidate_age_numbers]
		);
		if (birth_age_number != null) return birth_age_number;
	}
	const age_numbers = [];
	for (const draw_id of Object.keys(player?.entries || {})) {
		const entry_event_name = draw_event_names.get(String(draw_id));
		if (!entry_event_name) continue;
		const entry_info = parse_event_name(entry_event_name);
		if (!certificate_entry_can_identify_age(fallback_info, entry_info)) continue;
		const age_number = parse_age_group_number(entry_info.ak);
		if (age_number != null) {
			age_numbers.push(age_number);
		}
	}
	if (age_numbers.length > 0) {
		return Math.min(...age_numbers);
	}
	return fallback_age_number;
}

function get_team_certificate_age_number(
	team,
	draw_event_names,
	fallback_event_name,
	candidate_age_numbers = [],
	age_reference_year = null
) {
	const player_age_numbers = (team?.players || [])
		.map((player) => get_player_certificate_age_number(
			player,
			draw_event_names,
			fallback_event_name,
			candidate_age_numbers,
			age_reference_year
		))
		.filter((age_number) => age_number != null);
	if (player_age_numbers.length === 0) {
		return parse_age_group_number(parse_event_name(fallback_event_name).ak);
	}
	return Math.max(...player_age_numbers);
}

function is_placeholder_player(player) {
	const name = String(player?.name || '').trim();
	return /^(Gewinner|Verlierer)\s+#/i.test(name);
}

function is_certificate_starter_team(team) {
	const players = Array.isArray(team?.players) ? team.players : [];
	return players.length > 0 && players.some((player) => player && !is_placeholder_player(player));
}

function clone_team(team) {
	return JSON.parse(JSON.stringify(team || null));
}

function get_score_totals(match) {
	const totals = {
		sets_for: [0, 0],
		points_for: [0, 0],
	};
	if (!Array.isArray(match?.network_score)) {
		return totals;
	}
	for (const set of match.network_score) {
		if (!Array.isArray(set) || set.length < 2) continue;
		const team1 = Number(set[0]) || 0;
		const team2 = Number(set[1]) || 0;
		totals.points_for[0] += team1;
		totals.points_for[1] += team2;
		if (team1 > team2) {
			totals.sets_for[0] += 1;
		} else if (team2 > team1) {
			totals.sets_for[1] += 1;
		}
	}
	return totals;
}

function compare_group_stats(a, b) {
	if (a.matches_won !== b.matches_won) return b.matches_won - a.matches_won;
	const a_set_diff = a.sets_for - a.sets_against;
	const b_set_diff = b.sets_for - b.sets_against;
	if (a_set_diff !== b_set_diff) return b_set_diff - a_set_diff;
	const a_point_diff = a.points_for - a.points_against;
	const b_point_diff = b.points_for - b.points_against;
	if (a_point_diff !== b_point_diff) return b_point_diff - a_point_diff;
	if (a.points_for !== b.points_for) return b.points_for - a.points_for;
	return 0;
}

function sort_group_tie_group(group, pair_results) {
	if (group.length !== 2) return null;
	const left = group[0];
	const right = group[1];
	const pair_key = [left.team_key, right.team_key].sort().join('::');
	const pair = pair_results.get(pair_key);
	if (!pair || pair.winner_team_key == null) return null;
	if (pair.winner_team_key === left.team_key) return [left, right];
	if (pair.winner_team_key === right.team_key) return [right, left];
	return null;
}

function compute_group_placements(matches, event_name) {
	const context = get_group_match_context(matches, event_name);
	if (!context.valid || !context.complete) return [];
	const standings = context.standings;
	const pair_results = context.pair_results;

	const base_sorted = [...standings.values()].sort((a, b) => {
		const cmp = compare_group_stats(a, b);
		if (cmp !== 0) return cmp;
		return a.team_key.localeCompare(b.team_key);
	});

	const resolved = [];
	for (let idx = 0; idx < base_sorted.length;) {
		const group = [base_sorted[idx]];
		idx += 1;
		while (idx < base_sorted.length && compare_group_stats(group[0], base_sorted[idx]) === 0) {
			group.push(base_sorted[idx]);
			idx += 1;
		}
		if (group.length === 1) {
			resolved.push(group[0]);
			continue;
		}
		const tie_break = sort_group_tie_group(group, pair_results);
		if (!tie_break) return [];
		resolved.push(...tie_break);
	}

	return resolved.map((entry, index) => ({
		place_from: index + 1,
		place_to: index + 1,
		team: clone_team(entry.team),
		source: 'group_matches',
		confidence: 'derived',
		event_name,
	}));
}

function get_btp_stage_ranking_entries(stage_matches, event_name) {
	for (const match of stage_matches || []) {
		if (!Array.isArray(match?.setup?.btp_group_rankings) || match.setup.btp_group_rankings.length === 0) continue;
		return match.setup.btp_group_rankings
			.map((entry) => ({
				place_from: Number(entry.place_from),
				place_to: Number(entry.place_to ?? entry.place_from),
				team: clone_team(entry.team),
				event_name: entry.event_name || event_name,
				source: entry.source || 'btp_ranking',
				confidence: entry.confidence || 'authoritative',
				}))
				.filter((entry) => Number.isFinite(entry.place_from) && Number.isFinite(entry.place_to) && entry.team)
				.sort((a, b) => a.place_from - b.place_from);
	}
	return [];
}

function get_stable_btp_group_placements(stage_matches, event_name) {
	const context = get_group_match_context(stage_matches, event_name);
	if (!context.valid) return [];
	const rankings = get_btp_stage_ranking_entries(stage_matches, event_name);
	const locked_placements = [];
	const locked_team_keys = new Set();

	for (const entry of rankings) {
		if (entry.place_from !== entry.place_to) break;
		const team_key = get_team_key(entry.team);
		const stats = context.standings.get(team_key);
		if (!stats) break;
		const max_other_wins = [...context.standings.values()]
			.filter((other) => other.team_key !== team_key && !locked_team_keys.has(other.team_key))
			.reduce((max_wins, other) => Math.max(max_wins, other.matches_won + other.remaining_matches), -1);
		if (stats.matches_won <= max_other_wins) break;
		locked_team_keys.add(team_key);
		locked_placements.push({
			...entry,
			source: entry.source || 'btp_ranking',
			confidence: context.complete ? 'authoritative' : 'stable_prefix',
		});
	}

	return locked_placements;
}

function get_btp_stage_placements(stage_matches, event_name) {
	if (!stage_matches_are_complete(stage_matches)) {
		return get_stable_btp_group_placements(stage_matches, event_name);
	}
	return get_btp_stage_ranking_entries(stage_matches, event_name);
}

function get_exact_stage_placements(stage_matches, event_name) {
	const exact_placements = [];
	for (const match of stage_matches || []) {
		const match_event_name = normalize_certificate_event_name(match?.setup?.event_name);
		if (match_event_name !== event_name) continue;
		const winner_team_index = get_winner_team_index(match);
		if (winner_team_index == null) continue;
		const range = parse_place_range(match?.setup?.match_name);
		if (!range) continue;
		if ((range.place_to - range.place_from) !== 1) continue;
		if (!match?.setup?.teams || match.setup.teams.length < 2) continue;
		exact_placements.push({
			place_from: range.place_from,
			place_to: range.place_from,
			team: clone_team(match.setup.teams[winner_team_index]),
			event_name,
			source: 'placement_match',
			confidence: 'exact',
		});
		exact_placements.push({
			place_from: range.place_to,
			place_to: range.place_to,
			team: clone_team(match.setup.teams[winner_team_index === 0 ? 1 : 0]),
			event_name,
			source: 'placement_match',
			confidence: 'exact',
		});
	}
	return exact_placements.sort((a, b) => a.place_from - b.place_from);
}

function compute_event_placements(matches, event_name) {
	const stage_matches = get_certificate_placement_stage_matches(matches, event_name);
	const exact = get_exact_stage_placements(stage_matches, event_name);
	if (exact.length > 0) {
		return exact;
	}
	const btp = get_btp_stage_placements(stage_matches, event_name);
	if (btp.length > 0) {
		return btp;
	}
	const grouped = compute_group_placements(stage_matches, event_name);
	if (grouped.length > 0) {
		return grouped;
	}
	return [];
}

function get_player_display_name(player) {
	if (!player) return '';
	if (player.name) return player.name;
	const firstname = player.firstname || '';
	const lastname = player.lastname || '';
	return `${firstname} ${lastname}`.trim();
}

function format_place_label(place_from, place_to) {
	if (place_from === place_to) {
		return `${place_from}. Platz`;
	}
	return `${place_from}.-${place_to}. Platz`;
}

function get_latest_scheduled_match_info(matches, event_name) {
	let latest = null;
	for (const match of matches || []) {
		if (normalize_certificate_event_name(match?.setup?.event_name) !== event_name) continue;
		const scheduled_date = String(match?.setup?.scheduled_date || '').trim();
		if (!scheduled_date) continue;
		const scheduled_time = String(match?.setup?.scheduled_time_str || '').trim();
		const timestamp = `${scheduled_date} ${scheduled_time || '00:00'}`;
		if (!latest || timestamp > latest.timestamp) {
			latest = {
				date: scheduled_date,
				time: scheduled_time,
				timestamp,
			};
		}
	}
	return latest;
}

function get_certificate_event_starter_count(matches, event_name) {
	const team_keys = new Set();
	let max_ranked_place = 0;
	for (const match of matches || []) {
		if (normalize_certificate_event_name(match?.setup?.event_name) !== event_name) continue;
		const rankings = Array.isArray(match?.setup?.btp_group_rankings) ? match.setup.btp_group_rankings : [];
		for (const ranking of rankings) {
			if (is_certificate_starter_team(ranking?.team)) {
				const team_key = get_team_key(ranking.team);
				if (team_key) team_keys.add(team_key);
				const place_to = Number(ranking.place_to ?? ranking.place_from);
				if (Number.isFinite(place_to)) {
					max_ranked_place = Math.max(max_ranked_place, place_to);
				}
			}
		}
		for (const team of match?.setup?.teams || []) {
			if (!is_certificate_starter_team(team)) continue;
			const team_key = get_team_key(team);
			if (team_key) team_keys.add(team_key);
		}
	}
	return Math.max(team_keys.size, max_ranked_place);
}

function get_certificate_age_class_starter_counts(
	matches,
	event_name,
	draw_event_names,
	candidate_age_numbers = [],
	age_reference_year = null
) {
	const counts = new Map();
	const team_keys_by_age = new Map();
	for (const match of matches || []) {
		if (normalize_certificate_event_name(match?.setup?.event_name) !== event_name) continue;
		for (const team of match?.setup?.teams || []) {
			if (!is_certificate_starter_team(team)) continue;
			const event_age_number = parse_age_group_number(parse_event_name(event_name).ak);
			const possible_age_numbers = get_possible_certificate_youth_age_numbers(event_age_number, candidate_age_numbers);
			const team_age_number = get_team_certificate_age_number(
				team,
				draw_event_names,
				event_name,
				possible_age_numbers,
				age_reference_year
			);
			if (team_age_number == null) continue;
			for (const age_number of candidate_age_numbers || []) {
				if (event_age_number != null && age_number >= event_age_number) continue;
				if (team_age_number > age_number) continue;
				if (!team_keys_by_age.has(age_number)) {
					team_keys_by_age.set(age_number, new Set());
				}
				const team_key = get_team_key(team);
				if (team_key) team_keys_by_age.get(age_number).add(team_key);
			}
		}
	}
	for (const [age_number, team_keys] of team_keys_by_age) {
		counts.set(age_number, team_keys.size);
	}
	return counts;
}

function get_enabled_certificate_age_numbers_for_event(event_entry) {
	const age_groups = event_entry?.certificate_age_class_splits instanceof Map
		? event_entry.certificate_age_class_splits.get(event_entry.event_name)
		: null;
	if (!age_groups) return new Set();
	const allowed_age_numbers = new Set(event_entry?.age_class_candidates || []);
	return new Set([...age_groups]
		.map((age_group) => parse_age_group_number(age_group))
		.filter((age_number) => age_number != null && allowed_age_numbers.has(age_number)));
}

function get_team_certificate_age_number_for_event_entry(team, event_entry) {
	const event_age_number = parse_age_group_number(event_entry?.ak);
	return get_team_certificate_age_number(
		team,
		event_entry?.draw_event_names || new Map(),
		event_entry?.event_name || '',
		get_possible_certificate_youth_age_numbers(event_age_number, event_entry?.age_class_candidates || []),
		event_entry?.age_reference_year || null
	);
}

function get_team_certificate_split_age_number(team, event_entry) {
	const event_age_number = parse_age_group_number(event_entry?.ak);
	const exact_age_number = get_team_certificate_age_number_for_event_entry(team, event_entry);
	if (exact_age_number == null || event_age_number == null) return null;
	return [...get_enabled_certificate_age_numbers_for_event(event_entry)]
		.filter((age_number) => age_number < event_age_number && exact_age_number <= age_number)
		.sort((a, b) => a - b)[0] || null;
}

function get_certificate_assigned_age_class_starter_counts(event_entry) {
	const counts = new Map();
	const team_keys_by_age = new Map();
	for (const match of event_entry?.event_matches || []) {
		if (normalize_certificate_event_name(match?.setup?.event_name) !== event_entry?.event_name) continue;
		for (const team of match?.setup?.teams || []) {
			if (!is_certificate_starter_team(team)) continue;
			const age_number = get_team_certificate_split_age_number(team, event_entry);
			if (age_number == null) continue;
			if (!team_keys_by_age.has(age_number)) {
				team_keys_by_age.set(age_number, new Set());
			}
			const team_key = get_team_key(team);
			if (team_key) team_keys_by_age.get(age_number).add(team_key);
		}
	}
	for (const [age_number, team_keys] of team_keys_by_age) {
		counts.set(age_number, team_keys.size);
	}
	return counts;
}

function renumber_certificate_placements(placements, event_name) {
	return (placements || [])
		.slice()
		.sort((a, b) => a.place_from - b.place_from)
		.map((placement, index) => ({
			...placement,
			place_from: index + 1,
			place_to: index + 1,
			event_name,
		}));
}

function apply_certificate_parent_age_class_splits(event_entry) {
	const split_age_numbers = get_enabled_certificate_age_numbers_for_event(event_entry);
	if (split_age_numbers.size === 0) return event_entry;
	const assigned_starter_counts = get_certificate_assigned_age_class_starter_counts(event_entry);
	const filtered_placements = renumber_certificate_placements(
		(event_entry.placements || []).filter((placement) => {
			return get_team_certificate_split_age_number(placement.team, event_entry) == null;
		}),
		event_entry.event_name
	);
	const excluded_starter_count = [...split_age_numbers]
		.reduce((count, age_number) => count + (assigned_starter_counts.get(age_number) || 0), 0);
	event_entry.placements = filtered_placements;
	event_entry.available_places = new Set(filtered_placements.map((placement) => placement.place_from));
	event_entry.starter_count = Math.max(0, Number(event_entry.starter_count || 0) - excluded_starter_count);
	event_entry.assigned_age_class_starter_counts = assigned_starter_counts;
	return event_entry;
}

function build_certificate_age_class_entries(event_entry, max_place) {
	const draw_event_names = event_entry?.draw_event_names || new Map();
	const event_age_number = parse_age_group_number(event_entry?.ak);
	const placements = event_entry?.source_placements || event_entry?.placements || [];
	const starter_counts = event_entry?.age_class_starter_counts || new Map();
	const assigned_starter_counts = event_entry?.assigned_age_class_starter_counts
		|| get_certificate_assigned_age_class_starter_counts(event_entry);
	const candidate_age_numbers = event_entry?.age_class_candidates || [];
	const age_reference_year = event_entry?.age_reference_year || null;
	const available_places = event_entry?.available_places instanceof Set
		? (event_entry.source_available_places || event_entry.available_places)
		: new Set(event_entry?.available_places || []);
	const entries = [];
	const enabled_age_groups = event_entry?.certificate_age_class_splits instanceof Map
		? event_entry.certificate_age_class_splits.get(event_entry.event_name)
		: null;
	const ages = [...new Set([...starter_counts.keys(), ...candidate_age_numbers])]
		.filter((age_number) => event_age_number != null && age_number < event_age_number)
		.filter((age_number) => (assigned_starter_counts.get(age_number) || 0) > 0)
		.filter((age_number) => enabled_age_groups && enabled_age_groups.has(format_age_group(age_number)))
		.sort((a, b) => a - b);
	for (const age_number of ages) {
		const age_group = format_age_group(age_number);
		const filtered_placements = placements
			.filter((placement) => available_places.has(placement.place_from))
			.filter((placement) => get_team_certificate_split_age_number(placement.team, event_entry) === age_number)
			.sort((a, b) => a.place_from - b.place_from)
			.map((placement, index) => ({
				...placement,
				place_from: index + 1,
				place_to: index + 1,
				event_name: `${event_entry.event_name}::age:${age_group}`,
				source_event_name: event_entry.event_name,
				certificate_age_group: age_group,
				source: placement.source,
				confidence: placement.confidence,
			}));
		const entry = {
			key: `${event_entry.event_name}::age:${age_group}`,
			event_name: event_entry.event_name,
			source_event_name: event_entry.event_name,
			label: `${event_entry.disziplin} ${age_group} (aus ${event_entry.ak})`,
			disziplin: event_entry.disziplin,
			ak: age_group,
			code: event_entry.code,
			kind: event_entry.kind,
			available_places: new Set(filtered_placements.map((placement) => placement.place_from)),
			starter_count: assigned_starter_counts.get(age_number) || 0,
			pending_place_ranges: [],
			latest_scheduled_date: event_entry.latest_scheduled_date || '',
			latest_scheduled_time: event_entry.latest_scheduled_time || '',
			latest_scheduled_timestamp: event_entry.latest_scheduled_timestamp || '',
			placements: filtered_placements,
			is_age_class_split: true,
			certificate_age_group: age_group,
		};
		const expected_place_count = get_expected_certificate_place_count(entry, max_place || Infinity);
		if (filtered_placements.length < Math.min(expected_place_count, entry.starter_count || expected_place_count)) {
			const pending_from = filtered_placements.length + 1;
			entry.pending_place_ranges = [{
				place_from: pending_from,
				place_to: Number.MAX_SAFE_INTEGER,
				label: `${pending_from}. Platz der ${age_group}-Wertung unsicher`,
			}];
		}
		entries.push(entry);
	}
	return entries;
}

function get_pending_certificate_place_ranges(matches, event_name) {
	const ranges_by_key = new Map();
	const stage_matches = get_certificate_placement_stage_matches(matches, event_name);
	for (const match of stage_matches) {
		if (normalize_certificate_event_name(match?.setup?.event_name) !== event_name) continue;
		if (get_winner_team_index(match) != null) continue;
		const range = parse_place_range(match?.setup?.match_name);
		if (!range) continue;
		if ((range.place_to - range.place_from) !== 1) continue;
		const key = `${range.place_from}:${range.place_to}`;
		ranges_by_key.set(key, {
			place_from: range.place_from,
			place_to: range.place_to,
			label: `${range.place_from}/${range.place_to}`,
		});
	}
	const pending_ranges = [...ranges_by_key.values()].sort((a, b) => a.place_from - b.place_from);
	if (pending_ranges.length > 0) {
		return pending_ranges;
	}
	if (stage_matches.length > 0 && !stage_matches_are_complete(stage_matches)) {
		const stable_group_placements = get_stable_btp_group_placements(stage_matches, event_name);
		const pending_from = stable_group_placements.length + 1;
		const has_group_matches = stage_matches.some((match) => is_group_match(match));
		return [{
			place_from: pending_from,
			place_to: Number.MAX_SAFE_INTEGER,
			label: has_group_matches && pending_from > 1
				? `${pending_from}. Platz der Gruppe unsicher`
				: (has_group_matches ? '1. Platz der Gruppe unsicher' : 'Spiele'),
		}];
	}
	return [];
}

function append_certificate_rows_for_placement(rows, base_row, players, include_swapped_double_rows) {
	const spieler_1 = get_player_display_name(players[0]);
	const spieler_2 = get_player_display_name(players[1]);
	rows.push({
		...base_row,
		spieler_1,
		spieler_2,
	});
	if (include_swapped_double_rows && spieler_1 && spieler_2) {
		rows.push({
			...base_row,
			spieler_1: spieler_2,
			spieler_2: spieler_1,
		});
	}
}

function build_certificate_rows(matches, tournament, options = {}) {
	const title = {
		...split_tournament_title(tournament?.name, tournament),
	};
	if (options.veranstaltung_1 != null) {
		title.veranstaltung_1 = String(options.veranstaltung_1 || '').trim();
	}
	if (options.veranstaltung_2 != null) {
		title.veranstaltung_2 = String(options.veranstaltung_2 || '').trim();
	}
	const ort = options.ort != null
		? String(options.ort || '').trim()
		: String(tournament?.certificate_export_location || '').trim();
	const now = options.now || new Date();
	const datum = normalize_certificate_date(options.datum, now);
	const selected_event_names = options.selected_event_names instanceof Set
		? options.selected_event_names
		: null;
	const selected_certificate_keys = options.selected_certificate_keys instanceof Set
		? options.selected_certificate_keys
		: null;
	const max_place = Number.isFinite(Number(options.max_place))
		? Number(options.max_place)
		: Infinity;
	const include_swapped_double_rows =
		options.certificate_export_double_swapped_entries_enabled != null
			? !!options.certificate_export_double_swapped_entries_enabled
			: !!tournament?.certificate_export_double_swapped_entries_enabled;
	const certificate_discipline_replacements = get_certificate_discipline_replacements(tournament, options);
	const rows = [];
	const event_match_index = build_event_match_index(matches);
	const event_names = [...event_match_index.keys()];
	const certificate_age_class_splits = get_enabled_certificate_age_class_splits(tournament, options);
	const event_entries = build_certificate_event_stats(matches, {
		max_place,
		tournament,
		age_reference_year: options.age_reference_year,
		certificate_age_class_splits,
	});
	const event_entry_by_name = new Map(event_entries.map((event_entry) => [event_entry.event_name, event_entry]));

	for (const event_name of event_names) {
		if (selected_certificate_keys) {
			if (!selected_certificate_keys.has(event_name)) continue;
		} else if (selected_event_names && !selected_event_names.has(event_name)) {
			continue;
		}
		const event_entry = event_entry_by_name.get(event_name);
		if (!event_entry) continue;
		const event_info = parse_event_name(event_entry.ak ? `${event_entry.code} ${event_entry.ak}` : event_name);
		const placements = event_entry.placements || compute_event_placements(event_match_index.get(event_name) || [], event_name);
		for (const entry of placements) {
			if (entry.place_from !== entry.place_to) continue;
			if (entry.place_from > max_place) continue;
			const players = entry.team?.players || [];
				append_certificate_rows_for_placement(rows, {
					veranstaltung_1: title.veranstaltung_1,
					veranstaltung_2: title.veranstaltung_2,
					...(ort ? { ort } : {}),
					datum,
					disziplin: get_certificate_discipline_label(event_info, certificate_discipline_replacements),
				ak: event_info.ak,
				platz: format_place_label(entry.place_from, entry.place_to),
				event_name,
				place: entry.place_from,
				}, players, include_swapped_double_rows && event_info.kind === 'double');
		}
	}

	if (selected_certificate_keys) {
		for (const event_entry of event_entries) {
			for (const split_entry of build_certificate_age_class_entries(event_entry, max_place)) {
				if (!selected_certificate_keys.has(split_entry.key)) continue;
				const event_info = parse_event_name(`${split_entry.code} ${split_entry.ak}`);
				for (const entry of split_entry.placements || []) {
					if (entry.place_from !== entry.place_to) continue;
					if (entry.place_from > max_place) continue;
					const players = entry.team?.players || [];
						append_certificate_rows_for_placement(rows, {
							veranstaltung_1: title.veranstaltung_1,
							veranstaltung_2: title.veranstaltung_2,
							...(ort ? { ort } : {}),
							datum,
							disziplin: get_certificate_discipline_label(event_info, certificate_discipline_replacements),
						ak: event_info.ak,
						platz: format_place_label(entry.place_from, entry.place_to),
						event_name: split_entry.key,
						place: entry.place_from,
						}, players, include_swapped_double_rows && event_info.kind === 'double');
				}
			}
		}
	}

	rows.sort((a, b) => {
		let cmp = cbts_utils.natcmp(a.ak, b.ak);
		if (cmp !== 0) return cmp;
		cmp = cbts_utils.natcmp(a.disziplin, b.disziplin);
		if (cmp !== 0) return cmp;
		return Number(b.place || 0) - Number(a.place || 0);
	});

	return rows;
}

function certificate_rows_to_table(rows) {
	const header = [
		'Veranstaltung #1',
		'Veranstaltung #2',
		'Ort',
		'Datum',
		'Disziplin',
		'AK',
		'Platz',
		'Spieler #1',
		'Spieler #2',
	];

	const table = rows.map((row) => ([
		row.veranstaltung_1,
		row.veranstaltung_2,
		row.ort,
		row.datum,
		row.disziplin,
		row.ak,
		row.platz,
		row.spieler_1,
		row.spieler_2,
	]));
	table.unshift(header);
	return table;
}

function build_certificate_event_stats(matches, options = {}) {
	const event_map = new Map();
	const event_match_index = build_event_match_index(matches);
	const draw_event_names = get_draw_event_name_index(matches);
	const age_reference_year = options.age_reference_year || infer_certificate_age_reference_year(matches);
	const certificate_age_class_splits = options.certificate_age_class_splits instanceof Map
		? options.certificate_age_class_splits
		: get_enabled_certificate_age_class_splits(options.tournament, options);
	const event_names = [...event_match_index.keys()];
	for (const event_name of event_names) {
		const event_matches = event_match_index.get(event_name) || [];
		const placements = compute_event_placements(event_matches, event_name);
		const pending_place_ranges = get_pending_certificate_place_ranges(event_matches, event_name);
		if (placements.length === 0 && pending_place_ranges.length === 0) continue;
		if (!event_map.has(event_name)) {
			const parsed = parse_event_name(event_name);
			const candidate_entry = {
				event_name,
				ak: parsed.ak,
				code: parsed.code,
				kind: parsed.kind,
			};
			const age_class_candidates = get_certificate_age_class_candidates(
				candidate_entry,
				options.tournament,
				event_matches,
				draw_event_names,
				age_reference_year,
				event_names
			);
			const age_class_starter_counts = get_certificate_age_class_starter_counts(
				event_matches,
				event_name,
				draw_event_names,
				age_class_candidates,
				age_reference_year
			);
			const event_age_number = parse_age_group_number(parsed.ak);
			const active_age_class_candidates = [...new Set([
				...age_class_candidates,
				...age_class_starter_counts.keys(),
			])]
				.filter((age_number) => event_age_number != null && age_number < event_age_number)
				.filter((age_number) => (age_class_starter_counts.get(age_number) || 0) > 0)
				.sort((a, b) => a - b);
			event_map.set(event_name, {
				event_name,
				label: parsed.ak ? `${parsed.disziplin} ${parsed.ak}` : parsed.disziplin,
				disziplin: parsed.disziplin,
				ak: parsed.ak,
				code: parsed.code,
				kind: parsed.kind,
				available_places: new Set(),
				starter_count: get_certificate_event_starter_count(event_matches, event_name),
				pending_place_ranges,
				placements,
				source_placements: placements,
				event_matches,
				draw_event_names,
				age_class_candidates: active_age_class_candidates,
				age_reference_year,
				certificate_age_class_splits,
				age_class_starter_counts,
			});
		}
		const event_entry = event_map.get(event_name);
		for (const placement of placements) {
			event_entry.available_places.add(placement.place_from);
			if (Number.isFinite(Number(placement.place_to))) {
				event_entry.starter_count = Math.max(event_entry.starter_count || 0, Number(placement.place_to));
			}
		}
		const latest_scheduled_match = get_latest_scheduled_match_info(event_matches, event_name);
		event_entry.latest_scheduled_date = latest_scheduled_match?.date || '';
		event_entry.latest_scheduled_time = latest_scheduled_match?.time || '';
		event_entry.latest_scheduled_timestamp = latest_scheduled_match?.timestamp || '';
	}
	const entries = [...event_map.values()];
	entries.forEach((event_entry) => {
		event_entry.source_available_places = new Set(event_entry.available_places);
	});
	entries.forEach(apply_certificate_parent_age_class_splits);
	if (options.include_age_class_splits) {
		for (const event_entry of [...entries]) {
			entries.push(...build_certificate_age_class_entries(event_entry, options.max_place));
		}
	}
	return entries.sort(compare_certificate_event_entries);
}

function compare_certificate_event_entries(a, b) {
	const a_group = a.source_event_name || a.event_name;
	const b_group = b.source_event_name || b.event_name;
	if (a_group !== b_group) {
		const a_info = parse_event_name(a_group);
		const b_info = parse_event_name(b_group);
		let cmp = cbts_utils.natcmp(a_info.ak, b_info.ak);
		if (cmp !== 0) return cmp;
		cmp = cbts_utils.natcmp(a_info.disziplin, b_info.disziplin);
		if (cmp !== 0) return cmp;
		return cbts_utils.natcmp(a_group, b_group);
	}
	if (!!a.is_age_class_split !== !!b.is_age_class_split) {
		return a.is_age_class_split ? 1 : -1;
	}
	let cmp = cbts_utils.natcmp(a.ak, b.ak);
	if (cmp !== 0) return cmp;
	return cbts_utils.natcmp(a.key || a.event_name, b.key || b.event_name);
}

function get_certificate_event_options(matches, options = {}) {
	return build_certificate_event_stats(matches, {
		include_age_class_splits: options.include_age_class_splits,
		max_place: options.max_place,
		tournament: options.tournament,
		age_reference_year: options.age_reference_year,
		certificate_age_class_splits: options.certificate_age_class_splits,
	}).map((event_entry) => ({
		...(event_entry.key ? { key: event_entry.key } : {}),
		event_name: event_entry.event_name,
		...(event_entry.source_event_name ? { source_event_name: event_entry.source_event_name } : {}),
		label: event_entry.label,
		disziplin: event_entry.disziplin,
		ak: event_entry.ak,
		code: event_entry.code,
		kind: event_entry.kind,
		available_places: [...event_entry.available_places].sort((a, b) => a - b),
		starter_count: event_entry.starter_count || 0,
		...(event_entry.pending_place_ranges && event_entry.pending_place_ranges.length > 0
			? { pending_place_ranges: event_entry.pending_place_ranges.map((range) => ({ ...range })) }
			: {}),
		latest_scheduled_date: event_entry.latest_scheduled_date || '',
		latest_scheduled_time: event_entry.latest_scheduled_time || '',
		latest_scheduled_timestamp: event_entry.latest_scheduled_timestamp || '',
		...(event_entry.age_reference_year ? { age_reference_year: event_entry.age_reference_year } : {}),
		...(event_entry.age_class_candidates && event_entry.age_class_candidates.length > 0
			? { age_class_candidates: event_entry.age_class_candidates.map(format_age_group) }
			: {}),
		...(event_entry.is_age_class_split ? { is_age_class_split: true } : {}),
		...(event_entry.certificate_age_group ? { certificate_age_group: event_entry.certificate_age_group } : {}),
	}));
}

function get_expected_certificate_place_count(event_entry, max_place) {
	const limit = Number(max_place);
	if (limit === Infinity) {
		const starter_count = Number(event_entry?.starter_count);
		if (Number.isFinite(starter_count) && starter_count > 0) {
			return starter_count;
		}
		const available_places = event_entry?.available_places instanceof Set
			? [...event_entry.available_places]
			: event_entry?.available_places || [];
		return available_places.reduce((max_available_place, place) => Math.max(max_available_place, Number(place) || 0), 0);
	}
	if (!Number.isFinite(limit) || limit < 1) {
		return 0;
	}
	const starter_count = Number(event_entry?.starter_count);
	return Number.isFinite(starter_count) && starter_count > 0
		? Math.min(limit, starter_count)
		: limit;
}

function get_relevant_certificate_pending_ranges(event_entry, max_place) {
	const expected_place_count = get_expected_certificate_place_count(event_entry, max_place);
	if (expected_place_count < 1) return [];
	const pending_place_ranges = event_entry?.pending_place_ranges || [];
	return pending_place_ranges.filter((range) => {
		const place_from = Number(range?.place_from);
		const place_to = Number(range?.place_to);
		return Number.isFinite(place_from) && Number.isFinite(place_to) && place_from <= expected_place_count && place_to >= 1;
	});
}

function get_relevant_certificate_available_places(event_entry, max_place) {
	const expected_place_count = get_expected_certificate_place_count(event_entry, max_place);
	if (expected_place_count < 1) return [];
	const available_places = event_entry?.available_places instanceof Set
		? [...event_entry.available_places]
		: event_entry?.available_places || [];
	return available_places
		.map((place) => Number(place))
		.filter((place) => Number.isFinite(place) && place >= 1 && place <= expected_place_count)
		.sort((a, b) => a - b);
}

function event_is_complete_for_max_place(event_entry, max_place) {
	const expected_place_count = get_expected_certificate_place_count(event_entry, max_place);
	if (expected_place_count < 1) {
		return false;
	}
	const available_places = new Set(get_relevant_certificate_available_places(event_entry, max_place));
	if (get_relevant_certificate_pending_ranges(event_entry, max_place).length > 0) {
		return false;
	}
	for (let place = 1; place <= expected_place_count; place += 1) {
		if (!available_places.has(place)) {
			return false;
		}
	}
	return true;
}

function export_winners(options = {}) {
	return export_certificate_file('csv', options);
}

function build_certificate_export_data(options = {}) {
	const rows = build_certificate_rows(curt.matches, curt, {
		now: new Date(),
		...options,
	});
	const table = certificate_rows_to_table(rows);
	return {
		rows,
		table,
	};
}

function make_xlsx(table) {
	const xlsx_api = get_xlsx_api();
	const worksheet = xlsx_api.utils.aoa_to_sheet(table);
	const workbook = xlsx_api.utils.book_new();
	xlsx_api.utils.book_append_sheet(workbook, worksheet, 'Urkunden');
	return xlsx_api.write(workbook, {
		bookType: 'xlsx',
		type: 'array',
	});
}

function export_certificate_file(format, options = {}) {
	const { table } = build_certificate_export_data(options);
	if (format === 'xlsx') {
		const xlsx_data = make_xlsx(table);
		const blob = new Blob([xlsx_data], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		});
		save_file(blob, 'urkunden.xlsx');
		return;
	}

	const csv = make_csv(table);
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	save_file(blob, 'urkunden.csv');
}

return {
	build_certificate_rows,
	build_certificate_export_data,
	certificate_rows_to_table,
	build_certificate_event_stats,
	event_is_complete_for_max_place,
	export_certificate_file,
	export_winners,
	infer_certificate_age_reference_year,
	format_place_label,
	get_relevant_certificate_available_places,
	get_relevant_certificate_pending_ranges,
	get_certificate_event_options,
	make_xlsx,
	make_csv,
	normalize_certificate_date,
	normalize_certificate_event_name,
	parse_event_name,
	parse_place_range,
	split_tournament_title,
};

})();

/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var cbts_utils = require('./cbts_utils');
	var xlsx = require('xlsx');
	var save_file = function() {};
	try {
		save_file = require('../bup/bup/js/save_file.js');
	} catch (e) {
		try {
			save_file = require('../bup/js/save_file.js');
		} catch (ignored) {
		}
	}

	module.exports = ccsvexport;
}
/*/@DEV*/
