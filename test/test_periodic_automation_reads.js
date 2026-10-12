'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const reads = require('../bts/preparation_selection/periodic_reads');
const match_utils = require('../bts/match_utils');
const reconciliation = require('../bts/match_reconciliation/run');
const queue = require('../bts/update_queue');
const turn = () => new Promise(resolve => setImmediate(resolve));

async function fixture() {
	const db = await database.init_test();
	await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'periodic', call_preparation_matches_automatically_enabled: true });
	await promisify(db.matches.insert.bind(db.matches))({ _id: 'future', tournament_key: 'periodic', setup: { state: 'blocked',
		teams: [{ players: [{ btp_id: 1, now_playing_on_court: 'old', checked_in: true, tablet_break_active: true }] }] } });
	return { db, clock: { now_ms: () => 100000 } };
}

describe('periodic automation inputs and player/court repair', function() {
	it('skips all-match reads when pause readiness is disabled', async function() {
		const app = await fixture();
		app.db.matches.find = () => { throw new Error('unnecessary read'); };
		app.db.model.snapshot = () => { throw new Error('unnecessary snapshot'); };
		await new Promise((resolve, reject) => match_utils.process_preparation_pause_auto_calls_for_tournament(app,
			{ key: 'periodic', call_preparation_matches_automatically_enabled: true, btp_settings: { pause_duration_ms: 1000 } },
			error => error ? reject(error) : resolve()));
	});
	it('reads tournament timers in persistence order without copying registrations', async function() {
		const app = await fixture();
		let release;
		app.db.tournaments.executor.push({ this: app.db.tournaments, fn: done => { release = done; }, arguments: [() => {}] });
		await turn();
		let finished = false;
		const reading = reads.tournaments(app, {}).then(values => { finished = true; return values; });
		await turn(); assert.strictEqual(finished, false); release();
		const values = await reading;
		assert.strictEqual(values[0], app.db.model.tournament('periodic').record.data);
	});
	it('keeps TTL expiration, including an index installed while queued', async function() {
		const app = await fixture();
		await app.db.tournaments.update_async({ key: 'periodic' }, { $set: { expires: new Date(0) } }, {});
		let release;
		app.db.tournaments.executor.push({ this: app.db.tournaments, fn: done => { release = done; }, arguments: [() => {}] });
		await turn(); const reading = reads.tournaments(app, {});
		app.db.tournaments.ttlIndexes.expires = 1;
		release(); assert.deepStrictEqual(await reading, []);
		assert.strictEqual(app.db.model.tournament('periodic').record.present, false);
	});
	it('does not overlap a slow timer run', async function() {
		const app = await fixture(); let release, count = 0;
		const run = reads.runner(app, 'test_periodic', {}, () => { count++; return new Promise(resolve => { release = resolve; }); });
		const first = run();
		for (let i = 0; i < 20 && !release; i++) await turn();
		assert.strictEqual(run(), undefined); assert.strictEqual(count, 1); release(); await first;
	});
	it('repairs stale flags without replacing score fields or immutable player inputs', async function() {
		const app = await fixture();
		await app.db.matches.update_async({ _id: 'future' }, { $set: { presses: [{ type: 'score' }], 'setup.needs_preparation_successor': true } }, {});
		const before = app.db.model.tournament('periodic').matches.get('future').data;
		await reconciliation.run(app, 'periodic');
		const after = await app.db.matches.findOne_async({ _id: 'future' });
		assert.strictEqual(after.setup.state, 'scheduled');
		assert.strictEqual(after.setup.teams[0].players[0].now_playing_on_court, false);
		assert.strictEqual(after.setup.teams[0].players[0].checked_in, false);
		assert.strictEqual(after.setup.needs_preparation_successor, true);
		assert.deepStrictEqual(after.presses, [{ type: 'score' }]);
		assert.strictEqual(before.setup.teams[0].players[0].now_playing_on_court, 'old');
	});
	it('rechecks after a reassignment while waiting for locks', async function() {
		const app = await fixture(); let release;
		const holding = queue.execute_locked([queue.lock_keys.preparation('periodic')], () => new Promise(resolve => { release = resolve; }));
		await turn(); const repairing = reconciliation.run(app, 'periodic');
		for (let i = 0; i < 20 && !queue.stats().pending_tasks.length; i++) await turn();
		await promisify(app.db.matches.insert.bind(app.db.matches))({ _id: 'active', tournament_key: 'periodic', setup: {
			now_on_court: true, court_id: 'old', teams: [{ players: [{ btp_id: 1 }] }],
		} });
		release(); await holding; await repairing;
		const after = await app.db.matches.findOne_async({ _id: 'future' });
		assert.strictEqual(after.setup.teams[0].players[0].now_playing_on_court, 'old');
		assert.strictEqual(after.setup.teams[0].players[0].checked_in, true);
		assert.strictEqual(after.setup.state, 'blocked');
	});
	it('leaves unrelated point locks runnable during a real repair', async function() {
		const app = await fixture(); const original = app.db.matches.update;
		let release;
		app.db.matches.update = (...args) => { release = () => original.apply(app.db.matches, args); };
		const repairing = reconciliation.run(app, 'periodic');
		for (let i = 0; i < 30 && !release; i++) await turn();
		assert.strictEqual(typeof release, 'function');
		let point = false;
		await queue.execute_locked([queue.lock_keys.match('periodic', 'unrelated'), queue.lock_keys.court('periodic', 'second')], () => { point = true; });
		assert.strictEqual(point, true); release(); await repairing;
		app.db.matches.update = original;
	});
	it('does not read score histories or acquire broad locks for an unchanged repair', async function() {
		const app = await fixture();
		await app.db.matches.update_async({ _id: 'future' }, { $set: { 'setup.state': 'scheduled', 'setup.teams.0.players.0.now_playing_on_court': false } }, {});
		const data = app.db.model.tournament('periodic').matches.get('future').data;
		Object.defineProperty(data, 'presses', { configurable: true, enumerable: true, get() { throw new Error('copied history'); } });
		let release;
		const holding = queue.execute_locked([queue.lock_keys.matches('periodic')], () => new Promise(resolve => { release = resolve; }));
		await turn(); await reconciliation.run(app, 'periodic'); release(); await holding;
		delete data.presses;
	});
});
