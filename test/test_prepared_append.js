'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const model = require('nedb/lib/model');
const storage = require('nedb/lib/storage');
const append = require('../bts/prepared_append');

describe('prepared immutable append serialization', function() {
	let directory;
	beforeEach(function() { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-prepared-append-')); });
	afterEach(function() { fs.rmSync(directory, { recursive: true, force: true }); });
	async function store(options = {}) {
		const db = new Datastore({ filename: path.join(directory, 'matches'), ...options });
		assert(append.attach(db));
		await promisify(db.loadDatabase.bind(db))();
		return db;
	}
	const persist = (db, documents) => promisify(db.persistence.persistNewState.bind(db.persistence))(documents);
	const document = () => ({ _id: 'one', tournament_key: 'test', presses: [{ type: 'love-all', timestamp: 1000 }],
		setup: { match_num: 5, note: 'Ä Ö ß\n\\ "', missing: undefined }, date: new Date(123456), network_score: [[21, 13]] });

	it('writes exactly NeDB bytes for prepared and ordinary records, including dates and escaping', async function() {
		const db = await store(), first = document(), second = { _id: 'two', missing: undefined, list: [null, undefined, 3] };
		append.prepare(db, first);
		await persist(db, [first, second]);
		assert.strictEqual(fs.readFileSync(db.filename, 'utf8'), model.serialize(first) + '\n' + model.serialize(second) + '\n');
		const reload = new Datastore({ filename: db.filename });
		await promisify(reload.loadDatabase.bind(reload))();
		assert.deepStrictEqual(await promisify(reload.findOne.bind(reload))({ _id: 'one' }), model.deserialize(model.serialize(first)));
	});

	it('serializes the prepared history before append and consumes the cache once', async function() {
		const db = await store(), first = document();let reads = 0;
		Object.defineProperty(first.presses[0], 'type', { enumerable: true, get() { reads++; return 'love-all'; } });
		append.prepare(db, first);assert(reads > 0);reads = 0;
		await persist(db, [first]);assert.strictEqual(reads, 0, 'append must not traverse the prepared history');
		await persist(db, [first]);assert(reads > 0, 'a second append must use native serialization again');
	});

	it('keeps current serialization hooks and does not execute them while preparing', async function() {
		const db = await store({ afterSerialization: value => Buffer.from(value).toString('base64'),
			beforeDeserialization: value => Buffer.from(value, 'base64').toString() });
		const first = document();let hooks = 0;
		const hook = db.persistence.afterSerialization;
		db.persistence.afterSerialization = value => { hooks++; return hook(value); };
		append.prepare(db, first);assert.strictEqual(hooks, 0);
		await persist(db, [first]);assert.strictEqual(hooks, 1);
		assert.strictEqual(fs.readFileSync(db.filename, 'utf8'), hook(model.serialize(first)) + '\n');
	});

	it('uses the current serializer if it changes after preparation', async function() {
		const db = await store(), first = document(), serialize = model.serialize;let calls = 0;
		append.prepare(db, first);
		model.serialize = value => { calls++; return serialize(value); };
		try { await persist(db, [first]);assert.strictEqual(calls, 1); }
		finally { model.serialize = serialize; }
	});

	it('propagates append errors and re-serializes when the caller retries', async function() {
		const db = await store(), first = document(), native = storage.appendFile;
		append.prepare(db, first);
		storage.appendFile = (_filename, _bytes, _encoding, callback) => queueMicrotask(() => callback(new Error('append failure')));
		try { await assert.rejects(persist(db, [first]), /append failure/); }
		finally { storage.appendFile = native; }
		first.setup.match_num = 6;
		await persist(db, [first]);
		assert.strictEqual(fs.readFileSync(db.filename, 'utf8'), model.serialize(first) + '\n');
	});

	it('retains custom persistence and the ordinary in-memory path', async function() {
		const custom = new Datastore({ inMemoryOnly: true });
		custom.persistence.persistNewState = (_documents, callback) => callback(new Error('custom writer'));
		assert.strictEqual(append.attach(custom), false);
		append.prepare(custom, document());
		await assert.rejects(persist(custom, [document()]), /custom writer/);
		const memory = new Datastore({ inMemoryOnly: true });assert(append.attach(memory));
		append.prepare(memory, document());await persist(memory, [document()]);
	});
});
