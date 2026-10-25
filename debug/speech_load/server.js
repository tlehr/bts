'use strict';

const fs = require('fs/promises'), path = require('path'), os = require('os');
const http = require('http'), { promisify } = require('util');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
const assert = require('assert');
const Datastore = require('nedb'), WebSocket = require('ws');
const { fixture, digest, TABLES, NOW } = require('./fixture');
const statistics = values => require('./stats').statistics(values);

async function validate(directory) {
	const resolved = await fs.realpath(directory), temporary = await fs.realpath(os.tmpdir());
	if (resolved !== path.resolve(directory) || path.dirname(path.dirname(resolved)) !== temporary ||
		!path.basename(path.dirname(resolved)).startsWith('bts-speech-load-') || !/^case-\d+$/.test(path.basename(resolved))) {
		throw new Error('Speech benchmark requires a fresh case directory in its own temporary root');
	}
	if ((await fs.readdir(resolved)).length) throw new Error('Speech benchmark case directory must be empty');
}

async function main(options) {
	await validate(options.directory);
	const database = require('../../bts/database'), admin = require('../../bts/admin'), bup = require('../../bts/bupws_v2');
	const traces = require('../../bts/performance/traces');
	const db = {};
	for (const name of TABLES) {
		db[name] = new Datastore({ filename: path.join(options.directory, name) });
		await promisify(db[name].loadDatabase.bind(db[name]))();
	}
	database.setup_helpers(db);
	const data = fixture(options.matches);
	if (options.normal) Object.assign(data.tournaments[0], {
		call_next_possible_scheduled_match_in_preparation: true,
		call_on_court_only_preparation_enabled: false,
		call_on_court_participant_readiness_mode: 'disabled',
		announcement_speech_mode: options.generate ? 'server' : 'browser',
	});
	if (options.normal) {
		// The production finish/call paths also consult external identifiers
		// before the disabled BTP manager discards outgoing updates.
		for (const match of data.matches) {
			match.btp_id = match.setup.match_num;
			match.btp_match_ids = [{ id: match.setup.match_num, nr: match.setup.match_num }];
		}
		for (const court of data.courts) court.btp_id = court.num;
	}
	for (const [name, documents] of Object.entries(data)) if (documents.length) await promisify(db[name].insert.bind(db[name]))(documents);
	const baseline = digest(data);
	const server = http.createServer(), wss = new WebSocket.Server({ server });
	const app = { db, wss, config: { host: '127.0.0.1', port: 0, speech: { enabled: options.integrated === true, worker: true, worker_type: 'process',
		url: options.speech_url, api_key: options.key, cache_dir: path.join(options.directory, 'speech-cache'),
		audio_port: 0, submit_interval_ms: 50, poll_interval_ms: 100 } },
		clock: { now_ms: () => NOW, real_now_ms: Date.now, get_state: () => ({ mode: 'fixed', fixed_ts: NOW }) } };
	if (options.normal) await require('../../bts/clock').init(app);
	app.speech = require('../../bts/speech').create(app);
	app.speech.configure({ ...data.tournaments[0], announcement_speech_mode: options.generate ? 'server' : 'browser' });
	wss.on('connection', (ws, req) => {
		const route = /^\/(tv|tablet)\/(\d+)$/.exec(req.url);
		if (req.url === '/admin' || req.url === '/ws/admin') require('../../bts/wshandler').handle(admin, app, ws);
		else if (req.url === '/ws/bup_v2') require('../../bts/wshandler').handle(bup, app, ws);
		else if (route && Number(route[2]) >= 1 && Number(route[2]) <= 13) {
			require('../../bts/wshandler').handle(bup, app, ws);
			Object.assign(ws, { client_id: (route[1] === 'tv' ? 'tv' : 'tablet') + '-court-' + route[2],
				hostname: route[1] + '-court-' + route[2], court_id: 'court-' + route[2],
				panel_devicemode: route[1] === 'tv' ? 'display' : 'umpire', last_tournament_key: 'default',
				last_v2_match_id: 'game-' + route[2] });
		} else ws.close(1008, 'Unknown benchmark route');
		ws.last_tournament_key = 'default';
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	let snapshot_timer, measured = false;
	const records = new Map(), samples = [], loop = monitorEventLoopDelay({ resolution: 10 });
	let cpu_start, wall_start, event_start;
	const send = value => process.send?.(value);
	process.on('message', async message => {
		try {
			if (message.type === 'start') {
				app.speech.start(); send({ type: 'started' });
			} else if (message.type === 'measure') {
				measured = true; traces.enable(); loop.enable(); cpu_start = process.cpuUsage(); wall_start = performance.now(); event_start = performance.eventLoopUtilization();
				snapshot_timer = setInterval(() => {
					traces.enable(); const snapshot = traces.snapshot(0);
					for (const record of snapshot.completed) records.set(record.id, record);
					samples.push({ elapsed_ms: performance.now() - wall_start, memory: process.memoryUsage(),
						speech: app.speech.diagnostics?.(), loop_max_ms: loop.max / 1e6 });
				}, 500);
				send({ type: 'measuring', speech_pid: app.speech.diagnostics?.().pid });
			} else if (message.type === 'finish') {
				clearInterval(snapshot_timer); measured = false;
				const loop_result = { p99_ms: loop.percentile(99) / 1e6, max_ms: loop.max / 1e6 };
				loop.disable();
				const cpu = process.cpuUsage(cpu_start), wall_ms = performance.now() - wall_start;
				const elu = performance.eventLoopUtilization(event_start);
				const deadline = Date.now() + 10000;
				while (Date.now() < deadline && Object.values(db).some(s => s?.executor && (s.executor.queue.running() || s.executor.queue.length()))) {
					await new Promise(resolve => setTimeout(resolve, 20));
				}
				for (const record of traces.snapshot(0).completed) records.set(record.id, record);
				const timings = new Map();
				for (const record of records.values()) for (const span of record.spans) {
					const key = span.kind + ':' + span.name;
					if (!timings.has(key)) timings.set(key, []);
					timings.get(key).push(span.duration_ms);
					if (span.name === 'matches:score_update_write' && span.kind === 'db_run') {
						for (const field of ['storage_wait_ms', 'serialization_ms', 'callback_ms']) {
							if (!timings.has(field)) timings.set(field, []);
							timings.get(field).push(span[field]);
						}
					}
				}
				const final = await db.matches.find_async({});
				const reload = new Datastore({ filename: db.matches.filename }); await promisify(reload.loadDatabase.bind(reload))();
				const sort = rows => rows.sort((a, b) => a._id.localeCompare(b._id));
				const model = require('nedb/lib/model');
				const persisted = rows => sort(rows).map(document => model.deserialize(model.serialize(document)));
				assert.deepStrictEqual(persisted(await promisify(reload.find.bind(reload))({})), persisted(final));
				const state = final.map(m => ({ id: m._id, score: m.network_score, state: m.setup.state, order: m.match_order }));
				const result = { fixture_sha256: baseline, final_state_sha256: digest(state), final_scores: state.filter(row => row.state === 'oncourt'),
					cpu_ms: { user: cpu.user / 1000, system: cpu.system / 1000, wall: wall_ms }, event_loop_utilization: elu.utilization,
					loop: loop_result,
					phase_ms: Object.fromEntries([...timings].map(([key, values]) => [key, statistics(values)])),
					failed_traces: [...records.values()].filter(row => row.status === 'error').map(row => ({ name: row.name, id: row.id })),
					samples, validated_persisted_reload: true };
				app.speech.stop(); await fs.writeFile(path.join(options.directory, 'server-result.json'), JSON.stringify(result));
				send({ type: 'done', result });
			} else if (message.type === 'stop') process.exit(0);
		} catch (error) { send({ type: 'error', message: error.stack }); }
	});
	process.on('disconnect', () => { clearInterval(snapshot_timer); app.speech.stop(); process.exit(0); });
	process.on('SIGTERM', () => { if (measured) clearInterval(snapshot_timer); app.speech.stop(); process.exit(0); });
	send({ type: 'ready', url: 'ws://127.0.0.1:' + server.address().port, fixture_sha256: baseline });
}

if (require.main === module) process.once('message', options => main(options).catch(error => {
	process.send?.({ type: 'error', message: error.stack }); process.exitCode = 1;
}));
module.exports = { validate };
