'use strict';

const fs = require('fs');
const assert = require('assert');

function analyze(report, target = 500, { p95: p95Target = null, inclusive = false } = {}) {
	const scores = report.tablet_to_admin_ms || {};
	const points = report.point_receptions || [];
	const valid = points.filter(point => point.admin_presentation_status === 'presented' && Number.isFinite(point.admin_ms));
	const complete = report.stop_reason === 'completed' && report.runtime_ms >= 600000 && !report.failure && !report.partial;
	const coverage = scores.count > 0 && scores.count === scores.sent_updates && scores.unmatched_updates === 0 && valid.length === scores.count;
	const maximum = valid.length ? Math.max(...valid.map(point => point.admin_ms)) : null;
	const sorted = valid.map(point => point.admin_ms).sort((a, b) => a - b);
	const p95 = sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null;
	const percentileMatches = p95Target == null || p95 === scores.p95;
	const belowMaximum = maximum != null && (inclusive ? maximum <= target : maximum < target);
	const belowPercentile = p95Target == null || p95 != null && p95 < p95Target;
	const stable = report.server_profiles?.length === 1 && !report.mixed_server_profiles;
	return { scope: 'Tablet send to real browser presentation receipt; full isolated server benchmark. External BTP, ticker and speech services disabled.',
		runtime_ms: report.runtime_ms, stop_reason: report.stop_reason, failure: report.failure,
		target_max_ms: target, target_max_inclusive: inclusive, target_p95_ms: p95Target, complete, all_scores_presented: coverage, stable_server: stable,
		maximum_matches_report: maximum === scores.max, percentile_matches_report: percentileMatches,
		target_met: complete && coverage && stable && maximum === scores.max && percentileMatches && belowMaximum && belowPercentile,
		admin: scores, tv: report.tablet_to_tv_ms,
		maxima_over_target: valid.filter(point => inclusive ? point.admin_ms > target : point.admin_ms >= target).length,
		worst: valid.slice().sort((a, b) => b.admin_ms - a.admin_ms).slice(0, 10),
		ui_jobs: report.reception?.admin?.[0]?.ui_jobs,
	};
}

if (require.main === module) {
	const option = name => {const index = process.argv.indexOf(name);return index < 0 ? null : Number(process.argv[index + 1]);};
	const target = option('--max-ms') ?? 500, p95 = option('--p95-ms');
	assert(Number.isFinite(target) && target > 0 && (p95 == null || Number.isFinite(p95) && p95 > 0), 'Latency targets must be positive numbers');
	const result = analyze(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), target, {p95, inclusive:process.argv.includes('--inclusive-max')});
	if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
	console.log(JSON.stringify({ ...result, worst: undefined, ui_jobs: undefined }, null, 2));
	if (process.argv.includes('--require-target')) assert(result.target_met, 'Every score must be presented and both full-run latency targets must be met');
}
module.exports = { analyze };
