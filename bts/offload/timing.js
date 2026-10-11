'use strict';

const profile = require('./profile');
const probe = require('../timing/event_loop_probe');
const ms = ns => Math.round(Number(ns) / 1e5) / 10;

function start(operation, execution, context = {}) {
	const traces = require('../performance/traces');
	const span = traces.begin(operation, 'offload', { ...context, execution });
	if (!profile.timing_enabled()) return span ? { span, finish(error, details = {}) { traces.end(span, error, details); } } : null;
	const started = process.hrtime.bigint(), start_ts = Date.now();
	const feature_profile = profile.snapshot();
	const heartbeat = probe();
	let finished = false;
	return { span, finish(error, details = {}) {
		if (finished) return;
		finished = true;
		traces.end(span, error, details);
		const ended = process.hrtime.bigint();
		const record = { operation, execution, ...context, ...details, start_ts, ts: Date.now(),
			duration_ms: ms(ended - started), status: error ? 'error' : 'ok',
			...(error ? { error_type: error.name } : {}), ...heartbeat.stop(),
			profile: feature_profile };
		try { console.warn('[bts] offload:task ' + JSON.stringify(record)); } // eslint-disable-line no-console
		catch (_) { /* Timing must not change task results. */ }
	} };
}

async function measure(operation, execution, context, work) {
	const timing = start(operation, execution, context);
	let error;
	try { return await require('../performance/traces').run(timing?.span, work); }
	catch (err) { error = err; throw err; }
	finally { if (timing) timing.finish(error); }
}

module.exports = { start, measure, ms };
