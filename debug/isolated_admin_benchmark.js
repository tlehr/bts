'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const snapshot = require('./isolated_sync/snapshot');
const experiment = require('./isolated_sync/experiment');
const { summary } = require('./isolated_sync_benchmark');

// Compare only the admin reload protocol. Batch writes stay disabled in both
// variants. Every sample uses the same frozen source in a fresh disposable DB.
async function benchmark({ source = path.resolve(__dirname, '../data'), key = 'default', samples = 12, changes = 46, warmups = 2 } = {}) {
	assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(changes) && changes > 0);
	assert(Number.isSafeInteger(warmups) && warmups >= 0);
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-isolated-admin-'));
	const overrides = { BTS_DEBUG_OUTPUT: '0', BTS_SCORE_PRESS_TIMING: '0', BTS_BTP_SYNC_TIMING: '0', BTS_OFFLOAD_TIMING: '0',
		BTS_TABLETOPERATOR_AUDIT: '0', BTS_UPDATE_QUEUE_SLOW_TASK_MS: '0', BTS_SYNC_BATCH_WRITES: '0',
		BTS_SYNC_PREPARED_TOURNAMENT: '0', BTS_ADMIN_RESPONSE_BACKGROUND: '0', BTS_ADMIN_RESPONSE_PRIORITY: '0', BTS_ADMIN_RESPONSE_ENCODER: 'cooperative' };
	const saved = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
	Object.assign(process.env, overrides);
	try {
		const captured = await snapshot.capture(source, directory), now_ms = Date.now();
		const rows = { sync: { full: [], deferred: [] }, idle: { full: [], deferred: [] } };
		let pairs = 0;
		for (const mode of Object.keys(rows)) for (let i = -warmups; i < samples; i++) {
			const pair = {};
			for (const variant of i % 2 ? ['deferred', 'full'] : ['full', 'deferred']) {
				const replica_dir = path.join(directory, 'replica');
				const db = await snapshot.replica(captured, replica_dir);
				try {
					const progress = i < 0 ? `warmup ${i + warmups + 1}/${warmups}` : `${i + 1}/${samples}`;
					console.error(`${mode} ${progress}: ${variant}`);
					pair[variant] = await experiment(db, key, changes, 'point-admin-announcement', now_ms, mode, {},
						{ defer_finished_history: variant === 'deferred' });
					assert.strictEqual(experiment.digest(await snapshot.reload(replica_dir)), pair[variant].final_digest);
					if (i >= 0) rows[mode][variant].push(pair[variant]);
				} finally { await fs.rm(replica_dir, { recursive: true, force: true }); }
			}
			assert.strictEqual(pair.full.final_digest, pair.deferred.final_digest, 'Admin protocol changed persisted documents.');
			pairs++;
		}
		await snapshot.unchanged(captured);
		const result = { stage: 'isolated_admin_deferred_finished_history', directory, snapshot: captured, samples, changes, warmups, now_ms,
			correctness_pairs: pairs, fixture: rows.sync.full[0].fixture, rows,
			summary: Object.fromEntries(Object.entries(rows).map(([mode, variants]) => [mode,
				Object.fromEntries(Object.entries(variants).map(([variant, values]) => [variant, summary(values)]))])),
			limitations: [
				'Captured real tournament, deterministic synthetic sync edits and real admin reload/announcement handlers. Every pair starts from identical data. Both variants use single sync writes.',
				'Point uses real resource locks, model context reads, a durable marker write and admin notification, not full BUP scoring or TV rendering.',
				'Announcement measures server event readiness; browser speech, actual audio start and match allocation are not measured.',
				'Admin readiness includes response serialization/byte count. Network, browser parsing, DOM rendering and frame stalls are not measured.',
				'Private planning runs on the main thread, not the production planner worker. Small local samples and instrumented page-cached replicas do not establish production p99 guarantees.',
			], validation: 'Each paired persisted document digest matches and matches a NeDB reload; canonical match identity is preserved. Source metadata and SHA-256 remain unchanged. Only disposable replicas are opened.',
		};
		await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n');
		return result;
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

if (require.main === module) {
	Promise.resolve().then(async () => {
		const cli = require('./isolated_sync/options'), options = cli.parse(process.argv.slice(2));
		if (options.help) return console.log('Compare full admin reloads with deferred finished histories. No CPU profile is taken.\n' +
			cli.help.replace('debug:isolated-sync', 'debug:isolated-admin'));
		const result = await benchmark(options);
		console.log(JSON.stringify({ directory: result.directory, fixture: result.fixture, summary: result.summary }, null, 2));
	}).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { benchmark };
