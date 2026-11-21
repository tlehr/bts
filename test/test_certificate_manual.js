'use strict';

const assert = require('assert');
const {promisify} = require('util');
const {_describe, _it} = require('./tutils');
const csv = require('../static/js/ccsvexport');
const schema = require('../static/js/certificate_manual');
const design = require('../static/js/certificate_design');
const database = require('../bts/database');
const admin = require('../bts/admin');
const team = (...names) => ({players: names.map(name => ({name, btp_id: name}))});
function fixture(event = 'HE O40+45', doubles = false) {
	return [{team1_won: true, network_score: [[21, 10], [21, 12]], setup: {
		event_name: event, match_name: 'Finale', scheduled_date: '2026-11-21',
		teams: doubles ? [team('Anna', 'Bea'), team('Clara', 'Dora')] : [team('Anton'), team('Bert')],
	}}];
}
function fourPlaces() {
	const matches = fixture();
	matches.push({...matches[0], setup: {...matches[0].setup, match_name: '3/4', teams: [team('Claus'), team('Dirk')]}});
	return matches;
}

_describe('Manual certificates', () => {
	_it('offers actual participants before results exist, but not unresolved placeholders or incomplete pairs', () => {
		const matches = fixture('HD O35', true);delete matches[0].team1_won;matches[0].setup.match_name = 'Runde 1';
		matches.push({...matches[0], setup: {...matches[0].setup, teams: [team('Gewinner #1', 'Noch offen'), team('Nur ein Partner')]}});
		const entries = csv.get_manual_certificate_entries(matches, {});
		assert.strictEqual(entries.length, 2);assert(entries.every(entry => entry.place === '' && entry.ak === 'O35'));
		assert(entries.every(entry => entry.players.length === 2));
	});
	_it('deduplicates reversed pairs and stages with stable keys and keeps disciplines distinct', () => {
		const matches = fixture('HD O35', true), key = csv.get_manual_certificate_entries(matches, {})[0].key;
		matches.push({...matches[0], setup: {...matches[0].setup, event_name: 'HD O35 - Gruppe A', teams: matches[0].setup.teams.map(value => ({players: [...value.players].reverse()}))}});
		assert.strictEqual(csv.get_manual_certificate_entries(matches, {}).length, 2);
		assert.strictEqual(csv.get_manual_certificate_entries([...matches].reverse(), {})[0].key, key);
		matches.push({...matches[0], setup: {...matches[0].setup, event_name: 'DD O35'}});
		assert.strictEqual(new Set(csv.get_manual_certificate_entries(matches, {}).map(entry => entry.key)).size, 4);
	});
	_it('derives sporting places and ignores legacy saved places outside and inside manual mode', () => {
		const matches = fixture(), before = JSON.stringify(matches), [first] = csv.get_manual_certificate_entries(matches, {});
		assert.strictEqual(first.place, '1');
		const tournament = {certificate_manual_entries: [{key: first.key, ak: 'O55', place: '12'}]};
		const options = {manual_certificates: true, selected_certificate_keys: new Set([first.key]), max_place: 1};
		const rows = csv.build_certificate_rows(matches, tournament, options);
		assert.strictEqual(rows.length, 1);assert.strictEqual(rows[0].ak, 'O55');assert.strictEqual(rows[0].platz, '1. Platz');
		assert.strictEqual(rows[0].event_name, first.key);assert.strictEqual(rows[0].source_event_name, 'HE O40+45');
		assert.deepStrictEqual(csv.build_certificate_rows(matches, tournament), csv.build_certificate_rows(matches, {}));
		assert.deepStrictEqual(csv.build_certificate_rows(matches, tournament, {manual_certificates: true}), []);
		assert.strictEqual(JSON.stringify(matches), before);
	});
	_it('exports calculated age-class places, preserving partners, replacements and the source last-game date', () => {
		const matches = fixture('HD O35', true);
		const [first] = csv.get_manual_certificate_entries(matches, {}), tournament = {certificate_discipline_replacements: [{discipline: 'HD', replace: 'Herrendoppel'}]};
		const options = {manual_certificates: true, include_document_dates: true, selected_certificate_keys: new Set([first.key]), certificate_manual_entries: [{key: first.key, ak: 'Offene Klasse'}]};
		const rows = csv.build_certificate_rows(matches, tournament, options);
		assert.deepStrictEqual(rows.map(row => [row.disziplin, row.ak, row.place, row.spieler_1, row.spieler_2, row.datum_letztes_spiel]), [['Herrendoppel', 'Offene Klasse', 1, 'Anna', 'Bea', '21.11.2026']]);
		assert.deepStrictEqual(design.records(rows).map(record => [record.name, record.partner, record.platz]), [['Anna', 'Bea', '1. Platz'], ['Bea', 'Anna', '1. Platz']]);
		const swapped = csv.build_certificate_rows(matches, tournament, {...options, certificate_export_double_swapped_entries_enabled: true});
		assert.strictEqual(swapped.length, 2);assert.strictEqual(swapped[1].spieler_1, 'Bea');
		assert(csv.make_csv(csv.certificate_rows_to_table(rows)).includes(';Herrendoppel;Offene Klasse;1. Platz;Anna;Bea'));
		assert.deepStrictEqual(csv.build_certificate_preview_rows(matches, tournament, {...options, kind: 'double'}), rows);
	});
	_it('rejects invalid selected values and never exports stale participants or unselected drafts', () => {
		const matches = fixture(), [first] = csv.get_manual_certificate_entries(matches, {});
		for (const ak of ['', '  ', 'A'.repeat(41)]) {
			assert.deepStrictEqual(csv.build_certificate_rows(matches, {}, {manual_certificates: true, selected_certificate_keys: new Set([first.key]), certificate_manual_entries: [{key: first.key, ak}]}), []);
		}
		const options = {manual_certificates: true, selected_certificate_keys: new Set(['manual:missing']), certificate_manual_entries: [{key: 'manual:missing', ak: 'U13', place: '1'}]};
		assert.deepStrictEqual(csv.build_certificate_rows(matches, {}, options), []);
	});
	_it('ranks within each assigned age using every starter, independent of export selection', () => {
		const matches = fourPlaces(), original = JSON.stringify(matches), entries = csv.get_manual_certificate_entries(matches, {});
		const assignments = entries.map((entry, i) => ({key: entry.key, ak: i % 2 ? 'O45' : 'O40'}));
		const options = {manual_certificates: true, certificate_manual_entries: assignments, selected_certificate_keys: new Set([entries[3].key])};
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, {}, options).map(entry => [entry.name, entry.overall_label, entry.ak, entry.place]), [
			['Anton', '1. Platz', 'O40', '1'], ['Bert', '2. Platz', 'O45', '1'], ['Claus', '3. Platz', 'O40', '2'], ['Dirk', '4. Platz', 'O45', '2'],
		]);
		assert.deepStrictEqual(csv.build_certificate_rows(matches, {}, options).map(row => [row.spieler_1, row.place]), [['Dirk', 2]]);
		assignments[1].ak = 'O40';
		assert.strictEqual(csv.build_certificate_rows(matches, {}, options)[0].place, 1);
		assignments[1].ak = ' o45 ';
		assert.strictEqual(csv.build_certificate_rows(matches, {}, options)[0].place, 2);
		assert.strictEqual(JSON.stringify(matches), original);
	});
	_it('keeps an earlier unresolved result or age assignment from manufacturing a lower age-class winner', () => {
		const matches = fourPlaces();delete matches[0].team1_won;matches[0].network_score = [];
		let entries = csv.get_manual_certificate_entries(matches, {});
		assert(entries.every(entry => !entry.place));
		assert.strictEqual(entries.find(entry => entry.name === 'Claus').overall_label, '3. Platz');
		const selected = new Set(entries.map(entry => entry.key));
		assert.deepStrictEqual(csv.build_certificate_rows(matches, {}, {manual_certificates: true, selected_certificate_keys: selected}), []);
		matches[0].team1_won = true;
		entries = csv.get_manual_certificate_entries(matches, {});
		const options = {certificate_manual_entries: [{key: entries[1].key, ak: ''}]};
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, {}, options).map(entry => entry.place), ['1', '', '', '']);
	});
	_it('keeps already established top places available while later results remain open', () => {
		const matches = fourPlaces();delete matches[1].team1_won;matches[1].network_score = [];
		const entries = csv.get_manual_certificate_entries(matches, {});
		assert.deepStrictEqual(entries.map(entry => entry.place), ['1', '2', '', '']);
	});
	_it('preserves the original result when automatic age-class splits have already renumbered it', () => {
		const matches = fourPlaces();
		matches.forEach((match, index) => match.setup.teams.forEach((value, i) => {value.players[0].birth_year = [1984, 1980, 1976, 1981][index * 2 + i];}));
		const tournament = {certificate_age_class_splits: {'HE O40+45': ['O45']}};
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, tournament).map(entry => [entry.name, entry.overall_from, entry.ak, entry.place]), [
			['Anton', 1, 'O40', '1'], ['Bert', 2, 'O45', '1'], ['Claus', 3, 'O45', '2'], ['Dirk', 4, 'O40', '2'],
		]);
	});
	_it('uses authoritative group rankings, retains ties and keeps different source disciplines separate', () => {
		const matches = fixture('HE O40');matches[0].setup.match_name = 'G1';
		matches[0].setup.btp_group_rankings = [
			{place_from: 1, place_to: 1, team: team('Bert')}, {place_from: 2, place_to: 2, team: team('Anton')},
		];
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, {}).map(entry => [entry.name, entry.place]), [['Bert', '1'], ['Anton', '2']]);
		const other = fixture('HE O45');
		const all = [...matches, ...other], assignments = csv.get_manual_certificate_entries(all, {}).map(entry => ({key: entry.key, ak: 'O55'}));
		assert.deepStrictEqual(csv.get_manual_certificate_entries(all, {}, {certificate_manual_entries: assignments}).map(entry => entry.place), ['1', '2', '1', '2']);
		matches[0].setup.btp_group_rankings.forEach(entry => {entry.place_from = 1;entry.place_to = 2;});
		assert(csv.get_manual_certificate_entries(matches, {}).every(entry => !entry.place && entry.overall_label === '1.-2. Platz'));
	});
	_it('uses BTP age ranges and removes separately covered classes only for the same discipline', () => {
		const matches = [...fixture('DD 40+55', true), ...fixture('DD 60+65', true), ...fixture('DD 70', true)];
		const tournament = {events: {events: [
			{name: 'DD 40+55', min_age: 39, max_age: 0}, {name: 'DD 60+65', min_age: 59, max_age: 0}, {name: 'DD 70', min_age: 69, max_age: 0},
			{name: 'HD 45', min_age: 44, max_age: 0}, {name: 'DE 50', min_age: 49, max_age: 0},
		]}};
		const ages = name => csv.get_manual_certificate_entries(matches, tournament).find(entry => entry.source_event_name === name).age_options;
		assert.deepStrictEqual(ages('DD 40+55'), ['O40', 'O45', 'O50', 'O55']);
		assert.deepStrictEqual(ages('DD 60+65'), ['O60', 'O65']);
		assert.deepStrictEqual(ages('DD 70'), ['O70']);
		// A separate event counts even before any of its matches have been imported.
		tournament.events.events.push({name: 'DD 45', min_age: 44, max_age: 0}, {name: 'DD 50', min_age: 49, max_age: 0});
		assert.deepStrictEqual(ages('DD 40+55'), ['O40', 'O55']);
		tournament.events.events.pop();tournament.events.events.at(-1).max_age = 49;
		assert.deepStrictEqual(ages('DD 40+55'), ['O40', 'O50', 'O55']);
	});
	_it('gives explicit BTP boundaries priority over the discipline name', () => {
		const matches = fixture('DD 40+55', true), tournament = {events: [{name: 'DD 40+55', min_age: 49, max_age: 64}]};
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, tournament)[0].age_options, ['O50', 'O55', 'O60']);
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, {})[0].age_options, ['O40', 'O45', 'O50', 'O55']);
	});
	_it('applies youth BTP boundaries and excludes the range covered by a separate younger discipline', () => {
		const matches = fixture('JE U19'), tournament = {events: [{name: 'JE U19', min_age: 12, max_age: 18}, {name: 'ME U17', min_age: 0, max_age: 16}]};
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, tournament)[0].age_options, ['U13', 'U15', 'U17', 'U19']);
		tournament.events.push({name: 'JE U15', min_age: 0, max_age: 14});
		assert.deepStrictEqual(csv.get_manual_certificate_entries(matches, tournament)[0].age_options, ['U17', 'U19']);
	});
	_it('preserves custom assignments without adding them to the suggested range for any participant', () => {
		const matches = fixture('DD 60+65', true), [first] = csv.get_manual_certificate_entries(matches, {});
		const tournament = {certificate_manual_entries: [{key: first.key, ak: 'O55'}]};
		const entries = csv.get_manual_certificate_entries(matches, tournament);
		assert.strictEqual(entries[0].ak, 'O55');
		assert(entries.every(entry => !entry.age_options.includes('O55')));
	});
	for (const handler of ['handle_tournament_edit_props', 'handle_tournament_edit_prop']) {
		const message = value => ({key: 'manual-test', ...(handler.endsWith('_props') ? {props: {certificate_manual_entries: value}} : {field: 'certificate_manual_entries', value})});
		_it('persists drafts, including unfinished entries, through ' + handler, async () => {
			const db = await database.init_test();
			await promisify(db.tournaments.insert.bind(db.tournaments))({key: 'manual-test', displaysettings_general: 'display', displaysettings_general_tablet: 'tablet'});
			const value = [{key: 'manual:player', ak: 'O45'}, {key: 'manual:pair', ak: ''}];
			assert.strictEqual(schema.validate(value), '');
			await new Promise((resolve, reject) => admin[handler]({db}, {respond(_msg, error) {if (error) reject(error);else resolve();}}, message(value)));
			assert.deepStrictEqual((await promisify(db.tournaments.findOne.bind(db.tournaments))({key: 'manual-test'})).certificate_manual_entries, value);
		});
		_it('accepts the compatible legacy wire field but stores only age assignments through ' + handler, async () => {
			const db = await database.init_test();
			await promisify(db.tournaments.insert.bind(db.tournaments))({key: 'manual-test', displaysettings_general: 'display', displaysettings_general_tablet: 'tablet'});
			const value = [{key: 'manual:player', ak: 'O55', place: ''}, {key: 'manual:pair', ak: 'O40', place: '12'}];
			await new Promise((resolve, reject) => admin[handler]({db}, {respond(_msg, error) {if (error) reject(error);else resolve();}}, message(value)));
			assert.deepStrictEqual((await promisify(db.tournaments.findOne.bind(db.tournaments))({key: 'manual-test'})).certificate_manual_entries, [{key: 'manual:player', ak: 'O55'}, {key: 'manual:pair', ak: 'O40'}]);
			assert.strictEqual(value[1].place, '12');
		});
		_it('rejects malformed drafts before database access through ' + handler, () => {
			for (const value of [{}, null, [{key: 'HE O45', ak: 'O45', place: '1'}], [{key: 'manual:x', ak: {}, place: '1'}], [{key: 'manual:x', ak: 'O45', place: 1}], [{key: 'manual:x', ak: 'A'.repeat(41), place: '1'}]]) {
				let error;admin[handler]({db: {tournaments: {findOne() {throw new Error('Database must not be touched');}}}}, {respond(_msg, err) {error = err;}}, message(value));
				assert(error?.message.includes('manuelle Urkundeneinträge'));
			}
		});
	}
});
