'use strict';

const assert = require('assert');
const database = require('../../bts/database');
const sync = require('../../bts/btp_sync');
const planner = require('../../bts/btp_sync_plan');
const staging = require('../../bts/btp_planner/staging');
const worker = require('../../bts/btp_planner');
const { response } = require('./fixtures');
const { measure, pairs } = require('./measure');

module.exports = async function(samples, records) {
	const db = await database.init_test(), app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000000 } };
	const tkey = 'offline-offloads';
	await new Promise((resolve, reject) => db.tournaments.insert({ key: tkey, btp_enabled: true, last_reset_ts: 1 }, err => err ? reject(err) : resolve()));
	const input = response();
	process.env.BTS_SYNC_PLAN_WORKER = '0';
	await sync.sync_btp_data(app, tkey, input, { expected_reset_ts: 1 });
	const before = await planner._snapshot(db, tkey), worker_cache = {}, main_db = staging.memory_db();
	let previous, previous_source;
	const opts = { expected_reset_ts: 1, worker_operation: 'btp' };
	const descriptors = rows => rows.map(({ resources, command }) => ({ resources, command }));
	const run = async (mode, iteration) => {
		process.env.BTS_SYNC_PLAN_WORKER = mode === 'alternative' ? '1' : '0';
		for (let i = 0; i < 30; i++) input.Result[0].Tournament[0].Players[0].Player[i].Lastname = ['Changed-' + iteration];
		const json = JSON.stringify(input);
		if (mode === 'alternative') return worker.plan(worker_cache, before, app, tkey, json, opts);
		await staging.refresh(main_db, before, previous, previous_source);
		const effects = [], staged = { db: main_db, clock: app.clock, wss: { clients: [] }, _btp_sync_effects: effects };
		const result = await sync._integrate_snapshot(staged, tkey, JSON.parse(json), opts);
		await main_db.wait_for_writes();
		previous = staging.planning_snapshot(main_db); previous_source = before;
		const changes = await staging.differences(before, previous, main_db);
		return { result, effects, changes: changes.map(({ collection, id, after, update }) => ({ collection, id, after, update })) };
	};
	try {
		records.length = 0;
		const cold = await measure(() => run('alternative', -1));
		const cold_start = { ...cold.measurement, tasks: records.slice() };
		await run('main', -1);
		const result = await pairs(samples, run, (a, b) => {
			assert.deepStrictEqual(a.changes, b.changes); assert.deepStrictEqual(descriptors(a.effects), descriptors(b.effects));
			assert.strictEqual(a.result, b.result);
		}, records);
		return { scope: 'Private sync planning only: refresh, integration, diff and transport; excludes live locks, apply and publication.',
			input: { matches: 519, players: 1038, changed_player_profiles: 30, fixed_clock_ms: 1000000 }, cold_start, ...result };
	} finally { worker.client.close(); }
};
