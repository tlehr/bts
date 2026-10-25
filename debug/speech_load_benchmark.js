'use strict';

const fs = require('fs/promises'), path = require('path'), os = require('os'), assert = require('assert');
const { fork, spawn, execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const WebSocket = require('ws');
const { score, digest } = require('./speech_load/fixture');
const { statistics } = require('./speech_load/stats');
const resources = require('./speech_load/resources');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const VARIANTS = [
	{ id: 'idle', threads: 4, nice: 0, generate: false },
	{ id: 'normal', threads: 4, nice: 0, generate: true },
	{ id: 'two-threads', threads: 2, nice: 0, generate: true },
	{ id: 'low-priority', threads: 4, nice: 10, generate: true },
];
const owned = new Set();
function track(child) { owned.add(child); child.once('exit', () => owned.delete(child)); return child; }

function inferenceOverlap(events, start, end) {
	let began = null, total = 0;
	for (const event of events.filter(e => !e.warmup)) {
		if (event.event === 'inference_start') began = event.ts;
		if (event.event === 'inference_end' && began !== null) {
			total += Math.max(0, Math.min(end, event.ts) - Math.max(start, began)); began = null;
		}
	}
	if (began !== null) total += Math.max(0, end - Math.max(start, began));
	return total;
}

function parse(argv) {
	const options = { seconds: 60, rounds: 2, point_ms: 80, matches: 373, fake: false,
		speech_repository: path.resolve(__dirname, '../../bts-sprachserver'), variants: VARIANTS.map(v => v.id) };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--fake') { options.fake = true; continue; }
		if (argv[i] === '--help') return { help: true };
		const key = { '--seconds': 'seconds', '--rounds': 'rounds', '--point-ms': 'point_ms', '--matches': 'matches',
			'--speech-repository': 'speech_repository', '--variants': 'variants', '--output': 'output' }[argv[i]];
		if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Invalid or missing benchmark option: ' + argv[i]);
		const value = argv[++i]; options[key] = key === 'variants' ? value.split(',') : ['speech_repository', 'output'].includes(key) ? path.resolve(value) : Number(value);
	}
	for (const [key, min, max] of [['seconds', 2, 600], ['rounds', 1, 8], ['point_ms', 20, 1000], ['matches', 13, 1000]]) {
		if (!Number.isSafeInteger(options[key]) || options[key] < min || options[key] > max) throw new Error('Invalid ' + key);
	}
	if (!options.variants.length || new Set(options.variants).size !== options.variants.length || options.variants.some(id => !VARIANTS.some(v => v.id === id))) throw new Error('Invalid variants');
	return options;
}

function childChannel(child) {
	const messages = [], pending = new Set();
	let error;
	child.on('error', e => { error = e; for (const check of pending) check(); });
	child.on('exit', (code, signal) => { error ||= new Error('Benchmark child exited: ' + code + '/' + signal); for (const check of pending) check(); });
	child.on('message', m => { if (m.type === 'error') error = new Error(m.message); else messages.push(m); for (const check of pending) check(); });
	return type => new Promise((resolve, reject) => {
		const timer = setTimeout(() => finish(new Error('Benchmark timeout waiting for ' + type)), 180000);
		const check = () => {
			const index = messages.findIndex(m => m.type === type);
			if (index >= 0) finish(null, messages.splice(index, 1)[0]); else if (error) finish(error);
		};
		function finish(failure, value) { clearTimeout(timer); pending.delete(check); failure ? reject(failure) : resolve(value); }
		pending.add(check); check();
	});
}

async function stop(child) {
	if (!child || child.exitCode !== null || child.signalCode) return;
	child.kill('SIGTERM');
	await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(10000)]);
	if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
}

async function api(options, directory, variant, key, signal) {
	const child = track(spawn(path.join(options.speech_repository, '.venv/bin/python'), [path.join(__dirname, 'speech_load/api.py')],
		{ stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } }));
	const events = [];
	let buffer = '', stderr = '';
	child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-6000); });
	child.stdout.on('data', bytes => {
		buffer += bytes;
		while (buffer.includes('\n')) {
			const at = buffer.indexOf('\n'), line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
			try { events.push(JSON.parse(line)); } catch (_) { /* Native libraries may print startup diagnostics. */ }
		}
	});
	child.stdin.end(JSON.stringify({ ...variant, directory, key, speech_repository: options.speech_repository, fake: options.fake }) + '\n');
	const deadline = Date.now() + 180000;
	try {
		while (!events.some(e => e.event === 'ready')) {
			signal?.throwIfAborted();
			if (Date.now() > deadline || child.exitCode !== null) throw new Error('Disposable speech API did not start: ' + stderr);
			await pause(100);
		}
		const ready = events.find(e => e.event === 'ready'), url = 'http://127.0.0.1:' + ready.port;
		let healthy = false;
		while (!healthy) {
			signal?.throwIfAborted();
			if (Date.now() > deadline || child.exitCode !== null) throw new Error('Disposable speech API did not become ready: ' + stderr);
			try { healthy = (await fetch(url + '/health', { signal: AbortSignal.timeout(2000) })).ok; } catch (_) { /* Still initializing. */ }
			if (!healthy) await pause(100);
		}
		return { child, events, ready, url };
	} catch (error) { await stop(child); throw error; }
}

async function connect(url, receive) {
	const ws = new WebSocket(url);
	ws.on('message', raw => {
		const received = performance.now(), message = JSON.parse(raw); receive(message, received);
		if (message.message_id && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'display_rendered',
			tournament_key: 'default', message_id: message.message_id, ok: true, render_ms: 0 }));
	});
	await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
	return ws;
}

async function runCase(options, root, variant, index, log, signal) {
	const directory = path.join(root, 'case-' + index), api_directory = path.join(root, 'api-' + index);
	await fs.mkdir(directory); await fs.mkdir(api_directory);
	const key = 'isolated-speech-load-' + 'x'.repeat(32), children = [], sockets = [];
	let sampler, sampling = false;
	try {
		log('Lade Modelle: ' + variant.id);
		const speech = await api(options, api_directory, variant, key, signal); children.push(speech.child);
		assert.strictEqual(speech.ready.nice, variant.nice, 'Benchmark must start at normal process priority');
		const server = track(fork(path.join(__dirname, 'speech_load/server.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
			env: { ...process.env, BTS_SPEECH_ENABLED: 'false' } })); children.push(server);
		const output = await fs.open(path.join(root, 'server-' + index + '.log'), 'w');
		server.stdout.on('data', b => output.write(b)); server.stderr.on('data', b => output.write(b));
		server.once('exit', () => output.close());
		const wait = childChannel(server); server.send({ directory, matches: options.matches, speech_url: speech.url, key, generate: false });
		const ready = await wait('ready');
		const pending = new Map(), rows = [], errors = [], tablets = [], admins = [];
		const receive = (target, m, received) => {
			if (m.type === 'error') errors.push(m.message);
			let id, values;
			if (target === 'tv' && m.type === 'display_points_update' && m.score?.current_set) {
				id = m.match_id; values = [[m.score.current_set.left, m.score.current_set.right]];
			} else if (target === 'admin' && m.ctype === 'score') { id = m.val.match_id; values = m.val.network_score; }
			const row = pending.get(id + ':' + JSON.stringify(values));
			if (row && row[target + '_ms'] === undefined) row[target + '_ms'] = received - row.sent;
		};
		for (let n = 1; n <= 13; n++) {
			sockets.push(await connect(ready.url + '/tv/' + n, (m, t) => receive('tv', m, t)));
			const tablet = await connect(ready.url + '/tablet/' + n, m => { if (m.type === 'error') errors.push(m.message); });
			tablets.push(tablet); sockets.push(tablet);
		}
		for (let i = 0; i < 11; i++) {
			const ws = await connect(ready.url + '/admin', (m, t) => { if (i === 0) receive('admin', m, t); });
			admins.push(ws); sockets.push(ws);
		}
		const send = (i, measured) => {
			const value = score(i), row = { index: i, sent: performance.now() };
			pending.set(value.match_id + ':' + JSON.stringify(value.network_score), row);
			if (measured) rows.push(row);
			tablets[i % 13].send(JSON.stringify({ type: 'score_update', tournament_key: 'default', score: value }));
		};
		for (let i = 1300; i < 1378; i++) { send(i, false); await pause(3); }
		await pause(300); pending.clear();
		let generator, generatorWait;
		if (variant.generate) {
			generator = track(fork(path.join(__dirname, 'speech_load/generator.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })); children.push(generator);
			generator.stdout.resume(); generator.stderr.resume();
			generatorWait = childChannel(generator);
			generator.send({ key, url: speech.url, directory: path.join(api_directory, 'bts-cache') });
			await generatorWait('ready'); generator.send({ type: 'start' });
			const deadline = Date.now() + 60000;
			while (!speech.events.some(e => e.event === 'inference_start' && !e.warmup)) {
				signal?.throwIfAborted();
				if (Date.now() > deadline) throw new Error('No real generation observed before measuring');
				await pause(50);
			}
		}
		server.send({ type: 'measure' }); await wait('measuring');
		const pids = { client: process.pid, bts: server.pid, api: speech.child.pid, ...(speech.ready.native_pid ? { native: speech.ready.native_pid } : {}),
			...(generator ? { generator: generator.pid } : {}) };
		const resource_samples = [];
		const collect = async () => {
			if (sampling) return; sampling = true;
			try { resource_samples.push(Object.fromEntries(await Promise.all(Object.entries(pids).map(async ([k, pid]) => [k, await resources.read(pid)])))); }
			finally { sampling = false; }
		};
		await collect(); sampler = setInterval(() => { void collect(); }, 500);
		const wall_start = Date.now(), began = performance.now(), total = Math.floor(options.seconds * 1000 / options.point_ms);
		log('Messe ' + variant.id + ': ' + total + ' Spielstandmeldungen');
		for (let i = 0; i < total; i++) {
			signal?.throwIfAborted();
			if (i > 0 && i % Math.ceil(15000 / options.point_ms) === 0) log(variant.id + ': ' + i + '/' + total);
			await pause(Math.max(0, began + i * options.point_ms - performance.now()));
			send(i, true); rows.at(-1).send_lag_ms = performance.now() - began - i * options.point_ms;
			if (i % Math.max(1, Math.floor(1000 / options.point_ms)) === 0) admins[Math.floor(i * options.point_ms / 1000) % admins.length].send(JSON.stringify({
				type: 'tournament_get', key: 'default', rid: i + 1 }));
		}
		await pause(Math.max(0, began + options.seconds * 1000 - performance.now()));
		const wall_end = Date.now(); clearInterval(sampler);
		while (sampling) await pause(1);
		await collect();
		const deadline = Date.now() + 10000;
		while (rows.some(r => r.tv_ms === undefined || r.admin_ms === undefined) && Date.now() < deadline) await pause(20);
		if (errors.length) throw new Error('Score handler errors: ' + errors.slice(0, 5).join('; '));
		if (rows.some(r => r.tv_ms === undefined || r.admin_ms === undefined)) throw new Error('Unmatched score reception: ' + JSON.stringify(rows.filter(r => r.tv_ms === undefined || r.admin_ms === undefined).slice(0, 3)));
		server.send({ type: 'finish' }); const measured = (await wait('done')).result;
		let generation;
		if (generator) { generator.send({ type: 'finish' }); generation = (await generatorWait('done')).result; }
		assert(!measured.failed_traces.length, 'failed server operations');
		const ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
		const io = Object.fromEntries(Object.keys(pids).map(name => [name, resources.delta(resource_samples[0][name], resource_samples.at(-1)[name], ticks)]));
		if (Object.values(io).some(r => !r.available)) throw new Error('Process CPU/I/O metrics unavailable');
		const inference = speech.events.filter(e => !e.warmup && e.ts >= wall_start && e.ts <= wall_end);
		const overlap = inferenceOverlap(speech.events, wall_start, wall_end);
		if (variant.generate && !options.fake && overlap < (wall_end - wall_start) * .25) throw new Error('Insufficient active synthesis during score measurement');
		return { variant, fake: options.fake, pid_settings: speech.ready, fixture_sha256: ready.fixture_sha256,
			input_sha256: digest(Array.from({ length: total }, (_, i) => score(i))), total, wall_start, wall_end,
			tv_ms: statistics(rows.map(r => r.tv_ms)), admin_ms: statistics(rows.map(r => r.admin_ms)), send_lag_ms: statistics(rows.map(r => r.send_lag_ms)),
			process_resources: io, resource_samples, generation, synthesis_events: speech.events, synthesis_during_window: inference,
			inference_overlap_ms: overlap,
			server: measured, receptions: rows };
	} finally {
		clearInterval(sampler); for (const ws of sockets) ws.terminate();
		for (const child of children.reverse()) await stop(child);
	}
}

async function run(options, log = console.log) {
	if (process.platform !== 'linux') throw new Error('This benchmark requires Linux /proc CPU and I/O counters');
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-speech-load-'));
	if (options.output) { const handle = await fs.open(options.output, 'wx'); await handle.close(); }
	const controller = new AbortController();
	const interrupt = () => { controller.abort(); for (const child of owned) child.kill('SIGTERM'); };
	process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
	const report = { status: 'running', started_at: new Date().toISOString(), directory: root, options, node: process.version,
		cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length, available_parallelism: os.availableParallelism?.(), cases: [],
		method: 'Identical 373-match fixtures and fixed score sequences, real file-backed BTS handlers and 13 TV/tablet sockets plus 11 admin sockets. A separate production SpeechBroker and real temporary speech API create native context sources, cuts and both audio caches. Idle keeps the same model resident. Four variants, reversed order in alternating rounds. The controlled BTS has speech management disabled in every variant, isolating external generation/resource load from its database. No BTP, browser painting or audible output.',
		limitations: ['Alternating score states keep the same thirteen matches active; this is not a full tournament or a live latency forecast.',
			'Linux process I/O counters include page-cache traffic. Read/write bytes are not disk saturation or per-request disk service time.',
			'CPU counters cover the long-lived measured processes; short-lived alignment/ffmpeg children may be absent.',
			'Wall-time spans include callback/scheduling delays and may overlap. No live server or production cache is used.'] };
	const source_files = ['debug/speech_load_benchmark.js', 'debug/speech_load/server.js', 'debug/speech_load/fixture.js',
		'debug/speech_load/generator.js', 'debug/speech_load/api.py', 'debug/speech_load/resources.js',
		'bts/bupws_v2.js', 'bts/score_write.js', 'bts/database_tasks.js', 'bts/update_queue.js',
		'bts/speech/broker.js', 'bts/speech/disk_cache.js', 'package-lock.json'];
	const sources = async () => Object.fromEntries(await Promise.all(source_files.map(async name => [name,
		require('crypto').createHash('sha256').update(await fs.readFile(path.resolve(__dirname, '..', name))).digest('hex')])));
	report.source_sha256 = await sources();
	const save = async () => {
		await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
		if (options.output) await fs.writeFile(options.output, JSON.stringify(report, null, 2));
	};
	try {
		await save();
		for (let round = 0; round < options.rounds; round++) {
			const order = options.variants.map(id => VARIANTS.find(v => v.id === id)); if (round % 2) order.reverse();
			for (const variant of order) {
				const row = await runCase(options, root, variant, report.cases.length, log, controller.signal); row.round = round;
				if (report.cases.length) {
					assert.strictEqual(row.fixture_sha256, report.cases[0].fixture_sha256);
					assert.strictEqual(row.input_sha256, report.cases[0].input_sha256);
					assert.strictEqual(row.server.final_state_sha256, report.cases[0].server.final_state_sha256);
				}
				report.cases.push(row); await save();
				log(variant.id + ': TV p99 ' + row.tv_ms.p99.toFixed(1) + ' ms / Admin p99 ' + row.admin_ms.p99.toFixed(1) + ' ms');
			}
		}
		assert.deepStrictEqual(await sources(), report.source_sha256, 'Benchmark sources changed while comparing');
		report.status = 'completed';
		report.summary = options.variants.map(id => {
			const cases = report.cases.filter(row => row.variant.id === id);
			return { id, tv_ms: statistics(cases.flatMap(c => c.receptions.map(r => r.tv_ms))),
				admin_ms: statistics(cases.flatMap(c => c.receptions.map(r => r.admin_ms))),
				individual_p99: cases.map(c => ({ tv: c.tv_ms.p99, admin: c.admin_ms.p99 })) };
		});
		return report;
	} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
	finally {
		process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
		for (const child of owned) await stop(child);
		report.finished_at = new Date().toISOString(); await save();
	}
}

if (require.main === module) {
	const options = parse(process.argv.slice(2));
	if (options.help) console.log('Disposable speech/score contention comparison. --seconds 60 --rounds 2 --point-ms 80 --variants idle,normal,two-threads,low-priority --output /tmp/report.json. --fake is a functional smoke test only.');
	else run(options).then(report => console.log(JSON.stringify({ directory: report.directory, summary: report.summary }, null, 2)))
		.catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run, parse, VARIANTS, runCase, stop, childChannel, inferenceOverlap, api };
