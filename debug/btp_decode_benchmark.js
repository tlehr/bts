'use strict';

// Offline only: deterministic synthetic BTP packets, no server or database.
const assert = require('assert');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const proto = require('../bts/btp_proto');
const DecodePool = require('../bts/btp_decode/pool');

function make_xml() {
	const matches = [];
	for (let i = 0; i < 519; i++) {
		const fields = [];
		for (let j = 0; j < 36; j++) {
			const value = crypto.createHash('sha256').update(`${j === 0 ? i : i % 7}:${j}`).digest('hex').slice(0, 40);
			fields.push(`<ITEM ID="Field${j}" TYPE="String">${value} Müller &amp; Weiß</ITEM>`);
		}
		matches.push(`<GROUP ID="Match"><ITEM ID="ID" TYPE="Integer">${i}</ITEM>${fields.join('')}</GROUP>`);
	}
	return `<ROOT><GROUP ID="Result"><GROUP ID="Tournament"><GROUP ID="Matches">${matches.join('')}</GROUP></GROUP></GROUP></ROOT>`;
}

function summarize(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const round = n => Math.round(n * 10) / 10;
	return { samples: values.length, mean: round(values.reduce((a, b) => a + b, 0) / values.length),
		median: round(sorted[Math.floor(sorted.length / 2)]), max: round(sorted.at(-1)) };
}

async function benchmark(samples = 12) {
	const xml = make_xml();
	const packet = proto.encode_xml(xml);
	const pool = new DecodePool();
	const previous = process.env.BTS_BTP_SYNC_TIMING;
	const warn = console.warn;
	let records = [];
	console.warn = line => records.push(JSON.parse(line.split('btp_fetch:response_decode ')[1]));
	process.env.BTS_BTP_SYNC_TIMING = '1';
	const direct = callback => proto.decode(packet, callback, { action: 'SENDTOURNAMENTINFO' });
	const worker = callback => pool.decode(packet, { action: 'SENDTOURNAMENTINFO' }, callback);
	const result = { stage: 'persistent_btp_decoder_worker', node: process.version,
		method: '519 synthetic matches, identical packet and output; worker warmup, 12 alternating pairs, 2-ms heartbeat during each decode; no network, database or live tournament.',
		packet_bytes: packet.length, xml_bytes: Buffer.byteLength(xml), correctness_checks: 0,
		direct: [], worker: [] };
	try {
		const expected = await new Promise((resolve, reject) => direct((err, value) => err ? reject(err) : resolve(value)));
		await new Promise((resolve, reject) => worker((err, value) => err ? reject(err) : resolve(value)));
		const cold_start = records.at(-1);
		for (let i = 0; i < samples; i++) {
			for (const mode of i % 2 ? ['worker', 'direct'] : ['direct', 'worker']) {
				records = [];
				let last = performance.now(), max_delay = 0, ticks = 0;
				const timer = setInterval(() => {
					const now = performance.now(); max_delay = Math.max(max_delay, now - last - 2); last = now; ticks++;
				}, 2);
				const start = performance.now();
				const value = await new Promise((resolve, reject) => (mode === 'direct' ? direct : worker)((err, response) => err ? reject(err) : resolve(response)));
				const elapsed = performance.now() - start;
				// Give an overdue main-thread heartbeat the opportunity to run.
				await new Promise(resolve => setTimeout(resolve, 5));
				clearInterval(timer);
				result[mode].push({ elapsed_ms: elapsed, heartbeat_max_delay_ms: max_delay,
					heartbeats: ticks, timing: records.at(-1) });
				assert.deepStrictEqual(value, expected); result.correctness_checks++;
			}
		}
		result.cold_start = cold_start;
		result.summary = {};
		for (const mode of ['direct', 'worker']) {
			result.summary[mode] = { elapsed_ms: summarize(result[mode].map(row => row.elapsed_ms)),
				heartbeat_max_delay_ms: summarize(result[mode].map(row => row.heartbeat_max_delay_ms)) };
		}
		for (const field of ['dispatch_ms', 'input_wait_ms', 'return_delivery_ms', 'decode_roundtrip_ms']) {
			result.summary.worker[field] = summarize(result.worker.map(row => row.timing[field]));
		}
		return result;
	} finally {
		pool.close(); console.warn = warn;
		if (previous === undefined) delete process.env.BTS_BTP_SYNC_TIMING;
		else process.env.BTS_BTP_SYNC_TIMING = previous;
	}
}

if (require.main === module) benchmark().then(result => {
	console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
}).catch(error => { console.error(error); process.exitCode = 1; }); // eslint-disable-line no-console

module.exports = benchmark;
