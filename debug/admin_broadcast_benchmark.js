'use strict';

// Actual admin/outbox paths with synthetic DTOs and server-side ws framing.
// No live server, database, TCP connection or BTP is accessed.
const assert = require('assert');
const { EventEmitter } = require('events');
const { performance } = require('perf_hooks');
const { Sender } = require('ws');
const admin = require('../bts/admin');
const wshandler = require('../bts/wshandler');

function fixture() {
	return { events: Array.from({ length: 20 }, (_, event) => ({ name: 'Synthetic event ' + event,
		entries: Array.from({ length: 64 }, (_, entry) => ({
			team: { players: [0, 1].map(player => ({ btp_id: event * 128 + entry * 2 + player,
				firstname: 'Synthetic Ä🏸', lastname: 'Player ' + player,
				club: 'Synthetic club', association: 'Synthetic association', nationality: 'GER',
			})) }, points: entry, seed: null,
		})),
	})) };
}
const statistics = values => {
	const sorted = [...values].sort((a, b) => a - b);
	return { count: sorted.length, median_ms: sorted[Math.ceil(sorted.length / 2) - 1],
		p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], max_ms: sorted.at(-1) };
};

function measure(shared, payload, expected) {
	process.env.BTS_ADMIN_BROADCAST_SHARED = shared ? '1' : '0';
	const sockets = Array.from({ length: 11 }, () => {
		const ws = new EventEmitter(); ws.readyState = 1; ws.frames = [];
		ws.send = (raw, options) => ws.frames.push(Sender.frame(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), {
			fin: true, rsv1: false, opcode: options.binary ? 2 : 1, mask: false, readOnly: true,
		}));
		wshandler.handle(admin, {}, ws); return ws;
	});
	try {
		const start = performance.now(), cpu_start = process.cpuUsage();
		admin.notify_change({}, 'fixture', 'events', payload);
		const elapsed_ms = performance.now() - start, cpu = process.cpuUsage(cpu_start);
		for (const ws of sockets) {
			assert.strictEqual(ws.frames.length, 1); assert.strictEqual(ws.frames[0][0][0] & 15, 1);
			assert.strictEqual(ws.frames[0][1].toString(), expected);
		}
		return { shared, elapsed_ms, process_cpu_ms: (cpu.user + cpu.system) / 1000 };
	} finally { for (const ws of sockets) { ws.readyState = 3; ws.emit('close'); } }
}

async function run() {
	const previous = process.env.BTS_ADMIN_BROADCAST_SHARED;
	const payload = fixture(), expected = JSON.stringify({ type: 'change', tournament_key: 'fixture', ctype: 'events', val: payload });
	const pairs = [];
	try {
		for (const shared of [false, true]) measure(shared, payload, expected);
		for (let repetition = 0; repetition < 24; repetition++) {
			const samples = [];
			for (const shared of repetition % 2 ? [true, false] : [false, true]) {
				samples.push(measure(shared, payload, expected));
				await new Promise(resolve => setImmediate(resolve));
			}
			pairs.push({ repetition, samples });
		}
		return { created_at: new Date().toISOString(), node: process.version, recipients: 11, bytes: Buffer.byteLength(expected), pairs,
			summary: [false, true].map(shared => ({ shared, ...statistics(pairs.flatMap(pair => pair.samples)
				.filter(sample => sample.shared === shared).map(sample => sample.elapsed_ms)) })),
			validation: 'Every recipient receives identical full native JSON as a text frame in every probe.',
			limitations: ['Synthetic event DTO, normal production admin/outbox path and installed ws server framing.',
				'No actual socket writes, network reception, browser rendering, speech synthesis or database commits measured.',
				'Local diagnostic comparison, no promise for live p99 or total sync lock duration.'],
		};
	} finally {
		if (previous === undefined) delete process.env.BTS_ADMIN_BROADCAST_SHARED; else process.env.BTS_ADMIN_BROADCAST_SHARED = previous;
	}
}
if (require.main === module) run().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
	.catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
