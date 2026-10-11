'use strict';

const path = require('path');
const fs = require('fs/promises');
const http = require('http');
const { promisify } = require('util');
const WebSocket = require('ws');
const { validate_archive } = require('./server');
const { response } = require('./fixture');
const { instrument, clock } = require('./instrument');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main({ root, directory, count, sync_interval_ms, set_points }) {
	await validate_archive(root, directory);
	const load = name => require(path.join(root, 'bts', name));
	const database = load('database'), admin = load('admin'), queue = load('update_queue');
	const db = await promisify(database.init)();
	await promisify(db.tournaments.insert.bind(db.tournaments))({ _id: 'queue-fixture', key: 'default', btp_enabled: true, btp_readonly: true,
		events: { events: [] }, call_preparation_matches_automatically_enabled: false, official_rotation_mode: 'disabled',
		call_next_possible_scheduled_match_in_preparation: false });
	const server = http.createServer(), wss = new WebSocket.Server({ server });
	const app = { db, wss, config: {} };
	await load('clock').init(app);
	const fixture = response(count);
	fixture.Result[0].Tournament[0].ScoringFormats[0].ScoringFormat[0].Score = [set_points];
	await load('btp_sync').sync_btp_data(app, 'default', fixture);
	const matches = (await db.matches.find_async({ tournament_key: 'default' })).sort((a, b) => a.setup.match_num - b.setup.match_num);
	const courts = (await db.courts.find_async({ tournament_key: 'default' })).sort((a, b) => a.num - b.num);
	if (matches.length !== count || courts.length !== 13) throw new Error('Unexpected fixture size');
	// The BTP fixture deliberately has no scheduled times. Plan its idle games
	// explicitly in this isolated database so real finishes can trigger calls.
	await db.matches.update_async({ tournament_key: 'default' }, { $set: { 'setup.state': 'scheduled' } }, { multi: true });
	for (let i = 0; i < 12; i++) await new Promise((resolve, reject) => admin.handle_match_call_on_court(app, {
		respond: (_request, error) => error ? reject(error) : resolve(),
	}, { tournament_key: 'default', match_id: matches[i]._id, court_id: courts[i]._id }));
	await db.tournaments.update_async({ key: 'default' }, { $set: {
		bupws_v2_enabled: true,
		call_next_possible_scheduled_match_in_preparation: true, call_on_court_only_preparation_enabled: false,
		call_on_court_participant_readiness_mode: 'disabled',
	} }, {});
	const measurement = instrument(root, db, queue, reason => process.send({ type: 'probe', reason }));
	const replans = [], traces = load('performance/traces'), original_phase = traces.phase;
	traces.phase = function(name, start, duration, details) {
		if (name === 'incremental_replan' && replans.length < 256) {
			const row = { start, duration, ...details }; replans.push(row);
			require('fs').appendFileSync(path.join(directory, 'replans.jsonl'), JSON.stringify(row) + '\n');
		}
		return original_phase.call(this, name, start, duration, details);
	};
	function observed(mod, names) {
		const result = { ...mod };
		for (const name of names) result['handle_' + name] = (...args) => measurement.run(name, () => mod['handle_' + name](...args));
		return result;
	}
	const admin_handlers = observed(admin, ['match_call_on_court', 'free_announce']);
	const tablet_handlers = observed(load('bupws_v2'), ['score_update']);
	wss.on('connection', (ws, request) => {
		if (request.url === '/ws/admin') load('wshandler').handle(admin_handlers, app, ws);
		else if (request.url === '/ws/bup_v2') load('wshandler').handle(tablet_handlers, app, ws);
		else ws.close(1008, 'Unknown route');
	});
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	process.send({ type: 'ready', url: 'http://127.0.0.1:' + server.address().port, match_id: matches[12]._id, court_id: courts[12]._id });
	let timer, sample_timer, sequence = 0, finishing = false;
	const syncs = [], pending = new Set(), sync_backlog_samples = [];
	function sync() {
		const row = { sequence: ++sequence, enqueued_ns: String(clock()) };
		syncs.push(row);
		// Use the real validated integration planner. Change idle games only:
		// replaying a stale full BTP fixture would reset live points/results.
		const work = measurement.run('sync', () => load('btp_sync_plan').sync(app, 'default', { sequence }, {
			task_name: 'mixed_ordering_apply', skip_unchanged: false,
		}, async staged => {
			row.planning_ns ||= String(clock());
			const idle = await staged.db.matches.find_async({ tournament_key: 'default', _id: { $ne: matches[12]._id },
				'setup.state': { $in: ['scheduled', 'unscheduled'] } });
			row.changed_matches = idle.length;
			for (const match of idle) {
				const number = Number(match.btp_match_ids[0].id) + (row.sequence % 2 ? 10000 : 0);
				await staged.db.matches.update_async({ _id: match._id }, { $set: {
					'setup.match_num': number, btp_match_ids: match.btp_match_ids.map(id => ({ ...id, nr: number })),
				} }, {});
				admin.notify_change(staged, 'default', 'match_edit', { match__id: match._id, match: { ...match, setup: { ...match.setup, match_num: number } } });
			}
			return true;
		})).then(() => { row.finished_ns = String(clock()); }, error => {
			row.error = error.message; process.send({ type: 'error', message: error.message });
		}).finally(() => pending.delete(work));
		pending.add(work);
	}
	process.on('message', async msg => {
		try {
			if (msg.type === 'start') {
				measurement.start(); sync(); timer = setInterval(sync, sync_interval_ms);
				sample_timer = setInterval(() => {
					const waiting = syncs.filter(row => !row.finished_ns && !row.error);
					sync_backlog_samples.push({ ns: String(clock()), pending: waiting.length,
						oldest_ms: waiting.length ? Number(clock() - BigInt(waiting[0].enqueued_ns)) / 1e6 : 0 });
				}, 100);
			}
			if (msg.type === 'finish' && !finishing) {
				finishing = true; clearInterval(timer);
				await Promise.all(pending);
				const deadline = Date.now() + 20000;
				let quiet = 0;
				while (Date.now() < deadline && quiet < 5) {
					await pause(40);
					const stats = queue.stats();
					const busy = stats.active_tasks.length || stats.pending_tasks.length || Object.values(db).some(store =>
						store?.executor && (store.executor.queue.length() || store.executor.queue.running()));
					quiet = busy ? 0 : quiet + 1;
				}
				const diagnostics = measurement.finish();
				clearInterval(sample_timer);
				const drained = quiet === 5 && diagnostics.tasks.every(row => row.finished_ns) && diagnostics.database.every(row => row.finished_ns);
				const final = await db.matches.find_async({ tournament_key: 'default' });
				const result = { drained, syncs, replans, sync_backlog_samples, matches: final.length, finished_matches: final.filter(match => match.end_ts).length,
					oncourt_matches: final.filter(match => match.setup.state === 'oncourt').length, ...diagnostics };
				await fs.writeFile(path.join(directory, 'server-result.json'), JSON.stringify(result));
				if (!drained || syncs.some(row => row.error)) throw new Error('Mixed workload failed to drain or integrate');
				process.send({ type: 'done', result: path.join(directory, 'server-result.json') });
			}
			if (msg.type === 'stop') {
				clearInterval(timer); clearInterval(sample_timer); db.compaction?.stop?.();
				for (const ws of wss.clients) ws.terminate();
				server.close(); process.exit(0);
			}
		} catch (error) { process.send({ type: 'error', message: error.message }); }
	});
}

if (require.main === module) main(JSON.parse(process.argv[2])).catch(error => { process.send?.({ type: 'error', message: error.message }); process.exit(1); });
