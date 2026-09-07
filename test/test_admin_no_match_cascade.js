'use strict';

const assert = require('assert');

const admin = require('../bts/admin');
const database = require('../bts/database');

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
});
