'use strict';

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const admin = require('../bts/admin');
const wshandler = require('../bts/wshandler');
const Datastore = require('nedb');
const database_tasks = require('../bts/database_tasks');
const update_queue = require('../bts/update_queue');
const { Dashboard, AdminWsClient, parse_args } = require('../debug/live_tournament_drill');

describe('live drill admin WebSocket reception', function() {
	it('reads server telemetry while a reserved overview holds normal admin changes, without queueing DB work', async function() {
		const server = http.createServer(), sockets = new WebSocket.Server({ server });
		const store = new Datastore({ inMemoryOnly: true }); database_tasks.attach(store, 'matches');
		const app = { db: { matches: store } }, connected = [];
		sockets.on('connection', ws => { connected.push(ws); wshandler.handle(admin, app, ws); });
		let normal, probe, finish;
		try {
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			const base = 'http://127.0.0.1:' + server.address().port;
			normal = new AdminWsClient(base, 'default'); await normal.connect();
			probe = new AdminWsClient(base, 'default'); await probe.connect();
			finish = connected[0].reserve_response({ rid: 'held-overview', key: 'default' });
			admin.notify_change(app, 'default', 'score', { match_id: 'one', network_score: [[1, 0]] });
			const queue_before = update_queue.stats().enqueued_count, db_before = database_tasks.health(store).enqueued_count;
			const result = await probe.send('debug_performance_stats', { probe: true }, 1000);
			const telemetry = result.performance;
			assert.strictEqual(telemetry.scope, 'server-wide'); assert(telemetry.server_id);
			assert.strictEqual(telemetry.database[0].observed, true);
			assert.strictEqual(telemetry.outgoing.sockets, 1); assert.strictEqual(telemetry.outgoing.pending, 2);
			assert.strictEqual(normal.changes.length, 0);
			assert.strictEqual(update_queue.stats().enqueued_count, queue_before);
			assert.strictEqual(database_tasks.health(store).enqueued_count, db_before);
			probe.changes.length = 0;
			admin.notify_change(app, 'default', 'score', { match_id: 'one', network_score: [[2, 0]] });
			await probe.send('debug_performance_stats', { probe: true }, 1000);
			assert.strictEqual(probe.changes.length, 0, 'probe must not receive duplicate tournament traffic');
			finish(null, { type: 'answer', status: 'ok' }); finish = null;
		} finally {
			if (finish) finish(null, {});
			if (normal) normal.close(); if (probe) probe.close();
			for (const ws of sockets.clients) ws.terminate();
			await new Promise(resolve => sockets.close(resolve));
			if (server.listening) await new Promise(resolve => server.close(resolve));
		}
	});
	it('matches a production admin score notification after tablet traffic on a separate connection', async function() {
		const server = http.createServer(), sockets = new WebSocket.Server({ server }), app = {};
		const dashboard = new Dashboard(parse_args([]));
		sockets.on('connection', (ws, request) => {
			if (request.url === '/ws/admin') wshandler.handle(admin, app, ws);
			else ws.on('message', raw => {
				const score = JSON.parse(raw.toString());
				admin.notify_change(app, 'default', 'score', score);
				admin.notify_change(app, 'default', 'score', score); // Duplicate delivery must not create another sample.
			});
		});
		let client, tablet;
		try {
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			const base = 'http://127.0.0.1:' + server.address().port;
			client = new AdminWsClient(base, 'default', dashboard); await client.connect();
			tablet = new WebSocket(base.replace('http:', 'ws:') + '/tablet');
			await new Promise((resolve, reject) => { tablet.once('open', resolve); tablet.once('error', reject); });
			const score = { court_id: 'court-1', match_id: 'match-1', network_score: [[8, 4]],
				presses: [{ type: 'score', side: 'left', timestamp: Date.now() }] };
			dashboard.record_score_sent(score); tablet.send(JSON.stringify(score));
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('No admin score event received')); }, 1000);
				const timer = setInterval(() => {
					if (client.changes.length < 2) return;
					clearInterval(timer); clearTimeout(timeout); resolve();
				}, 5);
			});
			const summary = dashboard.admin_latency_stats.summary(dashboard.score_updates);
			assert.strictEqual(summary.count, 1); assert.strictEqual(summary.unmatched_updates, 0);
			assert.strictEqual(summary.coverage, 1); assert(summary.mean >= 0);
			assert.strictEqual(dashboard.admin_payload_type_stats().find(row => row.type === 'change:score').count, 2);
			assert.strictEqual(dashboard.tv_latency_stats.count, 0, 'admin reception must not consume pending TV updates');
		} finally {
			if (client) client.close(); if (tablet) tablet.terminate();
			for (const ws of sockets.clients) ws.terminate();
			await new Promise(resolve => sockets.close(resolve));
			if (server.listening) await new Promise(resolve => server.close(resolve));
		}
	});
});
