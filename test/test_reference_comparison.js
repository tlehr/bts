'use strict';
const assert = require('assert');
const { parse, run, BASELINE } = require('../debug/reference_comparison');
const { Dashboard, parse_args } = require('../debug/live_tournament_drill');
const { defaults, build_options } = require('../debug/web_dashboard/options');

describe('historical server reception comparison', function() {
	it('uses a verified immutable baseline and validates arguments without starting servers', async function() {
		const options = parse(['--dry-run']); assert.strictEqual(options.refs[0], BASELINE);
		const plan = await run(options); assert.strictEqual(plan.refs[0].commit, BASELINE);
		assert.strictEqual(plan.server_telemetry, false); assert.strictEqual(plan.runtime_ms, 600000);
		for (const argv of [['--refs', '-bad'], ['--port', '65536'], ['--runtime-ms', '0'], ['--runtime-ms', '600001']]) assert.throws(() => parse(argv));
	});
	it('keeps reception metrics while exposing disabled server queues as unavailable', function() {
		const options = parse_args(['--no-server-telemetry']); assert.strictEqual(options.server_telemetry, false);
		const dashboard = new Dashboard({ ...options, quiet: true });
		dashboard.performance.unavailable('Reception only');
		assert.strictEqual(dashboard.performance.status().level, 'UNKNOWN');
		assert.strictEqual(dashboard.performance.report().available, false);
		assert.deepStrictEqual(dashboard.performance.rows(), []);
		assert.strictEqual(build_options({ mode: 'interactive', settings: { ...defaults('interactive'), server_telemetry: false } }).server_telemetry, false);
	});
});
