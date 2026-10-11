'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);
const { launch } = require('./queue_responsiveness/process');
const { module_path } = require('./testclient_bridge');

function parse(argv) {
	const options = { bts_dir: path.resolve(__dirname, '..'), ref: 'HEAD', duration_ms: 120000, sync_interval_ms: 2000, count: 519,
		point_min_ms: 800, point_max_ms: 1600, set_points: 21, workload: 'ordering' };
	for (let i = 0; i < argv.length; i++) {
		const key = { '--ref': 'ref', '--duration-ms': 'duration_ms', '--sync-interval-ms': 'sync_interval_ms', '--matches': 'count',
			'--point-min-ms': 'point_min_ms', '--point-max-ms': 'point_max_ms', '--set-points': 'set_points', '--workload': 'workload' }[argv[i]];
		if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown option or missing value: ' + argv[i]);
		options[key] = ['ref', 'workload'].includes(key) ? argv[++i] : Number(argv[++i]);
	}
	if (options.ref.startsWith('-') || !options.ref.trim()) throw new Error('Invalid ref');
	if (!['ordering', 'preparation'].includes(options.workload)) throw new Error('Invalid workload');
	for (const [key, min, max] of [['duration_ms', 5000, 300000], ['sync_interval_ms', 500, 10000], ['count', 14, 2000],
		['point_min_ms', 50, 30000], ['point_max_ms', 50, 30000], ['set_points', 1, 21]]) {
		if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) throw new Error('Invalid ' + key);
	}
	if (options.point_min_ms > options.point_max_ms) throw new Error('Invalid point interval');
	return options;
}

function statistics(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	const quantile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
	return { count: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
		median: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1) ?? null };
}

function summarize(server, client, probes) {
	const elapsed = (a, b) => a && b ? Number(BigInt(b) - BigInt(a)) / 1e6 : null;
	const first = BigInt(server.samples[0].ns), last = BigInt(server.samples.at(-1).ns), span = last - first;
	const third = row => Math.min(2, Math.max(0, Number((BigInt(row.ns) - first) * 3n / (span || 1n))));
	const windows = [0, 1, 2].map(index => {
		const samples = server.samples.filter(row => third(row) === index);
		const sync_samples = server.sync_backlog_samples.filter(row => third(row) === index);
		return { third: index + 1, samples: samples.length, pending: statistics(samples.map(row => row.pending)),
			oldest_pending_ms: statistics(samples.map(row => row.oldest_pending_ms)),
			database_pending: statistics(samples.map(row => Object.values(row.db).reduce((sum, store) => sum + store.pending, 0))),
			unfinished_syncs: statistics(sync_samples.map(row => row.pending)), oldest_sync_ms: statistics(sync_samples.map(row => row.oldest_ms)) };
	});
	return { drained: server.drained, syncs: server.syncs.length, finished_syncs: server.syncs.filter(row => row.finished_ns).length,
		sync_stage_start_ms: statistics(server.syncs.map(row => elapsed(row.enqueued_ns, row.planning_ns))),
		sync_total_ms: statistics(server.syncs.map(row => elapsed(row.enqueued_ns, row.finished_ns))),
		points: client.points, tablet_to_tv_ms: client.tablet_to_tv_ms, tablet_to_admin_ms: client.tablet_to_admin_ms,
		finished_matches: server.finished_matches, oncourt_matches: server.oncourt_matches,
		call_events: client.payload_types.admin.filter(row => row.type === 'change:match_called_on_court').reduce((sum, row) => sum + row.count, 0),
		preparation_events: client.payload_types.admin.filter(row => row.type === 'change:match_preparation_call').reduce((sum, row) => sum + row.count, 0),
		preparation_calculation_ms: statistics((server.preparation_calculations || []).map(row => row.duration_ms)),
		free_announce_ms: statistics(probes.probes.filter(row => row.kind === 'free').map(row => row.latency_ms)),
		call_ms: statistics(probes.probes.filter(row => row.kind === 'call').map(row => row.latency_ms)),
		unanswered: probes.unanswered, windows, event_loop: server.event_loop,
		processing_errors: (client.server_performance?.traces || []).filter(row => row.status === 'error').length,
		point_queue_wait_ms: statistics(server.tasks.filter(row => row.owner === 'score_update').map(row => row.wait_ms)),
	};
}

async function run(options, { signal, log = console.log } = {}) {
	const commit = (await execute('git', ['-C', options.bts_dir, 'rev-parse', '--verify', options.ref + '^{commit}'])).stdout.trim();
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-queue-responsiveness-'));
	const root = path.join(directory, 'server-0'), output = path.join(directory, 'mixed');
	await fs.mkdir(root); await fs.mkdir(output);
	const result = { status: 'running', commit, options, directory, started_at: new Date().toISOString(),
		node_version: process.version, cpu: os.cpus()[0]?.model,
		limitations: [
			'Isolated deterministic 519-game fixture, real durable NeDB and unmodified committed BTS modules.',
			'Real separate testclient simulates tablets, TV and admin; point interval in options, 13 courts, zero score gap.',
			'Idle fixture games explicitly set to scheduled before measurement, enabling automatic calls after real finishes.',
			'Periodic sync uses the actual validated integration planner but updates idle match numbers directly in staging; no periodic BTP TCP/XML fetch/parser.',
			'Full BTP fixture is used only at bootstrap. No live tournament or server is modified. Officials/tabletoperator allocation disabled.',
			options.workload === 'preparation' ? 'Automatic preparation enabled; 26 pairs of players recur across scheduled games, creating real participant dependencies. No winner/loser bracket propagation simulated.' : 'Automatic preparation disabled; independent participants.',
			'One explicit unchanged court call during first integration; automatic calls through actual score finishes; free announcements every two seconds.',
			'Queue samples every 20 ms, diagnostics/traces enabled by normal client. Observer overhead and local machine load included.',
			'Reception of WebSocket events, no browser painting or audible speech. Limited duration, no capacity guarantee.',
		],
	};
	const save = () => fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n');
	await save();
	let server, receiver, progress;
	try {
		const archive = root + '.tar';
		await execute('git', ['-C', options.bts_dir, 'archive', '--format=tar', '--output', archive, commit]);
		await execute('tar', ['-xf', archive, '-C', root]); await fs.unlink(archive);
		await fs.symlink(path.join(options.bts_dir, 'node_modules'), path.join(root, 'node_modules'));
		await fs.symlink(path.join(options.bts_dir, 'static/bup/dev'), path.join(root, 'static/bup/dev'));
		const source_dir = path.join(directory, 'harness-source'); await fs.mkdir(source_dir);
		result.harness_sha256 = {};
		for (const name of ['mixed_queue_benchmark.js', 'queue_responsiveness/mixed_server.js', 'queue_responsiveness/mixed_receiver.js',
			'queue_responsiveness/instrument.js', 'queue_responsiveness/process.js', 'queue_responsiveness/server.js',
			'queue_responsiveness/fixture.js', 'testclient_bridge.js']) {
			const source = await fs.readFile(path.join(__dirname, name));
			result.harness_sha256[name] = crypto.createHash('sha256').update(source).digest('hex');
			await fs.writeFile(path.join(source_dir, path.basename(name)), source);
		}
		const client_path = module_path('live_tournament_drill');
		result.client_commit = (await execute('git', ['-C', path.dirname(client_path), 'rev-parse', 'HEAD'])).stdout.trim();
		result.client_source_sha256 = crypto.createHash('sha256').update(await fs.readFile(client_path)).digest('hex');
		result.dependency_lock_sha256 = crypto.createHash('sha256').update(await fs.readFile(path.join(options.bts_dir, 'package-lock.json'))).digest('hex');
		server = launch(path.join(__dirname, 'queue_responsiveness/mixed_server.js'), { root, directory: output, count: options.count,
			sync_interval_ms: options.sync_interval_ms, set_points: options.set_points, workload: options.workload }, output, 'server', signal);
		const setup = await server.wait('ready');
		receiver = launch(path.join(__dirname, 'queue_responsiveness/mixed_receiver.js'), { ...setup, directory: output,
			client_module: client_path, count: options.count, duration_ms: options.duration_ms,
			point_min_ms: options.point_min_ms, point_max_ms: options.point_max_ms }, output, 'receiver', signal);
		await receiver.wait('ready');
		log('Mixed workload reports: ' + directory); receiver.send({ type: 'start' }); server.send({ type: 'start' });
		const started = Date.now();
		progress = setInterval(() => log('Mixed workload: ' + Math.min(100, Math.round((Date.now() - started) / options.duration_ms * 100)) + '%'), 10000);
		await server.wait('probe'); receiver.send({ type: 'probe' });
		const done = await receiver.wait('done', options.duration_ms + 30000);
		server.send({ type: 'finish' }); const finished = await server.wait('done', 60000);
		const client = JSON.parse(await fs.readFile(done.result, 'utf8'));
		const measured = JSON.parse(await fs.readFile(finished.result, 'utf8'));
		const probes = JSON.parse(await fs.readFile(path.join(output, 'probe-result.json'), 'utf8'));
		result.summary = summarize(measured, client, probes);
		if (options.workload === 'preparation' && (!result.summary.preparation_events || !result.summary.preparation_calculation_ms.count)) throw new Error('No active preparation measured');
		if (measured.finished_matches && result.summary.call_events < 2) throw new Error('Finishes observed without automatic follow-up call events');
		if (result.summary.processing_errors) throw new Error('Server processing errors observed: ' + result.summary.processing_errors);
		result.artifacts = { server: finished.result, client: done.result, probes: path.join(output, 'probe-result.json') };
		result.status = 'completed'; log(JSON.stringify(result.summary)); return result;
	} catch (error) { result.status = 'error'; result.error = error.message; throw error; }
	finally {
		clearInterval(progress); await receiver?.stop(); await server?.stop();
		result.finished_at = new Date().toISOString(); await save();
	}
}

if (require.main === module) {
	const controller = new AbortController();
	for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
	Promise.resolve().then(() => run(parse(process.argv.slice(2)), { signal: controller.signal })).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { parse, statistics, summarize, run };
