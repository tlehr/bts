'use strict';

const assert = require('assert');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Datastore = require('nedb');
const model = require('../bts/tournament_model');
const { fixture, insert, match, registration } = require('./tournament_model_fixture');

describe('canonical tournament objects', function() {
	it('shares players and direct references while retaining identities through persisted changes', async function() {
		const { db, tournament } = await fixture();
		const one = tournament.matches.get('one');
		const two = tournament.matches.get('two');
		const player = tournament.players.get('1');
		const participation = one.participations.get('team:0:0');
		const court = tournament.courts.get('court');
		assert.strictEqual(two.participations.get('team:0:0').player, player);
		assert.strictEqual(participation.player, player);
		assert.strictEqual(one.court, court);
		assert.strictEqual(court.match, one);
		assert.strictEqual(court.location, tournament.locations.get('hall'));
		assert.deepStrictEqual([...player.matches], [one, two]);
		await db.matches.update_async({ _id: 'one' }, { $set: {
			network_score: [[4, 2]], 'setup.teams.0.players.0.name': 'Updated',
			'setup.teams.0.players.0.checked_in': true,
		} }, {});
		assert.strictEqual(tournament.matches.get('one'), one);
		assert.strictEqual(one.participations.get('team:0:0'), participation);
		assert.strictEqual(tournament.players.get('1'), player);
		assert.strictEqual(participation.data.checked_in, true);
		assert.strictEqual(two.participations.get('team:0:0').data.checked_in, false);
		assert.strictEqual(player.data.checked_in, undefined);
		assert.strictEqual(player.data.name, 'Updated');
		assert.strictEqual(two.participations.get('team:0:0').toJSON().name, 'Updated');
		assert.deepStrictEqual(one.data.network_score, [[4, 2]]);
		assert.doesNotThrow(() => JSON.stringify(one));
	});

	it('updates backlinks on player swaps, court moves and tablet operator changes', async function() {
		const { db, tournament } = await fixture();
		const one = tournament.matches.get('one');
		const player = tournament.players.get('1');
		const participation = one.participations.get('team:0:0');
		await db.matches.update_async({ _id: 'one' }, { $set: {
			'setup.teams.0.players': [{ btp_id: 3, name: 'Three' }], 'setup.court_id': 'second',
			'setup.tabletoperators': [{ btp_id: 2, checked_in: false }],
		} }, {});
		assert.strictEqual(one.participations.get('team:0:0'), participation);
		assert.strictEqual(participation.player, tournament.players.get('3'));
		assert.strictEqual(participation.player.data.name, 'Three');
		assert.strictEqual(player.matches.has(one), false);
		assert.strictEqual(player.participations.has(participation), false);
		assert.strictEqual(tournament.courts.get('court').matches.has(one), false);
		assert.strictEqual(one.court.matches.has(one), true);
		assert.strictEqual(one.participations.get('tablet:0').player, tournament.players.get('2'));
		assert.deepStrictEqual([...tournament.relations.for_player(3)], ['one']);
		assert.deepStrictEqual([...tournament.relations.for_player(1)], ['two']);
	});

	it('includes registered players without games and does not revert profiles with unchanged copies', async function() {
		const { db, tournament } = await fixture();
		const events = registration([{ btp_id: 1, name: 'Registered' }, { btp_id: 9, name: 'Nine' }]);
		await db.tournaments.update_async({ key: 'test' }, { $set: { events } }, {});
		assert.strictEqual(tournament.players.get('9').data.name, 'Nine');
		assert.strictEqual(tournament.players.get('9').matches.size, 0);
		await db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.name': 'Renamed' } }, {});
		await db.matches.update_async({ _id: 'two' }, { $set: { network_score: [[1, 0]] } }, {});
		await db.tournaments.update_async({ key: 'test' }, { $set: { title: 'Title' } }, {});
		await insert(db.matches, match('third'));
		assert.strictEqual(tournament.players.get('1').data.name, 'Renamed');
		await db.tournaments.update_async({ key: 'test' }, { $set: { events: registration([{ btp_id: 1, name: 'BTP change' }]) } }, {});
		assert.strictEqual(tournament.players.get('1').data.name, 'BTP change');
		assert.deepStrictEqual(tournament.players.get('9').data, {});
	});

	it('keeps tournament identities and anonymous players separate', async function() {
		const { db, tournament } = await fixture();
		await insert(db.matches, [match('other', [1], 'other'), match('unknown-one', [-1]), match('unknown-two', [-1])]);
		assert.notStrictEqual(tournament.players.get('1'), db.model.tournament('other').players.get('1'));
		const unknown = id => tournament.matches.get(id).participations.get('team:0:0').player;
		assert.notStrictEqual(unknown('unknown-one'), unknown('unknown-two'));
		await db.matches.update_async({ _id: 'one' }, { $set: { tournament_key: 'other' } }, {});
		assert.strictEqual(tournament.matches.has('one'), false);
		assert.strictEqual(tournament.players.get('1').matches.size, 1);
		assert.strictEqual(db.model.tournament('other').players.get('1').matches.size, 2);
	});

	it('preserves placeholders and deletion identity when referenced records arrive or return', async function() {
		const { db, tournament } = await fixture();
		const one = tournament.matches.get('one');
		const placeholder = tournament.matches.get('two').court;
		assert.strictEqual(placeholder.present, false);
		await insert(db.courts, { _id: 'second', tournament_key: 'test', name: 'Second' });
		assert.strictEqual(tournament.courts.get('second'), placeholder);
		await db.matches.remove_async({ _id: 'one' }, {});
		assert.strictEqual(one.present, false);
		assert.strictEqual(tournament.courts.get('court').match, one);
		assert.strictEqual(tournament.players.get('1').matches.has(one), false);
		await insert(db.matches, match('one'));
		assert.strictEqual(tournament.matches.get('one'), one);
		assert.strictEqual(one.present, true);
	});

	it('reflects upserts and multi-updates and undoes failed batch inserts and updates', async function() {
		const { db, tournament } = await fixture();
		await db.matches.update_async({ _id: 'upserted' }, match('upserted', [8]), { upsert: true });
		assert.strictEqual(tournament.players.get('8').matches.size, 1);
		await db.matches.update_async({ tournament_key: 'test' }, { $set: { 'setup.state': 'blocked' } }, { multi: true });
		assert([...tournament.matches.values()].every(game => game.data.setup.state === 'blocked'));
		await promisify(db.matches.ensureIndex.bind(db.matches))({ fieldName: 'unique', unique: true, sparse: true });
		await db.matches.update_async({ _id: 'one' }, { $set: { unique: 'existing' } }, {});
		await assert.rejects(insert(db.matches, [match('temporary', [77]), { ...match('conflict'), unique: 'existing' }]), /unique constraint/);
		assert.strictEqual(tournament.matches.has('temporary'), false);
		assert.strictEqual(tournament.players.get('77').matches.size, 0);
		assert.deepStrictEqual(tournament.players.get('77').data, {});
		await assert.rejects(db.matches.update_async({}, { $set: { unique: 'duplicate' } }, { multi: true }), /unique constraint/);
		assert.strictEqual(tournament.matches.get('one').data.unique, 'existing');
		assert.strictEqual(tournament.matches.get('two').data.unique, undefined);
	});

	it('rebuilds relationships on a file-backed NeDB reload without replacing live objects', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-model-'));
		try {
			const store = new Datastore({ filename: path.join(directory, 'matches') });
			const db = { matches: store };
			model.attach(db);
			await promisify(store.loadDatabase.bind(store))();
			await insert(store, match('persisted'));
			const game = db.model.tournament('test').matches.get('persisted');
			await promisify(store.loadDatabase.bind(store))();
			assert.strictEqual(db.model.tournament('test').matches.get('persisted'), game);
			assert.strictEqual(game.present, true);
			assert.strictEqual([...game.players][0].matches.has(game), true);
		} finally { fs.rmSync(directory, { recursive: true, force: true }); }
	});

	it('detaches registrations and games on a tournament reset and reuses objects for the next import', async function() {
		const { db, tournament } = await fixture();
		const player = tournament.players.get('1');
		const one = tournament.matches.get('one');
		await db.tournaments.update_async({ key: 'test' }, { $set: {
			events: registration([{ btp_id: 1, name: 'Before reset' }]),
		} }, {});
		await db.matches.remove_async({ tournament_key: 'test' }, { multi: true });
		await db.tournaments.remove_async({ key: 'test' }, {});
		assert.strictEqual(tournament.present, false);
		assert.strictEqual(tournament.matches.size, 0);
		assert.strictEqual(player.matches.size, 0);
		assert.strictEqual(player.participations.size, 0);
		assert.deepStrictEqual(player.data, {});
		assert.deepStrictEqual([...tournament.relations.for_player(1)], []);
		await insert(db.tournaments, { _id: 'new-tournament', key: 'test', last_reset_ts: 2 });
		await insert(db.matches, match('one'));
		assert.strictEqual(db.model.tournament('test'), tournament);
		assert.strictEqual(tournament.matches.get('one'), one);
		assert.strictEqual(one.participations.get('team:0:0').player, player);
		assert.strictEqual(player.data.name, 'Player 1');
	});
});
