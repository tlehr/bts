'use strict';

const assert = require('assert');

const admin = require('../bts/admin');
const database = require('../bts/database');
const match_utils = require('../bts/match_utils');
const bupws_v2 = require('../bts/bupws_v2');
const { promisify } = require('util');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
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

async function fixture() {
	const db = await database.init_test();
	const app = { db, clock: { now_ms: () => 987654321 } };
	await insert(db, 'tournaments', {
		key: 'default',
		tabletoperator_enabled: false,
		btp_enabled: false,
	});
	await insert(db, 'courts', {
		_id: 'court-1',
		tournament_key: 'default',
		name: 'Court 1',
		btp_id: 1,
	});
	const retired_match = await insert(db, 'matches', {
		_id: 'match-44',
		tournament_key: 'default',
		btp_match_ids: [{ id: 44, draw: 7 }],
		score_status: 'retired',
		forward_loser: true,
		team1_won: true,
		btp_winner: 1,
		network_score: [[21, 19]],
		score_status_network_score: [[21, 19]],
		presses: [{ type: 'point', team: 0 }],
		end_ts: 987650000,
		setup: {
			event_name: 'MD U17',
			match_num: 44,
			state: 'finished',
			is_match: true,
			incomplete: false,
			court_id: 'court-1',
			now_on_court: false,
			called_timestamp: 12345,
			teams: [
				{ players: [{ firstname: 'Aditri', lastname: 'Reddy Kotla', btp_id: 101 }] },
				{ players: [{ firstname: 'Lenie', lastname: 'Kison', btp_id: 201 }] },
			],
		},
	});
	return { db, app, retired_match };
}

function reactivation_message(retired_match) {
	const edited = clone(retired_match);
	edited.setup.now_on_court = true;
	edited.score_status = 'normal';
	edited.forward_loser = false;
	return { type: 'match_edit', id: retired_match._id, tournament_key: 'default',
		match: edited, old_court: 'court-1', btp_update: false };
}

describe('admin match reactivation', function() {
	it('puts an accidentally retired match back on the same court for tablet scoring', async function() {
		const { db, app, retired_match } = await fixture();
		const canonical = db.model.tournament('default').matches.get('match-44');
		const edited_match = clone(retired_match);
		edited_match.setup.now_on_court = true;
		edited_match.score_status = 'normal';
		edited_match.forward_loser = false;
		delete edited_match.team1_won;
		delete edited_match.btp_winner;
		delete edited_match.network_score;
		delete edited_match.score_status_network_score;

		await handle_match_edit(app, {
			type: 'match_edit',
			id: 'match-44',
			tournament_key: 'default',
			match: edited_match,
			old_court: 'court-1',
			btp_update: false,
		});

		const changed = await db.matches.findOne_async({ _id: 'match-44' });
		assert.strictEqual(changed.score_status, 'normal');
		assert.strictEqual(changed.forward_loser, false);
		assert.strictEqual(changed.team1_won, undefined);
		assert.strictEqual(changed.btp_winner, undefined);
		assert.strictEqual(changed.score_status_network_score, undefined);
		assert.strictEqual(changed.end_ts, undefined);
		assert.deepStrictEqual(changed.network_score, [[21, 19]]);
		assert.deepStrictEqual(changed.presses, [{ type: 'point', team: 0 }]);
		assert.strictEqual(changed.setup.now_on_court, true);
		assert.strictEqual(changed.setup.state, 'oncourt');
		assert.strictEqual(changed.setup.called_timestamp, 987654321);
		assert.strictEqual(changed.btp_needsync, true);

		const court = await db.courts.findOne_async({ _id: 'court-1' });
		assert.strictEqual(court.match_id, 'match-44');
		assert.strictEqual(db.model.tournament('default').matches.get('match-44'), canonical);
		assert.strictEqual(canonical.data.setup.state, 'oncourt');

		const tablet = { court_id: 'court-1', messages: [],
			sendmsg(payload) { this.messages.push(payload); },
		};
		await bupws_v2.handle_score_update(app, tablet, {
			tournament_key: 'default', score: { match_id: 'match-44', court_id: 'court-1',
				network_score: [[21, 19], [1, 0]], presses: [...changed.presses, { type: 'point', team: 0 }],
			},
		});
		assert(!tablet.messages.some(message => message.type === 'error'));
		assert.deepStrictEqual(canonical.data.network_score, [[21, 19], [1, 0]]);
		assert.strictEqual(canonical.data.team1_won, undefined);
	});

	it('keeps the finished result intact if the court is occupied', async function() {
		const { db, app, retired_match } = await fixture();
		await insert(db, 'matches', { _id: 'other', tournament_key: 'default', setup: {
			state: 'oncourt', now_on_court: true, court_id: 'court-1',
		} });
		await db.courts.update_async({ _id: 'court-1' }, { $set: { match_id: 'other' } }, {});
		await assert.rejects(handle_match_edit(app, reactivation_message(retired_match)), /already occupied by match other/);
		assert.deepStrictEqual(await db.matches.findOne_async({ _id: 'match-44' }), retired_match);
		assert.strictEqual((await db.courts.findOne_async({ _id: 'court-1' })).match_id, 'other');
		// The rejected attempt must release its call lock so a retry can succeed.
		await db.matches.remove_async({ _id: 'other' }, {});
		await handle_match_edit(app, reactivation_message(retired_match));
		assert.strictEqual((await db.matches.findOne_async({ _id: 'match-44' })).setup.state, 'oncourt');
	});

	it('keeps the finished result intact if a team is missing', async function() {
		const { db, app, retired_match } = await fixture();
		const message = reactivation_message(retired_match);
		message.match.setup.teams[1].players = [];
		await assert.rejects(handle_match_edit(app, message), err => String(err).includes('one or more Teams are not set'));
		assert.deepStrictEqual(await db.matches.findOne_async({ _id: 'match-44' }), retired_match);
	});

	it('requires explicit admin reactivation before calling a finished match', async function() {
		const { db, app, retired_match } = await fixture();
		const tournament = await db.tournaments.findOne_async({ key: 'default' });
		const edited = reactivation_message(retired_match).match;
		await assert.rejects(promisify(match_utils.call_match)(app, tournament, edited, 'court-1'), /already finished/);
		assert.deepStrictEqual(await db.matches.findOne_async({ _id: 'match-44' }), retired_match);
	});

	it('reactivates a normally finished match when team two won and preserves point and serving data', async function() {
		const { db, app } = await fixture();
		await db.matches.update_async({ _id: 'match-44' }, { $set: {
			score_status: 'normal', forward_loser: false, team1_won: false, btp_winner: 2,
			network_team1_left: false, network_team1_serving: true, network_teams_player1_even: [true, false],
		} }, {});
		const finished = await db.matches.findOne_async({ _id: 'match-44' });
		await handle_match_edit(app, reactivation_message(finished));
		const changed = await db.matches.findOne_async({ _id: 'match-44' });
		assert.strictEqual(changed.setup.state, 'oncourt');
		assert.strictEqual(changed.team1_won, undefined);
		assert.strictEqual(changed.btp_winner, undefined);
		assert.strictEqual(changed.end_ts, undefined);
		for (const field of ['network_score', 'presses', 'network_team1_left', 'network_team1_serving', 'network_teams_player1_even']) {
			assert.deepStrictEqual(changed[field], finished[field], field);
		}
	});
});
