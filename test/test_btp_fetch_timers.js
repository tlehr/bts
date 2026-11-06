'use strict';

const assert = require('assert');
const { BTPConn } = require('../bts/btp_conn');
const traces = require('../bts/performance/traces');

async function with_clock(work) {
	const original = { setTimeout, clearTimeout }, timers = new Map();
	let now = 0;
	global.setTimeout = (callback, delay) => {
		const handle = { at: now + Number(delay), callback, unref() { return this; } };
		timers.set(handle, handle);return handle;
	};
	global.clearTimeout = handle => { if (!timers.delete(handle)) original.clearTimeout(handle); };
	const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
	const advance = async milliseconds => {
		const target = now + milliseconds;
		for (;;) {
			await flush();
			const timer = [...timers.values()].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0];
			if (!timer) break;
			now = timer.at;timers.delete(timer);timer.callback();
		}
		now = target;await flush();
	};
	const conn = Object.create(BTPConn.prototype), starts = [], statuses = [];
	Object.assign(conn, {
		app: { clock: { real_now_ms: () => now } }, tkey: 'timer-test', enabled_autofetch: true,
		autofetch_timeout_intervall: 30000, terminated: false,
		publish_status() { statuses.push({ ts: now, busy: this.fetch_in_progress, next: this.next_fetch_ts }); },
		async _fetch_once() { starts.push(now);return { value: true, reschedule: true }; },
		pushall: async () => {},
	});
	try { await work({ conn, starts, statuses, advance, timers }); }
	finally { conn.terminate({ silent: true });global.setTimeout = original.setTimeout;global.clearTimeout = original.clearTimeout; }
}

describe('BTP automatic fetch timer ownership', function() {
	it('keeps the configured thirty-second cadence across repeated automatic fetches', async function() {
		await with_clock(async ({ conn, starts, advance }) => {
			conn.schedule_fetch();await advance(90000);
			assert.deepStrictEqual(starts, [30000, 60000, 90000]);
		});
	});

	it('replaces the previous deadline after an additional result readback', async function() {
		await with_clock(async ({ conn, starts, advance }) => {
			conn.schedule_fetch();await advance(1000);await conn.fetch(conn, true);
			await advance(29999);assert.deepStrictEqual(starts, [1000]);
			await advance(30001);assert.deepStrictEqual(starts, [1000, 31000, 61000]);
		});
	});

	it('does not multiply periodic chains after several result confirmation requests', async function() {
		await with_clock(async ({ conn, starts, advance }) => {
			conn.schedule_fetch();
			for (let i = 0; i < 3; i++) {
				conn.result_retry_delay = 1000;conn.schedule_result_retry();
				await advance(1000);if (i < 2) await advance(4000);
			}
			await advance(60000);
			assert.deepStrictEqual(starts, [1000, 6000, 11000, 41000, 71000]);
		});
	});

	it('keeps an existing automatic plan after a one-off fetch without an explicit reschedule request', async function() {
		await with_clock(async ({ conn, starts, advance }) => {
			conn.schedule_fetch();await advance(1000);await conn.fetch(conn, false);
			await advance(30000);assert.deepStrictEqual(starts, [1000, 31000]);
		});
	});

	it('clears the previous automatic deadline when fetching is disabled', async function() {
		await with_clock(async ({ conn, starts, advance }) => {
			conn.schedule_fetch();await advance(5000);
			conn.enabled_autofetch = false;conn.schedule_fetch();await advance(90000);
			assert.deepStrictEqual(starts, []);assert.strictEqual(conn.next_fetch_ts, null);
		});
	});

	it('replaces the old deadline when the interval is changed', async function() {
		await with_clock(async ({ conn, starts, advance }) => {
			conn.schedule_fetch();await advance(5000);
			conn.autofetch_timeout_intervall = 45000;conn.schedule_fetch();await advance(90000);
			assert.deepStrictEqual(starts, [50000, 95000]);
		});
	});

	it('ignores a stale timer callback instead of clearing the replacement plan', async function() {
		await with_clock(async ({ conn, starts, advance, timers }) => {
			conn.schedule_fetch();const old = [...timers.values()][0];await advance(5000);
			conn.schedule_fetch();const deadline = conn.next_fetch_ts;old.callback();await advance(0);
			assert.deepStrictEqual(starts, []);assert.strictEqual(conn.next_fetch_ts, deadline);
			await advance(30000);assert.deepStrictEqual(starts, [35000]);
		});
	});

	it('cancels the automatic plan for the entire lifetime of a terminated connection', async function() {
		await with_clock(async ({ conn, starts, advance }) => {
			conn.schedule_fetch();await advance(1000);await conn.fetch(conn, true);
			conn.terminate({ silent: true });await advance(120000);
			assert.deepStrictEqual(starts, [1000]);
		});
	});

	it('records each background fetch separately from an already completed initiating operation', async function() {
		traces.disable();traces.enable();
		try {
			let inherited;
			await traces.operation('original_background_trigger', { type: 'sync' }, async () => { inherited = traces.capture(); });
			const conn = Object.create(BTPConn.prototype);
			conn.tkey = 'trace-timer-test';conn._fetch_once_measured = async () => {
				traces.end(traces.begin('read_and_integrate', 'phase'));return { value: true, reschedule: true };
			};
			for (let i = 0; i < 2; i++) await traces.with_context(inherited, () => conn._fetch_once());
			const completed = traces.snapshot(0).completed;
			assert.strictEqual(completed.filter(row => row.name === 'btp_fetch').length, 2);
			assert.strictEqual(completed.find(row => row.name === 'original_background_trigger').spans.length, 0);
		} finally { traces.disable(); }
	});
});
