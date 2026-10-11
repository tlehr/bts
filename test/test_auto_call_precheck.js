'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const planner = require('../bts/btp_sync_plan');
const preflight = require('../bts/auto_call_precheck');
const match_utils = require('../bts/match_utils');
const rules = require('../bts/match_automation');
const update_queue = require('../bts/update_queue');

let sequence = 0;
async function fixture(settings = {}) {
	const db = await database.init_test();
	const key = 'call-precheck-' + ++sequence;
	let now = 1000000;
	const app = { db, wss: { clients: [] }, clock: { now_ms: () => now } };
	const insert = (collection, document) => promisify(db[collection].insert.bind(db[collection]))(document);
	await insert('tournaments', { key, btp_enabled: true,
		official_rotation_mode: 'disabled', call_next_possible_scheduled_match_in_preparation: true,
		call_on_court_only_preparation_enabled: true, call_on_court_only_preparation_minutes: 0,
		call_on_court_participant_readiness_mode: 'checked_in',
		btp_settings: { check_in_per_match: true }, ...settings });
	await insert('courts', { _id: 'free', tournament_key: key, location_id: 'hall', is_active: true });
	await insert('matches', { _id: 'prepared', btp_id: key + '-prepared', tournament_key: key, btp_match_ids: [{ id: 101 }],
		setup: { is_match: true, incomplete: false, state: 'preparation', location_id: 'hall',
			preparation_call_timestamp: now, match_num: 1, teams: [
				{ players: [{ btp_id: 1, name: 'A', checked_in: false }] },
				{ players: [{ btp_id: 2, name: 'B', checked_in: false }] },
			] } });
	let plans = 0;
	const evaluate = (integrate = async () => true) => planner.sync(app, key, { operation: 'auto_call' }, {
		planning_namespace: 'precheck-test', task_name: 'precheck-test', skip_unchanged: false, preflight,
	}, async staged => { plans++; return integrate(staged); });
	const call = () => new Promise((resolve, reject) => match_utils.queue_auto_call_matches_on_free_courts(app, key,
		error => error ? reject(error) : resolve()));
	const update = (collection, id, fields) => db[collection].update_async({ _id: id }, { $set: fields }, {});
	return { app, key, insert, update, evaluate, call, plans: () => plans, set_now: value => { now = value; } };
}

async function count_selections(work) {
	const original = rules.calculate_call_on_court_selection;
	const worker = require('../bts/btp_planner').client, run = worker.run;
	let count = 0;
	rules.calculate_call_on_court_selection = (...args) => { count++; return original(...args); };
	worker.run = async function(...args) {
		const result = await run.apply(this, args); count += result.selection_calls || 0; return result;
	};
	try { await work(() => count); }
	finally { rules.calculate_call_on_court_selection = original; worker.run = run; }
}

describe('post-sync auto-call precheck', function() {
	it('skips occupied or inactive courts without executing a plan or joining the resource queue', async function() {
		const f = await fixture();
		const original = update_queue.execute_locked;
		let queued = 0;
		update_queue.execute_locked = (...args) => { queued++; return original(...args); };
		try {
			await f.update('courts', 'free', { match_id: 'declared-occupied' });
			assert.strictEqual((await f.evaluate()).reason, 'no_free_courts');
			await f.app.db.courts.update_async({ _id: 'free' }, { $unset: { match_id: true } }, {});
			await f.update('matches', 'prepared', { 'setup.now_on_court': true, 'setup.court_id': 'free' });
			assert.strictEqual((await f.evaluate()).reason, 'no_free_courts');
			await f.update('matches', 'prepared', { 'setup.now_on_court': false });
			await f.update('courts', 'free', { is_active: false });
			assert.strictEqual((await f.evaluate()).reason, 'no_free_courts');
			assert.strictEqual(queued, 0);
			assert.strictEqual(f.plans(), 0);
		} finally { update_queue.execute_locked = original; }
	});

	it('reuses validated no-op inputs while ignoring ordinary points, but reruns for a check-in', async function() {
		const f = await fixture();
		await f.insert('matches', { _id: 'running', tournament_key: f.key, btp_id: f.key + '-running',
			network_score: [[0, 0]], presses: [], setup: { state: 'oncourt', now_on_court: true, court_id: 'other' } });
		await f.evaluate();
		assert.strictEqual((await f.evaluate()).reason, 'unchanged_call_inputs');
		await f.update('matches', 'running', { network_score: [[1, 0]], presses: [{ type: 'score' }],
			duration_ms: 42, network_team1_serving: false, _btp_sync_signature: 'next' });
		assert.strictEqual((await f.evaluate()).reason, 'unchanged_call_inputs');
		assert.strictEqual(f.plans(), 1);
		await f.update('matches', 'prepared', { 'setup.teams.0.players.0.checked_in': true });
		await f.evaluate();
		assert.strictEqual(f.plans(), 2);
	});

	it('calls a newly checked-in game through the production queue and retains canonical relations', async function() {
		const f = await fixture();
		await count_selections(async count => {
			await f.call(); await f.call();
			assert.strictEqual(count(), 1);
			await f.update('matches', 'prepared', { 'setup.teams.0.players.0.checked_in': true,
				'setup.teams.1.players.0.checked_in': true });
			await f.call();
			assert.strictEqual(count(), 2);
			await f.call();
			assert.strictEqual(count(), 2);
		});
		const match = await f.app.db.matches.findOne_async({ _id: 'prepared' });
		assert.strictEqual(match.setup.state, 'oncourt');
		assert.strictEqual(match.setup.court_id, 'free');
		assert.strictEqual((await f.app.db.courts.findOne_async({ _id: 'free' })).match_id, 'prepared');
		const model_match = f.app.db.model.tournament(f.key).matches.get('prepared');
		assert.strictEqual(model_match.court.match, model_match);
	});

	it('calls a ready game as soon as the previously occupied field is released', async function() {
		const f = await fixture({ call_on_court_participant_readiness_mode: 'disabled' });
		await f.insert('matches', { _id: 'old', tournament_key: f.key,
			setup: { state: 'oncourt', now_on_court: true, court_id: 'free' } });
		await f.update('courts', 'free', { match_id: 'old' });
		await count_selections(async count => {
			await f.call();
			assert.strictEqual(count(), 0);
			await f.update('matches', 'old', { team1_won: true, 'setup.state': 'finished', 'setup.now_on_court': false });
			await f.app.db.courts.update_async({ _id: 'free' }, { $unset: { match_id: true } }, {});
			await f.call();
			assert.strictEqual(count(), 1);
		});
		assert.strictEqual((await f.app.db.matches.findOne_async({ _id: 'prepared' })).setup.state, 'oncourt');
	});

	it('invalidates no-op inputs on settings, officials, tablet operators and added/removed games', async function() {
		const f = await fixture();
		await f.evaluate();
		await f.app.db.tournaments.update_async({ key: f.key }, { $set: { call_on_court_only_preparation_minutes: 3 } }, {});
		await f.evaluate();
		await f.insert('umpires', { _id: 'official', tournament_key: f.key, name: 'Official', umpire_wait: 1 });
		await f.evaluate();
		await f.update('umpires', 'official', { umpire_wait: 2 });
		await f.evaluate();
		await f.insert('tabletoperators', { _id: 'operator', tournament_key: f.key, start_ts: 1, court: null });
		await f.evaluate();
		await f.insert('matches', { _id: 'new', tournament_key: f.key, setup: { state: 'scheduled' } });
		await f.evaluate();
		await f.app.db.matches.remove_async({ _id: 'new' }, {});
		await f.evaluate();
		assert.strictEqual(f.plans(), 7);
		assert.strictEqual((await f.evaluate()).reason, 'unchanged_call_inputs');
	});

	it('rechecks preparation age at the exact deadline without any datastore change', async function() {
		const f = await fixture({ call_on_court_only_preparation_minutes: 5, call_on_court_participant_readiness_mode: 'disabled' });
		await count_selections(async count => {
			await f.call();
			f.set_now(1299999); await f.call();
			assert.strictEqual(count(), 1);
			f.set_now(1300000); await f.call();
			assert.strictEqual(count(), 2);
		});
		assert.strictEqual((await f.app.db.matches.findOne_async({ _id: 'prepared' })).setup.called_timestamp, 1300000);
	});

	it('rechecks the scheduled start window without a datastore change', async function() {
		const f = await fixture({ call_on_court_time_limit_before_scheduled_enabled: true,
			call_on_court_time_limit_before_scheduled_minutes: 10, call_on_court_participant_readiness_mode: 'disabled' });
		await f.update('matches', 'prepared', { 'setup.scheduled_date': '2026-10-10', 'setup.scheduled_time_str': '12:00' });
		const deadline = Date.parse('2026-10-10T12:00:00') - 600000;
		await count_selections(async count => {
			f.set_now(deadline - 10); await f.call();
			f.set_now(deadline - 1); await f.call();
			assert.strictEqual(count(), 1);
			f.set_now(deadline); await f.call();
			assert.strictEqual(count(), 2);
		});
		assert.strictEqual((await f.app.db.matches.findOne_async({ _id: 'prepared' })).setup.state, 'oncourt');
	});

	it('rechecks both player and tablet pauses even with per-match check-in enabled', async function() {
		const f = await fixture({ call_on_court_participant_readiness_mode: 'pause_expired',
			btp_settings: { check_in_per_match: true, pause_duration_ms: 200000 } });
		await f.update('matches', 'prepared', { 'setup.teams.0.players.0.last_time_on_court_ts': 900000,
			'setup.teams.1.players.0.tablet_break_active': true, 'setup.teams.1.players.0.tablet_break_until_ts': 1200000 });
		await count_selections(async count => {
			await f.call(); f.set_now(1099999); await f.call();
			assert.strictEqual(count(), 1);
			f.set_now(1100000); await f.call();
			assert.strictEqual(count(), 2);
			f.set_now(1199999); await f.call();
			assert.strictEqual(count(), 2);
			f.set_now(1200000); await f.call();
			assert.strictEqual(count(), 3);
		});
		assert.strictEqual((await f.app.db.matches.findOne_async({ _id: 'prepared' })).setup.state, 'oncourt');
	});

	it('rechecks future waiting tablet operators and a clock moving backwards', async function() {
		const f = await fixture({ tabletoperator_enabled: true });
		await f.insert('tabletoperators', { _id: 'future', tournament_key: f.key, court: null, start_ts: 1100000 });
		await f.evaluate(); f.set_now(1099999);
		assert.strictEqual((await f.evaluate()).reason, 'unchanged_call_inputs');
		f.set_now(1100000); await f.evaluate();
		assert.strictEqual(f.plans(), 2);
		f.set_now(1000000); await f.evaluate();
		assert.strictEqual(f.plans(), 3);
	});

	it('does not cache failed plans and discards a no-op cache after actual changes', async function() {
		const f = await fixture();
		await assert.rejects(f.evaluate(async () => { throw new Error('allocation failed'); }), /allocation failed/);
		await f.evaluate();
		assert.strictEqual(f.plans(), 2);
		await f.update('matches', 'prepared', { 'setup.highlight': 1 });
		await f.evaluate(staged => staged.db.matches.update_async({ _id: 'prepared' }, { $set: { 'setup.highlight': 2 } }, {}).then(() => true));
		await f.evaluate();
		assert.strictEqual(f.plans(), 4);
	});

	it('keeps changes made after preflight or validation visible to the next evaluation', async function() {
		const f = await fixture();
		// This check-in is outside the field-allocation dependency projection,
		// so the read-only plan may still validate. Its cache must use the old
		// immutable input, not swallow the new live document as a baseline.
		await f.evaluate(async () => {
			await f.update('matches', 'prepared', { 'setup.teams.0.players.0.checked_in': true });
			return true;
		});
		await f.evaluate();
		assert.strictEqual(f.plans(), 2);
	});

	it('preserves the captured relationship index in preflight snapshots', async function() {
		const f = await fixture();
		const checked = await preflight.inspect(f.app, f.key);
		assert.strictEqual(checked.state.relations, f.app.db.model.tournament(f.key).relations);
	});
});
