'use strict';

const assert = require('assert');
const { _describe, _it } = require('./tutils.js');
const btp_proto = require('../bts/btp_proto.js');

function extract_first_match_status(req) {
	return req.Update.Tournament.Matches[0].Match.Status;
}

_describe('btp_proto update_request', () => {
	_it('sends a no-match result without inventing a winner or score', () => {
		const req = btp_proto.update_request({
			btp_match_ids: [{ id: 1, draw: 2, planning: 3 }],
			score_status: 'no_match', forward_loser: false,
			setup: { state: 'finished', highlight: 0 },
		}, 'unicode');
		const match = req.Update.Tournament.Matches[0].Match;
		assert.strictEqual(match.ScoreStatus, 4);
		assert.strictEqual(match.Winner, undefined);
		assert.strictEqual(match.Sets, undefined);
		assert.strictEqual(match.ForwardLoser, undefined);
	});

	_it('writes match check-in bits in check-in per match mode', () => {
		const req = btp_proto.update_request({
			btp_match_ids: [{ id: 1, draw: 2, planning: 3 }],
			setup: {
				highlight: 0,
				teams: [
					{ players: [{ checked_in: true }, { checked_in: false }] },
					{ players: [{ checked_in: true }, { checked_in: true }] },
				]
			}
		}, 'unicode', null, null, null, null, {
			write_match_check_in_status: true,
		});

		assert.strictEqual(extract_first_match_status(req), 0b1101);
	});

	_it('does not write match check-in bits in check-in per player mode', () => {
		const req = btp_proto.update_request({
			btp_match_ids: [{ id: 1, draw: 2, planning: 3 }],
			setup: {
				highlight: 0,
				teams: [
					{ players: [{ checked_in: true }, { checked_in: true }] },
					{ players: [{ checked_in: true }, { checked_in: true }] },
				]
			}
		}, 'unicode', null, null, null, null, {
			write_match_check_in_status: false,
		});

		assert.strictEqual(extract_first_match_status(req), 0);
	});

	_it('does not report tablet operators as players with fresh LastTimeOnCourt', () => {
		const end_ts = 1770000000000;
		const req = btp_proto.update_request({
			btp_match_ids: [{ id: 1, draw: 2, planning: 3 }],
			btp_player_ids: [11, 22],
			end_ts,
			team1_won: true,
			setup: {
				highlight: 0,
				tabletoperators: [{ btp_id: 99, name: 'Tablet Operator' }],
				teams: [
					{ players: [{ checked_in: true }] },
					{ players: [{ checked_in: true }] },
				],
			},
		}, 'unicode', null, null, null, null, {
			current_now_ms: end_ts + 1000,
		});

		const player_ids = req.Update.Tournament.Players.map((entry) => entry.Player.ID);
		assert.deepStrictEqual(player_ids, [11, 22]);
	});

	_it('sends a bye-vs-bye auto winner without score sets or special status', () => {
		const req = btp_proto.update_request({
			btp_match_ids: [{ id: 1, draw: 2, planning: 3 }],
			team1_won: true,
			btp_winner: 1,
			btp_winner_only_update: true,
			score_status: 'normal',
			btp_score_status: 0,
			setup: {
				highlight: 0,
				teams: [
					{ players: [] },
					{ players: [] },
				],
			},
		}, 'unicode');

		const match = req.Update.Tournament.Matches[0].Match;
		assert.strictEqual(match.Winner, 1);
		assert.strictEqual(match.ScoreStatus, undefined);
		assert.strictEqual(match.Sets, undefined);
		assert.strictEqual(match.Duration, undefined);
	});
});
