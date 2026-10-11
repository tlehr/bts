'use strict';

const assert = require('assert');
const { parse, statistics, summarize } = require('../debug/mixed_queue_benchmark');

describe('mixed queue benchmark', function() {
	it('rejects unbounded workloads and ambiguous refs/options', function() {
		for (const args of [['--duration-ms', '0'], ['--duration-ms', '300001'], ['--matches', '13'], ['--sync-interval-ms', '499'],
			['--ref', '--all'], ['--duration-ms', 'NaN'], ['--matches', '519.5'], ['--point-min-ms', '49'],
			['--point-min-ms', '1601'], ['--set-points', '0'], ['--workload', 'unknown'], ['--unknown', '1']]) assert.throws(() => parse(args));
		assert.strictEqual(parse(['--duration-ms', '180000']).duration_ms, 180000);
		assert.strictEqual(parse(['--workload', 'preparation']).workload, 'preparation');
		assert.strictEqual(parse([]).workload, 'ordering');
	});
	it('reuses 26 participant pairs while retaining all independent planning IDs', function() {
		const { response } = require('../debug/queue_responsiveness/fixture');
		const matches = response(519, false, 26).Result[0].Tournament[0].Matches[0].Match;
		const leaves = matches.filter(match => match.IsMatch[0] === false);
		assert.strictEqual(new Set(leaves.map(match => match.EntryID[0])).size, 52);
		assert.strictEqual(new Set(matches.map(match => match.PlanningID[0])).size, 1557);
		assert.strictEqual(matches.filter(match => match.IsMatch[0]).length, 519);
		assert.strictEqual(leaves[0].EntryID[0], leaves[52].EntryID[0]);
	});
	it('reports unavailable values and finite percentiles without inventing zero latency', function() {
		assert.deepStrictEqual(statistics([null, undefined, NaN]), { count: 0, mean: null, median: null, p95: null, max: null });
		assert.deepStrictEqual(statistics([1, 4, 3, 2]), { count: 4, mean: 2.5, median: 2, p95: 4, max: 4 });
	});
	it('separates growing scheduler, DB and pre-lock sync backlogs across the run', function() {
		const samples = Array.from({ length: 9 }, (_, i) => ({ ns: String(i * 1000000), pending: i, oldest_pending_ms: i * 10,
			db: { matches: { pending: i * 2 }, players: { pending: i } } }));
		const server = { samples, drained: true, syncs: [{ enqueued_ns: '0', planning_ns: '1000000', finished_ns: '2000000' }],
			sync_backlog_samples: samples.map(row => ({ ns: row.ns, pending: row.pending + 1, oldest_ms: row.oldest_pending_ms })),
			tasks: [{ owner: 'score_update', wait_ms: 12 }], finished_matches: 1, oncourt_matches: 13, event_loop: {} };
		const client = { points: 100, tablet_to_tv_ms: { count: 100 }, tablet_to_admin_ms: { count: 100 },
			payload_types: { admin: [{ type: 'change:match_called_on_court', count: 2 }] },
			server_performance: { traces: [{ status: 'error' }, { status: 'ok' }] } };
		const probes = { probes: [{ kind: 'free', latency_ms: 4 }, { kind: 'call', latency_ms: 8 }], unanswered: 0 };
		const result = summarize(server, client, probes);
		assert.strictEqual(result.finished_syncs, 1);
		assert.strictEqual(result.sync_stage_start_ms.max, 1);
		assert.strictEqual(result.call_ms.max, 8);
		assert(result.windows[2].pending.mean > result.windows[0].pending.mean);
		assert.strictEqual(result.windows[2].database_pending.max, 24);
		assert.strictEqual(result.windows[2].unfinished_syncs.max, 9);
		assert.strictEqual(result.point_queue_wait_ms.max, 12);
		assert.strictEqual(result.processing_errors, 1);
	});
});
