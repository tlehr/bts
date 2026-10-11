'use strict';

// Real subprocesses for runner lifecycle tests. Never loads the BTS database
// or sends scores/check-ins; only serves an isolated read-only admin endpoint.
const fs = require('fs').promises;
const http = require('http');
const WebSocket = require('ws');
const { AdminWsClient } = require('../../debug/live_tournament_drill');
const profile = require('../../bts/offload/profile');

async function main() {
	if (process.env.BTS_BENCHMARK_SEQUENCE_ROLE === 'server') {
		if (process.env.BTS_SEQUENCE_TEST_SERVER_EXIT === '1') process.exit(7);
		const server = http.createServer();
		const wss = new WebSocket.Server({ server });
		const actual = profile.snapshot();
		if (process.env.BTS_SEQUENCE_TEST_WRONG_PROFILE === '1') actual.features.xlsx_import = true;
		wss.on('connection', ws => ws.on('message', raw => {
			const msg = JSON.parse(raw);
			ws.send(JSON.stringify({ type: 'answer', rid: msg.rid, tournament: {
				debug_offloading: actual, matches: Array.from({ length: 519 }, (_, id) => ({ _id: String(id) })),
			} }));
		}));
		const url = new URL(process.env.BTS_BENCHMARK_BASE_URL);
		server.listen(Number(url.port), url.hostname);
		console.log('fixture server started ' + actual.run_label);
		return;
	}
	const args = process.argv.slice(2);
	const arg = name => args[args.indexOf(name) + 1];
	if (process.env.BTS_SEQUENCE_TEST_IGNORE_SIGNALS === '1') {
		process.on('SIGINT', () => {});
		console.log('fixture ignores SIGINT');
	}
	if (process.env.BTS_SEQUENCE_TEST_CLIENT_DELAY === '1') await new Promise(resolve => setTimeout(resolve, 30000));
	const client = new AdminWsClient(arg('--base-url'), arg('--tournament'));
	try {
		const tournament = await client.tournament();
		const report = { stop_reason: 'completed', mixed_server_profiles: false, runtime_ms: 600000,
			server_offloading: tournament.debug_offloading, server_profiles: [{ elapsed_ms: 0, profile: tournament.debug_offloading }],
			initial_state: { matches: 519 }, points: 3, checkins: 2, phases: [], seed: arg('--seed'), scenario: arg('--scenario') };
		if (process.env.BTS_SEQUENCE_TEST_INCOMPLETE === '1') report.stop_reason = 'interrupted';
		if (process.env.BTS_SEQUENCE_TEST_MIXED === '1') report.mixed_server_profiles = true;
		await fs.writeFile(arg('--report'), JSON.stringify(report));
		console.log('fixture benchmark completed');
	} finally { client.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
