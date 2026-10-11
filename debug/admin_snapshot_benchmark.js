'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { performance } = require('perf_hooks');
const snapshot = require('./isolated_sync/snapshot');
const admin = require('../bts/admin');
const outbox = require('../bts/admin_response/outbox');
const { sample_summary } = require('./live_drill_scenario');

function difference(a, b, location = 'tournament') {
	if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return a === b ? null : location;
	if (Object.keys(a).sort().join('\0') !== Object.keys(b).sort().join('\0')) return location + ' (keys)';
	for (const key of Object.keys(a)) { const result = difference(a[key], b[key], location + '.' + key); if (result) return result; }
	return null;
}

function request(db, key) {
	return new Promise((resolve, reject) => {
		const ws = new EventEmitter(); ws.readyState = 1;
		const started = performance.now();
		ws.send = text => { const message = JSON.parse(text); if (message.type === 'error') reject(new Error(message.message));
			else resolve({ ms: performance.now() - started, bytes: Buffer.byteLength(text), tournament: message.tournament }); };
		const output = outbox(ws);
		ws.reserve_response = () => { const job = output.reserve(); return (error, value) => {
			if (error) { reject(error); output.complete(job, { type: 'error', message: error.message }, key, false); }
			else output.complete(job, { type: 'answer', ...value }, key, true);
		}; };
		admin.handle_tournament_get({ db, wss: { clients: [] }, clock: { now_ms: () => 1234, get_state: () => ({ now_ms: 1234 }) } }, ws, { key });
	});
}

async function benchmark({ source = path.resolve(__dirname, '../data'), key = 'default', samples = 12 } = {}) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-admin-snapshot-'));
	const captured = await snapshot.capture(source, directory), rows = { uncached: [], cached: [] };
	const settings = { BTS_ADMIN_RESPONSE_BACKGROUND: '1', BTS_ADMIN_RESPONSE_PRIORITY: '1', BTS_ADMIN_RESPONSE_ENCODER: 'cooperative', BTS_ADMIN_MATCH_REVISION_CACHE: '0' };
	const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]])); Object.assign(process.env, settings);
	try {
		let expected;
		for (let i = 0; i < samples; i++) for (const variant of i % 2 ? ['cached', 'uncached'] : ['uncached', 'cached']) {
			process.env.BTS_ADMIN_MATCH_REVISION_CACHE = variant === 'cached' ? '1' : '0';
			const replica = path.join(directory, 'replica-' + i + '-' + variant), db = await snapshot.replica(captured, replica);
			const cold = await request(db, key);
			const warm = await request(db, key);
			// Ignore the explicitly reported feature flag when checking payload equality.
			delete warm.tournament.debug_offloading;
			expected ||= warm.tournament;
			const mismatch = difference(warm.tournament, expected); assert(!mismatch, 'Snapshot mismatch at ' + mismatch);
			rows[variant].push({ cold_ms: cold.ms, warm_ms: warm.ms, bytes: warm.bytes });
			await fs.rm(replica, { recursive: true, force: true });
		}
		await snapshot.unchanged(captured);
		const report = { directory, samples, source: captured, scope: 'full-admin-snapshot-through-production-handler-and-outbox',
			limitations: ['Delivery time ends at ws.send; no network, rendering or point-load measurement.', 'Only immutable match-revision optimization differs; request count, full histories and background/priority settings are identical.'], rows,
			summary: Object.fromEntries(Object.entries(rows).map(([variant, values]) => [variant, { cold_ms: sample_summary(values.map(row => row.cold_ms)), warm_ms: sample_summary(values.map(row => row.warm_ms)) }])) };
		await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); return report;
	} finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

if (require.main === module) benchmark({ source: process.argv[2] || undefined }).then(report => console.log(JSON.stringify({ directory: report.directory, summary: report.summary }, null, 2)))
	.catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { benchmark, request };
