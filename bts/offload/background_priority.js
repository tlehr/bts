'use strict';

const roles = new Set(['btp_decode', 'sync_plan_worker', 'compaction_serialize', 'call_status_calculation']);

// Linux nice values belong to individual threads. Never apply this policy to
// the main thread, an append worker, or an OS that changes process priority.
function create({platform = process.platform, main = require('worker_threads').isMainThread,
	os = require('os'), enabled = () => require('./profile').enabled('background_worker_priority'),
	warn = message => console.warn(message)} = {}) { // eslint-disable-line no-console
	let status = null, foreground = null;
	function configure(operation) {
		if (status) return {...status};
		status = {operation, applied:false};
		if (main || !roles.has(operation)) status.reason = 'foreground';
		else if (platform !== 'linux') status.reason = 'unsupported_platform';
		else if (!enabled()) status.reason = 'disabled';
		else try {
			const before = os.getPriority(0), target = Math.max(before, 5);
			if (before !== target) os.setPriority(0, target);
			Object.assign(status, {previous_nice:before, nice:os.getPriority(0), requested_nice:5});
			status.applied = status.nice >= target;
			status.changed = before !== status.nice;
			if (!status.applied) status.reason = 'not_applied';
		} catch (error) {
			status.reason = 'unavailable';status.error = String(error.code || error.message).slice(0,100);
			warn('[bts] background worker priority unavailable: ' + status.error);
		}
		return {...status};
	}
	function snapshot() {
		if (status) return {...status};
		if (main || platform !== 'linux') return null;
		if (!foreground) {
			try { foreground = {applied:false, reason:'foreground', nice:os.getPriority(0)}; }
			catch (_) { return null; }
		}
		return {...foreground};
	}
	return {configure, snapshot};
}

module.exports = {...create(), create};
