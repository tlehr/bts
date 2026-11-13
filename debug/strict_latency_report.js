'use strict';

// Evaluate the user's three strict maxima separately. A missing match finish,
// unmatched score or reception-only admin run must never look like a pass.
const fs = require('fs');
function distribution(values, limit) {
	const sorted = values.filter(Number.isFinite).sort((a,b) => a-b), count = sorted.length;
	return {count, limit_ms:limit, median_ms:count ? (sorted[Math.floor((count-1)/2)]+sorted[Math.floor(count/2)])/2 : null,
		p95_ms:count ? sorted[Math.ceil(count*.95)-1] : null, p99_ms:count ? sorted[Math.ceil(count*.99)-1] : null,
		max_ms:count ? sorted[count-1] : null, violations:sorted.filter(value => value >= limit).length};
}
function analyze(report) {
	const points = report.point_receptions || [], finishes = new Set((report.test_events || [])
		.filter(event => event.label === 'live-drill:finish-confirm').map(event => event.data.trace_id));
	const ordinary = points.filter(point => !finishes.has(point.trace_id)), finished = points.filter(point => finishes.has(point.trace_id));
	const latency = {ordinary:distribution(ordinary.map(point => point.admin_ms),100),
		finish:distribution(finished.map(point => point.admin_ms),150), display:distribution(points.map(point => point.tv_ms),50)};
	const complete = report.stop_reason === 'completed' && report.runtime_ms >= 600000 && !report.failure && report.partial !== true;
	const sent = report.tablet_to_admin_ms?.sent_updates;
	const coverage = points.length > 0 && points.length === sent && points.length === report.tablet_to_tv_ms?.sent_updates &&
		points.length === report.tablet_to_admin_ms?.count && points.length === report.tablet_to_tv_ms?.count &&
		points.every(point => point.admin_presentation_status === 'presented' && Number.isFinite(point.admin_ms) && Number.isFinite(point.tv_ms)) &&
		new Set(points.map(point => point.trace_id)).size === points.length &&
		Object.values(report.reception_expired || {}).every(count => count === 0);
	const render = report.reception?.admin?.length > 0 && report.reception.admin.every(admin => admin.method === 'browser-dom-and-render-opportunity');
	const stable = report.server_profiles?.length === 1 && !report.mixed_server_profiles;
	const observed = latency.ordinary.count > 0 && latency.finish.count > 0 && latency.display.count === points.length;
	const targets = Object.values(latency).every(value => value.count > 0 && value.violations === 0);
	const operation_failures = (report.server_performance?.traces || []).filter(trace => trace.status === 'error')
		.reduce((counts,trace) => { counts[trace.name] = (counts[trace.name] || 0) + 1; return counts; },{});
	const successful_operations = Object.keys(operation_failures).length === 0;
	return {complete, coverage, render_endpoint:render, stable_server:stable, all_kinds_observed:observed,
		successful_operations, target_met:complete && coverage && render && stable && observed && targets && successful_operations, latency,
		workload:{scenario:report.scenario,seed:report.seed,active_courts:report.initial_state?.active_courts,
			phases:(report.phases || []).map(phase => ({name:phase.name,points:phase.points,
				finishes:phase.finish_confirmations,occupied_courts:phase.occupied_courts}))},
		operation_failures,
		started_at:report.started_at,runtime_ms:report.runtime_ms,initial_state:report.initial_state,settings:report.settings,
		blocking_diagnostics:(report.reception?.admin || []).map(admin => ({enabled:admin.blocking_diagnostics?.enabled,
			cpu_enabled:admin.blocking_diagnostics?.cpu_enabled,cpu_sampling_us:admin.blocking_diagnostics?.cpu_sampling_us,
			windows:admin.blocking_diagnostics?.windows?.length,errors:admin.blocking_diagnostics?.errors})),
		worst:points.slice().sort((a,b) => (b.admin_ms || 0)-(a.admin_ms || 0)).slice(0,12)
			.map(point => ({...point,kind:finishes.has(point.trace_id) ? 'finish' : 'ordinary'}))};
}
if (require.main === module) {
	try {
		const result = analyze(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
		if (process.argv[3] && !process.argv[3].startsWith('--')) fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
		console.log(JSON.stringify({...result,worst:undefined},null,2));
		if (process.argv.includes('--require-target') && !result.target_met) process.exitCode = 1;
	} catch(error) {
		// A report is streamed to disk. Avoid Node printing a huge partial JSON
		// source line if a caller opens it before live-drill:report is logged.
		console.error('Cannot analyze completed latency report: '+error.message);process.exitCode = 2;
	}
}
module.exports = {analyze};
