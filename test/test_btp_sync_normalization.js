'use strict';

const assert = require('assert');
const { promisify } = require('util');
const { _describe, _it } = require('./tutils');
const database = require('../bts/database');
const btp_sync = require('../bts/btp_sync');
const btp_manager = require('../bts/btp_manager');
const admin = require('../bts/admin');

async function fixture() {
	const db = await database.init_test();
	for (const collection of ['tournaments', 'matches', 'umpires']) {
		db[collection].insert_async = promisify(db[collection].insert.bind(db[collection]));
	}
	const app = { db, wss: { clients: [] } };
	await db.tournaments.insert_async({
		key: 't1', last_reset_ts: 1,
		btp_settings: { check_in_per_match: false, pause_duration_ms: 2000 },
		events: [{ entries: [{ name: 'Large registration payload' }] }],
	});
	const official = { _id: 'o1', btp_id: 11, name: 'Test Official', firstname: 'Test', surname: 'Official', country: 'DE' };
	await db.umpires.insert_async({
		...official, tournament_key: 't1', is_umpire: true, is_service_judge: false,
		is_planed_as_umpire: true, is_planed_as_service_judge: false,
		umpire_on_court: null, service_judge_on_court: null,
		umpire_wait: null, service_judge_wait: null,
		umpire_pause: null, service_judge_pause: null, inactive_list: null, checked_in: true,
	});
	await db.matches.insert_async([
		{
			_id: 'finished', tournament_key: 't1', end_ts: 1000, team1_won: true,
			setup: { teams: [{ players: [{ btp_id: 101, last_time_on_court_ts: 1000 }] }] },
		},
		{
			_id: 'next', btp_id: 't1_HE_1', tournament_key: 't1', presses: [{ timestamp: 99 }],
			setup: {
				state: 'scheduled', now_on_court: false, umpire: official,
				warmup_duration: 12345, called_timestamp: null,
				teams: [{ players: [{ btp_id: 101, name: 'Player', last_time_on_court_ts: 1000, checked_in: false }] }],
			},
		},
	]);
	return app;
}

_describe('BTP sync normalization', () => {
	_it('skips unchanged state and score-only updates without reading match snapshots', async () => {
		const app = await fixture();
		assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: false, changed: false });
		const original_find = app.db.matches.find_async.bind(app.db.matches);
		let reads = 0;
		app.db.matches.find_async = async (...args) => {
			reads++;
			const matches = await original_find(...args);
			assert(matches.every(match => match.presses === undefined));
			return matches;
		};
		await app.db.matches.update_async({ _id: 'next' }, { $push: { presses: { timestamp: 100 } }, $set: { network_score: [[1, 0]] } }, {});
		const original_update = app.db.matches.update;
		const original_official_update = app.db.umpires.update;
		app.db.matches.update = app.db.umpires.update = () => assert.fail('unchanged sync must not write');
		try {
			assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: true });
			assert.strictEqual(reads, 0);
		} finally {
			app.db.matches.update = original_update;
			app.db.umpires.update = original_official_update;
		}
	});

	_it('propagates a locally finished game to player pauses and retains the full setup in storage and notifications', async () => {
		const app = await fixture();
		await btp_sync._normalize_sync_state(app, 't1');
		await app.db.matches.update_async({ _id: 'finished' }, { $set: { end_ts: 2000 } }, {});
		const notifications = [];
		const original_notify = admin.notify_change;
		admin.notify_change = (app, key, type, value) => notifications.push({ type, value });
		try {
			assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: false, changed: true });
		} finally {
			admin.notify_change = original_notify;
		}
		const next = await app.db.matches.findOne_async({ _id: 'next' });
		assert.strictEqual(next.setup.teams[0].players[0].last_time_on_court_ts, 2000);
		assert.strictEqual(next.setup.warmup_duration, 12345);
		assert.deepStrictEqual(next.presses, [{ timestamp: 99 }]);
		const notification = notifications.find(item => item.type === 'update_player_status' && item.value.match__id === 'next');
		assert.deepStrictEqual(notification.value.setup, next.setup);
		assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: true });
	});

	_it('sees local court changes and officials added by reconciliation before normalizing visibility', async () => {
		const app = await fixture();
		await btp_sync._normalize_sync_state(app, 't1');
		await app.db.matches.update_async({ _id: 'next' }, { $set: {
			'setup.now_on_court': true, 'setup.court_id': 'court-1',
			'setup.service_judge': { _id: 'new-official', btp_id: 12, name: 'New Official' },
		} }, {});
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, false);
		const umpire = await app.db.umpires.findOne_async({ _id: 'o1' });
		const judge = await app.db.umpires.findOne_async({ _id: 'new-official' });
		assert.strictEqual(umpire.umpire_on_court, 'court-1');
		assert.strictEqual(umpire.is_planed_as_umpire, false);
		assert.strictEqual(judge.service_judge_on_court, 'court-1');
		assert.strictEqual(judge.service_judge_wait, null);
		assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: true });
	});

	_it('invalidates the cache for local official changes, settings, and tournament resets', async () => {
		const app = await fixture();
		await btp_sync._normalize_sync_state(app, 't1');
		await app.db.umpires.update_async({ _id: 'o1' }, { $set: { umpire_manual_pause: 123 } }, {});
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, false);
		assert.strictEqual((await app.db.umpires.findOne_async({ _id: 'o1' })).checked_in, false);
		await app.db.tournaments.update_async({ key: 't1' }, { $set: { 'btp_settings.check_in_per_match': true } }, {});
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, false);
		await app.db.tournaments.update_async({ key: 't1' }, { $set: { last_reset_ts: 2 } }, {});
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, false);
		assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: true });
	});

	_it('retries failed writes and waits for write callbacks before caching the resulting state', async () => {
		const app = await fixture();
		await btp_sync._normalize_sync_state(app, 't1');
		await app.db.matches.update_async({ _id: 'finished' }, { $set: { end_ts: 2000 } }, {});
		const original_update = app.db.matches.update.bind(app.db.matches);
		const expected = new Error('database write failed');
		app.db.matches.update = (query, update, options, cb) => cb(expected);
		await assert.rejects(btp_sync._normalize_sync_state(app, 't1'), error => error === expected);
		let finish_write;
		const started = new Promise(resolve => {
			app.db.matches.update = (...args) => {
				app.db.matches.update = original_update;
				finish_write = () => original_update(...args);
				resolve();
			};
		});
		let completed = false;
		const retry = btp_sync._normalize_sync_state(app, 't1').then(result => { completed = true; return result; });
		await started;
		assert.strictEqual(completed, false);
		finish_write();
		assert.strictEqual((await retry).changed, true);
		assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: true });
	});

	_it('keeps caches separate for applications and tournaments', async () => {
		const app = await fixture();
		await btp_sync._normalize_sync_state(app, 't1');
		assert.strictEqual((await btp_sync._normalize_sync_state({ ...app }, 't1')).skipped, false);
		await app.db.tournaments.insert_async({ key: 't2', btp_settings: { check_in_per_match: false } });
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't2')).skipped, false);
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't2')).skipped, true);
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, true);
	});

	_it('does not cache a concurrent change as if the normalizers had processed it', async () => {
		const app = await fixture();
		await btp_sync._normalize_sync_state(app, 't1');
		await app.db.matches.update_async({ _id: 'finished' }, { $set: { end_ts: 2000 } }, {});
		const update = app.db.matches.update.bind(app.db.matches);
		let finish_write;
		const started = new Promise(resolve => {
			app.db.matches.update = (...args) => {
				app.db.matches.update = update;
				finish_write = () => update(...args);
				resolve();
			};
		});
		const first = btp_sync._normalize_sync_state(app, 't1');
		await started;
		await app.db.matches.update_async({ _id: 'finished' }, { $set: { end_ts: 3000 } }, {});
		finish_write();
		assert.strictEqual((await first).changed, true);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'next' })).setup.teams[0].players[0].last_time_on_court_ts, 2000);
		assert.deepStrictEqual(await btp_sync._normalize_sync_state(app, 't1'), { skipped: false, changed: true });
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'next' })).setup.teams[0].players[0].last_time_on_court_ts, 3000);
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, true);
	});

	_it('retains hash-based normalization for datastores without the object fingerprint reader', async () => {
		const app = await fixture();
		delete app.db.model.normalization_state;
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, false);
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, true);
		await app.db.matches.update_async({ _id: 'finished' }, { $set: { end_ts: 2000 } }, {});
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).changed, true);
		assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, true);
	});

	_it('still checks pause expiry as time advances while normalization state is unchanged', async () => {
		const app = await fixture();
		let now = 2000;
		app.clock = { now_ms: () => now };
		await btp_sync._normalize_sync_state(app, 't1');
		const state = {
			draws: new Map([[10, { EventID: [20], Name: ['HE'] }]]),
			events: new Map([[20, { Name: ['HE'] }]]),
			matches: [{ ID: [1], DrawID: [10], bts_players: [[{ ID: [101], CheckedIn: [false] }]] }],
		};
		const updates = [];
		const original_update_players = btp_manager.update_players;
		btp_manager.update_players = (app, key, players) => updates.push(players);
		const integrate = () => new Promise((resolve, reject) => btp_sync._integrate_player_state(app, 't1', state, err => err ? reject(err) : resolve()));
		try {
			await integrate();
			assert.strictEqual(updates[0].length, 0);
			now = 4000;
			assert.strictEqual((await btp_sync._normalize_sync_state(app, 't1')).skipped, true);
			await integrate();
			assert.deepStrictEqual(updates[1].map(player => player.btp_id), [101]);
			assert.strictEqual(state.matches[0].bts_players[0][0].CheckedIn[0], true);
		} finally {
			btp_manager.update_players = original_update_players;
		}
	});
});
