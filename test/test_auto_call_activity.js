'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const calls = require('../bts/match_utils');
const rules = require('../bts/match_automation');
const worker = require('../bts/btp_planner').client;

describe('automatic field calls with competing player and tablet roles', function() {
	let previous;
	beforeEach(function() { previous = process.env.BTS_SYNC_PLAN_WORKER; });
	afterEach(function() {
		worker.close();
		if (previous === undefined) delete process.env.BTS_SYNC_PLAN_WORKER;
		else process.env.BTS_SYNC_PLAN_WORKER = previous;
	});
	for (const execution of ['0', '1']) it('keeps valid assignments when a later tablet operator becomes busy (worker=' + execution + ')', async function() {
		process.env.BTS_SYNC_PLAN_WORKER = execution;
		const db = await database.init_test(), key = 'activity-' + execution;
		const app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000000 } };
		const insert = (name, value) => promisify(db[name].insert.bind(db[name]))(value);
		const tournament = await insert('tournaments', { key, btp_enabled: false,
			official_rotation_mode: 'disabled', call_next_possible_scheduled_match_in_preparation: true,
			call_on_court_only_preparation_enabled: true, call_on_court_only_preparation_minutes: 0 });
		await insert('courts', [1, 2, 3].map(n => ({ _id: 'court-' + n, num: n,
			tournament_key: key, is_active: true, location_id: 'hall' })));
		const player = id => ({ btp_id: id, name: 'Player ' + id });
		await insert('matches', [1, 2, 3].map(n => ({ _id: 'match-' + n, tournament_key: key,
			btp_match_ids: [{ id: n }], setup: { state: 'preparation', is_match: true, incomplete: false,
				location_id: 'hall', match_num: n, preparation_call_timestamp: 1,
				teams: [{ players: [player(n * 2)] }, { players: [player(n * 2 + 1)] }],
				tabletoperators: n === 2 ? [player(2)] : [],
			} })));
		const call = () => new Promise((resolve, reject) => calls.queue_auto_call_matches_on_free_courts(app, key,
			error => error ? reject(error) : resolve()));
		await call();
		let matches = await db.matches.find_async({ tournament_key: key });
		assert.deepStrictEqual(matches.filter(m => m.setup.now_on_court).map(m => m._id).sort(), ['match-1', 'match-3']);
		const courts = await db.courts.find_async({ tournament_key: key });
		const free = courts.find(c => !c.match_id);
		const blocked = matches.find(m => m._id === 'match-2');
		const diagnostic = rules.calculate_match_call_on_court_diagnostics(blocked, free._id, { ...tournament, matches, courts });
		assert.strictEqual(diagnostic.eligible, false);
		assert.strictEqual(diagnostic.rules.find(r => r.key === 'participants_available').passed, false);
		await call();
		assert.strictEqual((await db.matches.findOne_async({ _id: 'match-2' })).setup.state, 'preparation');
		const first = matches.find(m => m._id === 'match-1');
		await db.matches.update_async({ _id: first._id }, { $set: {
			team1_won: true, 'setup.state': 'finished', 'setup.now_on_court': false,
		} }, {});
		await db.courts.update_async({ _id: first.setup.court_id }, { $unset: { match_id: true } }, {});
		await call();
		matches = await db.matches.find_async({ tournament_key: key });
		assert.strictEqual(matches.find(m => m._id === 'match-2').setup.now_on_court, true);
	});
});
