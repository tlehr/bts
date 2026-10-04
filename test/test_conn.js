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
});
