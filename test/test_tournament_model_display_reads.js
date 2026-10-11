'use strict';

const assert = require('assert');
const { fixture } = require('./tournament_model_fixture');
const projection = require('../bts/panel_tournament_projection');
const read = (db, part, id, key = 'test') => new Promise((resolve, reject) => {
	db.model.read_display_context_part(part, key, id, (error, value) => error ? reject(error) : resolve(value));
});

describe('ordered display context reads', function() {
	it('reads detached canonical records and current projected settings without scanning or copying registrations', async function() {
		const { db, tournament } = await fixture();
		await db.tournaments.update_async({ key: 'test' }, { $set: {
			name: 'Live', logo_id: 'logo', displaysettings_general: { style: 'castall' },
			bup_v2_admin_wait_for_score_updates: true,
		} }, {});
		const expected = await db.tournaments.findOne_async({ key: 'test' }, projection);
		for (const name of ['tournaments', 'courts', 'matches']) {
			db[name].getCandidates = () => { throw new Error('ordinary cursor scanned ' + name); };
		}
		Object.defineProperty(tournament.record.data, 'events', { enumerable: true, configurable: true,
			get() { throw new Error('copied registration data'); },
		});
		const settings = await read(db, 'tournament');
		assert.deepStrictEqual(settings, expected);
		settings.displaysettings_general.style = 'changed';
		assert.strictEqual(tournament.record.data.displaysettings_general.style, 'castall');
		const game = await read(db, 'match', 'one');
		game.network_score[0][0] = 99;
		assert.deepStrictEqual(tournament.matches.get('one').data.network_score, [[0, 0]]);
		const court = await read(db, 'court', 'court');
		court.match_id = 'two';
		assert.strictEqual(tournament.courts.get('court').data.match_id, 'one');
	});

	it('waits for score persistence and preserves its position between pending writes', async function() {
		const { db, tournament } = await fixture();
		const persist = db.matches.persistence.persistNewState;
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		db.matches.persistence.persistNewState = function(docs, done) {
			release = () => persist.call(this, docs, done);
			reached();
		};
		const first = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[2, 1]] } }, {});
		await held;
		assert.deepStrictEqual(tournament.matches.get('one').data.network_score, [[2, 1]]);
		let completed = false;
		const capture = read(db, 'match', 'one').then(value => { completed = true; return value; });
		const second = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 1]] } }, {});
		try {
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(completed, false);
		} finally { db.matches.persistence.persistNewState = persist; release(); }
		await Promise.all([first, second]);
		assert.deepStrictEqual((await capture).network_score, [[2, 1]]);
	});

	it('does not return missing, deleted or moved records', async function() {
		const { db } = await fixture();
		assert.strictEqual(await read(db, 'match', 'missing'), null);
		assert.strictEqual(await read(db, 'court', 'court', 'other'), null);
		await db.matches.update_async({ _id: 'one' }, { $set: { tournament_key: 'other' } }, {});
		assert.strictEqual(await read(db, 'match', 'one'), null);
		assert.strictEqual((await read(db, 'match', 'one', 'other'))._id, 'one');
		await db.courts.remove_async({ _id: 'court' }, {});
		assert.strictEqual(await read(db, 'court', 'court'), null);
		await db.tournaments.update_async({ key: 'test' }, { $set: { key: 'other' } }, {});
		assert.strictEqual(await read(db, 'tournament'), null);
	});

	it('honors a TTL index added after enqueue and removes the expired canonical record', async function() {
		const { db, tournament } = await fixture();
		const game = tournament.matches.get('one');
		await db.matches.update_async({ _id: 'one' }, { $set: { expires: new Date(0) } }, {});
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		db.matches.executor.push({ this: db.matches, fn: done => { release = done; reached(); }, arguments: [() => {}] });
		await held;
		const capture = read(db, 'match', 'one');
		await new Promise((resolve, reject) => db.matches.ensureIndex({ fieldName: 'expires', expireAfterSeconds: 1 },
			error => error ? reject(error) : resolve()));
		release();
		assert.strictEqual(await capture, null);
		assert.strictEqual(game.present, false);
		assert.strictEqual(await db.matches.findOne_async({ _id: 'one' }), null);
	});
});
