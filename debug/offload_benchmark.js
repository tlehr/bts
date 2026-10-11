'use strict';

// Offline only: no live server, tournament or persistent database access.
const planning = require('./offload/planning');
const device = require('./offload/device');
const { compaction_benchmark, xlsx_benchmark } = require('./offload/serialization');
const profile = require('../bts/offload/profile');

async function benchmark(samples = 8) {
	const keys = ['BTS_SYNC_PLAN_WORKER', 'BTS_DEVICE_INFO_BACKGROUND', 'BTS_XLSX_IMPORT_WORKER', 'BTS_COMPACTION_WORKER',
		'BTS_BTP_SYNC_TIMING', 'BTS_SCORE_PRESS_TIMING', 'BTS_OFFLOAD_TIMING', 'BTS_PERF_RUN_LABEL'];
	const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
	const original = { warn: console.warn, log: console.log };
	const records = [];
	console.warn = value => { if (typeof value === 'string' && value.startsWith('[bts] offload:task ')) records.push(JSON.parse(value.slice('[bts] offload:task '.length))); };
	console.log = () => {};
	try {
		for (const key of keys) process.env[key] = '0';
		process.env.BTS_OFFLOAD_TIMING = '1'; process.env.BTS_PERF_RUN_LABEL = 'offline-individual-offloads';
		const result = { stage: 'independent_background_offloads', node: process.version, created_at: new Date().toISOString(),
			method: 'Identical synthetic inputs per pair, alternating order, 2-ms main-thread heartbeat, worker cold starts separate; output comparisons outside measurement.',
			baseline_profile: profile.snapshot(), samples_per_variant: samples, comparisons: {} };
		for (const [name, run] of Object.entries({ sync_plan: planning, device_info: device, compaction: compaction_benchmark, xlsx_import: xlsx_benchmark })) {
			for (const key of keys.slice(0, 4)) process.env[key] = '0';
			result.comparisons[name] = await run(samples, records);
		}
		return result;
	} finally {
		console.warn = original.warn; console.log = original.log;
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

if (require.main === module) benchmark().then(result => {
	console.log(JSON.stringify(result, null, 2)); // eslint-disable-line no-console
}).catch(error => { console.error(error); process.exitCode = 1; }); // eslint-disable-line no-console

module.exports = benchmark;
