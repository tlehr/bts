'use strict';

const http = require('http');
const WebSocket = require('ws');
const admin = require('../../bts/admin');
const wshandler = require('../../bts/wshandler');
const point = require('./point_probe');
const { elapsed } = require('./instrument');
const receiver = require('./receiver_client');

async function open(app, match, separate_receivers = false, probe_delay_ms = 0) {
	const server = http.createServer();
	const wss = new WebSocket.Server({ server });
	let rows, scheduled, appends;
	const module = { on_close: admin.on_close,
		on_connect(_app, ws) {
			admin.on_connect(app, ws);
			ws.on('bts:response_encoded', event => {
				if (!rows || event.rid !== 'admin') return;
				rows.admin_response_bytes = event.bytes;
				rows.admin_response_serialize_ms = event.elapsed_ms;
				rows.admin_response_encoding = event.execution;
				rows.admin_response_ready_ms = elapsed(scheduled);
			});
			ws.on('bts:message_sent', message => {
				if (!rows) return;
				if (message.rid === 'admin') {
					rows.admin_response_bytes = message.bytes;
					rows.admin_response_serialize_ms = message.elapsed_ms;
					rows.admin_response_encoding = 'main';
					rows.admin_response_ready_ms = elapsed(scheduled);
				} else if (message.ctype === 'score' && (!ws.probe_role || ws.probe_role === 'point')) rows.point_notification_ready_ms = elapsed(scheduled);
				else if (message.ctype === 'match_called_on_court' && (!ws.probe_role || ws.probe_role === 'announcement')) {
					rows.announcement_ready_ms = elapsed(scheduled);
					rows.announcement_serialize_ms = message.elapsed_ms;
				}
			});
		},
		async async_handle_isolated_point_probe(_app, ws, message) {
			rows.dispatch_delay_ms = elapsed(scheduled); rows.append_in_flight_at_dispatch = appends() > 0;
			await point(app, match, scheduled, rows); ws.respond(message);
		},
		handle_tournament_get: admin.handle_tournament_get,
		handle_isolated_announcement_probe(_app, ws, message) {
			admin.handle_announce_match_manually(app, ws, { ...message, tournament_key: app.key, match });
		},
	};
	wss.on('connection', (ws, request) => {
		ws.probe_role = new URL(request.url, 'http://localhost').searchParams.get('role');
		wshandler.handle(module, app, ws);
	});
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const receivers = [];
	try {
		for (const role of separate_receivers ? ['point', 'admin', 'announcement'] : [null]) {
			receivers.push(await receiver(`ws://127.0.0.1:${server.address().port}`, role));
		}
	}
	catch (error) { await Promise.all(receivers.map(client => client.close())); for (const ws of wss.clients) ws.terminate(); server.close(); throw error; }
	return {
		async run(at, active_appends) {
			scheduled = at; appends = active_appends; rows = {};
			const results = await Promise.all(receivers.map(client => client.run({ key: app.key, match_id: match._id, match_count: app.match_count, probe_delay_ms })));
			const received = Object.assign({}, ...results);
			for (const [kind, value] of Object.entries(received)) {
				rows[kind + '_received_ms'] = Number(BigInt(value.received_ns) - at) / 1e6;
				rows[kind + '_request_to_receive_ms'] = Number(BigInt(value.received_ns) - BigInt(value.sent_ns)) / 1e6;
			}
			return rows;
		},
		async close() {
			await Promise.all(receivers.map(client => client.close()));
			for (const ws of wss.clients) ws.terminate();
			await new Promise(resolve => wss.close(resolve));
			await new Promise(resolve => server.close(resolve));
		},
	};
}

module.exports = { open };
