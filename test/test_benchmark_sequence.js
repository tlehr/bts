'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const net = require('net');
const { parse_args } = require('../debug/benchmark_sequence/options');
const { run } = require('../debug/benchmark_sequence/run');
const readiness = require('../debug/benchmark_sequence/readiness');
const { pause, OwnedProcess } = require('../debug/benchmark_sequence/process');

async function free_port() {
	const server = net.createServer();
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const port = server.address().port;
	await new Promise(resolve => server.close(resolve));
	return port;
}

function stopped(pid) {
	assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', 'runner must reap its own child');
}

describe('automated benchmark sequence', function() {
	this.timeout(15000);
	let root, options, dependencies;
	beforeEach(async function() {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-sequence-test-'));
		const port = await free_port();
		options = parse_args(['--base-url', 'http://127.0.0.1:' + port, '--output-dir', path.join(root, 'sequence'), '--warmup-ms', '0', '--ready-timeout-ms', '4000', '--profiles', 'basis,combined']);
		await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ enable_https: false, port }));
		dependencies = { server_entry: path.join(__dirname, 'fixtures/benchmark_sequence_child.js'),
			client_entry: path.join(__dirname, 'fixtures/benchmark_sequence_child.js'), log: () => {},
			validate_config: selected => readiness.validate_config(selected, root), env: { ...process.env,
				BTS_BTP_DECODE_WORKER: '0', BTS_SYNC_PLAN_WORKER: '1', BTS_DEVICE_INFO_BACKGROUND: '1', BTS_XLSX_IMPORT_WORKER: '1', BTS_COMPACTION_WORKER: '1' } };
	});
	afterEach(async function() { await fs.rm(root, { recursive: true, force: true }); });
	it('runs separate real server/client subprocesses for both profiles, verifies actual flags and reaps all children', async function() {
		const result = await run(options, dependencies);
		assert.strictEqual(result.status, 'completed');
		assert.deepStrictEqual(result.runs.map(row => row.profile), ['basis', 'combined']);
		assert.strictEqual(new Set(result.runs.map(row => row.server_pid)).size, 2);
		for (const entry of result.runs) {
			assert.strictEqual(entry.status, 'completed');
			assert.deepStrictEqual(entry.actual_profile.features, entry.expected_features);
			stopped(entry.server_pid); stopped(entry.client_pid);
			const report = JSON.parse(await fs.readFile(entry.report));
			assert.strictEqual(report.scenario, 'benchmark'); assert.strictEqual(report.seed, '519');
			assert.match(await fs.readFile(entry.server_log, 'utf8'), /fixture server/);
			assert.match(await fs.readFile(entry.client_log, 'utf8'), /fixture benchmark/);
		}
		assert.strictEqual(JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json'))).status, 'completed');
	});
	it('does not start or stop any server when the port is already occupied', async function() {
		const existing = net.createServer();
		await new Promise(resolve => existing.listen(new URL(options.base_url).port, '127.0.0.1', resolve));
		try {
			await assert.rejects(run(options, dependencies), /server is already running/);
			const result = JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json')));
			assert.strictEqual(result.runs.length, 0); assert.strictEqual(result.status, 'error');
			assert.strictEqual(existing.listening, true);
		} finally { await new Promise(resolve => existing.close(resolve)); }
	});
	it('rejects a wrong live feature profile before launching any client', async function() {
		dependencies.env.BTS_SEQUENCE_TEST_WRONG_PROFILE = '1';
		await assert.rejects(run(options, dependencies), /profile or process/);
		const result = JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json')));
		assert.strictEqual(result.runs.length, 1); assert.strictEqual(result.runs[0].client_pid, undefined);
		stopped(result.runs[0].server_pid);
	});
	it('stops the sequence after an incomplete report and does not start the next profile', async function() {
		dependencies.env.BTS_SEQUENCE_TEST_INCOMPLETE = '1';
		await assert.rejects(run(options, dependencies), /incomplete/);
		const result = JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json')));
		assert.strictEqual(result.runs.length, 1); assert.strictEqual(result.status, 'error');
		stopped(result.runs[0].server_pid); stopped(result.runs[0].client_pid);
	});
	it('rejects a report containing a server/profile change', async function() {
		dependencies.env.BTS_SEQUENCE_TEST_MIXED = '1';
		await assert.rejects(run(options, dependencies), /mixed server profiles/);
		const result = JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json')));
		assert.strictEqual(result.runs.length, 1);
		stopped(result.runs[0].server_pid); stopped(result.runs[0].client_pid);
	});
	it('aborts a running client and stops the owned server while keeping partial logs', async function() {
		dependencies.env.BTS_SEQUENCE_TEST_CLIENT_DELAY = '1';
		const controller = new AbortController(); dependencies.signal = controller.signal;
		const running = assert.rejects(run(options, dependencies), /interrupted/);
		let entry;
		try {
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				try { entry = JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json'))).runs[0]; }
				catch (error) { if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error; }
				if (entry?.client_pid) break;
				await pause(25);
			}
			assert(entry?.client_pid);
		} finally { controller.abort(); await running; }
		const result = JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json')));
		assert.strictEqual(result.status, 'interrupted'); assert.strictEqual(result.runs.length, 1);
		stopped(entry.server_pid); stopped(entry.client_pid);
		await fs.access(entry.server_log); await fs.access(entry.client_log);
	});
	it('records a startup crash, cleans up and never launches a client', async function() {
		dependencies.env.BTS_SEQUENCE_TEST_SERVER_EXIT = '1';
		await assert.rejects(run(options, dependencies), /Server exited/);
		const result = JSON.parse(await fs.readFile(path.join(options.output_dir, 'sequence.json')));
		assert.strictEqual(result.runs.length, 1); assert.strictEqual(result.runs[0].server_exit.code, 7);
		assert.strictEqual(result.runs[0].client_pid, undefined); stopped(result.runs[0].server_pid);
	});
	it('reaps a subprocess that ignores graceful shutdown after its grace period', async function() {
		const log_path = path.join(root, 'ignoring-client.log');
		const child = new OwnedProcess(dependencies.client_entry, [], { ...dependencies.env,
			BTS_BENCHMARK_SEQUENCE_ROLE: 'client', BTS_SEQUENCE_TEST_IGNORE_SIGNALS: '1', BTS_SEQUENCE_TEST_CLIENT_DELAY: '1',
		}, root, log_path);
		try {
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline && !(await fs.readFile(log_path, 'utf8')).includes('ignores SIGINT')) await pause(25);
			assert.match(await fs.readFile(log_path, 'utf8'), /ignores SIGINT/);
			const result = await child.stop(25);
			assert.strictEqual(result.signal, 'SIGKILL'); stopped(child.pid);
		} finally { await child.stop(25); }
	});
	it('compares reads during compaction with an otherwise identical patch-return profile', async function() {
		options.profiles = ['combined-patches', 'combined-reads'];
		dependencies.env.BTS_COMPACTION_MODEL_READS = '1';
		const result = await run(options, dependencies);
		assert.strictEqual(result.status, 'completed');
		const [ordered, reads] = result.runs.map(row => row.actual_profile.features);
		assert.strictEqual(ordered.compaction_reads, false);
		assert.strictEqual(reads.compaction_reads, true);
		assert.deepStrictEqual({ ...reads, compaction_reads: false }, ordered);
		for (const entry of result.runs) { stopped(entry.server_pid); stopped(entry.client_pid); }
	});
	it('prints an offline dry run, resets inherited flags, and allows explicit individual profiles', async function() {
		options.dry_run = true;
		options.profiles = parse_args([]).profiles;
		const result = await run(options, dependencies);
		assert.strictEqual(result.estimated_test_minutes, 10);
		assert.deepStrictEqual(result.profiles.map(row => row.name), ['combined-responsive-cached-admin']);
		assert.strictEqual(result.profiles[0].features.btp_decode, true);
		assert.strictEqual(result.profiles[0].features.sync_plan, true);
		assert.strictEqual(result.profiles[0].features.sync_plan_patch_return, true);
		assert.strictEqual(result.profiles[0].features.compaction_reads, true);
		assert.strictEqual(result.profiles[0].features.preparation_reads, true);
		assert.strictEqual(result.profiles[0].features.preparation_candidates, true);
		assert.strictEqual(result.profiles[0].features.sync_batch_writes, false);
		assert.strictEqual(result.profiles[0].features.sync_prepared_tournament, true);
		assert.strictEqual(result.profiles[0].features.admin_response_background, true);
		assert.strictEqual(result.profiles[0].features.admin_response_priority, true);
		assert.strictEqual(result.profiles[0].features.admin_response_worker, false);
		assert.strictEqual(result.profiles[0].features.admin_match_revision_cache, true);
		assert.strictEqual(require('../debug/benchmark_sequence/options').features('combined-responsive-background-admin').admin_match_revision_cache, false);
		assert.strictEqual(result.profiles[0].features.compaction_staged, true);
		assert.strictEqual(require('../debug/benchmark_sequence/options').environment(result.profiles[0].name, 'test', { BTS_SYNC_BATCH_WRITES: '1' }).BTS_SYNC_BATCH_WRITES, '0');
		await assert.rejects(fs.access(options.output_dir), error => error.code === 'ENOENT');
		const selected = parse_args(['--profiles', 'basis,device-info,sync-plan,compaction']);
		assert.strictEqual((await run({ ...selected, dry_run: true })).estimated_test_minutes, 40);
		assert.throws(() => parse_args(['--profiles', 'typo']), /Unknown profile/);
		assert.throws(() => parse_args(['--base-url', 'https://example.com']), /local/);
	});
	it('keeps preparation reads separately selectable and resets an inherited enabled flag', async function() {
		options.profiles = ['combined-reads', 'combined-preparation'];
		dependencies.env.BTS_PREPARATION_MODEL_READS = '1';
		const result = await run(options, dependencies);
		const [before, after] = result.runs.map(row => row.actual_profile.features);
		assert.strictEqual(before.preparation_reads, false);
		assert.strictEqual(after.preparation_reads, true);
		assert.deepStrictEqual({ ...after, preparation_reads: false }, before);
		for (const entry of result.runs) { stopped(entry.server_pid); stopped(entry.client_pid); }
	});
	it('isolates prepared writes and background admin responses, resetting inherited flags in the reference', async function() {
		options.profiles = ['combined-responsive-single-writes', 'combined-responsive-prepared-writes', 'combined-responsive-background-admin'];
		Object.assign(dependencies.env, { BTS_SYNC_PREPARED_TOURNAMENT: '1', BTS_ADMIN_RESPONSE_BACKGROUND: '1' });
		const result = await run(options, dependencies);
		const [reference, prepared, background] = result.runs.map(row => row.actual_profile.features);
		assert.strictEqual(reference.sync_prepared_tournament, false); assert.strictEqual(reference.admin_response_background, false);
		assert.strictEqual(prepared.sync_prepared_tournament, true); assert.strictEqual(prepared.admin_response_background, false);
		assert.strictEqual(background.sync_prepared_tournament, true); assert.strictEqual(background.admin_response_background, true);
		assert.deepStrictEqual({ ...prepared, sync_prepared_tournament: false }, reference);
		assert.deepStrictEqual({ ...background, admin_response_background: false, admin_response_priority: false }, prepared);
		assert.strictEqual(background.sync_batch_writes, false);
		for (const entry of result.runs) { stopped(entry.server_pid); stopped(entry.client_pid); }
	});
	it('verifies all three optimizations in one new run and resets them for the old profile', async function() {
		options.profiles = ['combined-preparation', 'combined-responsive'];
		Object.assign(dependencies.env, { BTS_PREPARATION_CANDIDATES_LIGHT: '1', BTS_SYNC_BATCH_WRITES: '1', BTS_COMPACTION_STAGED: '1' });
		const result = await run(options, dependencies);
		const [before, after] = result.runs.map(row => row.actual_profile.features);
		for (const feature of ['preparation_candidates', 'sync_batch_writes', 'compaction_staged']) {
			assert.strictEqual(before[feature], false); assert.strictEqual(after[feature], true);
		}
		assert.deepStrictEqual({ ...after, preparation_candidates: false, sync_batch_writes: false, compaction_staged: false }, before);
		for (const entry of result.runs) { stopped(entry.server_pid); stopped(entry.client_pid); }
	});
});
