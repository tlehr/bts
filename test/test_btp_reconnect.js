'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const net = require('net');
const { BTPConn } = require('../bts/btp_conn');
const proto = require('../bts/btp_proto');

describe('BTP reconnect request ownership', function() {
	let conn, replies, timers, original_set, original_clear, events;
	beforeEach(function() {
		original_set = global.setTimeout; original_clear = global.clearTimeout;
		timers = new Map(); replies = []; events = [];
		global.setTimeout = (callback, delay) => {
			const timer = { callback, delay, unref() {} };
			timers.set(timer, timer); return timer;
		};
		global.clearTimeout = timer => { if (!timers.delete(timer)) original_clear(timer); };
		conn = Object.assign(Object.create(BTPConn.prototype), {
			report_status() {}, publish_status() {},
			send(_request, callback) { replies.push(callback); },
			fetch() { events.push('readback'); return Promise.resolve(); },
			pushall() { events.push('outbox'); },
		});
	});
	afterEach(function() {
		conn.terminate({ silent: true });
		global.setTimeout = original_set; global.clearTimeout = original_clear;
	});
	function fire_retry() {
		assert.strictEqual(timers.size, 1);
		const [timer] = timers.values();
		assert.strictEqual(timer.delay, 500);
		timers.delete(timer); timer.callback();
	}
	it('opens only one login while earlier requests are still pending', function() {
		for (let i = 0; i < 20; i++) conn.connect();
		assert.strictEqual(replies.length, 1);
	});
	it('coalesces parallel failures and still retries a failed login', function() {
		conn.connect();
		for (let i = 0; i < 50; i++) conn.schedule_reconnect();
		assert.strictEqual(timers.size, 0);
		replies[0](null, new Error('Connection timed out'));
		for (let i = 0; i < 50; i++) conn.schedule_reconnect();
		fire_retry();
		assert.strictEqual(replies.length, 2);
		assert.strictEqual(timers.size, 0);
		replies[1](null, new Error('Connection timed out'));
		fire_retry();
		assert.strictEqual(replies.length, 3);
	});
	it('reads back before flushing the durable outbox after a successful login', async function() {
		conn.connect();
		replies[0]({ Action: [{ ID: ['REPLY'], Result: [1], Unicode: ['test-session'] }] });
		await new Promise(resolve => setImmediate(resolve));
		assert.deepStrictEqual(events, ['readback', 'outbox']);
		assert.strictEqual(conn.key_unicode, 'test-session');
		assert.strictEqual(timers.size, 0);
		conn.connect();
		assert.strictEqual(replies.length, 2);
	});
	it('does not revive a terminated connection when the held login fails', function() {
		conn.connect(); conn.terminate({ silent: true });
		replies[0](null, new Error('Connection timed out'));
		assert.strictEqual(timers.size, 0);
		assert.deepStrictEqual(events, []);
		conn.connect();
		assert.strictEqual(replies.length, 1);
	});
	it('does not keep retrying rejected credentials or an invalid login reply', function() {
		conn.connect();
		replies[0](null, Object.assign(new Error('Invalid password'), { btp_phase: 'reply' }));
		assert.strictEqual(timers.size, 0);
		assert.deepStrictEqual(events, []);
		conn.connect();
		assert.strictEqual(replies.length, 2);
	});
	it('handles overlapping socket timeouts without duplicating login or losing callbacks', async function() {
		const connect = net.connect, report_error = console.error, sockets = [];
		let callbacks = 0;
		net.connect = () => {
			const socket = new EventEmitter();
			socket.setTimeout = socket.write = () => {};
			socket.destroy = () => socket.emit('close');
			sockets.push(socket); return socket;
		};
		console.error = () => {};
		Object.assign(conn, { send: BTPConn.prototype.send, app: {}, ip: '192.0.2.75', tkey: 'test' });
		try {
			conn.connect();
			for (let i = 0; i < 3; i++) conn.send(proto.get_info_request(), (_reply, error) => {
				assert.strictEqual(error.code, 'ETIMEDOUT'); callbacks++;
			});
			for (const socket of sockets.slice(1)) socket.emit('timeout');
			assert.strictEqual(callbacks, 3);
			assert.strictEqual(timers.size, 0);
			sockets[0].emit('timeout');
			fire_retry();
			assert.strictEqual(sockets.length, 5);
			assert.strictEqual(timers.size, 0);
			sockets[4].emit('data', proto.encode({ Action: { ID: 'REPLY', Result: 1, Unicode: 'recovered-session' } }));
			sockets[4].emit('end');
			await new Promise(resolve => setImmediate(resolve));
			assert.deepStrictEqual(events, ['readback', 'outbox']);
			assert.strictEqual(conn.key_unicode, 'recovered-session');
			assert.strictEqual(timers.size, 0);
		} finally { net.connect = connect; console.error = report_error; }
	});
});
