'use strict';

const fs = require('fs/promises'), path = require('path'), os = require('os'), assert = require('assert');
const { fork, execFileSync } = require('child_process');
const WebSocket = require('ws');
const { api, stop, childChannel, parse, VARIANTS, inferenceOverlap } = require('./speech_load_benchmark');
const resources = require('./speech_load/resources');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function adminSocket(url) {
	const ws = new WebSocket(url + '/ws/admin'), pending = new Map();
	let serial = 0;
	ws.on('message', bytes => {
		const message = JSON.parse(bytes), job = pending.get(message.rid);
		if (!job) return;
		pending.delete(message.rid); clearTimeout(job.timer);
		if (message.type === 'error' || message.speech_error) job.reject(new Error(message.message || message.speech_error));
		else job.resolve(message);
	});
	await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
	return { ws, request: value => new Promise((resolve, reject) => {
		const rid = ++serial, timer = setTimeout(() => { pending.delete(rid); reject(new Error('Admin request timeout: ' + value.type)); }, 10000);
		pending.set(rid, { resolve, reject, timer }); ws.send(JSON.stringify({ ...value, rid }));
	}) };
}

async function finishPreflight(url, admin) {
	const ws = new WebSocket(url + '/tablet/1');
	const errors = [];
	ws.on('message', raw => { const message = JSON.parse(raw); if (message.type === 'error') errors.push(message.message); });
	await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
	try {
		ws.send(JSON.stringify({ type: 'score_update', tournament_key: 'default', score: {
			match_id: 'game-1', court_id: 'court-1', network_score: [[21, 0], [21, 0]],
			team1_won: true, finish_confirmed: true, end_ts: Date.now(), presses: [],
		} }));
		const deadline = Date.now() + 10000;
		while (Date.now() < deadline) {
			assert(!errors.length, errors.join(', '));
			const { tournament } = await admin.request({ type: 'tournament_get', key: 'default' });
			const first = tournament.matches.find(m => m._id === 'game-1');
			const next = tournament.matches.find(m => m._id === 'game-14');
			if (first?.setup.state === 'finished' && next?.setup.state === 'oncourt' && next.setup.court_id === 'court-1') {
				return { finished: first._id, automatic_successor: next._id, court: next.setup.court_id };
			}
			await pause(100);
		}
		throw new Error('Preflight finish did not trigger the automatic successor');
	} finally { ws.terminate(); }
}

async function run({ variant, seconds, output, fake = false }, log = console.log) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-speech-load-'));
	const children = [], admins = [], errors = [], polls = [], resource_samples = [];
	let sampler, pollTimer, sampling = false, polling = false;
	const controller = new AbortController();
	const interrupt = () => { controller.abort(); for (const child of children) child.kill('SIGTERM'); };
	process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
	const report = { status: 'running', directory: root, variant, seconds, fake,
		method: 'Unmodified tournament test client and reception worker, 373 fictional matches, 13 tablets/TVs, ten additional admin connections, real file-backed BTS and integrated speech process. Planning, queue and game overview polled every two seconds. Real disposable Kitten API. No BTP, browser painting or audible output.' };
	if (output) { const file = await fs.open(output, 'wx'); await file.close(); }
	try {
		const options = parse([]), key = 'isolated-speech-load-' + 'x'.repeat(32);
		const directory = path.join(root, 'case-0'), apiDirectory = path.join(root, 'api-0');
		await fs.mkdir(directory); await fs.mkdir(apiDirectory);
		log('Lade isolierten Sprachserver: ' + variant.id);
		const speech = await api({ ...options, fake }, apiDirectory, variant, key, controller.signal); children.push(speech.child);
		assert.strictEqual(speech.ready.nice, variant.nice);
		if (speech.ready.native_pid) assert.strictEqual((await resources.read(speech.ready.native_pid)).nice, variant.nice);
		const server = fork(path.join(__dirname, 'speech_load/server.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); children.push(server);
		const serverLog = await fs.open(path.join(root, 'server.log'), 'w');
		server.stdout.on('data', b => serverLog.write(b)); server.stderr.on('data', b => serverLog.write(b));
		server.once('exit', () => serverLog.close());
		const wait = childChannel(server);
		server.send({ directory, matches: 373, speech_url: speech.url, key, generate: variant.generate, integrated: true, normal: true });
		const ready = await wait('ready'); report.fixture_sha256 = ready.fixture_sha256;
		for (let i = 0; i < 10; i++) {
			const admin = await adminSocket(ready.url); admins.push(admin);
			await admin.request({ type: 'tournament_get', key: 'default', defer_finished_history: true });
		}
		report.preflight = await finishPreflight(ready.url, admins[0]);
		log('Spielabschluss und automatischer Folgeaufruf geprüft');
		server.send({ type: 'start' }); await wait('started');
		if (variant.generate) {
			const deadline = Date.now() + 120000;
			while (!speech.events.some(e => e.event === 'inference_start' && !e.warmup)) {
				controller.signal.throwIfAborted();
				if (Date.now() > deadline) throw new Error('Integrated worker did not start synthesis');
				await pause(100);
			}
		}
		let revision;
		const poll = async () => {
			if (polling) return; polling = true;
			const began = Date.now();
			try {
				const answers = await Promise.all(['speech_planning', 'speech_queue', 'speech_games'].map(type => admins[0].request({
					type, tournament_key: 'default', pending_only: true,
					...(type === 'speech_games' && revision ? { revision } : {}),
				})));
				revision = answers[2].games?.revision;
				polls.push({ ts: began, elapsed_ms: Date.now() - began,
					state: answers[0].planning?.state, current: answers[0].planning?.current?.planning?.stage,
					queue: answers[1].queue?.length, games: answers[2].games?.items?.length });
			} catch (error) { errors.push(error.message); }
			finally { polling = false; }
		};
		// Do not poll a browser-only configuration as if it had a speech plan.
		if (variant.generate) { await poll(); pollTimer = setInterval(() => void poll(), 2000); }
		server.send({ type: 'measure' }); const measuring = await wait('measuring');
		const pids = { controller: process.pid, bts: server.pid, api: speech.child.pid,
			...(speech.ready.native_pid ? { native: speech.ready.native_pid } : {}),
			...(measuring.speech_pid ? { speech: measuring.speech_pid } : {}) };
		const client = fork(path.join(__dirname, 'speech_load/normal_client.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); children.push(client);
		client.stdout.resume(); client.stderr.on('data', bytes => log(bytes.toString().trim()));
		pids.client = client.pid;
		const clientWait = childChannel(client);
		client.send({ url: ready.url.replace(/^ws/, 'http'), client_module: require('./testclient_bridge').module_path('live_tournament_drill'),
			duration_ms: seconds * 1000, report: path.join(root, 'client.json') });
		await clientWait('ready');
		const collect = async () => {
			if (sampling) return; sampling = true;
			try { resource_samples.push(Object.fromEntries(await Promise.all(Object.entries(pids).map(async ([k, pid]) => [k, await resources.read(pid)])))); }
			finally { sampling = false; }
		};
		await collect(); sampler = setInterval(() => void collect(), 500);
		const start = Date.now();
		log('Normaler Turniertest: ' + seconds + ' Sekunden');
		const completed = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Normal test timed out')), (seconds + 60) * 1000);
			client.on('message', message => {
				if (message.type === 'progress') log('Turniertest: ' + Math.round(message.elapsed_ms / 1000) + '/' + seconds + ' Sekunden');
				if (message.type === 'done' || message.type === 'error') {
					clearTimeout(timer); message.type === 'done' ? resolve(message.report) : reject(new Error(message.message));
				}
			});
			client.once('exit', code => { clearTimeout(timer); reject(new Error('Normal client exited: ' + code)); });
		});
		client.send({ type: 'start' });
		report.client = await completed;
		for (const key of ['tablet_to_tv_ms', 'tablet_to_admin_ms']) {
			const metric = report.client[key];
			assert.strictEqual(metric.unmatched_updates, 0, 'Missing score reception: ' + key);
			assert.strictEqual(metric.count, metric.sent_updates, 'Incomplete score reception: ' + key);
		}
		const end = Date.now(); clearInterval(sampler); clearInterval(pollTimer);
		while (sampling || polling) await pause(20);
		await collect();
		server.send({ type: 'finish' }); report.server = (await wait('done')).result;
		const serverText = await fs.readFile(path.join(root, 'server.log'), 'utf8');
		report.server_log = serverText;
		assert(!/TypeError|ReferenceError|SyntaxError|queued auto call [^\n]*failed/.test(serverText), 'Runtime error in server log');
		assert(!report.server.failed_traces.length, 'Server handler failure');
		assert(!errors.length, 'Speech preparation polling failed: ' + errors.join(', '));
		report.start = start; report.end = end; report.polls = polls;
		report.inference_overlap_ms = inferenceOverlap(speech.events, start, end);
		report.synthesis_events = speech.events; report.pid_settings = speech.ready;
		if (variant.generate && !fake) assert(report.inference_overlap_ms >= (end - start) * .25, 'Insufficient active synthesis');
		const ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
		report.resources = Object.fromEntries(Object.keys(pids).map(k => [k, resources.delta(resource_samples[0][k], resource_samples.at(-1)[k], ticks)]));
		report.status = 'completed'; return report;
	} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
	finally {
		clearInterval(sampler); clearInterval(pollTimer);
		for (const admin of admins) admin.ws.terminate();
		for (const child of children.reverse()) await stop(child);
		process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
		report.errors = errors; report.finished_at = new Date().toISOString();
		await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
		if (output) await fs.writeFile(output, JSON.stringify(report, null, 2));
	}
}

if (require.main === module) {
	const args = parse(process.argv.slice(2));
	if (args.variants.length !== 1) throw new Error('Select exactly one --variants value');
	run({ variant: VARIANTS.find(v => v.id === args.variants[0]), seconds: args.seconds, output: args.output, fake: args.fake })
		.then(r => console.log(JSON.stringify({ status: r.status, directory: r.directory, tv: r.client.tablet_to_tv_ms, admin: r.client.tablet_to_admin_ms })))
		.catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run };
