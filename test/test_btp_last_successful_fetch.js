'use strict';

const assert = require('assert');
const btp_conn = require('../bts/btp_conn');
const manager = require('../bts/btp_manager');

describe('BTP last successful fetch status', function() {
	let original, connection, key;
	let sequence = 0;
	beforeEach(function() {
		original = btp_conn.BTPConn;key = 'last-successful-fetch-' + (++sequence);
		btp_conn.BTPConn = class {
			constructor(...args) {
				connection = this;this.app = args[0];this.tkey = args[3];
				this.last_successful_fetch_ts = args[9];
				this.last_status = {status: 'connected', message: ''};
				this.next_fetch_ts = null;this.fetch_in_progress = false;
			}
			terminate() {this.terminated = true;}
		};
	});
	afterEach(function() {
		manager.reconfigure({}, {key, btp_enabled: false});btp_conn.BTPConn = original;
	});
	it('includes the same successful time in initial API status and live status events', function() {
		assert.strictEqual(manager.get_status(key).last_successful_fetch_ts, null);
		manager.reconfigure({}, {key, btp_enabled: true});
		connection.last_successful_fetch_ts = 1700000000000;
		const admin = require('../bts/admin'), notify = admin.notify_change, events = [];
		admin.notify_change = (app, tournament_key, type, value) => events.push({tournament_key, type, value});
		try {original.prototype.publish_status.call(connection);}
		finally {admin.notify_change = notify;}
		assert.strictEqual(manager.get_status(key).last_successful_fetch_ts, 1700000000000);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].tournament_key, key);assert.strictEqual(events[0].type, 'btp_status');
		assert.strictEqual(events[0].value.last_successful_fetch_ts, 1700000000000);
	});
	it('retains the time across reconfiguration and disabling without adding database writes', function() {
		manager.reconfigure({}, {key, btp_enabled: true});
		const first = connection;first.last_successful_fetch_ts = 1700000000000;
		manager.reconfigure({}, {key, btp_enabled: true});
		assert(first.terminated);assert.notStrictEqual(connection, first);
		assert.strictEqual(manager.get_status(key).last_successful_fetch_ts, 1700000000000);
		manager.reconfigure({}, {key, btp_enabled: false});
		assert.strictEqual(manager.get_status(key).status, 'deactivated');
		assert.strictEqual(manager.get_status(key).last_successful_fetch_ts, 1700000000000);
		manager.reconfigure({}, {key, btp_enabled: true});
		assert.strictEqual(connection.last_successful_fetch_ts, 1700000000000);
		assert.strictEqual(manager.get_status(key + '-other').last_successful_fetch_ts, null);
	});
});
