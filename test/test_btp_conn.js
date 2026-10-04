'use strict';

const assert = require('assert');

const { BTPConn } = require('../bts/btp_conn');

describe('btp_conn', function() {
	function make_conn_stub() {
		const statuses = [];
		const conn = Object.create(BTPConn.prototype);
		conn.report_status = (status, message) => statuses.push({ status, message });
		return { conn, statuses };
	}

	it('reports deactivated when terminated normally', function() {
		const { conn, statuses } = make_conn_stub();

		conn.terminate();

		assert.strictEqual(conn.terminated, true);
		assert.strictEqual(conn.next_fetch_ts, null);
		assert.strictEqual(conn.fetch_in_progress, false);
		assert.deepStrictEqual(statuses, [{ status: 'deactivated', message: 'Terminated.' }]);
	});

	it('does not report deactivated when silently replaced', function() {
		const { conn, statuses } = make_conn_stub();

		conn.terminate({ silent: true });

		assert.strictEqual(conn.terminated, true);
		assert.strictEqual(conn.next_fetch_ts, null);
		assert.strictEqual(conn.fetch_in_progress, false);
		assert.deepStrictEqual(statuses, []);
	});
});
