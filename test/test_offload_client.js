'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const WorkerClient = require('../bts/offload/client');

class FakeWorker extends EventEmitter {
	constructor() { super(); this.jobs = []; }
	ref() {}
	unref() {}
	postMessage(job) { this.jobs.push(job); }
	terminate() { this.terminated = true; return Promise.resolve(); }
	reply(value) { this.emit('message', { id: this.jobs.at(-1).id, value,
		started: process.hrtime.bigint(), returning: process.hrtime.bigint() }); }
}

describe('isolated background worker queues', function() {
	let client, workers;
	beforeEach(function() {
		workers = [];
		client = new WorkerClient('test', 'unused', { create_worker: () => {
			const worker = new FakeWorker(); workers.push(worker); return worker;
		}, timeout_ms: 1000, max_pending: 2 });
	});
	afterEach(function() { client.close(); });
	it('reuses a worker and preserves FIFO request association', async function() {
		const first = client.run({ value: 1 }), second = client.run({ value: 2 });
		workers[0].reply('first'); workers[0].reply('second');
		assert.deepStrictEqual(await Promise.all([first, second]), ['first', 'second']);
		assert.strictEqual(workers.length, 1);
	});
	it('recovers after a crash, ignores late exits and keeps other queued jobs', async function() {
		const first = assert.rejects(client.run({}), /crashed/), second = client.run({});
		workers[0].emit('error', new Error('crashed')); workers[0].emit('exit', 1);
		assert(workers[0].terminated); assert.strictEqual(client.generation, 1);
		workers[1].reply('kept'); await first;
		assert.strictEqual(await second, 'kept');
	});
	it('interrupts a timed-out task and recreates a worker for a later task', async function() {
		client.timeout_ms = 5;
		await assert.rejects(client.run({}), /timed out/);
		client.timeout_ms = 1000;
		const second = client.run({}); workers[0].reply('late'); workers[1].reply('ok');
		assert.strictEqual(await second, 'ok');
	});
	it('rejects an overflowing queue and releases all work during shutdown', async function() {
		const work = [client.run({}), client.run({}), client.run({})];
		const failures = work.map(promise => assert.rejects(promise, /closed/));
		await assert.rejects(client.run({}), /queue full/);
		client.close(); await Promise.all(failures);
	});
});
