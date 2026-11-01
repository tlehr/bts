'use strict';

const { networkInterfaces } = require('os');
const instances = new WeakMap();

function normalize_address(address) {
	return String(address || '').replace(/^::ffff:/i, '').split('%')[0];
}

// Coordinate sockets on the server, rather than browser storage: separate
// browsers/profiles on the same LAN host must not play over one another.
function create() {
	const local_addresses = new Set();
	try {
		for (const info of Object.values(networkInterfaces()).flat()) local_addresses.add(normalize_address(info.address));
	} catch (_) { /* Client-IP coordination still works if interface enumeration is unavailable. */ }
	const enabled = new Set(), clients = new Map(), owners = new Map();
	function host(ws) {
		const address = normalize_address(ws._socket?.remoteAddress);
		if (address === '::1' || /^127\./.test(address) || local_addresses.has(address)) return 'local';
		// Real WebSockets have a remote address. Do not merge unknown devices.
		return address || ws;
	}
	function send(ws, message) {
		if (ws.readyState !== undefined && ws.readyState !== 1) return false;
		try { ws.sendmsg(message);return true; } catch (_) { return false; }
	}
	function playback(ws, enable) { return send(ws, { type: 'emergency_playback', enable }); }
	function reconcile() {
		const eligible = ws => clients.has(ws) && enabled.has(clients.get(ws).key) && !ws.performance_probe && (ws.readyState === undefined || ws.readyState === 1);
		for (const [address, ws] of owners) {
			if (eligible(ws)) continue;
			owners.delete(address);
			playback(ws, false);
		}
		for (const [ws, client] of clients) {
			if (!eligible(ws) || owners.has(client.host)) continue;
			owners.set(client.host, ws);
			if (!playback(ws, true)) { owners.delete(client.host);clients.delete(ws); }
		}
	}
	return {
		subscribe(ws, key) {
			if (clients.has(ws) && clients.get(ws).key !== key) {
				clients.delete(ws);
				reconcile();
			}
			clients.set(ws, { key, host: host(ws) });
			send(ws, { type: 'change', tournament_key: key, ctype: 'emergency_announce', val: enabled.has(key) });
			reconcile();
		},
		set_enabled(key, enable) {
			if (enable) enabled.add(key);else enabled.delete(key);
			reconcile();
		},
		release(ws) { clients.delete(ws);reconcile(); },
	};
}

module.exports = app => {
	if (!instances.has(app)) instances.set(app, create());
	return instances.get(app);
};
module.exports.release = (app, ws) => instances.get(app)?.release(ws);
