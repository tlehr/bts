'use strict';

const assert = require('assert');
const xlsx = require('node-xlsx');

const admin = require('../bts/admin');
const database = require('../bts/database');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
		});
	});
}

function call_handler(handler, app, msg) {
	return new Promise((resolve) => {
		const ws = {
			respond(_msg, err, response) {
				resolve({ err, response });
			},
		};
		handler(app, ws, msg);
	});
}

describe('admin registration statuses', function() {
	it('stores and clears a per-player registration status', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const key = 'stage-1:player-7';
		let result = await call_handler(admin.handle_registration_player_status, app, {
			type: 'registration_player_status',
			tournament_key: 'default',
			key,
			status: 'absent',
			registration_status: {
				stage_entry_id: 'stage-1',
				entry_id: 'entry-1',
				entry_name: 'A / B',
				player_id: 'player-7',
				player_index: 1,
				player_name: 'B',
				event_name: 'HD U19',
				stage_id: '11',
				stage_name: 'Main',
				stage_type: 1,
				club: 'OT Bremen',
				state: 'Bremen',
				partner: 'Doppel: A',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.status.status, 'absent');

		let tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.registration_player_statuses[key].player_name, 'B');
		assert.strictEqual(tournament.registration_player_statuses[key].updated_at, '1970-01-15T06:56:07.890Z');

		result = await call_handler(admin.handle_registration_player_status, app, {
			type: 'registration_player_status',
			tournament_key: 'default',
			key,
			status: '',
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.status, null);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.deepStrictEqual(tournament.registration_player_statuses, {});
	});

	it('rejects unsupported registration statuses', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const result = await call_handler(admin.handle_registration_player_status, app, {
			type: 'registration_player_status',
			tournament_key: 'default',
			key: 'stage-1:player-7',
			status: 'maybe',
		});
		assert(result.err);
		assert.match(result.err.message, /Unsupported registration player status/);
	});

	it('resets all registration statuses for a tournament', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			registration_player_statuses: {
				'stage-1:player-7': { key: 'stage-1:player-7', status: 'absent' },
				'stage-2:player-9': { key: 'stage-2:player-9', status: 'present' },
			},
		});

		const result = await call_handler(admin.handle_registration_player_status_reset, app, {
			type: 'registration_player_status_reset',
			tournament_key: 'default',
		});
		assert.ifError(result.err);

		const tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.deepStrictEqual(tournament.registration_player_statuses, {});
	});

	it('stores which registration events are currently open', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			events: {
				events: [
					{ id: 1, name: 'DE U19' },
					{ id: 2, name: 'HD U19' },
				],
			},
		});

		let result = await call_handler(admin.handle_registration_open_event, app, {
			type: 'registration_open_event',
			tournament_key: 'default',
			event_key: '1',
			is_open: false,
		});
		assert.ifError(result.err);
		assert.deepStrictEqual(result.response.open_events, {});

		let tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.deepStrictEqual(tournament.registration_open_events, {});

		result = await call_handler(admin.handle_registration_open_event, app, {
			type: 'registration_open_event',
			tournament_key: 'default',
			event_key: '1',
			is_open: true,
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.deepStrictEqual(tournament.registration_open_events, { 1: true });
	});

	it('rejects invalid registration event open messages', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const result = await call_handler(admin.handle_registration_open_event, app, {
			type: 'registration_open_event',
			tournament_key: 'default',
			event_key: 'bad.event',
			is_open: true,
		});
		assert(result.err);
		assert.match(result.err.message, /Invalid registration event key/);
	});

	it('stores bidirectional player comments and marks them as read', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const key = 'stage-1:player-7';
		let result = await call_handler(admin.handle_registration_player_comment, app, {
			type: 'registration_player_comment',
			tournament_key: 'default',
			key,
			direction: 'control_to_check',
			comment: 'Startgeld kassieren',
			registration_comment: {
				stage_entry_id: 'stage-1',
				player_name: 'B',
				event_name: 'HD U19',
				stage_type: 1,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.comment.read, false);

		result = await call_handler(admin.handle_registration_player_comment, app, {
			type: 'registration_player_comment',
			tournament_key: 'default',
			key,
			direction: 'check_to_control',
			comment: 'Betreuer fragt wegen Setzung',
			registration_comment: {
				stage_entry_id: 'stage-1',
				player_name: 'B',
				event_name: 'HD U19',
				stage_type: 1,
			},
		});
		assert.ifError(result.err);

		let tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.registration_player_comments[key].control_to_check.comment, 'Startgeld kassieren');
		assert.strictEqual(tournament.registration_player_comments[key].check_to_control.comment, 'Betreuer fragt wegen Setzung');

		result = await call_handler(admin.handle_registration_player_comment_read, app, {
			type: 'registration_player_comment_read',
			tournament_key: 'default',
			key,
			direction: 'control_to_check',
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.registration_player_comments[key].control_to_check.read, true);
		assert.strictEqual(tournament.registration_player_comments[key].control_to_check.read_at, '1970-01-15T06:56:07.890Z');
		assert.strictEqual(tournament.registration_player_comments[key].check_to_control.read, false);
	});

	it('rejects invalid registration comment directions', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const result = await call_handler(admin.handle_registration_player_comment, app, {
			type: 'registration_player_comment',
			tournament_key: 'default',
			key: 'stage-1:player-7',
			direction: 'sideways',
			comment: 'Nope',
		});
		assert(result.err);
		assert.match(result.err.message, /Invalid registration player comment direction/);
	});

	it('stores bidirectional stage comments and marks them as read', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const key = 'event_7:stage_9';
		let result = await call_handler(admin.handle_registration_stage_comment, app, {
			type: 'registration_stage_comment',
			tournament_key: 'default',
			key,
			direction: 'check_to_control',
			comment: 'Mehrere Nachfragen am Tisch',
			registration_comment: {
				event_id: 7,
				event_name: 'HD U19',
				stage_id: 9,
				stage_name: 'Main',
				stage_type: 1,
				stage_label: 'Hauptfeld',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.comment.read, false);
		assert.strictEqual(result.response.comment.event_name, 'HD U19');

		result = await call_handler(admin.handle_registration_stage_comment, app, {
			type: 'registration_stage_comment',
			tournament_key: 'default',
			key,
			direction: 'control_to_check',
			comment: 'Bitte Ausweise pruefen',
			registration_comment: {
				event_name: 'HD U19',
				stage_type: 1,
				stage_label: 'Hauptfeld',
			},
		});
		assert.ifError(result.err);

		let tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.registration_stage_comments[key].check_to_control.comment, 'Mehrere Nachfragen am Tisch');
		assert.strictEqual(tournament.registration_stage_comments[key].control_to_check.comment, 'Bitte Ausweise pruefen');

		result = await call_handler(admin.handle_registration_stage_comment_read, app, {
			type: 'registration_stage_comment_read',
			tournament_key: 'default',
			key,
			direction: 'check_to_control',
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.registration_stage_comments[key].check_to_control.read, true);
		assert.strictEqual(tournament.registration_stage_comments[key].check_to_control.read_at, '1970-01-15T06:56:07.890Z');
		assert.strictEqual(tournament.registration_stage_comments[key].control_to_check.read, false);
	});

	it('imports registration ranking metadata from a BTP XLSX list', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			events: {
				events: [{
					id: 13,
					name: 'JD U17',
					stages: [{
						id: 41,
						name: 'Hauptfeld',
						stage_type: 1,
						entries: [{
							stage_entry_id: 700,
							entry_id: 500,
							team: {
								players: [{
									btp_id: 11,
									member_id: '09-010496',
									name: 'Trung Anh Phan',
									date_of_birth: '2011-07-04',
									club: 'BSC Hastedt',
								}],
							},
						}],
					}],
				}],
			},
		});
		const workbook = xlsx.build([{
			name: 'JD U17 - Hauptfeld',
			data: [
				['Turnier'],
				['JD U17 - Hauptfeld'],
				['Badminton Turnier Planer'],
				['Nr.', 'Name', 'Geschlecht', 'Geb', 'Stärke', 'Leistungspunktzahl', 'Ranglistenplatz', 'Punkte', 'SpielerID', 'Verein', 'Verband', 'Bundesland', 'Land', 'Datum'],
				[1, 'Trung Anh Phan', 'M', '04.07.2011', '', '', 1775, 2200, '09-010496', 'BSC Hastedt', '09-BRE', '', 'VIE', '02.04.2026 18:58'],
			],
		}]);

		const result = await call_handler(admin.async_handle_registration_xlsx_upload, app, {
			type: 'registration_xlsx_upload',
			tournament_key: 'default',
			name: 'meldungen.xlsx',
			data_url: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + workbook.toString('base64'),
		});

		assert.ifError(result.err);
		assert.strictEqual(result.response.metadata.row_count, 1);
		assert.strictEqual(result.response.metadata.matched_count, 1);
		assert.strictEqual(result.response.metadata.unmatched_count, 0);
		const tournament = await db.tournaments.findOne_async({ key: 'default' });
		const imported = tournament.registration_xlsx_metadata.by_registration_key['700:11'];
		assert.strictEqual(imported.ranking_place, 1775);
		assert.strictEqual(imported.points, 2200);
		assert.strictEqual(imported.member_id, '09-010496');
		assert.strictEqual(imported.entered_at, '2026-04-02 18:58');
	});
});
