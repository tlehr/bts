'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const { reset } = require('../bts/court_assignments_reset');
const queue = require('../bts/update_queue');
const manager = require('../bts/btp_manager');

function insert(store, document) {
	return promisify(store.insert.bind(store))(document);
}

describe('clearing planned court assignments', function() {
	let app;
	let original_clear;
	beforeEach(async function() {
		original_clear = manager.clear_court_assignments;
		manager.clear_court_assignments = async (_key, matches) => ({
			allowed_match_ids: matches.map(match => match._id), btp_changed_matches: 0, skipped_matches: 0,
		});
		app = { db: await database.init_test(), clock: { now_ms: () => 987654321 } };
		await insert(app.db.tournaments, { key: 'target', btp_enabled: true, btp_autofetch_enabled: true });
	});
	afterEach(function() { manager.clear_court_assignments = original_clear; });

	it('clears pending matches while preserving preparation, halls, scores and participant flags', async function() {
		const matches = [];
		for (const state of ['scheduled', 'incomplete', 'preparation', 'blocked']) {
			matches.push(await insert(app.db.matches, {
				_id: state, tournament_key: 'target', presses: [], network_score: [[0, 0]],
				match_order: 42,
				setup: { state, court_id: 'c1', location_id: 'hall1', highlight: 2, now_on_court: false,
					preparation_call_timestamp: 77, teams: [{ players: [{ btp_id: 1, checked_in: true,
						now_playing_on_court: 'active_court', last_time_on_court_ts: 42 }] }],
					umpire: { _id: 'u1', status: 'ready', is_planed_as_umpire: true },
					tabletoperators: [{ btp_id: 2, now_tablet_on_court: 'active_court' }] },
			}));
		}
		await insert(app.db.courts, { _id: 'c1', tournament_key: 'target', num: 1, location_id: 'hall1', match_id: 'scheduled', is_active: true });
		let event;
		const result = await reset(app, 'target', value => { event = value; });
		assert.deepStrictEqual(result, { tournament_key: 'target', changed_matches: 4, reset_ts: 987654321,
			btp_changed_matches: 0, skipped_matches: 0 });
		for (const before of matches) {
			const after = await app.db.matches.findOne_async({ _id: before._id });
			assert.deepStrictEqual(after, { ...before, setup: { ...before.setup, court_id: null } });
		}
		assert.deepStrictEqual(await app.db.courts.findOne_async({ _id: 'c1' }),
			{ _id: 'c1', tournament_key: 'target', num: 1, location_id: 'hall1', match_id: null, is_active: true });
		assert.strictEqual(event.matches.length, 4);
		assert.strictEqual(event.courts[0].match_id, null);
		const tournament = await app.db.tournaments.findOne_async({ key: 'target' });
		assert.strictEqual(tournament.btp_enabled, true);
		assert.strictEqual(tournament.btp_autofetch_enabled, true);
		const before = await app.db.matches.find_async({ tournament_key: 'target' });
		assert.strictEqual((await reset(app, 'target')).changed_matches, 0);
		assert.deepStrictEqual(await app.db.matches.find_async({ tournament_key: 'target' }), before);
	});

	it('preserves running and finished games, including inconsistent legacy status flags', async function() {
		const variants = [
			{ setup: { state: 'oncourt', now_on_court: true } },
			{ setup: { state: 'blocked', now_on_court: true } },
			{ setup: { state: 'oncourt', now_on_court: false } },
			{ setup: { state: 'finished' } },
			{ setup: { state: 'scheduled' }, team1_won: false },
			{ setup: { state: 'scheduled' }, team1_won: true },
			{ setup: { state: 'scheduled' }, btp_winner: 2 },
			{ setup: { state: 'scheduled' }, btp_needsync: true },
			{ setup: { state: 'scheduled' }, score_status: 'no_match' },
			{ setup: { state: 'scheduled' }, score_status: 'retired' },
			{ setup: { state: 'scheduled' }, score_status: 'walkover' },
			{ setup: { state: 'scheduled' }, score_status: 'disqualified' },
			{ setup: { state: 'scheduled' }, end_ts: 123 },
			{ setup: { state: 'scheduled', end_ts: 123 } },
			{ setup: { state: 'scheduled' }, btp_score_status: 4 },
		];
		for (const [index, fields] of variants.entries()) {
			await insert(app.db.matches, { _id: 'm' + index, tournament_key: 'target', ...fields,
				setup: { ...fields.setup, court_id: 'c' + index }, presses: [['point', 1]], network_score: [[12, 8]] });
			await insert(app.db.courts, { _id: 'c' + index, tournament_key: 'target', match_id: 'm' + index });
		}
		await insert(app.db.umpires, { _id: 'u1', tournament_key: 'target', status: 'oncourt', court_id: 'c0' });
		await insert(app.db.tabletoperators, { _id: 't1', tournament_key: 'target', court: 'c0' });
		const before = {};
		for (const name of ['matches', 'courts', 'umpires', 'tabletoperators']) before[name] = await app.db[name].find_async({});
		assert.strictEqual((await reset(app, 'target')).changed_matches, 0);
		for (const name of Object.keys(before)) assert.deepStrictEqual(await app.db[name].find_async({}), before[name]);
	});

	it('leaves other tournaments, already unassigned games and device mappings untouched', async function() {
		const other = { _id: 'other_match', tournament_key: 'other', setup: { court_id: 'other_court' } };
		const court = { _id: 'other_court', tournament_key: 'other', match_id: 'other_match' };
		const device = { _id: 'device', tournament_key: 'target', court_id: 'c1', client_id: 'tablet' };
		await insert(app.db.matches, [other, { _id: 'empty', tournament_key: 'target', setup: {} },
			{ _id: 'null', tournament_key: 'target', setup: { court_id: null } }]);
		await insert(app.db.courts, court);
		await insert(app.db.display_court_displaysettings, device);
		const before = await app.db.matches.find_async({});
		await reset(app, 'target');
		assert.deepStrictEqual(await app.db.matches.find_async({}), before);
		assert.deepStrictEqual(await app.db.courts.findOne_async({ _id: court._id }), court);
		assert.deepStrictEqual(await app.db.display_court_displaysettings.findOne_async({ _id: device._id }), device);
	});

	it('rejects unknown tournaments before changing data', async function() {
		await insert(app.db.matches, { _id: 'orphan', tournament_key: 'missing', setup: { court_id: 'c1' } });
		await assert.rejects(reset(app, 'missing'), /No tournament missing/);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'orphan' })).setup.court_id, 'c1');
	});

	it('requires a writable BTP connection and preserves local fields when BTP fails', async function() {
		await insert(app.db.matches, { _id: 'm1', tournament_key: 'target', setup: { court_id: 'c1' } });
		for (const settings of [{ btp_enabled: false }, { btp_enabled: true, btp_readonly: true }]) {
			await app.db.tournaments.update_async({ key: 'target' }, { $set: settings }, {});
			await assert.rejects(reset(app, 'target'), /schreibend verbunden/);
		}
		await app.db.tournaments.update_async({ key: 'target' }, { $set: { btp_readonly: false } }, {});
		manager.clear_court_assignments = async () => { throw new Error('BTP transfer failed'); };
		await assert.rejects(reset(app, 'target'), /BTP transfer failed/);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'm1' })).setup.court_id, 'c1');
	});

	it('also sends locally unassigned matches and skips matches which BTP has already started', async function() {
		await insert(app.db.matches, [
			{ _id: 'stale', tournament_key: 'target', setup: { court_id: 'c1' } },
			{ _id: 'empty', tournament_key: 'target', setup: { court_id: null } },
		]);
		manager.clear_court_assignments = async (_key, matches) => {
			assert.deepStrictEqual(matches.map(match => match._id).sort(), ['empty', 'stale']);
			return { allowed_match_ids: ['empty'], btp_changed_matches: 1, skipped_matches: 1 };
		};
		const result = await reset(app, 'target');
		assert.strictEqual(result.btp_changed_matches, 1);
		assert.strictEqual(result.skipped_matches, 1);
		assert.strictEqual(result.changed_matches, 0);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'stale' })).setup.court_id, 'c1');
	});

	it('waits for in-flight match writes and preserves their new on-court state', async function() {
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const writing = queue.execute_locked([queue.lock_keys.match('target', 'm1')], async () => {
			await gate;
			await insert(app.db.matches, { _id: 'm1', tournament_key: 'target', setup: { court_id: 'c1', now_on_court: true } });
		});
		const resetting = reset(app, 'target');
		release();
		await writing;
		assert.strictEqual((await resetting).changed_matches, 0);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'm1' })).setup.court_id, 'c1');
	});
});
