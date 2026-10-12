'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const storage = require('nedb/lib/storage');
const { fixture, match } = require('./tournament_model_fixture');
const barrier = require('../bts/database_read_barrier');

const read = (db, part = 'match', id = 'one', key = 'test') => new Promise((resolve, reject) => {
	db.model.read_score_context_part(part, key, id, (error, value, timing) => error ? reject(error) : resolve({ value, timing }));
});
const turn = () => new Promise(resolve => setImmediate(resolve));

function hold_compaction(store, enqueue = true) {
	const original = store.persistence.persistCachedDatabase;
	let reached, complete, release;
	const started = new Promise(resolve => { reached = resolve; });
	const finished = new Promise(resolve => { complete = resolve; });
	store.persistence.persistCachedDatabase = function(done) {
		assert.strictEqual(this, store.persistence);
		release = error => {
			store.persistence.persistCachedDatabase = original;
			if (error) { done(error); complete(error); }
			else original.call(this, error => { done(error); complete(error || null); });
		};
		reached();
	};
	if (enqueue) store.persistence.compactDatafile();
	return { started, finished, release(error) { assert(release); release(error); } };
}

describe('model reads during pure compaction', function() {
	let previous;
	beforeEach(function() {
		previous = Object.fromEntries(['BTS_COMPACTION_MODEL_READS', 'BTS_SCORE_PRESS_TIMING', 'BTS_BTP_SYNC_TIMING'].map(key => [key, process.env[key]]));
		process.env.BTS_COMPACTION_MODEL_READS = '1';
		process.env.BTS_SCORE_PRESS_TIMING = '0'; process.env.BTS_BTP_SYNC_TIMING = '0';
	});
	afterEach(function() {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	});

	it('reads all three model parts during a held compaction with diagnostics off and retains detached asynchronous results', async function() {
		const { db, tournament } = await fixture();
		for (const [part, collection, id] of [['match', 'matches', 'one'], ['tournament', 'tournaments', null], ['court', 'courts', 'court']]) {
			const held = hold_compaction(db[collection]); await held.started;
			let delivered = false;
			const value = new Promise((resolve, reject) => db.model.read_score_context_part(part, 'test', id, (error, value, timing) => {
				delivered = true; error ? reject(error) : resolve({ value, timing });
			}));
			try {
				assert.strictEqual(delivered, false);
				await turn(); assert.strictEqual(delivered, true, 'read must finish before compaction release');
				const result = await value;
				assert.strictEqual(result.timing.compaction_read_bypassed, true);
				assert.strictEqual(result.timing.compaction_read_decision, 'pure_compaction');
				if (part === 'match') {
					result.value.setup.teams[0].players[0].checked_in = true;
					assert.strictEqual(tournament.matches.get('one').data.setup.teams[0].players[0].checked_in, false);
				}
			} finally { held.release(); await held.finished; }
		}
	});

	it('keeps the read position between earlier and later writes queued behind compaction', async function() {
		const { db } = await fixture(), held = hold_compaction(db.matches); await held.started;
		const first = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[1, 2]] } }, {});
		let delivered = false;
		const capture = read(db).then(value => { delivered = true; return value; });
		const second = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 4]] } }, {});
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { held.release(); await held.finished; }
		await Promise.all([first, second]);
		const result = await capture;
		assert.deepStrictEqual(result.value.network_score, [[1, 2]]);
		assert.strictEqual(result.timing.compaction_read_decision, 'prior_write_or_unknown_task');
	});

	it('does not expose a prior write until persistence has completed, even when compaction is queued', async function() {
		const { db, tournament } = await fixture(), persist = db.matches.persistence.persistNewState;
		let release, reached;
		const started = new Promise(resolve => { reached = resolve; });
		db.matches.persistence.persistNewState = function(docs, done) { release = () => persist.call(this, docs, done); reached(); };
		const write = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[7, 8]] } }, {});
		await started;
		const compact = hold_compaction(db.matches);
		assert.deepStrictEqual(tournament.matches.get('one').data.network_score, [[7, 8]]);
		let delivered = false;
		const capture = read(db).then(value => { delivered = true; return value; });
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { db.matches.persistence.persistNewState = persist; release(); }
		await write; await compact.started;
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { compact.release(); await compact.finished; }
		assert.deepStrictEqual((await capture).value.network_score, [[7, 8]]);
	});

	it('captures before a later write and leaves that write waiting for the file rewrite', async function() {
		const { db } = await fixture(), held = hold_compaction(db.matches); await held.started;
		const capture = read(db);
		let written = false;
		const later = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[9, 9]] } }, {}).then(() => { written = true; });
		try {
			assert.deepStrictEqual((await capture).value.network_score, [[0, 0]]);
			await turn(); assert.strictEqual(written, false);
		} finally { held.release(); await held.finished; }
		await later;
		assert.deepStrictEqual((await read(db)).value.network_score, [[9, 9]]);
	});

	it('can pass earlier pure NeDB reads without starting them or delaying for disk I/O', async function() {
		const { db } = await fixture(), held = hold_compaction(db.matches); await held.started;
		let queried = false;
		const query = db.matches.findOne_async({ _id: 'one' }).then(value => { queried = true; return value; });
		try {
			const capture = await read(db);
			assert.strictEqual(capture.timing.compaction_read_bypassed, true);
			assert.strictEqual(capture.value._id, 'one'); assert.strictEqual(queried, false);
		} finally { held.release(); await held.finished; }
		assert.strictEqual((await query)._id, 'one');
	});

	it('does not trust an unknown task just because its name resembles a read', async function() {
		const { db } = await fixture(), held = hold_compaction(db.matches); await held.started;
		let unknown_ran = false;
		db.matches.executor.push({ this: db.matches, fn(done) { unknown_ran = true; done(); }, arguments: [], diagnostic_name: 'score_context_match' });
		let delivered = false;
		const capture = read(db).then(value => { delivered = true; return value; });
		try { await turn(); assert.strictEqual(delivered, false); assert.strictEqual(unknown_ran, false); }
		finally { held.release(); await held.finished; }
		assert.strictEqual((await capture).timing.compaction_read_decision, 'prior_write_or_unknown_task');
		assert.strictEqual(unknown_ran, true);
	});

	it('lets score reads pass queued internal readers during tournament compaction', async function() {
		const { db } = await fixture(), held = hold_compaction(db.tournaments); await held.started;
		const queries = [
			require('../bts/preparation_selection/periodic_reads').tournaments({ db }, {}),
			new Promise((resolve, reject) => require('../bts/admin_response/tournament_read')(db, 'test', true,
				(error, value) => error ? reject(error) : resolve(value))),
			new Promise((resolve, reject) => db.model.read_display_context_part('tournament', 'test', null,
				(error, value) => error ? reject(error) : resolve(value))),
			db.model.snapshot('test', ['tournaments']),
			new Promise((resolve, reject) => db.model.read_cleanup_tournament('test',
				(error, value) => error ? reject(error) : resolve(value))),
		];
		try {
			const capture = await read(db, 'tournament');
			assert.strictEqual(capture.timing.compaction_read_bypassed, true);
			assert.strictEqual(capture.value.key, 'test');
			assert.strictEqual(barrier.inspect(db.tournaments).allowed, true);
		} finally { held.release(); await held.finished; }
		await Promise.all(queries);
	});

	it('retains the TTL barrier if an index is installed behind a certified internal reader', async function() {
		const { db } = await fixture(), held = hold_compaction(db.tournaments); await held.started;
		const timer_read = require('../bts/preparation_selection/periodic_reads').tournaments({ db }, {});
		db.tournaments.ttlIndexes.expiry = 1;
		let delivered = false;
		const capture = read(db, 'tournament').then(result => { delivered = true; return result; });
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { delete db.tournaments.ttlIndexes.expiry; held.release(); await held.finished; }
		await timer_read;
		assert.strictEqual((await capture).timing.compaction_read_decision, 'ttl_index');
	});

	it('waits for unobserved queued jobs and for expiry-capable cursor reads', async function() {
		const { db } = await fixture(), held = hold_compaction(db.matches); await held.started;
		db.matches.executor.queue.push({ this: db.matches, fn(done) { done(); }, arguments: [] });
		let delivered = false;
		const capture = read(db).then(value => { delivered = true; return value; });
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { held.release(); await held.finished; }
		assert.strictEqual((await capture).timing.compaction_read_decision, 'untracked_tasks');
		await db.matches.update_async({ _id: 'one' }, { $set: { expiry: new Date(1) } }, {});
		await promisify(db.matches.ensureIndex.bind(db.matches))({ fieldName: 'expiry', expireAfterSeconds: 1 });
		const compact = hold_compaction(db.matches); await compact.started;
		const expiring = db.matches.findOne_async({ _id: 'one' });
		const after_expiry = read(db);
		try { await turn(); assert.strictEqual(barrier.inspect(db.matches).reason, 'ttl_index'); }
		finally { compact.release(); await compact.finished; }
		assert.strictEqual(await expiring, null);
		const result = await after_expiry;
		assert.strictEqual(result.value, null); assert.strictEqual(result.timing.compaction_read_decision, 'ttl_index');
	});

	it('does not bypass database loading when its internal rewrite is held', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-model-load-'));
		try {
			const filename = path.join(directory, 'tournaments');
			fs.writeFileSync(filename, JSON.stringify({ _id: 'reloaded', key: 'test', preparation_successor_rally_count: 5 }) + '\n');
			const store = new Datastore({ filename });
			const minimal = { tournaments: store, courts: new Datastore({ inMemoryOnly: true }), matches: new Datastore({ inMemoryOnly: true }) };
			require('../bts/tournament_model').attach(minimal);
			const held = hold_compaction(store, false);
			const loading = promisify(store.loadDatabase.bind(store))(); await held.started;
			let delivered = false;
			const capture = read(minimal, 'tournament').then(value => { delivered = true; return value; });
			try { await turn(); assert.strictEqual(delivered, false); }
			finally { held.release(); await held.finished; }
			await loading;
			const result = await capture;
			assert.strictEqual(result.value._id, 'reloaded'); assert.strictEqual(result.timing.compaction_read_bypassed, false);
		} finally { fs.rmSync(directory, { recursive: true, force: true }); }
	});

	it('clears compaction state after rewrite failure and keeps the old path when the feature is disabled', async function() {
		const { db } = await fixture(), held = hold_compaction(db.matches); await held.started;
		assert.strictEqual((await read(db)).timing.compaction_read_bypassed, true);
		const error = new Error('rewrite failed'); held.release(error);
		assert.strictEqual(await held.finished, error);
		assert.strictEqual(barrier.inspect(db.matches).allowed, false);
		await db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[2, 1]] } }, {});
		process.env.BTS_COMPACTION_MODEL_READS = '0';
		const compact = hold_compaction(db.matches); await compact.started;
		let delivered = false;
		const capture = read(db).then(value => { delivered = true; return value; });
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { compact.release(); await compact.finished; }
		const result = await capture;
		assert.deepStrictEqual(result.value.network_score, [[2, 1]]);
		assert.strictEqual(result.timing.compaction_read_decision, 'disabled');
	});

	for (const worker_enabled of [false, true]) it(`reads during a real ${worker_enabled ? 'worker' : 'direct'} file rewrite without losing a later append on reload`, async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-compaction-read-'));
		const original = storage.crashSafeWriteFile, previous_worker = process.env.BTS_COMPACTION_WORKER;
		const compaction = require('../bts/compaction_worker');
		let release;
		try {
			process.env.BTS_COMPACTION_WORKER = worker_enabled ? '1' : '0';
			const store = new Datastore({ filename: path.join(directory, 'matches') });
			compaction.attach(store, 'matches', { identity_serialization: true });
			const db = { matches: store, courts: new Datastore({ inMemoryOnly: true }), tournaments: new Datastore({ inMemoryOnly: true }) };
			require('../bts/tournament_model').attach(db);
			await promisify(store.loadDatabase.bind(store))();
			await promisify(store.insert.bind(store))(match('one'));
			let reached;
			const started = new Promise(resolve => { reached = resolve; });
			storage.crashSafeWriteFile = function(filename, bytes, done) {
				if (filename !== store.filename) return original.apply(this, arguments);
				release = () => { storage.crashSafeWriteFile = original; original.call(this, filename, bytes, done); };
				reached();
			};
			const finished = new Promise(resolve => store.once('compaction.done', resolve));
			store.persistence.compactDatafile(); await started;
			const captured = await read(db);
			assert.strictEqual(captured.timing.compaction_read_bypassed, true);
			assert.deepStrictEqual(captured.value.network_score, [[0, 0]]);
			let written = false;
			const write = promisify(store.update.bind(store))({ _id: 'one' }, { $set: { network_score: [[4, 5]] } }, {}).then(() => { written = true; });
			await turn(); assert.strictEqual(written, false);
			release(); release = null; await finished; await write;
			const reloaded = new Datastore({ filename: store.filename });
			await promisify(reloaded.loadDatabase.bind(reloaded))();
			assert.deepStrictEqual((await promisify(reloaded.findOne.bind(reloaded))({ _id: 'one' })).network_score, [[4, 5]]);
		} finally {
			if (release) release();
			storage.crashSafeWriteFile = original; compaction.client.close();
			if (previous_worker === undefined) delete process.env.BTS_COMPACTION_WORKER; else process.env.BTS_COMPACTION_WORKER = previous_worker;
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
