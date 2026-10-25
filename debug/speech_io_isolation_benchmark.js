'use strict';

// Controlled libuv contention, not a live scoring or inference benchmark.
// Only synthetic speech metadata and a temporary persisted NeDB are used.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { promisify } = require('util');
const { performance } = require('perf_hooks');
const path = require('path');
const fs = require('fs/promises');
const assert = require('assert');

async function workload(port, data) {
	const Cache = require('../bts/speech/disk_cache');
	const cache = new Cache({ cache_dir: data.directory, base_url: 'http://127.0.0.1:1' });
	await cache.ready;
	for (let i = 0; i < 3000; i++) cache.records.set(String(i), { key: String(i), part: 'Synthetischer Spieler '.repeat(50) });
	port.on('message', async message => {
		if (message.type !== 'work') return;
		try {
			if (message.kind === 'pool-contention') {
				const pending = promisify(require('crypto').pbkdf2)('test', 'test', 350000, 32, 'sha256');
				port.postMessage({ type: 'busy' });
				await pending;
			} else {
				port.postMessage({ type: 'busy' });
				for (let i = 0; i < 10; i++) await cache.persist();
			}
			port.postMessage({ type: 'done' });
		} catch (error) { port.postMessage({ type: 'failure', message: error.message }); }
	});
	port.postMessage({ type: 'ready' });
}

function receive(worker, type) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => finish(new Error('benchmark_timeout')), 10000);
		const error = failure => finish(failure);
		const message = value => {
			if (value.type === 'failure') finish(new Error(value.message));
			else if (value.type === type) finish(null, value);
		};
		function finish(failure, value) {
			clearTimeout(timer); worker.off('error', error); worker.off('message', message);
			failure ? reject(failure) : resolve(value);
		}
		worker.on('message', message); worker.on('error', error);
	});
}

async function benchmark() {
	const directory = await fs.mkdtemp(path.join(require('os').tmpdir(), 'bts-speech-io-'));
	const rows = [];
	try {
		for (let pair = -1; pair < 6; pair++) for (const execution of pair % 2 ? ['process', 'thread'] : ['thread', 'process']) {
			const folder = path.join(directory, execution + '-' + pair); await fs.mkdir(folder);
			const Class = execution === 'thread' ? Worker : require('../bts/offload/process');
			const worker = new Class(__filename, { workerData: { directory: folder } });
			try {
				await receive(worker, 'ready');
				const Datastore = require('nedb');
				const filename = path.join(folder, 'matches'), db = new Datastore({ filename });
				await promisify(db.loadDatabase.bind(db))();
				await promisify(db.insert.bind(db))({ _id: 'game', sequence: 0 });
				for (const [index, kind] of ['cache-persistence', 'pool-contention'].entries()) {
					const busy = receive(worker, 'busy'), done = receive(worker, 'done');
					worker.postMessage({ type: 'work', kind }); await busy;
					const began = performance.now();
					await promisify(db.update.bind(db))({ _id: 'game' }, { $inc: { sequence: 1 } }, {});
					const point_append_ms = performance.now() - began;
					await done;
					const reload = new Datastore({ filename }); await promisify(reload.loadDatabase.bind(reload))();
					assert.strictEqual((await promisify(reload.findOne.bind(reload))({ _id: 'game' })).sequence, index + 1);
					if (pair >= 0) rows.push({ execution, kind, pair, point_append_ms });
				}
			} finally { await worker.terminate(); }
		}
		const summary = {};
		for (const kind of ['cache-persistence', 'pool-contention']) {
			summary[kind] = {};
			for (const execution of ['thread', 'process']) {
				const times = rows.filter(row => row.kind === kind && row.execution === execution).map(row => row.point_append_ms).sort((a, b) => a - b);
				summary[kind][execution] = { count: times.length, median_ms: times[Math.floor(times.length / 2)], max_ms: times.at(-1) };
			}
		}
		return { created_at: new Date().toISOString(), node: process.version, threadpool_size: process.env.UV_THREADPOOL_SIZE,
			method: 'Six alternating pairs after warm-up; one libuv pool thread for controlled contention. Cache case writes ten synthetic ~3 MB metadata indexes. Contention case queues one PBKDF2 job before the persisted NeDB append. This proves pool separation, not speech causation in a live report. No live data, speech API, BTP, audio playback or browser.',
			validation: 'Every append verified after reloading its disposable file.', summary, rows };
	} finally { await fs.rm(directory, { recursive: true, force: true }); }
}

if (!isMainThread) workload(parentPort, workerData);
else if (process.send) {
	process.on('disconnect', () => process.exit(0));
	process.once('message', message => workload({ on: (type, fn) => process.on(type, fn), postMessage: value => process.send(value) }, message.workerData));
} else if (require.main === module) {
	if (process.env.UV_THREADPOOL_SIZE !== '1') {
		const result = require('child_process').spawnSync(process.execPath, [__filename], {
			env: { ...process.env, UV_THREADPOOL_SIZE: '1' }, stdio: 'inherit',
		});
		process.exitCode = result.status ?? 1;
	} else benchmark().then(value => console.log(JSON.stringify(value, null, 2)))
		.catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = benchmark;
