'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const inspector = require('inspector');
const { promisify } = require('util');
const snapshot = require('./isolated_sync/snapshot');
const experiment = require('./isolated_sync/experiment');
const { sample_summary } = require('./live_drill_scenario');

const metrics = ['total_ms', 'dispatch_delay_ms', 'point_resource_wait_ms', 'point_context_ms', 'point_write_ms',
	'point_notification_ready_ms', 'admin_response_ready_ms', 'admin_response_serialize_ms',
	'announcement_ready_ms', 'announcement_serialize_ms', 'heartbeat_max_delay_ms'];

function summary(rows) {
	return { responses: Object.fromEntries(metrics.map(metric => [metric, sample_summary(rows.map(r => r[metric]).filter(Number.isFinite))])),
		append_in_flight_at_dispatch: rows.filter(r => r.append_in_flight_at_dispatch).length,
		stages: Object.fromEntries(['tournaments', 'matches'].map(collection => [collection, Object.fromEntries(
			['prepare', 'modify', 'serialize', 'update_indexes_and_canonical_model', 'persist'].map(operation => [operation, {
				per_run_sync_ms: sample_summary(rows.map(r => r.stages.filter(s => s.collection === collection && s.operation === operation).reduce((sum, s) => sum + (s.sync_ms || 0), 0))),
				calls_per_run: sample_summary(rows.map(r => r.stages.filter(s => s.collection === collection && s.operation === operation).length)),
			}]),
		)])),
	};
}

async function benchmark({ source = path.resolve(__dirname, '../data'), key = 'default', samples = 12, changes = 46, profile = true, warmups = 2 } = {}) {
	assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(changes) && changes > 0);
	assert(Number.isSafeInteger(warmups) && warmups >= 0);
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-isolated-sync-'));
	const overrides = { BTS_DEBUG_OUTPUT: '0', BTS_SCORE_PRESS_TIMING: '0', BTS_BTP_SYNC_TIMING: '0', BTS_OFFLOAD_TIMING: '0',
		BTS_TABLETOPERATOR_AUDIT: '0', BTS_UPDATE_QUEUE_SLOW_TASK_MS: '0', BTS_SYNC_BATCH_WRITES: '0',
		BTS_SYNC_PREPARED_TOURNAMENT: '0', BTS_ADMIN_RESPONSE_BACKGROUND: '0', BTS_ADMIN_RESPONSE_PRIORITY: '0', BTS_ADMIN_RESPONSE_ENCODER: 'cooperative' };
	const saved = Object.fromEntries(Object.keys(overrides).map(k => [k, process.env[k]]));
	Object.assign(process.env, overrides);
	try {
		const captured = await snapshot.capture(source, directory), now_ms = Date.now();
		const rows = { 'point-only': { individual: [], batch: [], idle: [] }, 'point-admin-announcement': { individual: [], batch: [], idle: [] } };
		const profiles = [];
		let pairs = 0;
		for (const workload of Object.keys(rows)) for (let i = -warmups; i < samples; i++) {
			const pair = {};
			for (const variant of i % 2 ? ['batch', 'individual'] : ['individual', 'batch']) {
				process.env.BTS_SYNC_BATCH_WRITES = variant === 'batch' ? '1' : '0';
				const replica_dir = path.join(directory, 'replica');
				const db = await snapshot.replica(captured, replica_dir);
				const session = profile && i === samples - 1 ? new inspector.Session() : null;
				let profiling = {}, stopped = false;
				if (session) {
					session.connect(); await promisify(session.post.bind(session))('Profiler.enable');
					profiling = {
						start: () => session.post('Profiler.start'),
						stop: async () => {
							const { profile: cpu } = await promisify(session.post.bind(session))('Profiler.stop'); stopped = true;
							const filename = path.join(directory, `${workload}-${variant}.cpuprofile`);
							await fs.writeFile(filename, JSON.stringify(cpu)); profiles.push(filename);
						},
					};
				}
				try {
					console.error(`${workload} ${i + 1}/${samples}: ${variant}`);
					pair[variant] = await experiment(db, key, changes, workload, now_ms, 'sync', profiling);
					assert.strictEqual(experiment.digest(await snapshot.reload(replica_dir)), pair[variant].final_digest, 'Reload differs from committed canonical documents.');
					if (i >= 0) rows[workload][variant].push(pair[variant]);
				} finally {
					if (session) {
						if (!stopped) await promisify(session.post.bind(session))('Profiler.stop');
						session.disconnect();
					}
					await fs.rm(replica_dir, { recursive: true, force: true });
				}
			}
			assert.strictEqual(pair.individual.final_digest, pair.batch.final_digest, 'Final persisted documents differ between variants.'); pairs++;
		}
		// Idle controls are separate: concurrent real admin work can dominate a
		// point even without a sync. Do not subtract quantiles between workloads.
		for (const workload of Object.keys(rows)) for (let i = -Math.min(warmups, 1); i < samples; i++) {
			const replica_dir = path.join(directory, 'replica');
			const db = await snapshot.replica(captured, replica_dir);
			try {
				console.error(`${workload} ${i + 1}/${samples}: no-sync control`);
				const row = await experiment(db, key, changes, workload, now_ms, 'idle'); if (i >= 0) rows[workload].idle.push(row);
			}
			finally { await fs.rm(replica_dir, { recursive: true, force: true }); }
		}
		await snapshot.unchanged(captured);
		const result = { stage: 'isolated_live_snapshot_sync_write_comparison', directory, snapshot: captured, now_ms, samples, changes, warmups,
			correctness_pairs: pairs, fixture: rows['point-only'].individual[0].fixture, profiles, rows,
			summary: Object.fromEntries(Object.entries(rows).map(([workload, variants]) => [workload, Object.fromEntries(Object.entries(variants).map(([variant, values]) => [variant, summary(values)]))])),
			limitations: [
				'Actual captured documents, real sync validation/resources/apply/publication and canonical hooks; deterministic synthetic profile edits, not a replay of the previous BTP response.',
				'Custom local planner is used to construct edits; total_ms includes planning on the main thread and is not comparable to production worker-planned sync totals. Live writer stages and request response timings are the comparison targets.',
				'Point uses real score model reads, resource locks, a durable temporary marker update and serialized admin score notification; it is not a full BUP point or measured TV rendering.',
				'Admin runs real tournament_get including QR, reads and response JSON; browser DOM/frame timings are not measured.',
				'Announcement runs real manual match announcement and serialized admin notification; match allocation, network, browser speech queue and audible start are not measured.',
				'Requests are scheduled at first match writer enqueue; dispatch delay includes synchronous work before the next check turn. Append-in-flight counts reveal whether each probe actually overlaps persistence.',
				'File copies/page cache and CPU profiling/instrumentation affect absolute numbers. Last measured pair per workload includes a CPU profile. Nested stage timings are not additive.',
				'CPU sampling starts at the first live writer function and ends after sync/probe responses; replica loading, private planning, final digest validation and reloads are excluded.',
			], validation: 'Every paired final document digest matches; all edits and point marker stored, canonical match identity retained; original source metadata and SHA-256 content unchanged. Only disposable replicas are opened by NeDB.',
		};
		await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n');
		return result;
	} finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

if (require.main === module) {
	Promise.resolve().then(async () => {
		const cli = require('./isolated_sync/options'), options = cli.parse(process.argv.slice(2));
		if (options.help) return console.log(cli.help);
		const result = await benchmark(options);
		console.log(JSON.stringify({ directory: result.directory, fixture: result.fixture, summary: result.summary }, null, 2));
	}).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { benchmark, summary };
