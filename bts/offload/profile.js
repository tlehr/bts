'use strict';

const server_id = `${process.pid}-${Date.now()}`;
const flags = {
	btp_decode: ['BTS_BTP_DECODE_WORKER', true],
	sync_plan: ['BTS_SYNC_PLAN_WORKER', false],
	sync_plan_patch_return: ['BTS_SYNC_PLAN_PATCH_RETURN', false],
	device_info: ['BTS_DEVICE_INFO_BACKGROUND', false],
	xlsx_import: ['BTS_XLSX_IMPORT_WORKER', false],
	compaction: ['BTS_COMPACTION_WORKER', false],
	compaction_reads: ['BTS_COMPACTION_MODEL_READS', false],
	preparation_reads: ['BTS_PREPARATION_MODEL_READS', true],
	preparation_candidates: ['BTS_PREPARATION_CANDIDATES_LIGHT', true],
	sync_batch_writes: ['BTS_SYNC_BATCH_WRITES', false],
	sync_prepared_tournament: ['BTS_SYNC_PREPARED_TOURNAMENT', true],
	sync_prepared_matches: ['BTS_SYNC_PREPARED_MATCHES', true],
	admin_response_background: ['BTS_ADMIN_RESPONSE_BACKGROUND', true],
	admin_response_priority: ['BTS_ADMIN_RESPONSE_PRIORITY', true],
	admin_match_revision_cache: ['BTS_ADMIN_MATCH_REVISION_CACHE', true],
	admin_response_worker: ['BTS_ADMIN_RESPONSE_ENCODER', false],
	compaction_staged: ['BTS_COMPACTION_STAGED', false],
};

function enabled(name) {
	const [key, fallback] = flags[name];
	if (name === 'admin_response_worker') return process.env[key] === 'worker';
	return process.env[key] === undefined ? fallback : process.env[key] === '1';
}

function snapshot() {
	return { server_id, run_label: process.env.BTS_PERF_RUN_LABEL || null,
		features: Object.fromEntries(Object.keys(flags).map(name => [name, enabled(name)])) };
}

function timing_enabled() {
	return process.env.BTS_OFFLOAD_TIMING === '1' || process.env.BTS_BTP_SYNC_TIMING === '1' ||
		process.env.BTS_SCORE_PRESS_TIMING === '1';
}

module.exports = { enabled, snapshot, timing_enabled };
