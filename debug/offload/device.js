'use strict';

const assert = require('assert');
const { performance } = require('perf_hooks');
const database = require('../../bts/database');
const bup = require('../../bts/bupws_v2');
const queue = require('../../bts/device_info/background');
const { pairs } = require('./measure');

module.exports = async function(samples, records) {
	const prepare = async mode => {
		process.env.BTS_DEVICE_INFO_BACKGROUND = mode === 'alternative' ? '1' : '0';
		const db = await database.init_test(), app = { db };
		const insert = (store, doc) => new Promise((resolve, reject) => store.insert(doc, err => err ? reject(err) : resolve()));
		await insert(db.tournaments, { key: 'offline', bupws_v2_enabled: true });
		await insert(db.courts, { _id: 'court', tournament_key: 'offline', match_id: 'match' });
		await insert(db.matches, { _id: 'match', tournament_key: 'offline', network_score: [[0, 0]], setup: {
			match_id: 'match', court_id: 'court', now_on_court: true, state: 'oncourt', counting: '3x21', teams: [{ players: [] }, { players: [] }],
		} });
		const ws = { readyState: 1, client_id: 'offline-tablet', court_id: 'court', hostname: 'known', send() {}, sendmsg() {} };
		bup.on_connect(app, ws); ws.panel_devicemode = 'umpire'; ws.last_tournament_key = 'offline'; ws.last_v2_match_id = 'match';
		return { app, db, ws };
	};
	const run = async (mode, iteration, { app, db, ws }) => {
		const start = performance.now();
		ws.hostname = new Promise(resolve => setTimeout(() => resolve('resolved-host'), 100));
		try {
			await bup.handle_score_update(app, ws, { tournament_key: 'offline', score: {
				match_id: 'match', court_id: 'court', network_score: [[1, 0]], presses: [], device: { battery: 50 }, debug_trace_id: 'offline-' + iteration,
			} });
			const score_ack_ms = Math.round((performance.now() - start) * 10) / 10;
			await queue.idle(db, ws.client_id);
			const metadata_complete_ms = Math.round((performance.now() - start) * 10) / 10;
			return { score_ack_ms, metadata_complete_ms, score: (await db.matches.findOne_async({ _id: 'match' })).network_score, battery: ws.battery };
		} finally { ws.readyState = 3; bup.on_close(app, ws); }
	};
	const measurements = [];
	const result = await pairs(samples, async (mode, i, prepared) => {
		const value = await run(mode, i, prepared); measurements.push({ mode, ...value }); return value;
	}, (a, b) => { assert.deepStrictEqual(a.score, b.score); assert.strictEqual(a.battery, b.battery); }, records, prepare);
	return { scope: 'Real score handler with synthetic 100-ms asynchronous hostname delay; elapsed includes score and metadata completion, excludes fixture. Compare score_ack_ms separately. No extra thread.',
		input: { artificial_hostname_delay_ms: 100 }, score_measurements: measurements, ...result };
};
