'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const sync = require('../bts/btp_sync');
const planner = require('../bts/btp_sync_plan');
const worker = require('../bts/btp_planner');
const staging = require('../bts/btp_planner/staging');
const effects = require('../bts/btp_sync_effects');
const { response } = require('../debug/offload/fixtures');

async function fixture() {
	const db = await database.init_test(), app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000000 } };
	await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'planner-test', btp_enabled: true, last_reset_ts: 1 });
	const input = response(2);
	process.env.BTS_SYNC_PLAN_WORKER = '0'; await sync.sync_btp_data(app, 'planner-test', input, { expected_reset_ts: 1 });
	process.env.BTS_SYNC_PLAN_WORKER = '1';
	return { app, input, tkey: 'planner-test' };
}

describe('persistent sync planning worker', function() {
	let previous, previous_return;
	beforeEach(function() {
		previous = process.env.BTS_SYNC_PLAN_WORKER; previous_return = process.env.BTS_SYNC_PLAN_PATCH_RETURN;
		process.env.BTS_SYNC_PLAN_WORKER = '1';
	});
	afterEach(function() {
		worker.client.close();
		if (previous === undefined) delete process.env.BTS_SYNC_PLAN_WORKER; else process.env.BTS_SYNC_PLAN_WORKER = previous;
		if (previous_return === undefined) delete process.env.BTS_SYNC_PLAN_PATCH_RETURN; else process.env.BTS_SYNC_PLAN_PATCH_RETURN = previous_return;
	});
	it('produces the same writes and serializable effects as main-thread integration', async function() {
		const { app, input, tkey } = await fixture(), before = await planner._snapshot(app.db, tkey);
		input.Result[0].Tournament[0].Players[0].Player[0].Lastname = ['Changed'];
		const cache = {}, opts = { expected_reset_ts: 1, worker_operation: 'btp' };
		const actual = await worker.plan(cache, before, app, tkey, JSON.stringify(input), opts);
		const db = staging.memory_db(); await staging.refresh(db, before);
		const captured = [], staged = { db, clock: app.clock, wss: { clients: [] }, _btp_sync_effects: captured };
		await sync._integrate_snapshot(staged, tkey, input, opts); await db.wait_for_writes();
		const expected = await staging.differences(before, staging.planning_snapshot(db), db);
		assert.deepStrictEqual(actual.changes, expected.map(({ collection, id, after, update }) => ({ collection, id, after, update })));
		const descriptors = rows => rows.map(({ resources, command }) => ({ resources, command }));
		assert.deepStrictEqual(descriptors(actual.effects), descriptors(captured));
		assert(actual.changes.some(change => change.collection === 'matches'));
	});
	it('sends immutable-reference deltas and reseeds after a worker restart', async function() {
		const { app, input, tkey } = await fixture(), cache = {}, opts = { expected_reset_ts: 1, worker_operation: 'btp' };
		const first = await planner._snapshot(app.db, tkey);
		await worker.plan(cache, first, app, tkey, JSON.stringify(input), opts);
		await app.db.matches.update_async({ _id: first.matches[0]._id }, { $set: { custom_marker: 'changed' } }, {});
		const second = await planner._snapshot(app.db, tkey), delta = worker.delta(second, first);
		assert.strictEqual(delta.upserts, 1); assert.strictEqual(delta.removed, 0);
		await worker.plan(cache, second, app, tkey, JSON.stringify(input), opts);
		worker.client.close();
		const result = await worker.plan(cache, second, app, tkey, JSON.stringify(input), opts);
		assert.strictEqual(result.result, true);
	});
	it('returns patches from a real worker, retaining identical plans and effects across requests and restart', async function() {
		const { app, input, tkey } = await fixture(), cache = {}, opts = { expected_reset_ts: 1, worker_operation: 'btp' };
		const matches = await app.db.matches.find_async({ tournament_key: tkey });
		await app.db.matches.update_async({ _id: matches[0]._id }, { $set: { presses: [{ type: 'score', team: 1 }] } }, {});
		const before = await planner._snapshot(app.db, tkey);
		input.Result[0].Tournament[0].Players[0].Player[0].Lastname = ['Changed'];
		process.env.BTS_SYNC_PLAN_PATCH_RETURN = '0';
		const documents = await worker.plan(cache, before, app, tkey, JSON.stringify(input), opts);
		process.env.BTS_SYNC_PLAN_PATCH_RETURN = '1';
		const run = worker.client.run;
		let returned;
		worker.client.run = async function(...args) {
			const result = await run.apply(this, args);
			returned = structuredClone(result);
			return result;
		};
		try {
			for (let i = 0; i < 2; i++) {
				if (i) worker.client.close();
				const patches = await worker.plan(cache, before, app, tkey, JSON.stringify(input), opts);
				assert.deepStrictEqual(patches.changes, documents.changes);
				assert.deepStrictEqual(patches.effects, documents.effects);
				assert(returned.changes.some(change => change.after_delta));
				assert(returned.changes.filter(change => change.after_delta).every(change => !change.after && !change.after_delta.set.presses));
				assert.strictEqual(patches.changes.find(change => change.id === matches[0]._id).after.presses, before.matches.find(match => match._id === matches[0]._id).presses);
			}
		} finally { worker.client.run = run; }
	});
	it('rejects a snapshot reset during worker execution before publishing any changes', async function() {
		const { app, input, tkey } = await fixture(), run = worker.client.run;
		input.Result[0].Tournament[0].Players[0].Player[0].Lastname = ['Stale'];
		const before = await app.db.matches.find_async({ tournament_key: tkey });
		worker.client.run = async function(...args) {
			const result = await run.apply(this, args);
			await app.db.tournaments.update_async({ key: tkey }, { $set: { last_reset_ts: 2 } }, {});
			return result;
		};
		try {
			const result = await sync.sync_btp_data(app, tkey, input, { expected_reset_ts: 1 });
			assert.strictEqual(result.reason, 'tournament_reset_during_sync');
			assert.deepStrictEqual(await app.db.matches.find_async({ tournament_key: tkey }), before);
		} finally { worker.client.run = run; }
	});
	it('replans if the server clock configuration changes while the worker runs', async function() {
		const { app, input, tkey } = await fixture(), run = worker.client.run;
		let state = { mode: 'fixed', fixed_ts: 1000000 }, calls = 0;
		app.clock = { now_ms: () => state.fixed_ts, get_state: () => state };
		input.Result[0].Tournament[0].Players[0].Player[0].Lastname = ['Current'];
		worker.client.run = async function(...args) {
			const result = await run.apply(this, args);
			if (++calls === 1) state = { mode: 'fixed', fixed_ts: 2000000 };
			return result;
		};
		try {
			await sync.sync_btp_data(app, tkey, input, { expected_reset_ts: 1 });
			assert.strictEqual(calls, 2);
			const matches = await app.db.matches.find_async({ tournament_key: tkey });
			assert(matches.some(match => match.setup.teams.some(team => team.players.some(player => player.lastname === 'Current'))));
		} finally { worker.client.run = run; }
	});
	it('retains both court notifications and refuses unknown effect commands', function() {
		const bup = require('../bts/bupws'), original = bup.handle_score_change, calls = [];
		bup.handle_score_change = (app, ...args) => calls.push(args);
		try {
			effects.restore({ command: { target: 'bupws', method: 'notify_courts', args: ['t', 'new', 'old'] }, resources: {} }).run({});
			assert.deepStrictEqual(calls, [['t', 'new'], ['t', 'old']]);
			assert.throws(() => effects.restore({ command: { target: 'fs', method: 'writeFile', args: [] } }).run({}), /Unknown/);
		} finally { bup.handle_score_change = original; }
	});
});
