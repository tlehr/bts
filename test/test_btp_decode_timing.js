'use strict';

const assert = require('assert');
const net = require('net');
const { EventEmitter } = require('events');
const { promisify } = require('util');
const zlib = require('zlib');
const proto = require('../bts/btp_proto');
const { BTPConn } = require('../bts/btp_conn');
const serror = require('../bts/serror');
const bulk_decoder = require('../bts/btp_decode');

function packet(xml) {
	const compressed = zlib.gzipSync(Buffer.from(xml));
	const header = Buffer.alloc(4);
	header.writeInt32BE(compressed.length, 0);
	return Buffer.concat([header, compressed]);
}
const XML = '<ROOT><GROUP ID="Result"><GROUP ID="Tournament">' +
	'<ITEM ID="Name" TYPE="String">Müller &amp; Weiß</ITEM>' +
	'<GROUP ID="Matches"><GROUP ID="Match"><ITEM ID="ID" TYPE="Integer">12</ITEM>' +
	'<ITEM ID="Ready" TYPE="Bool">true</ITEM></GROUP>' +
	'<GROUP ID="Match"><ITEM ID="ID" TYPE="Integer">13</ITEM>' +
	'<ITEM ID="Duration" TYPE="Float">1.5</ITEM></GROUP></GROUP>' +
	'</GROUP></GROUP></ROOT>';
const EXPECTED = { Result: [{ Tournament: [{ Name: ['Müller & Weiß'], Matches: [{ Match: [
	{ ID: [12], Ready: [true] }, { ID: [13], Duration: [1.5] },
] }] }] }] };

describe('BTP response decoder timing', function() {
	let previous_flag, warn, silent, connect, records;
	beforeEach(function() {
		previous_flag = process.env.BTS_BTP_SYNC_TIMING;
		process.env.BTS_BTP_SYNC_TIMING = '1';
		warn = console.warn; silent = serror.silent; connect = net.connect;
		records = [];
		console.warn = line => records.push(JSON.parse(line.split('btp_fetch:response_decode ')[1]));
		serror.silent = () => {};
	});
	afterEach(function() {
		bulk_decoder.close();
		console.warn = warn; serror.silent = silent; net.connect = connect;
		if (previous_flag === undefined) delete process.env.BTS_BTP_SYNC_TIMING;
		else process.env.BTS_BTP_SYNC_TIMING = previous_flag;
	});
	it('preserves typed values, repeated nodes and UTF-8, with and without diagnostics', async function() {
		const input = packet(XML);
		assert.deepStrictEqual(await promisify(proto.decode)(input), EXPECTED);
		assert.strictEqual(records.length, 1);
		const record = records[0];
		assert.deepStrictEqual(record.phases.map(p => p.phase), ['decompress', 'utf8', 'xml_parse', 'object_conversion']);
		assert(record.phases.every(p => p.status === 'ok' && p.duration_ms >= 0 && p.cpu_ms >= 0));
		assert(record.duration_ms + 0.3 >= record.phases.reduce((sum, p) => sum + p.duration_ms, 0));
		assert(record.cpu_user_ms >= 0 && record.cpu_system_ms >= 0);
		assert(record.ts >= record.start_ts);
		assert.strictEqual(record.xml_bytes, Buffer.byteLength(XML));
		assert.strictEqual(record.packet_bytes, input.length);
		assert.strictEqual(record.compressed_bytes, input.length - 4);
		assert.strictEqual(record.status, 'ok');
		assert(!JSON.stringify(record).includes('Müller'));
		delete process.env.BTS_BTP_SYNC_TIMING;
		assert.deepStrictEqual(await promisify(proto.decode)(input), EXPECTED);
		assert.strictEqual(records.length, 1);
	});
	it('finishes before caller callback work and preserves a callback exception without duplicate logging', function() {
		const failure = new Error('callback failed');
		assert.throws(() => proto.decode(packet(XML), (err, response) => {
			assert.ifError(err);
			assert.deepStrictEqual(response, EXPECTED);
			assert.strictEqual(records.length, 1, 'timing must already be complete at callback entry');
			throw failure;
		}), error => error === failure);
		assert.strictEqual(records.length, 1);
		assert.strictEqual(records[0].status, 'ok');
	});
	it('retains header errors through the callback', function() {
		for (const input of [Buffer.alloc(1), Buffer.alloc(5)]) {
			let calls = 0;
			proto.decode(input, err => { calls++; assert(err instanceof Error); });
			assert.strictEqual(calls, 1);
		}
		assert(records.every(r => r.status === 'error' && r.failed_phase === 'header' && r.phases.length === 0));
	});
	it('retains thrown gzip errors and identifies the failed decoder phase', function() {
		const input = Buffer.from([0, 0, 0, 3, 1, 2, 3]);
		let called = false;
		assert.throws(() => proto.decode(input, () => { called = true; }));
		assert.strictEqual(called, false);
		assert.strictEqual(records.length, 1);
		assert.strictEqual(records[0].failed_phase, 'decompress');
		assert.strictEqual(records[0].phases[0].status, 'error');
	});
	it('retains object conversion errors through the callback and omits response contents', function() {
		let calls = 0;
		proto.decode(packet('<ROOT><ITEM ID="PrivateName" TYPE="Unsupported">Secret</ITEM></ROOT>'), err => {
			calls++; assert.match(err.message, /Unsupported BTP item type/);
		});
		assert.strictEqual(calls, 1);
		assert.strictEqual(records.length, 1);
		assert.strictEqual(records[0].failed_phase, 'object_conversion');
		assert(!JSON.stringify(records[0]).includes('PrivateName'));
		assert(!JSON.stringify(records[0]).includes('Secret'));
	});
	it('preserves a successful decode if the diagnostic log sink throws', function() {
		console.warn = () => { throw new Error('broken sink'); };
		let calls = 0;
		proto.decode(packet(XML), (err, value) => { calls++; assert.ifError(err); assert.deepStrictEqual(value, EXPECTED); });
		assert.strictEqual(calls, 1);
	});
	it('carries the tournament and action through the real connection send path without a network connection', async function() {
		const input = packet(XML);
		net.connect = (options, ready) => {
			const socket = new EventEmitter();
			socket.setTimeout = () => {}; socket.write = () => {};
			setImmediate(() => {
				ready(); socket.emit('data', input.subarray(0, 9));
				socket.emit('data', input.subarray(9)); socket.emit('end');
			});
			return socket;
		};
		const conn = Object.assign(Object.create(BTPConn.prototype), { tkey: 'timing-test', ip: 'test-only', timeZone: 'Europe/Berlin' });
		const response = await new Promise(resolve => conn.send(proto.get_info_request('secret-password'), resolve));
		assert.deepStrictEqual(response, EXPECTED);
		assert.strictEqual(records.length, 1);
		assert.strictEqual(records[0].tournament_key, 'timing-test');
		assert.strictEqual(records[0].action, 'SENDTOURNAMENTINFO');
		assert.strictEqual(records[0].execution, 'worker');
		for (const key of ['queue_wait_ms', 'dispatch_ms', 'input_wait_ms', 'return_delivery_ms', 'decode_roundtrip_ms']) {
			assert(records[0][key] >= 0, key);
		}
		assert(!JSON.stringify(records[0]).includes('secret-password'));
	});
});
