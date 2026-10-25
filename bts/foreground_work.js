'use strict';

// Background admin work yields while points or validated sync commits hold
// their resource locks. Delaying their filesystem callbacks also blocks the
// next point waiting for those locks. Network fetching/planning stays background.
let active = 0;
const waiting = new Set();
const active_tasks = new WeakSet();
const context = new (require('async_hooks').AsyncLocalStorage)();
function busy() { return active > 0; }
function background_busy() { return busy() && !active_tasks.has(context.getStore()); }
async function idle() {
	while (active) {
		await new Promise(resolve => waiting.add(resolve));
		// Releasing resource locks schedules the next queued point for the next
		// turn. Let it claim priority before waking every waiting admin window.
		await new Promise(resolve => setImmediate(resolve));
	}
}
function background_idle() {
	// An operation must never wait for its own completion. Released point
	// contexts can outlive publication in background follow-up work.
	return active_tasks.has(context.getStore()) ? Promise.resolve() : idle();
}
function begin(name) {
	if (!(name.startsWith('handle_score_update') || name === 'confirm_match_finished_from_admin' ||
		name === 'fetch_sync_apply' || name === 'post_sync_auto_call_apply') ||
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

// Queues can dispatch the next job in the previous job's async context.
// Explicitly restore even an absent owner, so background work cannot inherit
// another point's priority or release that point's token.
const capture = () => context.getStore();
const run = (end, work) => context.run(end, work);
const release = () => context.getStore()?.();

function publication(work) {
	// Score persistence and TV delivery have separate lifetimes. The point
	// handler can release its locks while CPU-heavy copying still yields until
	// its display messages have been handed to their WebSockets.
	const end = active_tasks.has(context.getStore()) ? begin('handle_score_update_publication') : null;
	try { return Promise.resolve(run(end, work)).finally(() => end?.()); }
	catch (error) { end?.(); throw error; }
}

module.exports = { begin, busy, background_busy, idle, background_idle, run, capture, release, publication };
