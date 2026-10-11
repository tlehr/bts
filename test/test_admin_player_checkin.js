'use strict';

const assert = require('assert');
const { promisify } = require('util');
const admin = require('../bts/admin');
const database = require('../bts/database');
const update_queue = require('../bts/update_queue');

let next_fixture = 1;
async function fixture(state, checked_in = false, now_on_court = false) {
	const db = await database.init_test();
	const key = 'checkin-guard-' + next_fixture++;
	await promisify(db.tournaments.insert.bind(db.tournaments))({ key, btp_enabled: false });
	await promisify(db.matches.insert.bind(db.matches))({
		_id: 'match', tournament_key: key,
		setup: { state, now_on_court, counting: '3x21', teams: [
			{ players: [{ btp_id: 1, name: 'A', checked_in }] },
			{ players: [{ btp_id: 2, name: 'B', checked_in: false }] },
		] },
	});
	return { db, key };
}

function check_in(app, fields = {}) {
	return new Promise((resolve, reject) => {
		admin.handle_match_player_check_in(app, {
			respond: (_msg, err) => err ? reject(err) : resolve(),
		}, {
			type: 'match_player_check_in', tournament_key: app.key, match_id: 'match', player_id: 1,
			checked_in: true, require_preparation: true, ...fields,
		});
	});
}

describe('admin preparation-only player check-in', function() {
	it('rejects scheduled, blocked, on-court and finished matches without changing attendance', async function() {
		for (const state of ['scheduled', 'blocked', 'oncourt', 'finished']) {
			const app = await fixture(state);
			await assert.rejects(check_in(app), /Match is no longer in preparation/);
			const match = await app.db.matches.findOne_async({ _id: 'match' });
			assert.strictEqual(match.setup.teams[0].players[0].checked_in, false);
			assert.strictEqual(match.btp_needsync, undefined);
		}
		const on_court_preparation = await fixture('preparation', false, true);
		await assert.rejects(check_in(on_court_preparation), /Match is no longer in preparation/);
	});

	it('validates the current match state after waiting for its lock', async function() {
		const app = await fixture('preparation');
		let release;
		let signal_started;
		const started = new Promise((resolve) => { signal_started = resolve; });
		const gate = new Promise((resolve) => { release = resolve; });
		const blocker = update_queue.execute_locked([update_queue.lock_keys.match(app.key, 'match')], async () => {
			signal_started();
			await gate;
		});
		await started;
		const rejected = assert.rejects(check_in(app), /Match is no longer in preparation/);
		try {
			await app.db.matches.update_async({ _id: 'match' }, { $set: { 'setup.state': 'scheduled' } }, {});
		} finally { release(); }
		await Promise.all([blocker, rejected]);
		const match = await app.db.matches.findOne_async({ _id: 'match' });
		assert.strictEqual(match.setup.teams[0].players[0].checked_in, false);
	});

	it('checks in a player in preparation through the normal update flow', async function() {
		const app = await fixture('preparation');
		await check_in(app);
		const match = await app.db.matches.findOne_async({ _id: 'match' });
		assert.strictEqual(match.setup.teams[0].players[0].checked_in, true);
		assert.strictEqual(match.btp_needsync, true);
	});

	it('allows checkout of test players after their match has left preparation', async function() {
		const app = await fixture('oncourt', true, true);
		await check_in(app, { checked_in: false });
		const match = await app.db.matches.findOne_async({ _id: 'match' });
		assert.strictEqual(match.setup.teams[0].players[0].checked_in, false);
		assert.strictEqual(match.setup.now_on_court, true);
	});
});
