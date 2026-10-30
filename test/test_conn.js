'use strict';

const assert = require('assert');

const {_describe, _it} = require('./tutils.js');

const conn = require('../static/js/conn.js');

_describe('conn', () => {
	_it('queues normal change messages instead of handling them synchronously', (done) => {
		const handled = [];
		const c = conn(() => {}, (msg) => handled.push(msg));

		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'match_edit',
				tournament_key: 'default',
				val: { match__id: 'm1' },
			}),
		});

		assert.strictEqual(handled.length, 0);
		assert.strictEqual(c._test_change_queue_length(), 1);

		setTimeout(() => {
			assert.strictEqual(handled.length, 1);
			assert.strictEqual(handled[0].ctype, 'match_edit');
			assert.strictEqual(c._test_change_queue_length(), 0);
			done();
		}, 10);
	});

	_it('handles announcement and status changes immediately', () => {
		const handled = [];
		const c = conn(() => {}, (msg) => handled.push(msg));

		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'match_called_on_court',
				tournament_key: 'default',
				val: { setup: { court_id: 'c1' } },
			}),
		});
		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'btp_status',
				tournament_key: 'default',
				val: { status: 'connected', fetch_in_progress: true },
			}),
		});

		assert.deepStrictEqual(handled.map((msg) => msg.ctype), ['match_called_on_court', 'btp_status']);
		assert.strictEqual(c._test_change_queue_length(), 0);
	});

	_it('coalesces queued score changes by match', () => {
		const handled = [];
		const c = conn(() => {}, (msg) => handled.push(msg));

		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'score',
				tournament_key: 'default',
				val: { match_id: 'm1', network_score: [[1, 0]] },
			}),
		});
		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'score',
				tournament_key: 'default',
				val: { match_id: 'm1', network_score: [[2, 0]] },
			}),
		});
		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'score',
				tournament_key: 'default',
				val: { match_id: 'm2', network_score: [[1, 1]] },
			}),
		});

		assert.strictEqual(c._test_change_queue_length(), 2);
		c._test_process_change_queue();
		assert.deepStrictEqual(handled.map((msg) => [msg.ctype, msg.val.match_id, msg.val.network_score]), [
			['score', 'm1', [[2, 0]]],
			['score', 'm2', [[1, 1]]],
		]);
	});

	_it('coalesces queued player status changes by match', () => {
		const handled = [];
		const c = conn(() => {}, (msg) => handled.push(msg));

		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'update_player_status',
				tournament_key: 'default',
				val: { match__id: 'm1', setup: { version: 1 } },
			}),
		});
		c._test_handle_message({
			data: JSON.stringify({
				type: 'change',
				ctype: 'update_player_status',
				tournament_key: 'default',
				val: { match__id: 'm1', setup: { version: 2 } },
			}),
		});

		assert.strictEqual(c._test_change_queue_length(), 1);
		c._test_process_change_queue();
		assert.strictEqual(handled.length, 1);
		assert.deepStrictEqual(handled[0].val.setup, { version: 2 });
	});

	_it('keeps the newest score after an intervening full match snapshot', () => {
		let score;
		const handled = [];
		const c = conn(() => {}, msg => {
			handled.push(msg.ctype);
			score = msg.ctype === 'score' ? msg.val.network_score : msg.val.match.network_score;
		});
		const receive = (ctype, val) => c._test_handle_message({ data: JSON.stringify({ type: 'change', ctype, tournament_key: 'default', val }) });
		receive('score', { match_id: 'm1', network_score: [[2, 0]] });
		receive('match_edit', { match__id: 'm1', match: { network_score: [[2, 0]] } });
		receive('score', { match_id: 'm1', network_score: [[7, 8]] });
		c._test_process_change_queue();
		assert.deepStrictEqual(score, [[7, 8]], 'an older snapshot must not overwrite the latest score');
		assert.deepStrictEqual(handled, ['match_edit', 'score']);
	});

	_it('keeps the newest player status after an intervening full match snapshot', () => {
		let checked_in;
		const c = conn(() => {}, msg => {
			checked_in = msg.ctype === 'update_player_status' ? msg.val.setup.checked_in : msg.val.match.setup.checked_in;
		});
		const receive = (ctype, val) => c._test_handle_message({ data: JSON.stringify({ type: 'change', ctype, tournament_key: 'default', val }) });
		receive('update_player_status', { match__id: 'm1', setup: { checked_in: false } });
		receive('match_edit', { match__id: 'm1', match: { setup: { checked_in: false } } });
		receive('update_player_status', { match__id: 'm1', setup: { checked_in: true } });
		c._test_process_change_queue();
		assert.strictEqual(checked_in, true);
	});

	_it('keeps coalesced scores in their latest arrival order across courts', () => {
		const handled = [], c = conn(() => {}, msg => handled.push(msg.val));
		const receive = val => c._test_handle_message({ data: JSON.stringify({ type: 'change', ctype: 'score', tournament_key: 'default', val }) });
		receive({ match_id: 'one', network_score: [[1, 0]] });
		receive({ match_id: 'two', network_score: [[4, 3]] });
		receive({ match_id: 'one', network_score: [[2, 0]] });
		c._test_process_change_queue();
		assert.deepStrictEqual(handled.map(value => value.match_id), ['two', 'one']);
		assert.deepStrictEqual(handled[1].network_score, [[2, 0]]);
	});

	_it('does not lose a new event queued while its previous event is being handled', () => {
		const handled = [];
		const receive = points => c._test_handle_message({ data: JSON.stringify({ type: 'change', ctype: 'score', tournament_key: 'default', val: { match_id: 'one', points } }) });
		const c = conn(() => {}, msg => {
			handled.push(msg.val.points);
			if (msg.val.points === 1) receive(2);
		});
		receive(1);
		c._test_process_change_queue();
		assert.deepStrictEqual(handled, [1, 2]);
		assert.strictEqual(c._test_change_queue_length(), 0);
	});

	_it('preserves the pending order after a partially processed batch', () => {
		const handled = [], c = conn(() => {}, msg => handled.push(msg));
		const receive = (ctype, val) => c._test_handle_message({ data: JSON.stringify({ type: 'change', ctype, tournament_key: 'default', val }) });
		for (let i = 0; i < 26; i++) receive('match_edit', { match__id: 'other-' + i });
		c._test_process_change_queue();
		assert.strictEqual(handled.length, 25);
		receive('score', { match_id: 'one', network_score: [[1, 0]] });
		receive('match_edit', { match__id: 'one' });
		receive('score', { match_id: 'one', network_score: [[7, 8]] });
		assert.strictEqual(c._test_change_queue_length(), 3);
		c._test_process_change_queue();
		assert.deepStrictEqual(handled.slice(25).map(msg => [msg.ctype, msg.val.match_id || msg.val.match__id]), [
			['match_edit', 'other-25'], ['match_edit', 'one'], ['score', 'one'],
		]);
		assert.deepStrictEqual(handled.at(-1).val.network_score, [[7, 8]]);
	});
});
