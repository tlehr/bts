'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Timer tasks are held, as with a heavily throttled background tab. Message
// tasks remain independently runnable. Execute the actual browser entrypoints.
function browser(use_channel = true) {
	const tasks = [], timers = new Map(), listeners = new Map(), handled = [];
	let timer_id = 0, now = 0;
	const listen = (name, callback) => {
		if (!listeners.has(name)) listeners.set(name, []);
		listeners.get(name).push(callback);
	};
	const document = { hidden: true, addEventListener: listen };
	const window = { document, addEventListener: listen };
	if (use_channel) window.MessageChannel = class {
		constructor() {
			this.port1 = {};
			this.port2 = { postMessage: data => tasks.push(() => this.port1.onmessage({ data })) };
		}
	};
	const context = vm.createContext({
		window, document, console, debug: { log() {} },
		performance: { now: () => now },
		setTimeout: fn => { timers.set(++timer_id, fn); return timer_id; },
		clearTimeout: id => timers.delete(id),
	});
	for (const file of ['change_queue_scheduler', 'conn']) {
		vm.runInContext(fs.readFileSync(require.resolve('../static/js/' + file), 'utf8'), context);
	}
	const connection = context.conn(() => {}, msg => handled.push(msg));
	return {
		connection, handled, timers, tasks,
		send(ctype, val, tournament_key = 'default') {
			connection._test_handle_message({ data: JSON.stringify({ type: 'change', ctype, val, tournament_key }) });
		},
		task() { tasks.shift()(); },
		drain() {
			let count = 0;
			while (tasks.length) { assert(++count < 10000); tasks.shift()(); }
		},
		foreground() { document.hidden = false; this.event('visibilitychange'); },
		event(name) { (listeners.get(name) || []).forEach(callback => callback()); },
		advance(ms) { now += ms; },
	};
}

describe('Admin change queue in a background tab', function() {
	it('drains a large ordered stream while timer callbacks remain suspended', function() {
		const b = browser();
		for (let i = 0; i < 3000; i++) b.send('match_edit', { match__id: 'm' + i });
		assert.strictEqual(b.handled.length, 0, 'processing must remain asynchronous');
		assert.strictEqual(b.tasks.length, 1, 'one task for the pending batch');
		b.task();
		assert.strictEqual(b.handled.length, 25, 'retain the per-batch message limit');
		assert.strictEqual(b.connection._test_change_queue_length(), 2975);
		b.drain();
		assert.strictEqual(b.connection._test_change_queue_length(), 0);
		assert.deepStrictEqual(b.handled.map(msg => msg.val.match__id), Array.from({ length: 3000 }, (_, i) => 'm' + i));
		assert.strictEqual(b.timers.size, 0, 'no timer used for change processing');
	});

	it('continues to yield when an individual batch reaches its time budget', function() {
		const b = browser();
		// Charge each dispatch three milliseconds through the real queue's clock.
		const push = b.handled.push.bind(b.handled);
		b.handled.push = msg => { b.advance(3); return push(msg); };
		for (let i = 0; i < 12; i++) b.send('match_edit', { match__id: 'm' + i });
		b.task();
		assert.strictEqual(b.handled.length, 3);
		assert.strictEqual(b.connection._test_change_queue_length(), 9);
		b.drain();
		assert.strictEqual(b.handled.length, 12);
	});

	it('keeps announcements immediate and queued score replacements scoped by tournament and match', function() {
		const b = browser();
		b.send('score', { match_id: 'one', network_score: [[1, 0]] });
		b.send('score', { match_id: 'one', network_score: [[2, 0]] });
		b.send('score', { match_id: 'one', network_score: [[7, 0]] }, 'other');
		b.send('free_announce', { message: 'Call' });
		assert.deepStrictEqual(b.handled.map(msg => msg.ctype), ['free_announce']);
		b.drain();
		assert.deepStrictEqual(JSON.parse(JSON.stringify(b.handled.slice(1).map(msg => [msg.tournament_key, msg.val.network_score]))), [
			['default', [[2, 0]]], ['other', [[7, 0]]],
		]);
	});

	it('wakes pending work on visibility and resume without stale tasks consuming newer batches', function() {
		const b = browser();
		for (let i = 0; i < 30; i++) b.send('match_edit', { match__id: 'm' + i });
		b.foreground();
		b.event('resume');
		b.event('pageshow');
		assert.strictEqual(b.tasks.length, 4);
		for (let i = 0; i < 3; i++) b.task();
		assert.strictEqual(b.handled.length, 0, 'obsolete wakeup tickets must be ignored');
		b.task();
		assert.strictEqual(b.handled.length, 25);
		b.drain();
		assert.strictEqual(b.handled.length, 30);
		assert.strictEqual(b.connection._test_change_queue_length(), 0);
	});

	it('reschedules a suspended timer on foreground return when MessageChannel is unavailable', function() {
		const b = browser(false);
		b.send('match_edit', { match__id: 'one' });
		const old_timer = [...b.timers.values()][0];
		b.foreground();
		assert.strictEqual(b.timers.size, 1);
		old_timer();
		assert.strictEqual(b.handled.length, 0);
		[...b.timers.values()][0]();
		assert.strictEqual(b.handled.length, 1);
		assert.strictEqual(b.connection._test_change_queue_length(), 0);
	});

	it('invalidates already posted callbacks when a batch is flushed manually', function() {
		const b = browser();
		b.send('match_edit', { match__id: 'one' });
		b.connection._test_process_change_queue();
		b.send('match_edit', { match__id: 'two' });
		b.task();
		assert.strictEqual(b.handled.length, 1);
		b.drain();
		assert.deepStrictEqual(b.handled.map(msg => msg.val.match__id), ['one', 'two']);
	});
});
