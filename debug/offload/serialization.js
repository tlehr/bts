'use strict';

const assert = require('assert');
const xlsx = require('node-xlsx');
const registration = require('../../bts/registration_xlsx');
const compaction = require('../../bts/compaction_worker');
const serialize = require('../../bts/compaction_worker/serialize');
const { measure, pairs } = require('./measure');

async function compaction_benchmark(samples, records) {
	const documents = Array.from({ length: 519 }, (_, id) => ({ _id: String(id), tournament_key: 'offline', score: 0,
		date: new Date(1700000000000 + id), presses: Array.from({ length: 180 }, (_, index) => ({
			type: 'score', team: index % 2, timestamp: 1700000000000 + index * 3200, value: index, device: 'synthetic-tablet',
		})) }));
	const store = { getAllData: () => documents.slice(), indexes: { _id: {}, tournament_key: { unique: false, sparse: false } } };
	const run = async (mode, i) => {
		process.env.BTS_COMPACTION_WORKER = mode === 'alternative' ? '1' : '0';
		// NeDB replaces documents on update. Apply the same single-record change
		// per pair before either variant; warm worker reuses unchanged lines.
		if (documents[0].score !== i) documents[0] = { ...documents[0], score: i };
		return mode === 'alternative' ? compaction.encode(store, 'matches') : Buffer.from(serialize(compaction.input(store)));
	};
	try {
		records.length = 0;
		const cold = await measure(() => run('alternative', -1));
		const cold_start = { ...cold.measurement, tasks: records.slice() };
		return { scope: 'Serialization plus transport only; alternative also caches unchanged serialized lines. Excludes disk I/O and executor waiting.',
			input: { documents: 519, presses: 93420, output_bytes: cold.value.length, changed_documents_per_pair: 1 }, cold_start,
			...await pairs(samples, run, (a, b) => assert(a.equals(b)), records) };
	} finally { compaction.client.close(); }
}

async function xlsx_benchmark(samples, records) {
	const data = [['HE - Hauptfeld'], ['Name', 'Ranglistenplatz', 'Punkte', 'Geb', 'Datum'],
		...Array.from({ length: 1038 }, (_, i) => ['Müller Weiß ' + i, i + 1, 1000 - i, 43831, '04.07.2026 18:58'])];
	const buffer = xlsx.build([{ name: 'HE - Hauptfeld', data }]);
	const run = mode => {
		process.env.BTS_XLSX_IMPORT_WORKER = mode === 'alternative' ? '1' : '0';
		return registration.parse(buffer);
	};
	try {
		records.length = 0;
		const cold = await measure(() => run('alternative'));
		return { scope: 'XLSX parsing plus transport only; excludes upload, registration matching and database writes.',
			input: { rows: 1038, input_bytes: buffer.length }, cold_start: { ...cold.measurement, tasks: records.slice() },
			...await pairs(samples, run, assert.deepStrictEqual, records) };
	} finally { registration.client.close(); }
}

module.exports = { compaction_benchmark, xlsx_benchmark };
