'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const rules = require('../bts/match_automation');
const { read } = require('../bts/preparation_selection/admin_reads');
const encode = require('../bts/admin_response/cooperative');
const fragments = require('../bts/admin_response/selection_cache');
const foreground = require('../bts/foreground_work');
const now_ts = 1792760400000;

async function fixture() {
	const db = await database.init_test(), key = 'cached-selection';
	const insert = (name, value) => promisify(db[name].insert.bind(db[name]))(value);
	await insert('tournaments', { key, call_preparation_matches_automatically_enabled: true, official_rotation_mode: 'disabled' });
	await insert('locations', { _id: 'hall', tournament_key: key });
	await insert('courts', { _id: 'court', tournament_key: key, location_id: 'hall', is_active: true });
	await insert('matches', Array.from({ length: 4 }, (_, i) => ({ _id: 'game-' + i, tournament_key: key, match_order: i + 1,
		setup: { state: 'scheduled', is_match: true, match_num: i + 1, location_id: 'hall',
			scheduled_date: '2026-10-23', scheduled_time_str: '10:00',
			teams: [{ players: [{ name: 'A' + i, btp_id: i * 2 }] }, { players: [{ name: 'B' + i, btp_id: i * 2 + 1 }] }],
		}, presses: [],
	})));
	return { db, key, insert, app: { db } };
}

describe('shared read-only preparation answers', function() {
	let previous, calculate, calculations;
	beforeEach(function() {
		previous = process.env.BTS_PREPARATION_MODEL_READS;
		process.env.BTS_PREPARATION_MODEL_READS = '1';
		calculations = 0; calculate = rules.calculate_all_location_preparation_selections;
		rules.calculate_all_location_preparation_selections = (...args) => { calculations++; return calculate(...args); };
	});
	afterEach(function() {
		rules.calculate_all_location_preparation_selections = calculate;
		if (previous === undefined) delete process.env.BTS_PREPARATION_MODEL_READS; else process.env.BTS_PREPARATION_MODEL_READS = previous;
	});
	it('shares one calculation across admin windows and preserves the ordinary response without copying histories', async function() {
		const f = await fixture();
		const revision = f.db.model.tournament(f.key).matches.get('game-0').data;
		Object.defineProperty(revision, 'presses', { configurable: true, get() { throw Error('copied history'); } });
		try {
			const results = await Promise.all(Array.from({ length: 6 }, () => read(f.app, f.key, { now_ts })));
			assert.strictEqual(calculations, 1);
			assert(results.every(rows => rows === results[0]));
			assert.strictEqual(results[0][0].diagnostics_by_match_id['game-0'].eligible, true);
			assert.deepStrictEqual(results[0], await read(f.app, f.key, { now_ts, cache: false }));
			assert.strictEqual(calculations, 2);
		} finally { delete revision.presses; }
	});
	it('crosses earlier queued writes before reusing a response and retains the old answer unchanged', async function() {
		const f = await fixture(), old = await read(f.app, f.key, { now_ts });
		const update = f.db.matches.update_async({ _id: 'game-0' }, { $set: { 'setup.state': 'preparation' } }, {});
		const next = await read(f.app, f.key, { now_ts });
		await update;
		assert.strictEqual(calculations, 2);
		assert.notStrictEqual(next, old);
		assert.strictEqual(next[0].current_preparation_count, 1);
		assert.strictEqual(old[0].current_preparation_count, 0);
		assert(old[0].candidate_match_ids.includes('game-0'));
		assert(!next[0].candidate_match_ids.includes('game-0'));
	});
	it('defers admin read barriers during a score and reads the committed changes afterwards', async function() {
		const f = await fixture(), snapshot = f.db.model.snapshot;
		let snapshots = 0;
		f.db.model.snapshot = function(...args) { snapshots++; return snapshot.apply(this, args); };
		const end = foreground.begin('handle_score_update_v2');
		assert(end);
		const pending = read(f.app, f.key, { now_ts });
		try {
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(snapshots, 0);
			await f.db.matches.update_async({ _id: 'game-0' }, { $set: { 'setup.state': 'preparation' } }, {});
		} finally { end(); }
		const rows = await pending;
		assert.strictEqual(snapshots, 6);
		assert.strictEqual(rows[0].current_preparation_count, 1);
		assert(!rows[0].candidate_match_ids.includes('game-0'));
	});
	it('allows selection reads inside the operation holding foreground priority', async function() {
		const f = await fixture(), end = foreground.begin('handle_score_update_v2');
		try {
			const rows = await foreground.run(end, () => read(f.app, f.key, { now_ts }));
			assert.strictEqual(rows[0].candidate_match_ids.length, 4);
		} finally { end(); }
	});
	it('defers calculation when a score starts while the input snapshots are being read', async function() {
		const f = await fixture(), snapshot = f.db.model.snapshot;
		let end, captured, count = 0;
		const ready = new Promise(resolve => { captured = resolve; });
		f.db.model.snapshot = async function(...args) {
			const result = await snapshot.apply(this, args);
			if (++count === 6) { end = foreground.begin('handle_score_update_v2'); captured(); }
			return result;
		};
		const pending = read(f.app, f.key, { now_ts });
		try {
			await ready; await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(calculations, 0);
		} finally { end?.(); }
		assert.strictEqual((await pending)[0].candidate_match_ids.length, 4);
	});
	it('invalidates immediately on revisions in every selection input collection, additions and removals', async function() {
		const f = await fixture();
		await read(f.app, f.key, { now_ts });
		for (const [name, query, update] of [
			['tournaments', { key: f.key }, { $set: { official_rotation_mode: 'umpire_only' } }],
			['courts', { _id: 'court' }, { $set: { is_active: false } }],
			['locations', { _id: 'hall' }, { $set: { name: 'Changed' } }],
			['matches', { _id: 'game-1' }, { $set: { match_order: 0 } }],
		]) {
			const before = calculations;
			await f.db[name].update_async(query, update, {});
			await read(f.app, f.key, { now_ts });
			assert.strictEqual(calculations, before + 1, name);
		}
		for (const name of ['umpires', 'tabletoperators']) {
			const before = calculations;
			await f.insert(name, { _id: 'added', tournament_key: f.key });
			await read(f.app, f.key, { now_ts });
			await f.db[name].remove_async({ _id: 'added' }, {});
			await read(f.app, f.key, { now_ts });
			assert.strictEqual(calculations, before + 2, name);
		}
	});
	it('refreshes time-dependent diagnostics and expires even when the tournament clock is frozen', async function() {
		const f = await fixture();
		await read(f.app, f.key, { now_ts });
		await read(f.app, f.key, { now_ts: now_ts + 250 });
		assert.strictEqual(calculations, 2);
		await new Promise(resolve => setTimeout(resolve, 270));
		await read(f.app, f.key, { now_ts: now_ts + 250 });
		assert.strictEqual(calculations, 3);
	});
	it('does not retain a failed calculation', async function() {
		const f = await fixture();
		rules.calculate_all_location_preparation_selections = async () => { throw Error('temporary failure'); };
		await assert.rejects(read(f.app, f.key, { now_ts }), /temporary failure/);
		rules.calculate_all_location_preparation_selections = calculate;
		assert((await read(f.app, f.key, { now_ts })).length > 0);
	});
	it('shares only the selection encoding and preserves each concurrent response ID', async function() {
		let reads = 0;
		const selections = fragments.certify([{ diagnostics_by_match_id: {
			get game() { reads++; return { rules: [{ key: 'complete', passed: true }] }; },
		} }]);
		const messages = await Promise.all([1, 2, 3].map(rid => encode({ type: 'answer', rid, selections })));
		assert.strictEqual(reads, 1);
		for (const [i, bytes] of messages.entries()) assert.deepStrictEqual(JSON.parse(bytes), { type: 'answer', rid: i + 1,
			selections: [{ diagnostics_by_match_id: { game: { rules: [{ key: 'complete', passed: true }] } } }],
		});
		const mutable = [{ value: 1 }];
		await encode({ selections: mutable });
		mutable[0].value = 2;
		assert.strictEqual(JSON.parse(await encode({ selections: mutable })).selections[0].value, 2);
	});
});
