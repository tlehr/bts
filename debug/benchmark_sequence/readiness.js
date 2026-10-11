'use strict';

const fs = require('fs').promises;
const path = require('path');
const net = require('net');
const { AdminWsClient } = require('../live_tournament_drill');
const { pause } = require('./process');

function address(base_url) {
	const url = new URL(base_url);
	return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) };
}

function port_in_use(base_url) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(address(base_url));
		const finish = value => { socket.destroy(); resolve(value); };
		socket.once('connect', () => finish(true));
		socket.once('error', error => {
			if (['ECONNREFUSED', 'ENOTFOUND'].includes(error.code)) finish(false);
			else { socket.destroy(); reject(error); }
		});
		socket.setTimeout(500, () => { socket.destroy(); reject(new Error('Could not check local server port')); });
	});
}

async function validate_config(options, cwd) {
	const config = JSON.parse(await fs.readFile(path.join(cwd, 'config.json'), 'utf8'));
	const url = new URL(options.base_url), expected_protocol = config.enable_https ? 'https:' : 'http:';
	const expected_port = Number(config.enable_https ? config.https_port : config.port);
	if (url.protocol !== expected_protocol || address(options.base_url).port !== expected_port) {
		throw new Error('Base URL does not match the HTTP(S) port in config.json');
	}
	if (await port_in_use(options.base_url)) throw new Error('A server is already running. Stop make dev and the old testclient with Ctrl+C before starting the sequence.');
}

async function inspect(base_url, tournament, signal, timeout_ms = 3000) {
	const client = new AdminWsClient(base_url, tournament);
	let timer;
	const aborted = () => client.close();
	signal?.addEventListener('abort', aborted, { once: true });
	try {
		if (signal?.aborted) throw new Error('Sequence interrupted');
		return await Promise.race([client.tournament(), new Promise((resolve, reject) => {
			timer = setTimeout(() => { client.close(); reject(new Error('Readiness request timed out')); }, timeout_ms);
		})]);
	} finally { clearTimeout(timer); signal?.removeEventListener('abort', aborted); client.close(); }
}

function assert_profile(actual, expected, label, pid) {
	if (!actual || actual.run_label !== label || !actual.server_id?.startsWith(pid + '-') ||
		Object.entries(expected).some(([key, value]) => actual.features?.[key] !== value)) {
		throw new Error('Server profile or process does not match the requested benchmark');
	}
}

async function ready(server, options, expected, label, signal) {
	const deadline = Date.now() + options.ready_timeout_ms;
	let error;
	while (Date.now() < deadline) {
		if (signal?.aborted) throw new Error('Sequence interrupted');
		if (server.result) throw new Error('Server exited before readiness; see server log');
		let tournament;
		try { tournament = await inspect(options.base_url, options.tournament, signal, Math.min(3000, deadline - Date.now())); }
		catch (err) { error = err; await pause(Math.min(500, Math.max(0, deadline - Date.now())), signal); continue; }
		assert_profile(tournament.debug_offloading, expected, label, server.pid);
		if (options.expected_matches && tournament.matches?.length !== options.expected_matches) {
			throw new Error(`Expected ${options.expected_matches} matches, found ${tournament.matches?.length}`);
		}
		return tournament.debug_offloading;
	}
	throw new Error('Server readiness timed out: ' + (error?.message || 'no response'));
}

module.exports = { validate_config, port_in_use, ready, assert_profile };
