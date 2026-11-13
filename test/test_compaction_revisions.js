'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const storage = require('nedb/lib/storage');
const revisions = require('../bts/compaction_worker/revisions');
const compaction = require('../bts/compaction_worker');
const staged = require('../bts/compaction_worker/staged');
const prepared = require('../bts/prepared_append');
const schedule = require('../bts/database_compaction');

describe('unchanged database maintenance', function() {
	this.timeout(10000);
	let directory, store, saved;
	beforeEach(async function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-compaction-revisions-'));
		store = new Datastore({ filename: path.join(directory, 'matches') });
		prepared.attach(store);
		compaction.attach(store, 'matches', { identity_serialization: true });
		revisions.attach(store);
		await promisify(store.loadDatabase.bind(store))();
		saved = storage.crashSafeWriteFile;
	});
	afterEach(function() {
		storage.crashSafeWriteFile = saved;
		compaction.client.close();
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const insert = value => promisify(store.insert.bind(store))(value);
	const rewrite = () => promisify(store.persistence.persistCachedDatabase.bind(store.persistence))();
	const reload = async () => {
		const fresh = new Datastore({ filename: store.filename });
		await promisify(fresh.loadDatabase.bind(fresh))();
		return promisify(fresh.find.bind(fresh))({});
	};

	it('does not rewrite a freshly loaded unchanged file on periodic maintenance', async function() {
		assert.strictEqual(revisions.needed(store), false);
		const before = fs.statSync(store.filename);
		let timer, stopped = false;
		const control = schedule({ matches: store }, ['matches'], {
			set_timer(fn) { timer = fn; }, clear_timer() { stopped = true; },
		});
		for (let i = 0; i < 4; i++) timer();
		assert.strictEqual(control.active_collection, null);
		assert.strictEqual(fs.statSync(store.filename).ino, before.ino);
		assert.strictEqual(fs.statSync(store.filename).mtimeMs, before.mtimeMs);
		control.stop(); assert(stopped);
	});
	it('still compacts inserts, edits and removals and retains their data on reload', async function() {
		await insert({ _id: 'one', value: 'ä', at: new Date(1234) });
		await insert({ _id: 'removed' });
		await promisify(store.update.bind(store))({ _id: 'one' }, { $set: { value: 'changed' } }, {});
		await promisify(store.remove.bind(store))({ _id: 'removed' }, {});
		assert(revisions.needed(store));
		await staged.run(store, 'matches');
		assert.strictEqual(revisions.needed(store), false);
		assert.deepStrictEqual(await reload(), [{ _id: 'one', value: 'changed', at: new Date(1234) }]);
	});
	it('periodic maintenance still rewrites a tracked file after a new append', async function() {
		await insert({ _id: 'one', score: 7 });
		let timer;
		const control = schedule({ matches: store }, ['matches'], {
			set_timer(fn) { timer = fn; }, clear_timer() {},
		});
		try {
			const done = new Promise(resolve => store.once('compaction.done', resolve));
			timer(); await done;
			while (control.active_collection) await new Promise(resolve => setImmediate(resolve));
			assert(!revisions.needed(store));
			assert.deepStrictEqual(await reload(), [{ _id: 'one', score: 7 }]);
		} finally { control.stop(); }
	});
	it('tracks index definition creation and deletion as file changes', async function() {
		await promisify(store.ensureIndex.bind(store))({ fieldName: 'value', unique: true });
		assert(revisions.needed(store)); await rewrite(); assert(!revisions.needed(store));
		await promisify(store.removeIndex.bind(store))('value');
		assert(revisions.needed(store)); await rewrite(); assert(!revisions.needed(store));
	});
	it('tracks prepared serialized records through the real append adapter', async function() {
		const document = { _id: 'prepared', value: '✓' };
		assert(prepared.prepare(store, document));
		await promisify(store.persistence.persistNewState.bind(store.persistence))([document]);
		assert(revisions.needed(store));
		assert.deepStrictEqual(await reload(), [document]);
	});
	it('keeps a failed rewrite dirty and permits a later successful retry', async function() {
		await insert({ _id: 'one' });
		const failure = new Error('simulated disk failure');
		storage.crashSafeWriteFile = (filename, bytes, callback) => callback(failure);
		await assert.rejects(rewrite(), error => error === failure);
		assert(revisions.needed(store));
		storage.crashSafeWriteFile = saved;
		await rewrite(); assert(!revisions.needed(store));
		assert.deepStrictEqual(await reload(), [{ _id: 'one' }]);
	});
	it('does not treat a failed append as an unchanged clean file', async function() {
		const filename = store.persistence.filename;
		try {
			store.persistence.filename = directory;
			await assert.rejects(insert({ _id: 'failed' }), error => error.code === 'EISDIR');
			assert(revisions.needed(store));
		} finally { store.persistence.filename = filename; }
		await rewrite(); assert(!revisions.needed(store));
	});
	it('retains writes made while staged maintenance was preparing its snapshot', async function() {
		await insert({ _id: 'one', value: 1 });
		let release, entered;
		const held = new Promise(resolve => { entered = resolve; });
		storage.crashSafeWriteFile = (filename, bytes, callback) => {
			if (filename.endsWith('.bts-compacting')) {
				release = () => saved(filename, bytes, callback); entered();
			} else saved(filename, bytes, callback);
		};
		const running = staged.run(store, 'matches');
		await held;
		await promisify(store.update.bind(store))({ _id: 'one' }, { $set: { value: 2 } }, {});
		release(); await running;
		assert(revisions.needed(store), 'A later append must not be hidden by an older captured revision');
		storage.crashSafeWriteFile = saved;
		await staged.run(store, 'matches'); assert(!revisions.needed(store));
		assert.deepStrictEqual(await reload(), [{ _id: 'one', value: 2 }]);
	});
	it('retains the ordinary maintenance path for stores without lifecycle tracking', function() {
		assert(revisions.needed(new Datastore()));
	});
});
