'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const storage = require('nedb/lib/storage');
const compaction = require('../bts/compaction_worker');
const staged = require('../bts/compaction_worker/staged');
const batch = require('../bts/btp_planner/batch_writes');
const { fork } = require('child_process');
const schedule = require('../bts/database_compaction');

function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

describe('staged automatic compaction', function() {
	this.timeout(10000);
	let directory, store, saved, originals;
	beforeEach(async function() {
		saved = { BTS_COMPACTION_WORKER: process.env.BTS_COMPACTION_WORKER, BTS_COMPACTION_STAGED: process.env.BTS_COMPACTION_STAGED };
		process.env.BTS_COMPACTION_WORKER = '1'; process.env.BTS_COMPACTION_STAGED = '1';
		originals = { ...storage };
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-staged-compaction-'));
		store = new Datastore({ filename: path.join(directory, 'matches') });
		compaction.attach(store, 'matches', { identity_serialization: true });
		await promisify(store.loadDatabase.bind(store))();
		await promisify(store.insert.bind(store))({ _id: 'game', score: 0, at: new Date(1234) });
	});
	afterEach(function() {
		Object.assign(storage, originals); compaction.client.close();
		fs.rmSync(directory, { recursive: true, force: true });
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name]; else process.env[name] = value;
		}
	});
	const update = score => promisify(store.update.bind(store))({ _id: 'game' }, { $set: { score } }, {});
	const read = () => promisify(store.find.bind(store))({});
	async function reload() {
		const db = new Datastore({ filename: store.filename });
		await promisify(db.loadDatabase.bind(db))();
		return { db, docs: await promisify(db.find.bind(db))({}) };
	}
	function hold_stage() {
		const entered = deferred(), gate = deferred();
		storage.crashSafeWriteFile = (filename, bytes, done) => {
			if (filename.endsWith('.bts-compacting')) {
				entered.resolve(); gate.promise.then(() => originals.crashSafeWriteFile(filename, bytes, done));
			} else originals.crashSafeWriteFile(filename, bytes, done);
		};
		return { entered: entered.promise, release: gate.resolve };
	}
	it('uses staged maintenance through the automatic scheduler and lets a stopped round finish', async function() {
		const gate = hold_stage(), errors = [];
		let tick;
		const control = schedule({ matches: store }, ['matches'], {
			set_timer(fn) { tick = fn; return 1; }, clear_timer() {},
			on_error(name, error) { errors.push(error); },
		});
		tick(); await gate.entered;
		try {
			assert.strictEqual(control.active_collection, 'matches');
			await update(3);
		} finally { control.stop(); gate.release(); }
		const deadline = Date.now() + 3000;
		while (control.active_collection && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
		assert.strictEqual(control.active_collection, null);
		assert.deepStrictEqual(errors, []);
		assert.strictEqual((await reload()).docs[0].score, 3);
	});
	it('allows points during the large rewrite and reloads every intervening insert/update/delete and index', async function() {
		const gate = hold_stage();
		const compacting = staged.run(store, 'matches');
		await gate.entered;
		try {
			await update(1); await update(2);
			await promisify(store.insert.bind(store))([{ _id: 'new', name: 'A' }, { _id: 'deleted' }]);
			await promisify(store.remove.bind(store))({ _id: 'deleted' }, {});
			await promisify(store.ensureIndex.bind(store))({ fieldName: 'name', unique: true, sparse: true });
			assert.strictEqual((await read()).find(doc => doc._id === 'game').score, 2);
		} finally { gate.release(); }
		await compacting; await update(3);
		const result = await reload();
		assert.deepStrictEqual(result.docs, await read());
		assert.strictEqual(result.db.indexes.name.unique, true);
		assert.strictEqual(result.db.indexes.name.sparse, true);
		assert.strictEqual(fs.existsSync(store.filename + '.bts-compacting'), false);
	});
	it('serializes a larger catch-up journal outside the final barrier, including index removal', async function() {
		await promisify(store.ensureIndex.bind(store))({ fieldName: 'score' });
		const gate = hold_stage(), compacting = staged.run(store, 'matches');
		await gate.entered;
		try {
			for (let score = 1; score <= 12; score++) await update(score);
			await promisify(store.removeIndex.bind(store))('score');
		} finally { gate.release(); }
		await compacting;
		const result = await reload();
		assert.strictEqual(result.docs[0].score, 12);
		assert.strictEqual(result.db.indexes.score, undefined);
	});
	it('retains sync batches that complete during staged compaction', async function() {
		const gate = hold_stage(), compacting = staged.run(store, 'matches');
		await gate.entered;
		try {
			await batch.write(store, [{ collection: 'matches', id: 'game', before: (await read())[0],
				after: {}, update: { $set: { score: 4 } } }], () => ({ _id: 'game' }));
		} finally { gate.release(); }
		await compacting;
		assert.strictEqual((await reload()).docs[0].score, 4);
	});
	it('queues points and external index appends only during the final rename', async function() {
		const entered = deferred(), gate = deferred();
		storage.rename = (from, to, done) => {
			if (from.endsWith('.bts-compacting')) { entered.resolve(); gate.promise.then(() => originals.rename(from, to, done)); }
			else originals.rename(from, to, done);
		};
		const compacting = staged.run(store, 'matches'); await entered.promise;
		let point_done = false, index_done = false;
		const point = update(7).then(() => { point_done = true; });
		const index = promisify(store.ensureIndex.bind(store))({ fieldName: 'score', unique: true }).then(() => { index_done = true; });
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(point_done, false); assert.strictEqual(index_done, false);
		gate.resolve(); await Promise.all([compacting, point, index]);
		const result = await reload();
		assert.strictEqual(result.docs[0].score, 7); assert.strictEqual(result.db.indexes.score.unique, true);
	});
	for (const method of ['crashSafeWriteFile', 'rename', 'flushToStorage']) {
		it(`keeps all acknowledged points on ${method} failure and can retry`, async function() {
			let failed = false;
			storage[method] = (...args) => {
				const name = typeof args[0] === 'string' ? args[0] : args[0].filename;
				if (!failed && name.endsWith('.bts-compacting')) {
					failed = true; return args.at(-1)(new Error('staging failed'));
				}
				return originals[method](...args);
			};
			await update(1);
			await assert.rejects(staged.run(store, 'matches'), /staging failed/);
			assert.strictEqual(failed, true); await update(2);
			assert.strictEqual((await reload()).docs[0].score, 2);
			Object.assign(storage, originals);
			await staged.run(store, 'matches');
			assert.strictEqual((await reload()).docs[0].score, 2);
		});
	}
	it('abandons an old snapshot when a manual rewrite supersedes it', async function() {
		const gate = hold_stage(), compacting = staged.run(store, 'matches');
		const rejected = assert.rejects(compacting, /source reloaded or rewritten/);
		await gate.entered;
		try {
			await update(9);
			await new Promise((resolve, reject) => store.executor.push({ this: store.persistence,
				fn: store.persistence.persistCachedDatabase, arguments: [error => error ? reject(error) : resolve()] }));
		} finally { gate.release(); }
		await rejected;
		assert.strictEqual((await reload()).docs[0].score, 9);
	});
	it('keeps the replacement valid if directory fsync fails after the rename', async function() {
		let renamed = false;
		storage.rename = (from, to, done) => originals.rename(from, to, error => {
			if (!error && from.endsWith('.bts-compacting')) renamed = true;
			done(error);
		});
		storage.flushToStorage = (options, done) => {
			if (renamed && options.isDir) return done(new Error('directory flush failed'));
			return originals.flushToStorage(options, done);
		};
		await update(4);
		await assert.rejects(staged.run(store, 'matches'), /directory flush failed/);
		Object.assign(storage, originals); await update(6);
		assert.strictEqual((await reload()).docs[0].score, 6);
	});
	it('aborts if a live append fails even when a later rollback append succeeds', async function() {
		const gate = hold_stage(), compacting = staged.run(store, 'matches');
		const rejected = assert.rejects(compacting, /point append failed/);
		await gate.entered;
		const append = storage.appendFile;
		storage.appendFile = (...args) => args.at(-1)(new Error('point append failed'));
		try { await assert.rejects(update(5), /point append failed/); }
		finally { storage.appendFile = append; }
		await update(0); gate.release(); await rejected;
		assert.strictEqual((await reload()).docs[0].score, 0);
	});
	it('rejects duplicate maintenance before either snapshot has started', async function() {
		const first = staged.run(store, 'matches');
		await assert.rejects(staged.run(store, 'matches'), /already running/);
		await first;
	});
	for (const phase of ['before', 'after']) {
		it(`reloads acknowledged points after a process crash ${phase} the atomic rename`, async function() {
			const filename = path.join(directory, 'crash-' + phase);
			const child = fork(path.join(__dirname, 'fixtures/staged_compaction_child.js'), [filename, phase], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
			const exited = new Promise(resolve => child.once('exit', resolve));
			let timer;
			try {
				await new Promise((resolve, reject) => {
					timer = setTimeout(() => reject(new Error('Crash fixture did not reach the requested phase')), 5000);
					child.once('error', reject);
					child.once('message', message => message.error ? reject(new Error(message.error)) : resolve());
				});
			} finally { clearTimeout(timer); child.kill('SIGKILL'); await exited; }
			const recovered = new Datastore({ filename });
			await promisify(recovered.loadDatabase.bind(recovered))();
			assert.deepStrictEqual(await promisify(recovered.findOne.bind(recovered))({ _id: 'game' }), { _id: 'game', score: 5, at: new Date(1234) });
		});
	}
	it('retains the normal path for memory, custom codecs, startup and TTL stores', function() {
		assert.strictEqual(staged.supported(store), true);
		store.executor.ready = false; assert.strictEqual(staged.supported(store), false);
		store.executor.ready = true; store.ttlIndexes.score = 1; assert.strictEqual(staged.supported(store), false);
		assert.strictEqual(staged.supported(new Datastore({ inMemoryOnly: true })), false);
		assert.strictEqual(staged.supported(new Datastore({ filename: path.join(directory, 'custom') })), false);
	});
});
