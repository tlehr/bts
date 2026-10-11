'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');
const planner = require('../bts/btp_sync_plan');
const match_utils = require('../bts/match_utils');
const queue = require('../bts/update_queue');
const { response } = require('../debug/queue_responsiveness/fixture');
const keys = queue.lock_keys;

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function within(promise) {
	let timer;
	try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Related call was blocked by ordering')), 2000); })]); }
	finally { clearTimeout(timer); }
}
let sequence = 0;
async function fixture() {
	const db = await database.init_test(), key = 'ordering-related-' + ++sequence;
	const app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000000, real_now_ms: Date.now } };
	await promisify(db.tournaments.insert.bind(db.tournaments))({ key, btp_enabled: true, btp_readonly: true,
		call_preparation_matches_automatically_enabled: false, official_rotation_mode: 'disabled' });
	await require('../bts/btp_sync').sync_btp_data(app, key, response(3));
	const matches = (await db.matches.find_async({ tournament_key: key })).sort((a, b) => a.setup.match_num - b.setup.match_num);
	const [called, changed, third] = matches;
	await db.matches.update_async({ _id: changed._id }, { $set: {
		'setup.teams.0.players.0.btp_id': called.setup.teams[0].players[0].btp_id,
	}, $unset: { 'setup.now_on_court': true } }, {});
	return { app, key, called, changed, third, court: (await db.courts.find_async({ tournament_key: key }))[0] };
}
function call(f) {
	return new Promise((resolve, reject) => admin.handle_match_call_on_court(f.app, {
		respond: (_request, error) => error ? reject(error) : resolve(),
	}, { tournament_key: f.key, match_id: f.called._id, court_id: f.court._id }));
}
function ordering(f, both = false) {
	return planner.sync(f.app, f.key, {}, { skip_unchanged: false, task_name: 'related_ordering_apply' }, async staged => {
		for (const match of both ? [f.changed, f.third] : [f.changed]) {
			await staged.db.matches.update_async({ _id: match._id }, { $set: { 'setup.match_num': 100 + match.setup.match_num } }, {});
			admin.notify_change(staged, f.key, 'match_edit', { match__id: match._id });
		}
		return true;
	});
}
async function drain(f) {
	await queue.execute_locked([keys.selection(f.key), keys.preparation(f.key), keys.tabletoperators(f.key), keys.umpires(f.key)], () => {});
}
function observe(f) {
	const original = admin.notify_change, rows = [];
	admin.notify_change = (app, key, type, value) => {
		if (app === f.app && key === f.key) rows.push({ type, value: JSON.parse(JSON.stringify(value)) });
		return original(app, key, type, value);
	};
	return { rows, restore: () => { admin.notify_change = original; } };
}

describe('ordering sync with related calls', function() {
	this.timeout(10000);
	it('lets a related real call finish during apply without losing state or publishing old player flags', async function() {
		const f = await fixture(), entered = deferred(), gate = deferred(), observed = observe(f);
		const original = f.app.db.matches.update_async;
		f.app.db.matches.update_async = async (...args) => {
			if (args[0]._id === f.changed._id && args[1].$set?.['setup.match_num']) { entered.resolve(); await gate.promise; }
			return original(...args);
		};
		const sync = ordering(f);
		try {
			await within(entered.promise);
			const active = queue.stats().active_tasks.find(task => task.task === 'related_ordering_apply');
			assert(active.locks.includes(keys.selection(f.key)));
			assert(active.locks.includes(keys.match(f.key, f.changed._id)));
			assert(!active.locks.includes(keys.match(f.key, f.called._id)));
			await within(call(f));
			const related = await f.app.db.matches.findOne_async({ _id: f.changed._id });
			assert.strictEqual(related.setup.state, 'blocked');
			assert.strictEqual(related.setup.teams[0].players[0].now_playing_on_court, f.court._id);
		} finally { gate.resolve(); await sync; f.app.db.matches.update_async = original; observed.restore(); await drain(f); }
		const stored = await f.app.db.matches.findOne_async({ _id: f.changed._id });
		assert.strictEqual(stored.setup.match_num, 102);
		assert.strictEqual(stored.setup.state, 'blocked');
		const notification = observed.rows.filter(row => row.type === 'match_edit' && row.value.match__id === f.changed._id).at(-1);
		assert.deepStrictEqual(notification.value.setup, stored.setup);
		assert.strictEqual((await f.app.db.courts.findOne_async({ _id: f.court._id })).match_id, f.called._id);
	});

	it('preserves a new number when a delayed participant writer captured the older setup', async function() {
		const f = await fixture(), entered = deferred(), gate = deferred(), observed = observe(f);
		const original = f.app.db.matches.update;
		f.app.db.matches.update = function(query, update, options, callback) {
			if (query._id === f.changed._id) {
				entered.resolve();
				gate.promise.then(() => original.call(this, query, update, options, callback));
			} else return original.call(this, query, update, options, callback);
		};
		const assignment = call(f);
		try {
			await within(entered.promise);
			// Deliberately enqueue a concurrent number write past the held writer.
			await promisify(original.bind(f.app.db.matches))({ _id: f.changed._id }, { $set: { 'setup.match_num': 102 } }, {});
		} finally { gate.resolve(); await assignment; f.app.db.matches.update = original; observed.restore(); await drain(f); }
		const stored = await f.app.db.matches.findOne_async({ _id: f.changed._id });
		assert.strictEqual(stored.setup.match_num, 102);
		assert.strictEqual(stored.setup.state, 'blocked');
		const notification = observed.rows.filter(row => row.type === 'update_player_status' && row.value.match__id === f.changed._id).at(-1);
		assert.deepStrictEqual(notification.value.setup, stored.setup);
	});

	it('rolls back only ordering fields after a later write fails, retaining a completed related call', async function() {
		const f = await fixture(), entered = deferred(), gate = deferred(), observed = observe(f);
		const original = f.app.db.matches.update_async;
		f.app.db.matches.update_async = async (...args) => {
			if (args[0]._id === f.third._id && args[1].$set?.['setup.match_num']) {
				entered.resolve(); await gate.promise; throw new Error('planned ordering failure');
			}
			return original(...args);
		};
		const sync = ordering(f, true);
		const failure = assert.rejects(sync, /planned ordering failure/);
		try { await within(entered.promise); await within(call(f)); }
		finally { gate.resolve(); await failure; f.app.db.matches.update_async = original; observed.restore(); await drain(f); }
		const related = await f.app.db.matches.findOne_async({ _id: f.changed._id });
		assert.strictEqual(related.setup.match_num, 2);
		assert.strictEqual(related.setup.state, 'blocked');
		assert.strictEqual(related.setup.teams[0].players[0].now_playing_on_court, f.court._id);
		assert(!observed.rows.some(row => row.type === 'match_edit' && row.value.match__id === f.changed._id));
		assert.strictEqual((await f.app.db.courts.findOne_async({ _id: f.court._id })).match_id, f.called._id);
	});

	it('publishes a concurrently changed number when a related game finishes', async function() {
		const f = await fixture(), entered = deferred(), gate = deferred(), observed = observe(f);
		await call(f);
		const original = f.app.db.matches.update;
		f.app.db.matches.update = function(query, update, options, callback) {
			if (query._id === f.changed._id && update.$set?.['setup.teams.0.players.0']) {
				entered.resolve(); gate.promise.then(() => original.call(this, query, update, options, callback));
			} else return original.call(this, query, update, options, callback);
		};
		const cleanup = promisify(match_utils.remove_player_on_court)(f.app, f.key, f.called._id, 12345);
		try {
			await within(entered.promise);
			await promisify(original.bind(f.app.db.matches))({ _id: f.changed._id }, { $set: { 'setup.match_num': 102 } }, {});
		} finally { gate.resolve(); await cleanup; f.app.db.matches.update = original; observed.restore(); await drain(f); }
		const stored = await f.app.db.matches.findOne_async({ _id: f.changed._id });
		assert.strictEqual(stored.setup.match_num, 102);
		assert.strictEqual(stored.setup.teams[0].players[0].now_playing_on_court, false);
		assert.strictEqual(stored.setup.teams[0].players[0].last_time_on_court_ts, 12345);
		const notification = observed.rows.filter(row => row.type === 'update_player_status' && row.value.match__id === f.changed._id).at(-1);
		assert.deepStrictEqual(notification.value.setup, stored.setup);
	});
});
