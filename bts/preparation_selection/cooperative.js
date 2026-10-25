'use strict';

// Candidate discovery also runs inside this iterator. Check priority before
// advancing it, so preparation cannot first build all candidates synchronously.
module.exports = async function cooperate(steps) {
	const foreground = require('../foreground_work');
	const traces = require('../performance/traces');
	const iterator = steps[Symbol.iterator]();
	let turn = null, span;
	const finish_turn = error => { traces.end(span, error); span = null; turn = null; };
	try {
		for (;;) {
			if (foreground.background_busy()) finish_turn();
			await foreground.background_idle();
			// Another microtask can start a point after idle() resolves.
			if (foreground.background_busy()) continue;
			if (turn === null) { turn = process.hrtime.bigint(); span = traces.begin('preparation_selection_turn', 'phase'); }
			const next = iterator.next();
			if (next.done) return next.value;
			if (typeof next.value === 'function') next.value();
			if (process.hrtime.bigint() - turn < 2000000n) continue;
			finish_turn();
			await new Promise(resolve => setImmediate(resolve));
		}
	} catch (error) {
		finish_turn(error);
		throw error;
	} finally {
		finish_turn();
		iterator.return?.();
	}
};
