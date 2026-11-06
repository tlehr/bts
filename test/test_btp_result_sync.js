'use strict';

const assert = require('assert');
const database = require('../bts/database');
const sync = require('../bts/btp_sync');
const { BTPConn } = require('../bts/btp_conn');
const serror = require('../bts/serror');

const ack = { Action: [{ Result: [1] }] };
const pause = () => new Promise(resolve => setTimeout(resolve, 1));
async function until(check) {
	for (let i = 0; i < 5000; i++) { if (check()) return; await pause(); }
	throw new Error('Expected BTP request did not arrive');
}
function insert(store, value) { return new Promise((resolve, reject) => store.insert(value, error => error ? reject(error) : resolve())); }
function update(store, query, value) { return new Promise((resolve, reject) => store.update(query, value, {}, error => error ? reject(error) : resolve())); }
const raw = (winner = 1, score = [[21, 10], [21, 11]]) => ({ Winner: [winner], ScoreStatus: [0],
	Sets: [{ Set: score.map(([a, b]) => ({ T1: [a], T2: [b] })) }] });
const completed = { team1_won: true, btp_winner: 1, network_score: [[21, 10], [21, 11]], score_status: 'normal', btp_needsync: true };

describe('BTP durable result delivery', function() {
	let db, conn, requests, errors, original_silent;
	beforeEach(async function() {
		db = await database.init_test();
		await insert(db.tournaments, { key: 'test', btp_settings: {} });
		await insert(db.matches, { _id: 'm1', tournament_key: 'test', btp_id: 'test_Test_44', setup: { match_num: 42, state: 'scheduled' },
			btp_match_ids: [{ id: 44, draw: 10, planning: 100 }], btp_needsync: true });
		requests = []; errors = []; original_silent = serror.silent; serror.silent = message => errors.push(message);
		conn = Object.create(BTPConn.prototype);
		Object.assign(conn, { app: { db }, tkey: 'test', key_unicode: 'session', readonly: false, terminated: false });
		conn.send = (value, callback) => requests.push({ value, callback });
		conn.report_status = (status, message) => { conn.last_status = { status, message }; };
		conn.publish_status = () => {};
		conn.schedule_reconnect = () => {};
		conn.schedule_result_retry = () => {};
	});
	afterEach(function() { conn.terminate({ silent: true }); serror.silent = original_silent; });
	const read = () => db.matches.findOne_async({ _id: 'm1' });
	const finish = () => update(db.matches, { _id: 'm1' }, { $set: { ...completed, 'setup.state': 'finished' } });

	it('does not let an older metadata ACK erase a newly confirmed result', async function() {
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		await finish();
		requests[0].callback(ack);
		await sending;
		const current = await read();
		assert.strictEqual(current.btp_needsync, true);
		assert.strictEqual(current.team1_won, true);
		const remote = {
			matches: [{ ID: [44], DrawID: [10], PlanningID: [100], From1: [1], From2: [2], IsMatch: [true],
				MatchNr: [42], Highlight: [0], bts_complete: true, bts_players: [[{ ID: [1] }], [{ ID: [2] }]] }],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['Test'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['Test'], GameTypeID: [1] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [], planning_nodes: new Map(), courts: new Map(), clubs: new Map(), districts: new Map(),
		};
		await new Promise((resolve, reject) => sync._integrate_matches(conn.app, 'test', remote,
			new Map(), new Map(), new Map(), error => error ? reject(error) : resolve()));
		const imported = await read();
		assert.strictEqual(imported.team1_won, true);
		assert.strictEqual(imported.setup.state, 'finished');
	});

	it('persists the result before sending, and keeps it pending after a successful ACK', async function() {
		await finish();
		await update(db.matches, { _id: 'm1' }, { $set: { btp_needsync: false } });
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		assert.strictEqual((await read()).btp_needsync, true);
		requests[0].callback(ack);
		assert.strictEqual(await sending, true);
		assert.strictEqual((await read()).btp_needsync, true);
	});

	it('confirms only the matching winner and sets read back from BTP', async function() {
		await finish();
		const current = await read();
		assert.strictEqual(await sync._mark_pending_btp_sync_confirmed(conn.app, 'test', current, raw(2)), false);
		assert.strictEqual(await sync._mark_pending_btp_sync_confirmed(conn.app, 'test', current, raw(1, [[21, 9], [21, 11]])), false);
		assert.strictEqual((await read()).btp_needsync, true);
		assert.strictEqual(await sync._mark_pending_btp_sync_confirmed(conn.app, 'test', current, raw()), true);
		assert.strictEqual((await read()).btp_needsync, false);
	});

	it('does not acknowledge a newer corrected result with an older readback', async function() {
		await finish();
		const snapshot = await read();
		await update(db.matches, { _id: 'm1' }, { $set: { network_score: [[21, 8], [21, 7]] } });
		assert.strictEqual(await sync._mark_pending_btp_sync_confirmed(conn.app, 'test', snapshot, raw()), false);
		assert.strictEqual((await read()).btp_needsync, true);
	});

	it('retries failed delivery using the latest persisted result and records the transport cause', async function() {
		await finish();
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		requests[0].callback(null, new Error('connection timed out'));
		assert.strictEqual(await sending, false);
		assert.strictEqual((await read()).btp_needsync, true);
		assert(errors.some(message => message.includes('m1') && message.includes('connection timed out')));
		assert(conn.result_write_error.includes('connection timed out'));
		await update(db.matches, { _id: 'm1' }, { $set: { network_score: [[21, 8], [21, 7]] } });
		const retry = conn.pushall();
		await until(() => requests.length === 2);
		assert.deepStrictEqual(requests[1].value.Update.Tournament.Matches[0].Match.Sets.map(row => [row.Set.T1, row.Set.T2]), [[21, 8], [21, 7]]);
		requests[1].callback(ack);
		await retry;
		assert.strictEqual((await read()).btp_needsync, true);
	});

	it('automatically retries and reads back results even when automatic fetching is disabled', async function() {
		await finish();
		let accepted = false, fetches = 0;
		conn.enabled_autofetch = false; conn.publish_status = () => {};
		conn.result_retry_delay = 5;
		conn.schedule_result_retry = BTPConn.prototype.schedule_result_retry;
		conn._fetch_once = async () => {
			fetches++;
			if (accepted) await sync._mark_pending_btp_sync_confirmed(conn.app, 'test', await read(), raw());
			return { value: true, reschedule: false };
		};
		const initial = conn.update_score(await read());
		await until(() => requests.length === 1);
		requests[0].callback(null, new Error('offline'));
		await initial;
		await until(() => requests.length === 2);
		accepted = true; requests[1].callback(ack);
		for (let i = 0; i < 100 && (await read()).btp_needsync; i++) await new Promise(resolve => setTimeout(resolve, 2));
		assert.strictEqual((await read()).btp_needsync, false);
		assert(fetches >= 2);
		assert.strictEqual(requests.length, 2);
		assert.strictEqual(conn.result_retry_timeout, null);
		assert.strictEqual(conn.result_write_error, null);
	});

	it('cancels retry and reconnect timers when the connection is replaced', function() {
		conn.schedule_result_retry = BTPConn.prototype.schedule_result_retry;
		conn.schedule_reconnect = BTPConn.prototype.schedule_reconnect;
		conn.publish_status = () => {};
		conn.schedule_result_retry(); conn.schedule_reconnect();
		const reconnect = conn.reconnect_timeout;
		conn.schedule_reconnect();
		assert.strictEqual(conn.reconnect_timeout, reconnect);
		assert(conn.result_retry_timeout);
		conn.terminate({ silent: true });
		assert.strictEqual(conn.result_retry_timeout, null);
		assert.strictEqual(conn.reconnect_timeout, null);
	});

	it('serializes and coalesces overlapping updates to the same match', async function() {
		const old = await read(), sending = conn.update_score(old);
		await until(() => requests.length === 1);
		conn.update_score(old);
		await finish();
		const newer = conn.update_score(await read());
		assert.strictEqual(requests.length, 1);
		requests[0].callback(ack);
		await until(() => requests.length === 2);
		assert.strictEqual(requests[1].value.Update.Tournament.Matches[0].Match.Winner, 1);
		requests[1].callback(ack);
		await Promise.all([sending, newer]);
		assert.strictEqual(requests.length, 2);
		assert.strictEqual((await read()).btp_needsync, true);
	});

	it('clears a metadata acknowledgement only for the current payload revision', async function() {
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		requests[0].callback(ack); await sending;
		assert.strictEqual((await read()).btp_needsync, false);
	});

	it('retries only its own tournament and limits a batch to two simultaneous requests', async function() {
		await finish();
		await insert(db.matches, { ...await read(), _id: 'foreign', tournament_key: 'other' });
		for (let i = 2; i <= 10; i++) await insert(db.matches, { ...await read(), _id: 'm' + i });
		const retry = conn.pushall();
		await until(() => requests.length === 2);
		for (let n = 2; n <= 8; n += 2) {
			assert.strictEqual(requests.length, n);
			requests[n - 2].callback(ack); requests[n - 1].callback(ack);
			if (n < 8) await until(() => requests.length === n + 2);
		}
		await retry;
		assert.strictEqual(requests.length, 8);
		assert.strictEqual((await db.matches.findOne_async({ _id: 'foreign' })).btp_needsync, true);
	});

	it('retains results until a login is available, and never writes after termination or in read-only mode', async function() {
		await finish(); conn.key_unicode = null;
		assert.strictEqual(await conn.update_score(await read()), false);
		assert.strictEqual((await read()).btp_needsync, true);
		conn.key_unicode = 'session'; conn.readonly = true;
		await conn.update_score(await read());
		conn.readonly = false; conn.terminated = true;
		await conn.update_score(await read());
		assert.strictEqual(requests.length, 0);
	});

	it('ignores a late acknowledgement from a replaced connection', async function() {
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		conn.terminate({ silent: true }); requests[0].callback(ack); await sending;
		assert.strictEqual((await read()).btp_needsync, true);
	});
});
