'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const batch = require('../bts/btp_planner/batch_writes');
const tournament_model = require('../bts/tournament_model');
const query = change => ({ _id: change.id, tournament_key: 'test' });
const change = (id, before, after, update) => ({ collection: 'matches', id, before, after, update });

describe('sync batch persistence', function() {
	let directory, store;
	beforeEach(async function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-sync-batch-'));
		store = new Datastore({ filename: path.join(directory, 'matches') });
		await promisify(store.loadDatabase.bind(store))();
	});
	afterEach(function() { fs.rmSync(directory, { recursive: true, force: true }); });
	const insert = doc => promisify(store.insert.bind(store))(doc);
	const read = () => promisify(store.find.bind(store))({});
	async function reload() {
		const db = new Datastore({ filename: store.filename });
		await promisify(db.loadDatabase.bind(db))();
		return promisify(db.find.bind(db))({});
	}
	it('appends a heterogeneous changed set once and preserves Dates, histories and canonical identities', async function() {
		const docs = await insert([{ _id: 'one', tournament_key: 'test', score: 1, presses: [{ at: new Date(1234) }] },
			{ _id: 'two', tournament_key: 'test', score: 2 }]);
		const model = tournament_model.attach({ matches: store });
		const entity = model.tournament('test').matches.get('one');
		const persist = store.persistence.persistNewState;
		let appends = 0;
		store.persistence.persistNewState = function(...args) { appends++; return persist.apply(this, args); };
		await batch.write(store, [change('two', docs[1]),
			change('one', docs[0], {}, { $set: { score: 3 } }),
			change('three', null, { _id: 'three', tournament_key: 'test', score: 4 })], query);
		assert.strictEqual(appends, 1);
		assert.strictEqual(model.tournament('test').matches.get('one'), entity);
		assert.strictEqual(entity.data.score, 3);
		assert.strictEqual(entity.data.presses[0].at.getTime(), 1234);
		assert.deepStrictEqual(await reload(), await read());
	});
	it('holds later reads and writes until the single append finishes', async function() {
		const old = await insert({ _id: 'one', tournament_key: 'test', score: 1 });
		const persist = store.persistence.persistNewState;
		let release;
		store.persistence.persistNewState = function(docs, done) { release = () => persist.call(this, docs, done); };
		const writing = batch.write(store, [change('one', old, {}, { $set: { score: 2 } })], query);
		while (!release) await new Promise(resolve => setImmediate(resolve));
		let returned = false;
		const reading = read().then(docs => { returned = true; return docs; });
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(returned, false);
		store.persistence.persistNewState = persist;
		release(); await writing;
		assert.strictEqual((await reading)[0].score, 2);
	});
	it('rolls back the whole group on a later unique-index failure without appending', async function() {
		await promisify(store.ensureIndex.bind(store))({ fieldName: 'name', unique: true });
		const old = await insert([{ _id: 'one', tournament_key: 'test', name: 'A' }, { _id: 'two', tournament_key: 'test', name: 'B' }]);
		const bytes = fs.readFileSync(store.filename);
		await assert.rejects(batch.write(store, [change('one', old[0], {}, { $set: { name: 'C' } }),
			change('two', old[1], {}, { $set: { name: 'C' } })], query), /unique constraint/);
		assert.deepStrictEqual(await read(), old);
		assert.deepStrictEqual(fs.readFileSync(store.filename), bytes);
	});
	it('repairs a partially appended group in memory and on reload before rejecting', async function() {
		const old = await insert([{ _id: 'one', tournament_key: 'test', score: 1 }, { _id: 'two', tournament_key: 'test', score: 2 }]);
		const persist = store.persistence.persistNewState;
		let count = 0;
		store.persistence.persistNewState = function(docs, done) {
			if (++count === 1) return persist.call(this, docs.slice(0, 1), () => done(new Error('partial append failed')));
			return persist.call(this, docs, done);
		};
		await assert.rejects(batch.write(store, old.map(doc => change(doc._id, doc, {}, { $set: { score: 99 } })), query), /partial append failed/);
		assert.strictEqual(count, 2);
		assert.deepStrictEqual(await read(), old);
		assert.deepStrictEqual(await reload(), old);
	});
	it('reports a persistence rollback failure and releases the executor', async function() {
		const old = await insert({ _id: 'one', tournament_key: 'test', score: 1 });
		store.persistence.persistNewState = (docs, done) => done(new Error('disk failure'));
		await assert.rejects(batch.write(store, [change('one', old, {}, { $set: { score: 2 } })], query), /disk failure; rollback failed: disk failure/);
		assert.deepStrictEqual(await read(), [old]);
	});
	it('rejects missing or wrong-tournament records without modifying another tournament', async function() {
		const old = await insert({ _id: 'one', tournament_key: 'other', score: 1 });
		await assert.rejects(batch.write(store, [change('one', old, {}, { $set: { score: 2 } })], query), /BTP sync lost/);
		assert.deepStrictEqual(await read(), [old]);
	});
	it('keeps custom adapters, overridden writers and TTL collections on ordinary writes', function() {
		batch.certify(store); assert.strictEqual(batch.supported(store), true);
		const update = store.update;
		store.update = () => {}; assert.strictEqual(batch.supported(store), false);
		store.update = update; store.ttlIndexes.score = 1; assert.strictEqual(batch.supported(store), false);
		assert.strictEqual(batch.supported({}), false);
	});
});
