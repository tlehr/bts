'use strict';

const assert = require('assert');
const { execFile } = require('child_process');
const { promisify } = require('util');

describe('GC pause diagnostics', function() {
	it('observes real GC pauses with timestamps comparable to processing traces and stops cleanly', async function() {
		const script = `const monitor = require(process.argv[1])();
			let values = Array.from({ length: 100000 }, (_, i) => ({ value: i }));
			values = null; global.gc();
			setTimeout(() => { const snapshot = monitor.snapshot(); monitor.stop();
			process.stdout.write(JSON.stringify({ snapshot, now: Date.now() })); }, 50);`;
		const { stdout } = await promisify(execFile)(process.execPath, ['--expose-gc', '-e', script,
			require.resolve('../bts/performance/garbage_collection')]);
		const { snapshot, now } = JSON.parse(stdout);
		assert(snapshot.count > 0); assert(snapshot.recent.length > 0);
		assert(snapshot.max_ms >= 0 && snapshot.total_ms >= snapshot.max_ms);
		for (const row of snapshot.recent) {
			assert(row.start_ts <= row.end_ts && row.end_ts <= now + 100);
			assert(now - row.start_ts < 10000); assert(Number.isFinite(row.kind));
		}
	});
});
