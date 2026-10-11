'use strict';

// Background admin copying/encoding yields while an actual score task is
// running. Short CPU slices alone can still delay the multiple asynchronous
// filesystem callbacks needed to persist a point.
let active = 0;
const waiting = new Set();
const active_tasks = new WeakSet();
const context = new (require('async_hooks').AsyncLocalStorage)();
function busy() { return active > 0; }
function idle() {
	if (!active) return Promise.resolve();
	return new Promise(resolve => waiting.add(resolve));
}
function background_idle() {
	// An operation must never wait for its own completion. Released point
	// contexts can outlive publication in background follow-up work.
	return active_tasks.has(context.getStore()) ? Promise.resolve() : idle();
}
function begin(name) {
	if (!(name.startsWith('handle_score_update') || name === 'confirm_match_finished_from_admin') ||
		!require('./offload/profile').enabled('admin_response_priority')) return null;
	active++;
	let finished = false;
	const end = () => {
		if (finished) return;
		finished = true;
		active_tasks.delete(end);
		if (--active) return;
		const ready = [...waiting]; waiting.clear();
		for (const resolve of ready) resolve();
	};
	active_tasks.add(end);
	return end;
}

const run = (end, work) => end ? context.run(end, work) : work();
const release = () => context.getStore()?.();

module.exports = { begin, busy, idle, background_idle, run, release };
