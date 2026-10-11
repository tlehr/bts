'use strict';

const assert = require('assert');
const probe = require('../bts/timing/event_loop_probe');
const steps = require('../bts/timing/steps');

function clock() {
	let now = 1000000n, timer;
	return {
		now: () => now,
		set_timer(fn) { timer = fn; return fn; },
		clear_timer() { timer = null; },
		advance(ms) { now += BigInt(ms) * 1000000n; },
		fire() { assert(timer); const fn = timer; timer = null; fn(); },
		get pending() { return !!timer; },
	};
}

describe('wait and subphase timing', function() {
	it('detects a late interruption after a timely first timer and clears the timer on completion', function() {
		const time = clock(), sample = probe({ ...time, interval_ms: 20 });
		time.advance(20); time.fire();
		time.advance(200); time.fire();
		const result = sample.stop();
		assert.strictEqual(result.event_loop_timer_max_delay_ms, 180);
		assert.strictEqual(result.event_loop_timer_samples, 2);
		assert.strictEqual(time.pending, false);
	});
	it('counts an overdue timer even if the wait completes before that timer callback runs', function() {
		const time = clock(), sample = probe({ ...time, interval_ms: 20 });
		time.advance(150);
		assert.strictEqual(sample.stop().event_loop_timer_max_delay_ms, 130);
		const fast = probe({ ...time, interval_ms: 20 });
		time.advance(5);
		assert.strictEqual(fast.stop().event_loop_timer_max_delay_ms, 0);
	});
	it('keeps completed subphase endpoints when flushing a slow parent, including short subphases', async function() {
		const time = clock(), rows = [];
		const capture = steps((...args) => rows.push(args), 'device_info', { now: time.now });
		assert.strictEqual(await capture.async('hostname', () => { time.advance(60); return 'host'; }), 'host');
		capture.sync('notify', () => time.advance(60));
		capture.flush();
		assert.deepStrictEqual(rows.map(row => row[0]), ['device_info_hostname', 'device_info_notify']);
		assert(rows.every(row => row[2].parent_slow === true));
		assert.strictEqual(Number(rows[0][2].timing_end_ns - rows[0][1]) / 1e6, 60);
		capture.flush(); assert.strictEqual(rows.length, 2);
	});
	it('preserves async errors and records the failed subphase', async function() {
		const time = clock(), rows = [], failure = new Error('settings failed');
		const capture = steps((...args) => rows.push(args), 'device_info', { now: time.now });
		await assert.rejects(capture.async('settings_read', async () => { throw failure; }), error => error === failure);
		capture.flush();
		assert.strictEqual(rows[0][2].error, 'settings failed');
	});
});
