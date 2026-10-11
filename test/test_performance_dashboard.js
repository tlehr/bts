'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { promisify } = require('util');
const Datastore = require('nedb');
const tasks = require('../bts/database_tasks');
const outbox = require('../bts/admin_response/outbox');
const QueueStats = require('../bts/performance/queue_stats');
const WorkerClient = require('../bts/offload/client');
const registry = require('../bts/performance/registry');
const { PerformanceHistory, reception, render_performance } = require('../debug/live_drill_performance');
const { Dashboard, parse_args } = require('../debug/live_tournament_drill');

function sample(pending = 0, oldest = 0, completed = 0, server_id = 'one') {
	return { server_id, lock: { queue_length: pending, oldest_pending_ms: oldest,
		enqueued_count: completed + pending, completed_count: completed, failed_count: 0,
		active_tasks: [], pending_tasks: [], recent_tasks: [], high_watermark: pending },
		database: [], workers: [], outgoing: { pending: 0, active: 0, oldest_pending_ms: 0, buffered_bytes: 0 },
		event_loop: { p95_ms: 20, max_ms: 25, utilization: 0.1 } };
}

describe('performance dashboard queue observation', function() {
	it('provides measured event-loop statistics after the initial telemetry window', async function() {
		this.timeout(5000);
		const monitor = require('../bts/performance/monitor');
		monitor.snapshot({ db: {} }, [], 'default');
		await new Promise(resolve => setTimeout(resolve, 1100));
		const result = monitor.snapshot({ db: {} }, [], 'default');
		assert.strictEqual(result.event_loop.measured, true);
		assert(result.event_loop.p95_ms > 0); assert(result.event_loop.max_ms >= result.event_loop.p95_ms);
		assert(result.event_loop.utilization >= 0 && result.event_loop.utilization <= 1);
	});
	it('measures DB backlog without diagnostics, preserves callbacks and drains in order', async function() {
		const previous = process.env.BTS_SERVER_DIAGNOSTICS;
		process.env.BTS_SERVER_DIAGNOSTICS = '0';
		const store = new Datastore({ inMemoryOnly: true }); tasks.attach(store, 'matches');
		let release, started;
		const held = new Promise(resolve => { started = resolve; });
		try {
			store.executor.push({ this: store, diagnostic_name: 'held', arguments: [], fn(done) { release = done; started(); } });
			await held;
			const first = promisify(store.insert.bind(store))({ _id: 'test', score: 1 });
			const second = promisify(store.findOne.bind(store))({ _id: 'test' });
			const busy = tasks.health(store);
			assert.strictEqual(busy.pending, 2); assert.strictEqual(busy.active, 1);
			assert.strictEqual(busy.active_task, 'held'); assert(busy.oldest_pending_ms >= 0);
			release(); release = null;
			await first; assert.deepStrictEqual(await second, { _id: 'test', score: 1 });
			await new Promise(resolve => setImmediate(resolve));
			const idle = tasks.health(store);
			assert.strictEqual(idle.pending, 0); assert.strictEqual(idle.active, 0);
			assert.strictEqual(idle.completed_count, 3);
			await assert.rejects(promisify(store.insert.bind(store))({ _id: 'test' }), /unique/);
			assert.strictEqual(tasks.health(store).failed_count, 1);
		} finally {
			if (release) release();
			if (previous === undefined) delete process.env.BTS_SERVER_DIAGNOSTICS; else process.env.BTS_SERVER_DIAGNOSTICS = previous;
		}
	});
	it('observes reserved admin responses and waiting updates without disturbing output order', async function() {
		const ws = new EventEmitter(), messages = []; ws.readyState = 1; ws.send = bytes => messages.push(JSON.parse(bytes));
		const output = outbox(ws), reservation = output.reserve();
		output.send({ type: 'change', score: 2 });
		assert.strictEqual(output.stats().pending, 2); assert.strictEqual(output.stats().reserved, 1);
		assert.strictEqual(output.stats().active, 0); assert.deepStrictEqual(messages, []);
		output.complete(reservation, { type: 'answer', score: 1 }, 'default', false);
		assert.deepStrictEqual(messages.map(msg => msg.score), [1, 2]); assert.strictEqual(output.stats().pending, 0);
		ws.emit('close'); output.send({ score: 3 }); assert.strictEqual(messages.length, 2);
	});
	it('tracks queued, running, successful and failed jobs exactly once', function() {
		const stats = new QueueStats(), a = stats.enqueue('a'), b = stats.enqueue('b');
		stats.start(a); assert.strictEqual(stats.snapshot().pending, 1); assert.strictEqual(stats.snapshot().active, 1);
		stats.finish(a); stats.finish(a); stats.finish(b, new Error('cancelled'));
		const result = stats.snapshot();
		assert.strictEqual(result.enqueued_count, 2); assert.strictEqual(result.completed_count, 1);
		assert.strictEqual(result.failed_count, 1); assert.strictEqual(result.high_watermark, 2);
		assert.strictEqual(result.pending + result.active, 0);
	});
	it('exposes actual worker backlog and removes closed workers from telemetry', async function() {
		const worker = new EventEmitter(); worker.postMessage = () => {}; worker.ref = worker.unref = () => {};
		worker.terminate = async () => {};
		const client = new WorkerClient('dashboard-test', '', { create_worker: () => worker });
		const first = client.run({}), second = client.run({});
		const rejected = Promise.all([assert.rejects(first, /closed/), assert.rejects(second, /closed/)]);
		const status = registry.snapshots().find(row => row.name === 'dashboard-test');
		assert.strictEqual(status.pending, 1); assert.strictEqual(status.active, 1);
		client.close(); await rejected;
		assert(!registry.snapshots().some(row => row.name === 'dashboard-test'));
	});
});

describe('performance dashboard interpretation', function() {
	it('ignores bursts, warns about sustained old backlog, and recovers after drain', function() {
		const history = new PerformanceHistory(), epoch = 100000;
		for (let sec = 0; sec <= 5; sec++) history.record(sample(10, 2000), 3, epoch + sec * 1000);
		assert.strictEqual(history.status(epoch + 5000).level, 'OK');
		history.record(sample(), 3, epoch + 6000);
		for (let sec = 7; sec <= 16; sec++) history.record(sample(2, 2000), 3, epoch + sec * 1000);
		assert.strictEqual(history.status(epoch + 16000).level, 'OK');
		history.record(sample(2, 2000), 3, epoch + 17000);
		assert.strictEqual(history.status(epoch + 17000).level, 'WARN');
		history.record(sample(), 3, epoch + 18000);
		assert.strictEqual(history.status(epoch + 18000).level, 'OK');
		assert.strictEqual(history.status(epoch + 24000).level, 'UNKNOWN');
	});
	it('detects growing young queues, computes comparable rates, and resets on server restart', function() {
		const history = new PerformanceHistory(), epoch = 100000;
		for (let sec = 0; sec <= 30; sec++) history.record(sample(sec + 1, 200, sec * 3), 2, epoch + sec * 1000);
		assert.strictEqual(history.status(epoch + 30000).level, 'WARN');
		const row = history.rows(epoch + 30000)[0]; assert.strictEqual(row.incoming, 4); assert.strictEqual(row.done, 3);
		assert.strictEqual(row.delta, 30);
		history.record(sample(0, 0, 0, 'two'), 3, epoch + 31000);
		assert.strictEqual(history.rows(epoch + 31000)[0].incoming, null);
		assert.strictEqual(history.status(epoch + 31000).level, 'OK'); assert.strictEqual(history.runs.length, 2);
	});
	it('shows failed telemetry as unknown and requires three seconds of clear queues during pauses', function() {
		const history = new PerformanceHistory(); history.pause(true, 100000);
		for (let sec = 0; sec < 3; sec++) history.record(sample(), 2, 100000 + sec * 1000);
		assert.strictEqual(history.drain.finished_ms, null);
		history.record(sample(), 2, 103000); assert.strictEqual(history.drain.finished_ms, 0);
		history.fail(new Error('Timeout')); assert.strictEqual(history.status(103000).level, 'UNKNOWN');
		history.record(sample(), 2, 104000); assert.strictEqual(history.status(104000).level, 'OK');
	});
	it('does not call unobserved DB queues healthy', function() {
		const history = new PerformanceHistory(), value = sample();
		value.database.push({ name: 'matches', observed: false }); history.record(value, 3, 100000);
		assert.strictEqual(history.status(100000).level, 'UNKNOWN');
		assert(!history.rows(100000).some(row => row.name === 'DB matches'));
	});
	it('detects event-loop stalls with empty queues and bounds history and diagnostics', function() {
		const history = new PerformanceHistory();
		for (let sec = 0; sec <= 10; sec++) {
			const value = sample(); value.event_loop.p95_ms = 200; history.record(value, 3, 100000 + sec * 1000);
		}
		assert.strictEqual(history.status(110000).level, 'WARN');
		for (let sec = 11; sec < 1000; sec++) history.record(sample(), 3, 100000 + sec * 1000);
		assert(history.history.length <= 301);
		for (let i = 0; i < 200; i++) history.event('warning', {});
		assert.strictEqual(history.events.length, 50);
	});
	it('separates pending from expired receipts, retains rolling p95 and renders all four views', function() {
		const previous = Date.now; let now = 100000; Date.now = () => now;
		try {
			const dashboard = new Dashboard(parse_args(['--dashboard']));
			dashboard.record_score_sent({ court_id: 'court', match_id: 'match', network_score: [[1, 0]] });
			now += 2000;
			assert.strictEqual(reception(dashboard)[0].pending, 1); assert.strictEqual(reception(dashboard)[0].oldest_ms, 2000);
			now += 30000; dashboard.prune_latencies();
			assert.strictEqual(reception(dashboard)[0].pending, 0); assert.strictEqual(reception(dashboard)[0].expired, 1);
			dashboard.performance.record(sample(), 3, now);
			assert(render_performance(dashboard, true).some(line => line.includes('Queues: server-wide')));
			const write = process.stdout.write;
			try {
				for (const [view, expected] of [[1, 'Feld'], [2, 'Queues: server-wide'], [3, 'Payload latency by type'], [4, 'Server diagnostics']]) {
					let text = ''; process.stdout.write = value => { text += value; return true; };
					dashboard.view = view; dashboard.render(); assert(text.includes(expected));
				}
			} finally { process.stdout.write = write; }
			assert.strictEqual(parse_args(['--dashboard-view', '2']).dashboard_view, 2);
			assert.throws(() => parse_args(['--dashboard-view', '8']), /must be/);
		} finally { Date.now = previous; }
	});
});
