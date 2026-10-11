'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { EventEmitter } = require('events');
const { _describe, _it } = require('./tutils');
const { parse_args, benchmark_checkin_requests, schedule_next_point, next_random_score, Dashboard, AdminWsClient } = require('../debug/live_tournament_drill');
const { LatencyStats } = require('../debug/live_drill_metrics');
const { latency_summary } = require('../debug/live_drill_scenario');
const { build_display_points_update_v2 } = require('../bts/bupws_v2');
const { BENCHMARK_PHASES, benchmark_phase, random_source, CheckinPacer } = require('../debug/live_drill_scenario');

function build_match(id, state = 'scheduled', checked_in = false) {
	return {
		_id: 'match-' + id, presses: [],
		setup: {
			match_id: 'match-' + id, match_num: id, state, counting: '3x21',
			court_id: 'court-1', now_on_court: state === 'called', called_timestamp: 1800000000000,
			warmup: 'call-down', warmup_start: 180, warmup_ready: 150,
			teams: [
				{ players: [{ btp_id: id * 2, checked_in }] },
				{ players: [{ btp_id: id * 2 + 1, checked_in }] },
			],
		},
	};
}

// Run all ten minutes with real scoring logic and a virtual clock, without live data.
async function simulate_benchmark({ expected = 519, interrupt = false, change_profile = false } = {}) {
	const epoch = 1800000000000;
	let now = epoch;
	const logs = [];
	const checkins = [];
	const scores = [];
	let displays = 0;
	let report = null;
	const tournament = {
		debug_offloading: { server_id: 'test-server-1', run_label: 'baseline', features: { sync_plan: false } },
		matches: Array.from({ length: 519 }, (_, i) => ({ _id: 'match-' + (i + 1), setup: { state: 'finished' } })),
		courts: [{ _id: 'court-1', num: 1 }, { _id: 'court-2', num: 2 }],
		btp_settings: { check_in_per_match: true },
	};
	tournament.matches[0] = build_match(1, 'called', true);
	// Begin at a later tournament point, with one game close to finishing.
	for (let i = 0; i < 40; i++) {
		Object.assign(tournament.matches[0], next_random_score(tournament.matches[0], 10000, 1, () => 0));
	}
	tournament.matches[1] = build_match(2, 'preparation');
	tournament.matches[2] = build_match(3);
	tournament.matches[2].setup.teams[0].players[0].btp_id = null;
	tournament.matches[3] = build_match(4, 'blocked');
	tournament.matches[3].setup.teams[0].players[0].now_tablet_on_court = 'court-2';
	tournament.matches[3].setup.teams[1].players[0].now_playing_on_court = 'court-1';
	let new_players_added = false;
	let players_released = false;
	const fake_process = new EventEmitter();
	fake_process.stdout = { isTTY: false };
	fake_process.stdin = { isTTY: false };

	class AdminClient {
		async connect() {}
		async tournament() {
			if (change_profile && now - epoch >= 20000) tournament.debug_offloading = {
				server_id: 'test-server-2', run_label: 'sync-plan', features: { sync_plan: true },
			};
			if (!new_players_added && now - epoch >= 180000) {
				new_players_added = true;
				tournament.matches[2].setup.teams[0].players[0].btp_id = 6;
				tournament.matches[2].setup.state = 'preparation';
			}
			if (!players_released && now - epoch >= 481000) {
				players_released = true;
				tournament.matches[3].setup.state = 'preparation';
				for (const team of tournament.matches[3].setup.teams) {
					team.players[0].now_tablet_on_court = false;
					team.players[0].now_playing_on_court = false;
				}
			}
			if (interrupt && now - epoch >= 20000) fake_process.emit('SIGINT');
			const occupied = new Set(tournament.matches.filter((match) => match.setup.now_on_court).map((match) => match.setup.court_id));
			for (const match of tournament.matches) {
				if (match.setup.state !== 'preparation' || !match.setup.teams.every((team) => team.players.every((player) => player.checked_in))) continue;
				const court = tournament.courts.find((court) => !occupied.has(court._id));
				if (!court) break;
				match.setup.state = 'called';
				match.setup.now_on_court = true;
				match.setup.court_id = court._id;
				occupied.add(court._id);
			}
			return JSON.parse(JSON.stringify(tournament));
		}
		async send(type, request) {
			assert.strictEqual(type, 'match_player_check_in');
			checkins.push({ ...request, elapsed: now - epoch });
			const match = tournament.matches.find((entry) => entry._id === request.match_id);
			assert.strictEqual(request.require_preparation, true);
			assert.strictEqual(match.setup.state, 'preparation');
			for (const team of match.setup.teams) {
				for (const player of team.players) if (player.btp_id === request.player_id) player.checked_in = true;
			}
		}
		close() {}
	}
	class TabletClient {
		constructor(_url, _key, _court, _options, dashboard) { this.dashboard = dashboard; }
		async score(match, score, before_send) {
			if (before_send() === false) return false;
			scores.push({ match_id: match._id, elapsed: now - epoch, finished: !!score.finish_confirmed });
			const live_match = tournament.matches.find((entry) => entry._id === match._id);
			Object.assign(live_match, score);
			if (score.finish_confirmed) {
				live_match.setup.state = 'finished';
				live_match.setup.now_on_court = false;
			}
			now += 8;
			this.dashboard.record_admin_payload({ type: 'change', tournament_key: 'default', ctype: 'score', val: score });
			now += 4;
			const sets = score.network_score.map((pair) => score.network_team1_left === false ? [pair[1], pair[0]] : pair);
			this.dashboard.record_display_payload(score.court_id, 'display_score', {
				match: { id: match._id },
				score: {
					finished_sets: sets.slice(0, -1).map(([left, right]) => ({ left, right })),
					current_set: { left: sets[sets.length - 1][0], right: sets[sets.length - 1][1] },
				},
			});
		}
		close() {}
	}
	class DisplayClient {
		async connect() { displays++; }
		close() {}
	}
	const filename = path.resolve(__dirname, '../debug/live_tournament_drill.js');
	const module = { exports: {} };
	const local_require = createRequire(filename);
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
		module, require: (name) => name === 'fs' ? { promises: { writeFile: async (_path, data) => { report = JSON.parse(data); } } } : local_require(name),
		process: fake_process,
		Date: class extends Date { static now() { return now; } },
		console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
		setTimeout: (callback, ms) => { now += ms; queueMicrotask(callback); return 1; },
		clearTimeout() {},
	}, { filename });
	const options = module.exports.parse_args(['--scenario', 'benchmark', '--plain-log', '--expected-matches', String(expected)]);
	let error = null;
	try {
		await module.exports.run(options, { AdminClient, TabletClient, DisplayClient });
	} catch (err) { error = err; }
	const stop = JSON.parse(logs.find(([label]) => label === 'live-drill:stop')[1]);
	return { logs, checkins, scores, displays, stop, error, report };
}

_describe('live tournament benchmark', () => {
	_it('matches actual TV scores on either side, including completed sets after a side switch', () => {
		for (const team1_left of [true, false]) {
			const dashboard = new Dashboard(parse_args([]));
			const match = build_match(1, 'called', true);
			Object.assign(match, { network_score: [[21, 15], [12, 21], [8, 4]], network_team1_left: team1_left });
			dashboard.record_score_sent({ ...match, court_id: 'court-1', match_id: match._id });
			const payload = build_display_points_update_v2({}, { court: { _id: 'court-1' }, match });
			dashboard.record_display_payload('court-1', payload.type, {
				match: { id: 'bts_' + match._id }, score: payload.score,
			});
			assert.strictEqual(dashboard.latencies.length, 1);
			assert.strictEqual((dashboard.pending_by_court.get('court-1') || []).length, 0);
		}
	});

	_it('keeps score updates pending for empty, stale, or other-match TV scores', () => {
		const dashboard = new Dashboard(parse_args([]));
		dashboard.record_score_sent({ court_id: 'court-1', match_id: 'match-1', network_score: [[8, 4]], network_team1_left: false });
		for (const state of [
			{ match: { id: 'match-1' } },
			{ match: { id: 'match-1' }, score: { current_set: { left: 8, right: 4 } } },
			{ match: { id: 'match-2' }, score: { current_set: { left: 4, right: 8 } } },
		]) dashboard.record_display_payload('court-1', 'display_points_update', state);
		assert.strictEqual(dashboard.latencies.length, 0);
		assert.strictEqual(dashboard.pending_by_court.get('court-1').length, 1);
	});

	_it('has a fixed ten-minute schedule and seed while retaining explicit point intervals', () => {
		const options = parse_args(['--scenario', 'benchmark', '--point-min-ms', '3500']);
		assert.strictEqual(options.max_runtime_ms, 600000);
		assert.strictEqual(options.seed, '519');
		assert.strictEqual(options.expected_matches, 519);
		assert.strictEqual(options.point_min_ms, 3500);
		assert.strictEqual(options.point_max_ms, 6400);
		assert.strictEqual(benchmark_phase(359999).idle, false);
		assert.strictEqual(benchmark_phase(360000).idle, true);
		assert.strictEqual(benchmark_phase(480000).idle, false);
		assert.strictEqual(benchmark_phase(600000), null);
		assert.throws(() => parse_args(['--scenario', 'benchmark', '--max-runtime-ms', '300000']), /fixed/);
		assert.throws(() => parse_args(['--scenario']), /Missing value/);
		assert.throws(() => parse_args(['--include-blocked-checkins']), /Only preparation/);
		assert.strictEqual(parse_args([]).seed, null);
	});

	_it('keeps seeded match scores and intervals independent of other match and battery traffic', () => {
		const a = parse_args(['--scenario', 'benchmark']);
		const b = parse_args(['--scenario', 'benchmark']);
		let match_a = build_match(1, 'called', true);
		let match_b = build_match(1, 'called', true);
		const schedule_a = new Map();
		const schedule_b = new Map();
		for (let i = 0; i < 12; i++) {
			const score_a = next_random_score(match_a, 10000, 0.55, random_source(a, 'score:match-1'));
			random_source(b, 'battery:other-court')();
			random_source(b, 'score:other-match')();
			const score_b = next_random_score(match_b, 10000, 0.55, random_source(b, 'score:match-1'));
			assert.deepStrictEqual(score_a.network_score, score_b.network_score);
			schedule_next_point(schedule_a, 'match-1', 1000, a);
			schedule_next_point(schedule_b, 'match-1', 1000, b);
			assert.strictEqual(schedule_a.get('match-1'), schedule_b.get('match-1'));
			match_a = { ...match_a, ...score_a };
			match_b = { ...match_b, ...score_b };
		}
	});

	_it('paces 519 doubles matches within two minutes and keeps checking in later arrivals', () => {
		const requests = Array.from({ length: 519 }, (_, match) => Array.from({ length: 4 }, (_, player) => ({
			match_id: match, player_id: player,
		}))).flat();
		const pacer = new CheckinPacer(0);
		let pending = requests.slice();
		assert.strictEqual(pacer.due(pending, 0).length, 4, 'first match checks in together');
		for (let now = 0; now < 120000; now += 250) {
			const due = pacer.due(pending, now);
			for (const request of due) pacer.complete(request, now, true);
			pending = pending.filter((request) => !due.includes(request));
		}
		assert.strictEqual(pending.length, 0);
		const later = { match_id: 'later', player_id: 10 };
		assert.deepStrictEqual(pacer.due([later], 180000), [later]);
		pacer.complete(later, 180000, false);
		assert.deepStrictEqual(pacer.due([later], 189999), []);
		assert.deepStrictEqual(pacer.due([later], 190000), [later]);
		pacer.complete(later, 190000, true);
		assert.deepStrictEqual(pacer.due([later], 190001), []);
		assert.deepStrictEqual(pacer.due([later], 200000), [later], 'a cleared check-in is checked again');
	});

	_it('checks in preparation only, excluding scheduled, blocked, busy and finished players', () => {
		const scheduled = build_match(1);
		const preparation = build_match(2, 'preparation');
		const blocked = build_match(3, 'blocked');
		blocked.setup.teams[0].players[0].now_tablet_on_court = 'court-1';
		blocked.setup.teams[1].players[0].now_playing_on_court = 'court-2';
		const requests = benchmark_checkin_requests({ matches: [scheduled, blocked, build_match(4, 'finished'), preparation] });
		assert.deepStrictEqual(requests.map((entry) => entry.match_id), ['match-2', 'match-2']);
		blocked.setup.teams[0].players[0].now_tablet_on_court = false;
		blocked.setup.teams[1].players[0].now_playing_on_court = false;
		assert.deepStrictEqual(benchmark_checkin_requests({ matches: [scheduled, blocked] }), []);
		scheduled.setup.state = 'preparation';
		assert.strictEqual(benchmark_checkin_requests({ matches: [scheduled, blocked] }).length, 2);
		scheduled.setup.teams[0].players[0].now_playing_on_court = 'court-1';
		assert.strictEqual(benchmark_checkin_requests({ matches: [scheduled] }).length, 1);
		scheduled.setup.now_on_court = true;
		assert.deepStrictEqual(benchmark_checkin_requests({ matches: [scheduled] }), []);
	});

	_it('runs all phases, leaves idle free of writes, and handles check-ins well after the first two minutes', async function() {
		this.timeout(15000);
		const result = await simulate_benchmark();
		assert.strictEqual(result.error, null);
		assert.strictEqual(result.stop.stop_reason, 'completed');
		assert(result.stop.runtime_ms >= 600000 && result.stop.runtime_ms < 600500);
		assert.deepStrictEqual(result.stop.phases.map((phase) => phase.name), BENCHMARK_PHASES.map((phase) => phase.name));
		assert.strictEqual(result.displays, 2);
		assert(result.scores.length > 0);
		assert(result.scores.every((score) => score.elapsed < 360000 || score.elapsed >= 480000));
		assert(result.checkins.every((request) => request.elapsed < 360000 || request.elapsed >= 480000));
		assert(result.checkins.filter((request) => request.match_id === 'match-2').every((request) => request.elapsed < 120000));
		assert.strictEqual(result.checkins.filter((request) => request.match_id === 'match-3' && request.elapsed >= 180000).length, 2);
		assert.strictEqual(result.checkins.filter((request) => request.match_id === 'match-4' && request.elapsed >= 481000).length, 2);
		const idle = result.stop.phases.find((phase) => phase.idle);
		assert.strictEqual(idle.score_updates, 0);
		assert.strictEqual(idle.player_checkins, 0);
		assert(idle.free_courts.count > 0);
		assert.strictEqual(result.stop.phases[0].tablet_to_tv_ms.mean, 12);
		assert.strictEqual(result.stop.phases[0].tablet_to_admin_ms.mean, 8);
		for (const phase of result.stop.phases) {
			assert.strictEqual(phase.tablet_to_tv_ms.sent_updates, phase.score_updates);
			assert.strictEqual(phase.tablet_to_tv_ms.unmatched_updates, 0);
			assert.strictEqual(phase.tablet_to_tv_ms.coverage, phase.score_updates ? 1 : null);
			assert.strictEqual(phase.tablet_to_admin_ms.count, phase.tablet_to_tv_ms.count);
			assert.strictEqual(phase.tablet_to_admin_ms.unmatched_updates, 0);
		}
		assert.strictEqual(result.report.tablet_to_admin_ms.count, result.scores.length);
		assert.strictEqual(result.report.tablet_to_admin_ms.mean, 8);
		assert.strictEqual(result.report.payload_types.admin.find(row => row.type === 'change:score').count, result.scores.length);
		assert.strictEqual(result.report.latency_matching, 'display-side-score');
		assert.strictEqual(result.report.mixed_server_profiles, false);
		assert.strictEqual(result.report.server_offloading.run_label, 'baseline');
		assert.strictEqual(result.report.server_profiles.length, 1);
		assert(result.stop.phases[0].finish_confirmations > 0, 'separate match-end confirmation is exercised');
		assert.strictEqual(result.report.initial_state.matches, 519);
		assert.strictEqual(result.report.initial_state.finished_matches, 515);
		assert.strictEqual(result.report.checkin_window.pending_player_checkins, 0);
		assert.match(result.report.initial_state.state_sha256, /^[a-f0-9]{64}$/);
	});

	_it('identifies a server restart or changed feature profile within a run', async function() {
		this.timeout(15000);
		const result = await simulate_benchmark({ change_profile: true });
		assert.strictEqual(result.error, null);
		assert.strictEqual(result.report.mixed_server_profiles, true);
		assert.strictEqual(result.report.server_profiles.length, 2);
		assert.strictEqual(result.report.server_profiles[0].profile.run_label, 'baseline');
		assert.strictEqual(result.report.server_profiles[1].profile.run_label, 'sync-plan');
		assert(result.logs.some(([label]) => label === 'live-drill:server-profile-changed'));
	});

	_it('rejects the wrong match count before sending tablet or check-in traffic', async () => {
		const result = await simulate_benchmark({ expected: 520 });
		assert.match(result.error.message, /Expected 520 matches, found 519/);
		assert.strictEqual(result.displays, 0);
		assert.strictEqual(result.checkins.length, 0);
		assert.strictEqual(result.scores.length, 0);
		assert.strictEqual(result.stop.stop_reason, 'error');
	});

	_it('reports an interrupted run and closes the sequence before later phases', async () => {
		const result = await simulate_benchmark({ interrupt: true });
		assert.strictEqual(result.error, null);
		assert.strictEqual(result.stop.stop_reason, 'interrupted');
		assert.strictEqual(result.stop.phases.length, 1);
		assert(result.stop.runtime_ms < 21000);
	});
});

_describe('live dashboard cumulative metrics and admin reception', () => {
	_it('keeps payload totals and latency summaries after five minutes, with all payload types', () => {
		const now = Date.now, dashboard = new Dashboard(parse_args(['--dashboard']));
		let time = 1000000;
		Date.now = () => time;
		try {
			dashboard.record_score_sent({ court_id: 'court-1', match_id: 'match-1', network_score: [[8, 4]] });
			time += 20;
			dashboard.record_display_payload('court-1', 'display_points_update', {
				match: { id: 'match-1' }, score: { current_set: { left: 8, right: 4 } },
			});
			dashboard.record_admin_payload({ type: 'change', ctype: 'score', val: { match_id: 'match-1', court_id: 'court-1', network_score: [[8, 4]] } });
			time += 600000; dashboard.prune_latencies();
			assert.strictEqual(dashboard.latencies.length, 0);
			assert.strictEqual(dashboard.admin_latencies.length, 0);
			assert.deepStrictEqual(dashboard.payload_type_stats().map(row => [row.type, row.count, row.avg]), [['display_points_update', 1, 20]]);
			assert.strictEqual(dashboard.tv_latency_stats.summary(dashboard.score_updates).count, 1);
			assert.strictEqual(dashboard.admin_latency_stats.summary(dashboard.score_updates).mean, 20);
			for (let i = 0; i < 10; i++) dashboard.record_display_payload('court-1', 'payload-' + i, {});
			const write = process.stdout.write; let output = '';
			try { process.stdout.write = text => { output += text; return true; }; dashboard.render(); dashboard.view = 3; dashboard.render(); }
			finally { process.stdout.write = write; }
			assert(output.includes('entire run')); assert(output.includes('Admin')); assert(output.includes('AdmLast'));
			assert(output.includes('p95')); assert(output.includes('p99'));
			for (let i = 0; i < 10; i++) assert(output.includes('payload-' + i), 'all types must be rendered');
		} finally { Date.now = now; }
	});
	_it('matches admin team-order scores independently of TV side-order scores and receipt order', () => {
		for (const admin_first of [false, true]) {
			const dashboard = new Dashboard(parse_args([]));
			dashboard.record_score_sent({ court_id: 'court-1', match_id: 'match-1', network_score: [[21, 15], [8, 4]], network_team1_left: false });
			const admin = () => dashboard.record_admin_payload({ type: 'change', tournament_key: 'default', ctype: 'score',
				val: { court_id: 'court-1', match_id: 'bts_match-1', network_score: [[21, 15], [8, 4]] } });
			const tv = () => dashboard.record_display_payload('court-1', 'display_points_update', { match: { id: 'match-1' },
				score: { finished_sets: [{ left: 15, right: 21 }], current_set: { left: 4, right: 8 } } });
			if (admin_first) { admin(); tv(); } else { tv(); admin(); }
			admin(); tv(); // Duplicate delivery must not create more samples.
			assert.strictEqual(dashboard.admin_latency_stats.count, 1);
			assert.strictEqual(dashboard.tv_latency_stats.count, 1);
			assert.strictEqual(dashboard.admin_payload_type_stats()[0].count, 2);
		}
	});
	_it('rejects unrelated, stale and control events, including same-score match-end confirmations', () => {
		const dashboard = new Dashboard(parse_args([]));
		const press = { type: 'score', timestamp: 123, side: 'left' };
		const score = { court_id: 'court-1', match_id: 'match-1', network_score: [[21, 15]], presses: [press] };
		dashboard.record_score_sent(score);
		const event = val => ({ type: 'change', tournament_key: 'default', ctype: 'score', val });
		for (const msg of [
			{ ...event(score), tournament_key: 'other' }, { ...event(score), ctype: 'match' },
			{ type: 'answer', tournament: { matches: [score] } },
			event({ ...score, court_id: 'court-2' }), event({ ...score, match_id: 'match-2' }),
			event({ ...score, network_score: [[20, 15]] }), event({ ...score, presses: [] }),
		]) dashboard.record_admin_payload(msg);
		assert.strictEqual(dashboard.admin_latency_stats.count, 0);
		dashboard.record_admin_payload(event(score));
		assert.strictEqual(dashboard.admin_latency_stats.count, 1);
		const confirm = { ...score, finish_confirmed: true, end_ts: 500, presses: [press, { type: 'match-finished-confirm', timestamp: 500 }] };
		dashboard.record_score_sent(confirm); dashboard.record_admin_payload(event(score));
		assert.strictEqual(dashboard.admin_latency_stats.count, 1, 'old final point must not match finish confirmation');
		dashboard.record_admin_payload(event(confirm));
		assert.strictEqual(dashboard.admin_latency_stats.count, 2);
	});
	_it('leaves timed-out events unmatched and attributes late valid reception to the sending phase', () => {
		const now = Date.now; let time = 1000000;
		Date.now = () => time;
		try {
			const dashboard = new Dashboard(parse_args([])), phase = { score_updates: 0, latencies: [], admin_latencies: [] };
			dashboard.phase_stats = phase;
			const score = { court_id: 'court-1', match_id: 'match-1', network_score: [[8, 4]] };
			dashboard.record_score_sent(score); dashboard.phase_stats = { latencies: [], admin_latencies: [] };
			time += 25; dashboard.record_admin_payload({ type: 'change', ctype: 'score', val: score });
			assert.deepStrictEqual(phase.admin_latencies, [25]);
			dashboard.record_score_sent({ ...score, network_score: [[9, 4]] });
			time += 30001; dashboard.record_admin_payload({ type: 'change', ctype: 'score', val: { ...score, network_score: [[9, 4]] } });
			const summary = dashboard.admin_latency_stats.summary(dashboard.score_updates);
			assert.strictEqual(summary.count, 1); assert.strictEqual(summary.unmatched_updates, 1);
		} finally { Date.now = now; }
	});
	_it('timestamps admin reception before JSON decoding and retains request/answer handling', async () => {
		const now = Date.now; let time = 1000000;
		Date.now = () => time;
		try {
			const dashboard = new Dashboard(parse_args([])), client = new AdminWsClient('http://localhost:4000', 'default', dashboard);
			const score = { court_id: 'court-1', match_id: 'match-1', network_score: [[8, 4]] };
			dashboard.record_score_sent(score); time += 7;
			client._on_message({ toString() { time += 100; return JSON.stringify({ type: 'change', ctype: 'score', val: score }); } });
			assert.strictEqual(dashboard.admin_latency_stats.summary().mean, 7);
			assert.strictEqual(client.changes.length, 1);
			let answer;
			client.pending.set(1, { resolve: value => { answer = value; } });
			client._on_message(Buffer.from(JSON.stringify({ type: 'answer', rid: 1, status: 'ok' })));
			assert.strictEqual(answer.status, 'ok'); assert.strictEqual(client.pending.size, 0);
			assert(dashboard.admin_payload_type_stats().some(row => row.type === 'answer' && row.count === 1));
		} finally { Date.now = now; }
	});
	_it('computes cumulative percentiles and coverage consistently with the existing benchmark summaries', () => {
		const samples = [0, 1, 1, 1, 5, 50, 51, 100, 101, 200, 201, 300];
		const metrics = new LatencyStats(); for (const sample of samples) metrics.add(sample);
		const expected = latency_summary(samples, 14), actual = metrics.summary(14);
		for (const key of Object.keys(expected)) assert.strictEqual(actual[key], expected[key], key);
		assert.strictEqual(actual.min, 0); assert.strictEqual(metrics.summary(15).unmatched_updates, 3);
		assert.strictEqual(new LatencyStats().summary().p95, null);
	});
});
