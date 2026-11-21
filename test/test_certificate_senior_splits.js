'use strict';

const assert = require('assert');
const {_describe, _it} = require('./tutils');
const csv = require('../static/js/ccsvexport');
const design = require('../static/js/certificate_design');

function team(name, ...birthYears) {
	return {players: birthYears.map((birth_year, index) => ({name: name + (birthYears.length > 1 ? ' ' + index : ''), birth_year}))};
}

function matchesFor(event = 'HE 40+45', teams = [team('O40 Sieger', 1986), team('O45 Sieger', 1981), team('O45 Zweiter', 1976), team('O40 Zweiter', 1985)]) {
	return Array.from({length: teams.length / 2}, (_, index) => ({
		team1_won: true, network_score: [[21, 10], [21, 12]],
		setup: {event_name: event, match_name: index ? `${2 * index + 1}/${2 * index + 2}` : 'Finale',
			scheduled_date: '2026-11-21', scheduled_time_str: '18:00', teams: teams.slice(2 * index, 2 * index + 2)},
	}));
}

const splitOptions = (event = 'HE 40+45', ages = ['O45']) => ({
	include_age_class_splits: true, max_place: 2, certificate_age_class_splits: {[event]: ages},
});

_describe('Senior certificate age-class splits', () => {
	_it('offers only the combined O classes and ranks the remaining and separated classes independently', () => {
		const matches = matchesFor(), before = JSON.stringify(matches);
		const [original] = csv.get_certificate_event_options(matches);
		assert.strictEqual(original.label, 'HE O40+45');
		assert.deepStrictEqual(original.age_class_candidates, ['O45']);
		assert(original.age_class_split_note.includes('01.01.2027'));
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
			const matches = matchesFor(event, [team('Jüngeres Paar', 1960, 1986), team('Älteres Paar', 1971, 1968), team('Zweites älteres Paar', 1970, 1966), team('Zweites jüngeres Paar', 1981, 1965)]);
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

	_it('uses the DBV season cutoff across August and New Year, independent of the export date', () => {
		for (const [date, cutoff, olderCount] of [['2026-07-31', 2026, 1], ['2026-08-01', 2027, 2], ['2026-12-31', 2027, 2], ['2027-01-01', 2027, 2]]) {
			const matches = matchesFor('HE 40+45', [team('Jünger', 1985), team('Grenzjahrgang', 1981), team('Älter', 1980), team('Auch jünger', 1984)]);
			matches.forEach(match => {match.setup.scheduled_date = date;});
			const options = splitOptions(), entries = csv.get_certificate_event_options(matches, options);
			assert(entries[0].age_class_split_note.includes(`01.01.${cutoff}`), date);
			assert.strictEqual(entries[1].starter_count, olderCount, date);
			const rows = csv.build_certificate_rows(matches, {}, {...options, selected_certificate_keys: new Set(['HE 40+45::age:O45']), now: new Date('2038-01-01T12:00:00Z')});
			assert.strictEqual(rows.length, olderCount, date);
		}
		const acrossYears = matchesFor();acrossYears[1].setup.scheduled_date = '2027-01-01';
		assert.deepStrictEqual(csv.get_certificate_event_options(acrossYears)[0].age_class_candidates, ['O45']);
	});

	_it('supports several senior splits without inventing intermediate age classes or counting teams twice', () => {
		const event = 'HE O35+45+55', matches = matchesFor(event, [team('A', 1991), team('B', 1981), team('C', 1971), team('D', 1980), team('E', 1970), team('F', 1988)]);
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

	_it('keeps unknown birth years and inconsistent seasons out of automatic splits', () => {
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
		player.birth_year = null;player.date_of_birth = '1986-12-31';
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
		const teams = [team('O45 Erster', 1981), team('O40 Erster', 1986), team('O40 Zweiter', 1985), team('O45 Zweiter', 1980)];
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
