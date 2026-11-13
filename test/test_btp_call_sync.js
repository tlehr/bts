'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const sync = require('../bts/btp_sync');
const { BTPConn } = require('../bts/btp_conn');
const { inputs } = require('./btp_match_changes_fixture');
const serror = require('../bts/serror');

const ack = { Action: [{ Result: [1] }] };
async function until(check) {
	for (let turn = 0; turn < 500; turn++) {
		if (check()) return;
		await new Promise(resolve => setTimeout(resolve, 1));
	}
	throw new Error('Expected BTP call request did not arrive');
}

describe('BTP court calls across an outage', function() {
	let db, app, input, conn, requests, original_silent, id;
	const read = () => db.matches.findOne_async({ _id: id });
	const update = value => promisify(db.matches.update.bind(db.matches))({ _id: id }, value, {});
	const integrate = () => new Promise((resolve, reject) => sync._integrate_matches(app, 'default', input.state,
		input.scoring_formats, input.location_map, input.court_map, error => error ? reject(error) : resolve()));
	const call = () => update({ $set: { 'setup.state': 'oncourt', 'setup.now_on_court': true,
		'setup.court_id': 'field', 'setup.called_timestamp': 1000, btp_needsync: false } });
	function accept_court(court = 9) {
		input.state.matches[0].CourtID = [court];
		input.state.courts.set(court, { ID: [court], MatchID: [1] });
	}
	beforeEach(async function() {
		db = await database.init_test();
		app = { db, wss: { clients: [] }, clock: { now_ms: () => 10000 } };
		input = inputs(1);
		input.tournament.btp_enabled = true;
		input.court_map.set(9, 'field');
		input.court_map.set(10, 'other-field');
		input.state.courts.set(9, { ID: [9] });
		await promisify(db.tournaments.insert.bind(db.tournaments))(input.tournament);
		await promisify(db.courts.insert.bind(db.courts))({ _id: 'field', tournament_key: 'default', btp_id: 9 });
		await promisify(db.courts.insert.bind(db.courts))({ _id: 'other-field', tournament_key: 'default', btp_id: 10 });
		await integrate();
		id = (await db.matches.find_async({}))[0]._id;
		requests = [];
		original_silent = serror.silent;
		serror.silent = () => {};
		conn = Object.create(BTPConn.prototype);
		Object.assign(conn, { app, tkey: 'default', key_unicode: 'session', readonly: false, terminated: false });
		conn.send = (value, callback) => requests.push({ value, callback });
		conn.report_status = (status, message) => { conn.last_status = { status, message }; };
		conn.publish_status = () => {};
		conn.schedule_reconnect = () => {};
		conn.schedule_result_retry = () => {};
	});
	afterEach(function() {
		conn.terminate({ silent: true });
		serror.silent = original_silent;
	});

	it('persists the call before sending both sides of the court assignment', async function() {
		await call();
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		assert.strictEqual((await read()).btp_call_pending, true);
		const packet = requests[0].value.Update.Tournament;
		assert.strictEqual(packet.Matches[0].Match.CourtID, 9);
		requests[0].callback(ack);
		assert.deepStrictEqual(requests[1].value.Update.Tournament.Courts, [{ Court: { ID: 9, MatchID: 1 } }]);
		requests[1].callback(ack);
		await sending;
		assert.strictEqual((await read()).btp_call_pending, true, 'ACK alone must not confirm the call');
	});

	it('recovers an already missed local call without overwriting it with the old BTP snapshot', async function() {
		await call();
		await integrate();
		const current = await read();
		assert.strictEqual(current.btp_call_pending, true);
		assert.strictEqual(current.setup.state, 'oncourt');
		assert.strictEqual(current.setup.now_on_court, true);
		assert.strictEqual(current.setup.court_id, 'field');
	});

	it('does not confuse an empty result with confirmation of a pending call', async function() {
		await call();
		await update({ $set: { btp_call_pending: true, btp_needsync: true } });
		await integrate();
		assert.strictEqual((await read()).btp_call_pending, true);
		assert.strictEqual((await read()).btp_needsync, true);
	});

	for (const partial of ['match only', 'court only', 'wrong court']) {
		it('keeps the call pending when BTP reports ' + partial, async function() {
			await call();
			await update({ $set: { btp_call_pending: true } });
			if (partial === 'match only') input.state.matches[0].CourtID = [9];
			if (partial === 'court only') input.state.courts.set(9, { ID: [9], MatchID: [1] });
			if (partial === 'wrong court') accept_court(10);
			await integrate();
			assert.strictEqual((await read()).btp_call_pending, true);
			assert.strictEqual((await read()).setup.court_id, 'field');
		});
	}

	it('confirms the correct court readback and stops retrying', async function() {
		await call();
		await update({ $set: { btp_call_pending: true, btp_needsync: true } });
		accept_court();
		await integrate();
		assert.strictEqual((await read()).btp_call_pending, false);
		assert.strictEqual((await read()).btp_needsync, false);
		await conn.pushall();
		assert.strictEqual(requests.length, 0);
	});

	it('does not skip an identical BTP response while only a call is pending', async function() {
		await call();
		await update({ $set: { btp_call_pending: true } });
		conn.last_applied_fetch_response_hash = 'unchanged';
		const decision = await require('../bts/btp_conn')._should_skip_fetch_sync(conn, 'unchanged');
		assert.strictEqual(decision.skip, false);
		assert.strictEqual(decision.pending_count, 1);
	});

	it('replays stored calls after replacing the connection and uses the latest court', async function() {
		await call();
		await update({ $set: { btp_call_pending: true, 'setup.court_id': 'other-field' } });
		const retry = conn.pushall();
		await until(() => requests.length === 1);
		const packet = requests[0].value.Update.Tournament;
		assert.strictEqual(packet.Matches[0].Match.CourtID, 10);
		requests[0].callback(ack);
		assert.deepStrictEqual(requests[1].value.Update.Tournament.Courts, [{ Court: { ID: 10, MatchID: 1 } }]);
		requests[1].callback(ack);
		await retry;
	});

	it('automatically retries failed calls even with automatic fetching disabled', async function() {
		await call();
		conn.enabled_autofetch = false;
		conn.result_retry_delay = 5;
		conn.schedule_result_retry = BTPConn.prototype.schedule_result_retry;
		conn._fetch_once = async () => {
			await integrate();
			return { value: true, reschedule: false };
		};
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		requests[0].callback(null, new Error('BTP offline'));
		await sending;
		await until(() => requests.length === 2);
		requests[1].callback(ack);
		assert.strictEqual(requests.length, 3);
		accept_court();
		requests[2].callback(ack);
		for (let turn = 0; turn < 100 && (await read()).btp_call_pending; turn++) {
			await new Promise(resolve => setTimeout(resolve, 2));
		}
		assert.strictEqual((await read()).btp_call_pending, false);
		assert.strictEqual(requests.length, 3);
		assert.strictEqual(conn.result_retry_timeout, null);
	});

	it('keeps a newer completed result when a call acknowledgement arrives late', async function() {
		await call();
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		await update({ $set: { team1_won: true, btp_needsync: true, 'setup.state': 'finished', 'setup.now_on_court': false } });
		requests[0].callback(ack);
		requests[1].callback(ack);
		await sending;
		assert.strictEqual((await read()).btp_needsync, true);
		assert.strictEqual((await read()).team1_won, true);
	});

	it('retries both writes when BTP accepts the match but rejects the court update', async function() {
		await call();
		const sending = conn.update_score(await read());
		await until(() => requests.length === 1);
		requests[0].callback(ack);
		requests[1].callback(null, new Error('court connection timed out'));
		assert.strictEqual(await sending, false);
		assert.strictEqual((await read()).btp_call_pending, true);
		assert(conn.result_write_error.includes('court connection timed out'));
		const retry = conn.pushall();
		await until(() => requests.length === 3);
		assert.strictEqual(requests[2].value.Update.Tournament.Matches[0].Match.CourtID, 9);
		requests[2].callback(ack);
		assert.strictEqual(requests[3].value.Update.Tournament.Courts[0].Court.MatchID, 1);
		requests[3].callback(ack);
		await retry;
	});

	it('never replays a captured old call after the local game has finished', async function() {
		await call();
		const old = await read();
		await update({ $set: { team1_won: true, btp_needsync: true, btp_call_pending: true,
			'setup.state': 'finished', 'setup.now_on_court': false } });
		const sending = conn.update_score(old);
		await until(() => requests.length === 1);
		assert.strictEqual(requests[0].value.Update.Tournament.Matches[0].Match.Winner, 1);
		requests[0].callback(ack);
		await sending;
		assert.strictEqual(requests.length, 1);
	});

	it('does not confirm a newer court call or result with a stale readback', async function() {
		await call();
		await update({ $set: { btp_call_pending: true } });
		accept_court();
		const old = await read();
		await update({ $set: { 'setup.court_id': 'other-field' } });
		const call_sync = require('../bts/btp_call_sync');
		const context = { state: input.state, tournament: input.tournament, court_map: input.court_map };
		assert.strictEqual((await call_sync.reconcile(app, 'default', old, input.state.matches[0], context)).changed, false);
		assert.strictEqual((await read()).btp_call_pending, true);
		await update({ $set: { 'setup.court_id': 'field', team1_won: true, btp_needsync: true,
			'setup.state': 'finished', 'setup.now_on_court': false } });
		assert.strictEqual((await call_sync.reconcile(app, 'default', old, input.state.matches[0], context)).changed, false);
		assert.strictEqual((await read()).btp_needsync, true);
	});

	it('confirms court delivery while preserving concurrent ordinary points', async function() {
		await call();
		await update({ $set: { btp_call_pending: true } });
		accept_court();
		const old = await read();
		await update({ $set: { network_score: [[5, 3]], presses: [{ type: 'point', timestamp: 5000 }] } });
		const result = await require('../bts/btp_call_sync').reconcile(app, 'default', old, input.state.matches[0],
			{ state: input.state, tournament: input.tournament, court_map: input.court_map });
		assert.strictEqual(result.confirmed, true);
		assert.deepStrictEqual((await read()).network_score, [[5, 3]]);
		assert.deepStrictEqual((await read()).presses, [{ type: 'point', timestamp: 5000 }]);
	});

	it('clears the call marker when the subsequent completed result is read back', async function() {
		await call();
		await update({ $set: { btp_call_pending: true, btp_needsync: true, team1_won: true,
			network_score: [[21, 10]], 'setup.state': 'finished', 'setup.now_on_court': false } });
		Object.assign(input.state.matches[0], { Winner: [1], ScoreStatus: [0], Sets: [{ Set: [{ T1: [21], T2: [10] }] }] });
		await integrate();
		assert.strictEqual((await read()).btp_needsync, false);
		assert.strictEqual((await read()).btp_call_pending, false);
	});

	it('does not write pending calls from other tournaments, in read-only mode or after termination', async function() {
		await call();
		await update({ $set: { btp_call_pending: true, tournament_key: 'other' } });
		await conn.pushall();
		await update({ $set: { tournament_key: 'default' } });
		conn.readonly = true;
		await conn.pushall();
		conn.readonly = false;
		conn.terminate({ silent: true });
		await conn.pushall();
		assert.strictEqual(requests.length, 0);
		assert.strictEqual((await read()).btp_call_pending, true);
	});

	it('does not queue legacy call repair in read-only mode or against a remote result', async function() {
		await call();
		input.tournament.btp_readonly = true;
		await promisify(db.tournaments.update.bind(db.tournaments))({ key: 'default' }, { $set: { btp_readonly: true } }, {});
		await integrate();
		assert.notStrictEqual((await read()).btp_call_pending, true);
		input.tournament.btp_readonly = false;
		await promisify(db.tournaments.update.bind(db.tournaments))({ key: 'default' }, { $set: { btp_readonly: false } }, {});
		input.state.matches[0].Winner = [1];
		await integrate();
		assert.notStrictEqual((await read()).btp_call_pending, true);
	});
});
