'use strict';

const assert = require('assert');
const xlsx = require('node-xlsx');
const registration = require('../bts/registration_xlsx');
const parser = require('../bts/registration_xlsx/parse');
const admin = require('../bts/admin');
const database = require('../bts/database');

describe('isolated XLSX import', function() {
	let previous;
	beforeEach(function() { previous = process.env.BTS_XLSX_IMPORT_WORKER; process.env.BTS_XLSX_IMPORT_WORKER = '1'; });
	afterEach(function() {
		registration.client.close();
		if (previous === undefined) delete process.env.BTS_XLSX_IMPORT_WORKER; else process.env.BTS_XLSX_IMPORT_WORKER = previous;
	});
	function workbook() {
		return xlsx.build([{ name: 'HE - Hauptfeld', data: [['Title'], ['HE - Hauptfeld'],
			['Name', 'Ranglistenplatz', 'Punkte', 'Geb', 'Datum'], ['Müller Weiß', 12, 234, 43831, '04.07.2026 18:58']] }]);
	}
	it('preserves Unicode, dates, numbers and sheet metadata without detaching caller buffers', async function() {
		const data = workbook(), before = Buffer.from(data);
		assert.deepStrictEqual(await registration.parse(data), parser.parse(data));
		assert.deepStrictEqual(data, before);
		const worker = registration.client.worker;
		assert.deepStrictEqual(await registration.parse(data), parser.parse(data));
		assert.strictEqual(registration.client.worker, worker);
	});
	it('does not write upload metadata if the tournament is reset while the worker reads', async function() {
		const db = await database.init_test();
		await promisify_insert(db.tournaments, { key: 'default', last_reset_ts: 1 });
		const original = registration.parse;
		registration.parse = async (...args) => {
			const rows = await original(...args);
			await db.tournaments.update_async({ key: 'default' }, { $set: { last_reset_ts: 2 } }, {});
			return rows;
		};
		try {
			const response = await new Promise(resolve => admin.async_handle_registration_xlsx_upload({ db }, { respond: (_msg, err) => resolve(err) },
				{ tournament_key: 'default', name: 'test.xlsx', data_url: 'data:application/octet-stream;base64,' + workbook().toString('base64') }));
			assert.match(response.message, /reset/);
			assert.strictEqual((await db.tournaments.findOne_async({ key: 'default' })).registration_xlsx_metadata, undefined);
		} finally { registration.parse = original; }
	});
});

function promisify_insert(store, doc) { return new Promise((resolve, reject) => store.insert(doc, err => err ? reject(err) : resolve())); }
