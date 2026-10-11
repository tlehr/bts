'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { parse, run } = require('../debug/queue_responsiveness_benchmark');
const { BASELINE } = require('../debug/queue_responsiveness/run');
const { response } = require('../debug/queue_responsiveness/fixture');
const { launch } = require('../debug/queue_responsiveness/process');
const { get_btp_state } = require('../bts/btp_parse');
const { instrument } = require('../debug/queue_responsiveness/instrument');
const { ResourceLockQueue } = require('../bts/resource_lock_queue');
const Datastore = require('nedb');
const batch_writes = require('../bts/btp_planner/batch_writes');
const { validate_archive } = require('../debug/queue_responsiveness/server');

describe('isolated queue responsiveness comparison', function() {
	this.timeout(10000);
	it('resolves immutable server references without creating a test server or fixture directory', async function() {
		const plan = await run(parse(['--dry-run']));
		assert.strictEqual(plan.refs[0].commit, BASELINE);
		assert.match(plan.refs[1].commit, /^[a-f0-9]{40}$/);
		assert.strictEqual(plan.directory, undefined);
		assert.strictEqual(plan.matches, 519);
		assert.strictEqual(plan.delay_ms, 2000);
	});
	it('rejects unsafe references, empty phases and oversized or impossible scenarios', function() {
		for (const args of [
			['--refs', '-HEAD'], ['--refs', 'HEAD,'], ['--refs', 'HEAD;pwd'],
			['--phases', ','], ['--phases', 'unknown'], ['--samples', '0'],
			['--samples', '21'], ['--matches', '2001'], ['--delay-ms', '10001'],
			['--matches', '1'], ['--delay-ms', '1.5'], ['--unknown', 'value'], ['--refs'],
		]) assert.throws(() => parse(args), args.join(' '));
		assert.strictEqual(parse(['--matches', '1', '--phases', 'idle']).matches, 1);
	});
	it('rejects a working checkout before initializing its persistent database', async function() {
		await assert.rejects(validate_archive(path.resolve(__dirname, '..'), __dirname), /requires its own temporary archive/);
		const job = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-queue-responsiveness-guard-'));
		try {
			await fs.mkdir(path.join(job, 'server-0')); await fs.mkdir(path.join(job, 'case'));
			await validate_archive(path.join(job, 'server-0'), path.join(job, 'case'));
			await fs.symlink(path.resolve(__dirname, '..'), path.join(job, 'server-1'));
			await assert.rejects(validate_archive(path.join(job, 'server-1'), path.join(job, 'case')), /requires its own temporary archive/);
		} finally { await fs.rm(job, { recursive: true, force: true }); }
	});
	it('provides 519 playable matches with distinct players through the real BTP parser', function() {
		const state = get_btp_state(response());
		assert.strictEqual(state.matches.length, 519);
		assert.strictEqual(state.players.size, 1038);
		assert.strictEqual(state.courts.size, 13);
		assert(state.matches.every(match => match.bts_complete && match.bts_players.every(team => team.length === 1)));
		const participants = state.matches.flatMap(match => match.bts_players.flat().map(player => player.ID[0]));
		assert.strictEqual(new Set(participants).size, 1038);
	});
	it('changes 518 matches while preserving the called match and its dependencies', function() {
		const before = get_btp_state(response()), after = get_btp_state(response(519, true));
		assert.deepStrictEqual(after.matches[0], before.matches[0]);
		assert.deepStrictEqual(after.players, before.players);
		assert.deepStrictEqual(after.courts, before.courts);
		for (let i = 1; i < before.matches.length; i++) {
			const original = before.matches[i], changed = after.matches[i];
			assert.strictEqual(changed.MatchNr[0], original.MatchNr[0] + 10000);
			assert.deepStrictEqual({ ...changed, MatchNr: original.MatchNr }, original);
		}
	});
	it('observes real lock blockers and sync DB writes without disabling certified batches', async function() {
		const store = new Datastore(), scheduler = new ResourceLockQueue();
		batch_writes.certify(store);
		assert(batch_writes.supported(store));
		const execute = ResourceLockQueue.prototype.execute, push = store.executor.push;
		const triggers = [];
		const measurement = instrument(path.resolve(__dirname, '..'), { matches: store }, { stats: () => scheduler.stats() }, reason => triggers.push(reason));
		measurement.start();
		let release, started;
		const began = new Promise(resolve => { started = resolve; });
		const gate = new Promise(resolve => { release = resolve; });
		try {
			assert(batch_writes.supported(store));
			const sync = measurement.run('sync', () => scheduler.execute(async () => { started(); await gate; }, { locks: ['preparation:fixture'] }));
			await began;
			const call = measurement.run('call', () => scheduler.execute(() => {}, { locks: ['preparation:fixture'] }));
			await new Promise(resolve => setImmediate(resolve));
			release(); await Promise.all([sync, call]);
			await measurement.run('sync', () => batch_writes.write(store, [{ collection: 'matches', id: 'fixture', before: null, after: { _id: 'fixture' } }], () => ({ _id: 'fixture' })));
			const result = measurement.finish();
			assert(batch_writes.supported(store));
			assert.deepStrictEqual(triggers, ['first_live_match_write']);
			assert.strictEqual(result.database[0].owner, 'sync');
			assert.deepStrictEqual(result.tasks.find(task => task.owner === 'call').observed_blockers[0].conflicting_locks, ['preparation:fixture']);
			assert(result.tasks.every(task => task.finished_ns));
		} finally { release(); measurement.finish(); ResourceLockQueue.prototype.execute = execute; store.executor.push = push; }
	});

	let directory, child;
	beforeEach(async function() { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-queue-harness-test-')); });
	afterEach(async function() { await child?.stop(); child = null; await fs.rm(directory, { recursive: true, force: true }); });
	async function start(source, signal) {
		const entry = path.join(directory, 'child.js'); await fs.writeFile(entry, source);
		child = launch(entry, {}, directory, 'child', signal); return child;
	}
	it('fails promptly when a child unexpectedly exits successfully before readiness', async function() {
		const process = await start('process.exit(0);');
		await assert.rejects(process.wait('ready', 2000), /exited before completion: 0/);
	});
	it('preserves IPC messages arriving before a waiter and stops only the owned child', async function() {
		const process = await start('process.send({type:"ready"}); process.on("message", m => {if(m.type==="stop") process.exit(0);});');
		await new Promise(resolve => process.child.once('message', resolve));
		assert.strictEqual((await process.wait('ready')).type, 'ready');
		await process.stop();
		assert.strictEqual(process.child.exitCode, 0);
	});
	it('rejects outstanding waits on cancellation and terminates the owned child', async function() {
		const controller = new AbortController();
		const process = await start('process.send({type:"ready"}); setInterval(() => {}, 1000);', controller.signal);
		await process.wait('ready');
		const pending = process.wait('done');
		controller.abort();
		await assert.rejects(pending, /interrupted/);
		await process.stop();
		assert(process.child.exitCode !== null || process.child.signalCode !== null);
	});
});
