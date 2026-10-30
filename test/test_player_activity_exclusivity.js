'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const match_utils = require('../bts/match_utils');
const reconciliation = require('../bts/match_reconciliation/run');
const reactivate = require('../bts/match_reactivation');

const call = (object, method, ...args) => promisify(object[method].bind(object))(...args);
async function fixture() {
	const db = await database.init_test();
	await call(db.tournaments, 'insert', { key: 'activity', tabletoperator_enabled: true, btp_enabled: false });
	const matches = [
		{ _id: 'playing', tournament_key: 'activity', setup: { now_on_court: true, court_id: 'court_10',
			teams: [{ players: [{ btp_id: 1 }, { btp_id: 2 }] }], tabletoperators: [{ btp_id: 3 }] } },
		{ _id: 'future', tournament_key: 'activity', setup: { state: 'blocked', teams: [{ players: [
			{ btp_id: 1, now_playing_on_court: 'court_10', now_tablet_on_court: 'old' },
			{ btp_id: 3, now_playing_on_court: 'old', now_tablet_on_court: 'court_10' },
		] }] }, presses: [{ type: 'point', team: 0 }] },
	];
	await call(db.matches, 'insert', matches);
	await call(db.tabletoperators, 'insert', [
		{ _id: 'playing-queue', tournament_key: 'activity', court: null, match_id: 'playing',
			played_on_court: 'court_10', source_match_end_ts: 123, start_ts: 123, tabletoperator: [{ btp_id: 1 }, { btp_id: 2 }] },
		{ _id: 'tablet-queue', tournament_key: 'activity', court: null, start_ts: 124, tabletoperator: [{ btp_id: 3 }] },
		{ _id: 'mixed-queue', tournament_key: 'activity', court: null, start_ts: 125, tabletoperator: [{ btp_id: 1 }, { btp_id: 4 }] },
		{ _id: 'free-queue', tournament_key: 'activity', court: null, start_ts: 126, tabletoperator: [{ btp_id: 5 }] },
		{ _id: 'anonymous-queue', tournament_key: 'activity', court: null, start_ts: 127, tabletoperator: [{ btp_id: -1, name: 'Guest' }] },
		{ _id: 'assigned', tournament_key: 'activity', court: 'court_10', start_ts: 100, tabletoperator: [{ btp_id: 3 }] },
	]);
	return { db, clock: { now_ms: () => 1000 } };
}

describe('Exclusive player activity', function() {
	it('repairs waiting entries for current players and tablet operators, retaining idle partners and history', async function() {
		const app = await fixture();
		await reconciliation.run(app, 'activity');
		for (const id of ['playing-queue', 'tablet-queue']) {
			const row = await app.db.tabletoperators.findOne_async({ _id: id });
			assert.strictEqual(row.court, -1);
			assert.strictEqual(row.end_ts, 1000);
		}
		const source = await app.db.tabletoperators.findOne_async({ _id: 'playing-queue' });
		assert.strictEqual(source.played_on_court, 'court_10');
		assert.strictEqual(source.source_match_end_ts, 123);
		const mixed = await app.db.tabletoperators.findOne_async({ _id: 'mixed-queue' });
		assert.deepStrictEqual(mixed.tabletoperator.map(person => person.btp_id), [4]);
		assert.strictEqual(mixed.court, null);
		for (const id of ['free-queue', 'anonymous-queue']) assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: id })).court, null);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'assigned' })).court, 'court_10');
		const before = await app.db.matches.findOne_async({ _id: 'future' });
		assert.strictEqual(before.setup.teams[0].players[0].now_tablet_on_court, false);
		assert.strictEqual(before.setup.teams[0].players[1].now_playing_on_court, false);
		assert.deepStrictEqual(before.presses, [{ type: 'point', team: 0 }]);
		let writes = 0;
		for (const store of [app.db.matches, app.db.tabletoperators]) {
			const update = store.update.bind(store);
			store.update = (...args) => { writes++; return update(...args); };
		}
		await reconciliation.run(app, 'activity');
		assert.strictEqual(writes, 0, 'unchanged reconciliation must not write again');
	});

	for (const tablet of [false, true]) {
		it('clears the other activity and consumes duplicate waiting entries before completing a ' + (tablet ? 'tablet' : 'playing') + ' assignment', async function() {
			const app = await fixture();
			await app.db.matches.update_async({ _id: 'future' }, { $set: { 'setup.now_on_court': false } }, {});
			const setup = { court_id: 'court_11', teams: [{ players: [{ btp_id: 1 }] }], tabletoperators: [{ btp_id: 1 }] };
			await new Promise((resolve, reject) => match_utils[tablet ? 'set_player_on_tablet' : 'set_player_on_court'](app, 'activity', setup,
				error => error ? reject(error) : resolve()));
			const player = (await app.db.matches.findOne_async({ _id: 'future' })).setup.teams[0].players[0];
			assert.strictEqual(player[tablet ? 'now_tablet_on_court' : 'now_playing_on_court'], 'court_11');
			assert.strictEqual(player[tablet ? 'now_playing_on_court' : 'now_tablet_on_court'], false);
			const queue = await app.db.tabletoperators.find_async({ tournament_key: 'activity', court: null });
			assert(!queue.some(entry => entry.tabletoperator.some(person => person.btp_id === 1)));
		});
	}

	it('removes the old finish waitlist before a finished match is reactivated', async function() {
		const app = await fixture();
		await app.db.matches.update_async({ _id: 'playing' }, { $set: { team1_won: true, btp_winner: 1, 'setup.now_on_court': false } }, {});
		const match = await app.db.matches.findOne_async({ _id: 'playing' });
		await new Promise((resolve, reject) => reactivate(app, { key: 'activity' }, match, error => error ? reject(error) : resolve()));
		const queue = await app.db.tabletoperators.find_async({ tournament_key: 'activity', court: null });
		assert(!queue.some(entry => entry.tabletoperator.some(person => person.btp_id === 1 || person.btp_id === 2)));
	});

	it('never selects a busy player or tablet operator from an obsolete queue entry', async function() {
		const app = await fixture();
		const selected = await match_utils.fetch_tabletoperator(require('../bts/admin'), app, { key: 'activity', tabletoperator_assignment_scope: 'any' }, 'court_12', 'next');
		assert.deepStrictEqual(selected.map(person => person.btp_id), [4]);
	});

	for (const btp_id of [1, 3]) {
		it('rejects manually adding an active ' + (btp_id === 1 ? 'player' : 'tablet operator') + ' to the queue', async function() {
			const app = await fixture(), before = await app.db.tabletoperators.find_async({ tournament_key: 'activity' });
			await assert.rejects(new Promise((resolve, reject) => require('../bts/admin').handle_tabletoperator_add(app,
				{ respond: (_message, error) => error ? reject(error) : resolve() },
				{ tournament_key: 'activity', match: { setup: { teams: [{ players: [{ btp_id }] }] } }, team_id: 0 })), /already playing or operating/);
			assert.deepStrictEqual(await app.db.tabletoperators.find_async({ tournament_key: 'activity' }), before);
		});
	}

	it('rejects a second active role, allows moving the same match and ignores anonymous participants', async function() {
		const app = await fixture(), activity = require('../bts/match_reconciliation/tablet_queue');
		const proposed = { _id: 'another', setup: { teams: [{ players: [{ btp_id: 1 }] }] } };
		await assert.rejects(activity.validate_match(app, 'activity', proposed), /already playing or operating/);
		proposed.setup.teams[0].players = [{ btp_id: 4 }];
		proposed.setup.tabletoperators = [{ btp_id: 3 }];
		await assert.rejects(activity.validate_match(app, 'activity', proposed), /already playing or operating/);
		proposed.setup.tabletoperators = [{ btp_id: 4 }];
		await assert.rejects(activity.validate_match(app, 'activity', proposed), /cannot play and operate/);
		await activity.validate_match(app, 'activity', await app.db.matches.findOne_async({ _id: 'playing' }));
		proposed.setup.teams[0].players = [{ btp_id: -1, name: 'Guest A' }];
		proposed.setup.tabletoperators = [{ btp_id: -1, name: 'Guest B' }];
		await activity.validate_match(app, 'activity', proposed);
	});
});
