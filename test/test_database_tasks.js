'use strict';

const assert = require('assert');
const tasks = require('../bts/database_tasks');
const { promisify } = require('util');
const Datastore = require('nedb');
const fs = require('fs'), os = require('os'), path = require('path');
const model = require('../bts/tournament_model');
const { fixture, match } = require('./tournament_model_fixture');

describe('datastore task diagnostics', function() {
	let previous;
	beforeEach(() => { previous = process.env.BTS_SCORE_PRESS_TIMING; process.env.BTS_SCORE_PRESS_TIMING = '1'; });
	afterEach(() => {
		if (previous === undefined) delete process.env.BTS_SCORE_PRESS_TIMING;
		else process.env.BTS_SCORE_PRESS_TIMING = previous;
	});
	it('identifies a pending append, preserves write order and distinguishes callback delivery from queue release', async function() {
		const db = Object.fromEntries(['matches', 'tournaments', 'courts'].map(name => [name, new Datastore({ inMemoryOnly: true })]));
		await promisify(db.matches.insert.bind(db.matches))(match('one'));
		const persist = db.matches.persistence.persistNewState;
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		db.matches.persistence.persistNewState = function(docs, done) {
			release = () => persist.call(this, docs, done); reached();
		};
		model.attach(db);
		tasks.attach(db.matches, 'matches');
		const write = promisify(db.matches.update.bind(db.matches))({ _id: 'one' }, { $set: { network_score: [[5, 6]] } }, {});
		await held;
		const active = tasks.snapshot(db.matches);
		let completed = false;
		const capture = new Promise((resolve, reject) => db.model.read_score_context_part('match', 'test', 'one',
			(error, value, timing) => { completed = true; error ? reject(error) : resolve({ value, timing }); }));
		try {
			assert.strictEqual(active.running, 1);
			assert.strictEqual(active.active.task, 'update');
			assert.strictEqual(active.active.phase, 'running');
			assert.strictEqual(active.active.persistence.kind, 'append');
			assert.strictEqual(active.active.persistence.pending, true);
			await new Promise(resolve => setImmediate(resolve)); assert.strictEqual(completed, false);
		} finally { release(); }
		await write;
		const delivered = tasks.snapshot(db.matches);
		assert.strictEqual(delivered.active.phase, 'awaiting_executor_release');
		assert.strictEqual(delivered.active.persistence.pending, false);
		assert(delivered.active.queue_release_pending_ms >= 0);
		const { value, timing } = await capture;
		assert.deepStrictEqual(value.network_score, [[5, 6]]);
		assert.strictEqual(timing.executor_at_enqueue.active.task, 'update');
		assert.strictEqual(timing.executor_before_read.active.task, 'score_context_match');
		assert.strictEqual(timing.executor_before_read.last_completed.task, 'update');
	});
	it('propagates failed writes and continues processing without changing callback results', async function() {
		const { db } = await fixture();
		await assert.rejects(new Promise((resolve, reject) => db.matches.insert({ _id: 'one' },
			(error, value) => error ? reject(error) : resolve(value))), /unique constraint/);
		const result = await db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[1, 2]] } }, { returnUpdatedDocs: true });
		assert.strictEqual(result[0], 1);
		assert.deepStrictEqual(result[1].network_score, [[1, 2]]);
		assert.strictEqual(tasks.snapshot(db.matches).last_completed.task, 'update');
		await db.matches.remove_async({ _id: 'one' }, {});
		assert.strictEqual(await db.matches.findOne_async({ _id: 'one' }), null);
	});
	it('identifies queued compaction persistence and preserves its receiver', async function() {
		const { db } = await fixture();
		const store = db.matches;
		let observed;
		store.executor.push({ this: store.persistence, fn: function(done) {
			assert.strictEqual(this, store.persistence);
			this.persistCachedDatabase(() => { observed = tasks.snapshot(store); done(); });
		}, diagnostic_name: 'test_compact', arguments: [] });
		await store.findOne_async({ _id: 'one' });
		assert.strictEqual(observed.active.task, 'test_compact');
		assert.strictEqual(observed.active.persistence.kind, 'compact');
		assert.strictEqual(observed.active.persistence.pending, false);
	});
	it('leaves diagnostics inactive when both timing flags are disabled', async function() {
		const sync_flag = process.env.BTS_BTP_SYNC_TIMING;
		try {
			process.env.BTS_SCORE_PRESS_TIMING = '0'; process.env.BTS_BTP_SYNC_TIMING = '0';
			const { db } = await fixture();
			await db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[2, 3]] } }, {});
			assert.strictEqual(tasks.snapshot(db.matches), null);
		} finally {
			if (sync_flag === undefined) delete process.env.BTS_BTP_SYNC_TIMING;
			else process.env.BTS_BTP_SYNC_TIMING = sync_flag;
		}
	});
	it('preserves file-backed appends and crash-safe compaction across reload', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-task-diagnostics-'));
		try {
			const store = new Datastore({ filename: path.join(directory, 'matches') });
			await promisify(store.loadDatabase.bind(store))();
			tasks.attach(store, 'matches');
			await promisify(store.insert.bind(store))({ _id: 'game', score: 0 });
			const update = promisify(store.update.bind(store));
			const before = update({ _id: 'game' }, { $set: { score: 1 } }, {});
			store.persistence.compactDatafile();
			const after = update({ _id: 'game' }, { $set: { score: 2 } }, {});
			await Promise.all([before, after]);
			const reloaded = new Datastore({ filename: store.filename });
			await promisify(reloaded.loadDatabase.bind(reloaded))();
			assert.deepStrictEqual(await promisify(reloaded.findOne.bind(reloaded))({ _id: 'game' }), { _id: 'game', score: 2 });
		} finally { fs.rmSync(directory, { recursive: true, force: true }); }
	});
	it('separates native serialization from asynchronous append waiting without changing stored data', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-append-phases-'));
		let slow = false;
		try {
			const store = new Datastore({ filename: path.join(directory, 'records'),
				afterSerialization(value) { if (slow) { const end = Date.now() + 3; while (Date.now() < end) { /* simulate serialization work */ } } return value; },
				beforeDeserialization: value => value,
			});
			await promisify(store.loadDatabase.bind(store))(); tasks.attach(store, 'records'); slow = true;
			await promisify(store.insert.bind(store))({ _id: 'record', value: 'ä' });
			const record = tasks.snapshot(store).last_completed;
			assert(record.persistence.serialization_ms >= 2);
			assert(record.persistence.storage_wait_ms >= 0);
			assert(record.persistence.storage_end_ts >= record.persistence.storage_start_ts);
			assert(record.persistence.storage_bytes > 0);
			assert(!JSON.stringify(record.persistence).includes(directory));
			slow = false; const reloaded = new Datastore({ filename: store.filename });
			await promisify(reloaded.loadDatabase.bind(reloaded))();
			assert.deepStrictEqual(await promisify(reloaded.findOne.bind(reloaded))({ _id: 'record' }), { _id: 'record', value: 'ä' });
		} finally { fs.rmSync(directory, { recursive: true, force: true }); }
	});
});
