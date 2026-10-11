'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { promisify } = require('util');
const DecodePool = require('../bts/btp_decode/pool');
const proto = require('../bts/btp_proto');

class FakeWorker extends EventEmitter {
	constructor() { super(); this.messages = []; this.references = 0; }
	ref() { this.references++; }
	unref() { this.references--; }
	postMessage(job) { this.messages.push(job); }
	terminate() { this.terminated = true; return Promise.resolve(0); }
	reply(response) { this.emit('message', { id: this.messages.at(-1).id, response }); }
}

describe('BTP bulk decoder worker', function() {
	let pool, workers;
	beforeEach(function() {
		workers = [];
		pool = new DecodePool({ create_worker: () => {
			const worker = new FakeWorker(); workers.push(worker); return worker;
		}, max_pending: 2 });
	});
	afterEach(function() { pool.close(); });
	it('keeps FIFO request association and reuses an idle worker', function() {
		const replies = [];
		for (const key of ['a', 'b', 'c']) pool.decode(Buffer.from(key), { tournament_key: key }, (err, value) => {
			assert.ifError(err); replies.push([key, value]);
		});
		assert.strictEqual(workers.length, 1);
		assert.strictEqual(workers[0].messages.length, 1);
		workers[0].reply(1); workers[0].reply(2); workers[0].reply(3);
		assert.deepStrictEqual(replies, [['a', 1], ['b', 2], ['c', 3]]);
		assert.strictEqual(workers[0].references, 0);
		pool.decode(Buffer.from('d'), {}, err => assert.ifError(err));
		workers[0].reply(4);
		assert.strictEqual(workers.length, 1);
	});
	it('removes a queued cancellation without interrupting another connection', function() {
		pool.decode(Buffer.from('a'), {}, err => assert.ifError(err));
		const cancel = pool.decode(Buffer.from('b'), {}, () => assert.fail('cancelled callback'));
		cancel();
		workers[0].reply('a');
		assert.strictEqual(workers[0].messages.length, 1);
		assert(!workers[0].terminated);
	});
	it('interrupts an active cancellation and preserves other connections queued behind it', function() {
		const cancel = pool.decode(Buffer.from('a'), {}, () => assert.fail('cancelled callback'));
		let reply;
		pool.decode(Buffer.from('b'), {}, (err, value) => { assert.ifError(err); reply = value; });
		cancel(); cancel();
		assert(workers[0].terminated);
		assert.strictEqual(workers.length, 2);
		workers[0].reply('late'); workers[0].emit('exit', 1);
		workers[1].reply('b');
		assert.strictEqual(reply, 'b');
	});
	it('fails a crashed request once and recreates a worker for the next request', function() {
		let failures = 0, success = 0;
		pool.decode(Buffer.alloc(4), {}, err => { assert.match(err.message, /crash/); failures++; });
		pool.decode(Buffer.alloc(4), {}, err => { assert.ifError(err); success++; });
		workers[0].emit('error', new Error('crash')); workers[0].emit('exit', 1);
		workers[1].reply('ok');
		assert.strictEqual(failures, 1); assert.strictEqual(success, 1);
	});
	it('recovers from a dispatch failure without confusing following callbacks', async function() {
		pool.create_worker = () => { throw new Error('cannot create worker'); };
		const first = new Promise(resolve => pool.decode(Buffer.alloc(4), {}, resolve));
		assert.match((await first).message, /cannot create/);
		pool.create_worker = () => { const worker = new FakeWorker(); workers.push(worker); return worker; };
		const second = new Promise((resolve, reject) => pool.decode(Buffer.alloc(4), {}, err => err ? reject(err) : resolve()));
		workers[0].reply('ok'); await second;
	});
	it('bounds the pending queue and releases outstanding requests on shutdown', async function() {
		let closed = 0;
		for (let i = 0; i < 3; i++) pool.decode(Buffer.alloc(4), {}, err => {
			assert.match(err.message, /closed/); closed++;
		});
		const rejected = new Promise(resolve => pool.decode(Buffer.alloc(4), {}, resolve));
		assert.match((await rejected).message, /queue full/);
		pool.close();
		assert.strictEqual(closed, 3); assert(workers[0].terminated);
		const after = await new Promise(resolve => pool.decode(Buffer.alloc(4), {}, resolve));
		assert.match(after.message, /closed/);
	});
	it('preserves actual protocol types and repeated nodes, even from a pooled buffer slice', async function() {
		pool.close(); pool = new DecodePool();
		const xml = '<ROOT><ITEM ID="Name" TYPE="String">Müller &amp; Weiß</ITEM>' +
			'<ITEM ID="ID" TYPE="Integer">12</ITEM><ITEM ID="ID" TYPE="Integer">13</ITEM>' +
			'<ITEM ID="Ratio" TYPE="Float">1.5</ITEM><ITEM ID="Ready" TYPE="Bool">false</ITEM>' +
			'<ITEM ID="Time" TYPE="DateTime"><DATETIME Y="2026" MM="10" D="10" H="12" M="34" S="56" MS="78"/></ITEM></ROOT>';
		const packet = proto.encode_xml(xml);
		const backing = Buffer.allocUnsafe(packet.length + 30);
		backing.fill(42); packet.copy(backing, 15);
		const before = Buffer.from(backing);
		const input = backing.subarray(15, 15 + packet.length);
		const expected = await promisify(proto.decode)(input);
		const decode = () => new Promise((resolve, reject) => pool.decode(input, {}, (err, value) => err ? reject(err) : resolve(value)));
		assert.deepStrictEqual(await decode(), expected);
		const worker = pool.worker;
		assert.deepStrictEqual(await decode(), expected);
		assert.strictEqual(pool.worker, worker);
		assert.deepStrictEqual(backing, before);
	});
	it('reports malformed headers, gzip and unsupported types, then accepts the next response', async function() {
		pool.close(); pool = new DecodePool();
		const inputs = [Buffer.alloc(1), Buffer.from([0, 0, 0, 3, 1, 2, 3]),
			proto.encode_xml('<ROOT><ITEM ID="Private" TYPE="Unsupported">Secret</ITEM></ROOT>')];
		for (const input of inputs) {
			const error = await new Promise(resolve => pool.decode(input, {}, resolve));
			assert(error instanceof Error);
		}
		const result = await new Promise((resolve, reject) => pool.decode(proto.encode_xml('<ROOT/>'), {}, (err, value) => err ? reject(err) : resolve(value)));
		assert.deepStrictEqual(result, {});
	});
	it('honors diagnostic changes for each request on the same worker without exposing payloads', async function() {
		pool.close(); pool = new DecodePool();
		const previous = process.env.BTS_BTP_SYNC_TIMING, warn = console.warn, records = [];
		try {
			console.warn = line => records.push(line);
			const input = proto.encode_xml('<ROOT><ITEM ID="Name" TYPE="String">Secret</ITEM></ROOT>');
			const run = () => new Promise((resolve, reject) => pool.decode(input, { action: 'SENDTOURNAMENTINFO' }, (err, value) => err ? reject(err) : resolve(value)));
			process.env.BTS_BTP_SYNC_TIMING = '1'; await run();
			const worker = pool.worker;
			process.env.BTS_BTP_SYNC_TIMING = '0'; await run();
			assert.strictEqual(pool.worker, worker); assert.strictEqual(records.length, 1);
			assert(!records[0].includes('Secret'));
		} finally {
			console.warn = warn;
			if (previous === undefined) delete process.env.BTS_BTP_SYNC_TIMING;
			else process.env.BTS_BTP_SYNC_TIMING = previous;
		}
	});
});
