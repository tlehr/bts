'use strict';

const assert = require('assert');
const http = require('http');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const admin = require('../bts/admin');
const wshandler = require('../bts/wshandler');
const outbox = require('../bts/admin_response/outbox');
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('shared admin change delivery', function() {
	let sockets, previous;
	beforeEach(() => { sockets = []; previous = process.env.BTS_ADMIN_BROADCAST_SHARED; process.env.BTS_ADMIN_BROADCAST_SHARED = '1'; });
	afterEach(() => {
		for (const socket of sockets) { socket.readyState = 3; socket.emit('close'); }
		if (previous === undefined) delete process.env.BTS_ADMIN_BROADCAST_SHARED; else process.env.BTS_ADMIN_BROADCAST_SHARED = previous;
	});
	function socket() {
		const ws = new EventEmitter(); ws.readyState = 1; ws.messages = []; ws.raw = [];
		ws.send = (bytes, options) => { assert.strictEqual(options.binary, false); ws.raw.push(bytes); ws.messages.push(JSON.parse(bytes.toString())); };
		wshandler.handle(admin, {}, ws); sockets.push(ws); return ws;
	}
	it('delivers identical native JSON to every recipient, including Unicode, Dates, nulls and omitted fields', function() {
		const recipients = Array.from({ length: 12 }, socket);
		const val = { name: 'Ä羽毛🏸', date: new Date(1000), absent: undefined, values: [undefined, NaN, Infinity],
			keyed: { toJSON(key) { return { key }; } } };
		const expected = JSON.parse(JSON.stringify({ type: 'change', tournament_key: 'test', ctype: 'events', val }));
		admin.notify_change({}, 'test', 'events', val);
		for (const ws of recipients) assert.deepStrictEqual(ws.messages, [expected]);
		val.name = 'next revision'; admin.notify_change({}, 'test', 'events', val);
		for (const ws of recipients) {
			assert.strictEqual(ws.messages[0].val.name, 'Ä羽毛🏸'); assert.strictEqual(ws.messages[1].val.name, 'next revision');
		}
	});
	it('keeps old snapshots before changes and freezes queued revisions independently for each socket', async function() {
		const held = socket(), live = socket();
		const finish = held.reserve_response({ rid: 'overview', key: 'test' });
		const val = { network_score: [[1, 0]] };
		admin.notify_change({}, 'test', 'score', val);
		val.network_score[0][0] = 2; admin.notify_change({}, 'test', 'score', val);
		assert.deepStrictEqual(held.messages, []);
		assert.deepStrictEqual(live.messages.map(message => message.val.network_score), [[[1, 0]], [[2, 0]]]);
		finish(null, { tournament: { matches: [] } }); await tick();
		assert.strictEqual(held.messages[0].rid, 'overview');
		assert.deepStrictEqual(held.messages.slice(1), live.messages);
	});
	it('keeps legacy recipients, rollback mode, probe exclusion and announcement metadata compatible', function() {
		const shared = socket(), probe = socket(); probe.performance_probe = true;
		const legacy = new EventEmitter(); legacy.messages = []; legacy.sendmsg = message => legacy.messages.push(message);
		admin.on_connect({}, legacy); legacy.on('close', () => admin.on_close({}, legacy)); sockets.push(legacy);
		const notifications = [], app = { clock: { now_ms: () => 123 }, speech: { changed: (...args) => notifications.push(args) } };
		for (const enabled of ['1', '0']) {
			process.env.BTS_ADMIN_BROADCAST_SHARED = enabled;
			admin.notify_change(app, 'test', 'free_announce', { text: 'Test' });
		}
		assert.deepStrictEqual(shared.messages, legacy.messages); assert.strictEqual(shared.messages.length, 2);
		assert.strictEqual(shared.messages[0].val._announcement_ts, 123);
		assert.deepStrictEqual(probe.messages, []); assert.strictEqual(notifications.length, 2);
	});
	it('retains delivery metadata, continues other sockets after a disconnect, and drops closed queues', function() {
		const held = socket(), live = socket(), delivery = [];
		held.reserve_response({ rid: 'closed', key: 'test' }); live.on('bts:message_sent', details => delivery.push(details));
		admin.notify_change({}, 'test', 'events', { text: 'Ä🏸' });
		assert.strictEqual(delivery.length, 1); assert.strictEqual(delivery[0].ctype, 'events');
		assert.strictEqual(delivery[0].bytes, Buffer.byteLength(live.raw[0])); assert(delivery[0].elapsed_ms >= 0);
		held.readyState = 3; held.emit('close'); sockets.splice(sockets.indexOf(held), 1);
		admin.notify_change({}, 'test', 'score', { network_score: [[3, 0]] });
		assert.strictEqual(live.messages.length, 2); assert.deepStrictEqual(held.messages, []);
		assert.strictEqual(held.outbox_stats().pending, 0);
	});
	it('does not encode without recipients and reports encoding failure before delivering a partial broadcast', function() {
		const circular = {}; circular.self = circular;
		admin.notify_change({}, 'test', 'events', circular);
		const first = socket(), second = socket();
		assert.throws(() => admin.notify_change({}, 'test', 'events', circular), /circular/i);
		assert.deepStrictEqual(first.messages, []); assert.deepStrictEqual(second.messages, []);
		admin.notify_change({}, 'test', 'score', { network_score: [[1, 0]] });
		assert.strictEqual(first.messages.length, 1); assert.strictEqual(second.messages.length, 1);
	});
	it('preserves each outbox reservation when a shared update is used directly', async function() {
		const ws = new EventEmitter(); ws.readyState = 1; const messages = [];
		ws.send = bytes => messages.push(JSON.parse(bytes));
		const output = outbox(ws), reservation = output.reserve();
		output.shared(outbox.prepare_broadcast({ type: 'change', ctype: 'score', val: [[4, 0]] }));
		output.send({ type: 'change', ctype: 'score', val: [[5, 0]] });
		output.complete(reservation, { type: 'answer', rid: 1 }); await tick();
		assert.deepStrictEqual(messages.map(message => message.val || message.rid), [1, [[4, 0]], [[5, 0]]]); ws.emit('close');
	});
	it('sends text frames with unchanged bytes over real server WebSockets to multiple clients', async function() {
		const server = http.createServer(), wss = new WebSocket.Server({ server });
		const clients = [];
		wss.on('connection', ws => wshandler.handle(admin, {}, ws));
		try {
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			const received = [];
			for (let i = 0; i < 3; i++) {
				const client = new WebSocket('ws://127.0.0.1:' + server.address().port); clients.push(client);
				received.push(new Promise(resolve => client.once('message', (bytes, binary) => resolve({
					bytes: bytes.toString(), text: typeof bytes === 'string' || binary === false,
				}))));
				await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
			}
			const val = { text: 'Ä🏸', entries: Array.from({ length: 2000 }, (_, i) => ({ id: i, text: 'Rangliste' })) };
			admin.notify_change({}, 'test', 'events', val);
			const expected = JSON.stringify({ type: 'change', tournament_key: 'test', ctype: 'events', val });
			for (const response of await Promise.all(received)) { assert.strictEqual(response.bytes, expected); assert.strictEqual(response.text, true); }
		} finally {
			for (const client of clients) client.terminate(); for (const ws of wss.clients) ws.terminate();
			await new Promise(resolve => wss.close(resolve)); if (server.listening) await new Promise(resolve => server.close(resolve));
		}
	});
});
