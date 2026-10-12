'use strict';

const assert = require('assert');
const { promisify } = require('util');
const { EventEmitter } = require('events');
const Datastore = require('nedb');
const traces = require('../bts/performance/traces');
const { ResourceLockQueue } = require('../bts/resource_lock_queue');
const database_tasks = require('../bts/database_tasks');
const WorkerClient = require('../bts/offload/client');
const outbox = require('../bts/admin_response/outbox');
const { PerformanceHistory } = require('../debug/live_drill_performance');
const Archive = require('../debug/web_dashboard/archive');
const { Dashboard, parse_args } = require('../debug/live_tournament_drill');

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const completed = () => traces.snapshot(0).completed;

describe('processing traces and flow evidence', function() {
	beforeEach(function() { traces.disable(); });
	afterEach(function() { traces.disable(); });
	it('retains bounded refresh timings and operation counts without snapshot contents', async function() {
		traces.enable();
		await traces.operation('snapshot_refresh', { type: 'sync' }, async () => {
			traces.phase('incremental_refresh', Date.now(), 12, { copied_records: 519,
				refresh_operations: 520, refresh_groups: 24, refresh_queue_wait_ms: 3,
				refresh_apply_ms: 8, refresh_max_group_ms: 2.3, refresh_foreground_wait_ms: 1,
				allocation_scope: 'ordering_only', ordering_unchanged_notifications: 19,
				direct_match_locks: 4, additional_match_locks: 2, dependency_player_matches: 2,
				dependency_court_matches: 0, dependency_effect_matches: 0, allocation_reasons: ['participants'], recipients: 1,
				documents: [{ private: 'secret' }] });
		});
		const span = completed().find(row => row.name === 'snapshot_refresh').spans[0];
		assert.strictEqual(span.copied_records, 519); assert.strictEqual(span.refresh_operations, 520);
		assert.strictEqual(span.refresh_groups, 24); assert.strictEqual(span.refresh_queue_wait_ms, 3);
		assert.strictEqual(span.refresh_apply_ms, 8); assert.strictEqual(span.refresh_max_group_ms, 2.3);
		assert.strictEqual(span.refresh_foreground_wait_ms, 1);
		assert.strictEqual(span.allocation_scope, 'ordering_only'); assert.strictEqual(span.ordering_unchanged_notifications, 19);
		assert.strictEqual(span.direct_match_locks, 4); assert.strictEqual(span.additional_match_locks, 2);
		assert.deepStrictEqual(span.allocation_reasons, ['participants']); assert.strictEqual(span.recipients, 1);
		assert(!('documents' in span));
	});
	it('retains later locks and sync publication after hundreds of repetitive DB steps', async function() {
		traces.enable();
		await traces.operation('large_sync', { type: 'sync' }, async () => {
			for (let i = 0; i < 400; i++) { const span = traces.begin('matches:sync_write_' + i, 'db_run'); traces.end(span); }
			for (const [name, kind] of [['sync_apply', 'lock_wait'], ['sync_apply', 'lock_hold'], ['incremental_publish', 'phase']]) traces.end(traces.begin(name, kind));
		});
		const record = completed().find(row => row.name === 'large_sync');
		assert(record.spans.some(row => row.kind === 'lock_wait')); assert(record.spans.some(row => row.kind === 'lock_hold'));
		assert(record.spans.some(row => row.name === 'incremental_publish')); assert.strictEqual(record.dropped_spans, 0);
		assert.strictEqual(record.summarized_spans, 320); assert.strictEqual(record.span_summaries[0].count, 320);
		assert.strictEqual(traces.snapshot().stages.find(row => row.name === 'matches:other' && row.kind === 'db_run').count, 400);
	});
	it('prevents one operation type from consuming the statistics budget of later types', async function() {
		traces.enable();
		await traces.operation('many_point_stages', { type: 'point' }, async () => {
			for (let i = 0; i < 120; i++) traces.end(traces.begin('point_step_' + i, 'phase'));
		});
		await traces.operation('later_sync', { type: 'sync' }, async () => traces.end(traces.begin('incremental_writes', 'phase')));
		assert(traces.snapshot().unaggregated_samples > 0);
		assert(traces.snapshot().stages.some(row => row.type === 'sync' && row.name === 'incremental_writes'));
	});
	it('identifies untraced persistence blocking a traced read without exposing query contents', async function() {
		traces.enable(); const store = new Datastore({ inMemoryOnly: true });
		const persist = store.persistence.persistNewState; const entered = deferred(); let release;
		store.persistence.persistNewState = function(documents, callback) { release = () => persist.call(this, documents, callback); entered.resolve(); };
		database_tasks.attach(store, 'matches');
		const write = promisify(store.insert.bind(store))({ _id: 'private-player', secret: 'private-value' });
		await entered.promise;
		const reading = traces.operation('waiting_score', { type: 'point' }, () => promisify(store.findOne.bind(store))({ _id: 'private-player' }));
		try {
			await new Promise(resolve => setTimeout(resolve, 35));
			const health = database_tasks.health(store); assert(health.active_detail.persistence.pending);
			assert(!JSON.stringify(health).includes('private-player')); assert(!JSON.stringify(health).includes('query_fields'));
		} finally { release(); store.persistence.persistNewState = persist; }
		await write; await reading;
		const record = completed().find(row => row.name === 'waiting_score'), wait = record.spans.find(row => row.kind === 'db_wait');
		assert.strictEqual(wait.blockers[0].task, 'matches:insert'); assert.strictEqual(wait.blockers[0].operation_id, null);
		assert.strictEqual(wait.blockers[0].persistence_kind, 'append'); assert(wait.duration_ms >= 30);
		const task = database_tasks.health(store).recent_tasks.find(row => row.task === 'insert');
		assert(task.persistence_ms >= 30); assert(task.before_callback_ms >= 30); assert(task.callback_ms != null);
	});
	it('records only during an explicit lease, expires automatically, bounds spans and keeps failures', async function() {
		await traces.operation('unobserved', {}, async () => { assert.strictEqual(traces.begin('no', 'phase'), null); });
		traces.enable(Date.now() - 11000); assert.strictEqual(traces.enabled(), false);
		traces.enable();
		await assert.rejects(traces.operation('failing', { trace_id: 'example', arbitrary_payload: 'private' }, async () => {
			for (let i = 0; i < 200; i++) { const span = traces.begin('work', 'phase'); traces.end(span); traces.end(span); }
			throw new Error('expected');
		}), /expected/);
		const record = completed().find(row => row.name === 'failing');
		assert.strictEqual(record.status, 'error'); assert.strictEqual(record.spans.length, 160); assert.strictEqual(record.dropped_spans, 40);
		assert(!('arbitrary_payload' in record));
		assert.strictEqual(traces.snapshot().stages.find(row => row.name === 'work').count, 160);
	});
	it('distinguishes normal ring-buffer rotation from real gaps in completed trace delivery', async function() {
		traces.enable();
		for (let i = 0; i < 501; i++) await traces.operation('short', {}, async () => {});
		const first = traces.snapshot(0);
		assert.strictEqual(first.buffer_overwrites, 1); assert.strictEqual(first.dropped_traces, 0);
		assert.strictEqual(first.completed.length, 80); assert.strictEqual(first.remaining, 420);
		assert.strictEqual(traces.snapshot(first.cursor).gap, false);
	});
	it('separates lock wait from hold, identifies a tournament blocker and lets an unrelated field progress', async function() {
		traces.enable(); const queue = new ResourceLockQueue(), entered = deferred(), gate = deferred();
		const holder = queue.execute(Object.assign(async () => { entered.resolve(); await gate.promise; }, { _queue_name: 'sync_holder' }), { locks: ['tournament:one'] });
		await entered.promise;
		const point = queue.execute(Object.assign(async () => 'point', { _queue_name: 'handle_score_update_v2', _queue_trace_id: 'point-123' }), { locks: ['court:one:3'] });
		let release;
		try {
			await queue.execute(async () => 'independent', { locks: ['court:two:1'] });
			const pending = queue.stats().pending_tasks[0]; assert(pending.id); assert(pending.blocked_by[0].operation_id);
			release = true;
		} finally { gate.resolve(); await holder; await point; }
		assert(release);
		const trace = completed().find(row => row.trace_id === 'point-123'), wait = trace.spans.find(row => row.kind === 'lock_wait');
		const hold = trace.spans.find(row => row.kind === 'lock_hold');
		assert.strictEqual(wait.blockers[0].task, 'sync_holder'); assert.deepStrictEqual(wait.blockers[0].conflicting_locks, ['court:one:3']);
		assert(wait.blockers[0].operation_id); assert(wait.ts <= hold.start_ts); assert.deepStrictEqual(hold.locks, ['court:one:3']);
	});
	it('continues processing at the active trace limit without recursive instrumentation or blocking work', async function() {
		traces.enable(); const queue = new ResourceLockQueue(), gate = deferred();
		const jobs = Array.from({ length: 70 }, (_, i) => queue.execute(async () => { await gate.promise; return i; }, { locks: ['court:limit:' + i] }));
		try { await turn(); assert.strictEqual(queue.stats().active_tasks.length, 70); assert(traces.snapshot().dropped_traces >= 6); }
		finally { gate.resolve(); await Promise.all(jobs); }
	});
	it('does not claim released locks for deferred work and links independent follow-up operations', async function() {
		traces.enable(); const queue = new ResourceLockQueue(); let late, caller;
		await queue.execute(async () => {
			caller = traces.capture().record.id;
			const context = traces.capture();
			late = () => traces.with_context(context, async () => {
				const span = traces.begin('deferred_fanout', 'phase'); traces.end(span);
				await traces.operation('follow_up', { type: 'calling' }, async () => {}, true);
			});
		}, { locks: ['court:one:1'] });
		await late();
		const records = completed(), parent = records.find(row => row.id === caller);
		assert.deepStrictEqual(parent.spans.find(row => row.name === 'deferred_fanout').held_locks, []);
		assert.strictEqual(records.find(row => row.name === 'follow_up').parent_operation_id, caller);
	});
	it('keeps concurrent DB callbacks associated with their submitter, independent of the previous executor task', async function() {
		traces.enable(); const store = new Datastore({ inMemoryOnly: true }); database_tasks.attach(store, 'matches');
		const gate = deferred(), entered = deferred();
		const first = traces.operation('first', { type: 'point' }, () => new Promise(resolve => {
			store.executor.push({ this: store, arguments: [], diagnostic_name: 'held', fn(done) {
				entered.resolve(); gate.promise.then(() => { done(); resolve(); });
			} });
		}));
		await entered.promise;
		let callback_id;
		const second = traces.operation('second', { type: 'finish' }, () => new Promise((resolve, reject) => {
			store.insert({ _id: 'second' }, error => { callback_id = traces.capture().record.id; if (error) reject(error); else resolve(); });
		}));
		gate.resolve(); await Promise.all([first, second]); await turn();
		const records = completed(), record = records.find(row => row.name === 'second');
		assert.strictEqual(callback_id, record.id);
		assert(record.spans.some(row => row.name === 'matches:insert' && row.kind === 'db_wait'));
		assert(!records.find(row => row.name === 'first').spans.some(row => row.name === 'matches:insert'));
		assert.deepStrictEqual(await promisify(store.findOne.bind(store))({ _id: 'second' }), { _id: 'second' });
	});
	it('records worker queueing and returned phases under the correct initiating trace', async function() {
		traces.enable(); const worker = new EventEmitter(); worker.ref = worker.unref = () => {}; worker.terminate = async () => {};
		const jobs = []; worker.postMessage = job => jobs.push(job);
		const client = new WorkerClient('trace_worker', '', { create_worker: () => worker });
		const first = traces.operation('worker_first', { type: 'sync' }, () => client.run({}));
		const second = traces.operation('worker_second', { type: 'finish' }, () => client.run({}));
		const reply = () => worker.emit('message', { id: jobs.at(-1).id, started: process.hrtime.bigint(), returning: process.hrtime.bigint(),
			value: { diagnostic_phases: [{ name: 'integrate_matches', start_ts: Date.now(), duration_ms: 2, status: 'ok' }] } });
		try { reply(); reply(); await Promise.all([first, second]); }
		finally { client.close(); }
		const record = completed().find(row => row.name === 'worker_second');
		assert(record.spans.some(row => row.kind === 'worker_wait')); assert(record.spans.some(row => row.kind === 'worker_run'));
		const phase = record.spans.find(row => row.kind === 'worker_phase'); assert.strictEqual(phase.name, 'integrate_matches');
		assert.strictEqual(phase.execution, 'worker'); assert.deepStrictEqual(phase.held_locks, []); assert(phase.parent_id);
	});
	it('records reserved admin output after its handler finishes, preserving message order and trace identity', async function() {
		traces.enable(); const ws = new EventEmitter(), messages = []; ws.readyState = 1; ws.send = bytes => messages.push(JSON.parse(bytes));
		const output = outbox(ws); let reservation;
		await traces.operation('overview', { type: 'other' }, async () => { reservation = output.reserve(); });
		await traces.operation('point_event', { type: 'point' }, async () => { output.send({ type: 'change', ctype: 'score', value: 2 }); });
		assert(traces.snapshot().active.some(row => row.name === 'point_event' && row.pending_spans > 0));
		const old_cursor = traces.snapshot(0).cursor;
		output.complete(reservation, { type: 'answer', value: 1 }, 'one', false);
		assert.deepStrictEqual(messages.map(row => row.value), [1, 2]);
		const updated = traces.snapshot(old_cursor).completed;
		assert(updated.some(row => row.name === 'point_event' && row.spans.some(span => span.kind === 'send_wait' && span.status === 'ok')));
		assert(!updated.some(row => row.spans.some(span => span.kind === 'send_wait' && span.status === 'running')));
		assert(!traces.snapshot().active.some(row => row.name === 'point_event'));
	});
	it('retains full sampled history across rolling-window pruning and server restarts', function() {
		const history = new PerformanceHistory();
		const fixture = id => ({ server_id: id, lock: { queue_length: 0, active_tasks: [], recent_tasks: [] }, database: [], workers: [], outgoing: {},
			processing: { cursor: 4, completed: [{ id: 1, revision: 4, spans: [], duration_ms: 7 }], active: [], stages: [] } });
		history.record(fixture('one'), 2, 100000); history.record(fixture('one'), 2, 401000);
		history.record(fixture('two'), 2, 402000);
		assert.strictEqual(history.history.length, 1); assert.strictEqual(history.report().series.length, 3);
		assert.strictEqual(history.report().traces.length, 2, 'IDs from different server runs must not collide');
	});
	it('exports graph samples, trace updates and events without retaining repeated revisions', function() {
		const archive = new Archive();
		for (let revision = 1; revision <= 3; revision++) archive.add({ server_id: 'one', processing: {
			completed: [{ id: 1, revision }], active: [], stages: [] }, events: [{ kind: 'server', ts: 100, label: 'event' }] }, { ts: revision, measured: true });
		const report = archive.export(); assert.strictEqual(report.series.length, 3); assert.strictEqual(report.traces.length, 1);
		assert.strictEqual(report.traces[0].revision, 3); assert.strictEqual(report.events.length, 1);
		assert.strictEqual(report.raw_server_logs_included, false);
	});
	it('correlates reception at both clients with the point trace, independently of server clocks', function() {
		const dashboard = new Dashboard({ ...parse_args(['--plain-log']), quiet: true });
		const score = { court_id: '3', match_id: 'one', network_score: [[1, 0]] };
		dashboard.record_score_sent(score);
		const start = dashboard.receipt_traces.get(score.debug_trace_id).sent_ts;
		dashboard.record_admin_payload({ type: 'change', ctype: 'score', val: score }, start + 6);
		dashboard.record_display_payload('3', 'display_points_update', { match: { id: 'one' }, score: { current_set: { left: 1, right: 0 } } }, start + 9);
		const trace = dashboard.receipt_traces.get(score.debug_trace_id);
		assert.strictEqual(trace.admin_ms, 6); assert.strictEqual(trace.tv_ms, 9);
	});
	it('captures real score phases and TV handoff without enabling console diagnostics', async function() {
		const database = require('../bts/database'), panels = require('../bts/bupws_v2');
		const db = await database.init_test(), tkey = 'trace-score';
		const insert = (store, document) => promisify(store.insert.bind(store))(document);
		await insert(db.tournaments, { key: tkey, bupws_v2_enabled: true });
		await insert(db.courts, { _id: 'trace-court', tournament_key: tkey, match_id: 'trace-match', num: 1 });
		await insert(db.matches, { _id: 'trace-match', tournament_key: tkey, network_score: [[1, 0]], presses: [],
			setup: { match_id: 'trace-match', court_id: 'trace-court', now_on_court: true, state: 'oncourt',
				counting: '3x21', warmup: 'none', teams: [{ players: [] }, { players: [] }] } });
		const app = { db }, ws = { readyState: 1, client_id: 'trace-tv', hostname: 'trace-tv', messages: [],
			send(raw) { this.messages.push(JSON.parse(raw)); }, sendmsg(message) { this.messages.push(message); } };
		panels.on_connect(app, ws); ws.last_tournament_key = tkey; ws.court_id = 'trace-court'; ws.last_v2_match_id = 'trace-match';
		traces.enable();
		try {
			await panels.handle_score_update(app, { client_id: 'trace-tablet', sendmsg() {} }, { tournament_key: tkey,
				score: { match_id: 'trace-match', court_id: 'trace-court', network_score: [[2, 0]], presses: [], debug_trace_id: 'production-score' } });
			const deadline = Date.now() + 1000;
			while (!ws.messages.some(row => row.type === 'display_points_update') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
			await turn();
			const record = completed().find(row => row.trace_id === 'production-score'); assert(record);
			assert(record.spans.some(row => row.name === 'db_update_match')); assert(record.spans.some(row => row.name === 'load_context'));
			assert(record.spans.some(row => row.name.startsWith('tv:') && row.kind === 'send_enqueue'), JSON.stringify(record.spans.map(row => [row.name, row.kind])));
			assert.deepStrictEqual((await db.matches.findOne_async({ _id: 'trace-match' })).network_score, [[2, 0]]);
			assert(ws.messages.some(row => row.type === 'display_points_update'));
		} finally { panels.on_close(app, ws); }
	});
	it('traces an actual admin overview, copying and output encoding through the unchanged response API', async function() {
		const database = require('../bts/database'), admin = require('../bts/admin'), handler = require('../bts/wshandler');
		const db = await database.init_test(), app = { db }, ws = new EventEmitter(), messages = [];
		ws.readyState = 1; ws.send = bytes => messages.push(JSON.parse(bytes));
		handler.handle({ on_connect() {}, on_close() {} }, app, ws);
		await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'trace-admin', name: 'Test' });
		await promisify(db.matches.insert.bind(db.matches))({ _id: 'admin-one', tournament_key: 'trace-admin', setup: { state: 'finished' }, presses: [{ type: 'score' }] });
		traces.enable();
		try {
			await admin.handle_tournament_get(app, ws, { key: 'trace-admin', rid: 5, defer_finished_history: true });
			const deadline = Date.now() + 1000;
			while (!messages.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
			const record = completed().find(row => row.name === 'admin_tournament_get'); assert(record);
			assert.strictEqual(record.type, 'admin'); assert(record.spans.some(row => row.name === 'admin_match_copy'));
			assert(record.spans.some(row => row.kind === 'encoding')); assert(record.spans.some(row => row.kind === 'send_enqueue'));
			assert.strictEqual(messages[0].rid, 5); assert.strictEqual(messages[0].tournament.matches[0].presses_deferred, true);
		} finally { ws.emit('close'); }
	});
	it('records actual sync worker phases and an unchanged skip without unnecessary resource locks', async function() {
		this.timeout(10000);
		const database = require('../bts/database'), sync = require('../bts/btp_sync'), worker = require('../bts/btp_planner');
		const previous = process.env.BTS_SYNC_PLAN_WORKER; process.env.BTS_SYNC_PLAN_WORKER = '1';
		const db = await database.init_test(), tkey = 'trace-sync', app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000000 } };
		await promisify(db.tournaments.insert.bind(db.tournaments))({ key: tkey, btp_enabled: true, last_reset_ts: 1 });
		traces.enable();
		try {
			const response = require('../debug/offload/fixtures').response(2);
			await sync.sync_btp_data(app, tkey, response, { expected_reset_ts: 1 });
			await sync.sync_btp_data(app, tkey, response, { expected_reset_ts: 1 });
			const records = completed();
			assert(records.some(row => row.spans.some(span => span.kind === 'worker_phase' && span.name === 'integrate_matches')));
			const skipped = records.find(row => row.skipped && row.reason === 'no_sync_changes'); assert(skipped);
			assert(!skipped.spans.some(row => row.kind === 'lock_hold'), 'unchanged sync should skip before resource locking');
		} finally {
			worker.client.close(); if (previous === undefined) delete process.env.BTS_SYNC_PLAN_WORKER; else process.env.BTS_SYNC_PLAN_WORKER = previous;
		}
	});
});
