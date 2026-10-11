'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const http = require('http');
const WebSocket = require('ws');
const Controller = require('../debug/web_dashboard/controller');
const { create_server } = require('../debug/web_dashboard/server');
const { defaults, build_options, fields } = require('../debug/web_dashboard/options');
const { Dashboard, parse_args } = require('../debug/live_tournament_drill');
const snapshot = require('../debug/web_dashboard/snapshot');
const wshandler = require('../bts/wshandler');
const admin = require('../bts/admin');

const input = (mode = 'interactive') => ({ mode, settings: defaults(mode) });
function fake_child() {
	const child = new EventEmitter(); child.messages = []; child.signals = [];
	child.send = (message, callback) => { child.messages.push(message); if (callback) callback(); };
	child.kill = signal => { child.signals.push(signal); child.emit('close', null, signal); };
	return child;
}

describe('web dashboard settings and snapshots', function() {
	it('retains simulation flags, both modes and the fixed sequence while rejecting invalid input', function() {
		const options = build_options(input('benchmark'));
		assert.strictEqual(options.max_runtime_ms, 600000); assert.strictEqual(options.expected_matches, 519);
		assert.strictEqual(options.point_min_ms, 3200); assert.strictEqual(options.report_path, null);
		assert.strictEqual(options.quiet, true);
		const custom = input(); custom.settings.score_all_active = false; custom.settings.tablet_battery_drain_min = 0;
		custom.settings.max_runtime_ms = 3000; custom.settings.seed = 'some-seed';
		const parsed = build_options(custom);
		assert.strictEqual(parsed.score_all_active, false); assert.strictEqual(parsed.tablet_battery_drain_min, 0);
		assert.strictEqual(parsed.seed, 'some-seed'); assert.strictEqual(parsed.max_runtime_ms, 3000);
		for (const [key, value] of [['base_url', 'file:///tmp/test'], ['point_min_ms', -1], ['expected_matches', 0.5], ['score_all_active', 'false'], ['seed', '--help']]) {
			assert.throws(() => build_options({ ...custom, settings: { ...custom.settings, [key]: value } }));
		}
		assert.throws(() => build_options({ mode: 'other' }));
		assert.throws(() => build_options({ mode: 'benchmark', settings: { ...defaults(), max_runtime_ms: 3000 } }), /fixed/);
		assert(fields.some(field => field.key === 'display_ack_render_ms'));
	});
	it('projects metrics and court data without exposing mutable scoring histories', function() {
		const dashboard = new Dashboard({ ...parse_args([]), quiet: true });
		dashboard.log('test', { value: 1 });
		dashboard.update_tournament({ courts: [{ _id: 'court', num: 1 }] });
		dashboard.record_score_sent({ court_id: 'court', match_id: 'one', network_score: [[1, 0]] });
		const result = snapshot(dashboard);
		assert.strictEqual(result.receipts[0].pending, 1); assert.strictEqual(result.status.level, 'UNKNOWN');
		assert.strictEqual(result.settings.tablet_battery_min, dashboard.options.tablet_battery_min);
		assert.strictEqual(result.courts[0].id, 'court'); assert(!('state' in result.courts[0]));
		assert(result.events.some(event => event.label === 'test'));
	});
});

describe('web dashboard process control', function() {
	it('owns one test, forwards commands, preserves final reports and permits a subsequent test', async function() {
		const children = [], controller = new Controller({ create_child: () => { const child = fake_child(); children.push(child); return child; } });
		controller.start(input()); const child = children[0];
		assert.strictEqual(child.messages[0].type, 'start'); assert.throws(() => controller.start(input()), /bereits/);
		child.emit('message', { type: 'ready' });
		const pending = controller.command('pause'), request = child.messages.at(-1);
		assert.strictEqual(request.command, 'pause'); child.emit('message', { type: 'ack', id: request.id }); await pending;
		child.emit('message', { type: 'report', report: { stop_reason: 'completed', points: 10 } }); child.emit('close', 0);
		assert(controller.state().revision > 1);
		assert.strictEqual(controller.state().status, 'completed'); assert.strictEqual(controller.current.report.points, 10);
		assert.strictEqual(controller.state().report, undefined); assert.strictEqual(controller.state().report_available, true);
		controller.start(input('benchmark')); children[1].emit('message', { type: 'ready' });
		await assert.rejects(controller.command('faster'), /automatisch/);
		await assert.rejects(controller.command('unknown'), /Unbekannt/);
		children[1].emit('close', 1); assert.strictEqual(controller.state().status, 'error'); await controller.close();
	});
	it('handles startup failures and stops its own child before readiness', async function() {
		const controller = new Controller({ create_child: () => { throw new Error('spawn failed'); } });
		assert.throws(() => controller.start(input()), /spawn failed/); assert.strictEqual(controller.state().status, 'error');
		const child = fake_child(), started = new Controller({ create_child: () => child }); started.start(input());
		await started.close(); assert.deepStrictEqual(child.signals, ['SIGTERM']); assert.strictEqual(started.state().status, 'interrupted');
	});
});

describe('web dashboard HTTP and real simulation bridge', function() {
	it('serves the UI, rejects foreign control requests and exports the selected report', async function() {
		const controller = new Controller({ create_child: () => fake_child() }), app = create_server({ controller });
		try {
			await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
			const base = 'http://127.0.0.1:' + app.server.address().port;
			const html = await (await fetch(base)).text(); assert(html.includes('Ablauf &amp;') || html.includes('Ablauf & Warteschlangen'));
			assert.strictEqual(controller.child, null, 'opening the page must not start simulation');
			const config = await (await fetch(base + '/api/config')).json();
			const send = (headers = {}) => fetch(base + '/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input()) });
			assert.strictEqual((await send()).status, 403);
			assert.strictEqual((await send({ 'X-BTS-Test-Token': config.token, Origin: 'http://unrelated.example' })).status, 403);
			assert.strictEqual(controller.child, null);
			assert.strictEqual((await send({ 'X-BTS-Test-Token': config.token })).status, 200);
			assert.strictEqual((await send({ 'X-BTS-Test-Token': config.token })).status, 400);
			const child = controller.child; child.emit('message', { type: 'report', report: { stop_reason: 'completed', points: 7 } }); child.emit('close', 0);
			const report = await fetch(base + '/api/report'); assert(report.headers.get('content-disposition').includes('.json'));
			assert.strictEqual((await report.json()).points, 7);
		} finally { await app.close(); }
	});
	it('runs the existing engine in its real child process against a read-only BTS fixture', async function() {
		this.timeout(10000);
		const server = http.createServer(), sockets = new WebSocket.Server({ server });
		const fixture = { key: 'default', courts: [], matches: [], btp_settings: {}, debug_offloading: require('../bts/offload/profile').snapshot() };
		let write_requests = 0;
		sockets.on('connection', ws => wshandler.handle({
			on_connect() {}, on_close() {},
			handle_tournament_get(app, connection, message) { connection.respond(message, null, { tournament: fixture }); },
			handle_debug_performance_stats: admin.handle_debug_performance_stats,
			handle_match_player_check_in() { write_requests++; },
		}, { db: {} }, ws));
		const controller = new Controller();
		try {
			await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
			const settings = { ...defaults('interactive'), base_url: 'http://127.0.0.1:' + server.address().port, max_runtime_ms: 1200 };
			const finished = new Promise(resolve => controller.once('finished', resolve));
			controller.start({ mode: 'interactive', settings });
			await Promise.race([finished, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Simulation did not finish')), 8000); timer.unref(); })]);
			assert.strictEqual(controller.state().status, 'completed', controller.current.error);
			assert(controller.current.report.runtime_ms >= 1200); assert.strictEqual(controller.current.report.points, 0);
			assert.strictEqual(write_requests, 0); assert(controller.current.snapshot); assert(controller.history.length > 0);
			assert.strictEqual(controller.current.report.latency_endpoint, 'client-websocket-message-received-before-json-parse');
		} finally {
			await controller.close(); for (const ws of sockets.clients) ws.terminate();
			await new Promise(resolve => sockets.close(resolve)); if (server.listening) await new Promise(resolve => server.close(resolve));
		}
	});
});
