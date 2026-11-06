'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const sync = require('../bts/btp_sync');
const guard = require('../bts/btp_participant_guard');
const effects = require('../bts/btp_sync_effects');
const planner = require('../bts/btp_sync_plan');
const worker = require('../bts/btp_planner');
const result_sync = require('../bts/btp_result_sync');
const { inputs } = require('./btp_match_changes_fixture');
const { response } = require('../debug/offload/fixtures');
const copy = value => structuredClone(value);
const complete = { team1_won: true, btp_winner: 1, network_score: [[21, 10], [21, 11]],
	score_status: 'normal', btp_needsync: true, 'setup.state': 'finished', 'setup.now_on_court': false };
const result = { Winner: [1], ScoreStatus: [0], Sets: [{ Set: [{ T1: [21], T2: [10] }, { T1: [21], T2: [11] }] }] };

async function fixture(active = true) {
	const db = await database.init_test(), input = inputs(2);
	const app = { db, wss: { clients: [] }, _btp_sync_effects: [] };
	await promisify(db.tournaments.insert.bind(db.tournaments))(input.tournament);
	await promisify(db.courts.insert.bind(db.courts))({ _id: 'court7', tournament_key: 'default', btp_id: 7 });
	input.court_map.set(7, 'court7');
	const integrate = () => new Promise((resolve, reject) => sync._integrate_matches(app, 'default', copy(input.state),
		input.scoring_formats, input.location_map, input.court_map, (error, value) => error ? reject(error) : resolve(value)));
	await integrate();
	const read = () => db.matches.findOne_async({ btp_id: 'default_Singles_1' });
	const id = (await read())._id;
	const update = patch => db.matches.update_async({ _id: id }, patch, {});
	if (active) await update({ $set: { 'setup.now_on_court': true, 'setup.state': 'oncourt', 'setup.court_id': 'court7',
		'setup.called_timestamp': 1234, network_score: [[8, 5]], presses: [{ type: 'score', team: 1 }], duration_ms: 777 } });
	app._btp_sync_effects.length = 0;
	return { app, db, input, integrate, read, update };
}
const reports = app => app._btp_sync_effects.filter(effect => effect.command?.target === 'btp_participant_guard');

describe('BTP participant safety', function() {
	it('accepts missing and sparse raw sides from unresolved BTP branches', function() {
		for (const sides of [[undefined, [{ ID: [2] }]], [null, []], new Array(2)]) {
			assert.deepStrictEqual(guard.raw_ids({ bts_players: sides })[0], []);
		}
		assert.deepStrictEqual(guard.raw_ids({ bts_players: [undefined, [{ ID: [2] }]] }), [[], ['2']]);
	});
	for (const [label, ids] of [['missing opponent', [[1], []]], ['absent player list', [[1], undefined]], ['both sides unknown', [[], []]],
		['different players', [[3], [4]]], ['swapped sides', [[2], [1]]]]) {
		it('retains the active game for ' + label + ' including an incompatible remote result', async function() {
			const f = await fixture(), before = await f.read();
			const remote = f.input.state.matches[0];
			remote.bts_players = ids.map(team => team?.map(id => ({ ID: [id] })));
			Object.assign(remote, result);
			await f.integrate();
			const after = await f.read();
			assert(after.btp_participant_conflict);
			for (const field of ['setup', 'network_score', 'presses', 'duration_ms', 'team1_won', 'btp_winner']) {
				assert.deepStrictEqual(after[field], before[field], field);
			}
			assert.strictEqual(reports(f.app).length, 1);
			await f.integrate();
			assert.strictEqual(reports(f.app).length, 1);
			// A fresh integration cache/server restart must not duplicate the error.
			f.app.db = { ...f.db };
			await f.integrate();
			assert.strictEqual(reports(f.app).length, 1);
		});
	}
	it('protects missing doubles partners and the player order used for serving', function() {
		const current = { setup: { now_on_court: true, teams: [{ players: [{ btp_id: 1 }, { btp_id: 2 }] },
			{ players: [{ btp_id: 3 }, { btp_id: 4 }] }] } };
		assert.strictEqual(guard.conflict(current, [['1'], ['3', '4']]).reason, 'missing_participants');
		assert(guard.conflict(current, [['2', '1'], ['3', '4']]));
		const incoming = { setup: { teams: [{ players: [{ btp_id: 1 }] }, { players: [] }], incomplete: true }, team1_won: false };
		const before = copy(current), merged = sync._merge_local_match_into_btp_match(current, incoming);
		assert.deepStrictEqual(merged.setup, before.setup);
		assert.deepStrictEqual(current, before);
		assert.strictEqual(merged.team1_won, undefined);
	});
	it('accepts names and check-in updates for unchanged participant identities', async function() {
		const f = await fixture();
		f.input.state.matches[0].bts_players[0][0].Firstname = ['Updated'];
		await f.integrate();
		const after = await f.read();
		assert.strictEqual(after.setup.teams[0].players[0].firstname, 'Updated');
		assert.strictEqual(after.btp_participant_conflict, undefined);
		assert.deepStrictEqual(after.network_score, [[8, 5]]);
	});
	it('resolves a live conflict when BTP again names the original participants', async function() {
		const f = await fixture(), original = copy(f.input.state.matches[0].bts_players);
		f.input.state.matches[0].bts_players[1] = [];
		await f.integrate();
		await f.update({ $set: { network_score: [[9, 5]] } });
		f.input.state.matches[0].bts_players = original;
		await f.integrate();
		const after = await f.read();
		assert.strictEqual(after.btp_participant_conflict, undefined);
		assert.strictEqual(after.setup.state, 'oncourt');
		assert.strictEqual(after.setup.incomplete, false);
		assert.deepStrictEqual(after.network_score, [[9, 5]]);
	});
	it('allows participant changes before call and does not block healthy games in the same sync', async function() {
		const f = await fixture(false);
		f.input.state.matches[0].bts_players[1] = [];
		await f.integrate();
		assert.strictEqual((await f.read()).setup.incomplete, true);
		f.input.state.matches[0].bts_players[1] = [{ ID: [4], Firstname: ['New'] }];
		await f.integrate();
		assert.strictEqual((await f.read()).setup.teams[1].players[0].btp_id, 4);
		await f.update({ $set: { 'setup.now_on_court': true, 'setup.state': 'oncourt' } });
		f.input.state.matches[0].bts_players[1] = [];
		f.input.state.matches[1].bts_players[1][0].Firstname = ['Healthy'];
		await f.integrate();
		assert((await f.read()).btp_participant_conflict);
		const healthy = await f.db.matches.findOne_async({ btp_id: 'default_Singles_2' });
		assert.strictEqual(healthy.setup.teams[1].players[0].firstname, 'Healthy');
	});
	it('keeps pending results queued without sending/confirming them until identities agree again', async function() {
		const f = await fixture();
		f.input.state.matches[0].bts_players[1] = [];
		await f.integrate();
		await f.update({ $set: complete });
		await f.update({ $set: { btp_needsync: false } });
		Object.assign(f.input.state.matches[0], result);
		const conn = { app: f.app, tkey: 'default', schedule_result_retry() {} };
		let sends = 0;
		const send = () => { sends++; return true; };
		await result_sync.enqueue(conn, await f.read(), send);
		await f.integrate();
		assert.strictEqual(sends, 0);
		assert.strictEqual((await f.read()).btp_needsync, true);
		assert.strictEqual(sync._btp_match_confirms_pending_local_sync(await f.read(), f.input.state.matches[0]), false);
		f.input.state.matches[0].bts_players[1] = [{ ID: [2] }];
		// No remote result yet: resolve conflict, then retry the retained result.
		delete f.input.state.matches[0].Winner;
		delete f.input.state.matches[0].Sets;
		await f.integrate();
		assert.strictEqual((await f.read()).btp_participant_conflict, undefined);
		assert.strictEqual((await f.read()).btp_needsync, true);
		await result_sync.enqueue(conn, await f.read(), send);
		assert.strictEqual(sends, 1);
		Object.assign(f.input.state.matches[0], result);
		await f.integrate();
		assert.strictEqual((await f.read()).btp_needsync, false);
	});
	it('detects a fresh participant mismatch even for a result completed before the first conflicting sync', async function() {
		const f = await fixture();
		await f.update({ $set: complete });
		f.input.state.matches[0].bts_players[1] = [{ ID: [4] }];
		Object.assign(f.input.state.matches[0], result);
		await f.integrate();
		assert.strictEqual((await f.read()).btp_needsync, true);
		assert((await f.read()).btp_participant_conflict);
	});
	it('does not overwrite a newer score while persisting or clearing a conflict', async function() {
		const f = await fixture(), snapshot = await f.read();
		await f.update({ $set: { network_score: [[9, 5]] } });
		const guarded = await guard.reconcile(f.app, 'default', snapshot, { bts_players: [[], []] });
		assert.strictEqual(guarded.blocked, true);
		assert.strictEqual(guarded.changed, false);
		assert.deepStrictEqual((await f.read()).network_score, [[9, 5]]);
		assert.strictEqual(reports(f.app).length, 0);
		const fresh = await f.read();
		await guard.reconcile(f.app, 'default', fresh, { bts_players: [[], []] });
		const conflicted = await f.read();
		await f.update({ $set: { network_score: [[10, 5]] } });
		assert.strictEqual((await guard.reconcile(f.app, 'default', conflicted,
			{ bts_players: [[{ ID: [1] }], [{ ID: [2] }]] })).blocked, true);
		assert((await f.read()).btp_participant_conflict);
		assert.deepStrictEqual((await f.read()).network_score, [[10, 5]]);
	});
	it('does not let an ACK from before the conflict clear the pending flag', async function() {
		const f = await fixture(), before = await f.read();
		await f.update({ $set: { btp_needsync: true } });
		const outgoing = await f.read();
		await guard.reconcile(f.app, 'default', outgoing, { bts_players: [[], []] });
		const affected = await f.db.matches.update_async(result_sync.version_query(outgoing, 'default'),
			{ $set: { btp_needsync: false } }, {});
		assert.strictEqual(affected[0], 0);
		assert.strictEqual((await f.read()).btp_needsync, true);
		assert.deepStrictEqual((await f.read()).setup, before.setup);
	});
	for (const doubles of [false, true]) {
		it('rejects remote active assignments with ' + (doubles ? 'a missing doubles partner' : 'an unknown opponent'), async function() {
			const f = await fixture(false);
			await f.db.matches.remove_async({ tournament_key: 'default' }, { multi: true });
			const remote = f.input.state.matches[0];
			remote.CourtID = [7];
			remote.bts_players = doubles ? [[{ ID: [1] }, { ID: [3] }], [{ ID: [2] }]] : [[{ ID: [1] }], []];
			f.input.state.events.get(20).GameTypeID = [doubles ? 2 : 1];
			f.input.state.courts.set(7, { ID: [7], MatchID: [1] });
			await f.integrate();
			const after = await f.read();
			assert.strictEqual(after.setup.state, 'incomplete');
			assert.strictEqual(after.setup.now_on_court, false);
			assert.strictEqual(after.setup.court_id, 'court7');
			assert.strictEqual(after.setup.called_timestamp, undefined);
			await new Promise((resolve, reject) => sync._integrate_now_on_court(f.app, 'default', error => error ? reject(error) : resolve()));
			assert.strictEqual((await f.db.courts.findOne_async({ _id: 'court7' })).match_id, undefined);
		});
	}
	it('logs the cause with game attribution only when the captured effect is applied', async function() {
		const f = await fixture();
		f.input.state.matches[0].bts_players[1] = [];
		const records = [], original = console.error;
		f.app.diagnostics = { record: entry => records.push(entry) };
		try {
			console.error = () => {};
			await f.integrate();
			assert.strictEqual(records.length, 0);
			const report = reports(f.app)[0];
			const real_app = { ...f.app }; delete real_app._btp_sync_effects;
			effects.restore(report).run(real_app);
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].match_id, (await f.read())._id);
			assert(records[0].message.includes('BTP_PARTICIPANT_CONFLICT'));
			assert(records[0].message.includes('Erwartete Spieler-IDs: [["1"],["2"]]; empfangen: [["1"],[]]'));
		} finally { console.error = original; }
	});
	it('rejects a stale call snapshot if the stored game has lost an opponent', async function() {
		const f = await fixture(false), before = await f.read();
		before.setup.court_id = 'court7';
		await f.update({ $set: { 'setup.teams.1.players': [], 'setup.incomplete': true } });
		const error = await new Promise(resolve => require('../bts/match_utils').call_match(f.app, f.input.tournament, before, undefined, resolve));
		assert(String(error).includes('current participants are incomplete'));
		assert.notStrictEqual((await f.read()).setup.now_on_court, true);
	});
	it('preserves participants through the real planning worker and publishes a single committed error', async function() {
		this.timeout(10000);
		const previous = process.env.BTS_SYNC_PLAN_WORKER, original = console.error;
		const db = await database.init_test(), records = [];
		const app = { db, wss: { clients: [] }, diagnostics: { record: record => records.push(record) } };
		const tkey = 'guard-worker', wire = response(2), run = worker.client.run;
		try {
			console.error = () => {};
			process.env.BTS_SYNC_PLAN_WORKER = '1';
			await promisify(db.tournaments.insert.bind(db.tournaments))({ key: tkey, btp_enabled: true, last_reset_ts: 1 });
			await sync.sync_btp_data(app, tkey, wire, { expected_reset_ts: 1 });
			const first = await db.matches.findOne_async({ 'setup.match_num': 1 });
			await db.matches.update_async({ _id: first._id }, { $set: { 'setup.state': 'oncourt', 'setup.now_on_court': true,
				'setup.called_timestamp': 1234, network_score: [[7, 6]] } }, {});
			const before = await db.matches.findOne_async({ _id: first._id });
			wire.Result[0].Tournament[0].Matches[0].Match.find(row => row.ID[0] === 1).From2 = [4];
			const plans = await worker.plan({}, await planner._snapshot(db, tkey), app, tkey, JSON.stringify(wire),
				{ expected_reset_ts: 1, worker_operation: 'btp' });
			assert.strictEqual(records.length, 0);
			assert(plans.effects.some(effect => effect.command?.target === 'btp_participant_guard'));
			let calls = 0;
			worker.client.run = async function(...args) {
				const plan = await run.apply(this, args);
				if (++calls === 1) await db.matches.update_async({ _id: first._id }, { $set: { network_score: [[8, 6]] } }, {});
				return plan;
			};
			await sync.sync_btp_data(app, tkey, wire, { expected_reset_ts: 1 });
			const after = await db.matches.findOne_async({ _id: first._id });
			assert.deepStrictEqual(after.setup, before.setup);
			assert.deepStrictEqual(after.network_score, [[8, 6]]);
			assert(calls >= 2, 'conflict must be planned again after concurrent points');
			assert(after.btp_participant_conflict);
			assert.strictEqual(records.filter(record => record.message.includes('BTP_PARTICIPANT_CONFLICT')).length, 1);
			await sync.sync_btp_data(app, tkey, wire, { expected_reset_ts: 1 });
			assert.strictEqual(records.filter(record => record.message.includes('BTP_PARTICIPANT_CONFLICT')).length, 1);
		} finally {
			worker.client.run = run; worker.client.close(); console.error = original;
			if (previous === undefined) delete process.env.BTS_SYNC_PLAN_WORKER; else process.env.BTS_SYNC_PLAN_WORKER = previous;
		}
	});
});
