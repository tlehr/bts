'use strict';

const assert = require('assert');
const { promisify } = require('util');
const { fixture, match } = require('./tournament_model_fixture');
const write = require('../bts/match_cleanup/participant_writes');
const prepare = require('../bts/btp_planner/prepared_document').prepare;
const model = require('nedb/lib/model');

async function setup(count) {
	const f = await fixture();
	for (let i = 2; i < count; i++) await promisify(f.db.matches.insert.bind(f.db.matches))(match('extra-' + i));
	const records = (await f.db.model.snapshot('test', ['matches'])).matches;
	return { ...f, app: { db: f.db }, records, edits: records.map(record => ({ match: record,
		patch: { 'setup.teams.0.players.0.checked_in': true },
	})) };
}

describe('bounded participant writes', function() {
	it('matches NeDB array-path semantics, owns changed values and shares untouched histories', function() {
		const before = match('one'); before.presses = [{ type: 'point' }];
		const update = { $set: { 'setup.teams.0.players.0.checked_in': true }, $unset: { 'setup.teams.0.players.0.name': true } };
		const prepared = prepare({ collection: 'matches', before, after: before, update }, 'matches', true);
		assert.deepStrictEqual(prepared.document, model.modify(before, update));
		assert.strictEqual(prepared.document.presses, before.presses);
		assert.notStrictEqual(prepared.document.setup.teams, before.setup.teams);
		assert.strictEqual(before.setup.teams[0].players[0].checked_in, false);
		for (const path of ['setup.teams.5.players', 'setup.teams.01.players', 'setup.teams.length']) {
			assert.strictEqual(prepare({ collection: 'matches', before, after: before, update: { $set: { [path]: true } } }, 'matches', true), null);
		}
	});

	it('uses groups of four, preserves intervening points and lets a queued read run before later groups', async function() {
		const f = await setup(9), store = f.db.matches, persist = store.persistence.persistNewState;
		const appends = [];
		store.persistence.persistNewState = function(documents, done) { appends.push(documents.length); return persist.call(this, documents, done); };
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		store.executor.push({ this: store, fn: done => { release = done; reached(); }, arguments: [() => {}] });
		await held;
		const point = store.update_async({ _id: f.records[0]._id }, { $set: { network_score: [[7, 3]], 'setup.needs_preparation_successor': true } }, {});
		const changes = write(f.app, f.edits);
		const read = store.findOne_async({ _id: f.records[8]._id });
		release();
		try {
			assert.strictEqual((await read).setup.teams[0].players[0].checked_in, false);
			await point; const records = await changes;
			assert.strictEqual(records.length, 9); assert.deepStrictEqual(appends, [1, 4, 4, 1]);
			const current = await store.findOne_async({ _id: f.records[0]._id });
			assert.deepStrictEqual(current.network_score, [[7, 3]]); assert.strictEqual(current.setup.needs_preparation_successor, true);
			assert(records.every(record => record.setup.teams[0].players[0].checked_in));
		} finally { store.persistence.persistNewState = persist; }
	});

	it('publishes successful groups and restores only the failed group on append error', async function() {
		const f = await setup(5), store = f.db.matches, persist = store.persistence.persistNewState;
		let appends = 0; const published = [];
		store.persistence.persistNewState = function(documents, done) {
			if (++appends === 2) return queueMicrotask(() => done(new Error('failed participant append')));
			return persist.call(this, documents, done);
		};
		try {
			await assert.rejects(write(f.app, f.edits, records => published.push(...records.map(record => record._id))), /failed participant append/);
			assert.deepStrictEqual(published, f.records.slice(0, 4).map(record => record._id));
			for (let i = 0; i < 5; i++) assert.strictEqual(f.tournament.matches.get(f.records[i]._id).data.setup.teams[0].players[0].checked_in, i < 4);
		} finally { store.persistence.persistNewState = persist; }
	});

	it('uses the native TTL writer if an expiry index is installed while queued', async function() {
		const f = await setup(2), store = f.db.matches;
		await store.update_async({ _id: f.records[0]._id }, { $set: { expires: new Date(0) } }, {});
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		store.executor.push({ this: store, fn: done => { release = done; reached(); }, arguments: [() => {}] });
		await held;
		const changes = write(f.app, f.edits);
		await promisify(store.ensureIndex.bind(store))({ fieldName: 'expires', expireAfterSeconds: 1 });
		release(); await changes;
		assert.strictEqual(await store.findOne_async({ _id: f.records[0]._id }), null);
		assert.strictEqual((await store.findOne_async({ _id: f.records[1]._id })).setup.teams[0].players[0].checked_in, true);
	});
	it('awaits other native writes after a custom writer fails and publishes completed records', async function() {
		let release, settled = false; const published = [];
		const first = match('one'), second = match('two');
		const failure = new Error('custom participant writer failed');
		const app = { db: { matches: { update(query, _update, _options, callback) {
			if (query._id === 'one') callback(failure);
			else release = () => callback(null, 1, second);
		} } } };
		const changes = write(app, [first, second].map(record => ({ match: record, patch: { 'setup.state': 'scheduled' } })),
			records => published.push(...records.map(record => record._id)));
		const completed = changes.then(() => { settled = true; }, error => { settled = true; return error; });
		await new Promise(resolve => setImmediate(resolve)); assert.strictEqual(settled, false);
		release(); assert.strictEqual(await completed, failure); assert.deepStrictEqual(published, ['two']);
	});
});
