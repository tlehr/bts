'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const nedb_model = require('nedb/lib/model');
const { prepare, validate } = require('../bts/btp_planner/prepared_tournament');
const batch = require('../bts/btp_planner/batch_writes');
const tournament_model = require('../bts/tournament_model');
const { registration, match } = require('./tournament_model_fixture');

const before = () => ({ _id: 't1', key: 'default', events: { events: [{ stages: [{ entries: [{ value: 1 }] }] }], metadata: { version: 1 } },
	settings: { ready: true }, removed: 'old', date: new Date(1000) });
const change = (document, update) => ({ collection: 'tournaments', id: document._id, before: document, after: nedb_model.modify(document, update), update });

describe('prepared tournament updates', function() {
	it('matches NeDB set/unset semantics, owns new values and shares only unchanged revision branches', function() {
		const document = before(), original = nedb_model.deepCopy(document);
		const value = [{ stages: [{ entries: [{ value: 2, date: new Date(2000) }] }] }];
		const update = { $set: { 'events.metadata.version': 2, 'new.parent': value, undefined_value: undefined }, $unset: { removed: true, 'absent.child': true } };
		const prepared = prepare(change(document, update));
		assert.deepStrictEqual(prepared.document, nedb_model.modify(document, update));
		assert.deepStrictEqual(document, original);
		assert.strictEqual(prepared.document.events.events, document.events.events);
		assert.notStrictEqual(prepared.document.events, document.events);
		assert.notStrictEqual(prepared.document.new.parent, value);
		value[0].stages[0].entries[0].value = 99;
		assert.strictEqual(prepared.document.new.parent[0].stages[0].entries[0].value, 2);
	});

	it('validates changed arrays and preserves NeDB special key and Date rules', function() {
		const allowed = [{ date: new Date(2000), $$date: 123, $$deleted: true, $$indexCreated: {}, $$indexRemoved: 'x' }];
		assert.doesNotThrow(() => validate(allowed));
		assert.doesNotThrow(() => nedb_model.checkObject(allowed));
		for (const value of [{ 'bad.key': 1 }, { $bad: 1 }, { $$date: 'wrong' }, { $$deleted: false }, { nested: [{ $bad: 1 }] }]) {
			assert.throws(() => validate(value), /Field names/);
			assert.throws(() => nedb_model.checkObject(value), /Field names/);
			assert.throws(() => prepare({ collection: 'tournaments', before: before(), after: {}, update: { $set: { data: value } } }), /Field names/);
		}
	});

	it('uses ordinary NeDB for unsupported operations, overlapping paths, array traversal, identity and unsafe paths', function() {
		for (const update of [{ $inc: { count: 1 } }, { $set: { 'events.events.0.value': 2 } },
			{ $set: { 'events.metadata': {}, 'events.metadata.version': 3 } }, { $set: { removed: 1 }, $unset: { removed: true } },
			{ $set: { _id: 'other' } }, { $set: { key: 'other' } }, { $set: { 'constructor.foo': 'x' } },
			{ $set: { 'events.__proto__.foo': 'x' } }, { $set: null }, { $unset: { '.invalid': true } }]) {
			assert.strictEqual(prepare({ collection: 'tournaments', before: before(), after: {}, update }), null);
		}
		assert.strictEqual(prepare({ ...change(before(), { $set: { removed: 'new' } }), collection: 'matches' }), null);
		for (const value of [() => 1, Symbol('x'), 1n, { nested: () => 2 }, new Map(), Array(2)]) {
			assert.strictEqual(prepare({ collection: 'tournaments', before: before(), after: {}, update: { $set: { data: value } } }), null);
		}
	});
});

describe('prepared tournament persistence', function() {
	let directory, store;
	beforeEach(async function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-prepared-tournament-'));
		store = new Datastore({ filename: path.join(directory, 'tournaments') });
		await promisify(store.loadDatabase.bind(store))();
		await promisify(store.insert.bind(store))(before());
	});
	afterEach(function() { fs.rmSync(directory, { recursive: true, force: true }); });
	const query = () => ({ _id: 't1', key: 'default' });
	const raw = () => store.indexes._id.getMatching('t1')[0];
	async function reload() {
		const db = new Datastore({ filename: store.filename });
		await promisify(db.loadDatabase.bind(db))();
		return promisify(db.findOne.bind(db))(query());
	}
	function input() {
		const edit = change(raw(), { $set: { 'events.metadata.version': 2 } });
		return { edit, prepared: new Map([[edit, prepare(edit)]]) };
	}
	it('keeps canonical identities, updates registrations and indices, appends once and survives reload', async function() {
		await promisify(store.update.bind(store))(query(), { $set: { events: registration([{ btp_id: 1, name: 'Registered' }]) } }, {});
		const matches = new Datastore();
		await promisify(matches.insert.bind(matches))(match('linked', [1], 'default'));
		const model = tournament_model.attach({ tournaments: store, matches });
		const entity = model.tournament('default').record;
		const player = model.tournament('default').players.get('1');
		const game = model.tournament('default').matches.get('linked');
		const edit = change(raw(), { $set: { events: registration([{ btp_id: 1, name: 'Renamed' }]) } });
		const prepared = new Map([[edit, prepare(edit)]]);
		const persist = store.persistence.persistNewState;
		let appends = 0;
		store.persistence.persistNewState = function(...args) { appends++; return persist.apply(this, args); };
		assert.deepStrictEqual(await batch.write(store, [edit], query, prepared), { prepared_writes: 1, prepared_fallbacks: 0 });
		assert.strictEqual(model.tournament('default').record, entity);
		assert.strictEqual(player.data.name, 'Renamed');
		assert.strictEqual(model.tournament('default').players.get('1'), player);
		assert.strictEqual([...game.players][0], player);
		assert(player.matches.has(game));
		assert.strictEqual(appends, 1);
		assert.deepStrictEqual(await reload(), entity.data);
	});
	it('falls back if another writer replaced the prepared baseline and preserves its unrelated changes', async function() {
		const { edit, prepared } = input();
		await promisify(store.update.bind(store))(query(), { $set: { 'settings.other': 'concurrent' } }, {});
		assert.deepStrictEqual(await batch.write(store, [edit], query, prepared), { prepared_writes: 0, prepared_fallbacks: 1 });
		assert.strictEqual(raw().events.metadata.version, 2);
		assert.strictEqual(raw().settings.other, 'concurrent');
		assert.deepStrictEqual(await reload(), raw());
	});
	it('does not rebuild player registrations for a metadata-only update', async function() {
		await promisify(store.update.bind(store))(query(), { $set: { events: registration([{ btp_id: 1, name: 'Registered' }]) } }, {});
		const model = tournament_model.attach({ tournaments: store });
		const player = model.tournament('default').players.get('1');
		const profile = player._profile;
		player._profile = () => { throw new Error('Unchanged registrations should not be rebuilt'); };
		try {
			const edit = change(raw(), { $set: { 'events.metadata': { version: 2 } } });
			await batch.write(store, [edit], query, new Map([[edit, prepare(edit)]]));
			assert.strictEqual(player.data.name, 'Registered');
			assert.strictEqual(raw().events.metadata.version, 2);
		} finally { player._profile = profile; }
	});
	it('does not expose staged updates to ordered reads until persistence completes', async function() {
		const { edit, prepared } = input();
		const persist = store.persistence.persistNewState;
		let release;
		store.persistence.persistNewState = function(docs, callback) { release = () => persist.call(this, docs, callback); };
		const writing = batch.write(store, [edit], query, prepared);
		while (!release) await new Promise(resolve => setImmediate(resolve));
		let returned = false;
		const reading = promisify(store.findOne.bind(store))(query()).then(doc => { returned = true; return doc; });
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(returned, false);
		store.persistence.persistNewState = persist;
		release(); await writing;
		assert.strictEqual((await reading).events.metadata.version, 2);
	});
	it('retains unique-index validation and restores the original revision on a conflict', async function() {
		await promisify(store.ensureIndex.bind(store))({ fieldName: 'title', unique: true, sparse: true });
		await promisify(store.insert.bind(store))({ _id: 'other', key: 'other', title: 'Reserved' });
		const original = raw(), edit = change(original, { $set: { title: 'Reserved' } });
		await assert.rejects(batch.write(store, [edit], query, new Map([[edit, prepare(edit)]])), /unique constraint/);
		assert.strictEqual(raw(), original);
		assert.deepStrictEqual(await reload(), original);
	});
	it('repairs a partial append in memory and on disk before rejecting', async function() {
		const original = raw(), { edit, prepared } = input();
		const persist = store.persistence.persistNewState;
		let calls = 0;
		store.persistence.persistNewState = function(docs, callback) {
			if (++calls === 1) return persist.call(this, docs, () => callback(new Error('partial append failed')));
			return persist.call(this, docs, callback);
		};
		await assert.rejects(batch.write(store, [edit], query, prepared), /partial append failed/);
		assert.deepStrictEqual(raw(), original);
		assert.deepStrictEqual(await reload(), original);
	});
	it('restores registration profile priority after a failed append without reverting a newer match-owned profile', async function() {
		for (const concurrent of [false, true]) {
			await promisify(store.update.bind(store))(query(), { $set: { events: registration([{ btp_id: 1, name: 'Registered' }]) } }, {});
			const matches = new Datastore();
			await promisify(matches.insert.bind(matches))(match('linked', [1], 'default'));
			const model = tournament_model.attach({ tournaments: store, matches });
			await promisify(matches.update.bind(matches))({ _id: 'linked' }, { $set: { 'setup.teams.0.players.0.name': 'Latest match profile' } }, {});
			const player = model.tournament('default').players.get('1'), original = raw();
			assert.strictEqual(player.data.name, 'Latest match profile');
			const edit = change(original, { $set: { events: registration([{ btp_id: 1, name: 'Rejected sync profile' }]) } });
			const persist = store.persistence.persistNewState; let calls = 0;
			store.persistence.persistNewState = function(docs, callback) {
				if (++calls !== 1) return persist.call(this, docs, callback);
				const other = concurrent ? promisify(matches.update.bind(matches))({ _id: 'linked' }, { $set: { 'setup.teams.0.players.0.name': 'Concurrent match profile' } }, {}) : Promise.resolve();
				other.then(() => persist.call(this, docs, () => callback(new Error('partial append failed')))).catch(callback);
			};
			try {
				await assert.rejects(batch.write(store, [edit], query, new Map([[edit, prepare(edit)]])), /partial append failed/);
				assert.strictEqual(player.data.name, concurrent ? 'Concurrent match profile' : 'Latest match profile');
				assert.strictEqual(model.tournament('default').players.get('1'), player);
				assert.deepStrictEqual(raw(), original);
				assert.deepStrictEqual(await reload(), original);
			} finally { store.persistence.persistNewState = persist; }
		}
	});
});
