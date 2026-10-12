'use strict';

const assert = require('assert');
const { fixture } = require('./tournament_model_fixture');
const inspect = (db, visit, collection = 'matches', key = 'test') => new Promise((resolve, reject) => {
	db.model.inspect_sync_records(collection, key, visit, (error, result) => error ? reject(error) : resolve(result));
});

describe('ordered sync validation model reads', function() {
	it('visits current immutable identities without a cursor and sees insertions, moves and deletion', async function() {
		const { db, tournament } = await fixture();
		const seen = [];
		db.matches.getCandidates = () => { throw new Error('scanned matches'); };
		assert.strictEqual(await inspect(db, doc => { seen.push(doc); return false; }), true);
		assert.strictEqual(seen.length, 2);
		assert.strictEqual(seen.find(doc => doc._id === 'one'), tournament.matches.get('one').data);
		assert.strictEqual(await inspect(db, doc => doc._id === 'two'), false);
		delete db.matches.getCandidates;
		await db.matches.update_async({ _id: 'one' }, { $set: { tournament_key: 'other' } }, {});
		await db.matches.remove_async({ _id: 'two' }, {});
		const remaining = [];
		await inspect(db, doc => { remaining.push(doc); return false; });
		assert.deepStrictEqual(remaining, []);
		const moved = [];
		await inspect(db, doc => { moved.push(doc._id); return false; }, 'matches', 'other');
		assert.deepStrictEqual(moved, ['one']);
		await assert.rejects(inspect(db, () => { throw new Error('visitor failed'); }, 'matches', 'other'), /visitor failed/);
	});

	it('waits for persistence and remains between earlier and later writes', async function() {
		const { db } = await fixture();
		const persist = db.matches.persistence.persistNewState;
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		db.matches.persistence.persistNewState = function(docs, done) { release = () => persist.call(this, docs, done); reached(); };
		const first = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[2, 1]] } }, {});
		await held;
		let score, completed = false;
		const capture = inspect(db, doc => { if (doc._id === 'one') score = doc.network_score; return false; })
			.then(result => { completed = true; return result; });
		const second = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 1]] } }, {});
		try { await new Promise(resolve => setImmediate(resolve)); assert.strictEqual(completed, false); }
		finally { db.matches.persistence.persistNewState = persist; release(); }
		await Promise.all([first, second, capture]);
		assert.deepStrictEqual(score, [[2, 1]]);
	});

	it('expires records with a TTL index added after enqueue', async function() {
		const { db, tournament } = await fixture();
		await db.matches.update_async({ _id: 'one' }, { $set: { expires: new Date(0) } }, {});
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		db.matches.executor.push({ this: db.matches, fn: done => { release = done; reached(); }, arguments: [() => {}] });
		await held;
		const seen = [];
		const capture = inspect(db, doc => { seen.push(doc._id); return false; });
		await new Promise((resolve, reject) => db.matches.ensureIndex({ fieldName: 'expires', expireAfterSeconds: 1 }, error => error ? reject(error) : resolve()));
		release();
		assert.strictEqual(await capture, true);
		assert.deepStrictEqual(seen, ['two']);
		assert.strictEqual(tournament.matches.get('one'), undefined);
	});
});
