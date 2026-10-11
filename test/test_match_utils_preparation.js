'use strict';

const assert = require('assert');

const database = require('../bts/database');
const admin = require('../bts/admin');
const match_utils = require('../bts/match_utils');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
		});
	});
}

function call_match_in_preparation(app, tournament, match, location_id, options) {
	return new Promise((resolve, reject) => {
		match_utils.call_match_in_preparation(app, tournament, match, location_id, (err) => {
			if (err) return reject(err);
			resolve();
		}, options);
	});
}

function ensure_match_not_already_on_other_court(app, tournament_key, match) {
	return new Promise((resolve, reject) => {
		match_utils._ensure_match_not_already_on_other_court(app, tournament_key, match, (err) => {
			if (err) return reject(err);
			resolve();
		});
	});
}

function call_match(app, tournament, match, old_court) {
	return new Promise((resolve, reject) => {
		match_utils.call_match(app, tournament, match, old_court, (err, updated_match) => {
			if (err) return reject(err);
			resolve(updated_match);
		});
	});
}

function auto_execute_preparation_selection(app, tournament, location_id) {
	return new Promise((resolve, reject) => {
		match_utils.auto_execute_preparation_selection(app, tournament, location_id, (err) => {
			if (err) return reject(err);
			resolve();
		});
	});
}

function auto_execute_preparation_selections(app, tournament) {
	return new Promise((resolve, reject) => {
		match_utils.auto_execute_preparation_selections(app, tournament, (err) => {
			if (err) return reject(err);
			resolve();
		});
	});
}

describe('match preparation calls', function() {
	it('triggers automatic preparation after score only for finish or newly needed successors', function() {
		assert.strictEqual(
			match_utils.score_update_should_trigger_auto_preparation(
				{ setup: { needs_preparation_successor: false } },
				{ needs_preparation_successor: false },
				true
			),
			true
		);
		assert.strictEqual(
			match_utils.score_update_should_trigger_auto_preparation(
				{ setup: { needs_preparation_successor: false } },
				{ needs_preparation_successor: true },
				false
			),
			true
		);
		assert.strictEqual(
			match_utils.score_update_should_trigger_auto_preparation(
				{ setup: { needs_preparation_successor: true } },
				{ needs_preparation_successor: true },
				false
			),
			false
		);
		assert.strictEqual(
			match_utils.score_update_should_trigger_auto_preparation(
				{ setup: { needs_preparation_successor: false } },
				{ needs_preparation_successor: false },
				false
			),
			false
		);
	});

	it('builds on-court auto-call assignments by match priority before field priority', function() {
		const match1 = { _id: 'match-1', setup: { match_num: 1 } };
		const match2 = { _id: 'match-2', setup: { match_num: 2 } };
		const match3 = { _id: 'match-3', setup: { match_num: 3 } };
		const court10 = { _id: 'court-10', num: 10 };
		const court7 = { _id: 'court-7', num: 7 };

		const plan = match_utils._build_match_first_field_assignment_plan(
			[match1, match2, match3],
			[
				{ court: court10, candidate_matches: [match2, match3] },
				{ court: court7, candidate_matches: [match1, match2] },
			]
		);

		assert.deepStrictEqual(
			plan.call_plan.map((entry) => [entry.match._id, entry.court._id]),
			[
				['match-1', 'court-7'],
				['match-2', 'court-10'],
			]
		);
		assert.deepStrictEqual(plan.skipped_priority_matches, [
			{ match_id: 'match-3', match_num: 3, reason: 'no_eligible_free_court' },
		]);
	});

	it('clears planned court assignment before a match is actually called on court', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			call_preparation_matches_automatically_enabled: true,
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		const match = await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				court_id: 'court-1',
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await call_match_in_preparation(app, tournament, match, 'location-1', { force: true });

		const changed = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(changed.setup.state, 'preparation');
		assert.strictEqual(changed.setup.location_id, 'location-1');
		assert.strictEqual(changed.setup.preparation_call_timestamp, 1234567890);
		assert.strictEqual(changed.setup.court_id, undefined);
		assert.strictEqual(changed.setup.now_on_court, undefined);
	});

	it('allows a manual preparation call to repeat for a match already in preparation', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 2234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		const match = await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'preparation',
				location_id: 'location-1',
				highlight: 6,
				preparation_call_timestamp: 1111111111,
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await call_match_in_preparation(app, tournament, match, 'location-1', { force: true });

		const changed = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(changed.setup.state, 'preparation');
		assert.strictEqual(changed.setup.location_id, 'location-1');
		assert.strictEqual(changed.setup.preparation_call_timestamp, 2234567890);
	});

	it('does not repeat an automatic preparation call for an already prepared match without highlight', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 3234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
		});
		const match = await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'preparation',
				location_id: 'location-1',
				highlight: 0,
				preparation_call_timestamp: 1111111111,
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await call_match_in_preparation(app, tournament, match, 'location-1', { automatic_preparation_call: true });

		const unchanged = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(unchanged.setup.state, 'preparation');
		assert.strictEqual(unchanged.setup.preparation_call_timestamp, 1111111111);
	});

	it('does not repeat an automatic preparation call for an already prepared match in another location', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 4234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
		});
		const match = await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'preparation',
				location_id: 'location-1',
				highlight: 6,
				preparation_call_timestamp: 1111111111,
				match_num: 128,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await call_match_in_preparation(app, tournament, match, 'location-2', { automatic_preparation_call: true });

		const unchanged = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(unchanged.setup.state, 'preparation');
		assert.strictEqual(unchanged.setup.location_id, 'location-1');
		assert.strictEqual(unchanged.setup.preparation_call_timestamp, 1111111111);
	});

	it('rejects a manual preparation call while one of its players is playing', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		const match = await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1, now_playing_on_court: 'court-1' }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await assert.rejects(
			() => call_match_in_preparation(app, tournament, match, 'location-1', { force: true }),
			/Match cannot be called in preparation manually/
		);

		const unchanged = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(unchanged.setup.state, 'scheduled');
		assert.strictEqual(unchanged.setup.preparation_call_timestamp, undefined);
	});

	it('removes a self-blocking waiting tablet operator before automatic preparation', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 4234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			automation_enabled: true,
			call_preparation_matches_automatically_enabled: true,
			preparation_call_no_player_waiting_as_tabletoperator_enabled: true,
			official_rotation_mode: 'disabled',
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		await insert(db, 'courts', {
			_id: 'court-1',
			tournament_key: 'default',
			location_id: 'location-1',
			btp_id: 1,
			is_active: true,
		});
		await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				location_id: 'location-1',
				match_num: 96,
				teams: [
					{ players: [{ name: 'Muhammad Sytsch Abdulquddus', btp_id: 1 }, { name: 'Laerke Busch', btp_id: 2 }] },
					{ players: [{ name: 'Emil Kunow', btp_id: 6 }, { name: 'Emily Wusterhausen', btp_id: 7 }] },
				],
			},
		});
		await insert(db, 'tabletoperators', {
			_id: 'tablet-1',
			tournament_key: 'default',
			tabletoperator: [{ name: 'Emil Kunow', btp_id: 6 }],
			match_id: 'previous-match',
			start_ts: 1,
			end_ts: null,
			court: null,
			played_on_court: 'court-6',
		});

		await auto_execute_preparation_selection(app, tournament, 'location-1');

		const changed_match = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(changed_match.setup.state, 'preparation');
		assert.strictEqual(changed_match.setup.location_id, 'location-1');
		assert.strictEqual(changed_match.setup.preparation_call_timestamp, 4234567890);
		const tabletoperator = await db.tabletoperators.findOne_async({ _id: 'tablet-1' });
		assert.strictEqual(tabletoperator.court, -1);
		assert.strictEqual(tabletoperator.end_ts, 4234567890);
	});

	it('skips expensive automatic preparation when every location already has enough preparation matches', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 5234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			automation_enabled: true,
			call_preparation_matches_automatically_enabled: true,
			official_rotation_mode: 'disabled',
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		await insert(db, 'courts', {
			_id: 'court-1',
			tournament_key: 'default',
			location_id: 'location-1',
			btp_id: 1,
			is_active: true,
		});
		await insert(db, 'matches', {
			_id: 'prepared-match',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'preparation',
				location_id: 'location-1',
				highlight: 6,
				preparation_call_timestamp: 1111111111,
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});
		await insert(db, 'matches', {
			_id: 'next-match',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				location_id: 'location-1',
				match_num: 2,
				teams: [
					{ players: [{ name: 'Player C', btp_id: 3 }] },
					{ players: [{ name: 'Player D', btp_id: 4 }] },
				],
			},
		});

		await auto_execute_preparation_selections(app, tournament);

		const unchanged = await db.matches.findOne_async({ _id: 'next-match' });
		assert.strictEqual(unchanged.setup.state, 'scheduled');
		assert.strictEqual(unchanged.setup.preparation_call_timestamp, undefined);
	});

	it('keeps at least ten seconds between automatic preparation call timestamps', async function() {
		const db = await database.init_test();
		let now = 1234567890;
		const sleeps = [];
		const app = {
			db,
			clock: {
				now_ms: () => now,
				sleep_ms: async (ms) => {
					sleeps.push(ms);
					now += ms;
				},
			},
		};
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			call_preparation_matches_automatically_enabled: true,
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		const make_match = (id, match_num) => ({
			_id: id,
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				court_id: 'court-1',
				match_num,
				teams: [
					{ players: [{ name: 'Player A ' + match_num, btp_id: match_num * 10 + 1 }] },
					{ players: [{ name: 'Player B ' + match_num, btp_id: match_num * 10 + 2 }] },
				],
			},
		});
		const match1 = await insert(db, 'matches', make_match('match-1', 1));
		const match2 = await insert(db, 'matches', make_match('match-2', 2));

		await call_match_in_preparation(app, tournament, match1, 'location-1', { force: true, automatic_preparation_call: true });
		await call_match_in_preparation(app, tournament, match2, 'location-1', { force: true, automatic_preparation_call: true });

		const changed1 = await db.matches.findOne_async({ _id: 'match-1' });
		const changed2 = await db.matches.findOne_async({ _id: 'match-2' });
		assert.strictEqual(changed1.setup.preparation_call_timestamp, 1234567890);
		assert.strictEqual(changed2.setup.preparation_call_timestamp, 1234577890);
		assert.deepStrictEqual(sleeps, [10000]);
	});

	it('uses the configured preparation call gap for automatic preparation calls', async function() {
		const db = await database.init_test();
		let now = 2000000000;
		const sleeps = [];
		const app = {
			db,
			clock: {
				now_ms: () => now,
				sleep_ms: async (ms) => {
					sleeps.push(ms);
					now += ms;
				},
			},
		};
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			call_preparation_matches_automatically_enabled: true,
			preparation_call_min_gap_seconds: 3,
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		const make_match = (id, match_num) => ({
			_id: id,
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				court_id: 'court-1',
				match_num,
				teams: [
					{ players: [{ name: 'Player A ' + match_num, btp_id: match_num * 10 + 1 }] },
					{ players: [{ name: 'Player B ' + match_num, btp_id: match_num * 10 + 2 }] },
				],
			},
		});
		const match1 = await insert(db, 'matches', make_match('match-1', 1));
		const match2 = await insert(db, 'matches', make_match('match-2', 2));

		await call_match_in_preparation(app, tournament, match1, 'location-1', { force: true, automatic_preparation_call: true });
		await call_match_in_preparation(app, tournament, match2, 'location-1', { force: true, automatic_preparation_call: true });

		const changed1 = await db.matches.findOne_async({ _id: 'match-1' });
		const changed2 = await db.matches.findOne_async({ _id: 'match-2' });
		assert.strictEqual(changed1.setup.preparation_call_timestamp, 2000000000);
		assert.strictEqual(changed2.setup.preparation_call_timestamp, 2000003000);
		assert.deepStrictEqual(sleeps, [3000]);
	});

	it('does not wait inside automatic preparation selection when the call gap blocks the next match', async function() {
		const db = await database.init_test();
		let now = 5000000000;
		const sleeps = [];
		const app = {
			db,
			clock: {
				now_ms: () => now,
				sleep_ms: async (ms) => {
					sleeps.push(ms);
					now += ms;
				},
			},
		};
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			automation_enabled: true,
			call_preparation_matches_automatically_enabled: true,
			preparation_call_min_gap_seconds: 10,
			official_rotation_mode: 'disabled',
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		await insert(db, 'courts', {
			_id: 'court-1',
			tournament_key: 'default',
			location_id: 'location-1',
			btp_id: 1,
			is_active: true,
		});
		await insert(db, 'courts', {
			_id: 'court-2',
			tournament_key: 'default',
			location_id: 'location-1',
			btp_id: 2,
			is_active: true,
		});
		const make_match = (id, match_num) => ({
			_id: id,
			tournament_key: 'default',
			match_order: match_num,
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				location_id: 'location-1',
				match_num,
				scheduled_date: '2026-04-07',
				scheduled_time_str: '10:00',
				teams: [
					{ players: [{ name: 'Player A ' + match_num, btp_id: match_num * 10 + 1 }] },
					{ players: [{ name: 'Player B ' + match_num, btp_id: match_num * 10 + 2 }] },
				],
			},
		});
		await insert(db, 'matches', make_match('match-1', 1));
		await insert(db, 'matches', make_match('match-2', 2));

		await auto_execute_preparation_selection(app, tournament, 'location-1');

		const changed1 = await db.matches.findOne_async({ _id: 'match-1' });
		const changed2 = await db.matches.findOne_async({ _id: 'match-2' });
		assert.strictEqual(changed1.setup.state, 'preparation');
		assert.strictEqual(changed1.setup.preparation_call_timestamp, 5000000000);
		assert.strictEqual(changed2.setup.state, 'scheduled');
		assert.deepStrictEqual(sleeps, []);
	});

	it('does not apply the preparation call gap to manual calls', async function() {
		const db = await database.init_test();
		let now = 3000000000;
		const sleeps = [];
		const app = {
			db,
			clock: {
				now_ms: () => now,
				sleep_ms: async (ms) => {
					sleeps.push(ms);
					now += ms;
				},
			},
		};
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			call_preparation_matches_automatically_enabled: true,
			preparation_call_min_gap_seconds: 10,
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		const make_match = (id, match_num) => ({
			_id: id,
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				court_id: 'court-1',
				match_num,
				teams: [
					{ players: [{ name: 'Player A ' + match_num, btp_id: match_num * 10 + 1 }] },
					{ players: [{ name: 'Player B ' + match_num, btp_id: match_num * 10 + 2 }] },
				],
			},
		});
		const match1 = await insert(db, 'matches', make_match('match-1', 1));
		const match2 = await insert(db, 'matches', make_match('match-2', 2));

		await call_match_in_preparation(app, tournament, match1, 'location-1', { force: true });
		await call_match_in_preparation(app, tournament, match2, 'location-1', { force: true });

		const changed1 = await db.matches.findOne_async({ _id: 'match-1' });
		const changed2 = await db.matches.findOne_async({ _id: 'match-2' });
		assert.strictEqual(changed1.setup.preparation_call_timestamp, 3000000000);
		assert.strictEqual(changed2.setup.preparation_call_timestamp, 3000000000);
		assert.deepStrictEqual(sleeps, []);
	});

	it('rejects calling a match on a second court while it is already on court', async function() {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			btp_match_ids: [{ id: 101 }],
			setup: {
				is_match: true,
				incomplete: false,
				state: 'oncourt',
				court_id: 'court-1',
				now_on_court: true,
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await assert.rejects(
			ensure_match_not_already_on_other_court(app, 'default', {
				_id: 'match-1',
				setup: { court_id: 'court-2' },
			}),
			/Match match-1 is already on court court-1/
		);
	});

	it('does not announce a match again when the same court call is repeated', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			automation_enabled: false,
			official_rotation_mode: 'disabled',
		});
		await insert(db, 'courts', {
			_id: 'court-1',
			tournament_key: 'default',
			btp_id: 1,
			is_active: true,
		});
		const match = await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			btp_match_ids: [{ id: 101 }],
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				court_id: 'court-1',
				now_on_court: true,
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		const original_notify_change = admin.notify_change;
		const notifications = [];
		admin.notify_change = (_app, _tournament_key, type) => {
			notifications.push(type);
		};
		try {
			await call_match(app, tournament, match);
			const called_once = await db.matches.findOne_async({ _id: 'match-1' });
			await call_match(app, tournament, called_once);
		} finally {
			admin.notify_change = original_notify_change;
		}

		assert.strictEqual(
			notifications.filter((type) => type === 'match_called_on_court').length,
			1
		);
		const changed = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(changed.setup.called_timestamp, 1234567890);
	});

	it('calls a prepared match as soon as its preparation age is reached', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 10 * 60 * 1000 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			official_rotation_mode: 'disabled',
			call_next_possible_scheduled_match_in_preparation: true,
			call_on_court_only_preparation_enabled: true,
			call_on_court_only_preparation_minutes: 5,
		});
		await insert(db, 'courts', {
			_id: 'court-1',
			tournament_key: 'default',
			location_id: 'location-1',
			btp_id: 1,
			is_active: true,
		});
		await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			btp_match_ids: [{ id: 101 }],
			setup: {
				is_match: true,
				incomplete: false,
				state: 'preparation',
				location_id: 'location-1',
				preparation_call_timestamp: 4 * 60 * 1000,
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await new Promise((resolve, reject) => {
			match_utils.process_preparation_age_auto_calls_for_tournament(app, tournament, (err) => {
				if (err) return reject(err);
				resolve();
			});
		});

			const changed = await db.matches.findOne_async({ _id: 'match-1' });
			assert.strictEqual(changed.setup.state, 'oncourt');
		assert.strictEqual(changed.setup.court_id, 'court-1');
		assert.strictEqual(changed.setup.now_on_court, true);
		assert.strictEqual(changed.setup.called_timestamp, 10 * 60 * 1000);
	});

	it('does not call a prepared match when another on-court condition still fails', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 10 * 60 * 1000 } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			official_rotation_mode: 'disabled',
			call_next_possible_scheduled_match_in_preparation: true,
			call_on_court_only_preparation_enabled: true,
			call_on_court_only_preparation_minutes: 5,
			call_on_court_participant_readiness_mode: 'checked_in',
		});
		await insert(db, 'courts', {
			_id: 'court-1',
			tournament_key: 'default',
			location_id: 'location-1',
			btp_id: 1,
			is_active: true,
		});
		await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'preparation',
				location_id: 'location-1',
				preparation_call_timestamp: 4 * 60 * 1000,
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1, checked_in: true }] },
					{ players: [{ name: 'Player B', btp_id: 2, checked_in: false }] },
				],
			},
		});

		await new Promise((resolve, reject) => {
			match_utils.process_preparation_age_auto_calls_for_tournament(app, tournament, (err) => {
				if (err) return reject(err);
				resolve();
			});
		});

		const changed = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(changed.setup.state, 'preparation');
		assert.strictEqual(changed.setup.court_id, undefined);
		assert.strictEqual(changed.setup.now_on_court, undefined);
	});

	it('calls a match in preparation as soon as player pause expires', async function() {
		const db = await database.init_test();
		let now = 99_999;
		const app = { db, clock: { now_ms: () => now } };
		const tournament = await insert(db, 'tournaments', {
			key: 'default',
			btp_enabled: false,
			automation_enabled: true,
			call_preparation_matches_automatically_enabled: true,
			preparation_call_player_pause_expired_enabled: true,
			btp_settings: {
				pause_duration_ms: 10_000,
			},
		});
		await insert(db, 'locations', {
			_id: 'location-1',
			tournament_key: 'default',
			highlight: 6,
			name: 'Main hall',
		});
		await insert(db, 'courts', {
			_id: 'court-1',
			tournament_key: 'default',
			location_id: 'location-1',
			btp_id: 1,
			is_active: true,
		});
		await insert(db, 'matches', {
			_id: 'match-1',
			tournament_key: 'default',
			setup: {
				is_match: true,
				incomplete: false,
				state: 'scheduled',
				location_id: 'location-1',
				match_num: 1,
				teams: [
					{ players: [{ name: 'Player A', btp_id: 1, last_time_on_court_ts: 90_000 }] },
					{ players: [{ name: 'Player B', btp_id: 2 }] },
				],
			},
		});

		await new Promise((resolve, reject) => {
			match_utils.process_preparation_pause_auto_calls_for_tournament(app, tournament, (err) => {
				if (err) return reject(err);
				resolve();
			});
		});
		let changed = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(changed.setup.state, 'scheduled');

		now = 100_000;
		await new Promise((resolve, reject) => {
			match_utils.process_preparation_pause_auto_calls_for_tournament(app, tournament, (err) => {
				if (err) return reject(err);
				resolve();
			});
		});

		changed = await db.matches.findOne_async({ _id: 'match-1' });
		assert.strictEqual(changed.setup.state, 'preparation');
		assert.strictEqual(changed.setup.location_id, 'location-1');
		assert.strictEqual(changed.setup.preparation_call_timestamp, 100_000);
	});
});
