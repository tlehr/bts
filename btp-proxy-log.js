#!/usr/bin/env node
'use strict';

/* eslint-disable no-console */

const fs = require('fs');
const net = require('net');
const path = require('path');
const {promisify} = require('util');

const btp_proto = require('./bts/btp_proto');

function parse_args(argv) {
	const args = {
		listen_host: '0.0.0.0',
		listen_port: 9901,
		target_host: '192.168.178.75',
		target_port: 9901,
		out_dir: path.join('/tmp', `btp-proxy-log-${Date.now()}`),
	};

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			i++;
			if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
			return argv[i];
		};
		if (arg === '--listen-host') args.listen_host = next();
		else if (arg === '--listen-port') args.listen_port = Number(next());
		else if (arg === '--target-host') args.target_host = next();
		else if (arg === '--target-port') args.target_port = Number(next());
		else if (arg === '--out-dir') args.out_dir = next();
		else if (arg === '--help' || arg === '-h') {
			console.log([
				'Usage: node btp-proxy-log.js [options]',
				'',
				'Options:',
				'  --listen-host HOST   Host to listen on (default: 0.0.0.0)',
				'  --listen-port PORT   Port to listen on (default: 9901)',
				'  --target-host HOST   Real BTP server IP/host (default: 192.168.178.75)',
				'  --target-port PORT   Real BTP server port (default: 9901)',
				'  --out-dir DIR        Directory for raw/decoded messages',
			].join('\n'));
			process.exit(0);
		} else {
			throw new Error(`Unknown argument ${arg}`);
		}
	}

	if (!Number.isInteger(args.listen_port) || args.listen_port <= 0) {
		throw new Error('Invalid --listen-port');
	}
	if (!Number.isInteger(args.target_port) || args.target_port <= 0) {
		throw new Error('Invalid --target-port');
	}
	return args;
}

async function decode_to_xml(buffer) {
	try {
		return await promisify(btp_proto.decode_string)(buffer);
	} catch (err) {
		return `<!-- decode failed: ${err.message} -->\n`;
	}
}

function compact_line(xml) {
	const action = xml.match(/<ITEM ID="ID" TYPE="String">([^<]+)<\/ITEM>/)?.[1] || '<unknown action>';
	const groups = Array.from(xml.matchAll(/<GROUP ID="([^"]+)">/g)).map(match => match[1]);
	const unique_groups = Array.from(new Set(groups)).slice(0, 8).join(', ');
	const has_payments = xml.includes('<GROUP ID="Payments">');
	const payment_fields = Array.from(xml.matchAll(/ID="([^"]*(?:Fee|Pay|Paid|Payment|Invoice|Zahl|Bezahlt)[^"]*)"/gi))
		.map(match => match[1]);
	const unique_payment_fields = Array.from(new Set(payment_fields)).slice(0, 8).join(', ');
	return `${action}${has_payments ? ' [Payments]' : ''}${unique_groups ? ` groups=${unique_groups}` : ''}${unique_payment_fields ? ` payment-fields=${unique_payment_fields}` : ''}`;
}

function split_btp_frames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset + 4 <= buffer.length) {
		const payload_len = buffer.readInt32BE(offset);
		const frame_len = payload_len + 4;
		if (payload_len < 0 || offset + frame_len > buffer.length) {
			break;
		}
		frames.push(buffer.subarray(offset, offset + frame_len));
		offset += frame_len;
	}
	return {
		frames,
		trailing: buffer.subarray(offset),
	};
}

async function write_frame(out_dir, connection_id, direction, buffer, frame_index, frame_count) {
	const suffix = frame_count > 1 ? `-${String(frame_index + 1).padStart(3, '0')}` : '';
	const base = `${String(connection_id).padStart(4, '0')}-${direction}${suffix}`;
	await fs.promises.writeFile(path.join(out_dir, `${base}.bin`), buffer);
	const xml = await decode_to_xml(buffer);
	await fs.promises.writeFile(path.join(out_dir, `${base}.xml`), xml);
	console.log(`[${connection_id}] ${direction}${suffix}: ${buffer.length} bytes ${compact_line(xml)}`);
}

async function write_message(out_dir, connection_id, direction, chunks) {
	const buffer = Buffer.concat(chunks);
	if (buffer.length === 0) return;

	const {frames, trailing} = split_btp_frames(buffer);
	if (frames.length === 0) {
		await write_frame(out_dir, connection_id, direction, buffer, 0, 1);
		return;
	}

	await Promise.all(frames.map((frame, index) =>
		write_frame(out_dir, connection_id, direction, frame, index, frames.length)
	));
	if (trailing.length > 0) {
		const base = `${String(connection_id).padStart(4, '0')}-${direction}-trailing`;
		await fs.promises.writeFile(path.join(out_dir, `${base}.bin`), trailing);
		console.warn(`[${connection_id}] ${direction}: ${trailing.length} trailing bytes not decoded`);
	}
}

async function main() {
	const args = parse_args(process.argv);
	await fs.promises.mkdir(args.out_dir, {recursive: true});

	let next_connection_id = 1;
	const server = net.createServer((client) => {
		const connection_id = next_connection_id++;
		const client_chunks = [];
		const server_chunks = [];
		const remote = net.connect({
			host: args.target_host,
			port: args.target_port,
		});

		console.log(`[${connection_id}] connected ${client.remoteAddress}:${client.remotePort} -> ${args.target_host}:${args.target_port}`);

		client.on('data', (chunk) => {
			client_chunks.push(chunk);
			remote.write(chunk);
		});
		remote.on('data', (chunk) => {
			server_chunks.push(chunk);
			client.write(chunk);
		});

		client.on('end', () => remote.end());
		remote.on('end', () => client.end());

		client.on('error', (err) => {
			console.warn(`[${connection_id}] client error: ${err.message}`);
			remote.destroy();
		});
		remote.on('error', (err) => {
			console.warn(`[${connection_id}] target error: ${err.message}`);
			client.destroy();
		});

		let logged = false;
		const log_once = () => {
			if (logged) return;
			logged = true;
			Promise.all([
				write_message(args.out_dir, connection_id, 'client-to-btp', client_chunks),
				write_message(args.out_dir, connection_id, 'btp-to-client', server_chunks),
			]).catch((err) => {
				console.error(`[${connection_id}] failed to write log:`, err.stack || err.message || err);
			});
		};

		client.on('close', log_once);
		remote.on('close', log_once);
	});

	server.listen(args.listen_port, args.listen_host, () => {
		console.log(`BTP proxy listening on ${args.listen_host}:${args.listen_port}`);
		console.log(`Forwarding to ${args.target_host}:${args.target_port}`);
		console.log(`Writing logs to ${args.out_dir}`);
	});
}

main().catch((err) => {
	console.error(err.stack || err.message || err);
	process.exit(1);
});
