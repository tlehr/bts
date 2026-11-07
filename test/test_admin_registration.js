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

	it('stores and removes local registration accounting entries', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			accounting_items: [{
				id: 'ballrolle',
				name: 'Ballrolle',
				billing_type: 'optional',
				overview_category: 'fee',
				unit_price: 38,
				sale_unit: 'Rolle',
				active: true,
			}],
		});

		let result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				player_id: '45',
				player_name: 'Lyan Stubbe',
				kind: 'charge',
				type: 'item',
				item_id: 'ballrolle',
				item_input_type: 'quantity',
				description: 'Ballrolle',
				quantity: 2,
				unit_price: 99,
				amount: 1,
				purchase_at: '2026-09-13T12:30:00.000Z',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.entry.player_id, '45');
		assert.strictEqual(result.response.entry.unit_price, 38);
		assert.strictEqual(result.response.entry.amount, 76);
		assert.strictEqual(result.response.entry.item_overview_category, 'fee');
		assert.strictEqual(result.response.entry.purchase_at, '2026-09-13T12:30:00.000Z');
		assert.strictEqual(result.response.entry.created_at, '1970-01-15T06:56:07.890Z');

		let tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_entries.length, 1);
		assert.strictEqual(tournament.accounting_entries[0].description, 'Ballrolle');

		result = await call_handler(admin.handle_registration_accounting_entry_update, app, {
			type: 'registration_accounting_entry_update',
			tournament_key: 'default',
			entry_id: result.response.entry.id,
			entry: {
				description: 'Ballrolle VICTOR',
				quantity: 3,
				unit_price: 99,
				amount: 1,
				note: 'Nachbuchung',
				purchase_at: '2026-09-13T13:15:00.000Z',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.entry.description, 'Ballrolle');
		assert.strictEqual(result.response.entry.quantity, 2);
		assert.strictEqual(result.response.entry.unit_price, 38);
		assert.strictEqual(result.response.entry.amount, 76);
		assert.strictEqual(result.response.entry.purchase_at, '2026-09-13T12:30:00.000Z');
		assert.strictEqual(result.response.entry.created_at, '1970-01-15T06:56:07.890Z');
		assert.strictEqual(result.response.entry.updated_at, '1970-01-15T06:56:07.890Z');

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_entries[0].description, 'Ballrolle');
		assert.strictEqual(tournament.accounting_entries[0].note, 'Nachbuchung');

		const original_entry_id = result.response.entry.id;
		result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				player_id: '45',
				player_name: 'Lyan Stubbe',
				kind: 'charge',
				type: 'item',
				item_id: 'ballrolle',
				item_input_type: 'quantity',
				description: 'Storno Ballrolle',
				quantity: -2,
				unit_price: 38,
				amount: -76,
				is_cancellation: true,
				voids_entry_id: original_entry_id,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.entry.is_cancellation, true);
		assert.strictEqual(result.response.entry.voids_entry_id, original_entry_id);
		assert.strictEqual(result.response.entry.quantity, -2);
		assert.strictEqual(result.response.entry.amount, -76);

		result = await call_handler(admin.handle_registration_accounting_entry_remove, app, {
			type: 'registration_accounting_entry_remove',
			tournament_key: 'default',
			entry_id: original_entry_id,
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_entries.length, 1);
	});

	it('stores accounting invoices and receipts with separate numbers', async function() {
		const db = await database.init_test();
		let now = 1234567890;
		const app = { db, clock: { now_ms: () => now } };
		await insert(db, 'tournaments', { key: 'default', name: '1. E-RLT BRE U11-U19' });

		let result = await call_handler(admin.handle_registration_accounting_document, app, {
			type: 'registration_accounting_document',
			tournament_key: 'default',
			document: {
				document_type: 'invoice',
				buyer_type: 'club',
				buyer_id: 'club_bsc_hastedt',
				buyer_name: 'BSC Hastedt',
				club: 'BSC Hastedt',
				state: 'Bremen',
				lines: [{
					description: '19x Meldegeld',
					quantity: 19,
					unit_price: 7,
					amount: 133,
					sale_unit: 'Teilnehmer',
					position_ids: ['fee:player_1:hd_u19:main_draw'],
					caused_by: [{ label: 'Lyan Stubbe', detail: 'HD U19', amount: 7 }],
				}],
				total: 133,
				paid_total: 7,
				open_total: 126,
				status: 'issued',
				issued_at: '2026-09-13T12:00:00.000Z',
				due_at: '2026-09-27T12:00:00.000Z',
				payment_recipient: 'Bremer Badminton Verband e.V.',
				payment_bank: 'Die Sparkasse Bremen AG',
				payment_iban: 'DE33 2905 0101 0082 3932 81',
				payment_bic: 'SBREDE22XXX',
				note: 'Zahlbar per Überweisung.',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.document.document_number, 'RE-2026-1ERLTBREU19-0001');
		assert.strictEqual(result.response.document.document_type, 'invoice');
		assert.strictEqual(result.response.document.buyer_name, 'BSC Hastedt');
		assert.strictEqual(result.response.document.lines[0].sale_unit, 'Teilnehmer');
		assert.deepStrictEqual(result.response.document.lines[0].position_ids, ['fee:player_1:hd_u19:main_draw']);
		assert.deepStrictEqual(result.response.document.lines[0].caused_by, [{ label: 'Lyan Stubbe', detail: 'HD U19', amount: 7 }]);
		assert.strictEqual(result.response.document.total, 133);
		assert.strictEqual(result.response.document.paid_total, 7);
		assert.strictEqual(result.response.document.open_total, 126);
		assert.strictEqual(result.response.document.issued_at, '2026-09-13T12:00:00.000Z');
		assert.strictEqual(result.response.document.due_at, '2026-09-27T12:00:00.000Z');
		assert.strictEqual(result.response.document.payment_recipient, 'Bremer Badminton Verband e.V.');
		assert.strictEqual(result.response.document.payment_bank, 'Die Sparkasse Bremen AG');
		assert.strictEqual(result.response.document.payment_iban, 'DE33 2905 0101 0082 3932 81');
		assert.strictEqual(result.response.document.payment_bic, 'SBREDE22XXX');
		assert.strictEqual(result.response.document.created_at, '1970-01-15T06:56:07.890Z');

		result = await call_handler(admin.handle_registration_accounting_document, app, {
			type: 'registration_accounting_document',
			tournament_key: 'default',
			document: {
				document_type: 'invoice',
				buyer_type: 'club',
				buyer_id: 'club_bsc_hastedt',
				buyer_name: 'BSC Hastedt',
				lines: [{
					description: '19x Meldegeld',
					amount: 133,
					position_ids: ['fee:player_1:hd_u19:main_draw'],
				}],
				total: 133,
			},
		});
		assert(result.err);
		assert.match(result.err.message, /position already used/);

		now = 2234567890;
		result = await call_handler(admin.handle_registration_accounting_document, app, {
			type: 'registration_accounting_document',
			tournament_key: 'default',
			document: {
				document_type: 'receipt',
				buyer_type: 'club',
				buyer_id: 'club_bsc_hastedt',
				buyer_name: 'BSC Hastedt',
				lines: [{
					description: 'Zahlung',
					amount: 50,
				}],
				total: 50,
				paid_total: 50,
				open_total: 0,
				status: 'paid',
				payment_entry_id: 'entry_1',
				issued_at: '2026-09-13T13:00:00.000Z',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.document.document_number, 'QU-2026-1ERLTBREU19-0001');
		assert.strictEqual(result.response.document.document_type, 'receipt');
		assert.strictEqual(result.response.document.payment_entry_id, 'entry_1');
		assert.strictEqual(result.response.document.issued_at, '2026-09-13T13:00:00.000Z');

		const tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_documents.length, 2);

		result = await call_handler(admin.handle_registration_accounting_document, app, {
			type: 'registration_accounting_document',
			tournament_key: 'default',
			document: {
				document_type: 'invoice',
				buyer_type: 'club',
				buyer_id: 'club_bsc_hastedt',
				lines: [],
			},
		});
		assert(result.err);
		assert.match(result.err.message, /requires lines/);
	});

	it('creates readable accounting document short codes for common tournament names', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', { key: 'masters', name: 'Bremen Master 2026' });
		await insert(db, 'tournaments', { key: 'lm', name: 'Landesmeisterschaft 2026' });

		let result = await call_handler(admin.handle_registration_accounting_document, app, {
			type: 'registration_accounting_document',
			tournament_key: 'masters',
			document: {
				document_type: 'invoice',
				buyer_type: 'state',
				buyer_id: 'state_bremen',
				buyer_name: 'Bremen',
				lines: [{ description: 'Meldegeld', amount: 7 }],
				total: 7,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.document.document_number, 'RE-2026-BREMAS-0001');

		result = await call_handler(admin.handle_registration_accounting_document, app, {
			type: 'registration_accounting_document',
			tournament_key: 'lm',
			document: {
				document_type: 'invoice',
				buyer_type: 'state',
				buyer_id: 'state_bremen',
				buyer_name: 'Bremen',
				lines: [{ description: 'Meldegeld', amount: 7 }],
				total: 7,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.document.document_number, 'RE-2026-LM-0001');
	});

	it('stores and removes accounting items', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		let result = await call_handler(admin.handle_registration_accounting_item, app, {
			type: 'registration_accounting_item',
			tournament_key: 'default',
			item: {
				name: 'Griffband',
				billing_type: 'required_discipline',
				overview_category: 'fee',
				unit_price: '4,50',
				sale_unit: 'Rolle',
				note: 'Theke',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.item.name, 'Griffband');
		assert.strictEqual(result.response.item.billing_type, 'required_discipline');
		assert.strictEqual(result.response.item.overview_category, 'fee');
		assert.strictEqual(result.response.item.unit_price, 4.5);
		assert.strictEqual(result.response.item.sale_unit, 'Rolle');
		assert.strictEqual(result.response.item.default_quantity, 1);
		assert.strictEqual(result.response.item.required, true);
		assert.strictEqual(result.response.item.created_at, '1970-01-15T06:56:07.890Z');

		let tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_items.length, 1);

		result = await call_handler(admin.handle_registration_accounting_item_remove, app, {
			type: 'registration_accounting_item_remove',
			tournament_key: 'default',
			item_id: result.response.item.id,
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.deepStrictEqual(tournament.accounting_items, []);
	});

	it('rejects invalid accounting items', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		let result = await call_handler(admin.handle_registration_accounting_item, app, {
			type: 'registration_accounting_item',
			tournament_key: 'default',
			item: {
				name: 'Griffband',
				billing_type: 'sometimes',
				unit_price: 4.5,
			},
		});
		assert(result.err);
		assert.match(result.err.message, /Unsupported accounting item billing_type/);

		result = await call_handler(admin.handle_registration_accounting_item, app, {
			type: 'registration_accounting_item',
			tournament_key: 'default',
			item: {
				name: 'Griffband',
				billing_type: 'optional',
				overview_category: 'cash',
				unit_price: 4.5,
			},
		});
		assert(result.err);
		assert.match(result.err.message, /Unsupported accounting item overview_category/);
	});

	it('updates accounting items without replacing their identity', async function() {
		const db = await database.init_test();
		let now = 1234567890;
		const app = { db, clock: { now_ms: () => now } };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		let result = await call_handler(admin.handle_registration_accounting_item, app, {
			type: 'registration_accounting_item',
			tournament_key: 'default',
			item: {
				name: 'Griffband',
				billing_type: 'optional',
				overview_category: 'fee',
				unit_price: 4.5,
				sale_unit: 'Stk.',
			},
		});
		assert.ifError(result.err);
		const item_id = result.response.item.id;

		now = 2234567890;
		result = await call_handler(admin.handle_registration_accounting_item_update, app, {
			type: 'registration_accounting_item_update',
			tournament_key: 'default',
			item_id,
			item: {
				name: 'Griffband Premium',
				billing_type: 'required_player',
				unit_price: '5,50',
				sale_unit: 'Rolle',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.item.id, item_id);
		assert.strictEqual(result.response.item.name, 'Griffband Premium');
		assert.strictEqual(result.response.item.billing_type, 'required_player');
		assert.strictEqual(result.response.item.overview_category, 'fee');
		assert.strictEqual(result.response.item.unit_price, 5.5);
		assert.strictEqual(result.response.item.sale_unit, 'Rolle');
		assert.strictEqual(result.response.item.default_quantity, 1);
		assert.strictEqual(result.response.item.required, true);
		assert.strictEqual(result.response.item.created_at, '1970-01-15T06:56:07.890Z');
		assert.strictEqual(result.response.item.updated_at, '1970-01-26T20:42:47.890Z');

		const tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_items.length, 1);
		assert.strictEqual(tournament.accounting_items[0].id, item_id);
		assert.strictEqual(tournament.accounting_items[0].overview_category, 'fee');
	});

	it('maps legacy required accounting items to required per player', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const result = await call_handler(admin.handle_registration_accounting_item, app, {
			type: 'registration_accounting_item',
			tournament_key: 'default',
			item: {
				name: 'Startpaket',
				billing_type: 'required',
				unit_price: 2,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.item.billing_type, 'required_player');
		assert.strictEqual(result.response.item.required, true);
	});

	it('rejects invalid local registration accounting entries', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				player_id: 'bad.player',
				kind: 'charge',
				type: 'item',
				amount: 76,
			},
		});
		assert(result.err);
		assert.match(result.err.message, /Invalid accounting entry player_id/);
	});

	it('stores local accounting entries for custom items', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		const result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				player_id: '45',
				player_name: 'Lyan Stubbe',
				kind: 'charge',
				type: 'item',
				item_id: 'item_1',
				item_input_type: 'quantity',
				item_sale_unit: 'Rolle',
				description: 'Griffband',
				quantity: 3,
				unit_price: 4.5,
				amount: 13.5,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.entry.type, 'item');
		assert.strictEqual(result.response.entry.item_id, 'item_1');
		assert.strictEqual(result.response.entry.item_input_type, 'quantity');
		assert.strictEqual(result.response.entry.item_sale_unit, 'Rolle');
		assert.strictEqual(result.response.entry.item_overview_category, 'item');
		assert.strictEqual(result.response.entry.amount, 13.5);
	});

	it('stores accounting entries for clubs, states and anonymous buyers', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		let result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				buyer_type: 'club',
				buyer_id: 'club_bsc_hastedt',
				buyer_name: 'BSC Hastedt',
				kind: 'charge',
				type: 'item',
				description: 'Ballrolle',
				quantity: 2,
				unit_price: 38,
				amount: 76,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.entry.buyer_type, 'club');
		assert.strictEqual(result.response.entry.buyer_id, 'club_bsc_hastedt');
		assert.strictEqual(result.response.entry.club, 'BSC Hastedt');

		result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				buyer_type: 'state',
				buyer_id: 'state_bremen',
				buyer_name: 'Bremen',
				kind: 'charge',
				type: 'item',
				description: 'Startpaket',
				quantity: 1,
				unit_price: 5,
				amount: 5,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.entry.buyer_type, 'state');
		assert.strictEqual(result.response.entry.state, 'Bremen');

		result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				buyer_type: 'none',
				kind: 'payment',
				type: 'other',
				description: 'Kassendifferenz',
				quantity: 1,
				unit_price: 3,
				amount: 3,
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.entry.buyer_type, 'none');
		assert.strictEqual(result.response.entry.buyer_id, 'none');
		assert.strictEqual(result.response.entry.buyer_name, 'Ohne Käufer');

		const tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_entries.length, 3);
	});

	it('reconstructs BTP payment transfers from paid positions', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			tguid: 'tournament-guid',
			accounting_entry_fee_mode: 'main_draw',
			events: {
				events: [{
					id: 1,
					name: 'JE U19',
					fee: 11,
					stages: [{
						stage_type: 1,
						entries: [{
							team: {
								players: [{ btp_id: 101, name: 'Anna Anteil' }],
							},
						}],
					}],
				}, {
					id: 2,
					name: 'JD U19',
					fee: 11,
					stages: [{
						stage_type: 1,
						entries: [{
							team: {
								players: [{ btp_id: 102, name: 'Ben Betrag' }],
							},
						}],
					}],
				}, {
					id: 3,
					name: 'MX U19',
					fee: 11,
					stages: [{
						stage_type: 1,
						entries: [{
							team: {
								players: [{ btp_id: 102, name: 'Ben Betrag' }],
							},
						}],
					}],
				}],
			},
		});

		const result = await call_handler(admin.handle_registration_accounting_entry, app, {
			type: 'registration_accounting_entry',
			tournament_key: 'default',
			entry: {
				buyer_type: 'state',
				buyer_id: 'state_bremen',
				buyer_name: 'Bremen',
				kind: 'payment',
				type: 'other',
				description: 'Zahlung',
				quantity: 1,
				unit_price: 33,
				amount: 33,
				payment_method: 'transfer',
				payment_target_type: 'open',
				payment_allocations: [{
					target_type: 'open',
					amount: 33,
					position_ids: [
						'fee:101:1:main_draw',
						'fee:102:2:main_draw',
						'fee:102:3:main_draw',
					],
				}],
			},
		});
		assert.ifError(result.err);
		const transfers = result.response.entry.btp_payment_transfers
			.map((transfer) => ({
				player_id: transfer.player_id,
				player_name: transfer.player_name,
				amount: transfer.amount,
				position_ids: transfer.position_ids,
				payment_type: transfer.payment_type,
			}))
			.sort((a, b) => a.player_id.localeCompare(b.player_id));
		assert.deepStrictEqual(transfers, [{
			player_id: '101',
			player_name: 'Anna Anteil',
			amount: 11,
			position_ids: ['fee:101:1:main_draw'],
			payment_type: 2,
		}, {
			player_id: '102',
			player_name: 'Ben Betrag',
			amount: 22,
			position_ids: ['fee:102:2:main_draw', 'fee:102:3:main_draw'],
			payment_type: 2,
		}]);
			assert.strictEqual(result.response.entry.btp_payment_needsync, true);
			assert.strictEqual(result.response.entry.btp_payment_sync_status, 'pending');
	});

	it('stores and validates the accounting entry fee mode', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', { key: 'default', name: 'Default' });

		let result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_entry_fee_mode',
			value: 'drawn',
		});
		assert.ifError(result.err);

		let tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_entry_fee_mode, 'drawn');

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_entry_fee_mode',
			value: 'main_draw_with_excluded',
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_entry_fee_mode, 'main_draw_with_excluded');

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_entry_fee_mode',
			value: 'creative',
		});
		assert(result.err);
		assert.match(result.err.message, /Unsupported accounting_entry_fee_mode/);

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_document_code',
			value: '  Bremen Masters! ',
		});
		assert.ifError(result.err);

			tournament = await db.tournaments.findOne_async({ key: 'default' });
			assert.strictEqual(tournament.accounting_document_code, 'BREMENMASTERS');

			result = await call_handler(admin.handle_tournament_edit_prop, app, {
				type: 'tournament_edit_prop',
				key: 'default',
				field: 'accounting_invoice_treatment',
				value: 'paid',
			});
			assert.ifError(result.err);

			tournament = await db.tournaments.findOne_async({ key: 'default' });
			assert.strictEqual(tournament.accounting_invoice_treatment, 'paid');

		result = await call_handler(admin.handle_tournament_edit_props, app, {
			type: 'tournament_edit_props',
			key: 'default',
			props: {
				accounting_payment_recipient: ' Turnierkonto ',
				accounting_payment_bank: ' Musterbank ',
				accounting_payment_iban: ' DE00 0000 0000 0000 0000 00 ',
					accounting_payment_bic: ' TESTDE00XXX ',
					accounting_invoice_due_days: '21',
					accounting_document_stamp_enabled: true,
					accounting_document_signature_mode: 'none',
					accounting_event_period_enabled: true,
					accounting_event_period_text: ' 20.09.2026 - 21.09.2026 ',
			},
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_payment_recipient, 'Turnierkonto');
		assert.strictEqual(tournament.accounting_payment_bank, 'Musterbank');
		assert.strictEqual(tournament.accounting_payment_iban, 'DE00 0000 0000 0000 0000 00');
			assert.strictEqual(tournament.accounting_payment_bic, 'TESTDE00XXX');
			assert.strictEqual(tournament.accounting_invoice_due_days, 21);
			assert.strictEqual(tournament.accounting_document_stamp_enabled, true);
			assert.strictEqual(tournament.accounting_document_signature_mode, 'none');
			assert.strictEqual(tournament.accounting_event_period_enabled, true);
			assert.strictEqual(tournament.accounting_event_period_text, '20.09.2026 - 21.09.2026');

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_invoice_due_days',
			value: '400',
		});
		assert(result.err);
		assert.match(result.err.message, /Invalid accounting_invoice_due_days/);

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_invoice_treatment',
			value: 'maybe',
		});
		assert(result.err);
		assert.match(result.err.message, /Unsupported accounting_invoice_treatment/);

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_letterhead_first_pdf',
			value: 'data:application/pdf;base64,JVBERi0xLjQ=',
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.accounting_letterhead_first_pdf, 'data:application/pdf;base64,JVBERi0xLjQ=');

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_letterhead_layout',
			value: {
				first: {
					address: { x: '20,5', y: 64, width: 95, height: 25 },
					document_title: { x: 20, y: 94, width: 95, height: 9 },
					document_number: { x: 21, y: 105 },
					document_date: { x: 22, y: '111,5' },
					event_title: { x: 26, y: 116 },
					content: { x: 20, y: 100, width: 168, height: 155 },
				},
			},
		});
		assert.ifError(result.err);

		tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.deepStrictEqual(tournament.accounting_letterhead_layout.first.address, {
			x: 20.5,
			y: 64,
			width: 95,
			height: 25,
		});
		assert.deepStrictEqual(tournament.accounting_letterhead_layout.first.document_title, {
			x: 20,
			y: 94,
			width: 95,
			height: 9,
		});
		assert.deepStrictEqual(tournament.accounting_letterhead_layout.first.document_number, {
			x: 21,
			y: 105,
			width: 70,
			height: 5,
		});
		assert.deepStrictEqual(tournament.accounting_letterhead_layout.first.document_date, {
			x: 22,
			y: 111.5,
			width: 70,
			height: 5,
		});
		assert.deepStrictEqual(tournament.accounting_letterhead_layout.first.event_title, {
			x: 26,
			y: 116,
			width: 168,
			height: 7,
		});

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_letterhead_layout',
			value: {
				first: {
					content: { x: 20, y: 100, width: 0, height: 155 },
				},
			},
		});
		assert(result.err);
		assert.match(result.err.message, /Invalid accounting_letterhead_layout/);

		result = await call_handler(admin.handle_tournament_edit_prop, app, {
			type: 'tournament_edit_prop',
			key: 'default',
			field: 'accounting_letterhead_follow_pdf',
			value: 'data:text/plain;base64,SGFsbG8=',
		});
		assert(result.err);
		assert.match(result.err.message, /Invalid accounting_letterhead_follow_pdf/);

		result = await call_handler(admin.handle_registration_accounting_document, app, {
			type: 'registration_accounting_document',
			tournament_key: 'default',
			document: {
				document_type: 'invoice',
				buyer_type: 'club',
				buyer_id: 'club_bsc_hastedt',
				buyer_name: 'BSC Hastedt',
				lines: [{ description: 'Meldegeld', amount: 7 }],
				total: 7,
				issued_at: '2026-09-13T12:00:00.000Z',
			},
		});
		assert.ifError(result.err);
		assert.strictEqual(result.response.document.document_number, 'RE-2026-BREMENMASTERS-0001');
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
