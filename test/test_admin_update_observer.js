'use strict';
const assert = require('assert');
const create = require('../static/js/admin_update_observer');
function harness() {
	let time = 0, id = 0;
	const frames = new Map(), timers = new Map(), receipts = [];
	const env = { performance: { now: () => time }, Date: { now: () => 1000 + time }, location: { pathname: '/admin/t/test/' },
		document: { hidden: false }, requestAnimationFrame: fn => { frames.set(++id, fn);return id; }, cancelAnimationFrame: n => frames.delete(n),
		setTimeout: fn => { timers.set(++id, fn);return id; }, clearTimeout: n => timers.delete(n), cleitstand: { isUpdating: () => false } };
	const observer = create(env), unsubscribe = observer.subscribe(receipt => receipts.push(receipt));
	return { observer, receipts, env, unsubscribe, timers,
		advance(ms) { time += ms; },
		frame() {time += 16;const callbacks = [...frames.values()];frames.clear();callbacks.forEach(fn => fn());},
		message(id = 1, ctype = 'score') {return { type: 'change', tournament_key: 'test', ctype, val: { match_id: id } };} };
}
describe('Admin presentation receipts', function() {
	it('acknowledges only after handling and two visible frames, including queue and rendering time', function() {
		const h = harness(), msg = h.message();h.observer.received(msg);h.advance(20);
		h.observer.dispatch(msg, () => {h.advance(5);});
		assert.strictEqual(h.receipts.length, 0);h.frame();assert.strictEqual(h.receipts.length, 0);h.frame();
		assert.strictEqual(h.receipts[0].status, 'presented');
		assert.deepStrictEqual(h.receipts[0].timings, { queue_ms: 20, handler_ms: 5, ui_wait_ms:0, render_ms: 32, total_ms: 57 });
		assert.strictEqual(h.receipts[0].presented_at, 1057);assert.strictEqual(h.observer.stats().pending, 0);
	});
	it('waits for deferred callback DOM changes and that update’s captured layout work', async function() {
		const h=harness();let callback,changed=false,layout;
		h.observer.dispatch(h.message(),()=>{callback=h.observer.wrapCallback(()=>{changed=true;layout=h.observer.createJob('names.layout');});});
		h.frame();h.frame();assert.strictEqual(h.receipts.length,0);callback();h.frame();h.frame();assert.strictEqual(h.receipts.length,0);
		layout.run(()=>h.advance(3));layout.complete();await Promise.resolve();h.frame();assert.strictEqual(h.receipts.length,0);h.frame();assert(changed);assert.strictEqual(h.receipts[0].status,'presented');
		assert.strictEqual(h.receipts[0].ui_jobs[0].work_ms,3);
	});
	it('does not wait for unrelated continuously scheduled clocks after its own DOM work', async function() {
		const h=harness();let own;
		const future=new Promise(()=>{});
		h.env.cleitstand.isUpdating=()=>true;h.env.ctournament={isUpdating:()=>true};
		h.observer.dispatch(h.message(),()=>{own=h.observer.createJob('timers.fit');});h.frame();
		h.env.cleitstand.pendingUpdates=()=>[future];own.complete();await Promise.resolve();h.frame();h.frame();
		assert.strictEqual(h.receipts[0].status,'presented');assert.strictEqual(h.observer.stats().pending,0);
	});
	it('does not attach an unrelated preparation request already pending before a point', function() {
		const h=harness(),foreign=h.observer.createJob('preparation.diagnosis');
		h.env.cleitstand.pendingUpdates=()=>[foreign.promise];h.env.ctournament={pendingUpdates:()=>[foreign.promise]};
		h.observer.dispatch(h.message(),()=>{});h.frame();h.frame();
		assert.strictEqual(h.receipts[0].status,'presented');assert.deepStrictEqual(h.receipts[0].ui_jobs,[]);
		foreign.complete();
	});
	it('waits for a shared batch and its child jobs for both updates that requested it', async function() {
		const h=harness();let batch,child;
		h.observer.dispatch(h.message(1),()=>{batch=h.observer.createJob('lists.counts');});
		h.observer.dispatch(h.message(2),()=>{batch.claim();});
		batch.run(()=>{h.advance(4);child=h.observer.createJob('names.layout');});batch.complete();await Promise.resolve();
		h.frame();h.frame();assert.strictEqual(h.receipts.length,0);
		child.run(()=>h.advance(2));child.complete();await Promise.resolve();h.frame();h.frame();
		assert.strictEqual(h.receipts.length,2);
		for(const receipt of h.receipts) {
			assert.deepStrictEqual(receipt.ui_jobs.map(job=>job.name),['lists.counts','names.layout']);
			assert.deepStrictEqual(receipt.ui_jobs.map(job=>job.work_ms),[4,2]);
			assert(receipt.ui_jobs.every(job=>job.status==='complete'));
		}
	});
	it('retains shared ownership through network callbacks and their deferred layout', async function() {
		const h=harness();let shared,callback,layout;
		h.observer.dispatch(h.message(1),()=>{shared=h.observer.createJob('preparation.diagnosis');});
		h.observer.dispatch(h.message(2),()=>shared.claim());
		shared.run(()=>{callback=h.observer.wrapCallback(()=>{layout=h.observer.createJob('preparation.layout');});});
		callback();shared.complete();await Promise.resolve();h.frame();h.frame();assert.strictEqual(h.receipts.length,0);
		layout.complete();await Promise.resolve();h.frame();h.frame();assert.strictEqual(h.receipts.length,2);
	});
	it('never acknowledges a failed layout job as presented', async function() {
		const h=harness();let job;
		h.observer.dispatch(h.message(),()=>{job=h.observer.createJob('names.layout');});
		assert.throws(()=>job.run(()=>{throw new Error('Layout failed');}),/Layout failed/);await Promise.resolve();h.frame();h.frame();
		assert.strictEqual(h.receipts[0].status,'failed');assert.strictEqual(h.receipts[0].ui_jobs[0].status,'failed');
	});
	it('instruments local timer callbacks only when explicitly requested', function() {
		const h=harness(),local=()=>({type:'local-update',ctype:'timer_tick'});let calls=0;
		h.observer.dispatch(local(),()=>{calls++;});assert.strictEqual(h.observer.stats().pending,0);
		const ticks=[];h.observer.subscribe(receipt=>ticks.push(receipt),{includeLocal:true});
		h.observer.dispatch(local(),()=>{calls++;});h.frame();h.frame();
		assert.strictEqual(calls,2);assert.strictEqual(ticks.length,1);assert.strictEqual(h.receipts.length,0);
	});
	it('drains the received updates without waiting for future unrelated events', async function() {
		const h=harness();h.observer.dispatch(h.message(1),()=>{});h.frame();const drained=h.observer.whenSettled();
		h.observer.dispatch(h.message(2),()=>{});h.frame();await drained;
		assert.strictEqual(h.receipts.length,1);assert.strictEqual(h.observer.stats().pending,1);h.frame();assert.strictEqual(h.receipts.length,2);
	});
	it('does not acknowledge failed asynchronous responses as successful DOM updates', function() {
		const h=harness();let callback;
		h.observer.dispatch(h.message(),()=>{callback=h.observer.wrapCallback(()=>{});});
		h.advance(20);callback({message:'Server error'});h.frame();h.frame();
		assert.strictEqual(h.receipts[0].status,'failed');assert.strictEqual(h.receipts[0].presented_at,null);
	});
	it('waits for an asynchronous handler result', async function() {
		const h = harness();let resolve;
		h.observer.dispatch(h.message(), () => new Promise(done => {resolve = done;}));
		h.frame();h.frame();assert.strictEqual(h.receipts.length, 0);resolve();await Promise.resolve();h.frame();h.frame();
		assert.strictEqual(h.receipts[0].status, 'presented');
	});
	it('does not report a hidden, ignored, failed or superseded update as presented', function() {
		const h = harness();h.env.document.hidden = true;h.observer.dispatch(h.message(1), () => {});
		h.env.document.hidden = false;h.observer.dispatch(h.message(2), () => false);
		assert.throws(() => h.observer.dispatch(h.message(3), () => {throw new Error('broken');}), /broken/);
		const old = h.message(4);h.observer.received(old);h.observer.received(h.message(4));
		assert.deepStrictEqual(h.receipts.map(r => r.status), ['hidden', 'ignored', 'failed', 'superseded']);
		assert(h.receipts.every(r => r.presented_at === null));h.unsubscribe();
	});
	it('does not claim that an intermediate score was displayed when a newer score arrives before its paint', function() {
		const h = harness();h.observer.dispatch(h.message(), () => {});h.frame();h.observer.dispatch(h.message(), () => {});h.frame();h.frame();
		assert.deepStrictEqual(h.receipts.map(r => r.status), ['superseded', 'presented']);
	});
	it('handles view changes, disconnects, timeouts and subscription cleanup without stale acknowledgements', function() {
		const h = harness();h.observer.dispatch(h.message(1), () => {});h.env.location.pathname = '/other';h.frame();
		h.observer.dispatch(h.message(2), () => {});h.observer.reset();
		h.observer.dispatch(h.message(3), () => {});[...h.timers.values()][0]();
		h.observer.dispatch(h.message(4), () => {});h.unsubscribe();h.frame();h.frame();
		assert.deepStrictEqual(h.receipts.map(r => r.status), ['view_changed', 'connection_lost', 'timeout']);
		assert.strictEqual(h.observer.stats().pending, 0);
	});
	it('isolates a failing measurement listener from the UI handler', function() {
		const h = harness();h.observer.subscribe(() => {throw new Error('bad logger');});let changed = false;
		h.observer.dispatch(h.message(), () => {changed = true;});h.frame();h.frame();
		assert(changed);assert.strictEqual(h.observer.stats().callbackErrors, 1);
	});
	it('does not instrument or delay normal users without a subscriber', function() {
		const h = harness();h.unsubscribe();let changed = false;
		h.observer.dispatch(h.message(), () => {changed = true;});assert(changed);assert.strictEqual(h.observer.stats().pending, 0);
	});
});
