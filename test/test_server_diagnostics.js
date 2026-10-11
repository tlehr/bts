'use strict';

const assert = require('assert');
const { promisify } = require('util');
const Datastore = require('nedb');
const diagnostics = require('../bts/server_diagnostics');
const database = require('../bts/database');
const admin = require('../bts/admin');
const audit = require('../bts/tabletoperator_audit');
const { ResourceLockQueue } = require('../bts/resource_lock_queue');

let sequence = 0;
const insert = (store, doc) => promisify(store.insert.bind(store))(doc);
const env_keys = ['BTS_SERVER_DIAGNOSTICS', 'BTS_TABLETOPERATOR_AUDIT', 'BTS_BTP_SYNC_TIMING',
	'BTS_SCORE_PRESS_TIMING', 'BTS_UPDATE_QUEUE_SLOW_TASK_MS', 'BTS_DEBUG_OUTPUT', 'BTS_AUTO_CALL_TRACE'];

describe('quiet server and optional detailed diagnostics', function() {
	let key, env, warn, log, messages;
	beforeEach(function() {
		key = 'diagnostics-' + ++sequence;
		env = Object.fromEntries(env_keys.map(name => [name, process.env[name]]));
		for (const name of env_keys) delete process.env[name];
		warn = console.warn; log = console.log; messages = [];
		console.warn = console.log = (...args) => messages.push(args);
	});
	afterEach(function() {
		diagnostics.remove({ key }); diagnostics.remove({ key: key + '-other' });
		console.warn = warn; console.log = log;
		for (const [name, value] of Object.entries(env)) {
			if (value === undefined) delete process.env[name]; else process.env[name] = value;
		}
	});
	async function fixture() {
		const db = await database.init_test();
		await insert(db.tournaments, { key, btp_enabled: false, displaysettings_general: 'display', displaysettings_general_tablet: 'tablet' });
		return { db };
	}
	function edit(app, value, bulk = false) {
		return new Promise((resolve, reject) => {
			const ws = { respond: (_msg, error) => error ? reject(error) : resolve() };
			if (bulk) admin.handle_tournament_edit_props(app, ws, { key, props: { bts_server_diagnostics_enabled: value } });
			else admin.handle_tournament_edit_prop(app, ws, { key, field: 'bts_server_diagnostics_enabled', value });
		});
	}
	function slow(queue) {
		queue._log_slow_task({ id: 1, task: 'test', wait_ms: 2000, runtime_ms: 2000, wait_blocked_by: [] });
	}
	it('does not log ordinary tablet operator writes, slow queue tasks or startup messages by default', async function() {
		const app = await fixture();
		await insert(app.db.tabletoperators, { tournament_key: key, match_id: 'match', tabletoperator: [{ name: 'Player' }] });
		slow(new ResourceLockQueue());
		diagnostics.log(app, key, 'HTTPS server listening');
		assert.strictEqual(audit.enabled(key), false);
		assert.strictEqual(diagnostics.sync_timing_enabled(key), false);
		assert.deepStrictEqual(messages, []);
	});
	it('supports both admin save APIs and immediately stops audit and queue output when unchecked', async function() {
		const app = await fixture();
		const write = () => insert(app.db.tabletoperators, { tournament_key: key, match_id: 'match' });
		await edit(app, true);
		assert.strictEqual((await app.db.tournaments.findOne_async({ key })).bts_server_diagnostics_enabled, true);
		await write(); slow(new ResourceLockQueue());
		assert(messages.some(row => row[0] === '[bts] tabletoperator_audit:insert' && JSON.parse(row[1]).stack.length));
		assert(messages.some(row => row[0].startsWith('[bts] update_queue:slow_task')));
		await edit(app, false, true); messages.length = 0;
		await write(); slow(new ResourceLockQueue());
		assert.strictEqual(diagnostics.enabled(app, key), false);
		assert.deepStrictEqual(messages, []);
	});
	it('keeps per-tournament diagnostics separate and removes deleted or renamed tournament settings', async function() {
		const app = await fixture();
		await insert(app.db.tournaments, { key: key + '-other' });
		await app.db.tournaments.update_async({ key }, { $set: { bts_server_diagnostics_enabled: true } }, {});
		assert.strictEqual(diagnostics.enabled(null, key), true);
		assert.strictEqual(diagnostics.enabled(null, key + '-other'), false);
		await insert(app.db.tabletoperators, { tournament_key: key + '-other' });
		assert.deepStrictEqual(messages, []);
		await app.db.tournaments.remove_async({ key: key + '-other' }, {});
		await app.db.tournaments.update_async({ key }, { $set: { key: key + '-other' } }, {});
		assert.strictEqual(diagnostics.enabled(null, key), false);
		assert.strictEqual(diagnostics.enabled(null, key + '-other'), true);
		await app.db.tournaments.remove_async({ key: key + '-other' }, {});
		assert.strictEqual(diagnostics.enabled(), false);
	});
	it('loads saved settings before the first admin request and restores settings on index reset', async function() {
		const tournaments = new Datastore();
		await insert(tournaments, { _id: 'saved', key, bts_server_diagnostics_enabled: true });
		require('../bts/tournament_model').attach({ tournaments });
		assert.strictEqual(diagnostics.enabled(null, key), true);
		tournaments.resetIndexes([{ _id: 'saved', key, bts_server_diagnostics_enabled: false }]);
		assert.strictEqual(diagnostics.enabled(null, key), false);
	});
	it('preserves explicit environment overrides without enabling audit by default', function() {
		diagnostics.set_from_tournament({ key, bts_server_diagnostics_enabled: true });
		process.env.BTS_SERVER_DIAGNOSTICS = '0';
		assert.strictEqual(diagnostics.enabled(null, key), false);
		process.env.BTS_TABLETOPERATOR_AUDIT = '1';
		assert.strictEqual(audit.enabled(key), true);
		process.env.BTS_TABLETOPERATOR_AUDIT = '0'; process.env.BTS_SERVER_DIAGNOSTICS = '1';
		assert.strictEqual(audit.enabled(key), false);
		assert.strictEqual(diagnostics.enabled(null, key + '-other'), true);
		process.env.BTS_BTP_SYNC_TIMING = '0';
		assert.strictEqual(diagnostics.sync_timing_enabled(key), false);
		process.env.BTS_BTP_SYNC_TIMING = '1'; process.env.BTS_SERVER_DIAGNOSTICS = '0';
		assert.strictEqual(diagnostics.sync_timing_enabled(key), true);
	});
	it('enables decoder measurements through the live setting and stops them again', function() {
		const decode_timing = require('../bts/timing/btp_decode');
		assert.strictEqual(decode_timing({ tournament_key: key }, 10), null);
		diagnostics.set_from_tournament({ key, bts_server_diagnostics_enabled: true });
		const probe = decode_timing({ tournament_key: key }, 10);
		assert(probe);
		probe.finish(null);
		assert(messages.some(row => row[0].startsWith('[bts] btp_fetch:response_decode')));
		diagnostics.set_from_tournament({ key, bts_server_diagnostics_enabled: false });
		assert.strictEqual(decode_timing({ tournament_key: key }, 10), null);
	});
	it('keeps unchanged and slow successful syncs quiet while retaining opt-in measurements', async function() {
		const { BTPConn } = require('../bts/btp_conn');
		const sync = require('../bts/btp_sync'), utils = require('../bts/match_utils');
		const original = [sync.sync_btp_data, utils.queue_auto_execute_preparation_selections, utils.queue_auto_call_matches_on_free_courts];
		let outcome, ts = 0;
		const conn = Object.assign(Object.create(BTPConn.prototype), { tkey: key, terminated: false,
			app: { clock: { real_now_ms: () => { ts += 2000; return ts; }, now_ms: () => ts },
				db: { tournaments: { findOne_async: async () => ({ btp_enabled: true, last_reset_ts: 1 }) } } },
			_fetch_response: async () => ({ response: { Result: [{ Tournament: [{}] }] }, fetch_reset_ts: 1 }) });
		sync.sync_btp_data = async () => outcome;
		utils.queue_auto_execute_preparation_selections = utils.queue_auto_call_matches_on_free_courts = (_app, _key, cb) => cb();
		try {
			for (outcome of [true, { skipped: true, reason: 'no_sync_changes' }]) {
				await conn._fetch_once(); assert.deepStrictEqual(messages, []);
			}
			diagnostics.set_from_tournament({ key, bts_server_diagnostics_enabled: true });
			outcome = true; await conn._fetch_once();
			assert(messages.some(row => row[0].startsWith('[bts] btp_fetch:complete')));
			outcome = { skipped: true, reason: 'no_sync_changes' }; await conn._fetch_once();
			assert(messages.some(row => row[0].startsWith('[bts] btp_fetch:sync_skipped')));
		} finally {
			[sync.sync_btp_data, utils.queue_auto_execute_preparation_selections, utils.queue_auto_call_matches_on_free_courts] = original;
		}
	});
	it('collects slow render acknowledgements silently and always reports an actual render failure', function() {
		const bup = require('../bts/bupws_v2');
		const ws = { last_tournament_key: key, app: {}, v2_render_responsive: true, v2_admin_online: true,
			v2_admin_status_notify_ts: Date.now(), v2_pending_render_acks: new Map() };
		function ack(ok = true) {
			ws.v2_pending_render_acks.set('ack', { message_id: 'ack', sent_ts: Date.now() - 2000, payload_meta: { type: 'court_picker_state' } });
			bup.handle_display_rendered(ws.app, ws, { message_id: 'ack', ok, render_ms: 2000, error: ok ? null : 'render failed' });
		}
		ack(); assert.strictEqual(ws.v2_render_ack_samples.length, 1); assert.deepStrictEqual(messages, []);
		diagnostics.set_from_tournament({ key, bts_server_diagnostics_enabled: true });
		ack(); assert(messages.some(row => row[0] === '[bup v2] render ack slow'));
		diagnostics.set_from_tournament({ key, bts_server_diagnostics_enabled: false }); messages.length = 0;
		ack(false); assert.strictEqual(messages.length, 1); assert.strictEqual(messages[0][0], '[bup v2] render ack reported failure');
	});
});
