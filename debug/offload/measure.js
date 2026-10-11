'use strict';

const { performance } = require('perf_hooks');
const round = n => Math.round(n * 10) / 10;

async function measure(work) {
	let last = performance.now(), max_delay = 0, ticks = 0;
	const timer = setInterval(() => {
		const now = performance.now(); max_delay = Math.max(max_delay, now - last - 2); last = now; ticks++;
	}, 2);
	const start = performance.now();
	try {
		const value = await work();
		const elapsed_ms = round(performance.now() - start);
		await new Promise(resolve => setTimeout(resolve, 5));
		return { value, measurement: { elapsed_ms, heartbeat_max_delay_ms: round(max_delay), heartbeats: ticks } };
	} finally { clearInterval(timer); }
}

function summary(rows) {
	return Object.fromEntries(['elapsed_ms', 'heartbeat_max_delay_ms'].map(field => {
		const sorted = rows.map(row => row[field]).sort((a, b) => a - b);
		return [field, { samples: sorted.length, median: round(sorted[Math.floor(sorted.length / 2)]), max: sorted.at(-1) }];
	}));
}

async function pairs(samples, run, verify, records, prepare = async () => undefined) {
	const rows = { main: [], alternative: [] };
	for (let i = 0; i < samples; i++) {
		const values = {};
		for (const mode of i % 2 ? ['alternative', 'main'] : ['main', 'alternative']) {
			const prepared = await prepare(mode, i);
			records.length = 0;
			const { value, measurement } = await measure(() => run(mode, i, prepared));
			values[mode] = value;
			rows[mode].push({ ...measurement, tasks: records.slice() });
		}
		verify(values.main, values.alternative);
	}
	return { correctness_pairs: samples, rows, summary: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, summary(value)])) };
}

module.exports = { measure, pairs, summary };
