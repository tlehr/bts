'use strict';

const assert = require('assert');
const net = require('net');
const { EventEmitter } = require('events');
const { BTPConn } = require('../bts/btp_conn');
const bulk_decoder = require('../bts/btp_decode');
const proto = require('../bts/btp_proto');

describe('BTP connection worker lifecycle', function() {
	let connect, decode, timeout, conn, state;
	beforeEach(function() {
		connect = net.connect; decode = bulk_decoder.decode; timeout = process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
		state = { cancels: 0, decodes: 0, reconnects: 0 };
		conn = Object.assign(Object.create(BTPConn.prototype), {
			tkey: 'worker-lifecycle', ip: 'mock', timeZone: 'system', terminated: false,
			app: { db: { tournaments: { findOne_async: async () => ({ last_reset_ts: 1 }) } } },
			report_status() {}, schedule_reconnect() { state.reconnects++; },
		});
		net.connect = (options, ready) => {
			const socket = new EventEmitter();
			socket.setTimeout = socket.write = socket.destroy = () => {};
			setImmediate(() => { ready(); socket.emit('data', proto.encode_xml('<ROOT/>')); socket.emit('end'); });
			return socket;
		};
		bulk_decoder.decode = (packet, context, callback) => {
			state.decodes++; state.reply = callback;
			if (state.started) state.started();
			return () => { state.cancels++; };
		};
	});
	afterEach(function() {
		conn.terminate({ silent: true }); net.connect = connect; bulk_decoder.decode = decode;
		if (timeout === undefined) delete process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
		else process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = timeout;
	});
	it('cancels worker decoding when the fetch hard deadline expires and ignores its late response', async function() {
		process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = '20';
		const started = new Promise(resolve => { state.started = resolve; });
		const fetching = conn._fetch_response(Date.now());
		await started;
		assert.strictEqual(await fetching, null);
		assert.strictEqual(state.cancels, 1); assert.strictEqual(state.reconnects, 1);
		state.reply(null, { Result: [] });
		assert.strictEqual(state.reconnects, 1);
	});
	it('cancels worker decoding on termination and settles before a late response', async function() {
		const started = new Promise(resolve => { state.started = resolve; });
		const fetching = conn._fetch_response(Date.now());
		await started; conn.terminate({ silent: true });
		assert.strictEqual(await fetching, null); assert.strictEqual(state.cancels, 1);
		state.reply(null, { Result: [] }); assert.strictEqual(state.reconnects, 0);
	});
	it('returns successful decoded snapshots with the original reset revision', async function() {
		const started = new Promise(resolve => { state.started = resolve; });
		const fetching = conn._fetch_response(Date.now());
		await started;
		const response = { Result: [{ Tournament: [{}] }] };
		state.reply(null, response);
		assert.deepStrictEqual(await fetching, { response, fetch_reset_ts: 1 });
	});
	it('keeps small SENDUPDATE responses on the direct decoder path', async function() {
		assert.deepStrictEqual(await new Promise(resolve => conn.send({ Action: { ID: 'SENDUPDATE' } }, resolve)), {});
		assert.strictEqual(state.decodes, 0);
	});
	it('cancels before socket receipt without enqueuing a stale decoder job', async function() {
		const cancel = conn.send(proto.get_info_request(), () => assert.fail('cancelled callback'));
		cancel();
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(state.decodes, 0);
	});
});
