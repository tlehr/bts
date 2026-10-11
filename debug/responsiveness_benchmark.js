'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const automation = require('../bts/match_automation');
const batch = require('../bts/btp_planner/batch_writes');
const compaction = require('../bts/compaction_worker');
const staged = require('../bts/compaction_worker/staged');
const { sample_summary } = require('./live_drill_scenario');
const elapsed = began => Number(process.hrtime.bigint() - began) / 1e6;
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
	return {
		key: 'synthetic', call_preparation_matches_automatically_enabled: true, official_rotation_mode: 'disabled',
		preparation_call_participant_readiness_mode: 'checked_in', call_on_court_participant_readiness_mode: 'checked_in',
		courts: Array.from({ length: 13 }, (_, i) => ({ _id: 'court-' + i, location_id: 'hall', is_active: true })),
		matches: Array.from({ length: 519 }, (_, i) => ({ _id: 'match-' + i, tournament_key: 'synthetic',
			presses: Array.from({ length: 180 }, (_, press) => ({ type: 'score', team1: press % 2 === 0, timestamp: press * 5000 })),
			network_score: [[21, 19], [13, 11]],
			setup: { state: i < 213 ? 'finished' : i < 219 ? 'preparation' : 'scheduled', is_match: true, incomplete: false,
				location_id: 'hall', match_num: i + 1, scheduled_date: '2026-10-11', scheduled_time_str: '10:00',
				teams: [{ players: [{ btp_id: i * 2 + 1, name: 'A' + i, checked_in: i < 226 }] },
					{ players: [{ btp_id: i * 2 + 2, name: 'B' + i, checked_in: i < 226 }] }],
			},
		})),
		locations: [{ _id: 'hall', name: 'Hall' }], umpires: [], tabletoperators: [], btp_settings: {},
	};
}

async function benchmark(samples = 10, progress = () => {}) {
	const flags = ['BTS_COMPACTION_WORKER', 'BTS_COMPACTION_STAGED', 'BTS_OFFLOAD_TIMING', 'BTS_BTP_SYNC_TIMING', 'BTS_SCORE_PRESS_TIMING'];
	const saved = Object.fromEntries(flags.map(flag => [flag, process.env[flag]]));
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-responsive-synthetic-'));
	try {
		for (const flag of flags) process.env[flag] = '0';
		const tournament = fixture();
		const selection = { full: [], automatic: [] };
		for (let sample = -3; sample < samples; sample++) {
			progress('candidate sample ' + sample);
			let expected;
			for (const automatic_only of sample % 2 ? [true, false] : [false, true]) {
				const began = process.hrtime.bigint();
				const result = automation.calculate_location_preparation_selection(tournament, 'hall', { now_ts: 1791716400000, automatic_only });
				const duration = elapsed(began);
				const ids = result.auto_selected_matches.map(match => match._id);
				if (expected) assert.deepStrictEqual(ids, expected); else expected = ids;
				assert.strictEqual(ids.length, 7);
				if (sample >= 0) selection[automatic_only ? 'automatic' : 'full'].push(duration);
			}
			await turn();
		}
		const store = new Datastore({ filename: path.join(directory, 'matches') });
		await promisify(store.loadDatabase.bind(store))();
		await promisify(store.insert.bind(store))(tournament.matches);
		const writes = { individual: [], batch: [] }, appends = { individual: [], batch: [] };
		let append_count = 0;
		const persist = store.persistence.persistNewState;
		store.persistence.persistNewState = function(...args) { append_count++; return persist.apply(this, args); };
		const update = promisify(store.update.bind(store));
		for (let sample = -3; sample < samples; sample++) {
			progress('write sample ' + sample);
			for (const batched of sample % 2 ? [true, false] : [false, true]) {
				const docs = store.getAllData().slice(0, 46);
				const changes = docs.map(doc => ({ collection: 'matches', id: doc._id, before: doc, after: {}, update: { $set: { marker: sample } } }));
				append_count = 0;
				const began = process.hrtime.bigint();
				if (batched) await batch.write(store, changes, change => ({ _id: change.id, tournament_key: 'synthetic' }));
				else for (const change of changes) await update({ _id: change.id }, change.update, {});
				const duration = elapsed(began);
				assert.strictEqual(append_count, batched ? 1 : 46);
				assert(docs.every(doc => store.indexes._id.getMatching(doc._id)[0].marker === sample));
				if (sample >= 0) { const label = batched ? 'batch' : 'individual'; writes[label].push(duration); appends[label].push(append_count); }
			}
		}
		process.env.BTS_COMPACTION_WORKER = '1'; process.env.BTS_COMPACTION_STAGED = '1';
		compaction.attach(store, 'matches', { identity_serialization: true });
		const compactions = { original: [], staged: [] };
		for (let sample = -1; sample < samples; sample++) {
			progress('compaction sample ' + sample);
			for (const background of sample % 2 ? [true, false] : [false, true]) {
				const began = process.hrtime.bigint();
				const compacting = background ? staged.run(store, 'matches') : new Promise((resolve, reject) => store.executor.push({
					this: store.persistence, fn: store.persistence.persistCachedDatabase,
					arguments: [error => error ? reject(error) : resolve()],
				}));
				const point_start = process.hrtime.bigint();
				await update({ _id: 'match-0' }, { $inc: { synthetic_points: 1 } }, {});
				const point_write_ms = elapsed(point_start);
				await compacting;
				if (sample >= 0) compactions[background ? 'staged' : 'original'].push({ duration_ms: elapsed(began), point_write_ms });
			}
		}
		const reloaded = new Datastore({ filename: store.filename });
		await promisify(reloaded.loadDatabase.bind(reloaded))();
		assert.deepStrictEqual(await promisify(reloaded.find.bind(reloaded))({}), await promisify(store.find.bind(store))({}));
		return {
			operation: 'three_responsiveness_optimizations', samples_per_variant: samples, matches: 519, courts: 13, presses_per_match: 180,
			selection_fixture: { finished_matches: 213, prepared_matches: 6, ready_scheduled_matches: 7, remaining_unchecked: 293 },
			candidate_calculation_ms: Object.fromEntries(Object.entries(selection).map(([key, values]) => [key, sample_summary(values)])),
			sync_writes_46_changes_ms: Object.fromEntries(Object.entries(writes).map(([key, values]) => [key, sample_summary(values)])),
			sync_append_counts: appends,
			compaction: Object.fromEntries(Object.entries(compactions).map(([key, values]) => [key, {
				duration_ms: sample_summary(values.map(row => row.duration_ms)), point_write_ms: sample_summary(values.map(row => row.point_write_ms)),
			} ])),
			validation: 'Identical candidate IDs, all 46 changes stored, 46 versus 1 append, final Date/history/point state identical after reload.',
			limitations: 'Synthetic data and temporary files on this filesystem; excludes real resource locks, networking and TV rendering. File-cache/worker warmup and tournament progress affect live results. Point starts immediately after enqueueing compaction, rather than at a fixed real-file I/O phase. No artificial disk delay.',
		};
	} finally {
		compaction.client.close(); fs.rmSync(directory, { recursive: true, force: true });
		for (const [flag, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[flag]; else process.env[flag] = value;
		}
	}
}

if (require.main === module) benchmark(10, message => console.error(message)).then(result => console.log(JSON.stringify(result, null, 2)))
	.catch(error => { console.error(error); process.exitCode = 1; });
module.exports = benchmark;
