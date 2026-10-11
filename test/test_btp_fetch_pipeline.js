'use strict';

const assert = require('assert');
const { BTPConn, _hash_fetch_response } = require('../bts/btp_conn');
const btp_sync = require('../bts/btp_sync');
const match_utils = require('../bts/match_utils');
const update_queue = require('../bts/update_queue');

const RESPONSE = { Result: [{ Tournament: [{}] }] };
const turn = () => new Promise(resolve => setImmediate(resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

let next_key = 0;
function fixture() {
	const conn = Object.create(BTPConn.prototype);
	const sent = deferred();
	const tournament = { btp_enabled: true, last_reset_ts: 1 };
	const state = { sends: 0, reconnects: 0, schedules: 0, applies: 0, preparations: 0, calls: 0, pending: 0 };
	Object.assign(conn, {
		tkey: `fetch-pipeline-${++next_key}`, password: 'pw', terminated: false,
		enabled_autofetch: true, fetch_in_progress: false,
		app: { db: {
			tournaments: { findOne_async: async () => ({ ...tournament }) },
			matches: { count: (query, callback) => {
				assert.deepStrictEqual(query, { tournament_key: conn.tkey, btp_needsync: true });
				callback(null, state.pending);
			} },
		} },
		publish_status() {}, report_status() {},
		schedule_fetch: () => { state.schedules++; },
		schedule_reconnect: () => { state.reconnects++; },
		send: (request, callback) => {
			state.sends++;
			state.reply = callback;
			sent.resolve();
		},
	});
	return { conn, state, tournament, sent: sent.promise };
}

async function block_tournament(conn) {
	const entered = deferred();
	const gate = deferred();
	const done = update_queue.execute_locked([update_queue.lock_keys.tournament(conn.tkey)], async () => {
		entered.resolve();
		await gate.promise;
	});
	await entered.promise;
	return { release: gate.resolve, done };
}

function integration_pending(conn) {
	return update_queue.stats().pending_tasks.some(task => task.task === 'fetch_sync_apply' &&
		task.locks.includes(update_queue.lock_keys.sync(conn.tkey)));
}

async function wait_for_integration(conn) {
	for (let i = 0; i < 10 && !integration_pending(conn); i++) await turn();
	assert(integration_pending(conn), 'integration must be queued behind the tournament lock');
}

// The connection delegates resource ownership to the integration backend. This
// stub models that contract; real planning and lock scopes are tested separately.
function queued_backend(implementation) {
	return (app, tkey, response, options) => update_queue.execute_locked([
		update_queue.lock_keys.sync(tkey), update_queue.lock_keys.match(tkey, 'match-1'),
	], update_queue.named('fetch_sync_apply', async () => {
		const tournament = await app.db.tournaments.findOne_async({ key: tkey });
		if (!options.is_current()) return { skipped: true, reason: 'connection_terminated' };
		if (!tournament.btp_enabled) return { skipped: true, reason: 'btp_disabled' };
		if (tournament.last_reset_ts !== options.expected_reset_ts) return { skipped: true, reason: 'tournament_reset_during_sync' };
		return implementation(app, tkey, response, options);
	}));
}

describe('BTP fetch and integration pipeline', function() {
	let originals;
	let current;
	let old_timeout;
	beforeEach(function() {
		current = fixture();
		old_timeout = process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
		originals = {
			sync: btp_sync.sync_btp_data,
			hidden_candidates: btp_sync._find_hidden_empty_bye_branch_winner_candidates,
			preparation: match_utils.queue_auto_execute_preparation_selections,
			call: match_utils.queue_auto_call_matches_on_free_courts,
		};
		btp_sync.sync_btp_data = queued_backend(async (app, tkey, response, options) => {
			assert.strictEqual(tkey, current.conn.tkey);
			assert.strictEqual(options.expected_reset_ts, current.tournament.last_reset_ts);
			if (current.state.skip) return { skipped: true, reason: 'no_sync_changes' };
			current.state.applies++;
			return true;
		});
		match_utils.queue_auto_execute_preparation_selections = (app, tkey, callback) => {
			current.state.preparations++;
			callback(null);
		};
		match_utils.queue_auto_call_matches_on_free_courts = (app, tkey, callback) => {
			current.state.calls++;
			callback(null);
		};
	});
	afterEach(function() {
		current.conn.terminate({ silent: true });
		btp_sync.sync_btp_data = originals.sync;
		btp_sync._find_hidden_empty_bye_branch_winner_candidates = originals.hidden_candidates;
		match_utils.queue_auto_execute_preparation_selections = originals.preparation;
		match_utils.queue_auto_call_matches_on_free_courts = originals.call;
		if (old_timeout === undefined) delete process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
		else process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = old_timeout;
	});

	it('allows an admin holding BTP and match locks to finish before the fetch replies', async function() {
		const { conn, state, sent } = current;
		const fetch = conn.sync_data();
		await sent;
		assert.strictEqual(conn.fetch_in_progress, true);
		await update_queue.execute_locked([
			update_queue.lock_keys.btp(conn.tkey),
			update_queue.lock_keys.match(conn.tkey, 'match-1'),
		], () => { state.admin_finished = true; });
		assert.strictEqual(state.admin_finished, true);
		assert.strictEqual(state.applies, 0);
		state.reply(RESPONSE);
		assert.strictEqual(await fetch, true);
		assert.strictEqual(state.applies, 1);
	});

	it('finishes an older queued admin before integration without the nested-lock wait cycle', async function() {
		const { conn, state, sent } = current;
		const blocker = await block_tournament(conn);
		const order = [];
		const fetch = conn.fetch(conn, true);
		await sent;
		const admin = update_queue.execute_locked([
			update_queue.lock_keys.btp(conn.tkey),
			update_queue.lock_keys.match(conn.tkey, 'match-1'),
		], () => { order.push('admin'); });
		btp_sync.sync_btp_data = queued_backend(async () => { order.push('integration'); return true; });
		try {
			state.reply(RESPONSE);
			await wait_for_integration(conn);
			assert.strictEqual(conn.fetch_in_progress, true);
			assert.strictEqual(state.schedules, 0);
		} finally {
			blocker.release();
		}
		await Promise.all([fetch, admin, blocker.done]);
		assert.deepStrictEqual(order, ['admin', 'integration']);
		assert.strictEqual(state.reconnects, 0);
	});

	it('shares one fetch through integration and combines requests to reschedule', async function() {
		const { conn, state, sent } = current;
		const blocker = await block_tournament(conn);
		const first = conn.fetch(conn, false);
		const second = conn.fetch(conn, true);
		assert.strictEqual(first, second);
		try {
			await sent;
			state.reply(RESPONSE);
			await wait_for_integration(conn);
			assert.strictEqual(conn.fetch(conn, false), first);
			assert.strictEqual(state.sends, 1);
			assert.strictEqual(state.schedules, 0);
		} finally {
			blocker.release();
		}
		assert.strictEqual(await first, true);
		await blocker.done;
		assert.strictEqual(state.applies, 1);
		assert.strictEqual(state.preparations, 1);
		assert.strictEqual(state.calls, 1);
		assert.strictEqual(state.schedules, 1);
		assert.strictEqual(conn.fetch_in_progress, false);
		assert.strictEqual(conn.fetch_promise, null);
	});

	it('joins an integration that has already started without sending another request', async function() {
		const { conn, state, sent } = current;
		const entered = deferred();
		const integration = deferred();
		btp_sync.sync_btp_data = queued_backend(async () => {
			state.applies++;
			entered.resolve();
			await integration.promise;
			return true;
		});
		const fetch = conn.fetch(conn, false);
		await sent;
		state.reply(RESPONSE);
		try {
			await entered.promise;
			assert.strictEqual(conn.fetch(conn, true), fetch);
			assert.strictEqual(state.sends, 1);
			assert.strictEqual(state.schedules, 0);
		} finally {
			integration.resolve();
		}
		assert.strictEqual(await fetch, true);
		assert.strictEqual(state.applies, 1);
		assert.strictEqual(state.schedules, 1);
	});

	it('ends the network timeout upon receipt even while integration waits longer', async function() {
		process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = '10';
		const { conn, state, sent } = current;
		const blocker = await block_tournament(conn);
		const fetch = conn.fetch(conn, true);
		try {
			await sent;
			state.reply(RESPONSE);
			await wait_for_integration(conn);
			await sleep(30);
			assert.strictEqual(state.reconnects, 0);
			assert.strictEqual(conn.fetch_in_progress, true);
			assert.strictEqual(state.applies, 0);
		} finally {
			blocker.release();
		}
		assert.strictEqual(await fetch, true);
		await blocker.done;
	});

	for (const change of ['reset', 'disable', 'terminate']) {
		it(`discards a queued snapshot after ${change}`, async function() {
			const { conn, state, tournament, sent } = current;
			const blocker = await block_tournament(conn);
			const fetch = conn.fetch(conn, true);
			try {
				await sent;
				state.reply(RESPONSE);
				await wait_for_integration(conn);
				if (change === 'reset') tournament.last_reset_ts = 2;
				if (change === 'disable') tournament.btp_enabled = false;
				if (change === 'terminate') conn.terminate({ silent: true });
			} finally {
				blocker.release();
			}
			assert.strictEqual(await fetch, null);
			await blocker.done;
			assert.strictEqual(state.applies, 0);
			assert.strictEqual(state.preparations, 0);
			assert.strictEqual(conn.last_applied_fetch_response_hash, undefined);
			assert.strictEqual(state.schedules, 0);
		});
	}

	it('rechecks local edits after waiting even for an identical response', async function() {
		const { conn, state, sent } = current;
		conn.last_applied_fetch_response_hash = _hash_fetch_response(RESPONSE);
		conn.last_applied_fetch_reset_ts = 1;
		const blocker = await block_tournament(conn);
		const fetch = conn.fetch(conn, true);
		try {
			await sent;
			state.reply(RESPONSE);
			await wait_for_integration(conn);
			state.pending = 1;
		} finally {
			blocker.release();
		}
		assert.strictEqual(await fetch, true);
		await blocker.done;
		assert.strictEqual(state.applies, 1);
	});

	it('skips post-sync work when the integration backend finds no changes', async function() {
		const { conn, state, sent } = current;
		conn.last_applied_fetch_response_hash = _hash_fetch_response(RESPONSE);
		conn.last_applied_fetch_reset_ts = 1;
		state.skip = true;
		const fetch = conn.fetch(conn, true);
		await sent;
		state.reply(RESPONSE);
		assert.deepStrictEqual(await fetch, { skipped: true, reason: 'no_sync_changes' });
		assert.strictEqual(state.applies, 0);
		assert.strictEqual(state.preparations, 0);
		assert.strictEqual(state.schedules, 1);
	});

	it('applies an identical response again if the previous sync preceded a reset', async function() {
		const { conn, state, sent, tournament } = current;
		conn.last_applied_fetch_response_hash = _hash_fetch_response(RESPONSE);
		conn.last_applied_fetch_reset_ts = 1;
		tournament.last_reset_ts = 2;
		const fetch = conn.fetch(conn, true);
		await sent;
		state.reply(RESPONSE);
		assert.strictEqual(await fetch, true);
		assert.strictEqual(state.applies, 1);
		assert.strictEqual(conn.last_applied_fetch_reset_ts, 2);
	});

	it('clears a failed integration so the same response can be retried', async function() {
		const { conn, state, sent } = current;
		btp_sync.sync_btp_data = async () => { throw new Error('integration failed'); };
		const fetch = conn.fetch(conn, true);
		await sent;
		state.reply(RESPONSE);
		await assert.rejects(fetch, /integration failed/);
		assert.strictEqual(conn.last_applied_fetch_response_hash, undefined);
		assert.strictEqual(conn.fetch_promise, null);
		assert.strictEqual(conn.fetch_in_progress, false);
		assert.strictEqual(state.preparations, 0);
		btp_sync.sync_btp_data = async () => true;
		const retry = conn.fetch(conn, true);
		await turn();
		state.reply(RESPONSE);
		assert.strictEqual(await retry, true);
		assert.strictEqual(state.sends, 2);
		assert.strictEqual(conn.last_applied_fetch_response_hash, _hash_fetch_response(RESPONSE));
	});


	it('ignores late replies after a network timeout', async function() {
		process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = '5';
		const { conn, state, sent } = current;
		const fetch = conn.fetch(conn, true);
		await sent;
		assert.strictEqual(await fetch, null);
		state.reply(RESPONSE);
		await turn();
		assert.strictEqual(state.reconnects, 1);
		assert.strictEqual(state.applies, 0);
		assert.strictEqual(state.schedules, 0);
	});

	it('does not start a request after its metadata read times out', async function() {
		process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = '5';
		const { conn, state } = current;
		const metadata = deferred();
		conn.app.db.tournaments.findOne_async = () => metadata.promise;
		assert.strictEqual(await conn.fetch(conn, true), null);
		metadata.resolve({ last_reset_ts: 1 });
		await turn();
		assert.strictEqual(state.sends, 0);
		assert.strictEqual(state.reconnects, 1);
	});

	it('settles an outstanding request immediately when the connection terminates', async function() {
		const { conn, state, sent } = current;
		const fetch = conn.fetch(conn, true);
		await sent;
		conn.terminate({ silent: true });
		assert.strictEqual(await fetch, null);
		state.reply(RESPONSE);
		await turn();
		assert.strictEqual(state.reconnects, 0);
		assert.strictEqual(state.applies, 0);
		assert.strictEqual(state.schedules, 0);
	});

	it('does not begin a deferred fetch after termination', async function() {
		const { conn, state } = current;
		conn.app.db.tournaments.findOne_async = () => { throw new Error('unexpected metadata read'); };
		const fetch = conn.fetch(conn, true);
		conn.terminate({ silent: true });
		assert.strictEqual(await fetch, null);
		assert.strictEqual(state.sends, 0);
		assert.strictEqual(state.reconnects, 0);
	});
});
