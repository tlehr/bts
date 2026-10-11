'use strict';

const assert = require('assert');
const { fixture, insert, match } = require('./tournament_model_fixture');

const read = (db, part, id, key = 'test') => new Promise((resolve, reject) => {
	db.model.read_score_context_part(part, key, id, (error, value, timing) => error ? reject(error) : resolve({ value, timing }));
});

describe('ordered score context reads', function() {
	it('looks up only the requested objects and returns detached copies without registration data', async function() {
		const { db, tournament } = await fixture();
		db.matches.getCandidates = () => { throw new Error('queried all tournament matches'); };
		tournament.matches.values = () => { throw new Error('scanned model'); };
		Object.defineProperty(tournament.record.data, 'events', { enumerable: true,
			get() { throw new Error('copied registrations'); }, configurable: true });
		const game = await read(db, 'match', 'one');
		game.value.setup.teams[0].players[0].checked_in = true;
		assert.strictEqual(tournament.matches.get('one').data.setup.teams[0].players[0].checked_in, false);
		const event = await read(db, 'tournament');
		assert.strictEqual(event.value.key, 'test');
		assert.strictEqual(event.value.events, undefined);
		const court = await read(db, 'court', 'court');
		assert.strictEqual(court.value.match_id, 'one');
		assert.strictEqual(game.timing.read_source, 'object_model');
		assert(game.timing.db_queue_wait_ms >= 0);
		assert(game.timing.read_ms >= 0);
	});
	it('waits for prior write persistence even after the canonical object has already changed', async function() {
		const { db, tournament } = await fixture();
		const persist = db.matches.persistence.persistNewState;
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		db.matches.persistence.persistNewState = function(docs, done) {
			release = () => persist.call(this, docs, done); reached();
		};
		const write = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[9, 8]] } }, {});
		await held;
		assert.deepStrictEqual(tournament.matches.get('one').data.network_score, [[9, 8]]);
		let resolved = false;
		const capture = read(db, 'match', 'one').then(result => { resolved = true; return result; });
		try {
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(resolved, false);
		} finally { release(); db.matches.persistence.persistNewState = persist; }
		await write;
		assert.deepStrictEqual((await capture).value.network_score, [[9, 8]]);
	});
	it('preserves read position between two pending writes and reports compaction backlog', async function() {
		const { db } = await fixture();
		const first = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[1, 2]] } }, {});
		db.compaction = { active_collection: 'matches' };
		const capture = read(db, 'match', 'one');
		const second = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 4]] } }, {});
		await Promise.all([first, second]);
		const { value, timing } = await capture;
		assert.deepStrictEqual(value.network_score, [[1, 2]]);
		assert.strictEqual(timing.compaction_pending_at_enqueue, true);
		assert(timing.queue_depth_at_enqueue >= 0);
	});
	it('does not expose deleted or moved matches, courts, or tournament records', async function() {
		const { db } = await fixture();
		assert.strictEqual((await read(db, 'match', 'missing')).value, null);
		assert.strictEqual((await read(db, 'court', 'court', 'other')).value, null);
		await db.matches.update_async({ _id: 'one' }, { $set: { tournament_key: 'other' } }, {});
		assert.strictEqual((await read(db, 'match', 'one')).value, null);
		assert.strictEqual((await read(db, 'match', 'one', 'other')).value._id, 'one');
		await db.tournaments.update_async({ key: 'test' }, { $set: { key: 'other' } }, {});
		assert.strictEqual((await read(db, 'tournament')).value, null);
		await db.courts.remove_async({ _id: 'court' }, {});
		assert.strictEqual((await read(db, 'court', 'court')).value, null);
		await insert(db.matches, match('new'));
		assert.strictEqual((await read(db, 'match', 'new')).value._id, 'new');
	});
});
