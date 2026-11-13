'use strict';

const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb'), storage = require('nedb/lib/storage');
const compaction = require('../bts/compaction_worker'), staged = require('../bts/compaction_worker/staged');
const barrier = require('../bts/database_read_barrier');
const turn = () => new Promise(resolve => setImmediate(resolve));

describe('score reads during staged court-file replacement', function() {
	this.timeout(10000);
	let directory, store, db, original_rename, release, pending;
	beforeEach(async function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-staged-court-read-'));
		store = new Datastore({ filename: path.join(directory, 'courts') });
		compaction.attach(store, 'courts', { identity_serialization: true });
		db = { courts: store, tournaments: new Datastore({ inMemoryOnly: true }), matches: new Datastore({ inMemoryOnly: true }) };
		require('../bts/tournament_model').attach(db);
		await promisify(store.loadDatabase.bind(store))();
		await promisify(store.insert.bind(store))({ _id: 'court', tournament_key: 'test', num: 1, match_id: 'game' });
		original_rename = storage.rename; pending = [];
	});
	afterEach(async function() {
		if (release) release(); release = null;
		await Promise.allSettled(pending);
		storage.rename = original_rename; compaction.client.close();
		fs.rmSync(directory, { recursive: true, force: true });
	});
	async function hold_swap() {
		let reached;
		const entered = new Promise(resolve => { reached = resolve; });
		storage.rename = (from, to, done) => {
			if (from === store.filename + '.bts-compacting') {
				release = () => { release = null; original_rename(from, to, done); }; reached();
			} else original_rename(from, to, done);
		};
		pending.push(staged.run(store, 'courts')); await entered;
	}
	function read() {
		return new Promise((resolve, reject) => db.model.read_score_context_part('court', 'test', 'court',
			(error, value, timing) => error ? reject(error) : resolve({ value, timing })));
	}
	it('reads the committed court while the actual staged rename is held, retaining detached results', async function() {
		await hold_swap();
		let delivered = false;
		const capture = read().then(value => { delivered = true; return value; }); pending.push(capture);
		await turn(); await turn();
		assert.strictEqual(delivered, true, 'A pure staged file replacement must not delay this court read');
		const result = await capture;
		assert.strictEqual(result.timing.compaction_read_bypassed, true);
		assert.strictEqual(result.value.num, 1);
		let written = false;
		const write = promisify(store.update.bind(store))({ _id: 'court' }, { $set: { num: 2 } }, {}).then(() => { written = true; }); pending.push(write);
		await turn(); assert.strictEqual(written, false);
		release(); await Promise.all(pending);
		assert.strictEqual(result.value.num, 1, 'A later committed edit must not mutate the captured court');
		const reload = new Datastore({ filename: store.filename });
		await promisify(reload.loadDatabase.bind(reload))();
		assert.strictEqual((await promisify(reload.findOne.bind(reload))({ _id: 'court' })).num, 2);
	});
	it('keeps a preceding court edit ahead of its reader during staged replacement', async function() {
		await hold_swap();
		pending.push(promisify(store.update.bind(store))({ _id: 'court' }, { $set: { num: 3 } }, {}));
		let delivered = false;
		const capture = read().then(value => { delivered = true; return value; }); pending.push(capture);
		await turn(); assert.strictEqual(delivered, false);
		release(); await Promise.all(pending);
		assert.strictEqual((await capture).value.num, 3);
	});
	it('retains the compaction-read opt-out during a staged replacement', async function() {
		const previous = process.env.BTS_COMPACTION_MODEL_READS;
		process.env.BTS_COMPACTION_MODEL_READS = '0';
		try {
			await hold_swap();
			let delivered = false;
			const capture = read().then(value => { delivered = true; return value; }); pending.push(capture);
			await turn(); assert.strictEqual(delivered, false);
			release(); await Promise.all(pending);
			assert.strictEqual((await capture).timing.compaction_read_decision, 'disabled');
		} finally {
			if (previous === undefined) delete process.env.BTS_COMPACTION_MODEL_READS;
			else process.env.BTS_COMPACTION_MODEL_READS = previous;
		}
	});
	it('does not pass an earlier scoped write behind a direct compaction', async function() {
		const original = store.persistence.persistCachedDatabase;
		let reached;
		const entered = new Promise(resolve => { reached = resolve; });
		store.persistence.persistCachedDatabase = function(done) {
			release = () => { release = null; store.persistence.persistCachedDatabase = original; original.call(this, done); }; reached();
		};
		pending.push(new Promise(resolve => store.once('compaction.done', resolve)));
		store.persistence.compactDatafile(); await entered;
		pending.push(new Promise((resolve, reject) => store.executor.push(barrier.certify_write({ this: store, fn: store._update,
			arguments: [{ _id: 'court' }, { $set: { num: 4 } }, {}, error => error ? reject(error) : resolve()],
		}, ['court'], () => true))));
		let delivered = false;
		const capture = read().then(value => { delivered = true; return value; }); pending.push(capture);
		await turn(); assert.strictEqual(delivered, false, 'Scoped writes are still writes and must retain query order');
		release(); await Promise.all(pending);
		assert.strictEqual((await capture).value.num, 4);
	});
});
