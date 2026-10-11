'use strict';

const { parse_args } = require('./benchmark_sequence/options');
const { run } = require('./benchmark_sequence/run');

async function main(argv) {
	const options = parse_args(argv);
	if (options.help) {
		console.log([
			'Usage: npm run debug:benchmark-sequence -- [options]',
			'Start local BTS with light preparation and staged compaction; batch writes disabled; benchmark once for 10m.',
			'Stop the existing make dev and testclient first. Ctrl+C aborts and stops only owned children.',
			'No tournament reset. Logs/reports go into a new /tmp/bts-offload-sequence-* directory.',
			'--base-url URL          default https://localhost:4433 (local only, matching config.json)',
			'--bts-dir PATH          explicit BTS checkout for starting profile comparison servers',
			'--tournament KEY        default default',
			'--profiles LIST         default combined-responsive-cached-admin; combined-responsive-background-admin disables only the new revision cache; also combined-responsive-cooperative-admin,combined-responsive-prepared-writes,combined-responsive-single-writes; combined-responsive enables batches; also combined-preparation,combined-reads,combined-patches,basis,combined,sync-plan,device-info,compaction',
			'--seed TEXT             default 519, identical for each run',
			'--expected-matches N    default 519; 0 disables count check',
			'--output-dir PATH       create this new directory instead of a temporary one',
			'--warmup-ms N           default 10000 after readiness, excluded from benchmark',
			'--ready-timeout-ms N    default 120000',
			'--dry-run               print the sequence without starting processes or writing files',
		].join('\n'));
		return;
	}
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.on('SIGINT', stop); process.on('SIGTERM', stop);
	try {
		const result = await run(options, { signal: controller.signal });
		if (options.dry_run) console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		console.error(error.message);
		if (error.manifest_path) console.error('Manifest: ' + error.manifest_path);
		process.exitCode = controller.signal.aborted ? 130 : 1;
	} finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = main;
