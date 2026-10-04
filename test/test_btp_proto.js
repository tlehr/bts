'use strict';

const assert = require('assert');
const { _describe, _it } = require('./tutils.js');
const btp_proto = require('../bts/btp_proto.js');

function extract_first_match_status(req) {
	return req.Update.Tournament.Matches[0].Match.Status;
}

_describe('btp_proto update_request', () => {
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

	_it('builds BTP payment updates', () => {
		const req = btp_proto.update_payments_request([{
			player_id: '45',
			amount: 11.5,
			guid: '{E819D7D0-3D2F-41E0-805D-C91AB49A7CF9}',
			payment_type: 1,
			payment_date: '2026-10-03T10:20:00.000Z',
		}], 'unicode', null);

		assert.strictEqual(req.Action.ID, 'ADDRECORD');
		const payment = req.Update.Tournament.Payments[0].Payment;
		assert.strictEqual(payment.ID, 0);
		assert.strictEqual(payment.playerID, 45);
		assert.strictEqual(payment.Amount, 11.5);
		assert.strictEqual(payment.GUID, '{E819D7D0-3D2F-41E0-805D-C91AB49A7CF9}');
		assert.strictEqual(payment.PaymentType, 1);
		assert(payment.PaymentDate instanceof Date);
		const xml = btp_proto._req2xml(req);
		assert(xml.includes('<GROUP ID="Payments">'));
		assert(xml.includes('<ITEM TYPE="Integer" ID="ID">0</ITEM>'));
		assert(xml.includes('<ITEM TYPE="Integer" ID="playerID">45</ITEM>'));
		assert(xml.includes('<ITEM TYPE="Float" ID="Amount">11.5</ITEM>'));
		assert(xml.includes('<ITEM TYPE="String" ID="GUID">{E819D7D0-3D2F-41E0-805D-C91AB49A7CF9}</ITEM>'));
	});
});
