'use strict';

const assert = require('assert');
const net = require('net');
const { EventEmitter } = require('events');
const fs = require('fs'), os = require('os'), path = require('path');
const { BTPConn } = require('../bts/btp_conn');
const proto = require('../bts/btp_proto');
const logs = require('../bts/btp_request_log');

const request = () => proto.update_request({ setup: {}, team1_won: true, network_score: [[21, 9], [21, 11]],
	btp_match_ids: [{ id: 842, nr: 287, draw: 9, planning: 2001 }] }, 'session-secret', 'password-secret');
const reply = value => proto.encode(value);
const ack = () => reply({ Action: { ID: 'REPLY', Result: 1 } });
const parsed = entry => JSON.parse(entry.message.split('[bts] btp_request:failed ')[1]);
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('BTP request failure logging', function() {
	let original_connect, original_console, socket, ready, conn, records, output, reconnects;
	beforeEach(function() {
		original_connect = net.connect; original_console = console.error;
		records = []; output = []; reconnects = 0; ready = undefined;
		console.error = message => output.push(message);
		socket = new EventEmitter(); socket.setTimeout = socket.write = () => {};
		socket.destroy = () => socket.emit('close');
		net.connect = (options, callback) => { ready = callback; return socket; };
		conn = Object.assign(Object.create(BTPConn.prototype), {
			app: { config: { bts_server_diagnostics_enabled: false }, diagnostics: { record: entry => records.push(entry) } },
			tkey: 'default', ip: '192.0.2.75', password: 'password-secret', key_unicode: 'session-secret',
			report_status() {}, publish_status() {}, schedule_reconnect() { reconnects++; },
		});
	});
	afterEach(function() { conn.terminate({ silent: true }); net.connect = original_connect; console.error = original_console; });
	function send(value = request()) {
		let calls = 0, response, error;
		const cancel = conn.send(value, (r, e) => { calls++; response = r; error = e; }, { match_id: 'local-287', match_number: 287 });
		return { cancel, get calls() { return calls; }, get response() { return response; }, get error() { return error; } };
	}
	function deliver(packet) { ready(); socket.emit('data', packet); socket.emit('end'); }

	it('logs the correct connection timeout with tournament, game, destination and request identity', function() {
		const call = send(); socket.emit('timeout');
		assert.strictEqual(call.calls, 1); assert.strictEqual(call.error.code, 'ETIMEDOUT');
		assert.strictEqual(reconnects, 1); assert.strictEqual(records.length, 1);
		const entry = records[0], record = parsed(entry);
		assert.strictEqual(entry.level, 'error'); assert.strictEqual(entry.tournament_key, 'default');
		assert(entry.message.split('\n')[0].includes('Spiel 287'));
		assert(entry.message.split('\n')[0].includes('ETIMEDOUT'));
		assert.strictEqual(entry.match_id, 'local-287'); assert.strictEqual(entry.trace_id, record.request_id);
		assert.strictEqual(record.operation, 'result_update'); assert.strictEqual(record.action, 'SENDUPDATE');
		assert.strictEqual(record.phase, 'connect'); assert.strictEqual(record.error.timeout_ms, 5000);
		assert.strictEqual(record.match_number, 287); assert.deepStrictEqual(record.match_ids, [842]);
		assert.strictEqual(record.target, '192.0.2.75'); assert.strictEqual(record.port, 9901);
		assert(Number.isFinite(record.duration_ms)); assert.strictEqual(output.length, 1);
	});

	it('distinguishes a response timeout after the socket connected', function() {
		const call = send(); ready(); socket.emit('timeout');
		assert.strictEqual(call.calls, 1); assert.strictEqual(parsed(records[0]).phase, 'response');
		assert.strictEqual(parsed(records[0]).error.timeout_ms, 10000);
	});

	it('preserves socket error codes and system-call causes', function() {
		const call = send(); socket.emit('error', Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH', syscall: 'connect' }));
		assert.strictEqual(call.calls, 1); const error = parsed(records[0]).error;
		assert.strictEqual(error.code, 'EHOSTUNREACH'); assert.strictEqual(error.syscall, 'connect');
		assert(error.message.includes('EHOSTUNREACH'));
	});

	it('logs a prematurely closed socket once and settles the failed request', function() {
		const call = send(); ready(); socket.emit('close'); socket.emit('error', new Error('late error'));
		assert.strictEqual(call.calls, 1); assert.strictEqual(records.length, 1);
		assert.strictEqual(parsed(records[0]).error.code, 'ECONNRESET');
	});

	it('turns a corrupt response into a logged decoder error without crashing', function() {
		const call = send(); assert.doesNotThrow(() => deliver(Buffer.from('invalid compressed packet')));
		assert.strictEqual(call.calls, 1); assert.strictEqual(records.length, 1);
		assert.strictEqual(parsed(records[0]).phase, 'decode'); assert(call.error);
	});

	it('logs encoding failures before any socket is opened', function() {
		const original = proto.encode;
		proto.encode = () => { throw new Error('bad date format'); };
		try {
			const call = send(); assert.strictEqual(call.calls, 1); assert.strictEqual(ready, undefined);
			assert.strictEqual(parsed(records[0]).phase, 'encode'); assert.strictEqual(parsed(records[0]).error.message, 'bad date format');
		} finally { proto.encode = original; }
	});

	it('retains the actual rejection code and BTP explanation', function() {
		const call = send(); deliver(reply({ Action: { ID: 'REPLY', Result: 2, Message: 'Read only' } }));
		assert.strictEqual(call.response.Action[0].Result[0], 2);
		const record = parsed(records[0]); assert.strictEqual(record.phase, 'reply'); assert.strictEqual(record.result_code, 2);
		assert(record.error.message.includes('Read only')); assert.strictEqual(call.error.btp_logged, true);
	});

	it('does not invent an explanation when BTP supplies only a rejection code', function() {
		send(); deliver(reply({ Action: { ID: 'REPLY', Result: 9 } }));
		assert.strictEqual(parsed(records[0]).result_code, 9);
		assert(parsed(records[0]).error.message.includes('keine weitere Ursache mitgeteilt'));
	});

	it('logs malformed acknowledgements and missing tournament snapshots', async function() {
		for (const value of [request(), proto.get_info_request('password-secret')]) {
			const call = send(value); deliver(reply({}));
			for (let i = 0; i < 200 && !call.calls; i++) await new Promise(resolve => setTimeout(resolve, 10));
			assert.strictEqual(call.calls, 1); assert.strictEqual(call.error.code, 'BTP_INVALID_REPLY');
		}
		assert.strictEqual(records.length, 2); assert.strictEqual(parsed(records[1]).operation, 'fetch');
	});

	it('does not log successful requests or intentionally cancelled connections as failures', function() {
		const call = send(); deliver(ack()); assert.strictEqual(call.calls, 1); assert(!call.error); assert.strictEqual(records.length, 0);
		const cancelled = send(); cancelled.cancel(); socket.emit('close'); assert.strictEqual(cancelled.calls, 0);
		const replaced = send(); conn.terminate({ silent: true }); socket.emit('error', new Error('old connection'));
		assert.strictEqual(replaced.calls, 1); assert.strictEqual(records.length, 0);
	});

	it('redacts credentials in errors and XML snippets without dumping request payloads', function() {
		send(); socket.emit('error', new Error('password-secret session-secret <Password>other-secret</Password> <Unicode>other-session</Unicode>'));
		const serialized = JSON.stringify(records);
		for (const secret of ['password-secret', 'session-secret', 'other-secret', 'other-session']) assert(!serialized.includes(secret));
		assert(serialized.includes('[entfernt]'));
		assert(!logs.safe_message(conn, new Error('session-secret')).includes('session-secret')); assert(!serialized.includes('Sets')); assert(!serialized.includes('Winner'));
	});

	it('reports incomplete login replies without dereferencing missing fields', function() {
		const call = send(proto.login_request('password-secret'));
		deliver(reply({ Action: { Result: 1, Unicode: 'session-secret' } }));
		assert.strictEqual(call.error.code, 'BTP_INVALID_REPLY');
		assert.strictEqual(parsed(records[0]).operation, 'login');
		assert(!JSON.stringify(records).includes('session-secret'));
	});

	it('keeps logs parseable when a password consists of a single digit', function() {
		conn.password = '1'; send(); socket.emit('error', new Error('password=1'));
		assert.strictEqual(parsed(records[0]).match_number, 287); assert(parsed(records[0]).error.message.includes('[entfernt]'));
	});

	it('identifies player and court update requests independently of match results', function() {
		for (const [value, kind, key, ids] of [
			[proto.update_players_request([{ btp_id: 23, firstname: 'Test' }], 'session-secret'), 'players_update', 'player_ids', [23]],
			[proto.update_courts_request([{ btp_id: 5 }], 'session-secret'), 'courts_update', 'court_ids', [5]],
		]) {
			send(value); socket.emit('error', new Error('offline'));
			const record = parsed(records.at(-1)); assert.strictEqual(record.operation, kind); assert.deepStrictEqual(record[key], ids);
		}
	});

	it('logs protocol preparation errors with the local game number', async function() {
		conn.app.db = { tournaments: { findOne(_query, callback) { callback(null, { key: 'default' }); } } };
		const original = proto.update_request;
		proto.update_request = () => { throw new Error('invalid game payload'); };
		try {
			assert.strictEqual(await conn._send_score({ _id: 'local-287', team1_won: true,
				setup: { match_num: 287 }, btp_match_ids: [{ id: 842 }] }), false);
			const record = parsed(records[0]); assert.strictEqual(record.phase, 'prepare');
			assert.strictEqual(record.match_number, 287); assert.strictEqual(record.error.message, 'invalid game payload');
		} finally { proto.update_request = original; }
	});

	it('retains nested error causes and suppresses repeated logging of the same failure', function() {
		const error = new Error('delivery failed', { cause: Object.assign(new Error('disk full'), { code: 'ENOSPC' }) });
		const context = logs.context(conn, request()); logs.failure(conn, context, error); logs.failure(conn, context, error);
		assert.strictEqual(records.length, 1); assert.strictEqual(parsed(records[0]).error.cause.code, 'ENOSPC');
	});

	it('preserves the game number through the actual score-delivery path', async function() {
		conn.app.db = { tournaments: { findOne(_query, callback) { callback(null, { key: 'default' }); } } };
		const serror = require('../bts/serror'), original = serror.silent;
		serror.silent = () => {};
		try {
			const sending = conn._send_score({ _id: 'local-287', team1_won: true, setup: { match_num: 287 },
				network_score: [[21, 9], [21, 11]], btp_match_ids: [{ id: 842, draw: 9, planning: 2001 }] });
			socket.emit('error', Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
			assert.strictEqual(await sending, false);
			assert.strictEqual(parsed(records[0]).match_number, 287);
			assert.strictEqual(parsed(records[0]).error.code, 'ECONNREFUSED');
		} finally { serror.silent = original; }
	});

	it('records a failed durable pending write with its storage cause', async function() {
		const match = { _id: 'local-287', tournament_key: 'default', team1_won: true,
			setup: { match_num: 287 }, btp_match_ids: [{ id: 842 }] };
		conn.app.db = { matches: {
			findOne(_query, callback) { callback(null, match); },
			update(_query, _update, _options, callback) { callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' })); },
		} };
		assert.strictEqual(await conn.update_score(match), false);
		assert.strictEqual(parsed(records[0]).phase, 'persist');
		assert.strictEqual(parsed(records[0]).error.code, 'ENOSPC');
	});

	it('logs local read failures with the affected game', async function() {
		conn.app.db = { matches: { findOne(_query, callback) { callback(Object.assign(new Error('disk read failed'), { code: 'EIO' })); } } };
		const done = conn.update_score({ _id: 'local-287', team1_won: true, setup: { match_num: 287 }, btp_match_ids: [{ id: 842 }] });
		await done;
		const record = parsed(records[0]); assert.strictEqual(record.phase, 'load'); assert.strictEqual(record.error.code, 'EIO');
		assert.strictEqual(record.match_number, 287); assert.strictEqual(ready, undefined);
	});
});

describe('Persistent BTP failure diagnostics', function() {
	this.timeout(10000);
	it('stores errors with searchable tournament and game attribution even with debug logging off', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-btp-error-log-'));
		const { Diagnostics } = require('../bts/diagnostics');
		const original = console.error;
		let hub;
		try {
			const app = { config: { diagnostics: { directory }, bts_server_diagnostics_enabled: false }, db: await require('../bts/database').init_test() };
			hub = app.diagnostics = new Diagnostics(app, 'test');
			for (let i = 0; i < 200 && !hub.ready; i++) await new Promise(resolve => setTimeout(resolve, 10));
			assert(hub.ready); console.error = () => {};
			const conn = { app, tkey: 'default', ip: '192.0.2.75' };
			logs.failure(conn, logs.context(conn, request(), { match_id: 'local-287', match_number: 287 }),
				Object.assign(new Error('host unreachable'), { code: 'EHOSTUNREACH', btp_phase: 'connect' }));
			let result;
			for (let i = 0; i < 200; i++) {
				result = await hub.query({ level: 'error', tournament_key: 'default', match_id: 'local-287', search: 'btp_request:failed' });
				if (result.items.length) break;
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			assert.strictEqual(result.items.length, 1); assert.strictEqual(parsed(result.items[0]).error.code, 'EHOSTUNREACH');
			for (let i = 0; i < 200 && !fs.existsSync(path.join(directory, 'events.jsonl')); i++) await new Promise(resolve => setTimeout(resolve, 10));
			assert(fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8').includes('EHOSTUNREACH'));
		} finally {
			console.error = original;
			if (hub) { const worker = hub.worker; hub.close(); if (worker && worker.exitCode === null) await new Promise(resolve => worker.once('exit', resolve)); }
			await tick(); fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
