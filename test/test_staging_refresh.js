'use strict';

const assert = require('assert');
const Datastore = require('nedb');
const staging = require('../bts/btp_planner/staging');
const writes = require('../bts/btp_planner/refresh_writes');

function state(count = 64) {
	const result = Object.fromEntries(staging.COLLECTIONS.map(name => [name, []]));
	result.tournaments = [{ _id: 't', key: 'test', events: { events: [] } }];
	result.matches = Array.from({ length: count }, (_, i) => ({ _id: 'm' + i, btp_id: 'game-' + i,
		tournament_key: 'test', created: new Date(1000 + i), network_score: [[0, 0]], setup: {
			match_num: i, state: 'scheduled', is_match: true, teams: [
				{ players: [{ btp_id: i * 2, name: 'A' }] }, { players: [{ btp_id: i * 2 + 1, name: 'B' }] },
			],
		} }));
	return result;
}

describe('private planning snapshot refresh', function() {
	it('matches ordinary NeDB replacement, insertion and removal, preserving canonical identity and dates', async function() {
		const fast = staging.memory_db(), ordinary = staging.memory_db(), initial = state();
		const update = ordinary.matches.update_async;
		ordinary.matches.update_async = (...args) => update(...args);
		assert.strictEqual(writes.supported(ordinary.matches), false);
		await staging.refresh(fast, initial); await staging.refresh(ordinary, initial);
		const original = fast.model.tournament('test').matches.get('m1');
		const next = structuredClone(initial);
		next.matches.shift(); next.matches[0].setup.teams[0].players[0].btp_id = 999;
		next.matches[0].setup.state = 'oncourt'; next.matches[0].setup.court_id = 'c';
		next.matches.push({ ...structuredClone(initial.matches[0]), _id: 'new', btp_id: 'new-game' });
		for (const db of [fast, ordinary]) await staging.refresh(db, next, staging.planning_snapshot(db), initial);
		assert.deepStrictEqual(staging.planning_snapshot(fast), staging.planning_snapshot(ordinary));
		assert.strictEqual(fast.model.tournament('test').matches.get('m1'), original);
		assert.strictEqual(original.data.setup.teams[0].players[0].btp_id, 999);
		assert(original.data.created instanceof Date);
		assert.strictEqual(fast.model.tournament('test').matches.has('m0'), false);
		assert.deepStrictEqual([...fast.model.tournament('test').relations.for_player(999)], ['m1']);
		const reactivated = { ...next, matches: [...next.matches, initial.matches[0]] };
		await staging.refresh(fast, reactivated, staging.planning_snapshot(fast), next);
		assert.strictEqual(fast.model.tournament('test').matches.get('m0').present, true);
	});

	it('skips unchanged revisions and restores prior planning edits before computing the next diff', async function() {
		const db = staging.memory_db(), source = state(), metrics = {};
		await staging.refresh(db, source);
		assert.strictEqual(await staging.refresh(db, source, staging.planning_snapshot(db), source, metrics), 0);
		assert.strictEqual(metrics.refresh_operations, 0);
		await db.matches.update_async({ _id: 'm1' }, { $set: { 'setup.state': 'finished', team1_won: true } }, {});
		const previous = staging.planning_snapshot(db);
		assert.strictEqual(await staging.refresh(db, source, previous, source, metrics), 1);
		assert.strictEqual((await db.matches.findOne_async({ _id: 'm1' })).setup.state, 'scheduled');
		assert.strictEqual(db.matches._btp_dirty.size, 0);
		assert.deepStrictEqual(await staging.differences(source, staging.planning_snapshot(db), db), []);
		await db.matches.update_async({ _id: 'm1' }, { $set: { network_score: [[1, 0]] } }, {});
		const diff = await staging.differences(source, staging.planning_snapshot(db), db);
		assert.strictEqual(diff.length, 1); assert.deepStrictEqual(diff[0].update.$set.network_score, [[1, 0]]);
	});

	it('uses bounded queue groups for 519 replacements and allows queued reads between groups', async function() {
		const db = staging.memory_db(), initial = state(519);
		await staging.refresh(db, initial);
		const before = staging.planning_snapshot(db), metrics = {};
		const next = { ...initial, matches: initial.matches.map(m => ({ ...m, changed: true })) };
		let probe;
		const upsert = db.model._upsert;
		db.model._upsert = function(collection, doc) {
			const result = upsert.call(this, collection, doc);
			if (collection === 'matches' && doc.changed && !probe) probe = db.matches.find_async({ changed: true });
			return result;
		};
		try {
			assert.strictEqual(await staging.refresh(db, next, before, initial, metrics), 519);
			const observed = await probe;
			assert(observed.length > 0 && observed.length <= 32, 'A queued read was starved until the entire refresh');
			assert.strictEqual(metrics.refresh_operations, 519);
			assert(metrics.refresh_groups >= Math.ceil(519 / 32) && metrics.refresh_groups < 519);
			assert.strictEqual((await db.matches.find_async({ changed: true })).length, 519);
		} finally { db.model._upsert = upsert; }
	});

	it('preserves queued writer ordering and tracks pending refresh work', async function() {
		const db = staging.memory_db(), source = state(1);
		await staging.refresh(db, source);
		const update = db.matches.update_async({ _id: 'm0' }, { $set: { queued_marker: true } }, {});
		const done = db.wait_for_writes();
		await Promise.all([update, done]);
		const previous = staging.planning_snapshot(db);
		let release, queued;
		const entered = new Promise(resolve => db.matches.executor.push({ this: db.matches,
			fn: done => { release = done; resolve(); }, arguments: [() => {}] }));
		await entered;
		const group_queued = new Promise(resolve => { queued = resolve; });
		const push = db.matches.executor.push;
		db.matches.executor.push = function(task, ...args) {
			const result = push.call(this, task, ...args);
			if (task.diagnostic_name === 'planning_refresh') queued();
			return result;
		};
		try {
			const refresh = staging.refresh(db, source, previous, source);
			await group_queued;
			let finished = false;
			const waiting = db.wait_for_writes().then(() => { finished = true; });
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(finished, false);
			release(); await Promise.all([refresh, waiting]);
		} finally { db.matches.executor.push = push; }
		assert.strictEqual((await db.matches.findOne_async({ _id: 'm0' })).queued_marker, undefined);
	});

	it('retains validation and unique-index failures and exposes write errors to waiters', async function() {
		for (const invalid of [
			{ _id: 'bad', key: 'test' },
			{ _id: 'bad', key: 'other', '$invalid': true },
		]) {
			const db = staging.memory_db(), initial = state(1);
			await staging.refresh(db, initial);
			const next = { ...initial, tournaments: [...initial.tournaments, invalid] };
			await assert.rejects(staging.refresh(db, next, staging.planning_snapshot(db), initial));
			await assert.rejects(db.wait_for_writes());
			assert.deepStrictEqual(await db.tournaments.find_async({}), initial.tournaments);
		}
	});

	it('releases pending-write tracking when queue admission fails', async function() {
		const db = staging.memory_db(), initial = state(1);
		await staging.refresh(db, initial);
		const previous = staging.planning_snapshot(db);
		const next = { ...initial, matches: initial.matches.map(m => ({ ...m, changed: true })) };
		const push = db.matches.executor.push;
		db.matches.executor.push = () => { throw new Error('queue closed'); };
		try {
			await assert.rejects(staging.refresh(db, next, previous, initial), /queue closed/);
			await assert.rejects(db.wait_for_writes(), /queue closed/);
		} finally { db.matches.executor.push = push; }
	});

	it('refuses persistent, timestamped, expiring and overridden stores', function() {
		const persistent = new Datastore({ filename: '/tmp/bts-refresh-unopened-test' });
		assert.strictEqual(writes.supported(persistent), false);
		assert.throws(() => writes.register(persistent, {}), /private memory store/);
		for (const alter of [s => { s.timestampData = true; }, s => { s.ttlIndexes.expiry = 1; },
			s => { s._update = () => {}; }, s => { s.updateIndexes = () => {}; },
			s => { s.persistence.persistNewState = () => {}; }, s => { s.persistence.inMemoryOnly = false; },
			s => { s.getCandidates = () => {}; }]) {
			const db = staging.memory_db(); alter(db.matches);
			assert.strictEqual(writes.supported(db.matches), false);
		}
	});
});
