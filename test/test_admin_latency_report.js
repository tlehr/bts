'use strict';

const assert = require('assert');
const { analyze } = require('../debug/admin_latency_report');

function report(latency = 499) {
	return { stop_reason: 'completed', runtime_ms: 600001, failure: null, partial: false, server_profiles: [{}], mixed_server_profiles: false,
		tablet_to_admin_ms: { count: 1, sent_updates: 1, unmatched_updates: 0, max: latency },
		point_receptions: [{ admin_ms: latency, admin_presentation_status: 'presented' }] };
}

describe('Admin maximum latency acceptance', function() {
	it('requires a strict maximum below 500 ms', function() {
		assert.strictEqual(analyze(report(499)).target_met, true);
		for (const value of [500, 501, 1000]) assert.strictEqual(analyze(report(value)).target_met, false);
	});
	it('requires both the inclusive 350 ms maximum and strict 120 ms percentile, calculated from all receipts', function() {
		const value = report(350);
		value.point_receptions = Array.from({length:100}, (_, index) => ({admin_ms:index === 99 ? 350 : 119, admin_presentation_status:'presented'}));
		Object.assign(value.tablet_to_admin_ms, {count:100, sent_updates:100, p95:119});
		const accept = () => analyze(value, 350, {p95:120, inclusive:true});
		assert.strictEqual(accept().target_met, true);
		value.point_receptions[0].admin_ms = 351;value.tablet_to_admin_ms.max = 351;
		assert.strictEqual(accept().target_met, false);
		value.point_receptions[0].admin_ms = 119;value.tablet_to_admin_ms.max = 350;
		value.point_receptions.slice(90, 99).forEach(point => {point.admin_ms = 120;});value.tablet_to_admin_ms.p95 = 120;
		assert.strictEqual(accept().target_met, false);
		value.tablet_to_admin_ms.p95 = 119;
		assert.strictEqual(accept().percentile_matches_report, false);
		assert.strictEqual(accept().target_met, false);
	});
	it('rejects partial runs, missing presentation receipts, restarts and inconsistent summaries', function() {
		for (const change of [r => { r.partial = true; }, r => { r.stop_reason = 'user'; }, r => { r.failure = 'failed'; }, r => { r.runtime_ms = 599999; },
			r => { r.point_receptions = []; }, r => { r.point_receptions[0].admin_presentation_status = 'timeout'; },
			r => { r.tablet_to_admin_ms.sent_updates = 2; }, r => { r.tablet_to_admin_ms.max = 100; },
			r => { r.mixed_server_profiles = true; }, r => { r.server_profiles.push({}); }]) {
			const value = report();change(value);assert.strictEqual(analyze(value).target_met, false);
		}
	});
});
