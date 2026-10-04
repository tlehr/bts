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

describe('admin match reactivation', function() {
	it('puts an accidentally retired match back on the same court for tablet scoring', async function() {
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
		assert.strictEqual(changed.setup.state, 'blocked');
		assert.strictEqual(changed.setup.called_timestamp, 987654321);
		assert.strictEqual(changed.btp_needsync, true);

		const court = await db.courts.findOne_async({ _id: 'court-1' });
		assert.strictEqual(court.match_id, 'match-44');
	});
});
