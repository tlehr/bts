'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);
const Datastore = require('nedb');
const { OwnedProcess, pause } = require('./benchmark_sequence/process');
const { port_in_use } = require('./benchmark_sequence/readiness');
const { AdminWsClient } = require('./live_tournament_drill');

const TABLES = ['courts', 'locations', 'event', 'matches', 'tournaments', 'umpires', 'logs', 'tabletoperators',
	'displaysettings', 'display_court_displaysettings', 'normalizations', 'advertisements', 'app_settings'];
const BASELINE = 'cf73f0a731dd26aac4fb360a71b5d2b165deef0f';

function parse(argv) {
	const result = { bts_dir: path.resolve(__dirname, '..'), source: null, refs: [BASELINE, 'HEAD'],
		tournament: 'default', expected_matches: 519, runtime_ms: 600000, port: 4540, seed: '519', dry_run: false };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === '--dry-run') { result.dry_run = true; continue; }
		if (flag === '--help') return { help: true };
		const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
		if (flag === '--bts-dir') result.bts_dir = path.resolve(value);
		else if (flag === '--source') result.source = path.resolve(value);
		else if (flag === '--refs') result.refs = value.split(',');
		else if (flag === '--tournament') result.tournament = value;
		else if (flag === '--seed') result.seed = value;
		else if (flag === '--runtime-ms') result.runtime_ms = Number(value);
		else if (flag === '--port') result.port = Number(value);
		else if (flag === '--expected-matches') result.expected_matches = Number(value);
		else throw new Error('Unknown argument: ' + flag);
	}
	for (const key of ['runtime_ms', 'port', 'expected_matches']) if (!Number.isSafeInteger(result[key]) || result[key] < 1) throw new Error('Invalid ' + key);
	if (result.port > 65535 || result.runtime_ms > 600000 || !result.refs.length || result.refs.some(ref => !/^[a-zA-Z0-9_./-]+$/.test(ref) || ref.startsWith('-'))) throw new Error('Invalid comparison settings');
	result.source ||= path.join(result.bts_dir, 'data');
	return result;
}

async function capture(source, target) {
	await fs.mkdir(target);
	const inspect = () => Promise.all(TABLES.map(async name => { const s = await fs.stat(path.join(source, name)); return [name, s.size, s.mtimeMs, s.ctimeMs, s.ino]; }));
	const before = await inspect();
	await Promise.all(TABLES.map(name => fs.copyFile(path.join(source, name), path.join(target, name))));
	if (JSON.stringify(before) !== JSON.stringify(await inspect())) throw new Error('Source changed while copying. Retry between writes.');
	return Promise.all(TABLES.map(async name => ({ name, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(target, name))).digest('hex') })));
}

async function isolate(checkout, snapshot) {
	const data = path.join(checkout, 'data'); await fs.mkdir(data);
	await Promise.all(TABLES.map(name => fs.copyFile(path.join(snapshot, name), path.join(data, name))));
	// Disable every external BTP connection in the disposable copy only. This
	// comparison deliberately measures score/admin traffic, not a live BTP sync.
	const db = new Datastore({ filename: path.join(data, 'tournaments') });
	await promisify(db.loadDatabase.bind(db))();
	await promisify(db.update.bind(db))({}, { $set: { btp_enabled: false, btp_autofetch_enabled: false,
		bts_debug_output_enabled: false, bts_server_diagnostics_enabled: false, ticker_enabled: false } }, { multi: true });
}

async function run(options, { signal, log = console.log } = {}) {
	const git = async args => (await execute('git', ['-C', options.bts_dir, ...args])).stdout.trim();
	const refs = await Promise.all(options.refs.map(async ref => ({ ref, commit: await git(['rev-parse', '--verify', ref + '^{commit}']) })));
	const base_url = 'http://127.0.0.1:' + options.port;
	const plan = { refs, source: options.source, tournament: options.tournament, runtime_ms: options.runtime_ms,
		base_url, seed: options.seed, server_telemetry: false, scope: 'score-and-admin-reception-with-external-BTP-disabled' };
	if (options.dry_run) return plan;
	if (await port_in_use(base_url)) throw new Error('Comparison port is occupied; no server was stopped.');
	const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-reference-'));
	const snapshot = path.join(output, 'snapshot'), files = await capture(options.source, snapshot);
	const manifest = { ...plan, output, snapshot_files: files, node_version: process.version, platform: process.platform,
		cpu: os.cpus()[0]?.model, client_file_sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(__dirname, 'live_tournament_drill.js'))).digest('hex'),
		started_at: new Date().toISOString(), runs: [], status: 'running' };
	const save = () => fs.writeFile(path.join(output, 'comparison.json'), JSON.stringify(manifest, null, 2) + '\n');
	await save(); log('Comparison reports: ' + output);
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BTS_')));
	try {
		for (const [index, ref] of refs.entries()) {
			if (signal?.aborted) throw new Error('Comparison interrupted');
			const checkout = path.join(output, 'server-' + index), archive = path.join(output, 'server-' + index + '.tar');
			await fs.mkdir(checkout);
			await execute('git', ['-C', options.bts_dir, 'archive', '--format=tar', '--output', archive, ref.commit]);
			await execute('tar', ['-xf', archive, '-C', checkout]); await fs.unlink(archive);
			await fs.symlink(path.join(options.bts_dir, 'node_modules'), path.join(checkout, 'node_modules'));
			await fs.symlink(path.join(options.bts_dir, 'static/bup/dev'), path.join(checkout, 'static/bup/dev'));
			await isolate(checkout, snapshot);
			const config = JSON.parse(await fs.readFile(path.join(checkout, 'config.json.default'), 'utf8'));
			await fs.writeFile(path.join(checkout, 'config.json'), JSON.stringify({ ...config, port: options.port, enable_https: false, bup_location: path.join(options.bts_dir, 'static/bup/dev'), bts_debug_output_enabled: false }));
			const entry = { ...ref, status: 'starting', server_log: path.join(output, index + '-server.log'),
				client_log: path.join(output, index + '-client.log'), report: path.join(output, index + '-report.json') };
			manifest.runs.push(entry); await save();
			let server, client, progress;
			const aborted = () => { server?.child.kill('SIGINT'); client?.child.kill('SIGINT'); };
			signal?.addEventListener('abort', aborted, { once: true });
			try {
				server = new OwnedProcess(path.join(checkout, 'bts/bts.js'), [], env, checkout, entry.server_log);
				const deadline = Date.now() + 30000; let initial;
				while (Date.now() < deadline && !initial) {
					if (server.result || signal?.aborted) throw new Error('Comparison server exited during startup');
					const admin = new AdminWsClient(base_url, options.tournament, null, { handshake_timeout_ms: 500 });
					try { initial = await admin.tournament(); } catch { await pause(250, signal); } finally { admin.close(); }
				}
				if (!initial) throw new Error('Comparison server startup timed out');
				if (initial.matches.length !== options.expected_matches) throw new Error('Unexpected match count: ' + initial.matches.length);
				entry.status = 'testing'; entry.started_at = new Date().toISOString(); await save();
				const args = ['--base-url', base_url, '--tournament', options.tournament, '--expected-matches', String(options.expected_matches), '--seed', options.seed,
					'--plain-log', '--report', entry.report, '--no-server-telemetry', '--no-processing-traces'];
				if (options.runtime_ms === 600000) args.push('--scenario', 'benchmark');
				else args.push('--max-runtime-ms', String(options.runtime_ms), '--point-min-ms', '3200', '--point-max-ms', '6400');
				client = new OwnedProcess(path.join(__dirname, 'live_tournament_drill.js'), args, env, __dirname, entry.client_log);
				progress = setInterval(() => log(ref.commit.slice(0, 7) + ': ' + Math.floor((Date.now() - Date.parse(entry.started_at)) / 1000) + ' / ' + options.runtime_ms / 1000 + ' s'), 30000);
				let timeout;
				try {
					const result = await Promise.race([client.done, server.done.then(() => { throw new Error('Comparison server exited'); }),
						new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Comparison client timed out')), options.runtime_ms + 60000); })]);
					if (result.code !== 0 || signal?.aborted) throw new Error('Comparison client failed or interrupted');
				} finally { clearTimeout(timeout); }
				const report = JSON.parse(await fs.readFile(entry.report, 'utf8'));
				if (report.stop_reason !== 'completed') throw new Error('Comparison did not complete');
				Object.assign(entry, { status: 'completed', initial_state: report.initial_state, points: report.points,
					tablet_to_tv_ms: report.tablet_to_tv_ms, tablet_to_admin_ms: report.tablet_to_admin_ms });
			} catch (error) { entry.status = 'error'; entry.error = error.message; throw error; }
			finally { clearInterval(progress); signal?.removeEventListener('abort', aborted); await client?.stop(); await server?.stop(); await save(); }
		}
		manifest.status = 'completed';
		manifest.identical_initial_states = new Set(manifest.runs.map(entry => entry.initial_state.state_sha256)).size === 1;
		return manifest;
	} catch (error) { manifest.status = 'error'; manifest.error = error.message; throw error; }
	finally { manifest.finished_at = new Date().toISOString(); await save(); }
}

if (require.main === module) {
	const options = parse(process.argv.slice(2));
	if (options.help) console.log('Compare immutable BTS commits on separate copies of the same tournament.\n--bts-dir PATH --source DATA --refs COMMIT,COMMIT --runtime-ms N (default 600000) --port N --dry-run\nExternal BTP is disabled; server telemetry is unavailable.');
	else {
		const controller = new AbortController(); const stop = () => controller.abort();
		process.on('SIGINT', stop); process.on('SIGTERM', stop);
		run(options, { signal: controller.signal }).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; })
			.finally(() => { process.off('SIGINT', stop); process.off('SIGTERM', stop); });
	}
}

module.exports = { parse, capture, isolate, run, BASELINE };
