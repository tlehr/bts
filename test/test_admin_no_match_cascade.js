'use strict';

const assert = require('assert');

const admin = require('../bts/admin');
const database = require('../bts/database');
const btp_manager = require('../bts/btp_manager');
const btp_proto = require('../bts/btp_proto');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
		});
	});
}

function cascade_no_match_for_future_player_matches(app, tournament_key, source_match) {
	return new Promise((resolve, reject) => {
		admin.cascade_no_match_for_future_player_matches(app, tournament_key, source_match, (err, changed_matches) => {
			if (err) return reject(err);
			resolve(changed_matches);
		});
	});
}

function handle_match_edit(app, msg) {
	return new Promise((resolve, reject) => {
		const ws = {
			respond: (_msg, err, payload) => {
				if (err) return reject(err);
				resolve(payload);
			},
		};
		admin.handle_match_edit(app, ws, msg);
	});
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function make_match(overrides = {}) {
	const setup_overrides = overrides.setup || {};
	return {
		_id: overrides._id,
		tournament_key: 'default',
		score_status: overrides.score_status || 'normal',
		forward_loser: overrides.forward_loser === true,
		team1_won: overrides.team1_won,
		btp_winner: overrides.btp_winner,
		no_match_losing_team: overrides.no_match_losing_team,
		setup: {
			event_name: 'JE U17',
			state: 'scheduled',
			is_match: true,
			incomplete: false,
			match_num: 1,
			teams: [
				{ players: [{ name: 'Player A', btp_id: 1 }] },
				{ players: [{ name: 'Player B', btp_id: 2 }] },
			],
			...setup_overrides,
		},
	};
}

describe('admin no-match cascade', function() {
	it('finishes and sends a direct no-winner result from scheduled, prepared and active matches', async function() {
		const original_update = btp_manager.update_score;
		const sent = [];
		btp_manager.update_score = (_app, match) => sent.push(btp_proto.update_request(match, 'unicode'));
		try {
			for (const state of ['scheduled', 'preparation', 'oncourt']) {
				const db = await database.init_test();
				const app = { db, clock: { now_ms: () => 1234567890 } };
				await insert(db, 'tournaments', { key: 'default', btp_enabled: false, btp_settings: {} });
				const match = make_match({ _id: 'direct-result', setup: { state,
					now_on_court: state === 'oncourt', court_id: 'court', location_id: 'hall',
					called_timestamp: state === 'oncourt' ? 1000 : undefined,
					preparation_call_timestamp: state === 'preparation' ? 500 : undefined,
					teams: [{ entry_status: 'WDN', players: [{ btp_id: 1 }] },
						{ entry_status: 'WDN', players: [{ btp_id: 2 }] }],
				} });
				match.btp_match_ids = [{ id: 325, draw: 10, planning: 1015 }];
				await insert(db, 'matches', match);
				await insert(db, 'courts', { _id: 'court', tournament_key: 'default',
					match_id: state === 'oncourt' ? match._id : null });
				const draft = clone(match);
				draft.score_status = 'no_match';
				draft.setup.now_on_court = false;
				await handle_match_edit(app, { tournament_key: 'default', id: match._id,
					match: draft, old_court: 'court', btp_update: true });
				const result = await db.matches.findOne_async({ _id: match._id });
				assert.strictEqual(result.setup.state, 'finished', state);
				assert.strictEqual(result.score_status, 'no_match');
				assert.strictEqual(result.setup.now_on_court, false);
				assert.strictEqual(result.setup.preparation_call_timestamp, undefined);
				assert.strictEqual(result.team1_won, undefined);
				assert.strictEqual(result.btp_winner, undefined);
				assert.strictEqual(result.btp_needsync, true);
				assert.strictEqual(result.forward_loser, false);
				assert.strictEqual((await db.courts.findOne_async({ _id: 'court' })).match_id, null);
				const outbound = sent[sent.length - 1].Update.Tournament.Matches[0].Match;
				assert.strictEqual(outbound.ScoreStatus, 4);
				assert.strictEqual(outbound.Winner, undefined);
				assert.strictEqual(outbound.Sets, undefined);
				assert.strictEqual(outbound.ForwardLoser, undefined);
			}
		} finally { btp_manager.update_score = original_update; }
	});

	it('records a finished no-match result without a winner when both sides cannot play', async function() {
		const db = await database.init_test();
		const app = { db };
		const source = make_match({ _id: 'source-a', score_status: 'retired', team1_won: false });
		const other_source = make_match({ _id: 'source-b', score_status: 'disqualified', team1_won: false,
			setup: { teams: [{ players: [{ btp_id: 3 }] }, { players: [{ btp_id: 4 }] }] } });
		const future = make_match({ _id: 'both-inactive', setup: { match_num: 325,
			scheduled_date: '2026-09-27', scheduled_time_str: '09:00',
			teams: [{ players: [{ btp_id: 1 }] }, { players: [{ btp_id: 3 }] }] } });
		for (const match of [source, other_source, future]) await insert(db, 'matches', match);
		await cascade_no_match_for_future_player_matches(app, 'default', source);
		const result = await db.matches.findOne_async({ _id: future._id });
		assert.strictEqual(result.score_status, 'no_match');
		assert.strictEqual(result.setup.state, 'finished');
		assert.strictEqual(result.setup.now_on_court, false);
		assert.strictEqual(result.btp_needsync, true);
		assert.strictEqual(result.team1_won, undefined);
		assert.strictEqual(result.btp_winner, undefined);
		assert.strictEqual(result.no_match_losing_team, undefined);
		assert.strictEqual(result.network_score, undefined);
	});

	it('announces cascaded no-match wins only when enabled', function() {
		const sent = [];
		const ws = {
			last_tournament_key: 'default',
			sendmsg: (msg) => sent.push(msg),
		};
		const app = { clock: { now_ms: () => 1234567890 } };
		const match = make_match({
			_id: 'cascaded',
			score_status: 'no_match',
			no_match_losing_team: 0,
			team1_won: false,
			btp_winner: 2,
			setup: {
				teams: [
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
					{ players: [{ name: 'Silas Kaemena', btp_id: 84 }] },
				],
			},
		});
		match.no_match_cascade_source_match_id = 'source';

		admin.on_connect(app, ws);
		try {
			assert.strictEqual(
				admin.notify_cascaded_no_match_announcements(
					app,
					'default',
					{ no_match_cascade_announcements_enabled: false },
					[match]
				),
				0
			);
			assert.strictEqual(sent.length, 0);

			assert.strictEqual(
				admin.notify_cascaded_no_match_announcements(
					app,
					'default',
					{ no_match_cascade_announcements_enabled: true },
					[match]
				),
				1
			);
			assert.strictEqual(sent.length, 1);
			assert.strictEqual(sent[0].ctype, 'match_no_match_announcement');
			assert.strictEqual(sent[0].val.match__id, 'cascaded');
			assert.strictEqual(sent[0].val.winning_team_index, 1);
			assert.strictEqual(sent[0].val._announcement_ts, 1234567890);
		} finally {
			admin.on_close(app, ws);
		}
	});

	it('cascades from a group match into placement matches of the same discipline', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		const source = make_match({
			_id: 'source',
			score_status: 'no_match',
			forward_loser: true,
			no_match_losing_team: 1,
			team1_won: true,
			btp_winner: 1,
			setup: {
				event_name: 'JE U17 - Gruppe A',
				match_num: 31,
				teams: [
					{ players: [{ name: 'Muhammad Sytsh Abdulquddus', btp_id: 62 }] },
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
				],
			},
		});
		const placement_match = make_match({
			_id: 'placement',
			setup: {
				event_name: 'JE U17',
				match_num: 86,
				scheduled_date: '2026-09-27',
				scheduled_time_str: '12:00',
				teams: [
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
					{ players: [{ name: 'Silas Kaemena', btp_id: 84 }] },
				],
			},
		});
		const doubles_match = make_match({
			_id: 'doubles',
			setup: {
				event_name: 'JD U17',
				match_num: 87,
				teams: [
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
					{ players: [{ name: 'Other Player', btp_id: 85 }] },
				],
			},
		});

		await insert(db, 'matches', source);
		await insert(db, 'matches', placement_match);
		await insert(db, 'matches', doubles_match);

		const changed_matches = await cascade_no_match_for_future_player_matches(app, 'default', source);

		assert.deepStrictEqual(changed_matches.map((match) => match._id), ['placement']);
		const changed_placement = await db.matches.findOne_async({ _id: 'placement' });
		assert.strictEqual(changed_placement.score_status, 'no_match');
		assert.strictEqual(changed_placement.setup.state, 'finished');
		assert.strictEqual(changed_placement.forward_loser, true);
		assert.strictEqual(changed_placement.no_match_losing_team, 0);
		assert.strictEqual(changed_placement.team1_won, false);
		assert.strictEqual(changed_placement.btp_winner, 2);
		assert.strictEqual(changed_placement.no_match_cascade_source_match_id, 'source');
		assert.deepStrictEqual(changed_placement.no_match_cascade_affected_btp_ids, ['74']);

		const unchanged_doubles = await db.matches.findOne_async({ _id: 'doubles' });
		assert.strictEqual(unchanged_doubles.score_status, 'normal');
		assert.strictEqual(unchanged_doubles.team1_won, undefined);
	});

	it('does not cascade into future matches without a scheduled time', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		const source = make_match({
			_id: 'source',
			score_status: 'retired',
			forward_loser: true,
			no_match_losing_team: 1,
			team1_won: true,
			btp_winner: 1,
			setup: {
				event_name: 'JE U17 - Gruppe A',
				match_num: 31,
				teams: [
					{ players: [{ name: 'Muhammad Sytsh Abdulquddus', btp_id: 62 }] },
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
				],
			},
		});
		const scheduled_match = make_match({
			_id: 'scheduled',
			setup: {
				event_name: 'JE U17',
				match_num: 86,
				scheduled_date: '2026-09-27',
				scheduled_time_str: '12:30',
				teams: [
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
					{ players: [{ name: 'Silas Kaemena', btp_id: 84 }] },
				],
			},
		});
		const unscheduled_match = make_match({
			_id: 'unscheduled',
			setup: {
				event_name: 'JE U17',
				state: 'unscheduled',
				match_num: 106,
				teams: [
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
					{ players: [{ name: 'Other Player', btp_id: 85 }] },
				],
			},
		});

		await insert(db, 'matches', source);
		await insert(db, 'matches', scheduled_match);
		await insert(db, 'matches', unscheduled_match);

		const changed_matches = await cascade_no_match_for_future_player_matches(app, 'default', source);

		assert.deepStrictEqual(changed_matches.map((match) => match._id), ['scheduled']);
		const changed_scheduled = await db.matches.findOne_async({ _id: 'scheduled' });
		assert.strictEqual(changed_scheduled.score_status, 'no_match');

		const unchanged_unscheduled = await db.matches.findOne_async({ _id: 'unscheduled' });
		assert.strictEqual(unchanged_unscheduled.score_status, 'normal');
		assert.strictEqual(unchanged_unscheduled.team1_won, undefined);
		assert.strictEqual(unchanged_unscheduled.btp_winner, undefined);
		assert.strictEqual(unchanged_unscheduled.no_match_cascade_source_match_id, undefined);
	});

	it('applies a prior cascade when a future match is scheduled later', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', {
			key: 'default',
			no_match_cascade_announcements_enabled: false,
		});
		const source = make_match({
			_id: 'source',
			score_status: 'retired',
			forward_loser: true,
			no_match_losing_team: 1,
			team1_won: true,
			btp_winner: 1,
			setup: {
				event_name: 'JE U17 - Gruppe A',
				match_num: 31,
				teams: [
					{ players: [{ name: 'Muhammad Sytsh Abdulquddus', btp_id: 62 }] },
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
				],
			},
		});
		const future_match = make_match({
			_id: 'future',
			setup: {
				event_name: 'JE U17',
				state: 'unscheduled',
				match_num: 106,
				teams: [
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
					{ players: [{ name: 'Silas Kaemena', btp_id: 84 }] },
				],
			},
		});
		const scheduled_future_match = clone(future_match);
		scheduled_future_match.setup.state = 'scheduled';
		scheduled_future_match.setup.scheduled_date = '2026-09-27';
		scheduled_future_match.setup.scheduled_time_str = '13:00';

		await insert(db, 'matches', source);
		await insert(db, 'matches', future_match);

		await handle_match_edit(app, {
			type: 'match_edit',
			tournament_key: 'default',
			id: 'future',
			old_court: null,
			match: scheduled_future_match,
		});

		const changed_future_match = await db.matches.findOne_async({ _id: 'future' });
		assert.strictEqual(changed_future_match.score_status, 'no_match');
		assert.strictEqual(changed_future_match.forward_loser, true);
		assert.strictEqual(changed_future_match.no_match_losing_team, 0);
		assert.strictEqual(changed_future_match.team1_won, false);
		assert.strictEqual(changed_future_match.btp_winner, 2);
		assert.strictEqual(changed_future_match.no_match_cascade_source_match_id, 'source');
		assert.deepStrictEqual(changed_future_match.no_match_cascade_affected_btp_ids, ['74']);
		assert.strictEqual(changed_future_match.setup.scheduled_date, '2026-09-27');
		assert.strictEqual(changed_future_match.setup.scheduled_time_str, '13:00');
	});

	it('applies a prior group cascade when a scheduled future match receives the affected player later', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };
		await insert(db, 'tournaments', {
			key: 'default',
			no_match_cascade_announcements_enabled: false,
		});
		const source = make_match({
			_id: 'source-group-b',
			score_status: 'retired',
			forward_loser: true,
			no_match_losing_team: 1,
			team1_won: true,
			btp_winner: 1,
			setup: {
				event_name: 'JE U17 - Gruppe B',
				match_num: 44,
				teams: [
					{ players: [{ name: 'Group B Winner', btp_id: 62 }] },
					{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
				],
			},
		});
		const future_match = make_match({
			_id: 'linked-placement',
			setup: {
				event_name: 'JE U17',
				state: 'scheduled',
				match_num: 106,
				scheduled_date: '2026-09-27',
				scheduled_time_str: '13:30',
				links: { from1: 31, from2: 44 },
				teams: [
					{ players: [{ name: 'Other Group Player', btp_id: 85 }] },
					{ players: [{ name: 'Silas Kaemena', btp_id: 84 }] },
				],
			},
		});
		const linked_future_match = clone(future_match);
		linked_future_match.setup.links = { from1: 44, from2: 31 };
		linked_future_match.setup.teams = [
			{ players: [{ name: 'Lewis Danger', btp_id: 74 }] },
			{ players: [{ name: 'Silas Kaemena', btp_id: 84 }] },
		];

		await insert(db, 'matches', source);
		await insert(db, 'matches', future_match);

		await handle_match_edit(app, {
			type: 'match_edit',
			tournament_key: 'default',
			id: 'linked-placement',
			old_court: null,
			match: linked_future_match,
		});

		const changed_future_match = await db.matches.findOne_async({ _id: 'linked-placement' });
		assert.strictEqual(changed_future_match.score_status, 'no_match');
		assert.strictEqual(changed_future_match.forward_loser, true);
		assert.strictEqual(changed_future_match.no_match_losing_team, 0);
		assert.strictEqual(changed_future_match.team1_won, false);
		assert.strictEqual(changed_future_match.btp_winner, 2);
		assert.strictEqual(changed_future_match.no_match_cascade_source_match_id, 'source-group-b');
		assert.deepStrictEqual(changed_future_match.no_match_cascade_affected_btp_ids, ['74']);
		assert.deepStrictEqual(changed_future_match.no_match_cascade_original_setup.teams[0].players, [
			{ name: 'Lewis Danger', btp_id: 74 },
		]);
	});
});
