'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const btp_sync = require('../bts/btp_sync');
const planner = require('../bts/btp_sync_plan');
const effects = require('../bts/btp_sync_effects');
const update_queue = require('../bts/update_queue');
const keys = update_queue.lock_keys;
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

function response() {
	const players = [1, 2, 3, 4].map(id => ({ ID: [id], Firstname: ['Player'], Lastname: [String(id)], CheckedIn: [false] }));
	const entries = players.map(player => ({ ID: player.ID, Player1ID: player.ID }));
	const nodes = players.map(player => ({ ID: [100 + player.ID[0]], DrawID: [10], PlanningID: player.ID, EntryID: player.ID }));
	const matches = [1, 2].map(id => ({
		ID: [id], DrawID: [10], PlanningID: [1000 + id], From1: [id * 2 - 1], From2: [id * 2],
		IsMatch: [true], IsPlayable: [true], MatchNr: [id], Highlight: [0], Status: [0],
		RoundName: ['G1'], PlannedTime: [{ year: 2026, month: 10, day: 10, hour: 10, minute: id }],
	}));
	return { Result: [{ Tournament: [{
		Matches: [{ Match: [...nodes, ...matches] }], Players: [{ Player: players }], Entries: [{ Entry: entries }],
		Events: [{ Event: [{ ID: [20], Name: ['HE'], GameTypeID: [1] }] }],
		Stages: [{ Stage: [{ ID: [30], EventID: [20], Name: ['Group'], StageType: [1], DisplayOrder: [1] }] }],
		Draws: [{ Draw: [{ ID: [10], EventID: [20], StageID: [30], Name: ['HE'], Position: [1] }] }],
		Settings: [{ Setting: [
			{ ID: [1001], Value: ['Test'] }, { ID: [1008], Value: ['URN'] },
			{ ID: [1003], Value: [false] }, { ID: [1303], Value: [2] },
		] }],
	}] }] };
}

let sequence = 0;
async function fixture() {
	const db = await database.init_test();
	const tkey = 'delta-' + ++sequence;
	await promisify(db.tournaments.insert.bind(db.tournaments))({ key: tkey, btp_enabled: true, last_reset_ts: 1 });
	for (const id of ['one', 'two']) await promisify(db.matches.insert.bind(db.matches))({
		_id: id, tournament_key: tkey, btp_id: id, network_score: [[0, 0]], presses: [],
		setup: { state: 'oncourt', now_on_court: true, court_id: 'court-' + id,
			teams: [{ players: [{ btp_id: id === 'one' ? 1 : 2, checked_in: false }] }] },
	});
	return { app: { db, wss: { clients: [] } }, tkey };
}

async function wait_pending(tkey, court) {
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		if (update_queue.stats().pending_tasks.some(task => task.task === 'fetch_sync_apply' && task.locks.includes(keys.sync(tkey)) && (!court || task.locks.includes(keys.court(tkey, court))))) return;
		await new Promise(resolve => setTimeout(resolve, 2));
	}
	assert.fail('sync apply was not queued');
}
async function hold(locks) {
	const entered = deferred();
	const gate = deferred();
	const done = update_queue.execute_locked(locks, async () => { entered.resolve(); await gate.promise; });
	await entered.promise;
	return { release: gate.resolve, done };
}

const OPTIONS = { expected_reset_ts: 1 };
async function edit_one(app) {
	await app.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.checked_in': true } }, {});
	return true;
}

describe('incremental BTP sync plans', function() {
	it('keeps read-only source snapshots stable while writes create isolated replacements', async function() {
		const { app, tkey } = await fixture();
		const before = await planner._snapshot(app.db, tkey);
		const old = before.matches.find(doc => doc._id === 'one');
		const freeze = value => {
			if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
			Object.values(value).forEach(freeze);
			Object.freeze(value);
		};
		Object.values(before).forEach(freeze);
		await planner.sync(app, tkey, {}, OPTIONS, edit_one);
		assert.strictEqual(old.setup.teams[0].players[0].checked_in, false);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.teams[0].players[0].checked_in, true);
	});

	it('does not absorb concurrent changes on an unrelated match into the skip baseline', async function() {
		const { app, tkey } = await fixture();
		const original = app.db.matches.update_async;
		let plans = 0;
		const integrate = async staged => { plans++; return edit_one(staged); };
		app.db.matches.update_async = async (...args) => {
			const result = await original(...args);
			if (args[0]._id === 'one') await original({ _id: 'two' }, { $set: { 'setup.needs_preparation_successor': true } }, {});
			return result;
		};
		try { await planner.sync(app, tkey, {}, OPTIONS, integrate); }
		finally { app.db.matches.update_async = original; }
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(plans, 2);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'two' })).setup.needs_preparation_successor, true);
	});

	it('includes staged writes and effects whose helper returned before its callback', async function() {
		const { app, tkey } = await fixture();
		let published = false;
		await planner.sync(app, tkey, { version: 1 }, OPTIONS, staged => {
			staged.db.matches.update({ _id: 'one' }, { $set: { 'setup.callback_completed': true } }, {}, err => {
				assert.ifError(err);
				effects.capture(staged, () => { published = true; }, { matches: ['one'] });
			});
			return true;
		});
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.callback_completed, true);
		assert.strictEqual(published, true);
	});

	it('rejects failed staged writes even when their helper ignores the error', async function() {
		const { app, tkey } = await fixture();
		await assert.rejects(planner.sync(app, tkey, { version: 1 }, OPTIONS, staged => {
			staged.db.matches.update({ _id: 'one' }, { $invalid: {} }, {}, () => {});
			return true;
		}), /Unknown modifier/);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.callback_completed, undefined);
		await planner.sync(app, tkey, { version: 1 }, OPTIONS, edit_one);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.teams[0].players[0].checked_in, true);
	});

	it('rechecks preparation age and calls free courts through a separate validated plan', async function() {
		const { app, tkey } = await fixture();
		let clock = 6 * 60 * 1000;
		app.clock = { now_ms: () => clock };
		await app.db.matches.remove_async({}, { multi: true });
		await app.db.tournaments.update_async({ key: tkey }, { $set: {
			official_rotation_mode: 'disabled',
			call_next_possible_scheduled_match_in_preparation: true,
			call_on_court_only_preparation_enabled: true,
			call_on_court_only_preparation_minutes: 5,
			btp_settings: { check_in_per_match: true },
		} }, {});
		await promisify(app.db.courts.insert.bind(app.db.courts))({
			_id: 'free', tournament_key: tkey, location_id: 'hall', btp_id: 1, is_active: true,
		});
		await promisify(app.db.matches.insert.bind(app.db.matches))({
			_id: 'prepared', tournament_key: tkey, btp_id: 'prepared', btp_match_ids: [{ id: 101 }],
			setup: {
				is_match: true, incomplete: false, state: 'preparation', location_id: 'hall',
				preparation_call_timestamp: 4 * 60 * 1000, match_num: 1,
				teams: [
					{ players: [{ name: 'A', btp_id: 1 }] },
					{ players: [{ name: 'B', btp_id: 2 }] },
				],
			},
		});
		const auto_call = () => new Promise((resolve, reject) => {
			require('../bts/match_utils').queue_auto_call_matches_on_free_courts(app, tkey,
				err => err ? reject(err) : resolve());
		});
		await auto_call();
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'prepared' })).setup.state, 'preparation');
		clock = 10 * 60 * 1000;
		await auto_call();
		const called = await app.db.matches.findOne_async({ _id: 'prepared' });
		assert.strictEqual(called.setup.state, 'oncourt');
		assert.strictEqual(called.setup.court_id, 'free');
		assert.strictEqual(called.setup.called_timestamp, clock);
		assert.strictEqual((await app.db.courts.findOne_async({ _id: 'free' })).match_id, 'prepared');
	});

	it('initializes actual court occupancy and officials without executing planning notifications', async function() {
		const { app, tkey } = await fixture();
		await app.db.matches.remove_async({}, { multi: true });
		const data = response();
		const tournament = data.Result[0].Tournament[0];
		tournament.Locations = [{ Location: [{ ID: [1], Name: ['Hall'] }] }];
		tournament.Courts = [{ Court: [{ ID: [1], Name: ['1'], LocationID: [1], MatchID: [1] }] }];
		tournament.Officials = [{ Official: [{ ID: [11], FirstName: ['Test'], Name: ['Official'], Country: ['DE'] }] }];
		Object.assign(tournament.Matches[0].Match.find(match => match.ID[0] === 1), {
			CourtID: [1], LocationID: [1], Official1ID: [11],
		});
		assert.strictEqual(await btp_sync.sync_btp_data(app, tkey, data, OPTIONS), true);
		const match = await app.db.matches.findOne_async({ 'setup.match_num': 1 });
		assert.strictEqual(match.setup.now_on_court, true);
		assert.strictEqual(match.setup.state, 'oncourt');
		assert(match.setup.called_timestamp);
		assert.strictEqual((await app.db.courts.findOne_async({})).match_id, match._id);
		assert.strictEqual((await app.db.umpires.findOne_async({ btp_id: 11 })).umpire_on_court, match.setup.court_id);
	});

	it('applies a real match delta with no tournament lock and preserves a concurrent local score', async function() {
		const { app, tkey } = await fixture();
		await app.db.matches.remove_async({}, { multi: true });
		const data = response();
		await btp_sync.sync_btp_data(app, tkey, data, OPTIONS);
		const match = await app.db.matches.findOne_async({ 'setup.match_num': 1 });
		await app.db.matches.update_async({ _id: match._id }, { $set: {
			'setup.now_on_court': true, 'setup.state': 'oncourt', 'setup.called_timestamp': 123,
			'setup.court_id': 'court-1', network_score: [[0, 0]], presses: [],
		} }, {});
		await btp_sync.sync_btp_data(app, tkey, data, OPTIONS);
		data.Result[0].Tournament[0].Matches[0].Match.find(raw => raw.ID[0] === 1).Status = [1];
		const blocker = await hold([keys.match(tkey, match._id)]);
		const logs = [];
		const original_warn = console.warn;
		const previous_flag = process.env.BTS_BTP_SYNC_TIMING;
		process.env.BTS_BTP_SYNC_TIMING = '1';
		console.warn = (...args) => logs.push(args.join(' '));
		const sync = btp_sync.sync_btp_data(app, tkey, data, OPTIONS);
		try {
			try {
				await wait_pending(tkey);
				const pending = update_queue.stats().pending_tasks.find(task => task.locks.includes(keys.sync(tkey)));
				assert(!pending.locks.includes(keys.tournament(tkey)));
				await app.db.matches.update_async({ _id: match._id }, {
					$set: { network_score: [[5, 2]] }, $push: { presses: { type: 'point', timestamp: 456 } },
				}, {});
			} finally { blocker.release(); }
			assert.strictEqual(await sync, true);
			await blocker.done;
		} finally {
			console.warn = original_warn;
			if (previous_flag === undefined) delete process.env.BTS_BTP_SYNC_TIMING;
			else process.env.BTS_BTP_SYNC_TIMING = previous_flag;
		}
		const total = logs.filter(line => line.startsWith('[bts] btp_sync:phase_timing '))
			.map(line => JSON.parse(line.slice('[bts] btp_sync:phase_timing '.length)))
			.find(record => record.phase === 'total_incremental');
		assert.strictEqual(total.attempts, 1, 'the actual integration engine must not repeat for an ordinary point');
		const current = await app.db.matches.findOne_async({ _id: match._id });
		assert.deepStrictEqual(current.network_score, [[5, 2]]);
		assert.deepStrictEqual(current.presses, [{ type: 'point', timestamp: 456 }]);
		assert.strictEqual(current.setup.teams[0].players[0].checked_in, true);
	});

	it('uses the existing full integration rules and skips an identical successful sync', async function() {
		const { app, tkey } = await fixture();
		await app.db.matches.remove_async({}, { multi: true });
		const data = response();
		assert.strictEqual(await btp_sync.sync_btp_data(app, tkey, data, OPTIONS), true);
		const matches = await app.db.matches.find_async({ tournament_key: tkey });
		assert.strictEqual(matches.length, 2);
		assert.deepStrictEqual(matches[0].setup.teams.map(team => team.players[0].btp_id).sort(), [1, 2]);
		const original_update = app.db.matches.update;
		app.db.matches.update = () => assert.fail('unchanged sync must not write');
		try {
			assert.deepStrictEqual(await btp_sync.sync_btp_data(app, tkey, data, OPTIONS), { skipped: true, reason: 'no_sync_changes' });
		} finally { app.db.matches.update = original_update; }
	});

	it('holds no resource lock during planning and defers all external effects until apply', async function() {
		const { app, tkey } = await fixture();
		const entered = deferred();
		const planning = deferred();
		let sent = 0;
		const integrate = async staged => {
			await edit_one(staged);
			effects.capture(staged, () => { sent++; });
			entered.resolve();
			await planning.promise;
			return true;
		};
		const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
		await entered.promise;
		try {
			await update_queue.execute_locked([keys.match(tkey, 'two'), keys.court(tkey, 'court-two')], async () => {
				await app.db.matches.update_async({ _id: 'two' }, { $push: { presses: { type: 'point' } } }, {});
			});
			assert.strictEqual(sent, 0);
			assert.strictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.teams[0].players[0].checked_in, false);
		} finally { planning.resolve(); }
		assert.strictEqual(await sync, true);
		assert.strictEqual(sent, 1);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'two' })).presses.length, 1);
	});

	it('lets an unrelated field progress while a changed match waits for its lock', async function() {
		const { app, tkey } = await fixture();
		const blocker = await hold([keys.match(tkey, 'one')]);
		const sync = planner.sync(app, tkey, {}, OPTIONS, edit_one);
		try {
			await wait_pending(tkey);
			const pending = update_queue.stats().pending_tasks.find(task => task.task === 'fetch_sync_apply');
			assert(pending.locks.includes(keys.match(tkey, 'one')));
			assert(!pending.locks.includes(keys.match(tkey, 'two')));
			assert(!pending.locks.includes(keys.tournament(tkey)));
			await update_queue.execute_locked(keys.score_update(tkey, { match_id: 'two', court_id: 'court-two' }), async () => {
				await app.db.matches.update_async({ _id: 'two' }, { $set: { network_score: [[1, 0]] } }, {});
			});
		} finally { blocker.release(); }
		assert.strictEqual(await sync, true);
		await blocker.done;
		assert.deepStrictEqual((await app.db.matches.findOne_async({ _id: 'two' })).network_score, [[1, 0]]);
	});

	it('merges local points on the affected match without replanning and publishes the latest score', async function() {
		const { app, tkey } = await fixture();
		const blocker = await hold([keys.match(tkey, 'one')]);
		let plans = 0;
		const published = [];
		const admin = require('../bts/admin');
		const original_notify = admin.notify_change;
		admin.notify_change = (_app, _tkey, _ctype, value) => published.push(value);
		const logs = [];
		const original_warn = console.warn;
		const previous_flag = process.env.BTS_BTP_SYNC_TIMING;
		process.env.BTS_BTP_SYNC_TIMING = '1';
		console.warn = (...args) => { logs.push(args.join(' ')); };
		const integrate = async staged => {
			plans++;
			await edit_one(staged);
			const match = await staged.db.matches.findOne_async({ _id: 'one' });
			effects.capture(staged, () => {}, { notification: { tournament_key: tkey, ctype: 'match_update', value: { match } } });
			return true;
		};
		const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
		try {
			try {
				await wait_pending(tkey);
				await app.db.matches.update_async({ _id: 'one' }, {
					$set: { network_score: [[2, 0]] }, $push: { presses: { type: 'point', timestamp: 123 } },
				}, {});
				await app.db.matches.update_async({ _id: 'one' }, {
					$set: { network_score: [[2, 1]], duration_ms: 1234, shuttle_count: 2,
						network_team1_left: false, network_team1_serving: false, network_teams_player1_even: [true, false] },
					$push: { presses: { type: 'point', timestamp: 124 } },
				}, {});
			} finally { blocker.release(); }
			assert.strictEqual(await sync, true);
			await blocker.done;
		} finally {
			console.warn = original_warn;
			admin.notify_change = original_notify;
			if (previous_flag === undefined) delete process.env.BTS_BTP_SYNC_TIMING;
			else process.env.BTS_BTP_SYNC_TIMING = previous_flag;
		}
		assert.strictEqual(plans, 1);
		const records = logs.filter(line => line.startsWith('[bts] btp_sync:phase_timing '))
			.map(line => JSON.parse(line.slice('[bts] btp_sync:phase_timing '.length)));
		assert.strictEqual(records.filter(record => record.phase === 'incremental_replan').length, 0);
		const rebase = records.find(record => record.phase === 'incremental_point_rebase');
		assert.strictEqual(rebase.matches, 1);
		assert.deepStrictEqual(rebase.match_ids, ['one']);
		assert.strictEqual(records.find(record => record.phase === 'total_incremental').attempts, 1);
		const match = await app.db.matches.findOne_async({ _id: 'one' });
		assert.deepStrictEqual(match.network_score, [[2, 1]]);
		assert.deepStrictEqual(match.presses, [{ type: 'point', timestamp: 123 }, { type: 'point', timestamp: 124 }]);
		assert.strictEqual(match.duration_ms, 1234);
		assert.strictEqual(match.shuttle_count, 2);
		assert.strictEqual(match.network_team1_left, false);
		assert.strictEqual(match.network_team1_serving, false);
		assert.deepStrictEqual(match.network_teams_player1_even, [true, false]);
		assert.deepStrictEqual(published[0].match, match);
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(plans, 1, 'rebased commit should still allow the next identical sync to skip');
	});

	it('merges points on a dependency-only locked match without writing or replanning it', async function() {
		const { app, tkey } = await fixture();
		const blocker = await hold([keys.match(tkey, 'two')]);
		let plans = 0;
		const integrate = async staged => {
			plans++;
			await edit_one(staged);
			effects.capture(staged, () => {}, { courts: ['court-two'] });
			return true;
		};
		const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
		try {
			await wait_pending(tkey);
			await app.db.matches.update_async({ _id: 'two' }, { $set: { network_score: [[4, 2]] } }, {});
		} finally { blocker.release(); }
		await sync;
		await blocker.done;
		assert.strictEqual(plans, 1);
		assert.deepStrictEqual((await app.db.matches.findOne_async({ _id: 'two' })).network_score, [[4, 2]]);
	});

	for (const [label, values] of [
		['preparation threshold', { 'setup.needs_preparation_successor': true, 'setup.needs_preparation_successor_ts': 123 }],
		['unconfirmed game end', { end_ts: 123 }],
		['confirmed result', { team1_won: true, btp_winner: 1, btp_needsync: true, 'setup.state': 'finished', 'setup.now_on_court': false }],
		['check-in', { 'setup.teams.0.players.0.checked_in': true }],
		['scoring format', { 'setup.scoring_format': { numSets: 1 } }],
	]) {
		it(`still replans concurrent ${label} changes on the affected match`, async function() {
			const { app, tkey } = await fixture();
			const blocker = await hold([keys.match(tkey, 'one')]);
			let plans = 0;
			const integrate = async staged => { plans++; return edit_one(staged); };
			const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
			try {
				await wait_pending(tkey);
				await app.db.matches.update_async({ _id: 'one' }, { $set: { ...values, network_score: [[21, 15]] },
					$push: { presses: { type: 'point', timestamp: 123 } } }, {});
			} finally { blocker.release(); }
			await sync;
			await blocker.done;
			assert.strictEqual(plans, 2);
			const match = await app.db.matches.findOne_async({ _id: 'one' });
			assert.deepStrictEqual(match.network_score, [[21, 15]]);
			assert.deepStrictEqual(match.presses, [{ type: 'point', timestamp: 123 }]);
			for (const [field, value] of Object.entries(values)) {
				const stored = field.split('.').reduce((parent, key) => parent[key], match);
				assert.deepStrictEqual(stored, value);
			}
		});
	}

	for (const [label, values] of [
		['score replacement', { network_score: [[0, 0]], presses: [] }],
		['scoring change', { 'setup.scoring_format': { numSets: 1 } }],
		['opponent replacement', { 'setup.teams.0.players.0.btp_id': 999 }],
	]) {
		it(`replans a remote ${label} against the latest point`, async function() {
			const { app, tkey } = await fixture();
			await app.db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[1, 0]] } }, {});
			const blocker = await hold([keys.match(tkey, 'one')]);
			let plans = 0;
			const integrate = async staged => {
				plans++;
				await staged.db.matches.update_async({ _id: 'one' }, { $set: values }, {});
				return true;
			};
			const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
			try {
				await wait_pending(tkey);
				await app.db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[2, 0]] },
					$push: { presses: { type: 'point', timestamp: 123 } } }, {});
			} finally { blocker.release(); }
			await sync;
			await blocker.done;
			assert.strictEqual(plans, 2);
			const match = await app.db.matches.findOne_async({ _id: 'one' });
			for (const [field, value] of Object.entries(values)) {
				assert.deepStrictEqual(field.split('.').reduce((parent, key) => parent[key], match), value);
			}
		});
	}

	it('replans opaque outgoing match effects so they cannot send a stale score', async function() {
		const { app, tkey } = await fixture();
		const blocker = await hold([keys.match(tkey, 'one')]);
		let plans = 0;
		const sent = [];
		const integrate = async staged => {
			plans++;
			await edit_one(staged);
			const match = await staged.db.matches.findOne_async({ _id: 'one' });
			effects.capture(staged, () => sent.push(match.network_score), { matches: ['one'] });
			return true;
		};
		const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
		try {
			await wait_pending(tkey);
			await app.db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 1]] } }, {});
		} finally { blocker.release(); }
		await sync;
		await blocker.done;
		assert.strictEqual(plans, 2);
		assert.deepStrictEqual(sent, [[[3, 1]]]);
	});

	it('rolls back to the rebased score if a later write fails and can retry the same response', async function() {
		const { app, tkey } = await fixture();
		const blocker = await hold([keys.match(tkey, 'one')]);
		const integrate = async staged => {
			await staged.db.matches.update_async({}, { $set: { 'setup.marker': true } }, { multi: true });
			return true;
		};
		const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
		const original = app.db.matches.update_async;
		let writes = 0;
		try {
			await wait_pending(tkey);
			await original({ _id: 'one' }, { $set: { network_score: [[7, 4]], duration_ms: 500 },
				$push: { presses: { type: 'point', timestamp: 123 } } }, {});
			app.db.matches.update_async = (...args) => ++writes === 2 ? Promise.reject(new Error('rebased write failed')) : original(...args);
			const rejected = assert.rejects(sync, /rebased write failed/);
			blocker.release();
			await rejected;
			await blocker.done;
		} finally { blocker.release(); app.db.matches.update_async = original; }
		const match = await app.db.matches.findOne_async({ _id: 'one' });
		assert.deepStrictEqual(match.network_score, [[7, 4]]);
		assert.deepStrictEqual(match.presses, [{ type: 'point', timestamp: 123 }]);
		assert.strictEqual(match.duration_ms, 500);
		assert.strictEqual(match.setup.marker, undefined);
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.deepStrictEqual((await app.db.matches.findOne_async({ _id: 'one' })).network_score, [[7, 4]]);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.marker, true);
	});

	it('recomputes the lock set if the affected match moved to another court while waiting', async function() {
		const { app, tkey } = await fixture();
		const blocker = await hold([keys.match(tkey, 'one')]);
		const sync = planner.sync(app, tkey, {}, OPTIONS, edit_one);
		try {
			await wait_pending(tkey);
			await app.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.court_id': 'court-new' } }, {});
			const next = await hold([keys.court(tkey, 'court-new')]);
			blocker.release();
			try {
				await blocker.done;
				await wait_pending(tkey, 'court-new');
				const pending = update_queue.stats().pending_tasks.find(task => task.task === 'fetch_sync_apply' && task.locks.includes(keys.sync(tkey)));
				assert(pending.locks.includes(keys.court(tkey, 'court-new')));
			} finally { next.release(); await next.done; }
		} finally { blocker.release(); }
		assert.strictEqual(await sync, true);
	});

	for (const mutation of ['reset', 'disable', 'terminate']) {
		it(`discards a queued plan after ${mutation} without writing or sending effects`, async function() {
			const { app, tkey } = await fixture();
			const blocker = await hold([keys.match(tkey, 'one')]);
			let current = true;
			let sent = 0;
			const integrate = async staged => { effects.capture(staged, () => { sent++; }); return edit_one(staged); };
			const sync = planner.sync(app, tkey, {}, { ...OPTIONS, is_current: () => current }, integrate);
			try {
				await wait_pending(tkey);
				if (mutation === 'reset') await app.db.tournaments.update_async({ key: tkey }, { $set: { last_reset_ts: 2 } }, {});
				if (mutation === 'disable') await app.db.tournaments.update_async({ key: tkey }, { $set: { btp_enabled: false } }, {});
				if (mutation === 'terminate') current = false;
			} finally { blocker.release(); }
			assert.strictEqual((await sync).skipped, true);
			await blocker.done;
			assert.strictEqual(sent, 0);
			assert.strictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.teams[0].players[0].checked_in, false);
		});
	}

	it('locks other matches containing a changed player and both courts for a move', async function() {
		const { app, tkey } = await fixture();
		await app.db.matches.update_async({ _id: 'two' }, { $set: { 'setup.teams.0.players.0.btp_id': 1 } }, {});
		const before = await planner._snapshot(app.db, tkey);
		const old = before.matches.find(match => match._id === 'one');
		const next = effects.copy(old);
		next.setup.court_id = 'new-court';
		const scope = planner._resources(tkey, before, [{ collection: 'matches', id: 'one', before: old, after: next }], []);
		assert(scope.locks.includes(keys.match(tkey, 'two')));
		assert(scope.locks.includes(keys.court(tkey, 'court-one')));
		assert(scope.locks.includes(keys.court(tkey, 'new-court')));
	});

	it('allows points on a related game during metadata apply while finish, check-in and direct writes wait', async function() {
		const { app, tkey } = await fixture();
		await app.db.matches.update_async({ _id: 'one' }, { $set: {
			'setup.state': 'finished', 'setup.now_on_court': false, end_ts: 123, team1_won: true,
		} }, {});
		await app.db.matches.update_async({ _id: 'two' }, { $set: {
			'setup.court_id': 'court-one', 'setup.teams.0.players.0.btp_id': 1,
		} }, {});
		const entered = deferred();
		const gate = deferred();
		const original = app.db.matches.update_async;
		app.db.matches.update_async = async (...args) => {
			if (args[1].$set?.['setup.btp_group_rankings']) { entered.resolve(); await gate.promise; }
			return original(...args);
		};
		const integrate = async staged => {
			await staged.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.btp_group_rankings': [{ rank: 1 }] } }, {});
			return true;
		};
		const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
		await entered.promise;
		const completed = [];
		const points = update_queue.execute_locked(keys.score_update(tkey, { match_id: 'two', court_id: 'court-one' }), async () => {
			await app.db.matches.update_async({ _id: 'two' }, { $set: { network_score: [[3, 2]] }, $push: { presses: { type: 'point' } } }, {});
			completed.push('point');
		});
		const direct = update_queue.execute_locked([keys.match(tkey, 'one')], () => { completed.push('direct'); });
		const finish = update_queue.execute_locked(keys.score_update(tkey, { match_id: 'two', court_id: 'court-one' }, { finish: true }), () => { completed.push('finish'); });
		const checkin = update_queue.execute_locked([keys.preparation(tkey)], () => { completed.push('checkin'); });
		try {
			for (let i = 0; i < 100 && !completed.includes('point'); i++) await turn();
			assert.deepStrictEqual(completed, ['point'], 'related ordinary point should complete before releasing metadata apply');
		} finally {
			gate.resolve();
			try { await Promise.all([sync, points, direct, finish, checkin]); }
			finally { app.db.matches.update_async = original; }
		}
		const two = await app.db.matches.findOne_async({ _id: 'two' });
		assert.deepStrictEqual(two.network_score, [[3, 2]]);
		assert.strictEqual(two.presses.length, 1);
		assert.deepStrictEqual((await app.db.matches.findOne_async({ _id: 'one' })).setup.btp_group_rankings, [{ rank: 1 }]);
	});

	for (const [label, values] of [
		['finished result', { team1_won: true, end_ts: 123, 'setup.state': 'finished', 'setup.now_on_court': false }],
		['bye advancement', { btp_winner: 1, 'setup.state': 'finished' }],
		['official check-in', { 'setup.umpire.checked_in': true }],
		['player check-in', { 'setup.teams.0.players.0.checked_in': true }],
		['preparation successor', { 'setup.needs_preparation_successor': true, 'setup.needs_preparation_successor_ts': 123 }],
	]) {
		it(`replans metadata when a related ${label} completes before apply`, async function() {
			const { app, tkey } = await fixture();
			await app.db.matches.update_async({ _id: 'two' }, { $set: { 'setup.teams.0.players.0.btp_id': 1 } }, {});
			const blocker = await hold(keys.score_update(tkey, { match_id: 'two', court_id: 'court-two' }, { finish: true }));
			let plans = 0;
			const integrate = async staged => {
				plans++;
				await staged.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.btp_group_rankings': [{ rank: 1 }] } }, {});
				return true;
			};
			const sync = planner.sync(app, tkey, {}, OPTIONS, integrate);
			try {
				await wait_pending(tkey);
				await app.db.matches.update_async({ _id: 'two' }, { $set: values }, {});
			} finally { blocker.release(); }
			await Promise.all([sync, blocker.done]);
			assert.strictEqual(plans, 2);
		});
	}

	it('restores completed writes after failure, emits no effects, and retries the same response', async function() {
		const { app, tkey } = await fixture();
		let sent = 0;
		const integrate = async staged => {
			await staged.db.matches.update_async({}, { $set: { 'setup.marker': true } }, { multi: true });
			effects.capture(staged, () => { sent++; });
			return true;
		};
		const original = app.db.matches.update.bind(app.db.matches);
		let writes = 0;
		app.db.matches.update = (...args) => {
			if (++writes === 2) return args.at(-1)(new Error('write failed'));
			return original(...args);
		};
		await assert.rejects(planner.sync(app, tkey, {}, OPTIONS, integrate), /write failed/);
		app.db.matches.update = original;
		assert.strictEqual(sent, 0);
		assert((await app.db.matches.find_async({})).every(match => match.setup.marker === undefined));
		assert.strictEqual(await planner.sync(app, tkey, {}, OPTIONS, integrate), true);
		assert.strictEqual(sent, 1);
	});

	it('waits for cleanup writes before completing a full sync', async function() {
		const { app, tkey } = await fixture();
		const original = app.db.matches.remove_async.bind(app.db.matches);
		const entered = deferred();
		const finish = deferred();
		app.db.matches.remove_async = (...args) => { entered.resolve(); return finish.promise.then(() => original(...args)); };
		let done = false;
		const sync = btp_sync.sync_btp_data(app, tkey, response(), OPTIONS).then(value => { done = true; return value; });
		await entered.promise;
		try { assert.strictEqual(done, false); } finally { finish.resolve(); }
		assert.strictEqual(await sync, true);
	});

	it('rechecks expired player pauses even if the remote response is unchanged', async function() {
		const { app, tkey } = await fixture();
		let time = 100;
		app.clock = { now_ms: () => time };
		await app.db.tournaments.update_async({ key: tkey }, { $set: { btp_settings: { check_in_per_match: false, pause_duration_ms: 100 } } }, {});
		await app.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.last_time_on_court_ts': 100 } }, {});
		let plans = 0;
		const integrate = async () => { plans++; return true; };
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		time = 150;
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(plans, 1);
		time = 201;
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(plans, 2);
	});

	it('refreshes local check-ins and document deletion despite an unchanged response', async function() {
		const { app, tkey } = await fixture();
		let plans = 0;
		const integrate = async () => { plans++; return true; };
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		await app.db.matches.update_async({ _id: 'two' }, { $set: { 'setup.teams.0.players.0.checked_in': true } }, {});
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		await app.db.matches.remove_async({ _id: 'two' }, {});
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(plans, 3);
	});

	it('does not replan identical input for ordinary live point traffic', async function() {
		const { app, tkey } = await fixture();
		let plans = 0;
		const integrate = async () => { plans++; return true; };
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		await app.db.matches.update_async({ _id: 'two' }, { $set: { network_score: [[3, 1]] }, $push: { presses: { type: 'point' } } }, {});
		await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(plans, 1);
	});

	it('keeps pure ordering stable during unrelated point-derived successor changes', async function() {
		const { app, tkey } = await fixture();
		let plans = 0;
		const result = await planner.sync(app, tkey, {}, { ...OPTIONS, skip_unchanged: false }, async staged => {
			plans++;
			await staged.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.match_num': 17 } }, {});
			// A fresh marker during every attempt previously exhausted all retries.
			await app.db.matches.update_async({ _id: 'two' }, { $set: {
				'setup.needs_preparation_successor': true, 'setup.needs_preparation_successor_ts': plans,
				network_score: [[plans, 0]],
			} }, {});
			return true;
		});
		assert.strictEqual(result, true);
		assert.strictEqual(plans, 1);
		const current = await app.db.matches.findOne_async({ _id: 'two' });
		assert.strictEqual(current.setup.needs_preparation_successor_ts, 1);
		assert.deepStrictEqual(current.network_score, [[1, 0]]);
	});

	for (const scenario of ['preparation enabled', 'locked successor', 'unrelated finish']) {
		it('still replans ordering for ' + scenario, async function() {
			const { app, tkey } = await fixture();
			if (scenario === 'preparation enabled') await app.db.tournaments.update_async({ key: tkey }, {
				$set: { call_preparation_matches_automatically_enabled: true },
			}, {});
			let plans = 0;
			await planner.sync(app, tkey, {}, { ...OPTIONS, skip_unchanged: false }, async staged => {
				plans++;
				await staged.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.match_num': 17 } }, {});
				if (plans === 1) await app.db.matches.update_async({ _id: scenario === 'locked successor' ? 'one' : 'two' }, {
					$set: scenario === 'unrelated finish' ? { end_ts: 123, 'setup.state': 'finished', 'setup.now_on_court': false } :
						{ 'setup.needs_preparation_successor': true, 'setup.needs_preparation_successor_ts': 123 },
				}, {});
				return true;
			});
			assert.strictEqual(plans, 2);
		});
	}

	it('allows one additional hidden-bye delivery and repeats checks for pending local sync', async function() {
		const { app, tkey } = await fixture();
		let plans = 0;
		let deliveries = 0;
		const integrate = async staged => {
			plans++;
			effects.capture(staged, () => { deliveries++; }, { hidden_bye: true });
			return true;
		};
		for (let i = 0; i < 3; i++) await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(deliveries, 2);
		await app.db.matches.update_async({ _id: 'one' }, { $set: { btp_needsync: true } }, {});
		for (let i = 0; i < 2; i++) await planner.sync(app, tkey, {}, OPTIONS, integrate);
		assert.strictEqual(plans, 4);
	});
});
