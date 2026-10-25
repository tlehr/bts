'use strict';

const assert = require('assert');
const { AsyncResource } = require('async_hooks');
const Datastore = require('nedb');
const tasks = require('../bts/database_tasks');
const foreground = require('../bts/foreground_work');
const { ResourceLockQueue } = require('../bts/resource_lock_queue');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe('foreground ownership across asynchronous queues', function() {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['BTS_ADMIN_RESPONSE_PRIORITY', 'BTS_SCORE_PRESS_TIMING'].map(key => [key, process.env[key]]));
		process.env.BTS_ADMIN_RESPONSE_PRIORITY = '1';
	});
	afterEach(() => {
		for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
		assert.strictEqual(foreground.busy(), false);
	});
	for (const diagnostic of ['0', '1']) it('releases the correct point after another point dispatches its datastore task (timing ' + diagnostic + ')', async function() {
		process.env.BTS_SCORE_PRESS_TIMING = diagnostic;
		const store = new Datastore({ inMemoryOnly: true }); tasks.attach(store, 'matches');
		const owner_a = foreground.begin('handle_score_update_A'), entered = deferred();
		let release, source, owner_b;
		const first = foreground.run(owner_a, () => new Promise(resolve => store.executor.push({ this: store, arguments: [resolve], fn(done) {
			source = new AsyncResource('first-point-persistence'); release = () => source.runInAsyncScope(done); entered.resolve();
		} })));
		try {
			await entered.promise; owner_b = foreground.begin('handle_score_update_B');
			const second = foreground.run(owner_b, () => new Promise(resolve => store.executor.push({ this: store,
				arguments: [(error, value) => { assert.ifError(error); foreground.release(); resolve(value); }], fn(done) { done(null, 'second'); },
			})));
			const finish = release; release = null; finish(); await first; assert.strictEqual(await second, 'second');
			owner_b(); assert.strictEqual(foreground.busy(), true, 'the first point must still own its unreleased priority');
		} finally { release?.(); owner_a(); owner_b?.(); source?.emitDestroy(); }
	});
	it('does not give a background datastore callback another point\'s priority or let it release that point', async function() {
		const store = new Datastore({ inMemoryOnly: true }); tasks.attach(store, 'matches');
		const owner = foreground.begin('handle_score_update'), entered = deferred(); let release, source, waiting;
		const first = foreground.run(owner, () => new Promise(resolve => store.executor.push({ this: store, arguments: [resolve], fn(done) {
			source = new AsyncResource('active-point-persistence'); release = () => source.runInAsyncScope(done); entered.resolve();
		} })));
		try {
			await entered.promise;
			let resumed = false;
			const background = new Promise(resolve => store.executor.push({ this: store, arguments: [() => {
				foreground.release(); waiting = foreground.background_idle().then(() => { resumed = true; }); resolve();
			}], fn(done) { done(); } }));
			const finish = release; release = null; finish(); await first; await background; await tick();
			assert.strictEqual(foreground.busy(), true); assert.strictEqual(resumed, false);
			owner(); await waiting; assert.strictEqual(resumed, true);
		} finally { release?.(); owner(); await waiting; source?.emitDestroy(); }
	});
	it('restores callback ownership even when an external completion runs under a different point', async function() {
		const store = new Datastore({ inMemoryOnly: true }); tasks.attach(store, 'matches');
		const owner_a = foreground.begin('handle_score_update_A'), owner_b = foreground.begin('handle_score_update_B');
		const source = foreground.run(owner_a, () => new AsyncResource('foreign-completion'));
		const entered = deferred(); let release;
		const work = foreground.run(owner_b, () => new Promise(resolve => store.executor.push({ this: store,
			arguments: [() => { foreground.release(); resolve(); }], fn(done) { release = done; entered.resolve(); },
		})));
		try {
			await entered.promise; source.runInAsyncScope(release); await work;
			owner_b(); assert.strictEqual(foreground.busy(), true);
		} finally { owner_a(); owner_b(); source.emitDestroy(); }
	});
	it('keeps a background resource task from inheriting and releasing the scheduling point\'s priority', async function() {
		const queue = new ResourceLockQueue(), owner = foreground.begin('handle_score_update');
		try {
			await foreground.run(owner, () => queue.execute(() => { foreground.release(); }, { locks: ['background:test'] }));
			assert.strictEqual(foreground.busy(), true);
		} finally { owner(); }
	});
	it('lets a point await its own background helper after a datastore callback without deadlocking', async function() {
		const store = new Datastore({ inMemoryOnly: true }); tasks.attach(store, 'matches');
		const owner = foreground.begin('fetch_sync_apply');
		try {
			await foreground.run(owner, () => new Promise((resolve, reject) => store.executor.push({ this: store,
				arguments: [() => foreground.background_idle().then(resolve, reject)], fn(done) { done(); },
			})));
			assert.strictEqual(foreground.busy(), true);
		} finally { owner(); }
	});
});
