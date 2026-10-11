'use strict';

const path = require('path');

const PROFILES = {
	basis: { sync_plan: false, device_info: false, compaction: false },
	combined: { sync_plan: true, device_info: true, compaction: true },
	'combined-patches': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true },
	'combined-reads': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true, compaction_reads: true },
	'combined-preparation': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true, compaction_reads: true, preparation_reads: true },
	'combined-responsive': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true, compaction_reads: true, preparation_reads: true,
		preparation_candidates: true, sync_batch_writes: true, compaction_staged: true },
	'combined-responsive-single-writes': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true, compaction_reads: true, preparation_reads: true,
		preparation_candidates: true, sync_batch_writes: false, compaction_staged: true },
	'combined-responsive-prepared-writes': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true, compaction_reads: true, preparation_reads: true,
		preparation_candidates: true, sync_batch_writes: false, sync_prepared_tournament: true, compaction_staged: true },
	'combined-responsive-background-admin': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true, compaction_reads: true, preparation_reads: true,
		preparation_candidates: true, sync_batch_writes: false, sync_prepared_tournament: true, admin_response_background: true, admin_response_priority: true, compaction_staged: true },
	'combined-responsive-cooperative-admin': { sync_plan: true, device_info: true, compaction: true, sync_plan_patch_return: true, compaction_reads: true, preparation_reads: true,
		preparation_candidates: true, sync_batch_writes: false, sync_prepared_tournament: true, admin_response_background: true, compaction_staged: true },
	'sync-plan': { sync_plan: true, device_info: false, compaction: false },
	'device-info': { sync_plan: false, device_info: true, compaction: false },
	compaction: { sync_plan: false, device_info: false, compaction: true },
};

function features(name) {
	if (!PROFILES[name]) throw new Error('Unknown profile: ' + name);
	return { btp_decode: true, sync_plan_patch_return: false, compaction_reads: false, preparation_reads: false,
		preparation_candidates: false, sync_batch_writes: false, sync_prepared_tournament: false, admin_response_background: false, admin_response_worker: false, admin_response_priority: false, compaction_staged: false, ...PROFILES[name], xlsx_import: false };
}

function environment(name, label, base = process.env) {
	const selected = features(name);
	return { ...base, BTS_PERF_RUN_LABEL: label, BTS_DEBUG_OUTPUT: '1', BTS_SCORE_PRESS_TIMING: '1',
		BTS_BTP_SYNC_TIMING: '1', BTS_OFFLOAD_TIMING: '1', BTS_BTP_DECODE_WORKER: '1', BTS_XLSX_IMPORT_WORKER: '0',
		BTS_SYNC_PLAN_PATCH_RETURN: selected.sync_plan_patch_return ? '1' : '0',
		BTS_COMPACTION_MODEL_READS: selected.compaction_reads ? '1' : '0',
		BTS_PREPARATION_MODEL_READS: selected.preparation_reads ? '1' : '0',
		BTS_PREPARATION_CANDIDATES_LIGHT: selected.preparation_candidates ? '1' : '0',
		BTS_SYNC_BATCH_WRITES: selected.sync_batch_writes ? '1' : '0',
		BTS_SYNC_PREPARED_TOURNAMENT: selected.sync_prepared_tournament ? '1' : '0',
		BTS_ADMIN_RESPONSE_BACKGROUND: selected.admin_response_background ? '1' : '0',
		BTS_ADMIN_RESPONSE_PRIORITY: selected.admin_response_priority ? '1' : '0',
		BTS_ADMIN_RESPONSE_ENCODER: selected.admin_response_worker ? 'worker' : 'cooperative',
		BTS_COMPACTION_STAGED: selected.compaction_staged ? '1' : '0',
		BTS_UPDATE_QUEUE_SLOW_TASK_MS: '50',
		BTS_SYNC_PLAN_WORKER: selected.sync_plan ? '1' : '0', BTS_DEVICE_INFO_BACKGROUND: selected.device_info ? '1' : '0',
		BTS_COMPACTION_WORKER: selected.compaction ? '1' : '0' };
}

function parse_args(argv) {
	const options = { base_url: 'https://localhost:4433', tournament: 'default', profiles: ['combined-responsive-background-admin'],
		expected_matches: 519, seed: '519', output_dir: null, ready_timeout_ms: 120000, warmup_ms: 10000,
		dry_run: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
			return argv[++i];
		};
		if (arg === '--base-url') options.base_url = next();
		else if (arg === '--tournament') options.tournament = next();
		else if (arg === '--profiles') options.profiles = next().split(',');
		else if (arg === '--output-dir') options.output_dir = path.resolve(next());
		else if (arg === '--expected-matches') options.expected_matches = Number(next());
		else if (arg === '--seed') options.seed = next();
		else if (arg === '--ready-timeout-ms') options.ready_timeout_ms = Number(next());
		else if (arg === '--warmup-ms') options.warmup_ms = Number(next());
		else if (arg === '--dry-run') options.dry_run = true;
		else if (arg === '--help' || arg === '-h') options.help = true;
		else throw new Error('Unknown argument: ' + arg);
	}
	const url = new URL(options.base_url);
	if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('The sequence starts its own local server; use a local HTTP(S) base URL without a path.');
	}
	for (const name of options.profiles) features(name);
	for (const key of ['expected_matches', 'ready_timeout_ms', 'warmup_ms']) {
		if (!Number.isSafeInteger(options[key]) || options[key] < 0) throw new Error('Invalid ' + key);
	}
	if (!options.ready_timeout_ms || !options.profiles.length || !options.tournament) throw new Error('Missing tournament, profiles or readiness timeout');
	return options;
}

module.exports = { parse_args, features, environment };
