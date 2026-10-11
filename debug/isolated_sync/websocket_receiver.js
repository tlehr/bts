'use strict';

const WebSocket = require('ws');
let socket, input, role;
const received = {};
const sent = {};

// Separate process: a busy server event loop must not also stall the receiver.
// Same-host hrtime uses the same monotonic clock. Timestamp before JSON parsing.
process.on('message', message => {
	if (message.type === 'connect') {
		role = message.role;
		socket = new WebSocket(message.url);
		socket.on('open', () => process.send({ type: 'ready', clock_ns: process.hrtime.bigint().toString() }));
		socket.on('error', error => process.send({ type: 'error', message: error.message }));
		socket.on('message', raw => {
			const at = process.hrtime.bigint().toString();
			const value = JSON.parse(raw);
			if (value.type === 'error') return process.send({ type: 'error', message: value.message });
			const kind = value.ctype === 'score' ? 'point' : value.ctype === 'match_called_on_court' ? 'announcement'
				: value.rid === 'admin' ? 'admin' : null;
			if (!input || !kind || (role && kind !== role) || received[kind]) return;
			if (kind === 'point' && (value.val.match_id !== input.match_id || value.val.isolated_point !== 1)) {
				return process.send({ type: 'error', message: 'Wrong point notification' });
			}
			if (kind === 'announcement' && value.val._id !== input.match_id) {
				return process.send({ type: 'error', message: 'Wrong announcement' });
			}
			if (kind === 'admin' && value.tournament?.matches?.length !== input.match_count) {
				return process.send({ type: 'error', message: 'Wrong admin response' });
			}
			received[kind] = { received_ns: at, sent_ns: sent[kind], bytes: raw.length };
			if ((role ? [role] : ['point', 'admin', 'announcement']).every(key => received[key])) process.send({ type: 'received', received });
		});
	} else if (message.type === 'run') {
		input = message;
		for (const [kind, request] of Object.entries({
			point: { type: 'isolated_point_probe', rid: 'point' },
			admin: { type: 'tournament_get', rid: 'admin', key: input.key, defer_finished_history: true },
			announcement: { type: 'isolated_announcement_probe', rid: 'announcement' },
		})) {
			if (role && kind !== role) continue;
			const send = () => {
				sent[kind] = process.hrtime.bigint().toString();
				socket.send(JSON.stringify(request));
			};
			if (message.probe_delay_ms && kind !== 'admin') setTimeout(send, message.probe_delay_ms); else send();
		}
	} else if (message.type === 'close') {
		socket?.terminate(); process.disconnect();
	}
});
