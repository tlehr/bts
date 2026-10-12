'use strict';

const assert = require('assert');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Datastore = require('nedb');
const model = require('nedb/lib/model');
const prepare = require('../bts/btp_planner/prepared_match').prepare;
const batch = require('../bts/btp_planner/batch_writes');

describe('prepared match metadata writes', function() {
	it('copies changed values and shares immutable score histories without traversing them', function() {
		const before = { _id: 'one', tournament_key: 'test', network_score: [[1, 0]], presses: [],
			setup: { match_num: 1, teams: [{ players: [{ btp_id: 1, name: 'A' }] }] } };
		const update = { $set: { 'setup.match_num': 99 }, $unset: { 'setup.absent': true } };
		const expected = model.modify(before, update);
		const edit = { collection: 'matches', id: 'one', before, after: expected, update };
		const prepared = prepare(edit);
		assert.deepStrictEqual(prepared.document, expected);
		assert.strictEqual(prepared.document.network_score, before.network_score);
		const heavy = { ...before, presses: [Object.defineProperty({}, 'type', { enumerable: true,
			get() { throw new Error('traversed unchanged history'); } })] };
		assert.strictEqual(prepare({ ...edit, before: heavy }).document.presses, heavy.presses);
		assert.strictEqual(prepare({ ...edit, update: { $set: { 'setup.teams.0.players.0.name': 'Nested array' } } }), null);
		assert.strictEqual(prepare({ ...edit, update: { $set: { tournament_key: 'other' } } }), null);
		const changed = { $set: { 'setup.teams': [{ players: [{ btp_id: 2, name: 'Changed' }] }] } };
		const ready = prepare({ ...edit, update: changed });
		changed.$set['setup.teams'][0].players[0].name = 'Mutated';
		assert.strictEqual(ready.document.setup.teams[0].players[0].name, 'Changed');
	});

	it('persists one metadata write, preserves a concurrent point on fallback, and rolls back failed persistence', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-prepared-match-'));
		const store = new Datastore({ filename: path.join(directory, 'matches') });
		try {
			await promisify(store.loadDatabase.bind(store))();
			await promisify(store.insert.bind(store))({ _id: 'one', tournament_key: 'test', network_score: [[1, 0]], presses: [],
				setup: { match_num: 1, teams: [{ players: [{ btp_id: 1, name: 'A' }] }] } });
			const domain = require('../bts/tournament_model').attach({ matches: store });
			const raw = () => domain.tournament('test').matches.get('one').data;
			const entity = domain.tournament('test').matches.get('one');
			const edit = () => { const before = raw(), update = { $set: { 'setup.match_num': 99 } };
				return { collection: 'matches', id: 'one', before, after: model.modify(before, update), update }; };
			const query = () => ({ _id: 'one', tournament_key: 'test' });
			let change = edit();
			assert.deepStrictEqual(await batch.write(store, [change], query, new Map([[change, prepare(change)]])), { prepared_writes: 1, prepared_fallbacks: 0 });
			assert.strictEqual(domain.tournament('test').matches.get('one'), entity);
			change = edit(); const prepared = prepare(change);
			await promisify(store.update.bind(store))(query(), { $set: { network_score: [[2, 0]] } }, {});
			assert.deepStrictEqual(await batch.write(store, [change], query, new Map([[change, prepared]])), { prepared_writes: 0, prepared_fallbacks: 1 });
			assert.deepStrictEqual(raw().network_score, [[2, 0]]);
			change = edit(); change.update = { $set: { 'setup.match_num': 100 } }; change.after = model.modify(change.before, change.update);
			const persist = store.persistence.persistNewState; let failed = false;
			store.persistence.persistNewState = function(documents, done) {
				if (!failed) { failed = true; return queueMicrotask(() => done(new Error('append failed'))); }
				return persist.call(this, documents, done);
			};
			try { await assert.rejects(batch.write(store, [change], query, new Map([[change, prepare(change)]])), /append failed/); }
			finally { store.persistence.persistNewState = persist; }
			assert.strictEqual(raw().setup.match_num, 99);
			const reload = new Datastore({ filename: store.filename });
			await promisify(reload.loadDatabase.bind(reload))();
			assert.deepStrictEqual(await promisify(reload.findOne.bind(reload))(query()), raw());
		} finally { fs.rmSync(directory, { recursive: true, force: true }); }
	});
});
