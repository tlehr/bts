'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const status = require('../bts/preparation_selection/status');
const timing = require('../bts/preparation_selection/timing');
const rules = require('../bts/match_automation');
const match_utils = require('../bts/match_utils');

const flags = ['BTS_PREPARATION_MODEL_READS', 'BTS_OFFLOAD_TIMING', 'BTS_BTP_SYNC_TIMING', 'BTS_SCORE_PRESS_TIMING'];
const turn = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
	const db = await database.init_test(), key = 'preparation-reads';
	const insert = (collection, doc) => promisify(db[collection].insert.bind(db[collection]))(doc);
	const tournament = await insert('tournaments', { key, automation_enabled: true,
		call_preparation_matches_automatically_enabled: true, official_rotation_mode: 'disabled' });
	await insert('locations', { _id: 'hall', tournament_key: key, name: 'Main hall' });
	await insert('courts', { _id: 'court', tournament_key: key, location_id: 'hall', is_active: true });
	await insert('matches', { _id: 'ready', tournament_key: key, presses: Array.from({ length: 100 }, () => ({ type: 'score' })),
		setup: { state: 'preparation', location_id: 'hall', teams: [{ players: [{ btp_id: 1 }] }, { players: [{ btp_id: 2 }] }] } });
	return { db, key, tournament, insert, app: { db, clock: { now_ms: () => 1000000 } } };
}

describe('preparation status model reads and timing', function() {
	let saved;
	beforeEach(function() {
		saved = Object.fromEntries(flags.map(flag => [flag, process.env[flag]]));
		for (const flag of flags) process.env[flag] = '0';
		process.env.BTS_PREPARATION_MODEL_READS = '1';
	});
	afterEach(function() {
		for (const [flag, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[flag]; else process.env[flag] = value;
		}
	});
	it('uses original immutable references without querying or copying histories for a no-op check', async function() {
		const f = await fixture();
		const data = f.db.model.tournament(f.key).matches.get('ready').data;
		Object.defineProperty(data, 'presses', { enumerable: true, configurable: true,
			get() { throw new Error('copied the score history'); } });
		f.db.matches.find = () => { throw new Error('queried all matches'); };
		f.db.courts.find = () => { throw new Error('queried courts'); };
		const original = rules.calculate_location_preparation_status;
		let checks = 0;
		rules.calculate_location_preparation_status = (input, ...args) => {
			checks++; assert.strictEqual(input.matches[0], data);
			assert.strictEqual(input.courts[0], f.db.model.tournament(f.key).courts.get('court').data);
			return original(input, ...args);
		};
		try {
			const result = await status.inspect(f.app, f.tournament);
			assert.strictEqual(result.read_source, 'object_model');
			assert.deepStrictEqual(result.runnable_locations, []);
			await promisify(match_utils.auto_execute_preparation_selections)(f.app, f.tournament);
			assert.strictEqual(checks, 2);
		} finally { rules.calculate_location_preparation_status = original; }
	});
	it('matches ordinary queries after moves, deletes and changes to successor demand', async function() {
		const f = await fixture();
		await f.insert('locations', { _id: 'other', tournament_key: f.key, name: 'Another hall' });
		await f.insert('courts', { _id: 'second', tournament_key: f.key, location_id: 'other', is_active: true });
		await f.insert('matches', { _id: 'running', tournament_key: f.key,
			setup: { state: 'oncourt', now_on_court: true, court_id: 'second', needs_preparation_successor: false } });
		async function compare() {
			process.env.BTS_PREPARATION_MODEL_READS = '0';
			const old = await status.inspect(f.app, f.tournament);
			process.env.BTS_PREPARATION_MODEL_READS = '1';
			const next = await status.inspect(f.app, f.tournament);
			assert.deepStrictEqual(next.runnable_locations, old.runnable_locations);
			assert.deepStrictEqual(next.locations, old.locations);
		}
		await compare();
		await f.db.matches.update_async({ _id: 'running' }, { $set: { 'setup.needs_preparation_successor': true } }, {});
		await compare();
		await f.db.matches.update_async({ _id: 'ready' }, { $set: { 'setup.location_id': 'other' } }, {});
		await compare();
		await f.db.matches.remove_async({ _id: 'ready' }, {});
		await compare();
		await f.db.matches.update_async({ _id: 'running' }, { $set: { tournament_key: 'elsewhere' } }, {});
		await compare();
		await f.db.courts.update_async({ _id: 'second' }, { $set: { is_active: false } }, {});
		await compare();
	});
	it('uses immutable selection inputs only for automatic work and keeps public candidates detached', async function() {
		const f = await fixture();
		await f.db.matches.update_async({ _id: 'ready' }, { $set: {
			'setup.state': 'scheduled', 'setup.is_match': true, 'setup.incomplete': false,
			'setup.match_num': 1, 'setup.scheduled_date': '2026-10-12', 'setup.scheduled_time_str': '10:00',
		} }, {});
		const read = require('../bts/preparation_selection/selection_reads');
		const automatic = await read(f.app, f.key, 'hall', null, true);
		assert.strictEqual(automatic.matches[0], f.db.model.tournament(f.key).matches.get('ready').data);
		const full = await read(f.app, f.key, 'hall');
		full.matches[0].setup.teams[0].players[0].name = 'Detached';
		assert.notStrictEqual(automatic.matches[0].setup.teams[0].players[0].name, 'Detached');
		const freeze = value => {
			if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
			Object.values(value).forEach(freeze); Object.freeze(value);
		};
		for (const collection of ['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators']) {
			for (const record of f.db[collection].getAllData()) freeze(record);
		}
		const selection = await rules.fetch_location_preparation_selection(f.app, f.key, 'hall', { automatic_only: true });
		assert.deepStrictEqual(selection.auto_selected_matches.map(match => match._id), ['ready']);
		await promisify(match_utils.auto_execute_preparation_selection)(f.app, f.tournament, 'hall');
		assert.strictEqual((await f.db.matches.findOne_async({ _id: 'ready' })).setup.state, 'preparation');
	});
	it('honors a TTL index installed after automatic selection inputs are queued', async function() {
		const f = await fixture();
		await f.db.matches.update_async({ _id: 'ready' }, { $set: { expires: new Date(0) } }, {});
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		f.db.matches.executor.push({ this: f.db.matches, fn: done => { release = done; reached(); }, arguments: [() => {}] });
		await held;
		const captured = require('../bts/preparation_selection/selection_reads')(f.app, f.key, 'hall', null, true);
		await promisify(f.db.matches.ensureIndex.bind(f.db.matches))({ fieldName: 'expires', expireAfterSeconds: 1 });
		release();
		assert.deepStrictEqual((await captured).matches, []);
		assert.strictEqual(f.db.model.tournament(f.key).matches.has('ready'), false);
	});
	it('checks automatic call spacing and reads its tournament without copying all match histories', async function() {
		const f = await fixture();
		await f.db.matches.update_async({ _id: 'ready' }, { $set: {
			'setup.state': 'scheduled', 'setup.is_match': true, 'setup.incomplete': false,
			'setup.match_num': 1, 'setup.scheduled_date': '2026-10-12', 'setup.scheduled_time_str': '00:00',
		} }, {});
		const find = f.db.matches.find;
		f.db.matches.find = function(query, ...args) {
			if (!query._id) throw new Error('copied all score histories for a preparation gap');
			return find.call(this, query, ...args);
		};
		try {
			await promisify(match_utils.queue_auto_execute_preparation_selections)(f.app, f.key);
			const match = await f.db.matches.findOne_async({ _id: 'ready' });
			assert.strictEqual(match.setup.state, 'preparation');
			assert.strictEqual(match.setup.preparation_call_timestamp, f.app.clock.now_ms());
		} finally { f.db.matches.find = find; }
	});
	it('waits for earlier persistence even when a preparation change is already visible in the model', async function() {
		const f = await fixture(), persist = f.db.matches.persistence.persistNewState;
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		f.db.matches.persistence.persistNewState = function(docs, callback) {
			release = () => persist.call(this, docs, callback); reached();
		};
		const write = f.db.matches.update_async({ _id: 'ready' }, { $set: { 'setup.state': 'scheduled' } }, {});
		await held;
		let finished = false;
		const read = status.inspect(f.app, f.tournament).then(result => { finished = true; return result; });
		try { await turn(); await turn(); assert.strictEqual(finished, false); }
		finally { release(); f.db.matches.persistence.persistNewState = persist; }
		await write;
		assert.deepStrictEqual((await read).runnable_locations.map(location => location._id), ['hall']);
	});
	it('keeps TTL expiration on the query path', async function() {
		const f = await fixture();
		await promisify(f.db.matches.ensureIndex.bind(f.db.matches))({ fieldName: 'expires', expireAfterSeconds: 0 });
		await f.db.matches.update_async({ _id: 'ready' }, { $set: { expires: new Date(1) } }, {});
		const result = await status.inspect(f.app, f.tournament);
		assert.strictEqual(result.read_source, 'database');
		assert.deepStrictEqual(result.runnable_locations.map(location => location._id), ['hall']);
		assert.strictEqual(await f.db.matches.findOne_async({ _id: 'ready' }), null);
	});
	it('records reads, synchronous status and separate candidate calculation and execution', async function() {
		const f = await fixture(), warn = console.warn, rows = [];
		process.env.BTS_OFFLOAD_TIMING = '1';
		console.warn = (...args) => { if (String(args[0]).startsWith('[bts] preparation:timing ')) rows.push(JSON.parse(args[0].slice(25))); };
		try {
			await promisify(match_utils.auto_execute_preparation_selections)(f.app, f.tournament);
			await promisify(match_utils.auto_execute_preparation_selection)(f.app, f.tournament, 'hall');
		} finally { console.warn = warn; }
		assert.strictEqual(rows.length, 2);
		assert.deepStrictEqual(rows[0].phases.map(row => row.phase), ['status_read_locations', 'status_read_courts', 'status_read_matches', 'status_calculation']);
		assert.strictEqual(rows[0].reason, 'enough_preparation');
		assert.strictEqual(rows[0].read_source, 'object_model');
		const calculation = rows[1].phases.find(row => row.phase === 'candidate_calculation');
		assert.strictEqual(calculation.synchronous, true); assert(calculation.process_cpu_ms >= 0);
		assert(rows[1].phases.some(row => row.phase === 'selection_read_matches'));
		assert(rows[1].phases.some(row => row.phase === 'execute_preparation_calls'));
		assert(rows.every(row => row.ts >= row.start_ts && row.status === 'ok'));
		assert(rows.flatMap(row => row.phases).every(row => row.ts >= row.start_ts && row.duration_ms >= 0));
		assert(!JSON.stringify(rows).includes('presses'));
	});
	it('preserves query errors and reports their phase without logging payloads', async function() {
		const f = await fixture(), failure = new Error('private data'), warn = console.warn, rows = [];
		process.env.BTS_PREPARATION_MODEL_READS = '0'; process.env.BTS_OFFLOAD_TIMING = '1';
		f.db.matches.find = (_query, callback) => callback(failure);
		console.warn = (...args) => { if (String(args[0]).startsWith('[bts] preparation:timing ')) rows.push(JSON.parse(args[0].slice(25))); };
		try { await assert.rejects(promisify(match_utils.auto_execute_preparation_selections)(f.app, f.tournament), error => error === failure); }
		finally { console.warn = warn; }
		assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].status, 'error');
		assert.strictEqual(rows[0].phases.at(-1).phase, 'status_read_matches');
		assert.strictEqual(rows[0].phases.at(-1).status, 'error');
		assert(!JSON.stringify(rows).includes('private data'));
	});
	it('turns diagnostics off without timing flags and tolerates a failing sink', function() {
		assert.strictEqual(timing.start('key'), null);
		process.env.BTS_OFFLOAD_TIMING = '1';
		const trace = timing.start('key'), warn = console.warn;
		console.warn = () => { throw new Error('closed log'); };
		try { assert.doesNotThrow(() => trace.finish(null)); assert.doesNotThrow(() => trace.finish(null)); }
		finally { console.warn = warn; }
	});
	it('reports tail latency and exact threshold counts, including unmatched updates', function() {
		const { latency_summary } = require('../debug/live_drill_scenario');
		const result = latency_summary([...Array(97).fill(10), 50, 100, 201], 102);
		assert.strictEqual(result.p95, 10); assert.strictEqual(result.p99, 100); assert.strictEqual(result.max, 201);
		assert.strictEqual(result.over_50_ms, 2); assert.strictEqual(result.over_100_ms, 1); assert.strictEqual(result.over_200_ms, 1);
		assert.strictEqual(result.unmatched_updates, 2); assert.strictEqual(result.coverage, .98);
		const empty = latency_summary([], 0);
		assert.strictEqual(empty.p99, null); assert.strictEqual(empty.coverage, null);
	});
});
