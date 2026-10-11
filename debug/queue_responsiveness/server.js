'use strict';

const path = require('path');
const http = require('http');
const fs = require('fs/promises');
const os = require('os');
const { promisify } = require('util');
const WebSocket = require('ws');
const { response } = require('./fixture');
const { instrument, clock } = require('./instrument');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function validate_archive(root, directory) {
	const [archive, output, temporary] = await Promise.all([fs.realpath(root), fs.realpath(directory), fs.realpath(os.tmpdir())]);
	const job = path.dirname(archive);
	if (archive !== path.resolve(root) || path.dirname(job) !== temporary ||
		!path.basename(job).startsWith('bts-queue-responsiveness-') || !/^server-\d+$/.test(path.basename(archive)) ||
		path.dirname(output) !== job) throw new Error('Benchmark server requires its own temporary archive');
}

async function main({ root, directory, count, phase, delay_ms }) {
	// Reject an accidental direct invocation against a working/live checkout
	// before loading persistent databases or triggering any server hooks.
	await validate_archive(root, directory);
	const load = name => require(path.join(root, 'bts', name));
	const database = load('database'), admin = load('admin'), queue = load('update_queue');
	const db = await promisify(database.init)();
	await promisify(db.tournaments.insert.bind(db.tournaments))({ _id: 'queue-fixture', key: 'default', btp_enabled: true, btp_readonly: true,
		events: { events: [] }, call_preparation_matches_automatically_enabled: false,
		call_matches_on_free_courts_automatically_enabled: false, assign_umpires_automatically_enabled: false });
	const server = http.createServer(), wss = new WebSocket.Server({ server });
	const app = { db, wss, config: {}, clock: { now_ms: Date.now, real_now_ms: Date.now } };
	await load('btp_sync').sync_btp_data(app, 'default', response(count));
	const matches = await db.matches.find_async({ tournament_key: 'default' });
	if (matches.length !== count) throw new Error('Unexpected fixture match count ' + matches.length);
	const match = matches.find(m => m.setup.match_num === 1);
	const courts = await db.courts.find_async({ tournament_key: 'default' });
	const court = courts.find(c => c.num === 1) || courts[0];
	if (!match || !court) throw new Error('Fixture has no callable match/court');
	let triggered = false, trigger_ns, request_ns, reply_ns, sync_end_ns, finished = false, fetch_done;
	const dispatch = {};
	function trigger(reason) {
		if (triggered) return;
		triggered = true; trigger_ns = String(clock()); process.send({ type: 'probe', reason, trigger_ns });
	}
	const measurement = instrument(root, db, queue, trigger);
	const handlers = { ...admin };
	for (const name of ['match_call_on_court', 'free_announce']) {
		handlers['handle_' + name] = (_app, ws, msg) => measurement.run(name, () => {
			dispatch[msg.rid] = String(clock());
			return admin['handle_' + name](app, ws, msg);
		});
	}
	wss.on('connection', ws => load('wshandler').handle(handlers, app, ws));
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	process.send({ type: 'ready', url: 'ws://127.0.0.1:' + server.address().port, match_id: match._id, court_id: court._id, count });
	const conn = Object.create(load('btp_conn').BTPConn.prototype);
	Object.assign(conn, { app, tkey: 'default', password: '', terminated: false, enabled_autofetch: false,
		publish_status() {}, report_status() {}, schedule_fetch() {}, schedule_reconnect() {},
		send(_request, callback) {
			request_ns = String(clock());
			if (phase === 'slow-fetch') trigger('btp_request_started');
			setTimeout(() => {
				reply_ns = String(clock());
				if (phase === 'unchanged-sync') trigger('unchanged_response_received');
				callback(phase === 'slow-fetch' ? null : response(count, phase === 'changed-sync'));
			}, phase === 'slow-fetch' ? delay_ms : 0);
			return () => {};
		},
	});
	process.on('message', async msg => {
		try {
			if (msg.type === 'start') {
				measurement.start();
				if (phase === 'idle') { trigger('idle_control'); fetch_done = Promise.resolve(); }
				else {
					fetch_done = measurement.run('sync', () => {
						if (queue.stats) return conn.sync_data();
						// Exactly the old sync_data enqueue, retaining its promise for cleanup.
						return queue.instance().execute(queue.hang_after(120000, queue.named('fetch', conn.fetch)), conn, false);
					});
				}
				Promise.resolve(fetch_done).then(() => {
					if (phase !== 'idle') sync_end_ns = String(clock());
					if (!triggered) process.send({ type: 'error', message: 'Sync completed without observing a live match writer' });
				}, error => process.send({ type: 'error', message: error.message }));
			}
			if (msg.type === 'finish' && !finished) {
				finished = true; await fetch_done;
				// Drain real follow-up queues and database executors; do not silently
				// equate a finished root operation with an empty backlog.
				const deadline = Date.now() + 15000;
				let quiet = 0, snapshot;
				while (Date.now() < deadline && quiet < 3) {
					await pause(20);
					snapshot = queue.stats ? queue.stats() : { pending_tasks: queue.instance().queue, active: queue.instance().active };
					const busy = snapshot.active || snapshot.active_tasks?.length || snapshot.pending_tasks?.length ||
						Object.values(db).some(store => store?.executor && (store.executor.queue.length() || store.executor.queue.running()));
					quiet = busy ? 0 : quiet + 1;
				}
				if (quiet < 3) throw new Error('Queues failed to drain');
				const diagnostics = measurement.finish();
				if (diagnostics.tasks.some(task => !task.finished_ns) || diagnostics.database.some(task => !task.finished_ns)) {
					throw new Error('Observed tasks failed to finish');
				}
				const after = await db.matches.find_async({ tournament_key: 'default' });
				const changed_matches = after.filter(m => m.setup.match_num >= 10000).length;
				if (phase === 'changed-sync' && changed_matches !== count - 1) throw new Error('Incomplete sync changes');
				const result = { phase, request_ns, reply_ns, sync_end_ns, trigger_ns, dispatch, changed_matches, drained: true,
					offload_features: queue.stats ? load('offload/profile').snapshot().features : null, ...diagnostics };
				await fs.writeFile(path.join(directory, 'server-result.json'), JSON.stringify(result, null, 2));
				process.send({ type: 'done', result: path.join(directory, 'server-result.json') });
			}
			if (msg.type === 'stop') {
				conn.terminate({ silent: true }); db.compaction?.stop?.();
				for (const ws of wss.clients) ws.terminate();
				server.close(); process.exit(0);
			}
		} catch (error) { process.send({ type: 'error', message: error.message }); process.exitCode = 1; }
	});
}

if (require.main === module) main(JSON.parse(process.argv[2])).catch(error => { process.send?.({ type: 'error', message: error.message }); process.exit(1); });
module.exports = { main, validate_archive };
