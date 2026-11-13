'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const append = require('../bts/append_worker');
const compaction = require('../bts/compaction_worker');

describe('database append worker', function() {
	this.timeout(15000);
	let directory, store, saved;
	const read = database => promisify(database.find.bind(database))({});
	const update = score => promisify(store.update.bind(store))({ _id: 'game' }, { $set: { score } }, {});
	async function reload() {
		const database = new Datastore({ filename: store.filename });
		await promisify(database.loadDatabase.bind(database))();
		return read(database);
	}
	beforeEach(async function() {
		saved = process.env.BTS_DATABASE_APPEND_WORKER;
		process.env.BTS_DATABASE_APPEND_WORKER = '1';
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-append-worker-'));
		store = new Datastore({ filename: path.join(directory, 'matches') });
		require('../bts/prepared_append').attach(store);
		compaction.attach(store, 'matches', { identity_serialization: true });
		append.attach(store);
		await promisify(store.loadDatabase.bind(store))();
		await promisify(store.insert.bind(store))({ _id: 'game', score: 0, name: 'Müller 🏸', at: new Date(1234) });
	});
	afterEach(function() {
		append.client.close(); compaction.client.close();
		fs.rmSync(directory, { recursive: true, force: true });
		if (saved === undefined) delete process.env.BTS_DATABASE_APPEND_WORKER;
		else process.env.BTS_DATABASE_APPEND_WORKER = saved;
	});
	it('acknowledges the persisted bytes in executor order and reloads dates and Unicode', async function() {
		await Promise.all(Array.from({ length: 30 }, (_, index) => update(index + 1)));
		assert.deepStrictEqual(await reload(), await read(store));
		assert.strictEqual((await reload())[0].score, 30);
		assert.strictEqual((await reload())[0].name, 'Müller 🏸');
		assert.strictEqual((await reload())[0].at.getTime(), 1234);
	});
	it('writes to the replacement file after manual and staged compaction', async function() {
		await update(1);
		await promisify(store.persistence.persistCachedDatabase.bind(store.persistence))();
		await update(2);
		await require('../bts/compaction_worker/staged').run(store, 'matches');
		await update(3);
		assert.strictEqual((await reload())[0].score, 3);
		assert.deepStrictEqual(await reload(), await read(store));
	});
	it('propagates the actual filesystem error once without retrying the append', async function() {
		fs.unlinkSync(store.filename);fs.mkdirSync(store.filename);
		let callbacks = 0;
		await assert.rejects(new Promise((resolve, reject) => store.update({ _id: 'game' }, { $set: { score: 9 } }, {}, error => {
			callbacks++;if (error) reject(error);else resolve();
		})), error => error.code === 'EISDIR');
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(callbacks, 1);
		fs.rmdirSync(store.filename);
		await update(10);
		assert.strictEqual((await reload())[0].score, 10);
	});
	it('retains the ordinary storage path when disabled', async function() {
		process.env.BTS_DATABASE_APPEND_WORKER = '0';
		await update(4);
		assert.strictEqual((await reload())[0].score, 4);
	});
	it('stops later appends and every rewrite when a worker write outcome is unknown', async function() {
		const original = append.client.run, before = fs.readFileSync(store.filename);
		let attempts = 0;
		append.client.run = () => { attempts++;return Promise.reject(new Error('database_append worker exited (1)')); };
		try {
			const persist = score => promisify(store.persistence.persistNewState.bind(store.persistence))([{ _id: 'game', score }]);
			const attemptsTogether = await Promise.allSettled([persist(6), persist(7)]);
			assert(attemptsTogether.every(result => result.status === 'rejected' && result.reason.code === 'BTS_APPEND_UNCERTAIN'));
			await assert.rejects(update(7), error => error.code === 'BTS_APPEND_UNCERTAIN');
			assert.strictEqual(attempts, 1, 'A later write must not reach a new worker');
			await assert.rejects(promisify(store.persistence.persistCachedDatabase.bind(store.persistence))(), /restart BTS/);
			const staged = require('../bts/compaction_worker/staged');
			assert.strictEqual(staged.supported(store), false);
			await assert.rejects(staged.run(store, 'matches'), /restart BTS/);
			assert.deepStrictEqual(fs.readFileSync(store.filename), before);
		} finally { append.client.run = original; }
	});
	it('retains append byte counts and delivery timings in datastore diagnostics', async function() {
		const previous = process.env.BTS_SCORE_PRESS_TIMING;
		process.env.BTS_SCORE_PRESS_TIMING = '1';
		try {
			const tasks = require('../bts/database_tasks');tasks.attach(store, 'matches');
			await update(5);
			const snapshot = tasks.snapshot(store), record = snapshot.active || snapshot.last_completed;
			assert.strictEqual(record.persistence.kind, 'append');
			assert(record.persistence.storage_bytes > 0);
			assert(record.persistence.storage_wait_ms >= 0);
			assert(record.persistence.storage_start_ts <= record.persistence.storage_end_ts);
		} finally {
			if (previous === undefined) delete process.env.BTS_SCORE_PRESS_TIMING;
			else process.env.BTS_SCORE_PRESS_TIMING = previous;
		}
	});
	it('separates actual native open, write and close delays without changing appended bytes', async function() {
		const traces = require('../bts/performance/traces');traces.enable();
		require('../bts/database_tasks').attach(store, 'matches');
		let trace;
		await traces.operation('append_diagnostic_test', {}, async () => {
			trace = traces.capture().record;await update(17);
		});
		for (const name of ['openSync', 'writeSync', 'closeSync']) {
			const phase = trace.spans.find(span => span.name === 'append_' + name && span.kind === 'worker_phase');
			assert(phase, 'Missing actual native filesystem phase: ' + name);
			assert(phase.duration_ms >= 0);
		}
		assert.deepStrictEqual(await reload(), await read(store));
	});
	it('also freezes writes for a worker runtime error with a Node error code', async function() {
		const original = append.client.run;let attempts = 0;
		append.client.run = () => { attempts++;return Promise.reject(Object.assign(new Error('Worker ran out of memory'), { code: 'ERR_WORKER_OUT_OF_MEMORY' })); };
		try {
			await assert.rejects(update(8), error => error.code === 'BTS_APPEND_UNCERTAIN');
			await assert.rejects(update(9), error => error.code === 'BTS_APPEND_UNCERTAIN');
			assert.strictEqual(attempts, 1);
		} finally { append.client.run = original; }
	});
});
