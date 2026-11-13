'use strict';

const assert = require('assert'), { EventEmitter } = require('events');
const { promisify } = require('util');
const encode = require('../bts/admin_response/cooperative');
const outbox = require('../bts/admin_response/outbox');
const database = require('../bts/database');
const { read_matches } = require('../bts/admin_match_data');
const cache = require('../bts/admin_response/match_cache');
const selection_cache = require('../bts/admin_response/selection_cache');
const read = (db, defer = false) => new Promise((resolve, reject) => read_matches(db, 'default', defer,
	(error, rows) => error ? reject(error) : resolve(rows), { immutable: true }));
const message = matches => ({ type: 'answer', tournament: { matches } });

describe('admin response UTF-8 byte assembly', function() {
	it('preserves all native JSON semantics and Unicode without changing the string API', async function() {
		const value = { type: 'answer', tournament: {
			matches: [{ _id: 'g', setup: { name: 'Grün · 李 🏸', scoring_format: { sets: 3 } },
				presses: [{ type: 'point', timestamp: 1 }], network_score: [[21, 19]] }],
			date: new Date(1234), invalidDate: new Date(NaN), skipped: undefined, zero: -0,
			values: [undefined, NaN, Infinity, null, 'a\\b\nc'],
			custom: { toJSON(key) { return { key, value: 'Ä' }; } },
		}, selections: [{ diagnostics_by_match_id: { g: { ok: true } } }] };
		delete value.tournament.values[3];
		const expected = JSON.stringify(value), bytes = await encode.bytes(value);
		assert(Buffer.isBuffer(bytes)); assert.strictEqual(bytes.toString('utf8'), expected);
		assert.strictEqual(await encode(value), expected);
	});
	it('preserves certified event and selection fragments in both encoder APIs', async function() {
		const events = cache.snapshot({ events: [{ name: 'Grün 🏸', id: 'a' }] }, false);
		const selections = selection_cache.certify([{ diagnostics_by_match_id: { g: { ok: true } } }]);
		const value = { tournament: { matches: [], events }, selections };
		for (let i = 0; i < 3; i++) {
			assert.strictEqual((await encode.bytes(value)).toString('utf8'), JSON.stringify(value));
			assert.strictEqual(await encode(value), JSON.stringify(value));
		}
	});
	it('retains the native root toJSON key, primitive values, and omitted root values', async function() {
		for (const value of [null, 'Grün 🏸', 42, true, [undefined, 1], { toJSON(key) { return { key }; } }]) {
			assert.strictEqual((await encode.bytes(value)).toString('utf8'), JSON.stringify(value));
		}
		assert.strictEqual(await encode.bytes(undefined), undefined);
		assert.strictEqual(await encode.bytes(() => {}), undefined);
	});
	it('keeps captured match revisions stable and never aliases its returned reply to cached bytes', async function() {
		const db = await database.init_test();
		await promisify(db.matches.insert.bind(db.matches))({ _id: 'g', tournament_key: 'default',
			setup: { state: 'oncourt' }, presses: [{ type: 'point', timestamp: 1 }], network_score: [[1, 0]] });
		const old = message(await read(db)), expected = JSON.stringify(old);
		const first = await encode.bytes(old); first.fill(32);
		assert.strictEqual((await encode.bytes(old)).toString('utf8'), expected);
		await db.matches.update_async({ _id: 'g' }, { $set: { network_score: [[2, 0]], presses: [{ type: 'point', timestamp: 2 }] } }, {});
		assert.strictEqual((await encode.bytes(old)).toString('utf8'), expected);
		const current = message(await read(db));
		assert.strictEqual((await encode.bytes(current)).toString('utf8'), JSON.stringify(current));
		assert.deepStrictEqual(current.tournament.matches[0].network_score, [[2, 0]]);
	});
	it('retains complete histories unless their caller explicitly requested deferred history', async function() {
		const db = await database.init_test();
		await promisify(db.matches.insert.bind(db.matches))({ _id: 'done', tournament_key: 'default',
			setup: { state: 'finished', now_on_court: false }, presses: [{ type: 'point', timestamp: 8 }] });
		const full = message(await read(db)), light = message(await read(db, true));
		assert.deepStrictEqual(JSON.parse(await encode.bytes(full)).tournament.matches[0].presses, [{ type: 'point', timestamp: 8 }]);
		const limited = JSON.parse(await encode.bytes(light)).tournament.matches[0];
		assert.strictEqual(limited.presses, undefined); assert.strictEqual(limited.presses_deferred, true);
	});
	it('does not cache caller-owned mutable values or suppress native encoding errors', async function() {
		const value = message([{ _id: 'mutable', network_score: [[1, 0]] }]);
		await encode.bytes(value); value.tournament.matches[0].network_score[0][0] = 2;
		assert.strictEqual((await encode.bytes(value)).toString('utf8'), JSON.stringify(value));
		const cyclic = {}; cyclic.self = cyclic;
		await assert.rejects(encode.bytes(cyclic), /circular/i);
		await assert.rejects(encode.bytes({ value: 1n }), /BigInt/);
	});
	it('sends the actual byte-encoded large reply as text before a later score update', async function() {
		const previous = process.env.BTS_ADMIN_RESPONSE_ENCODER;
		process.env.BTS_ADMIN_RESPONSE_ENCODER = 'cooperative';
		const socket = new EventEmitter(), sent = [];
		socket.readyState = 1; socket.send = (bytes, options) => sent.push({ bytes, options });
		try {
			const queue = outbox(socket), first = message([{ _id: 'g', network_score: [[1, 0]] }]);
			const next = { type: 'change', ctype: 'score', val: { match_id: 'g', network_score: [[2, 0]] } };
			queue.large(first, 'default'); queue.send(next);
			for (let i = 0; i < 100 && sent.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(sent.length, 2); assert(Buffer.isBuffer(sent[0].bytes));
			assert.strictEqual(sent[0].options.binary, false);
			assert.deepStrictEqual(JSON.parse(sent[0].bytes), first); assert.deepStrictEqual(JSON.parse(sent[1].bytes), next);
		} finally {
			socket.emit('close');
			if (previous === undefined) delete process.env.BTS_ADMIN_RESPONSE_ENCODER;
			else process.env.BTS_ADMIN_RESPONSE_ENCODER = previous;
		}
	});
});
