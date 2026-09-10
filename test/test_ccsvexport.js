'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const ccsvexport = require('../static/js/ccsvexport.js');

function makeTeam(player1, player2 = null, entries1 = null, entries2 = null) {
	const players = [{ name: player1 }];
	if (entries1) players[0].entries = entries1;
	if (player2) {
		players.push({ name: player2 });
		if (entries2) players[1].entries = entries2;
	}
	return { players };
}

function makeMatch(overrides = {}) {
	return {
		team1_won: overrides.team1_won,
		btp_winner: overrides.btp_winner,
		network_score: overrides.network_score,
		setup: {
			match_name: overrides.match_name || 'Finale',
			event_name: overrides.event_name || 'HE U19',
			teams: overrides.teams || [makeTeam('Alice Winner'), makeTeam('Bob Runner-up')],
			scheduled_date: overrides.scheduled_date,
			scheduled_time_str: overrides.scheduled_time_str,
			stage_id: overrides.stage_id,
			stage_display_order: overrides.stage_display_order,
			draw_position: overrides.draw_position,
			draw_id: overrides.draw_id,
		},
	};
}

_describe('ccsvexport', () => {
	_it('splits the tournament title for certificate lines', () => {
		assert.deepStrictEqual(
			ccsvexport.split_tournament_title('Nord-Cup - Badmintonverband Bremen'),
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
			}
		);
	});

	_it('maps event names to discipline and age group', () => {
		assert.deepStrictEqual(
			ccsvexport.parse_event_name('HD U19'),
			{ disziplin: 'Herrendoppel', ak: 'U19', code: 'HD', kind: 'double' }
		);
		assert.deepStrictEqual(
			ccsvexport.parse_event_name('ME U17'),
			{ disziplin: 'Mädcheneinzel', ak: 'U17', code: 'ME', kind: 'single' }
		);
	});

	_it('builds certificate rows for finals and place matches', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				teams: [makeTeam('Anton Sieger'), makeTeam('Bela Zweiter')],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HD U19',
				teams: [makeTeam('Carl Eins', 'Dora Zwei'), makeTeam('Emil Drei', 'Frieda Vier')],
				team1_won: false,
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				platz: '4. Platz',
				spieler_1: 'Carl Eins',
				spieler_2: 'Dora Zwei',
				event_name: 'HD U19',
				place: 4,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				platz: '3. Platz',
				spieler_1: 'Emil Drei',
				spieler_2: 'Frieda Vier',
				event_name: 'HD U19',
				place: 3,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '2. Platz',
				spieler_1: 'Bela Zweiter',
				spieler_2: '',
				event_name: 'HE U19',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '1. Platz',
				spieler_1: 'Anton Sieger',
				spieler_2: '',
				event_name: 'HE U19',
				place: 1,
			},
		]);
	});

	_it('creates a semicolon-separated csv table for Word', () => {
		const table = ccsvexport.certificate_rows_to_table([
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '1. Platz',
				spieler_1: 'Max Mustermann',
				spieler_2: '',
			},
		]);

		assert.strictEqual(
			ccsvexport.make_csv(table),
			'Veranstaltung #1;Veranstaltung #2;Ort;Datum;Disziplin;AK;Platz;Spieler #1;Spieler #2\r\nNord-Cup;Bremen;;19.04.2026;Herreneinzel;U19;1. Platz;Max Mustermann;'
		);
	});

	_it('can export duplicate double rows with swapped players', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HD U19',
				teams: [
					makeTeam('Anton Eins', 'Bela Zwei'),
					makeTeam('Carl Drei', 'Dora Vier'),
				],
				team1_won: true,
			}),
		], {
			name: 'Nord-Cup',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			certificate_export_double_swapped_entries_enabled: true,
		});

		assert.deepStrictEqual(rows.map((row) => [
			row.platz,
			row.spieler_1,
			row.spieler_2,
		]), [
			['2. Platz', 'Carl Drei', 'Dora Vier'],
			['2. Platz', 'Dora Vier', 'Carl Drei'],
			['1. Platz', 'Anton Eins', 'Bela Zwei'],
			['1. Platz', 'Bela Zwei', 'Anton Eins'],
			]);
	});

	_it('applies certificate discipline text replacements by discipline code', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'Finale',
				event_name: 'GD U19',
				teams: [makeTeam('Lukas Meyer'), makeTeam('Bela Zweiter')],
				team1_won: true,
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				teams: [makeTeam('Lukas Meyer'), makeTeam('Carl Zweiter')],
				team1_won: true,
			}),
		], {
			name: 'Nord-Cup',
			certificate_discipline_replacements: [
				{ replace: 'gemischten Doppel', discipline: 'GD' },
			],
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			max_place: 1,
		});

		const rowsByEvent = new Map(rows.map((row) => [row.event_name, row]));
		assert.strictEqual(rowsByEvent.get('GD U19').disziplin, 'gemischten Doppel');
		assert.strictEqual(rowsByEvent.get('GD U19').spieler_1, 'Lukas Meyer');
		assert.strictEqual(rowsByEvent.get('HE U19').disziplin, 'Herreneinzel');
		assert.strictEqual(rowsByEvent.get('HE U19').spieler_1, 'Lukas Meyer');
	});

	_it('creates an xlsx workbook buffer for Word/Excel import', () => {
		const table = ccsvexport.certificate_rows_to_table([
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '1. Platz',
				spieler_1: 'Max Mustermann',
				spieler_2: '',
			},
		]);

		const workbook = ccsvexport.make_xlsx(table);
		assert.ok(workbook instanceof ArrayBuffer);
		assert.ok(workbook.byteLength > 100);
	});

	_it('supports export overrides for title, date, discipline selection and max place', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				teams: [makeTeam('Anton Sieger'), makeTeam('Bela Zweiter')],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HD U19',
				teams: [makeTeam('Carl Eins', 'Dora Zwei'), makeTeam('Emil Drei', 'Frieda Vier')],
				team1_won: false,
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			veranstaltung_1: 'BTS Nord',
			veranstaltung_2: 'Urkunden 2026',
			ort: 'Bremen',
			datum: '2026-04-20',
			max_place: 3,
			selected_event_names: new Set(['HD U19']),
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'BTS Nord',
				veranstaltung_2: 'Urkunden 2026',
				ort: 'Bremen',
				datum: '20.04.2026',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				platz: '3. Platz',
				spieler_1: 'Emil Drei',
				spieler_2: 'Frieda Vier',
				event_name: 'HD U19',
				place: 3,
			},
		]);
	});

	_it('lists certificate disciplines from placement matches', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HD U19',
				team1_won: true,
			}),
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U17',
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'ME U17',
				label: 'Mädcheneinzel U17',
				disziplin: 'Mädcheneinzel',
				ak: 'U17',
				code: 'ME',
				kind: 'single',
				available_places: [],
				starter_count: 2,
				pending_place_ranges: [
					{ place_from: 1, place_to: Number.MAX_SAFE_INTEGER, label: '1. Platz der Gruppe unsicher' },
				],
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
			{
				event_name: 'HD U19',
				label: 'Herrendoppel U19',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				code: 'HD',
				kind: 'double',
				available_places: [3, 4],
				starter_count: 4,
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
			{
				event_name: 'HE U19',
				label: 'Herreneinzel U19',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				code: 'HE',
				kind: 'single',
				available_places: [1, 2],
				starter_count: 2,
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
		]);
	});

	_it('detects whether all relevant places are available for a discipline', () => {
		const stats = ccsvexport.build_certificate_event_stats([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HE U19',
				team1_won: true,
			}),
		]);

		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(stats[0], 3),
			true
		);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(stats[0], 5),
			true
		);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place({ available_places: [1, 2], starter_count: 2 }, 3),
			true
		);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place({ available_places: [1, 2, 3, 4], starter_count: 6 }, 5),
			false
		);
		assert.deepStrictEqual(
			ccsvexport.get_relevant_certificate_available_places({ available_places: [1, 2, 3, 4, 5], starter_count: 5 }, 3),
			[1, 2, 3]
		);
		assert.deepStrictEqual(
			ccsvexport.get_relevant_certificate_pending_ranges({
				starter_count: 8,
				pending_place_ranges: [
					{ place_from: 1, place_to: 2, label: '1/2' },
					{ place_from: 3, place_to: 4, label: '3/4' },
					{ place_from: 5, place_to: 6, label: '5/6' },
				],
			}, 3),
			[
				{ place_from: 1, place_to: 2, label: '1/2' },
				{ place_from: 3, place_to: 4, label: '3/4' },
			]
		);
	});

	_it('builds certificate rows for complete group-only events', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'G1',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 9], [21, 11]],
			}),
			makeMatch({
				match_name: 'G3',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 8], [21, 7]],
			}),
			makeMatch({
				match_name: 'G4',
				event_name: 'E U11',
				teams: [makeTeam('Bravo'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 18], [21, 16]],
			}),
			makeMatch({
				match_name: 'G5',
				event_name: 'E U11',
				teams: [makeTeam('Bravo'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 17], [21, 19]],
			}),
			makeMatch({
				match_name: 'G6',
				event_name: 'E U11',
				teams: [makeTeam('Charlie'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 15], [21, 14]],
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			max_place: 3,
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '3. Platz',
				spieler_1: 'Charlie',
				spieler_2: '',
				event_name: 'E U11',
				place: 3,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '2. Platz',
				spieler_1: 'Bravo',
				spieler_2: '',
				event_name: 'E U11',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '1. Platz',
				spieler_1: 'Alpha',
				spieler_2: '',
				event_name: 'E U11',
				place: 1,
			},
		]);
	});

	_it('lists complete group-only disciplines for certificate export', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'G1',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 9], [21, 11]],
			}),
			makeMatch({
				match_name: 'G3',
				event_name: 'E U11',
				teams: [makeTeam('Bravo'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 18], [21, 16]],
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'E U11',
				label: 'Einzel U11',
				disziplin: 'Einzel',
				ak: 'U11',
				code: 'E',
				kind: 'single',
				available_places: [1, 2, 3],
				starter_count: 3,
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
		]);
	});

	_it('keeps group-only disciplines open until all group matches are complete', () => {
		const matches = [
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U13',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'ME U13',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				network_score: [],
			}),
			makeMatch({
				match_name: 'G3',
				event_name: 'ME U13',
				teams: [makeTeam('Bravo'), makeTeam('Charlie')],
				team1_won: false,
				network_score: [[19, 21], [18, 21]],
			}),
		];
		matches[0].setup.btp_group_rankings = [
			{ place_from: 1, place_to: 1, team: makeTeam('Alpha'), source: 'btp_ranking' },
			{ place_from: 2, place_to: 2, team: makeTeam('Charlie'), source: 'btp_ranking' },
			{ place_from: 3, place_to: 3, team: makeTeam('Bravo'), source: 'btp_ranking' },
		];

		const result = ccsvexport.get_certificate_event_options(matches);

		assert.deepStrictEqual(result[0].available_places, []);
		assert.deepStrictEqual(result[0].pending_place_ranges, [
			{ place_from: 1, place_to: Number.MAX_SAFE_INTEGER, label: '1. Platz der Gruppe unsicher' },
		]);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(result[0], 3),
			false
		);
		assert.deepStrictEqual(
			ccsvexport.build_certificate_rows(matches, { name: 'Nord-Cup' }, { max_place: 3 }),
			[]
		);
	});

	_it('uses locked group places when remaining matches cannot affect them', () => {
		const matches = [
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U13',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'ME U13',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G3',
				event_name: 'ME U13',
				teams: [makeTeam('Alpha'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G4',
				event_name: 'ME U13',
				teams: [makeTeam('Bravo'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G5',
				event_name: 'ME U13',
				teams: [makeTeam('Bravo'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G6',
				event_name: 'ME U13',
				teams: [makeTeam('Charlie'), makeTeam('Delta')],
				network_score: [],
			}),
		];
		matches[0].setup.btp_group_rankings = [
			{ place_from: 1, place_to: 1, team: makeTeam('Alpha'), source: 'btp_ranking' },
			{ place_from: 2, place_to: 2, team: makeTeam('Bravo'), source: 'btp_ranking' },
			{ place_from: 3, place_to: 3, team: makeTeam('Charlie'), source: 'btp_ranking' },
			{ place_from: 4, place_to: 4, team: makeTeam('Delta'), source: 'btp_ranking' },
		];

		const result = ccsvexport.get_certificate_event_options(matches);

		assert.deepStrictEqual(result[0].available_places, [1, 2]);
		assert.deepStrictEqual(result[0].pending_place_ranges, [
			{ place_from: 3, place_to: Number.MAX_SAFE_INTEGER, label: '3. Platz der Gruppe unsicher' },
		]);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(result[0], 2),
			true
		);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(result[0], 3),
			false
		);
		assert.deepStrictEqual(
			ccsvexport.get_relevant_certificate_pending_ranges(result[0], 2),
			[]
		);
		assert.deepStrictEqual(
			ccsvexport.get_relevant_certificate_pending_ranges(result[0], 3),
			[
				{ place_from: 3, place_to: Number.MAX_SAFE_INTEGER, label: '3. Platz der Gruppe unsicher' },
			]
		);
		assert.deepStrictEqual(
			ccsvexport.build_certificate_rows(matches, { name: 'Nord-Cup' }, {
				max_place: 2,
				now: new Date('2026-04-19T10:00:00Z'),
			}),
			[
				{
					veranstaltung_1: 'Nord-Cup',
					veranstaltung_2: '',
					datum: '19.04.2026',
					disziplin: 'Mädcheneinzel',
					ak: 'U13',
					platz: '2. Platz',
					spieler_1: 'Bravo',
					spieler_2: '',
					event_name: 'ME U13',
					place: 2,
				},
				{
					veranstaltung_1: 'Nord-Cup',
					veranstaltung_2: '',
					datum: '19.04.2026',
					disziplin: 'Mädcheneinzel',
					ak: 'U13',
					platz: '1. Platz',
					spieler_1: 'Alpha',
					spieler_2: '',
					event_name: 'ME U13',
					place: 1,
				},
			]
		);
	});

	_it('offers separate certificate age classes for combined events', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U15',
				draw_id: 8,
				teams: [
					makeTeam('U15 Winner', null, { 8: '<none>' }),
					makeTeam('U13 First', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'ME U15',
				draw_id: 8,
				teams: [
					makeTeam('U13 Second', null, { 6: '<none>' }),
					makeTeam('U15 Fourth', null, { 8: '<none>' }),
				],
				team1_won: true,
			}),
		];
		matches[0].setup.teams[0].players[0].birth_year = 2012;
		matches[0].setup.teams[1].players[0].birth_year = 2014;
		matches[1].setup.teams[0].players[0].birth_year = 2015;
		matches[1].setup.teams[1].players[0].birth_year = 2013;

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			certificate_age_class_splits: {
				'ME U15': ['U13'],
			},
			age_reference_year: 2026,
		});
		const split = options.find((entry) => entry.key === 'ME U15::age:U13');

		assert.deepStrictEqual(split, {
			key: 'ME U15::age:U13',
			event_name: 'ME U15',
			source_event_name: 'ME U15',
			label: 'Mädcheneinzel U13 (aus U15)',
			disziplin: 'Mädcheneinzel',
			ak: 'U13',
			code: 'ME',
			kind: 'single',
			available_places: [1, 2],
			starter_count: 2,
			latest_scheduled_date: '',
			latest_scheduled_time: '',
			latest_scheduled_timestamp: '',
			is_age_class_split: true,
			certificate_age_group: 'U13',
		});
		assert.deepStrictEqual(
			options
				.filter((entry) => entry.event_name === 'ME U15' || entry.source_event_name === 'ME U15')
				.map((entry) => entry.key || entry.event_name),
			['ME U15', 'ME U15::age:U13']
		);

		const rows = ccsvexport.build_certificate_rows(matches, {
			name: 'Nord-Cup',
			certificate_age_class_splits: {
				'ME U15': ['U13'],
			},
		}, {
			max_place: 2,
			now: new Date('2026-04-19T10:00:00Z'),
			selected_certificate_keys: new Set(['ME U15::age:U13']),
			age_reference_year: 2026,
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: '',
				datum: '19.04.2026',
				disziplin: 'Mädcheneinzel',
				ak: 'U13',
				platz: '2. Platz',
				spieler_1: 'U13 Second',
				spieler_2: '',
				event_name: 'ME U15::age:U13',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: '',
				datum: '19.04.2026',
				disziplin: 'Mädcheneinzel',
				ak: 'U13',
				platz: '1. Platz',
				spieler_1: 'U13 First',
				spieler_2: '',
				event_name: 'ME U15::age:U13',
				place: 1,
			},
		]);
	});

	_it('does not infer lower tournament age classes from missing source draw entries', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'JE U13',
				draw_id: 53,
				teams: [
					makeTeam('U13 Winner', null, { 53: '<none>' }),
					makeTeam('U11 Runner-up', null, { 50: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'JE U13',
				draw_id: 53,
				teams: [
					makeTeam('U11 Third'),
					makeTeam('U13 Fourth', null, { 53: '<none>' }),
				],
				team1_won: true,
			}),
		];
		const tournament = {
			certificate_age_class_splits: {
				'JE U13': ['U11'],
			},
			events: {
				events: [
					{ name: 'JE U13' },
				],
			},
		};

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
			age_reference_year: 2026,
		});
		const base = options.find((entry) => entry.event_name === 'JE U13' && !entry.is_age_class_split);
		assert.strictEqual(base.age_class_candidates, undefined);
		assert.strictEqual(options.some((entry) => entry.key === 'JE U13::age:U11'), false);

		const rows = ccsvexport.build_certificate_rows(matches, { name: 'Nord-Cup', ...tournament }, {
			max_place: 2,
			now: new Date('2026-04-19T10:00:00Z'),
			selected_certificate_keys: new Set(['JE U13::age:U11']),
		});

		assert.deepStrictEqual(rows, []);
	});

	_it('does not offer separate age classes without starters from that age class', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'JE U13',
				draw_id: 53,
				teams: [
					makeTeam('U13 Winner', null, { 53: '<none>' }),
					makeTeam('U13 Runner-up', null, { 53: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'JE U13',
				draw_id: 53,
				teams: [
					makeTeam('U13 Third', null, { 53: '<none>' }),
					makeTeam('U13 Fourth', null, { 53: '<none>' }),
				],
				team1_won: true,
			}),
		];
		const tournament = {
			certificate_age_class_splits: {
				'JE U13': ['U11'],
			},
			events: {
				events: [
					{ name: 'JE U13' },
				],
			},
		};

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
			age_reference_year: 2026,
		});
		const base = options.find((entry) => entry.event_name === 'JE U13' && !entry.is_age_class_split);

		assert.strictEqual(base.age_class_candidates, undefined);
		assert.strictEqual(options.some((entry) => entry.key === 'JE U13::age:U11'), false);
	});

	_it('counts younger players into their selected separate age class', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U13 Winner', null, { 6: '<none>' }),
					makeTeam('U11 Runner-up', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U13 Third', null, { 6: '<none>' }),
					makeTeam('U13 Fourth', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
		];
		matches[0].setup.teams[0].players[0].birth_year = 2014;
		matches[0].setup.teams[1].players[0].birth_year = 2016;
		matches[1].setup.teams[0].players[0].birth_year = 2015;
		matches[1].setup.teams[1].players[0].birth_year = 2015;
		const tournament = {
			certificate_age_class_splits: {
				'ME U13': ['U11'],
			},
			events: {
				events: [
					{ name: 'ME U13' },
				],
			},
		};

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
			age_reference_year: 2026,
		});
		const parent = options.find((entry) => entry.event_name === 'ME U13' && !entry.is_age_class_split);
		const split = options.find((entry) => entry.key === 'ME U13::age:U11');

		assert.deepStrictEqual(parent.age_class_candidates, ['U11']);
		assert.strictEqual(parent.starter_count, 3);
		assert.strictEqual(split.starter_count, 1);
		assert.deepStrictEqual(split.available_places, [1]);
	});

	_it('offers U9 separately when a starter birth year belongs to U9', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U11 Winner', null, { 6: '<none>' }),
					makeTeam('U9 Runner-up', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U13 Third', null, { 6: '<none>' }),
					makeTeam('U13 Fourth', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
		];
		matches[0].setup.teams[0].players[0].birth_year = 2016;
		matches[0].setup.teams[1].players[0].birth_year = 2019;
		matches[1].setup.teams[0].players[0].birth_year = 2014;
		matches[1].setup.teams[1].players[0].birth_year = 2015;
		const tournament = {
			certificate_age_class_splits: {
				'ME U13': ['U9'],
			},
			events: {
				events: [
					{ name: 'ME U13' },
					{ name: 'E U11' },
				],
			},
		};

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
			age_reference_year: 2026,
		});
		const parent = options.find((entry) => entry.event_name === 'ME U13' && !entry.is_age_class_split);
		const u9 = options.find((entry) => entry.key === 'ME U13::age:U9');

		assert.deepStrictEqual(parent.age_class_candidates, ['U9', 'U11']);
		assert.strictEqual(parent.starter_count, 3);
		assert.strictEqual(u9.starter_count, 1);
		assert.deepStrictEqual(u9.available_places, [1]);
	});

	_it('assigns U9 starters to U11 when only the U11 split is selected', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U11 Winner', null, { 6: '<none>' }),
					makeTeam('U9 Runner-up', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U13 Third', null, { 6: '<none>' }),
					makeTeam('U13 Fourth', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
		];
		matches[0].setup.teams[0].players[0].birth_year = 2016;
		matches[0].setup.teams[1].players[0].birth_year = 2019;
		matches[1].setup.teams[0].players[0].birth_year = 2014;
		matches[1].setup.teams[1].players[0].birth_year = 2015;
		const tournament = {
			certificate_age_class_splits: {
				'ME U13': ['U11'],
			},
			events: {
				events: [
					{ name: 'ME U13' },
				],
			},
		};

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
			age_reference_year: 2026,
		});
		const parent = options.find((entry) => entry.event_name === 'ME U13' && !entry.is_age_class_split);
		const u11 = options.find((entry) => entry.key === 'ME U13::age:U11');
		const u9 = options.find((entry) => entry.key === 'ME U13::age:U9');

		assert.deepStrictEqual(parent.age_class_candidates, ['U9', 'U11']);
		assert.strictEqual(parent.starter_count, 2);
		assert.strictEqual(u11.starter_count, 2);
		assert.deepStrictEqual(u11.available_places, [1, 2]);
		assert.strictEqual(u9, undefined);
	});

	_it('uses the youngest selected matching separate age class', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U11 Winner', null, { 6: '<none>' }),
					makeTeam('U9 Runner-up', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U13 Third', null, { 6: '<none>' }),
					makeTeam('U13 Fourth', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
		];
		matches[0].setup.teams[0].players[0].birth_year = 2016;
		matches[0].setup.teams[1].players[0].birth_year = 2019;
		matches[1].setup.teams[0].players[0].birth_year = 2014;
		matches[1].setup.teams[1].players[0].birth_year = 2015;
		const tournament = {
			certificate_age_class_splits: {
				'ME U13': ['U9', 'U11'],
			},
			events: {
				events: [
					{ name: 'ME U13' },
				],
			},
		};

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
			age_reference_year: 2026,
		});
		const parent = options.find((entry) => entry.event_name === 'ME U13' && !entry.is_age_class_split);
		const u11 = options.find((entry) => entry.key === 'ME U13::age:U11');
		const u9 = options.find((entry) => entry.key === 'ME U13::age:U9');

		assert.deepStrictEqual(parent.age_class_candidates, ['U9', 'U11']);
		assert.strictEqual(parent.starter_count, 2);
		assert.strictEqual(u11.starter_count, 1);
		assert.strictEqual(u9.starter_count, 1);
		assert.deepStrictEqual(u11.available_places, [1]);
		assert.deepStrictEqual(u9.available_places, [1]);
	});

	_it('does not offer separate age classes for existing compatible disciplines', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'E U11',
				draw_id: 55,
				teams: [
					makeTeam('Existing U11 Winner', null, { 55: '<none>' }),
					makeTeam('Existing U11 Runner-up', null, { 55: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'E U9',
				draw_id: 57,
				teams: [
					makeTeam('Existing U9 Winner', null, { 57: '<none>' }),
					makeTeam('Existing U9 Runner-up', null, { 57: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U11 Winner', null, { 6: '<none>' }),
					makeTeam('U9 Runner-up', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'ME U13',
				draw_id: 6,
				teams: [
					makeTeam('U13 Third', null, { 6: '<none>' }),
					makeTeam('U13 Fourth', null, { 6: '<none>' }),
				],
				team1_won: true,
			}),
		];
		matches[2].setup.teams[0].players[0].birth_year = 2016;
		matches[2].setup.teams[1].players[0].birth_year = 2019;
		matches[3].setup.teams[0].players[0].birth_year = 2014;
		matches[3].setup.teams[1].players[0].birth_year = 2015;
		const tournament = {
			certificate_age_class_splits: {
				'ME U13': ['U9', 'U11'],
			},
			events: {
				events: [
					{ name: 'ME U13' },
					{ name: 'E U11' },
					{ name: 'E U9' },
				],
			},
		};

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
			age_reference_year: 2026,
		});
		const parent = options.find((entry) => entry.event_name === 'ME U13' && !entry.is_age_class_split);

		assert.strictEqual(parent.age_class_candidates, undefined);
		assert.strictEqual(parent.starter_count, 4);
		assert.strictEqual(options.some((entry) => entry.key === 'ME U13::age:U11'), false);
		assert.strictEqual(options.some((entry) => entry.key === 'ME U13::age:U9'), false);
	});

	_it('infers youth age limits from registered player birth years instead of the event year', () => {
		const matches = [
			makeMatch({
				match_name: 'Finale',
				event_name: 'JE U13',
				draw_id: 53,
				teams: [
					makeTeam('U13 Older', null, { 53: '<none>' }),
					makeTeam('U11 Winner'),
				],
				team1_won: false,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'JE U13',
				draw_id: 53,
				teams: [
					makeTeam('U13 Younger', null, { 53: '<none>' }),
					makeTeam('U11 Third'),
				],
				team1_won: false,
			}),
		];
		matches[0].setup.teams[0].players[0].birth_year = 2014;
		matches[0].setup.teams[1].players[0].birth_year = 2016;
		matches[1].setup.teams[0].players[0].birth_year = 2015;
		matches[1].setup.teams[1].players[0].birth_year = 2017;
		const tournament = {
			certificate_age_class_splits: {
				'JE U13': ['U11'],
			},
			events: {
				events: [
					{ name: 'JE U13' },
				],
			},
		};

		assert.strictEqual(ccsvexport.infer_certificate_age_reference_year(matches), 2026);

		const options = ccsvexport.get_certificate_event_options(matches, {
			include_age_class_splits: true,
			max_place: 2,
			tournament,
		});
		const parent = options.find((entry) => entry.event_name === 'JE U13' && !entry.is_age_class_split);
		const split = options.find((entry) => entry.key === 'JE U13::age:U11');
		assert.strictEqual(parent.starter_count, 2);
		assert.deepStrictEqual(parent.available_places, [1, 2]);
		assert.strictEqual(split.starter_count, 2);
		assert.deepStrictEqual(split.available_places, [1, 2]);

		const rows = ccsvexport.build_certificate_rows(matches, { name: 'Nord-Cup', ...tournament }, {
			max_place: 2,
			now: new Date('2027-04-19T10:00:00Z'),
			selected_certificate_keys: new Set(['JE U13', 'JE U13::age:U11']),
		});

		assert.deepStrictEqual(rows
			.filter((row) => row.event_name === 'JE U13::age:U11')
			.map((row) => [row.platz, row.spieler_1]), [
			['2. Platz', 'U11 Third'],
			['1. Platz', 'U11 Winner'],
		]);
		assert.deepStrictEqual(rows
			.filter((row) => row.event_name === 'JE U13')
			.map((row) => [row.platz, row.spieler_1]), [
			['2. Platz', 'U13 Younger'],
			['1. Platz', 'U13 Older'],
		]);
	});

	_it('includes the latest scheduled match date in certificate event options', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				team1_won: true,
				scheduled_date: '2026-04-19',
				scheduled_time_str: '14:00',
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HE U19',
				team1_won: true,
				scheduled_date: '2026-04-20',
				scheduled_time_str: '09:30',
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'HE U19',
				label: 'Herreneinzel U19',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				code: 'HE',
				kind: 'single',
				available_places: [1, 2, 3, 4],
				starter_count: 4,
				latest_scheduled_date: '2026-04-20',
				latest_scheduled_time: '09:30',
				latest_scheduled_timestamp: '2026-04-20 09:30',
			},
		]);
	});

	_it('prefers authoritative BTP rankings for certificate rows', () => {
		const matches = [
			makeMatch({
				match_name: 'G1',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
		];
		matches[0].setup.btp_group_rankings = [
			{ place_from: 1, place_to: 1, team: makeTeam('Bravo'), source: 'btp_ranking' },
			{ place_from: 2, place_to: 2, team: makeTeam('Alpha'), source: 'btp_ranking' },
		];

		const rows = ccsvexport.build_certificate_rows(matches, {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			max_place: 2,
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '2. Platz',
				spieler_1: 'Alpha',
				spieler_2: '',
				event_name: 'E U11',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '1. Platz',
				spieler_1: 'Bravo',
				spieler_2: '',
				event_name: 'E U11',
				place: 1,
			},
		]);
	});

	_it('merges group and playoff draw names into one certificate discipline option', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U17 - Gruppe A',
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'ME U17 - Gruppe B',
				team1_won: true,
				network_score: [[21, 11], [21, 13]],
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U17 - Position 1-4',
				team1_won: true,
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'ME U17',
				label: 'Mädcheneinzel U17',
				disziplin: 'Mädcheneinzel',
				ak: 'U17',
				code: 'ME',
				kind: 'single',
				available_places: [1, 2],
				starter_count: 2,
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
		]);
	});

	_it('keeps disciplines open while later placement matches are unfinished', () => {
		const matches = [
			makeMatch({
				match_name: 'G1',
				event_name: 'JE U13 - Gruppe A',
				teams: [makeTeam('Eiko Lü'), makeTeam('Muzhe Li')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
				stage_id: 'group-stage',
				stage_display_order: 2,
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'JE U13 - Gruppe A',
				teams: [makeTeam('Eiko Lü'), makeTeam('Mattes Haase')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
				stage_id: 'group-stage',
				stage_display_order: 2,
			}),
			makeMatch({
				match_name: 'G3',
				event_name: 'JE U13 - Gruppe A',
				teams: [makeTeam('Muzhe Li'), makeTeam('Mattes Haase')],
				team1_won: false,
				network_score: [[21, 10], [18, 21], [18, 21]],
				stage_id: 'group-stage',
				stage_display_order: 2,
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'JE U13',
				teams: [makeTeam('Gewinner #77'), makeTeam('Gewinner #78')],
				stage_id: 'playoff-stage',
				stage_display_order: 1,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'JE U13',
				teams: [makeTeam('Verlierer #77'), makeTeam('Verlierer #78')],
				stage_id: 'playoff-stage',
				stage_display_order: 1,
			}),
		];
		const result = ccsvexport.get_certificate_event_options(matches);

		assert.deepStrictEqual(result[0].available_places, []);
		assert.deepStrictEqual(result[0].pending_place_ranges, [
			{ place_from: 1, place_to: 2, label: '1/2' },
			{ place_from: 3, place_to: 4, label: '3/4' },
		]);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(result[0], 4),
			false
		);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(result[0], 2),
			false
		);
		assert.deepStrictEqual(
			ccsvexport.build_certificate_rows(matches, { name: 'Nord-Cup' }, { max_place: 4 }),
			[]
		);
	});

	_it('prefers the best stage when group and playoff stages exist for one discipline', () => {
		const result = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U17 - Gruppe A',
				team1_won: true,
				teams: [makeTeam('Group Winner'), makeTeam('Group Runner-up')],
				network_score: [[21, 10], [21, 12]],
				stage_id: 'group-stage',
				stage_display_order: 2,
				draw_position: 1,
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U17 - Position 1-4',
				team1_won: true,
				teams: [makeTeam('Playoff Winner'), makeTeam('Playoff Runner-up')],
				stage_id: 'playoff-stage',
				stage_display_order: 1,
				draw_position: 1,
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			max_place: 2,
		});

		assert.deepStrictEqual(result, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Mädcheneinzel',
				ak: 'U17',
				platz: '2. Platz',
				spieler_1: 'Playoff Runner-up',
				spieler_2: '',
				event_name: 'ME U17',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Mädcheneinzel',
				ak: 'U17',
				platz: '1. Platz',
				spieler_1: 'Playoff Winner',
				spieler_2: '',
				event_name: 'ME U17',
				place: 1,
			},
		]);
	});
});
