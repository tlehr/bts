'use strict';

const assert = require('assert');
const fs = require('fs/promises'), os = require('os'), path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const database = require('../bts/database');
const write = require('../bts/score_write');
const { fixture, insert } = require('./tournament_model_fixture');
const query = { _id: 'one', tournament_key: 'test' };
const update = (store, values, filter = query) => new Promise((resolve, reject) =>
	write(store, filter, values, (error, ...result) => error ? reject(error) : resolve(result)));
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('ordered point persistence', function() {
	let previous;
	beforeEach(() => { previous = process.env.BTS_SCORE_DIRECT_WRITES; process.env.BTS_SCORE_DIRECT_WRITES = '1'; });
	afterEach(() => {
		if (previous === undefined) delete process.env.BTS_SCORE_DIRECT_WRITES;
		else process.env.BTS_SCORE_DIRECT_WRITES = previous;
	});
	it('matches native NeDB updates including histories, dates, undefined fields and finish state', async function() {
		const { db, tournament } = await fixture();
		const original = await db.matches.findOne_async(query);
		const native = new Datastore({ inMemoryOnly: true }); await insert(native, original);
		const history = Array.from({ length: 180 }, (_, i) => ({ type: 'score', timestamp: i, side: i % 2 ? 'left' : 'right' }));
		for (const values of [
			{ network_score: [[5, 4]], presses: history, duration_ms: undefined, 'setup.now_on_court': true },
			{ network_score: [[21, 4], [21, 7]], end_ts: 123, team1_won: true, 'setup.now_on_court': false,
				'setup.state': 'finished', btp_needsync: true, date: new Date(12345) },
		]) {
			const expected = await new Promise((resolve, reject) => native.update(query, { $set: values },
				{ returnUpdatedDocs: true }, (error, ...result) => error ? reject(error) : resolve(result)));
			const actual = await update(db.matches, values);
			assert.deepStrictEqual(actual, expected);
			assert.deepStrictEqual(tournament.matches.get('one').data, expected[1]);
		}
		const [, detached] = await update(db.matches, { network_score: [[2, 1]] });
		detached.network_score[0][0] = 999; detached.setup.teams[0].players[0].name = 'Changed callback';
		assert.deepStrictEqual(tournament.matches.get('one').data.network_score, [[2, 1]]);
		assert.strictEqual(tournament.matches.get('one').data.setup.teams[0].players[0].name, 'Player 1');
	});
	it('preserves earlier edits, later writes and ordered reads', async function() {
		const { db } = await fixture();
		const earlier = db.matches.update_async(query, { $set: { 'setup.comment': 'earlier', match_order: 17 } }, {});
		const point = update(db.matches, { network_score: [[6, 5]] });
		const read = db.matches.findOne_async(query);
		const later = db.matches.update_async(query, { $set: { 'setup.comment': 'later' } }, {});
		await Promise.all([earlier, point, later]);
		assert.strictEqual((await point)[1].setup.comment, 'earlier');
		assert.strictEqual((await read).setup.comment, 'earlier');
		assert.deepStrictEqual((await read).network_score, [[6, 5]]);
		const final = await db.matches.findOne_async(query);
		assert.strictEqual(final.setup.comment, 'later'); assert.strictEqual(final.match_order, 17);
	});
	it('returns asynchronous zero-match results for missing and foreign matches', async function() {
		const { db } = await fixture(); let synchronous = true;
		const pending = new Promise((resolve, reject) => write(db.matches, { ...query, tournament_key: 'other' }, { network_score: [[9, 9]] },
			(error, ...result) => { try { assert(!synchronous); assert.ifError(error); resolve(result); } catch (failure) { reject(failure); } }));
		synchronous = false; assert.deepStrictEqual(await pending, [0, undefined]);
		assert.deepStrictEqual(await update(db.matches, {}, { ...query, _id: 'missing' }), [0, undefined]);
		assert.deepStrictEqual((await db.matches.findOne_async(query)).network_score, [[0, 0]]);
	});
	it('rejects invalid values and index conflicts without poisoning the next point', async function() {
		const { db, tournament } = await fixture();
		await assert.rejects(update(db.matches, { presses: [{ '$invalid': true }] }), /cannot begin with/);
		await promisify(db.matches.ensureIndex.bind(db.matches))({ fieldName: 'unique_slot', unique: true, sparse: true });
		await db.matches.update_async({ _id: 'two' }, { $set: { unique_slot: 'used' } }, {});
		await assert.rejects(update(db.matches, { unique_slot: 'used' }), /unique/);
		assert.strictEqual(tournament.matches.get('one').data.unique_slot, undefined);
		const [count, doc] = await update(db.matches, { network_score: [[3, 2]] });
		assert.strictEqual(count, 1); assert.deepStrictEqual(doc.network_score, [[3, 2]]);
	});
	it('waits for durable append before delivering the callback or a later read', async function() {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-point-append-'));
		let release;
		try {
			const store = new Datastore({ filename: path.join(directory, 'matches') });
			await promisify(store.loadDatabase.bind(store))(); database.setup_helpers({ matches: store });
			await insert(store, { ...query, setup: { match_num: 40 }, match_order: 1 });
			const persist = store.persistence.persistNewState; let began;
			const held = new Promise(resolve => { began = resolve; });
			store.persistence.persistNewState = function(documents, done) {
				release = () => persist.call(this, documents, done); began();
			};
			let point_ready = false, read_ready = false;
			const point = update(store, { network_score: [[7, 6]] }).then(value => { point_ready = true; return value; });
			await held;
			const read = store.findOne_async(query).then(value => { read_ready = true; return value; });
			await tick(); assert(!point_ready); assert(!read_ready);
			const finish = release; release = null; finish();
			assert.strictEqual((await point)[0], 1); const expected = await read;
			const loaded = new Datastore({ filename: store.filename }); await promisify(loaded.loadDatabase.bind(loaded))();
			assert.deepStrictEqual(await promisify(loaded.findOne.bind(loaded))(query), expected);
			assert.strictEqual(expected.match_order, 1); assert.strictEqual(expected.setup.match_num, 40);
		} finally { if (release) release(); await fs.rm(directory, { recursive: true, force: true }); }
	});
	it('propagates append failure exactly once and continues the executor', async function() {
		const { db } = await fixture(); const persist = db.matches.persistence.persistNewState;
		let called = 0;
		db.matches.persistence.persistNewState = (_documents, done) => done(new Error('append failed'));
		await new Promise(resolve => write(db.matches, query, { network_score: [[1, 0]] }, error => {
			assert.match(error.message, /append failed/); called++; resolve();
		}));
		db.matches.persistence.persistNewState = persist;
		await update(db.matches, { network_score: [[2, 0]] }); await tick(); assert.strictEqual(called, 1);
	});
	it('respects custom update hooks and the rollback flag', async function() {
		const { db } = await fixture(); const native = db.matches.update; let called = 0;
		db.matches.update = function(...args) { called++; return native.apply(this, args); };
		await update(db.matches, { network_score: [[1, 0]] }); assert.strictEqual(called, 1);
		db.matches.update = native; process.env.BTS_SCORE_DIRECT_WRITES = '0';
		const push = db.matches.executor.push; let task_name;
		db.matches.executor.push = function(task, ...args) { task_name = task.diagnostic_name; return push.call(this, task, ...args); };
		await update(db.matches, { network_score: [[2, 0]] }); assert.notStrictEqual(task_name, 'score_update_write');
	});
	it('falls back for timestamps and TTL indices, including indices added while queued', async function() {
		const timestamped = new Datastore({ inMemoryOnly: true, timestampData: true }); database.setup_helpers({ matches: timestamped });
		await insert(timestamped, query); const [, dated] = await update(timestamped, { network_score: [[1, 0]] });
		assert(dated.createdAt instanceof Date); assert(dated.updatedAt instanceof Date);
		const { db } = await fixture();
		await db.matches.update_async(query, { $set: { expires: new Date(0) } }, {});
		let release, began; const held = new Promise(resolve => { began = resolve; });
		db.matches.executor.push({ this: db.matches, arguments: [], fn(done) { release = done; began(); } }); await held;
		const point = update(db.matches, { network_score: [[9, 0]] });
		try { await promisify(db.matches.ensureIndex.bind(db.matches))({ fieldName: 'expires', expireAfterSeconds: 1 }); }
		finally { release(); }
		assert.deepStrictEqual(await point, [0, undefined]); assert.strictEqual(await db.matches.findOne_async(query), null);
	});
});
