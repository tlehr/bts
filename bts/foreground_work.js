'use strict';

// Background admin copying/encoding yields while an actual score task is
// running. Short CPU slices alone can still delay the multiple asynchronous
// filesystem callbacks needed to persist a point.
let active = 0;
const waiting = new Set();
const context = new (require('async_hooks').AsyncLocalStorage)();
function busy() { return active > 0; }
function idle() {
	if (!active) return Promise.resolve();
	return new Promise(resolve => waiting.add(resolve));
}
function begin(name) {
	if (!(name.startsWith('handle_score_update') || name === 'confirm_match_finished_from_admin') ||
		!require('./offload/profile').enabled('admin_response_priority')) return null;
	active++;
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		if (--active) return;
		const ready = [...waiting]; waiting.clear();
		for (const resolve of ready) resolve();
	};
}

const run = (end, work) => end ? context.run(end, work) : work();
const release = () => context.getStore()?.();

module.exports = { begin, busy, idle, run, release };
