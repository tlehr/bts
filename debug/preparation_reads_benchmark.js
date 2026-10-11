'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const status = require('../bts/preparation_selection/status');
const probe = require('../bts/timing/event_loop_probe');
const { sample_summary } = require('./live_drill_scenario');

// Synthetic in-memory data only: never opens the live tournament or starts BTS.
async function benchmark(samples = 20) {
	const flags = ['BTS_PREPARATION_MODEL_READS', 'BTS_OFFLOAD_TIMING', 'BTS_BTP_SYNC_TIMING', 'BTS_SCORE_PRESS_TIMING'];
	const saved = Object.fromEntries(flags.map(flag => [flag, process.env[flag]]));
	try {
		for (const flag of flags) process.env[flag] = '0';
		const db = await database.init_test(), key = 'synthetic-preparation';
		const insert = (collection, doc) => promisify(db[collection].insert.bind(db[collection]))(doc);
		const tournament = await insert('tournaments', { key });
		await insert('locations', { _id: 'hall', tournament_key: key, name: 'Hall' });
		await insert('courts', Array.from({ length: 13 }, (_, i) => ({ _id: 'court-' + i,
			tournament_key: key, location_id: 'hall', is_active: true })));
		await insert('matches', Array.from({ length: 519 }, (_, i) => ({ _id: 'match-' + i, tournament_key: key,
			presses: Array.from({ length: 180 }, (_, press) => ({ type: 'score', team1: press % 2 === 0, timestamp: press * 5000 })),
			network_score: [[21, 19], [13, 11]],
			setup: { state: i < 13 ? 'preparation' : 'scheduled', location_id: 'hall', match_num: i + 1,
				teams: [{ players: [{ btp_id: i * 2 + 1, name: 'A' }] }, { players: [{ btp_id: i * 2 + 2, name: 'B' }] }] } })));
		const app = { db }, rows = { database: [], object_model: [] };
		for (let sample = -3; sample < samples; sample++) {
			for (const model_reads of sample % 2 ? [true, false] : [false, true]) {
				process.env.BTS_PREPARATION_MODEL_READS = model_reads ? '1' : '0';
				await new Promise(resolve => setImmediate(resolve));
				const heartbeat = probe(), began = process.hrtime.bigint();
				const result = await status.inspect(app, tournament);
				const duration_ms = Number(process.hrtime.bigint() - began) / 1e6;
				const event_loop = heartbeat.stop();
				assert.deepStrictEqual(result.runnable_locations, []);
				assert.deepStrictEqual(result.locations.map(location => location._id), ['hall']);
				assert.strictEqual(result.read_source, model_reads ? 'object_model' : 'database');
				if (sample >= 0) rows[result.read_source].push({ duration_ms, ...event_loop });
			}
		}
		return { operation: 'automatic_preparation_status', storage: 'memory', matches: 519, courts: 13,
			presses_per_match: 180, samples_per_variant: samples, warmup_per_variant: 3, diagnostics: false,
			validation: 'Both variants skip correctly when preparation is sufficient; write visibility and real call semantics covered by tests.',
			limitations: 'Synthetic status precheck only; excludes candidate selection, actual calls, resource-lock waiting, file I/O and live TV latency. Alternating order; no promise of the same live speedup.',
			variants: Object.fromEntries(Object.entries(rows).map(([source, values]) => [source, {
				duration_ms: sample_summary(values.map(row => row.duration_ms)),
				event_loop_timer_max_delay_ms: sample_summary(values.map(row => row.event_loop_timer_max_delay_ms)),
			}])) };
	} finally {
		for (const [flag, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[flag]; else process.env[flag] = value;
		}
	}
}

if (require.main === module) benchmark().then(result => console.log(JSON.stringify(result, null, 2)))
	.catch(error => { console.error(error); process.exitCode = 1; });
module.exports = benchmark;
