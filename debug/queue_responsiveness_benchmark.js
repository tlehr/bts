'use strict';

const path = require('path');
const { run, BASELINE, PHASES } = require('./queue_responsiveness/run');

function parse(argv) {
	const options = { bts_dir: path.resolve(__dirname, '..'), refs: [BASELINE, 'HEAD'], samples: 3, matches: 519,
		delay_ms: 2000, phases: PHASES.slice(), dry_run: false };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === '--dry-run') { options.dry_run = true; continue; }
		if (flag === '--help') return { help: true };
		const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
		if (flag === '--bts-dir') options.bts_dir = path.resolve(value);
		else if (flag === '--refs') options.refs = value.split(',');
		else if (flag === '--phases') options.phases = value.split(',');
		else if (flag === '--samples') options.samples = Number(value);
		else if (flag === '--matches') options.matches = Number(value);
		else if (flag === '--delay-ms') options.delay_ms = Number(value);
		else throw new Error('Unknown flag ' + flag);
	}
	for (const key of ['samples', 'matches', 'delay_ms']) if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error('Invalid ' + key);
	if (options.samples > 20 || options.matches > 2000 || options.delay_ms > 10000 || !options.phases.length || options.phases.some(phase => !PHASES.includes(phase))) throw new Error('Invalid scenario limits');
	if (options.matches < 2 && options.phases.includes('changed-sync')) throw new Error('Changed sync requires at least two matches');
	if (!options.refs.length || options.refs.some(ref => !/^[a-zA-Z0-9_./-]+$/.test(ref) || ref.startsWith('-'))) throw new Error('Invalid refs');
	return options;
}

if (require.main === module) {
	const options = parse(process.argv.slice(2));
	if (options.help) console.log('Queue/calling comparison on isolated synthetic tournaments.\n--refs BASELINE,HEAD --phases idle,slow-fetch,changed-sync,unchanged-sync\n--samples 3 --matches 519 --delay-ms 2000 --dry-run');
	else {
		const controller = new AbortController(), stop = () => controller.abort();
		process.on('SIGINT', stop); process.on('SIGTERM', stop);
		run(options, { signal: controller.signal }).then(result => console.log(JSON.stringify({ directory: result.directory, summary: result.summary || result }, null, 2)))
			.catch(error => { console.error(error.message); process.exitCode = 1; })
			.finally(() => { process.off('SIGINT', stop); process.off('SIGTERM', stop); });
	}
}

module.exports = { parse, run };
