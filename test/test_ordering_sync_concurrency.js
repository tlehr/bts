'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');
const btp_sync = require('../bts/btp_sync');
const match_utils = require('../bts/match_utils');
const update_queue = require('../bts/update_queue');
const { response } = require('../debug/queue_responsiveness/fixture');
const keys = update_queue.lock_keys;

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function within(promise) {
	let timer;
	try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Concurrent operation did not progress')), 2000); })]); }
	finally { clearTimeout(timer); }
}
async function pending(name, key) {
	const deadline = Date.now() + 2000;
	while (Date.now() < deadline) {
		const task = update_queue.stats().pending_tasks.find(task => task.task === name && task.locks.includes(keys.selection(key)));
		if (task) return task;
		await new Promise(resolve => setImmediate(resolve));
	}
	assert.fail('Expected pending ' + name);
}
async function hold(lock) {
	const started = deferred(), gate = deferred();
	const done = update_queue.execute_locked([lock], async () => { started.resolve(); await gate.promise; });
	await started.promise; return { release: gate.resolve, done };
}
let sequence = 0;
async function fixture() {
	const db = await database.init_test(), key = 'ordering-' + ++sequence;
	const app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000000, real_now_ms: Date.now } };
	await promisify(db.tournaments.insert.bind(db.tournaments))({ key, btp_enabled: true, btp_readonly: true,
		call_preparation_matches_automatically_enabled: false, official_rotation_mode: 'disabled' });
	await btp_sync.sync_btp_data(app, key, response(3));
	const matches = await db.matches.find_async({ tournament_key: key });
	const match = matches.find(match => match.setup.match_num === 1);
	const changed = matches.find(match => match.setup.match_num === 2);
	const court = (await db.courts.find_async({ tournament_key: key }))[0];
	return { app, key, match, changed, court };
}
function call(f) {
	return new Promise((resolve, reject) => admin.handle_match_call_on_court(f.app, {
		respond: (_msg, error) => error ? reject(error) : resolve(),
	}, { tournament_key: f.key, match_id: f.match._id, court_id: f.court._id }));
}
async function drain(key) {
	await update_queue.execute_locked([keys.selection(key), keys.preparation(key), keys.umpires(key)], () => {});
}

describe('ordering sync concurrency', function() {
	this.timeout(10000);
	it('lets a real unrelated call finish during ordering apply and preserves its state', async function() {
		const f = await fixture(), entered = deferred(), gate = deferred();
		const original = f.app.db.matches.update_async;
		f.app.db.matches.update_async = async (...args) => {
			if (args[0]._id === f.changed._id && args[1].$set?.['setup.match_num']) { entered.resolve(); await gate.promise; }
			return original(...args);
		};
		const sync = btp_sync.sync_btp_data(f.app, f.key, response(3, true));
		try {
			await within(entered.promise);
			const active = update_queue.stats().active_tasks.find(task => task.locks.includes(keys.sync(f.key)));
			assert(active.locks.includes(keys.selection(f.key)));
			assert(!active.locks.includes(keys.preparation(f.key)));
			await within(call(f));
			assert.strictEqual((await f.app.db.matches.findOne_async({ _id: f.match._id })).setup.state, 'oncourt');
		} finally { gate.resolve(); await sync; f.app.db.matches.update_async = original; await drain(f.key); }
		const match = await f.app.db.matches.findOne_async({ _id: f.match._id });
		assert.strictEqual(match.setup.state, 'oncourt');
		assert.strictEqual((await f.app.db.courts.findOne_async({ _id: f.court._id })).match_id, match._id);
		assert.strictEqual((await f.app.db.matches.findOne_async({ _id: f.changed._id })).setup.match_num, 10002);
	});
	it('finishes a call while its automatic preparation follow-up waits for selection', async function() {
		const f = await fixture();
		await f.app.db.tournaments.update_async({ key: f.key }, { $set: { call_preparation_matches_automatically_enabled: true } }, {});
		const blocker = await hold(keys.selection(f.key));
		try {
			await within(call(f));
			await pending('auto_execute_preparation_selections', f.key);
			assert.strictEqual((await f.app.db.matches.findOne_async({ _id: f.match._id })).setup.state, 'oncourt');
		} finally { blocker.release(); await blocker.done; await drain(f.key); }
	});
	it('replans automatic allocation after match numbers change while its commit waits', async function() {
		const f = await fixture();
		await f.app.db.tournaments.update_async({ key: f.key }, { $set: {
			btp_enabled: false, call_next_possible_scheduled_match_in_preparation: true,
			call_on_court_only_preparation_enabled: true, call_on_court_only_preparation_minutes: 0,
			call_on_court_participant_readiness_mode: 'disabled',
		} }, {});
		await f.app.db.matches.update_async({ _id: { $in: [f.match._id, f.changed._id] } }, { $set: {
			'setup.state': 'preparation', 'setup.location_id': f.court.location_id, 'setup.preparation_call_timestamp': 1000000,
		} }, { multi: true });
		// Keep a single active field so the selected priority is observable.
		await f.app.db.courts.update_async({ _id: { $ne: f.court._id } }, { $set: { is_active: false } }, { multi: true });
		const blocker = await hold(keys.selection(f.key));
		const allocation = promisify(match_utils.auto_call_matches_on_free_courts)(f.app, f.key);
		try {
			await pending('post_sync_auto_call_apply', f.key);
			await f.app.db.matches.update_async({ _id: f.match._id }, { $set: { 'setup.match_num': 100 } }, {});
		} finally { blocker.release(); await blocker.done; await allocation; await drain(f.key); }
		assert.strictEqual((await f.app.db.courts.findOne_async({ _id: f.court._id })).match_id, f.changed._id);
		assert.strictEqual((await f.app.db.matches.findOne_async({ _id: f.match._id })).setup.state, 'preparation');
	});
	for (const mode of ['main', 'worker']) it('commits real automatic calls despite unrelated successor updates (' + mode + ')', async function() {
		const f = await fixture();
		await f.app.db.tournaments.update_async({ key: f.key }, { $set: {
			call_next_possible_scheduled_match_in_preparation: true, call_on_court_only_preparation_enabled: false,
			call_on_court_participant_readiness_mode: 'disabled',
		} }, {});
		const courts = await f.app.db.courts.find_async({ tournament_key: f.key });
		const busy = courts.find(court => court._id !== f.court._id);
		await f.app.db.matches.update_async({ _id: f.match._id }, { $set: { 'setup.state': 'scheduled' } }, {});
		await f.app.db.matches.update_async({ _id: f.changed._id }, { $set: {
			'setup.state': 'oncourt', 'setup.now_on_court': true, 'setup.court_id': busy._id,
		} }, {});
		await f.app.db.courts.update_async({ _id: busy._id }, { $set: { match_id: f.changed._id } }, {});
		await f.app.db.courts.update_async({ _id: { $nin: [f.court._id, busy._id] } }, { $set: { is_active: false } }, { multi: true });
		let plans = 0;
		const update_successor = async () => {
			plans++;
			await f.app.db.matches.update_async({ _id: f.changed._id }, { $set: {
				'setup.needs_preparation_successor': true, 'setup.needs_preparation_successor_ts': plans,
			} }, {});
		};
		const worker = require('../bts/btp_planner').client, run = worker.run;
		const previous = process.env.BTS_SYNC_PLAN_WORKER;
		process.env.BTS_SYNC_PLAN_WORKER = mode === 'worker' ? '1' : '0';
		if (mode === 'worker') worker.run = async function(...args) {
			const result = await run.apply(this, args);
			await update_successor();
			return result;
		};
		try {
			await require('../bts/btp_sync_plan').sync(f.app, f.key, {}, {
				worker_operation: 'auto_call', planning_namespace: 'successor-test', skip_unchanged: false,
			}, async staged => {
				await promisify(match_utils._plan_auto_call_once)(staged, f.key);
				await update_successor();
				return true;
			});
		} finally {
			worker.run = run;
			worker.close();
			if (previous === undefined) delete process.env.BTS_SYNC_PLAN_WORKER; else process.env.BTS_SYNC_PLAN_WORKER = previous;
		}
		await drain(f.key);
		assert.strictEqual(plans, 1);
		assert.strictEqual((await f.app.db.courts.findOne_async({ _id: f.court._id })).match_id, f.match._id);
		assert.strictEqual((await f.app.db.matches.findOne_async({ _id: f.changed._id })).setup.needs_preparation_successor_ts, 1);
	});
});
