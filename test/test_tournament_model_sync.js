'use strict';

const assert = require('assert');
const { promisify } = require('util');
const planner = require('../bts/btp_sync_plan');
const match_utils = require('../bts/match_utils');
const model = require('../bts/tournament_model');
const { fixture, insert, match } = require('./tournament_model_fixture');

describe('tournament object indexes in sync and assignment flows', function() {
	it('captures immutable dependency revisions and keeps point writes on the same index revision', async function() {
		const { db, tournament } = await fixture();
		const before = await planner._snapshot(db, 'test');
		const relations = before.relations;
		await db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[2, 1]] } }, {});
		assert.strictEqual(tournament.relations, relations);
		await db.matches.update_async({ _id: 'one' }, { $set: {
			'setup.teams.0.players': [{ btp_id: 3 }], 'setup.court_id': 'second',
		} }, {});
		assert.notStrictEqual(tournament.relations, relations);
		assert.deepStrictEqual([...relations.for_player(1)], ['one', 'two']);
		assert.deepStrictEqual([...relations.for_court('court')], ['one']);
		assert.deepStrictEqual([...tournament.relations.for_player(1)], ['two']);
		assert.deepStrictEqual(before.matches.find(game => game._id === 'one').network_score, [[0, 0]]);
	});

	it('plans affected locks from the captured index without scanning all matches', async function() {
		const { db, tournament } = await fixture();
		await insert(db.matches, match('unrelated', [4], 'test', 'third'));
		const before = await planner._snapshot(db, 'test');
		const old = before.matches.find(game => game._id === 'one');
		const next = { ...old, setup: { ...old.setup, state: 'blocked' } };
		const changes = [{ collection: 'matches', id: 'one', before: old, after: next }];
		const expected = planner._resources('test', { ...before }, changes, []);
		await db.matches.update_async({ _id: 'two' }, { $set: { 'setup.teams.0.players': [{ btp_id: 5 }] } }, {});
		assert.deepStrictEqual([...tournament.relations.for_player(1)], ['one']);
		before.matches[Symbol.iterator] = () => { throw new Error('all-match scan'); };
		const scope = planner._resources('test', before, changes, []);
		assert.deepStrictEqual(scope, expected);
		assert.deepStrictEqual([...scope.locked_matches], ['one', 'two']);
	});

	it('matches conservative scan-based locks for metadata, courts, tablet operators and captured effects', async function() {
		const { db } = await fixture();
		await insert(db.matches, [match('three', [4], 'test', 'second'), match('four', [-1], 'test', null)]);
		const before = await planner._snapshot(db, 'test');
		const changes = [
			{ collection: 'courts', id: 'second', before: { match_id: 'two' }, after: { match_id: 'three' } },
			{ collection: 'tabletoperators', id: 'tablet', after: { court: 'court', tabletoperator: [{ btp_id: 4 }] } },
			{ collection: 'matches', id: 'four', before: before.matches.find(game => game._id === 'four'), after: match('four', [2]) },
		];
		const effects = [{ resources: { players: [1], courts: ['second'], matches: ['one'] } }];
		assert.deepStrictEqual(planner._resources('test', before, changes, effects),
			planner._resources('test', { ...before }, changes, effects));
	});

	it('reads snapshots and related matches through the executor without database scans and returns isolated mutable copies', async function() {
		const { db, tournament } = await fixture();
		const pending = db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.btp_id': 8 } }, {});
		const find = promisify(db.model.find_matches_by_players);
		const snapshot = planner._snapshot(db, 'test');
		const found = find('test', [8]);
		await pending;
		assert.strictEqual((await snapshot).matches.find(game => game._id === 'one').setup.teams[0].players[0].btp_id, 8);
		const docs = await found;
		assert.deepStrictEqual(docs.map(doc => doc._id), ['one']);
		docs[0].setup.teams[0].players[0].checked_in = true;
		assert.strictEqual(tournament.matches.get('one').participations.get('team:0:0').data.checked_in, false);
		const get_all = db.matches.getAllData;
		db.matches.getAllData = () => { throw new Error('database scan'); };
		try {
			assert.strictEqual((await planner._snapshot(db, 'test')).matches.length, 2);
			assert.deepStrictEqual((await find('test', [1])).map(doc => doc._id), ['two']);
		} finally { db.matches.getAllData = get_all; }
		assert.strictEqual(model.attach(db), db.model);
	});

	it('updates only related player court flags using the real assignment helper', async function() {
		const { db, tournament } = await fixture();
		await insert(db.matches, match('unrelated', [9], 'test', 'third'));
		const original_find = db.matches.find;
		db.matches.find = () => { throw new Error('assignment scanned all matches'); };
		try {
			await promisify(match_utils.set_player_on_court)({ db, wss: { clients: [] } }, 'test', {
				_id: 'one', setup: { court_id: 'court', teams: [{ players: [{ btp_id: 1 }] }] },
			});
		} finally { db.matches.find = original_find; }
		assert.strictEqual(tournament.matches.get('two').data.setup.state, 'blocked');
		assert.strictEqual(tournament.matches.get('two').participations.get('team:0:0').data.now_playing_on_court, 'court');
		assert.strictEqual(tournament.matches.get('one').data.setup.state, 'ready');
		assert.strictEqual(tournament.matches.get('unrelated').data.setup.state, 'ready');
	});

	it('keeps canonical references current through a planned integration and its rollback', async function() {
		const { db, tournament } = await fixture();
		const one = tournament.matches.get('one');
		const player = tournament.players.get('1');
		const app = { db, wss: { clients: [] } };
		const integrate = async staged => {
			await staged.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.name': 'Renamed' } }, {});
			await staged.db.matches.update_async({ _id: 'two' }, { $set: { 'setup.state': 'blocked' } }, {});
			return true;
		};
		const update = db.matches.update_async;
		db.matches.update_async = async (...args) => {
			if (args[0]._id === 'two') throw new Error('simulated failure');
			return update(...args);
		};
		try { await assert.rejects(planner.sync(app, 'test', {}, { expected_reset_ts: 1 }, integrate), /simulated failure/); }
		finally { db.matches.update_async = update; }
		assert.strictEqual(tournament.matches.get('one'), one);
		assert.strictEqual(one.participations.get('team:0:0').player, player);
		assert.strictEqual(player.data.name, 'Player 1');
		await planner.sync(app, 'test', {}, { expected_reset_ts: 1 }, integrate);
		assert.strictEqual(player.data.name, 'Renamed');
		assert.strictEqual(tournament.matches.get('two').data.setup.state, 'blocked');
	});
});
