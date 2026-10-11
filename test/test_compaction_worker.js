'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const Datastore = require('nedb');
const model = require('nedb/lib/model');
const compaction = require('../bts/compaction_worker');

describe('worker compaction serialization', function() {
	let directory, previous;
	beforeEach(function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-worker-compaction-'));
		previous = process.env.BTS_COMPACTION_WORKER; process.env.BTS_COMPACTION_WORKER = '1';
	});
	afterEach(function() {
		compaction.client.close(); fs.rmSync(directory, { recursive: true, force: true });
		if (previous === undefined) delete process.env.BTS_COMPACTION_WORKER; else process.env.BTS_COMPACTION_WORKER = previous;
	});
	it('preserves NeDB Date/index bytes and orders updates around a real crash-safe rewrite', async function() {
		const table = new Datastore({ filename: path.join(directory, 'matches') });
		compaction.attach(table, 'matches', { identity_serialization: true });
		await promisify(table.loadDatabase.bind(table))();
		await promisify(table.ensureIndex.bind(table))({ fieldName: 'name', unique: true, sparse: true });
		await promisify(table.insert.bind(table))({ _id: 'game', name: 'Müller', at: new Date(123456), score: 0 });
		const payload = compaction.input(table);
		assert.strictEqual(Buffer.from(await compaction.client.run(payload)).toString(), require('../bts/compaction_worker/serialize')(payload));
		const update = promisify(table.update.bind(table));
		const before = update({ _id: 'game' }, { $set: { score: 1 } }, {});
		const compacted = new Promise((resolve, reject) => table.executor.push({ this: table.persistence,
			fn: table.persistence.persistCachedDatabase, arguments: [err => err ? reject(err) : resolve()] }));
		const after = update({ _id: 'game' }, { $set: { score: 2 } }, {});
		await Promise.all([before, compacted, after]);
		const reloaded = new Datastore({ filename: table.filename });
		await promisify(reloaded.loadDatabase.bind(reloaded))();
		assert.deepStrictEqual(await promisify(reloaded.findOne.bind(reloaded))({ _id: 'game' }),
			{ _id: 'game', name: 'Müller', at: new Date(123456), score: 2 });
		assert.strictEqual(reloaded.indexes.name.unique, true);
		assert.strictEqual(reloaded.indexes.name.sparse, true);
	});
	it('keeps custom serialization hooks on the existing main-thread path', async function() {
		const table = new Datastore({ filename: path.join(directory, 'custom'),
			afterSerialization: text => Buffer.from(text).toString('base64'),
			beforeDeserialization: text => Buffer.from(text, 'base64').toString() });
		compaction.attach(table, 'custom');
		await promisify(table.loadDatabase.bind(table))();
		await promisify(table.insert.bind(table))({ _id: 'doc', value: 3 });
		await new Promise((resolve, reject) => table.executor.push({ this: table.persistence,
			fn: table.persistence.persistCachedDatabase, arguments: [err => err ? reject(err) : resolve()] }));
		assert.strictEqual(model.deserialize(Buffer.from(fs.readFileSync(table.filename, 'utf8').trim(), 'base64').toString()).value, 3);
		assert.strictEqual(compaction.client.worker, null);
	});
	it('updates only replaced records while preserving removals, index changes and output order', async function() {
		const table = new Datastore({ inMemoryOnly: true });
		await promisify(table.insert.bind(table))([{ _id: 'one', score: 1 }, { _id: 'two', score: 2 }]);
		const original = compaction.client.run, transferred = [];
		compaction.client.run = function(payload, context, ...rest) {
			transferred.push(context.input_upserts); return original.call(this, payload, context, ...rest);
		};
		try {
			await compaction.encode(table, 'matches');
			await compaction.encode(table, 'matches');
			await promisify(table.update.bind(table))({ _id: 'one' }, { $set: { score: 3, at: new Date(4567) } }, {});
			await promisify(table.remove.bind(table))({ _id: 'two' }, {});
			await promisify(table.ensureIndex.bind(table))({ fieldName: 'score', unique: true });
			const bytes = await compaction.encode(table, 'matches');
			assert.deepStrictEqual(transferred, [2, 0, 1]);
			assert.strictEqual(bytes.toString(), require('../bts/compaction_worker/serialize')(compaction.input(table)));
		} finally { compaction.client.run = original; }
	});
	it('leaves the original file intact on serialization failure and releases queued writes', async function() {
		const table = new Datastore({ filename: path.join(directory, 'failure') });
		compaction.attach(table, 'matches', { identity_serialization: true });
		await promisify(table.loadDatabase.bind(table))();
		await promisify(table.insert.bind(table))({ _id: 'doc', value: 1 });
		const original = compaction.client.run;
		compaction.client.run = async () => { throw new Error('serialization failed'); };
		try {
			const failed = new Promise(resolve => table.executor.push({ this: table.persistence,
				fn: table.persistence.persistCachedDatabase, arguments: [resolve] }));
			const after = promisify(table.update.bind(table))({ _id: 'doc' }, { $set: { value: 2 } }, {});
			assert.match((await failed).message, /serialization failed/); await after;
		} finally { compaction.client.run = original; }
		const reloaded = new Datastore({ filename: table.filename });
		await promisify(reloaded.loadDatabase.bind(reloaded))();
		assert.strictEqual((await promisify(reloaded.findOne.bind(reloaded))({ _id: 'doc' })).value, 2);
	});
});
