'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { features, environment } = require('./options');
const { OwnedProcess, pause, wait_for_abort } = require('./process');
const readiness = require('./readiness');

function plan(options) {
	return { base_url: options.base_url, tournament: options.tournament, seed: options.seed,
		bts_dir: options.bts_dir,
		expected_matches: options.expected_matches, estimated_test_minutes: options.profiles.length * 10,
		warmup_ms_per_run: options.warmup_ms, profiles: options.profiles.map(name => ({ name, features: features(name) })),
		output_dir: options.output_dir || 'new /tmp/bts-offload-sequence-* directory',
		notes: ['Tournament continues between runs; no reset or checkout.', 'Combined run measures the joint effect; individual latency contributions require separate profiles.',
			'XLSX is excluded because the live drill performs no imports.'] };
}

async function run(options, dependencies = {}) {
	const cwd = options.bts_dir || path.resolve(process.env.BTS_REPOSITORY_DIR || path.join(__dirname, '../../../bts'));
	if (options.dry_run) return plan(options);
	const signal = dependencies.signal, log = dependencies.log || console.log;
	const output_dir = options.output_dir || await fs.mkdtemp(path.join(os.tmpdir(), 'bts-offload-sequence-'));
	if (options.output_dir) await fs.mkdir(output_dir);
	const manifest_path = path.join(output_dir, 'sequence.json');
	const manifest = { ...plan(options), output_dir, started_at: new Date().toISOString(), status: 'running', runs: [] };
	const save = async () => {
		await fs.writeFile(manifest_path + '.tmp', JSON.stringify(manifest, null, 2) + '\n');
		await fs.rename(manifest_path + '.tmp', manifest_path);
	};
	log('Logs and reports: ' + output_dir);
	await save();
	try {
		await (dependencies.validate_config || readiness.validate_config)(options, cwd);
		for (const [index, name] of options.profiles.entries()) {
			if (signal?.aborted) throw new Error('Sequence interrupted');
			const prefix = `${String(index + 1).padStart(2, '0')}-${name}`;
			const label = path.basename(output_dir) + '-' + prefix;
			const paths = { server_log: path.join(output_dir, prefix + '-server.log'),
				client_log: path.join(output_dir, prefix + '-client.log'), report: path.join(output_dir, prefix + '-report.json') };
			const entry = { profile: name, label, expected_features: features(name), ...paths, started_at: new Date().toISOString(), status: 'starting' };
			manifest.runs.push(entry); await save();
			const env = { ...environment(name, label, dependencies.env || process.env), BTS_BENCHMARK_BASE_URL: options.base_url };
			let server, client, progress, watchdog;
			const abort = wait_for_abort(signal);
			// Attach a handler immediately; an abort during startup is observed
			// by the readiness probe even before the client race is installed.
			abort.promise.catch(() => {});
			try {
				log(`${prefix}: starting server, then ten-minute benchmark`);
				server = new OwnedProcess(dependencies.server_entry || path.join(cwd, 'bts/bts.js'), [],
					{ ...env, BTS_BENCHMARK_SEQUENCE_ROLE: 'server' }, cwd, paths.server_log);
				entry.server_pid = server.pid; await save();
				entry.actual_profile = await readiness.ready(server, options, entry.expected_features, label, signal);
				await pause(options.warmup_ms, signal);
				entry.actual_profile = await readiness.ready(server, options, entry.expected_features, label, signal);
				entry.status = 'testing'; entry.test_started_at = new Date().toISOString(); await save();
				client = new OwnedProcess(dependencies.client_entry || path.resolve(__dirname, '../live_tournament_drill.js'), [
					'--scenario', 'benchmark', '--base-url', options.base_url, '--tournament', options.tournament,
					'--seed', options.seed, '--expected-matches', String(options.expected_matches), '--plain-log', '--report', paths.report,
					'--slow-latency-ms', '100',
				], { ...env, BTS_BENCHMARK_SEQUENCE_ROLE: 'client' }, cwd, paths.client_log);
				entry.client_pid = client.pid; await save();
				progress = setInterval(() => {
					const seconds = Math.floor((Date.now() - Date.parse(entry.test_started_at)) / 1000);
					log(`${prefix}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 10:00`);
				}, 30000);
				const result = await Promise.race([client.done, server.done.then(() => { throw new Error('Server exited during benchmark; see server log'); }),
					abort.promise, new Promise((resolve, reject) => { watchdog = setTimeout(() => reject(new Error('Testclient exceeded its time limit')), 660000); })]);
				if (signal?.aborted) throw new Error('Sequence interrupted');
				if (result.code !== 0) throw new Error('Testclient failed; see client log (' + JSON.stringify(result) + ')');
				const report = JSON.parse(await fs.readFile(paths.report, 'utf8'));
				if (report.stop_reason !== 'completed' || report.mixed_server_profiles || report.runtime_ms < 600000) {
					throw new Error('Benchmark incomplete or contains mixed server profiles; see report');
				}
				readiness.assert_profile(report.server_offloading, entry.expected_features, label, server.pid);
				if (!Array.isArray(report.server_profiles) || report.server_profiles.length !== 1 ||
					report.server_profiles[0].profile.server_id !== entry.actual_profile.server_id) throw new Error('Report server profile differs from startup profile');
				entry.status = 'completed'; entry.initial_state = report.initial_state;
				entry.points = report.points; entry.checkins = report.checkins;
				entry.phases = report.phases; entry.runtime_ms = report.runtime_ms;
				log(prefix + ': completed');
				await pause(2000, signal); // Let final asynchronous device metadata finish before shutdown.
				if (server.result) throw new Error('Server exited after benchmark; see server log');
			} catch (error) {
				entry.status = signal?.aborted ? 'interrupted' : 'error'; entry.error = error.message; throw error;
			} finally {
				clearInterval(progress); clearTimeout(watchdog); abort.close();
				try { if (client) entry.client_exit = await client.stop(); }
				finally { if (server) entry.server_exit = await server.stop(); }
				entry.finished_at = new Date().toISOString(); await save();
			}
		}
		manifest.status = 'completed';
		log('Sequence completed. Manifest: ' + manifest_path);
		return manifest;
	} catch (error) {
		manifest.status = signal?.aborted ? 'interrupted' : 'error'; manifest.error = error.message;
		error.manifest_path = manifest_path; throw error;
	} finally { manifest.finished_at = new Date().toISOString(); await save(); }
}

module.exports = { run, plan };
