'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const Controller = require('./controller');
const { fields, defaults } = require('./options');
const { AdminWsClient } = require('../live_tournament_drill');

const assets = new Map([
	['/', ['index.html', 'text/html; charset=utf-8']],
	['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
	['/charts.js', ['charts.js', 'text/javascript; charset=utf-8']],
	['/flow.js', ['flow.js', 'text/javascript; charset=utf-8']],
	['/processing.js', ['processing.js', 'text/javascript; charset=utf-8']],
	['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

async function read_json(request) {
	let bytes = 0, chunks = [];
	for await (const chunk of request) { bytes += chunk.length; if (bytes > 16384) throw new Error('Die Einstellungen sind zu groß.'); chunks.push(chunk); }
	return JSON.parse(Buffer.concat(chunks).toString());
}

function create_server({ controller = new Controller() } = {}) {
	const token = crypto.randomBytes(24).toString('hex');
	const reply = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
	const server = http.createServer(async (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Content-Security-Policy', 'default-src \'self\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\' data:; frame-ancestors \'none\'');
		const url = new URL(request.url, 'http://127.0.0.1');
		try {
			if (!['localhost', '127.0.0.1'].includes(new URL('http://' + request.headers.host).hostname)) return reply(response, 403, { error: 'Dieses Dashboard ist nur lokal erreichbar.' });
			const asset = assets.get(url.pathname);
			if (request.method === 'GET' && asset) {
				const bytes = await fs.promises.readFile(path.join(__dirname, 'public', asset[0]));
				response.writeHead(200, { 'Content-Type': asset[1] }); response.end(bytes); return;
			}
			if (request.method === 'GET' && url.pathname === '/api/config') return reply(response, 200, { token, fields,
				defaults: { benchmark: defaults(), interactive: defaults('interactive') } });
			if (request.method === 'GET' && url.pathname === '/api/state') return reply(response, 200, controller.state());
			if (request.method === 'GET' && url.pathname === '/api/report') {
				const report = controller.export_report();
				if (!report) return reply(response, 404, { error: 'Noch kein Bericht vorhanden.' });
				response.setHeader('Content-Disposition', 'attachment; filename="bts-test-' + controller.current.id + '.json"');
				return reply(response, 200, report);
			}
			if (request.method !== 'POST') return reply(response, 404, { error: 'Nicht gefunden.' });
			const expected_origin = 'http://' + request.headers.host;
			if (request.headers['x-bts-test-token'] !== token || (request.headers.origin && request.headers.origin !== expected_origin)) {
				return reply(response, 403, { error: 'Diese Steueranfrage stammt nicht aus dem Testdashboard.' });
			}
			const data = await read_json(request);
			if (url.pathname === '/api/start') return reply(response, 200, controller.start(data));
			if (url.pathname === '/api/control') { await controller.command(data.command); return reply(response, 200, controller.state()); }
			if (url.pathname === '/api/check') {
				const parsed = new URL(data.base_url);
				if (!['http:', 'https:'].includes(parsed.protocol) || typeof data.tournament_key !== 'string') throw new Error('Ungültige Serveradresse oder Turnierkennung.');
				const probe = new AdminWsClient(parsed.toString(), data.tournament_key, null, { handshake_timeout_ms: 3000 });
				try {
					await probe.send('debug_performance_stats', { probe: true }, 3000);
					const result = await probe.send('tournament_list', {}, 3000);
					return reply(response, 200, { message: 'Server erreicht. Wähle ein Turnier aus der Liste oder behalte deine Kennung.',
						tournaments: (result.tournaments || []).map(tournament => ({ key: tournament.key, name: tournament.name || tournament.key })) });
				}
				finally { probe.close(); }
			}
			return reply(response, 404, { error: 'Nicht gefunden.' });
		} catch (error) { return reply(response, 400, { error: error.message }); }
	});
	const sockets = new WebSocket.Server({ noServer: true });
	server.on('upgrade', (request, socket, head) => {
		const url = new URL(request.url, 'http://127.0.0.1');
		if (url.pathname !== '/live' || url.searchParams.get('token') !== token ||
			(request.headers.origin && request.headers.origin !== 'http://' + request.headers.host)) { socket.destroy(); return; }
		sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
	});
	sockets.on('connection', ws => ws.send(JSON.stringify({ type: 'state', state: controller.state() })));
	const broadcast = update => {
		const bytes = JSON.stringify({ type: 'update', ...update });
		for (const ws of sockets.clients) {
			if (ws.readyState !== WebSocket.OPEN) continue;
			// Slow observers reconnect with the current bounded history instead of
			// retaining an unlimited stream or stalling the simulation process.
			if (ws.bufferedAmount > 1024 * 1024) ws.close(1013, 'Dashboard-Verbindung zu langsam');
			else ws.send(bytes);
		}
	};
	controller.on('update', broadcast);
	return { server, controller, async close() {
		await controller.close(); controller.off('update', broadcast);
		for (const ws of sockets.clients) ws.terminate();
		await new Promise(resolve => sockets.close(resolve));
		if (server.listening) await new Promise(resolve => server.close(resolve));
	} };
}

module.exports = { create_server };
