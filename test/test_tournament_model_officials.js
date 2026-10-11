'use strict';

const assert = require('assert');
const { fixture, insert } = require('./tournament_model_fixture');

describe('canonical officials and match roles', function() {
	it('keeps placeholder identity, both role links and current profiles through updates and removal', async function() {
		const { db, tournament } = await fixture();
		await db.matches.update_async({ _id: 'one' }, { $set: {
			'setup.umpire': { _id: 'official', name: 'Old name' }, 'setup.service_judge': { _id: 'official' },
		} }, {});
		const game = tournament.matches.get('one');
		const official = game.umpire;
		const umpire_assignment = game.official_assignments.get('umpire');
		assert.strictEqual(official.present, false);
		assert.strictEqual(game.service_judge, official);
		assert.strictEqual(official.assignments.size, 2);
		assert.deepStrictEqual([...official.matches], [game]);
		await insert(db.umpires, { _id: 'official', tournament_key: 'test', name: 'New name' });
		assert.strictEqual(tournament.umpires.get('official'), official);
		assert.strictEqual(umpire_assignment.toJSON().name, 'New name');
		await db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 4]] } }, {});
		assert.strictEqual(game.official_assignments.get('umpire'), umpire_assignment);
		await db.matches.update_async({ _id: 'one' }, { $unset: { 'setup.umpire': true } }, {});
		assert.strictEqual(official.assignments.size, 1);
		assert(official.matches.has(game));
		await db.matches.remove_async({ _id: 'one' }, {});
		assert.strictEqual(official.assignments.size, 0);
		assert.strictEqual(official.matches.size, 0);
	});

	it('detaches replaced roles and restores backlinks on match rollback and datastore reset', async function() {
		const { db, tournament } = await fixture();
		await insert(db.umpires, [{ _id: 'a', tournament_key: 'test', name: 'A' }, { _id: 'b', tournament_key: 'test', name: 'B' }]);
		await db.matches.update_async({ _id: 'one' }, { $set: { 'setup.umpire': { _id: 'a' } } }, {});
		const old = tournament.matches.get('one').data;
		const a = tournament.umpires.get('a'), b = tournament.umpires.get('b');
		await db.matches.update_async({ _id: 'one' }, { $set: { 'setup.umpire': { _id: 'b' } } }, {});
		assert.strictEqual(a.matches.size, 0);
		assert.strictEqual(b.matches.size, 1);
		await db.matches.update_async({ _id: 'one' }, old, {});
		assert.strictEqual(a.matches.size, 1);
		assert.strictEqual(b.matches.size, 0);
		db.model._reset('matches', db.matches.getAllData());
		assert.strictEqual(tournament.matches.get('one').umpire, a);
		assert.strictEqual(a.assignments.size, 1);
		const record = a.data;
		await db.umpires.remove_async({ _id: 'a' }, {});
		assert.strictEqual(a.present, false);
		assert.strictEqual(tournament.matches.get('one').umpire, a);
		await insert(db.umpires, record);
		assert.strictEqual(tournament.umpires.get('a'), a);
		assert.strictEqual(a.assignments.size, 1);
	});

	it('isolates assignment reads when a match moves to another tournament', async function() {
		const { db, tournament } = await fixture();
		await db.matches.update_async({ _id: 'one' }, { $set: { 'setup.umpire': { _id: 'a' } } }, {});
		const official = tournament.matches.get('one').umpire;
		await db.matches.update_async({ _id: 'one' }, { $set: { tournament_key: 'other' } }, {});
		const { promisify } = require('util');
		assert.deepStrictEqual(await promisify(db.model.read_official_assignments)('test', 'a'), []);
		assert.strictEqual((await promisify(db.model.read_official_assignments)('other', 'a')).length, 1);
		assert.strictEqual(db.model.tournament('other').matches.get('one').umpire, official);
	});
});
