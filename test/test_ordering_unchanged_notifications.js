'use strict';

const assert = require('assert');
const { promisify } = require('util');
const { copy } = require('../bts/btp_sync_effects');
const resources = require('../bts/btp_sync_locks/resources');
const keys = require('../bts/queue_lock_keys');
const database = require('../bts/database');
const planner = require('../bts/btp_sync_plan');
const admin = require('../bts/admin');
const bupws = require('../bts/bupws_v2');
const queue = require('../bts/update_queue');

const make_match = (id, num) => ({ _id: id, tournament_key: 'test', setup: {
	state: 'scheduled', is_match: true, match_num: num,
	teams: [{ players: [{ btp_id: 1, checked_in: true }] }, { players: [{ btp_id: num + 10, checked_in: true }] }],
} });
function plan(effect, { allocation = false, official = false, edit } = {}) {
	const old = make_match('changed', 1), unchanged = make_match('unchanged', 2);
	if (official) old.setup.umpire = { _id: 'official' };
	const next = copy(old); next.setup.match_num = 10001;
	edit?.(next);
	return resources('test', { tournaments: [{ tabletoperator_enabled: allocation }], matches: [old, unchanged] },
		[{ collection: 'matches', id: old._id, before: old, after: next }], [effect]);
}
const notification = value => ({ resources: { notification: { tournament_key: 'test', ctype: 'match_edit', value } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function within(promise) {
	let timer;
	try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Finish waited for a read-only notification')), 2000); })]); }
	finally { clearTimeout(timer); }
}

describe('ordering plans with unchanged match notifications', function() {
	this.timeout(10000);
	it('keeps a pure ordering plan narrow for an unchanged full match, wrapper or canonical ID', function() {
		const unchanged = make_match('unchanged', 2);
		for (const value of [unchanged, { match__id: unchanged._id, match: unchanged }, { match__id: unchanged._id }]) {
			const scope = plan(notification(value));
			assert.strictEqual(scope.diagnostics.allocation_scope, 'ordering_only');
			assert.strictEqual(scope.diagnostics.ordering_unchanged_notifications, 1);
			assert.deepStrictEqual([...scope.locked_matches], ['changed']);
			assert(scope.locks.includes(keys.selection('test')));
			assert(!scope.locks.includes(keys.preparation('test')));
		}
	});

	it('rejects missing, changed, mismatched or opaque notification targets', function() {
		const unchanged = make_match('unchanged', 2);
		for (const value of [
			{ match__id: 'missing', match: make_match('missing', 2) },
			{ match__id: 'unchanged', match: { ...unchanged, setup: { ...unchanged.setup, state: 'finished' } } },
			{ match__id: 'unchanged', match: make_match('other', 2) },
			{ match__id: 'unchanged', unknown: true },
			{ match__id: 'unchanged', match: unchanged, all_courts: [] },
			{ _id: 'unchanged' },
		]) assert.strictEqual(plan(notification(value)).diagnostics.allocation_scope, 'full');
		assert.strictEqual(plan({ resources: { notification: { ctype: 'match_called_on_court', value: unchanged } } }).diagnostics.allocation_scope, 'full');
		assert.strictEqual(plan({ resources: { ...notification(unchanged).resources, hidden_bye: true } }).diagnostics.allocation_scope, 'full');
	});

	it('retains assignment, check-in, result, bye and unknown-field protection', function() {
		const effect = notification(make_match('unchanged', 2));
		for (const options of [{ allocation: true }, { official: true }]) {
			const scope = plan(effect, options);
			assert(['full', 'ordering_with_allocation'].includes(scope.diagnostics.allocation_scope));
			assert(scope.locks.includes(keys.preparation('test')));
		}
		for (const edit of [
			next => { next.team1_won = true; },
			next => { next.btp_winner = 1; },
			next => { next.setup.links = { winner: 'later' }; },
			next => { next.setup.teams[0].players[0].checked_in = false; },
			next => { next.setup.future = true; },
		]) assert.strictEqual(plan(effect, { edit }).diagnostics.allocation_scope, 'full');
	});

	it('finishes a real tablet game during ordering apply and refreshes the unchanged notification from stored data', async function() {
		const db = await database.init_test(), key = 'unchanged-finish';
		const app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000000, real_now_ms: Date.now } };
		await promisify(db.tournaments.insert.bind(db.tournaments))({ key, btp_enabled: true, btp_readonly: true,
			bupws_v2_enabled: true, call_preparation_matches_automatically_enabled: true, official_rotation_mode: 'disabled' });
		const changed = make_match('changed', 1), running = make_match('running', 2);
		changed.tournament_key = running.tournament_key = key;
		Object.assign(running.setup, { state: 'oncourt', now_on_court: true, court_id: 'court', counting: '3x21',
			scoring_format: { numSets: 3, set_points: { end_points: 21, max_points: 30 }, last_set_points: { end_points: 21, max_points: 30 } },
		});
		running.network_score = [[21, 18], [21, 17]]; running.presses = [];
		await promisify(db.matches.insert.bind(db.matches))([changed, running]);
		await promisify(db.courts.insert.bind(db.courts))({ _id: 'court', tournament_key: key, num: 1, is_active: true, match_id: 'running' });
		const entered = deferred(), gate = deferred(), original = db.matches.update_async;
		const notify = admin.notify_change, messages = [];
		admin.notify_change = (source, tournament, type, value) => {
			if (source === app && tournament === key) messages.push({ type, value: copy(value) });
			return notify(source, tournament, type, value);
		};
		db.matches.update_async = async (...args) => {
			if (args[0]._id === 'changed' && args[1].$set?.['setup.match_num']) { entered.resolve(); await gate.promise; }
			return original(...args);
		};
		const sync = planner.sync(app, key, {}, { skip_unchanged: false, task_name: 'unchanged_notification_apply' }, async staged => {
			await staged.db.matches.update_async({ _id: 'changed' }, { $set: { 'setup.match_num': 10001 } }, {});
			const unchanged = await staged.db.matches.findOne_async({ _id: 'running' });
			admin.notify_change(staged, key, 'match_edit', { match__id: unchanged._id, match: unchanged });
			return true;
		});
		const tablet = { send: message => messages.push(JSON.parse(message)) };
		try {
			await within(entered.promise);
			await within(bupws.handle_score_update(app, tablet, { tournament_key: key, score: {
				match_id: 'running', court_id: 'court', network_score: running.network_score, presses: [],
				end_ts: 1000000, team1_won: true, finish_confirmed: true,
			} }));
			assert(!messages.some(message => message.type === 'error'));
			assert.strictEqual((await db.matches.findOne_async({ _id: 'running' })).setup.state, 'finished');
		} finally {
			gate.resolve(); await sync;
			db.matches.update_async = original; admin.notify_change = notify;
			await queue.execute_locked([keys.selection(key), keys.preparation(key), keys.tabletoperators(key), keys.umpires(key)], () => {});
		}
		const stored = await db.matches.findOne_async({ _id: 'running' });
		const refreshed = messages.filter(message => message.type === 'match_edit' && message.value?.match__id === 'running').at(-1);
		assert.deepStrictEqual(refreshed.value.match, stored);
		assert.strictEqual(stored.team1_won, true);
		assert.strictEqual((await db.matches.findOne_async({ _id: 'changed' })).setup.match_num, 10001);
	});
});
