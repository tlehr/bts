'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const snapshot = require('./isolated_sync/snapshot');
const experiment = require('./isolated_sync/experiment');
const { summary } = require('./isolated_sync_benchmark');
const { sample_summary } = require('./live_drill_scenario');

async function benchmark({ source = path.resolve(__dirname, '../data'), key = 'default', samples = 12, changes = 46, warmups = 2, optimization = 'prepared-tournament', probe_delay_ms = optimization.startsWith('admin-response') ? 30 : 0, modes = ['marker', 'entries-array', 'idle'] } = {}) {
	assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(changes) && changes > 0);
	assert(Number.isSafeInteger(warmups) && warmups >= 0);
	assert(['prepared-tournament', 'admin-response', 'admin-response-cooperative', 'admin-response-priority'].includes(optimization));
	assert(Number.isSafeInteger(probe_delay_ms) && probe_delay_ms >= 0);
	assert(modes.length && modes.every(mode => ['marker', 'entries-array', 'idle'].includes(mode)));
	const admin_response = optimization.startsWith('admin-response');
	const variants = optimization === 'admin-response-priority' ? ['cooperative', 'priority'] : admin_response ? ['prepared', 'background'] : ['ordinary', 'prepared'];
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-isolated-transport-'));
	const overrides = { BTS_DEBUG_OUTPUT: '0', BTS_SCORE_PRESS_TIMING: '0', BTS_BTP_SYNC_TIMING: '0', BTS_OFFLOAD_TIMING: '0',
		BTS_TABLETOPERATOR_AUDIT: '0', BTS_UPDATE_QUEUE_SLOW_TASK_MS: '0', BTS_SYNC_BATCH_WRITES: '0', BTS_SYNC_PREPARED_TOURNAMENT: '0', BTS_ADMIN_RESPONSE_BACKGROUND: '0',
		BTS_ADMIN_RESPONSE_ENCODER: optimization === 'admin-response' ? 'worker' : 'cooperative' };
	overrides.BTS_ADMIN_RESPONSE_PRIORITY = '0';
	const saved = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
	Object.assign(process.env, overrides);
	try {
		const captured = await snapshot.capture(source, directory), now_ms = Date.now();
		const rows = Object.fromEntries(modes.map(mode => [mode, Object.fromEntries(variants.map(variant => [variant, []]))]));
		let pairs = 0;
		for (const mode of Object.keys(rows)) for (let i = -warmups; i < samples; i++) {
			const pair = {};
			for (const variant of i % 2 ? [...variants].reverse() : variants) {
				process.env.BTS_SYNC_PREPARED_TOURNAMENT = variant !== 'ordinary' ? '1' : '0';
				process.env.BTS_ADMIN_RESPONSE_BACKGROUND = variant === 'background' || optimization === 'admin-response-priority' ? '1' : '0';
				process.env.BTS_ADMIN_RESPONSE_PRIORITY = variant === 'priority' ? '1' : '0';
				const replica_dir = path.join(directory, 'replica');
				const db = await snapshot.replica(captured, replica_dir);
				try {
					const progress = i < 0 ? `warmup ${i + warmups + 1}/${warmups}` : `${i + 1}/${samples}`;
					console.error(`${mode} ${progress}: ${variant}`);
					pair[variant] = await experiment(db, key, changes, 'point-admin-announcement', now_ms,
						mode === 'idle' ? 'idle' : 'sync', {}, { defer_finished_history: true },
						{ transport: true, separate_receivers: admin_response, probe_delay_ms, arrival: 'first-live-write', tournament_change: mode });
					assert.strictEqual(experiment.digest(await snapshot.reload(replica_dir)), pair[variant].final_digest);
					if (i >= 0) rows[mode][variant].push(pair[variant]);
				} finally { await fs.rm(replica_dir, { recursive: true, force: true }); }
			}
			assert.strictEqual(pair[variants[0]].final_digest, pair[variants[1]].final_digest, 'Prepared writes changed persisted documents.'); pairs++;
		}
		await snapshot.unchanged(captured);
		const result = { stage: admin_response ? `isolated_${optimization.replaceAll('-', '_')}_websocket_receive` : 'isolated_prepared_tournament_websocket_receive', optimization, probe_delay_ms, directory, snapshot: captured, samples, changes, warmups, now_ms,
			correctness_pairs: pairs, fixture: rows[modes[0]][variants[0]][0].fixture, rows,
			summary: Object.fromEntries(Object.entries(rows).map(([mode, variants]) => [mode,
				Object.fromEntries(Object.entries(variants).map(([variant, values]) => [variant, { ...summary(values),
					reception: Object.fromEntries(['point', 'admin', 'announcement'].flatMap(kind => ['received_ms', 'request_to_receive_ms']
						.map(suffix => kind + '_' + suffix)).map(metric => [metric, sample_summary(values.map(row => row[metric]))])),
				}]))])),
			limitations: [
				'Actual captured tournament on identical disposable replicas, single sync writes and deferred finished histories in both variants. Deterministic synthetic 46 match-profile edits plus tournament metadata or registration-array edit.',
				'Point uses real resource locks, model score context reads, a durable marker write and real WebSocket score notification, not full BUP scoring. Announcement uses the real manual handler, not match allocation.',
				admin_response ? 'Three separate receiver processes/connections for point, admin and announcement; snapshot and later updates retain ordering on the admin socket. Admin encoding duration includes background queue/yields/transport rather than main-thread JSON CPU.' : 'One receiver connection for all three concurrent requests.',
				`Point and announcement requests delayed by ${probe_delay_ms} ms after receiver activation, timestamped at actual send. A fixed overlap probe, not all possible arrival offsets.`,
				'Receiver is a separate Node process over uncompressed localhost WebSockets. Timestamps at message callback entry before application JSON parsing; network transmission and frame decoding included, browser/UI/speech excluded.',
				'Nominal arrival is at first live writer enqueue including tournaments; received_ms includes receiver IPC launch signal, request_to_receive_ms begins at the actual client send. These timings cannot be compared to old first-match-write/no-socket probes.',
				'Private planning is on the main thread, not the production planner worker; heartbeat spans planning too. Local samples, page caching and instrumentation do not establish production p99 or real LAN latency.',
			], validation: 'Paired committed document digests match each other and NeDB reloads; canonical match identity and point marker retained. Three actual client messages validated in each sample. Original source SHA-256 and metadata unchanged.',
		};
		await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n');
		return result;
	} finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

if (require.main === module) Promise.resolve().then(async () => {
	const cli = require('./isolated_sync/options'), args = process.argv.slice(2);
	let optimization = 'prepared-tournament';
	const index = args.indexOf('--optimization');
	if (index >= 0) { optimization = args[index + 1]; args.splice(index, 2); }
	const options = { ...cli.parse(args), optimization };
	if (options.help) return console.log('Compare actual WebSocket reception. --optimization prepared-tournament (default), admin-response (worker), admin-response-cooperative or admin-response-priority. No CPU profile.\n' + cli.help.replace('debug:isolated-sync', 'debug:isolated-transport'));
	const result = await benchmark(options);
	console.log(JSON.stringify({ directory: result.directory, fixture: result.fixture, summary: result.summary }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { benchmark };
