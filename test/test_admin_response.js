'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const outbox = require('../bts/admin_response/outbox');
const encoder = require('../bts/admin_response/encoder');
const wshandler = require('../bts/wshandler');
const foreground = require('../bts/foreground_work');

function socket() {
	const ws = new EventEmitter();
	ws.readyState = 1; ws.messages = [];
	ws.send = (bytes, options) => { assert.strictEqual(options.binary, false); ws.messages.push(JSON.parse(bytes.toString())); };
	return ws;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('background admin response output', function() {
	after(() => encoder.close());
	it('preserves full preparation diagnostic JSON while allowing other work between diagnostic rows', async function() {
		const rows = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [i, { match_id: i, rules: [
			{ enabled: true, description: 'Pausenprüfung 🏸', optional: undefined, date: new Date(0) },
		] }]));
		const message = { selections: [undefined, null, { toJSON(key) { return { key }; } }, {
			location_id: 'hall', diagnostics_by_match_id: rows, call_on_court_diagnostics_by_match_id: {},
		}], rid: 1, type: 'answer' };
		let yielded = false; setImmediate(() => { yielded = true; });
		assert.strictEqual(await require('../bts/admin_response/cooperative')(message), JSON.stringify(message));
		assert(yielded);
	});
	it('produces the same JSON bytes including Dates, Unicode, undefined and special numeric values', async function() {
		const message = { type: 'answer', rid: 'one', nested: [{ date: new Date(1000), name: 'Ä羽毛🏸', absent: undefined, nan: NaN }], missing: undefined };
		const previous = process.env.BTS_ADMIN_RESPONSE_ENCODER;
		try {
			for (const mode of ['worker', 'cooperative']) {
				process.env.BTS_ADMIN_RESPONSE_ENCODER = mode;
				const result = await encoder.encode(message);
				assert.strictEqual(result.execution, mode);
				assert.strictEqual(Buffer.from(result.bytes).toString('utf8'), JSON.stringify(message));
				assert.strictEqual(Buffer.from((await encoder.encode({ next: true })).bytes).toString(), '{"next":true}');
			}
		} finally {
			if (previous === undefined) delete process.env.BTS_ADMIN_RESPONSE_ENCODER; else process.env.BTS_ADMIN_RESPONSE_ENCODER = previous;
		}
	});
	it('preserves exact tournament JSON including array slots and key-sensitive toJSON, while yielding for other work', async function() {
		const encode = require('../bts/admin_response/cooperative');
		const message = { tournament: { name: 'Test', matches: [undefined, null, { date: new Date(1000), nan: NaN, undefined: undefined },
			{ toJSON(key) { return { key }; } }, ...Array.from({ length: 2000 }, (_, i) => ({ id: i, presses: Array.from({ length: 20 }, (_, j) => ({ type: 'point', timestamp: j })) }))],
			events: { date: new Date(2000) }, absent: undefined }, rid: 'overview', type: 'answer' };
		let yielded = false;
		setImmediate(() => { yielded = true; });
		assert.strictEqual(await encode(message), JSON.stringify(message));
		assert(yielded);
		const circular = {}; circular.self = circular;
		await assert.rejects(encode({ tournament: { matches: [circular] } }), /circular/i);
	});
	it('encodes complete performance trace replies in bounded turns with native JSON semantics', async function() {
		const encode = require('../bts/admin_response/cooperative');
		const message = { type: 'answer', rid: 'probe', performance: { ts: 1,
			database: [undefined, { date: new Date(1000) }], processing: {
				active: [{ toJSON(key) { return { key }; } }],
				completed: Array.from({ length: 2000 }, (_, id) => ({ id,
					spans: Array.from({ length: 30 }, (_, index) => ({ index, name: 'step', duration_ms: .1 })),
				})), stages: [null, { count: 2 }],
			},
		} };
		let yielded = false;
		setImmediate(() => { yielded = true; });
		assert.strictEqual(await encode(message), JSON.stringify(message));
		assert.strictEqual(yielded, true);
	});

	it('pauses background copying/encoding until all running point tasks finish and releases on failures', async function() {
		const previous = process.env.BTS_ADMIN_RESPONSE_PRIORITY;
		process.env.BTS_ADMIN_RESPONSE_PRIORITY = '1';
		const first = foreground.begin('handle_score_update'), second = foreground.begin('handle_score_update_v2');
		try {
			assert.strictEqual(foreground.begin('sync'), null);
			let encoded = false;
			const encoding = encoder.encode({ tournament: { matches: [{ score: 1 }] } }).then(result => { encoded = true; return result; });
			await tick(); assert.strictEqual(encoded, false);
			first(); first(); await tick(); assert.strictEqual(encoded, false);
			second(); await encoding; assert.strictEqual(encoded, true);
			const { ResourceLockQueue } = require('../bts/resource_lock_queue');
			const queue = new ResourceLockQueue(), update_queue = require('../bts/update_queue');
			await assert.rejects(queue.execute(update_queue.named('handle_score_update_v2', async () => {
				assert(foreground.busy()); throw new Error('score failed');
			}), { locks: ['court:test:1'] }), /score failed/);
			assert.strictEqual(foreground.busy(), false);
		} finally {
			first(); second();
			if (previous === undefined) delete process.env.BTS_ADMIN_RESPONSE_PRIORITY; else process.env.BTS_ADMIN_RESPONSE_PRIORITY = previous;
		}
	});
	it('resumes admin work after point publication while finish cleanup still holds its resource locks', async function() {
		const previous = process.env.BTS_ADMIN_RESPONSE_PRIORITY;
		process.env.BTS_ADMIN_RESPONSE_PRIORITY = '1';
		const { ResourceLockQueue } = require('../bts/resource_lock_queue'), update_queue = require('../bts/update_queue');
		const queue = new ResourceLockQueue(); let release_cleanup, published;
		const cleanup = new Promise(resolve => { release_cleanup = resolve; });
		const point = new Promise(resolve => { published = resolve; });
		const running = queue.execute(update_queue.named('handle_score_update_v2', async () => {
			assert(foreground.busy()); foreground.release(); published(); await cleanup;
		}), { locks: ['court:test:one'] });
		try {
			await point;
			assert.strictEqual(foreground.busy(), false);
			await encoder.encode({ tournament: { matches: [] } });
			assert.strictEqual(queue.stats().active, true);
		} finally {
			release_cleanup(); await running;
			if (previous === undefined) delete process.env.BTS_ADMIN_RESPONSE_PRIORITY; else process.env.BTS_ADMIN_RESPONSE_PRIORITY = previous;
		}
	});
	it('retains CPU priority until asynchronous display publication, without retaining court locks or waiting for itself', async function() {
		const previous = process.env.BTS_ADMIN_RESPONSE_PRIORITY;
		process.env.BTS_ADMIN_RESPONSE_PRIORITY = '1';
		const { ResourceLockQueue } = require('../bts/resource_lock_queue'), update_queue = require('../bts/update_queue');
		const queue = new ResourceLockQueue();
		let release, delivery;
		const handed_off = new Promise(resolve => { release = resolve; });
		try {
			await queue.execute(update_queue.named('handle_score_update_v2', () => {
				delivery = foreground.publication(async () => {
					await foreground.background_idle();
					await handed_off;
				});
				foreground.release();
			}), { locks: ['court:test:publication'] });
			assert.strictEqual(queue.stats().active, false);
			assert.strictEqual(foreground.busy(), true);
			let encoded = false;
			const background = encoder.encode({ tournament: { matches: [] } }).then(() => { encoded = true; });
			await tick(); assert.strictEqual(encoded, false);
			release(); await delivery; await background;
			assert.strictEqual(foreground.busy(), false);
		} finally {
			release(); await delivery;
			if (previous === undefined) delete process.env.BTS_ADMIN_RESPONSE_PRIORITY; else process.env.BTS_ADMIN_RESPONSE_PRIORITY = previous;
		}
	});
	it('releases display publication priority after rejection or synchronous failure', async function() {
		const end = foreground.begin('handle_score_update_v2');
		try {
			const failure = new Error('display failed');
			await assert.rejects(foreground.run(end, () => foreground.publication(() => Promise.reject(failure))), error => error === failure);
			assert.throws(() => foreground.run(end, () => foreground.publication(() => { throw failure; })), error => error === failure);
		} finally { end(); }
		assert.strictEqual(foreground.busy(), false);
	});
	it('holds later updates behind the snapshot, freezes them, and leaves another socket independent', async function() {
		const ws = socket(), other = socket();
		let release;
		const output = outbox(ws, message => new Promise(resolve => { release = () => resolve(Uint8Array.from(Buffer.from(JSON.stringify(message))).buffer); }));
		output.large({ type: 'answer', rid: 'overview', value: 'old' });
		const update = { type: 'change', value: 'new' };
		output.send(update); update.value = 'mutated';
		outbox(other).send({ type: 'score', value: 1 });
		await tick();
		assert.deepStrictEqual(ws.messages, []);
		assert.deepStrictEqual(other.messages, [{ type: 'score', value: 1 }]);
		release(); await tick();
		assert.deepStrictEqual(ws.messages, [{ type: 'answer', rid: 'overview', value: 'old' }, { type: 'change', value: 'new' }]);
	});
	it('orders multiple snapshots and intervening updates without a later worker overtaking an earlier one', async function() {
		const ws = socket(), jobs = [];
		const output = outbox(ws, message => new Promise(resolve => jobs.push(() => resolve(Uint8Array.from(Buffer.from(JSON.stringify(message))).buffer))));
		output.large({ rid: 1 }); output.send({ update: 1 }); output.large({ rid: 2 }); output.send({ update: 2 });
		await tick(); assert.strictEqual(jobs.length, 1);
		jobs[0](); await tick(); assert.strictEqual(jobs.length, 2);
		assert.deepStrictEqual(ws.messages, [{ rid: 1 }, { update: 1 }]);
		jobs[1](); await tick();
		assert.deepStrictEqual(ws.messages, [{ rid: 1 }, { update: 1 }, { rid: 2 }, { update: 2 }]);
	});
	it('reserves the response before asynchronous reads so live updates during copying cannot overtake it', async function() {
		const ws = socket();
		wshandler.handle({ on_connect() {}, on_close() {} }, {}, ws);
		const respond = ws.reserve_response({ rid: 'overview', key: 'default' });
		ws.sendmsg({ type: 'change', ctype: 'score', value: 'new' });
		await tick(); assert.deepStrictEqual(ws.messages, []);
		respond(null, { tournament: { matches: [{ value: 'old' }] } });
		await tick();
		assert.deepStrictEqual(ws.messages, [{ tournament: { matches: [{ value: 'old' }] }, type: 'answer', rid: 'overview' },
			{ type: 'change', ctype: 'score', value: 'new' }]);
		const failed = ws.reserve_response({ rid: 'error' });
		ws.sendmsg({ later: true }); failed(new Error('read failed'));
		assert.deepStrictEqual(ws.messages.slice(-2), [{ type: 'error', rid: 'error', message: 'read failed' }, { later: true }]);
		failed(new Error('duplicate callback')); assert.strictEqual(ws.messages.length, 4);
	});
	it('preserves the response and ordering when the worker fails', async function() {
		const warn = console.warn, warnings = [], previous = process.env.BTS_SERVER_DIAGNOSTICS;
		console.warn = message => warnings.push(message);
		try {
			for (const detailed of [false, true]) {
				process.env.BTS_SERVER_DIAGNOSTICS = detailed ? '1' : '0'; warnings.length = 0;
				const ws = socket(), output = outbox(ws, () => Promise.reject(new Error('test crash')));
				output.large({ rid: 'fallback', date: new Date(1000) }); output.send({ update: true });
				await tick();
				assert.deepStrictEqual(ws.messages, [{ rid: 'fallback', date: new Date(1000).toJSON() }, { update: true }]);
				assert.strictEqual(warnings.length, detailed ? 1 : 0);
			}
		} finally {
			console.warn = warn;
			if (previous === undefined) delete process.env.BTS_SERVER_DIAGNOSTICS; else process.env.BTS_SERVER_DIAGNOSTICS = previous;
		}
	});
	it('discards queued output after disconnect, including pending failures', async function() {
		for (const failure of [false, true]) {
			const ws = socket(); let complete;
			const output = outbox(ws, () => new Promise((resolve, reject) => { complete = () => failure ? reject(new Error('closed')) : resolve(new ArrayBuffer(0)); }));
			output.large({ rid: 1 }); output.send({ update: true }); await tick();
			ws.readyState = 3; ws.emit('close'); complete(); await tick(); output.send({ late: true });
			assert.deepStrictEqual(ws.messages, []);
		}
	});
	it('keeps response IDs, ordinary responses and errors compatible with the WebSocket handler', async function() {
		const ws = socket();
		wshandler.handle({ on_connect() {}, on_close() {} }, {}, ws);
		ws.respond({ rid: 1 }); ws.respond_background({ rid: 2 }, new Error('failed'));
		ws.respond_background({ rid: 3, key: 'default' }, null, { tournament: { name: 'Test' } });
		ws.sendmsg({ type: 'change', ctype: 'score' });
		while (ws.messages.length < 4) await tick();
		assert.deepStrictEqual(ws.messages, [{ status: 'ok', type: 'answer', rid: 1 }, { type: 'error', message: 'failed', rid: 2 },
			{ tournament: { name: 'Test' }, type: 'answer', rid: 3 }, { type: 'change', ctype: 'score' }]);
	});
});
