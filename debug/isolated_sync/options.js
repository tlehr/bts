'use strict';

const path = require('path');

function parse(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--no-profile') { options.profile = false; continue; }
		if (arg === '--help' || arg === '-h') { options.help = true; continue; }
		const key = { '--source': 'source', '--tournament': 'key', '--samples': 'samples', '--changes': 'changes', '--warmups': 'warmups' }[arg];
		if (!key) throw new Error('Unknown option: ' + arg);
		if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
		const value = argv[++i];
		options[key] = key === 'source' ? path.resolve(value) : key === 'key' ? value : Number(value);
		if (['samples', 'changes'].includes(key) && (!Number.isSafeInteger(options[key]) || options[key] < 1)) {
			throw new Error('Invalid ' + arg);
		}
		if (key === 'warmups' && (!Number.isSafeInteger(options[key]) || options[key] < 0)) throw new Error('Invalid ' + arg);
	}
	return options;
}

const help = [
	'Usage: npm run debug:isolated-sync -- [options]',
	'Compare temporary database replicas; original files remain unopened by NeDB.',
	'--source PATH       default ./data; use a previous /tmp/bts-isolated-sync-*/snapshot to replay it',
	'--tournament KEY    default default',
	'--samples N         default 12 measured pairs per workload, plus warmups and no-sync controls',
	'--warmups N         default 2 warmup pairs per workload',
	'--changes N         default 46 inactive match profiles plus one events update',
	'--no-profile        omit bounded CPU profiles',
].join('\n');

module.exports = { parse, help };
