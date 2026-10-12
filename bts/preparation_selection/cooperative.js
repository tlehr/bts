'use strict';

// UI diagnostics are read-only. Yield between bounded batches so a score can
// persist and publish while a complete preparation explanation is being built.
module.exports = async function cooperate(jobs) {
	const foreground = require('../foreground_work');
	let turn = process.hrtime.bigint();
	for (const calculate of jobs) {
		await foreground.background_idle();
		calculate();
		if (process.hrtime.bigint() - turn < 2000000n) continue;
		await new Promise(resolve => setImmediate(resolve));
		turn = process.hrtime.bigint();
	}
};
