'use strict';

const assert = require('assert');

const {
	BTPConn,
	_fetch_hard_timeout_ms,
	_fetch_response_state,
	_hash_fetch_response,
	_normalize_autofetch_timeout_ms,
	_should_skip_fetch_sync,
} = require('../bts/btp_conn');

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

	it('clears pending autofetch timer when terminated', function() {
		const { conn } = make_conn_stub();
		conn.autofetch_timeout = setTimeout(() => {}, 10000);

		conn.terminate();

		assert.strictEqual(conn.autofetch_timeout, null);
	});

	it('interprets the configured autofetch interval as seconds', function() {
		assert.strictEqual(_normalize_autofetch_timeout_ms(30), 30000);
		assert.strictEqual(_normalize_autofetch_timeout_ms('0.1'), 100);
		assert.strictEqual(_normalize_autofetch_timeout_ms(undefined), 30000);
	});

	it('falls back to thirty seconds instead of letting an overflowing timer become 1 ms', function() {
		for (const value of [7998985000, '7998985000', Infinity, NaN, -1, 0, 'invalid']) {
			assert.strictEqual(_normalize_autofetch_timeout_ms(value), 30000);
		}
		assert.strictEqual(_normalize_autofetch_timeout_ms(2147483.647), 2147483647);
		assert.strictEqual(_normalize_autofetch_timeout_ms(2147483.648), 30000);
	});

	it('uses a configurable hard fetch timeout', function() {
		const old_value = process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
		process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = '7';
		try {
			assert.strictEqual(_fetch_hard_timeout_ms(), 7);
		} finally {
			if (old_value === undefined) {
				delete process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
			} else {
				process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = old_value;
			}
		}
	});

	it('hashes equivalent BTP fetch responses consistently', function() {
		const response = { Action: [{ ID: ['REPLY'], Result: [1], Matches: [{ ID: ['m1'] }] }] };

		assert.strictEqual(_hash_fetch_response(response), _hash_fetch_response(response));
		assert.notStrictEqual(
			_hash_fetch_response(response),
			_hash_fetch_response({ Action: [{ ID: ['REPLY'], Result: [1], Matches: [{ ID: ['m2'] }] }] })
		);
	});

	it('skips a BTP fetch sync for an unchanged response without pending local sync', async function() {
		const response_hash = _hash_fetch_response({ Action: [{ ID: ['REPLY'], Result: [1] }] });
		const conn = {
			last_applied_fetch_response_hash: response_hash,
			tkey: 'default',
			app: {
				db: {
					matches: {
						count: (query, cb) => {
							assert.deepStrictEqual(query, { tournament_key: 'default', btp_needsync: true });
							cb(null, 0);
						},
					},
				},
			},
		};

		const decision = await _should_skip_fetch_sync(conn, response_hash);

		assert.deepStrictEqual(decision, {
			skip: true,
			reason: 'identical_response_without_local_pending_sync',
		});
	});

	it('does not skip a BTP fetch sync while local BTP sync is pending', async function() {
		const response_hash = _hash_fetch_response({ Action: [{ ID: ['REPLY'], Result: [1] }] });
		const conn = {
			last_applied_fetch_response_hash: response_hash,
			tkey: 'default',
			app: {
				db: {
					matches: {
						count: (query, cb) => cb(null, 2),
					},
				},
			},
		};

		const decision = await _should_skip_fetch_sync(conn, response_hash);

		assert.deepStrictEqual(decision, {
			skip: false,
			reason: 'local_btp_sync_pending',
			pending_count: 2,
		});
	});

	it('does not skip an unchanged BTP fetch response with hidden empty bye branches', async function() {
		const response = {
			Result: [{
				Tournament: [{
					Matches: [{
						Match: [{
							ID: [101],
							DrawID: [10],
							PlanningID: [1],
						}, {
							ID: [102],
							DrawID: [10],
							PlanningID: [2],
						}, {
							ID: [103],
							DrawID: [10],
							PlanningID: [3],
						}, {
							ID: [201],
							DrawID: [10],
							PlanningID: [4001],
							From1: [1],
							From2: [2],
							WinnerTo: [2009],
							Highlight: [0],
						}, {
							ID: [601],
							DrawID: [10],
							PlanningID: [2009],
							From1: [5001],
							From2: [4001],
							WinnerTo: [1009],
							IsMatch: [true],
							MatchNr: [60],
							Highlight: [0],
						}, {
							ID: [1009],
							DrawID: [10],
							PlanningID: [1009],
							From1: [2009],
							From2: [3],
							IsMatch: [true],
							IsPlayable: [true],
							MatchNr: [28],
							Highlight: [0],
						}, {
							ID: [301],
							DrawID: [10],
							PlanningID: [5001],
							EntryID: [101],
						}],
					}],
					Entries: [{ Entry: [{ ID: [101], Player1ID: [1] }] }],
					Players: [{ Player: [{ ID: [1], Firstname: ['Pairing'], Lastname: ['One'] }] }],
					Draws: [{ Draw: [{ ID: [10], EventID: [20], StageID: [30], Name: ['MD U13'], Position: [1] }] }],
					Events: [{ Event: [{ ID: [20], Name: ['MD U13'], GameTypeID: [2] }] }],
					Stages: [{ Stage: [{ ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }] }],
				}],
			}],
		};
		const response_hash = _hash_fetch_response(response);
		const conn = {
			last_applied_fetch_response_hash: response_hash,
			tkey: 'default',
			app: {
				db: {
					matches: {
						count: (query, cb) => cb(null, 0),
					},
				},
			},
		};

		const decision = await _should_skip_fetch_sync(conn, response_hash, response);

		assert.deepStrictEqual(decision, {
			skip: false,
			reason: 'hidden_empty_bye_branch_pending',
		});
	});

	it('clears fetch state when a BTP fetch never answers', async function() {
		const old_value = process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
		process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = '5';
		const { conn, statuses } = make_conn_stub();
		let reconnects = 0;
		let publishes = 0;
		conn.tkey = 'default';
		conn.password = 'pw';
		conn.fetch_in_progress = false;
		conn.next_fetch_ts = null;
		conn.terminated = false;
		conn.enabled_autofetch = true;
		conn.app = {
			db: {
				tournaments: {
					findOne_async: async () => ({ key: 'default', btp_enabled: true, last_reset_ts: 1 }),
				},
			},
		};
		conn.send = () => {};
		conn.publish_status = () => { publishes += 1; };
		conn.schedule_reconnect = () => {
			reconnects += 1;
			conn.fetch_in_progress = false;
			conn.publish_status();
		};

		try {
			const result = await conn.fetch(conn, true);

			assert.strictEqual(result, null);
			assert.strictEqual(conn.fetch_in_progress, false);
			assert.strictEqual(reconnects, 1);
			assert.strictEqual(statuses.length, 1);
			assert.strictEqual(statuses[0].status, 'error');
			assert.ok(statuses[0].message.includes('timed out'));
			assert.ok(publishes >= 2);
		} finally {
			if (old_value === undefined) {
				delete process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS;
			} else {
				process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS = old_value;
			}
		}
	});

	it('rejects a fetch response after BTP was disabled', async function() {
		const conn = {
			terminated: false,
			tkey: 'default',
			app: {
				db: {
					tournaments: {
						findOne_async: async () => ({ key: 'default', btp_enabled: false, last_reset_ts: 1 }),
					},
				},
			},
		};

		const state = await _fetch_response_state(conn, 1);

		assert.deepStrictEqual(state, { ok: false, reason: 'btp_disabled' });
	});

	it('rejects a fetch response when the tournament was reset during the request', async function() {
		const conn = {
			terminated: false,
			tkey: 'default',
			app: {
				db: {
					tournaments: {
						findOne_async: async () => ({ key: 'default', btp_enabled: true, last_reset_ts: 2 }),
					},
				},
			},
		};

		const state = await _fetch_response_state(conn, 1);

		assert.deepStrictEqual(state, { ok: false, reason: 'tournament_reset_during_fetch' });
	});

	it('accepts a fetch response when BTP stayed enabled and no reset happened', async function() {
		const conn = {
			terminated: false,
			tkey: 'default',
			app: {
				db: {
					tournaments: {
						findOne_async: async () => ({ key: 'default', btp_enabled: true, last_reset_ts: 1 }),
					},
				},
			},
		};

		const state = await _fetch_response_state(conn, 1);

		assert.deepStrictEqual(state, { ok: true, reason: 'current' });
	});
});
