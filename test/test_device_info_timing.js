'use strict';

const assert = require('assert');
const database = require('../bts/database');
const bup = require('../bts/bupws_v2');

describe('device info subphase timing', function() {
	async function fixture() {
		const db = await database.init_test();
		await new Promise((resolve, reject) => db.tournaments.insert({ key: 'device-test', bupws_v2_enabled: true },
			error => error ? reject(error) : resolve()));
		return { app: { db }, ws: { client_id: 'device-tablet', hostname: 'known-host', court_id: 'court-1', panel_devicemode: 'umpire' } };
	}
	it('records hostname, settings read, tournament read, insertion and notification for a new device', async function() {
		const { app, ws } = await fixture(), rows = [];
		await bup.handle_device_info(app, ws, { tournament_key: 'device-test', device: { battery: 78 } },
			{ score_phase(...args) { rows.push(args); } });
		assert.deepStrictEqual(rows.map(row => row[0]), ['device_info_hostname', 'device_info_settings_read',
			'device_info_tournament_read', 'device_info_settings_insert', 'device_info_notify']);
		assert.strictEqual(rows[0][2].hostname_cached, true);
		assert.strictEqual(ws.battery, 78);
		const setting = await app.db.display_court_displaysettings.findOne_async({ client_id: ws.client_id });
		assert.strictEqual(setting.hostname, 'known-host');
		assert.strictEqual(setting.court_id, 'court-1');
		assert.strictEqual(setting.panel_devicemode, 'umpire');
	});
	it('updates a changed hostname and keeps unchanged settings out of the write path', async function() {
		const { app, ws } = await fixture();
		const send = options => bup.handle_device_info(app, ws, { tournament_key: 'device-test', device: { battery: 44 } }, options);
		await send();
		ws.hostname = 'changed-host';
		const changed = [];
		await send({ score_phase(...args) { changed.push(args); } });
		assert(changed.some(row => row[0] === 'device_info_settings_update'));
		assert.strictEqual((await app.db.display_court_displaysettings.findOne_async({ client_id: ws.client_id })).hostname, 'changed-host');
		const unchanged = [];
		await send({ score_phase(...args) { unchanged.push(args); } });
		assert.deepStrictEqual(unchanged.map(row => row[0]), ['device_info_hostname', 'device_info_settings_read', 'device_info_notify']);
	});
	it('waits for hostname resolution and preserves read errors with the failed subphase', async function() {
		const { app, ws } = await fixture(), rows = [];
		let release;
		ws.hostname = new Promise(resolve => { release = resolve; });
		const failure = new Error('device settings unavailable');
		app.db.display_court_displaysettings.findOne_async = async () => { throw failure; };
		let completed = false;
		const operation = bup.handle_device_info(app, ws, { tournament_key: 'device-test', device: {} },
			{ score_phase(...args) { rows.push(args); } }).finally(() => { completed = true; });
		const rejected = assert.rejects(operation, error => error === failure);
		await new Promise(resolve => setImmediate(resolve)); assert.strictEqual(completed, false);
		release('resolved-host'); await rejected;
		assert.strictEqual(rows.find(row => row[0] === 'device_info_settings_read')[2].error, failure.message);
		assert(!rows.some(row => row[0] === 'device_info_notify'));
	});
	it('publishes subphases with the score trace and numeric durations through the real score handler', async function() {
		const { app, ws } = await fixture();
		await new Promise((resolve, reject) => app.db.courts.insert({ _id: 'court-1', tournament_key: 'device-test', match_id: 'device-match' },
			error => error ? reject(error) : resolve()));
		await new Promise((resolve, reject) => app.db.matches.insert({ _id: 'device-match', tournament_key: 'device-test', network_score: [[0, 0]],
			setup: { match_id: 'device-match', court_id: 'court-1', now_on_court: true, state: 'oncourt', counting: '3x21',
				teams: [{ players: [] }, { players: [] }] } }, error => error ? reject(error) : resolve()));
		ws.readyState = 1; ws.messages = [];
		ws.send = raw => ws.messages.push(JSON.parse(raw));
		ws.sendmsg = value => ws.messages.push(value);
		bup.on_connect(app, ws);
		ws.panel_devicemode = 'umpire';
		ws.last_tournament_key = 'device-test'; ws.last_v2_match_id = 'device-match';
		const flags = ['BTS_SCORE_PRESS_TIMING', 'BTS_SCORE_PHASE_TIMING_MS', 'BTS_DEVICE_INFO_BACKGROUND'];
		const previous = flags.map(key => process.env[key]);
		const original_log = console.log, rows = [];
		try {
			process.env.BTS_SCORE_PRESS_TIMING = '1'; process.env.BTS_SCORE_PHASE_TIMING_MS = '0';
			process.env.BTS_DEVICE_INFO_BACKGROUND = '0';
			console.log = value => {
				const prefix = '[bts] score_press_timing:score_phase ';
				if (typeof value === 'string' && value.startsWith(prefix)) rows.push(JSON.parse(value.slice(prefix.length)));
			};
			await bup.handle_score_update(app, ws, { tournament_key: 'device-test', score: {
				match_id: 'device-match', court_id: 'court-1', network_score: [[1, 0]], presses: [],
				device: { battery: 66 }, debug_trace_id: 'device-subphase-test',
			} });
			const subphases = rows.filter(row => ['device_info_hostname', 'device_info_settings_read', 'device_info_notify'].includes(row.phase));
			assert.strictEqual(subphases.length, 3);
			assert(subphases.every(row => row.trace_id === 'device-subphase-test' && typeof row.duration_ms === 'number'));
			assert(subphases.every(row => !Object.hasOwn(row, 'timing_end_ns')));
			assert.strictEqual(ws.battery, 66);
			assert(!ws.messages.some(value => value.type === 'error'));
		} finally {
			console.log = original_log;
			flags.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
			ws.readyState = 3;
			bup.on_close(app, ws);
		}
	});
});
