'use strict';

const assert = require('assert');
const {_describe, _it} = require('./tutils');
const csv = require('../static/js/ccsvexport');
const design = require('../static/js/certificate_design');

function team(name, ...birthYears) {
	return {players: birthYears.map((birth_year, index) => ({name: name + (birthYears.length > 1 ? ' ' + index : ''), birth_year}))};
}

function matchesFor(event = 'HE 40+45', teams = [team('O40 Sieger', 1985), team('O45 Sieger', 1980), team('O45 Zweiter', 1975), team('O40 Zweiter', 1984)]) {
	return Array.from({length: teams.length / 2}, (_, index) => ({
		team1_won: true, network_score: [[21, 10], [21, 12]],
		setup: {event_name: event, match_name: index ? `${2 * index + 1}/${2 * index + 2}` : 'Finale',
			scheduled_date: '2026-11-21', scheduled_time_str: '18:00', teams: teams.slice(2 * index, 2 * index + 2)},
	}));
}

const splitOptions = (event = 'HE 40+45', ages = ['O45']) => ({
	include_age_class_splits: true, max_place: 2, certificate_age_class_splits: {[event]: ages},
});

const cutoffTeams = () => [team('Jünger', 1984), team('Grenzjahrgang', 1981), team('Älter', 1980), team('Am ältesten', 1979), team('Auch jünger', 1983), team('Noch jünger', 1982)];

_describe('Senior certificate age-class splits', () => {
	_it('offers only the combined O classes and ranks the remaining and separated classes independently', () => {
		const matches = matchesFor(), before = JSON.stringify(matches);
		const [original] = csv.get_certificate_event_options(matches);
		assert.strictEqual(original.label, 'HE O40+45');
		assert.deepStrictEqual(original.age_class_candidates, ['O45']);
		assert(original.age_class_split_note.includes('Kalenderjahr 2026 · Stichtag 01.01.2026'));
		const options = splitOptions(), entries = csv.get_certificate_event_options(matches, options);
		assert.deepStrictEqual(entries.map(entry => [entry.key || entry.event_name, entry.label, entry.starter_count, entry.available_places]), [
			['HE 40+45', 'HE O40', 2, [1, 2]],
			['HE 40+45::age:O45', 'HE O45 (aus O40+45)', 2, [1, 2]],
		]);
		assert(entries.every(entry => csv.event_is_complete_for_max_place(entry, 2)));
		const rows = csv.build_certificate_rows(matches, {}, {...options, selected_certificate_keys: new Set(entries.map(entry => entry.key || entry.event_name))});
		assert.deepStrictEqual(rows.map(row => [row.ak, row.place, row.spieler_1]), [
			['O40', 2, 'O40 Zweiter'], ['O40', 1, 'O40 Sieger'], ['O45', 2, 'O45 Zweiter'], ['O45', 1, 'O45 Sieger'],
		]);
		assert.strictEqual(JSON.stringify(matches), before);
		assert.strictEqual(csv.get_certificate_event_options(matches, {...options, certificate_age_class_splits: {}})[0].label, 'HE O40+45');
		assert.strictEqual(csv.get_certificate_event_options(matches, splitOptions('HE 40+45', ['U45', 'O50'])).length, 1);
	});

	_it('uses the younger doubles partner, including mixed pairs and reversed partner order', () => {
		for (const code of ['HD', 'DD', 'MX']) {
			const event = code + ' 40+55';
			const matches = matchesFor(event, [team('Jüngeres Paar', 1960, 1985), team('Älteres Paar', 1970, 1968), team('Zweites älteres Paar', 1969, 1966), team('Zweites jüngeres Paar', 1980, 1965)]);
			matches.push({...matches[0], setup: {...matches[0].setup, match_name: 'Halbfinale', teams: matches[0].setup.teams.map(entry => ({players: [...entry.players].reverse()}))}});
			const options = splitOptions(event, ['O55']), entries = csv.get_certificate_event_options(matches, options);
			assert.deepStrictEqual(entries.map(entry => entry.starter_count), [2, 2]);
			const rows = csv.build_certificate_rows(matches, {}, {...options, selected_certificate_keys: new Set([event + '::age:O55']), include_document_dates: true});
			assert.strictEqual(rows.length, 2);
			assert(rows.every(row => row.ak === 'O55' && row.datum_letztes_spiel === '21.11.2026' && row.spieler_1.toLowerCase().includes('älteres paar')));
			const records = design.records(rows);
			assert.strictEqual(records.length, 4);
			assert(records.every(record => design.resolve('{disziplin} {ak}', record) === `${code} O55`));
		}
	});

	_it('uses current and previous calendar years or DBV seasons across both boundaries, independent of the export date', () => {
		const cutoffs = [
			['2026-07-31', {calendar: 2026, season: 2026, previous_calendar: 2025, previous_season: 2025}],
			['2026-08-01', {calendar: 2026, season: 2027, previous_calendar: 2025, previous_season: 2026}],
			['2026-11-21', {calendar: 2026, season: 2027, previous_calendar: 2025, previous_season: 2026}],
			['2026-12-31', {calendar: 2026, season: 2027, previous_calendar: 2025, previous_season: 2026}],
			['2027-01-01', {calendar: 2027, season: 2027, previous_calendar: 2026, previous_season: 2026}],
			['2027-07-31', {calendar: 2027, season: 2027, previous_calendar: 2026, previous_season: 2026}],
		];
		for (const [date, expected] of cutoffs) for (const basis of [undefined, 'calendar', 'season', 'previous_calendar', 'previous_season']) {
			const cutoff = expected[basis || 'calendar'];
			const olderCount = {2025: 1, 2026: 2, 2027: 3}[cutoff];
			const matches = matchesFor('HE 40+45', cutoffTeams());
			matches.forEach(match => {match.setup.scheduled_date = date;});
			const options = {...splitOptions(), max_place: 3, certificate_senior_age_basis: basis}, entries = csv.get_certificate_event_options(matches, options);
			assert(entries[0].age_class_split_note.includes(`01.01.${cutoff}`), date);
			const label = {calendar: 'Kalenderjahr', season: 'Saison', previous_calendar: 'Letztes Kalenderjahr', previous_season: 'Letzte Saison'}[basis || 'calendar'];
			assert(entries[0].age_class_split_note.startsWith(label));
			assert(entries[0].age_class_split_note.includes(basis?.includes('season') ? `${cutoff - 1}/${String(cutoff).slice(-2)} (DBV)` : `${label} ${cutoff}`));
			assert.strictEqual(entries[1].starter_count, olderCount, date);
			const rows = csv.build_certificate_rows(matches, {}, {...options, selected_certificate_keys: new Set(['HE 40+45::age:O45']), now: new Date('2038-01-01T12:00:00Z')});
			assert.strictEqual(rows.length, olderCount, date);
		}
		const acrossYears = matchesFor('HE 40+45', cutoffTeams());acrossYears[1].setup.scheduled_date = '2027-01-01';
		const acrossSeasons = matchesFor('HE 40+45', cutoffTeams());acrossSeasons[1].setup.scheduled_date = '2026-07-31';
		for (const basis of ['calendar', 'previous_calendar']) {
			assert(csv.get_certificate_event_options(acrossYears, {certificate_senior_age_basis: basis})[0].age_class_split_unavailable_reason.includes('Kalenderjahr'));
			assert.deepStrictEqual(csv.get_certificate_event_options(acrossSeasons, {certificate_senior_age_basis: basis})[0].age_class_candidates, ['O45']);
		}
		for (const basis of ['season', 'previous_season']) {
			assert.deepStrictEqual(csv.get_certificate_event_options(acrossYears, {certificate_senior_age_basis: basis})[0].age_class_candidates, ['O45']);
			assert(csv.get_certificate_event_options(acrossSeasons, {certificate_senior_age_basis: basis})[0].age_class_split_unavailable_reason.includes('Spielsaison'));
		}
	});

	_it('uses the saved choice consistently for displayed rankings and all certificate export records, with explicit options taking precedence', () => {
		const matches = matchesFor('HE 40+45', cutoffTeams());
		for (const [saved, override, expected] of [['calendar', undefined, 2], ['season', undefined, 3], ['previous_calendar', undefined, 1], ['previous_season', undefined, 2], ['season', 'calendar', 2], ['calendar', 'season', 3], ['season', 'previous_calendar', 1], ['calendar', 'previous_season', 2]]) {
			const tournament = {certificate_senior_age_basis: saved, certificate_age_class_splits: {'HE 40+45': ['O45']}};
			const options = {include_age_class_splits: true, certificate_senior_age_basis: override, selected_certificate_keys: new Set(['HE 40+45::age:O45'])};
			const entries = csv.get_certificate_event_options(matches, {...options, tournament});
			assert.strictEqual(entries[1].starter_count, expected);
			const rows = csv.build_certificate_rows(matches, tournament, options);
			assert.strictEqual(rows.length, expected);assert(rows.every(row => row.ak === 'O45'));
			assert.strictEqual(design.records(rows).length, expected);
			assert.strictEqual(rows.some(row => row.spieler_1 === 'Grenzjahrgang'), expected === 3);
		}
	});

	_it('supports several senior splits without inventing intermediate age classes or counting teams twice', () => {
		const event = 'HE O35+45+55', matches = matchesFor(event, [team('A', 1990), team('B', 1980), team('C', 1970), team('D', 1979), team('E', 1969), team('F', 1987)]);
		assert.deepStrictEqual(csv.get_certificate_event_options(matches)[0].age_class_candidates, ['O45', 'O55']);
		for (const [ages, labels, counts] of [
			[['O45'], ['O35', 'O45'], [2, 4]],
			[['O55'], ['O35+45', 'O55'], [4, 2]],
			[['O45', 'O55'], ['O35', 'O45', 'O55'], [2, 2, 2]],
		]) {
			const entries = csv.get_certificate_event_options(matches, splitOptions(event, ages));
			assert.deepStrictEqual(entries.map(entry => entry.ak), labels);
			assert.deepStrictEqual(entries.map(entry => entry.starter_count), counts);
		}
	});

	_it('keeps youth classifications from imported registrations independent of the senior cutoff choice', () => {
		const matches = matchesFor('JE U13', [team('U13 Erster', 2014), team('U11 Erster', 2016), team('U13 Zweiter', 2015), team('U11 Zweiter', 2017)]);
		matches.forEach(match => {match.setup.draw_id = 53;match.setup.teams[0].players[0].entries = {53: '<none>'};});
		const tournament = {certificate_age_class_splits: {'JE U13': ['U11']}, events: {events: [{name: 'JE U13'}]}};
		const options = {tournament, include_age_class_splits: true};
		const baseline = csv.get_certificate_event_options(matches, options);
		assert.deepStrictEqual(baseline.map(entry => entry.starter_count), [2, 2]);
		const rows = csv.build_certificate_rows(matches, tournament);
		for (const certificate_senior_age_basis of ['calendar', 'season', 'previous_calendar', 'previous_season']) {
			const saved = {...tournament, certificate_senior_age_basis};
			assert.deepStrictEqual(csv.get_certificate_event_options(matches, {...options, tournament: saved}), baseline);
			assert.deepStrictEqual(csv.build_certificate_rows(matches, saved), rows);
		}
	});

	_it('keeps unknown birth years and inconsistent dates out of automatic splits', () => {
		for (const change of [
			matches => {delete matches[1].setup.teams[1].players[0].birth_year;},
			matches => {matches[1].setup.teams[1].players[0].birth_year = null;},
			matches => {matches.forEach(match => {delete match.setup.scheduled_date;});},
			matches => {matches[1].setup.scheduled_date = '2027-08-01';},
			matches => {matches[0].setup.teams[0].players[0].birth_year = 2000;},
		]) {
			const matches = matchesFor();change(matches);
			const entries = csv.get_certificate_event_options(matches, splitOptions());
			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].age_class_candidates, undefined);
			assert(entries[0].age_class_split_unavailable_reason);
			assert.strictEqual(entries[0].label, 'HE O40+45');
		}
		const matches = matchesFor(), player = matches[0].setup.teams[0].players[0];
		player.birth_year = null;player.date_of_birth = '1985-12-31';
		assert.deepStrictEqual(csv.get_certificate_event_options(matches)[0].age_class_candidates, ['O45']);
	});

	_it('does not award a provisional age-class winner when earlier overall places are unresolved', () => {
		const matches = matchesFor();delete matches[0].team1_won;matches[0].network_score = [];
		const options = splitOptions(), entries = csv.get_certificate_event_options(matches, options);
		assert.strictEqual(entries.length, 2);
		assert(entries.every(entry => !csv.event_is_complete_for_max_place(entry, 1) && entry.available_places.length === 0));
		assert.deepStrictEqual(csv.build_certificate_rows(matches, {}, {...options, selected_certificate_keys: new Set(['HE 40+45', 'HE 40+45::age:O45'])}), []);
		matches[0].team1_won = true;matches[0].network_score = [[21, 10], [21, 12]];
		delete matches[1].team1_won;matches[1].network_score = [];
		const partial = csv.get_certificate_event_options(matches, options);
		assert(partial.every(entry => csv.event_is_complete_for_max_place(entry, 1) && !csv.event_is_complete_for_max_place(entry, 2)));
	});

	_it('preserves replacements, dates, export keys and the shared PDF/DOCX records for separated classes', () => {
		const matches = matchesFor(), options = {...splitOptions(), include_document_dates: true, selected_certificate_keys: new Set(['HE 40+45::age:O45'])};
		const tournament = {certificate_discipline_replacements: [{discipline: 'HE', replace: 'Herreneinzel'}]};
		const entries = csv.get_certificate_event_options(matches, {...options, tournament});
		assert.strictEqual(entries[1].label, 'Herreneinzel O45 (aus O40+45)');
		const rows = csv.build_certificate_rows(matches, tournament, options);
		assert(rows.every(row => row.event_name === 'HE 40+45::age:O45' && row.datum_letztes_spiel === '21.11.2026'));
		assert(design.records(rows).every(record => design.resolve('{disziplin} {ak}', record) === 'Herreneinzel O45'));
		assert(csv.make_csv(csv.certificate_rows_to_table(rows)).includes(';Herreneinzel;O45;'));
	});

	_it('does not duplicate an existing separate discipline or split an event without combined O ages', () => {
		const matches = matchesFor();matches.push(matchesFor('HE O45', [team('Separat A', 1980), team('Separat B', 1978)])[0]);
		const entries = csv.get_certificate_event_options(matches, splitOptions());
		assert(entries.every(entry => !entry.is_age_class_split && !entry.age_class_candidates));
		assert.strictEqual(csv.get_certificate_event_options(matchesFor('HE 35'))[0].age_class_candidates, undefined);
	});

	_it('derives separate senior rankings from a completed round-robin group', () => {
		const teams = [team('O45 Erster', 1980), team('O40 Erster', 1985), team('O40 Zweiter', 1984), team('O45 Zweiter', 1979)];
		const matches = [];
		for (let first = 0; first < teams.length; first += 1) {
			for (let second = first + 1; second < teams.length; second += 1) {
				const match = matchesFor('HE 40+45', [teams[first], teams[second]])[0];
				match.setup.match_name = 'G' + (matches.length + 1);matches.push(match);
			}
		}
		const options = {...splitOptions(), selected_certificate_keys: new Set(['HE 40+45', 'HE 40+45::age:O45'])};
		assert(csv.get_certificate_event_options(matches, options).every(entry => csv.event_is_complete_for_max_place(entry, 2)));
		assert.deepStrictEqual(csv.build_certificate_rows(matches, {}, options).map(row => [row.ak, row.place, row.spieler_1]), [
			['O40', 2, 'O40 Zweiter'], ['O40', 1, 'O40 Erster'], ['O45', 2, 'O45 Zweiter'], ['O45', 1, 'O45 Erster'],
		]);
	});
});
