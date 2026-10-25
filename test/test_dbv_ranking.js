'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { promisify } = require('util');
const xlsx = require('node-xlsx');
const parser = require('../bts/dbv_ranking/parse');
const service = require('../bts/dbv_ranking');
const admin = require('../bts/admin');
const database = require('../bts/database');

const HEADERS = ['GS', 'DIS', 'Ranglistenplatz', 'FRang', 'Nachname', 'Vorname', 'SpielerID', 'GJahr', 'AKL1', 'AKL2', 'Points', 'Turniere', 'Verein'];
function workbook(rows) {
	return xlsx.build([{ name: 'Worksheet', data: [HEADERS, ...rows] }]);
}
const rows = () => [
	['M', 'HE', 4, 4, 'Müller', 'Max', '01-012345', 2011, 'U17-1', 'U17', 123456, 7, 'BC Test'],
	['M', 'HD', 6, 6, 'Müller', 'Max', '01-012345', 2011, 'U17-1', 'U17', 34567, 7, 'BC Test'],
	['M', 'HM', 8, 8, 'Müller', 'Max', '01-012345', 2011, 'U17-1', 'U17', 23456, 7, 'BC Test'],
	['F', 'DM', 9, 9, 'Weiß', 'Lena', '02-012345', 2012, 'U15-2', 'U15', 54321, 7, 'BC Test'],
];
function tournament(name = 'JE U17') {
	return { key: 'default', events: { events: [{ id: 1, name, stages: [{ id: 2, stage_type: 1, entries: [{
		stage_entry_id: 3, team: { players: [{ btp_id: 4, member_id: '01-012345', name: 'Max Müller', gender: 'M', date_of_birth: '2011-04-03', club: 'BC Test' }] },
	}] }] }] } };
}
function call(handler, app, msg) {
	return new Promise((resolve, reject) => {
		Promise.resolve(handler(app, { respond: (_request, err, response) => resolve({ err, response }) }, msg)).catch(reject);
	});
}

describe('DBV ranking import', function() {
	afterEach(() => service.client.close());

	it('reads the real DBV headers, discipline-specific integers, rank and zero points', function() {
		const data = rows(); data[0][10] = 0;
		const result = parser.parse(workbook(data));
		assert.strictEqual(result[0].points, 0);
		assert.strictEqual(result[0].ranking_place, 4);
		assert.strictEqual(result[1].points, 34567);
		assert.strictEqual(result[3].gender, 'F');
		assert.strictEqual(result[0].member_id, '01-012345');
	});
	it('supports historical German header and number formats without corrupting numeric cells', function() {
		const headers = HEADERS.map(label => label === 'Points' ? 'Punkte' : label === 'Ranglistenplatz' ? 'Rang' : label);
		const data = rows(); data[0][10] = '123.456'; data[1][10] = 1234.5;
		const result = parser.parse(xlsx.build([{ name: 'alt', data: [[], headers, ...data] }]));
		assert.strictEqual(result[0].points, 123456);
		assert.strictEqual(result[1].points, 1234.5);
		assert.strictEqual(result[0].ranking_place, 4);
	});
	it('rejects HTML responses, empty lists and invalid ranking values', function() {
		assert.throws(() => parser.parse(Buffer.from('<html>Error</html>')), /keine lesbare|Unsupported|Invalid|Unrecognized/);
		assert.throws(() => parser.parse(workbook([])), /keine lesbare/);
		const data = rows(); data[0][10] = 'fehler';
		assert.throws(() => parser.parse(workbook(data)), /Ungültiger/);
	});
	it('matches the same member separately in singles, doubles and mixed', function() {
		for (const [name, discipline, points] of [['JE U17', 'HE', 123456], ['JD U17', 'HD', 34567], ['MX U17', 'HM', 23456]]) {
			const candidates = parser.collect_candidates(tournament(name), 'u19');
			assert.strictEqual(candidates[0].discipline, discipline);
			assert.strictEqual(parser.match(parser.parse(workbook(rows())), candidates).by_registration_key['3:4'].points, points);
		}
	});
	it('matches women in mixed using DM and handles both BTP and DBV gender labels', function() {
		for (const gender of ['W', 'F']) {
			const doc = tournament('MX U17');
			Object.assign(doc.events.events[0].stages[0].entries[0].team.players[0], { member_id: '02-012345', name: 'Lena Weiß', gender });
			const candidates = parser.collect_candidates(doc, 'u19');
			assert.strictEqual(candidates[0].discipline, 'DM');
			assert.strictEqual(parser.match(parser.parse(workbook(rows())), candidates).by_registration_key['3:4'].points, 54321);
		}
	});
	it('uses event metadata for custom names and leaves an unknown mixed gender unresolved', function() {
		const doc = tournament('Nachwuchs');
		Object.assign(doc.events.events[0], { max_age: 15, game_type_id: 2, gender_id: 2 });
		assert.strictEqual(parser.collect_candidates(doc, 'u19')[0].discipline, 'DD');
		doc.events.events[0].gender_id = 3;
		delete doc.events.events[0].stages[0].entries[0].team.players[0].gender;
		assert.strictEqual(parser.collect_candidates(doc, 'u19')[0].discipline, '');
	});
	it('keeps U19 and O19 competitions separate, including youth players in adult events', function() {
		for (const [name, family] of [['JE U9', 'u19'], ['DE U19', 'u19'], ['HE U22', 'o19'], ['HD O35', 'o19'], ['MX', 'o19']]) {
			assert.strictEqual(parser.event_family({ name }), family);
			assert.strictEqual(parser.collect_candidates(tournament(name), family).length, 1);
			assert.strictEqual(parser.collect_candidates(tournament(name), family === 'u19' ? 'o19' : 'u19').length, 0);
		}
	});
	it('prefers member IDs even with a changed name or club and refuses conflicting IDs', function() {
		const ranking = parser.parse(workbook(rows()));
		const candidate = { key: 'a', discipline: 'HE', member_id: '01 012345', player_name: 'Other Name', club: 'New Club' };
		assert.strictEqual(parser.match(ranking, [candidate]).matched_count, 1);
		candidate.member_id = '99-999999'; candidate.player_name = 'Max Müller';
		assert.strictEqual(parser.match(ranking, [candidate]).matched_count, 0);
	});
	it('uses normalized names, birth years and clubs only when no member ID is available', function() {
		const ranking = parser.parse(workbook(rows()));
		const candidate = { key: 'a', discipline: 'HE', player_name: 'MULLER, MAX', birth_year: 2011, club: 'BC Test' };
		assert.strictEqual(parser.match(ranking, [candidate]).matched_count, 1);
		candidate.birth_year = 2010;
		assert.strictEqual(parser.match(ranking, [candidate]).matched_count, 0);
		candidate.birth_year = 2011; candidate.club = 'Other Club';
		assert.strictEqual(parser.match(ranking, [candidate]).matched_count, 0);
	});
	it('assigns zero to missing players and leaves ambiguous matches unresolved', function() {
		const data = rows(); data.push([...data[0]]); data[4][6] = '02-999999'; data[4][10] = 999;
		const ranking = parser.parse(workbook(data));
		const result = parser.match(ranking, [{ key: 'a', discipline: 'HE', player_name: 'Max Müller' }, { key: 'b', discipline: 'HE', player_name: 'Unknown Player' }]);
		assert.strictEqual(result.unmatched_count, 2);
		assert.strictEqual(result.unmatched[0].reason, 'Mehrdeutiger Treffer');
		assert.strictEqual(result.by_registration_key.a.points, null);
		assert.strictEqual(result.by_registration_key.b.points, 0);
	});
	it('uses member IDs from previously imported BTP details if needed', function() {
		const doc = tournament(); delete doc.events.events[0].stages[0].entries[0].team.players[0].member_id;
		doc.registration_xlsx_metadata = { by_registration_key: { '3:4': { member_id: '01-012345' } } };
		assert.strictEqual(parser.collect_candidates(doc, 'u19')[0].member_id, '01-012345');
	});
	it('lists only the selected archive family, sorted by year and week', function() {
		const html = '<a href="/uploads/ranking/Ranking_2025_KW52.xlsx">x</a><a href="/uploads/ranking/Ranking_2026_KW01.xlsx">x</a>' +
			'<a href="/uploads/ranking/Ranking_2026_KW01.xlsx">duplicate</a><a href="/uploads/ranking/Ranking_2026_KW02_O19.xlsx">x</a>';
		assert.deepStrictEqual(service.parse_catalog(html, 'u19').map(item => item.id), ['current', '2026-01', '2025-52']);
		assert.deepStrictEqual(service.parse_catalog(html, 'o19').map(item => item.id), ['current', '2026-02']);
		assert.throws(() => service.parse_catalog('<html>error</html>', 'u19'), /archiv/i);
	});
	it('restricts all downloads to validated DBV versions and families', function() {
		assert.strictEqual(service.download_path('u19', 'current'), '/ranking/download');
		assert.strictEqual(service.download_path('o19', '2026-01'), '/uploads/ranking/Ranking_2026_KW01_O19.xlsx');
		for (const version of ['2026-00', '2026-54', '../../secret', 'https://example.org/file.xlsx']) assert.throws(() => service.download_path('u19', version));
		assert.throws(() => service.download_path('unknown', 'current'));
	});
	it('downloads and parses in an isolated worker and reports network and HTTP failures', async function() {
		const original = https.get;
		let status = 200, failed = false;
		https.get = (_url, _options, callback) => {
			const req = new EventEmitter(); req.destroy = err => { req.emit('error', err); req.emit('close'); };
			setImmediate(() => {
				if (failed) return req.destroy(new Error('network unavailable'));
				const res = Readable.from([workbook(rows())]);
				res.statusCode = status; res.headers = { 'content-disposition': 'attachment;filename="Ranking.xlsx"' };
				res.on('end', () => req.emit('close'));
				callback(res);
			});
			return req;
		};
		try {
			const result = await service.load('u19', 'current', parser.collect_candidates(tournament(), 'u19'));
			assert.strictEqual(result.matched_count, 1); assert.strictEqual(result.row_count, 4);
			assert.strictEqual(result.file_name, 'Ranking.xlsx'); assert(service.client.worker);
			status = 404; await assert.rejects(service.load('u19', '2026-01', []), /HTTP 404/);
			failed = true; await assert.rejects(service.load('u19', 'current', []), /network unavailable/);
		} finally { https.get = original; }
	});

	describe('admin persistence', function() {
		let original;
		beforeEach(() => { original = service.load; });
		afterEach(() => { service.load = original; });
		async function setup() {
			const db = await database.init_test();
			const doc = tournament();
			doc.registration_dbv_rankings = { event_9: { label: 'Existing adult ranking' } };
			doc.registration_xlsx_metadata = { file_name: 'BTP.xlsx', by_registration_key: { '3:4': { points: 3, strength: 'A' } } };
			await promisify(db.tournaments.insert.bind(db.tournaments))(doc);
			return { db, clock: { now_ms: () => 1234567890 } };
		}
		const msg = { tournament_key: 'default', family: 'u19', version: '2026-01' };
		it('saves provenance and counts while preserving the other family and BTP details', async function() {
			const app = await setup();
			service.load = async (_family, _version, candidates) => ({ ...parser.match(parser.parse(workbook(rows())), candidates), label: 'DBV U19 – 2026 / KW 01' });
			const result = await call(admin.async_handle_registration_dbv_import, app, msg);
			assert.ifError(result.err);
			const saved = await app.db.tournaments.findOne_async({ key: 'default' });
			assert.strictEqual(saved.registration_dbv_rankings.event_1.by_registration_key['3:4'].points, 123456);
			assert.strictEqual(saved.registration_dbv_rankings.event_1.imported_at, '1970-01-15T06:56:07.890Z');
			assert.strictEqual(saved.registration_dbv_rankings.event_9.label, 'Existing adult ranking');
			assert.strictEqual(saved.registration_xlsx_metadata.by_registration_key['3:4'].points, 3);
		});
		it('does not write after a reset, a changed registration or a failed download', async function() {
			for (const change of ['reset', 'registration', 'network']) {
				const app = await setup();
				service.load = async () => {
					if (change === 'network') throw new Error('unavailable');
					await app.db.tournaments.update_async({ key: 'default' }, { $set: change === 'reset' ? { last_reset_ts: 123 } : { events: { events: [] } } }, {});
					return { by_registration_key: {} };
				};
				const result = await call(admin.async_handle_registration_dbv_import, app, msg);
				assert(result.err);
				assert.strictEqual((await app.db.tournaments.findOne_async({ key: 'default' })).registration_dbv_rankings.event_1, undefined);
			}
		});
		it('replaces old points, including newly unresolved registrations, when selecting another week', async function() {
			const app = await setup();
			service.load = async (_family, _version, candidates) => parser.match(parser.parse(workbook(rows())), candidates);
			assert.ifError((await call(admin.async_handle_registration_dbv_import, app, msg)).err);
			service.load = async (_family, _version, candidates) => parser.match([], candidates);
			assert.ifError((await call(admin.async_handle_registration_dbv_import, app, { ...msg, version: '2025-52' })).err);
			const saved = await app.db.tournaments.findOne_async({ key: 'default' });
			assert.strictEqual(saved.registration_dbv_rankings.event_1.by_registration_key['3:4'].points, 0);
		});
		it('applies explicit competition selections across age defaults and preserves unselected imports', async function() {
			const app = await setup();
			const events = tournament().events;
			const adult = JSON.parse(JSON.stringify(events.events[0]));
			adult.id = 2; adult.name = 'HE U22'; adult.stages[0].entries[0].stage_entry_id = 30;
			events.events.push(adult);
			await app.db.tournaments.update_async({ key: 'default' }, { $set: { events } }, {});
			service.load = async (family, version, candidates) => ({ ...parser.match(parser.parse(workbook(rows())), candidates), family, version });
			assert.ifError((await call(admin.async_handle_registration_dbv_import, app, msg)).err);
			assert.ifError((await call(admin.async_handle_registration_dbv_import, app, { ...msg, event_keys: ['2'], version: '2025-52' })).err);
			let saved = await app.db.tournaments.findOne_async({ key: 'default' });
			assert.strictEqual(saved.registration_dbv_rankings.event_1.version, '2026-01');
			assert.strictEqual(saved.registration_dbv_rankings.event_2.version, '2025-52');
			assert.strictEqual(saved.registration_dbv_rankings.event_2.by_registration_key['30:4'].points, 123456);
			assert.ifError((await call(admin.async_handle_registration_dbv_import, app, { ...msg, family: 'o19', event_keys: ['1'] })).err);
			saved = await app.db.tournaments.findOne_async({ key: 'default' });
			assert.strictEqual(saved.registration_dbv_rankings.event_1.family, 'o19');
			assert.strictEqual(saved.registration_dbv_rankings.event_2.family, 'u19');
		});
		it('rejects empty, unknown or invalid scope selections without fetching a ranking', async function() {
			const app = await setup();
			service.load = () => { throw new Error('must not fetch'); };
			for (const event_keys of [[], ['99'], ['1.bad'], '1']) {
				const result = await call(admin.async_handle_registration_dbv_import, app, { ...msg, event_keys });
				assert.match(result.err.message, /gültige Konkurrenzen/);
			}
		});
	});

	it('uses DBV values in the UI, retains BTP details and requires both partners for a sum', function() {
		const source = fs.readFileSync(path.join(__dirname, '../static/js/ctournament.js'), 'utf8');
		const context = vm.createContext({ curt: {
			registration_xlsx_metadata: { by_registration_key: { '3:4': { points: 999, strength: 'A' }, '3:5': { points: 888 } } },
			registration_dbv_rankings: { u19: { by_registration_key: { '3:4': { points: 0, ranking_place: 20 }, '3:5': { points: null, ranking_place: null } } } },
		}, registration_player_status_key: (_entry, player) => '3:' + player.btp_id });
		for (const name of ['registration_xlsx_metadata_for_player', 'registration_control_numeric_xlsx_value', 'registration_control_entry_points']) {
			const start = source.indexOf('\tfunction ' + name + '(');
			vm.runInContext(source.slice(start, source.indexOf('\n\tfunction ', start + 1)), context);
		}
		assert.strictEqual(context.registration_xlsx_metadata_for_player({}, { btp_id: 4 }, 0).strength, 'A');
		assert.strictEqual(context.registration_control_entry_points({ entry: {}, players: [{ btp_id: 4 }] }), 0);
		assert.strictEqual(context.registration_control_entry_points({ entry: {}, players: [{ btp_id: 4 }, { btp_id: 5 }] }), null);
		context.curt.registration_dbv_rankings.u19.by_registration_key['3:4'].points = 1234.5;
		context.curt.registration_dbv_rankings.u19.by_registration_key['3:5'].points = 10;
		assert.strictEqual(context.registration_control_entry_points({ entry: {}, players: [{ btp_id: 4 }, { btp_id: 5 }] }), 1244.5);
	});
});
