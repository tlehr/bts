'use strict';

// Isolated comparison of planner output encoding, delivery and restoration.
// No live database, network, scores or tournament mutations.
const assert = require('assert');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const { encode, decode } = require('../bts/btp_planner/changes');
const { patch } = require('../bts/btp_planner/staging');
const { measure, summary } = require('./offload/measure');
const ms = ns => Math.round(Number(ns) / 1e5) / 10;

function fixture() {
	const matches = Array.from({ length: 519 }, (_, id) => ({ _id: String(id), tournament_key: 'offline',
		setup: { teams: [{ players: [{ btp_id: id, lastname: 'Old' }] }] },
		presses: Array.from({ length: 180 }, (_, index) => ({ type: 'score', team: index % 2,
			timestamp: 1700000000000 + index * 3200, value: index, device: 'synthetic-tablet' })) }));
	const changes = matches.slice(0, 36).map(before => {
		const after = structuredClone(before);
		after.setup.teams[0].players[0].lastname = 'Changed';
		return { collection: 'matches', id: before._id, before, after, update: patch(before, after) };
	});
	return { before: { matches }, changes };
}

if (!isMainThread) {
	const { changes } = fixture();
	const documents = changes.map(({ collection, id, after, update }) => ({ collection, id, after, update }));
	parentPort.on('message', mode => {
		const started = process.hrtime.bigint();
		const value = mode === 'patches' ? encode(changes) : documents;
		const returning = process.hrtime.bigint();
		parentPort.postMessage({ value, started, returning });
	});
	parentPort.postMessage({ ready: true });
} else if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

async function main() {
	const { before, changes } = fixture(), worker = new Worker(__filename);
	const rows = { documents: [], patches: [] };
	try {
		await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
		for (let i = -2; i < 30; i++) {
			const values = {};
			for (const mode of i % 2 ? ['patches', 'documents'] : ['documents', 'patches']) {
				const { value, measurement } = await measure(async () => {
					const message = await new Promise((resolve, reject) => {
						worker.once('message', resolve);
						worker.once('error', reject);
						worker.postMessage(mode);
					});
					worker.removeAllListeners('error');
					const received = process.hrtime.bigint();
					const restored = mode === 'patches' ? decode(message.value, before) : message.value;
					return { restored, encode_ms: ms(message.returning - message.started),
						return_delivery_ms: ms(received - message.returning),
						restore_ms: ms(process.hrtime.bigint() - received) };
				});
				values[mode] = value.restored;
				if (i >= 0) rows[mode].push({ ...measurement, encode_ms: value.encode_ms,
					return_delivery_ms: value.return_delivery_ms, restore_ms: value.restore_ms });
			}
			assert.deepStrictEqual(values.patches, values.documents);
			assert.strictEqual(values.patches[0].after.presses, before.matches[0].presses);
			assert.strictEqual(before.matches[0].setup.teams[0].players[0].lastname, 'Old');
		}
		console.log(JSON.stringify({ stage: 'sync_planner_patch_return',
			scope: 'Synthetic planner output only: encoding, structured-clone delivery and receiver restoration; excludes planning, effects, live locks, apply and network.',
			input: { matches: 519, changed_matches: 36, presses_per_match: 180, samples: 30 },
			json_size_estimate_bytes: { documents: Buffer.byteLength(JSON.stringify(changes.map(({ collection, id, after, update }) => ({ collection, id, after, update })))),
				patches: Buffer.byteLength(JSON.stringify(encode(changes))) },
			correctness_pairs: 32, rows,
			summary: Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, { ...summary(values),
				...Object.fromEntries(['encode_ms', 'return_delivery_ms', 'restore_ms'].map(field => {
					const sorted = values.map(value => value[field]).sort((a, b) => a - b);
					return [field, { median: sorted[15], max: sorted.at(-1) }];
				})) }])) }, null, 2));
	} finally { await worker.terminate(); }
}
