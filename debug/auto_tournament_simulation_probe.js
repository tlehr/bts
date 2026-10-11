'use strict';

const WebSocket = require('ws');

const DEFAULT_BASE_URL = 'https://localhost:4433';
const DEFAULT_TOURNAMENT_KEY = 'default';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function ws_url(base_url, path) {
	const url = new URL(base_url);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = path;
	url.search = '';
	url.hash = '';
	return url.toString();
}

function parse_args(argv) {
	const options = {
		base_url: DEFAULT_BASE_URL,
		tournament_key: DEFAULT_TOURNAMENT_KEY,
		max_waves: 1,
		max_matches: 13,
		location_id: null,
		autofetch_interval_s: 30,
		wait_after_fetch_ms: 4000,
		wait_for_auto_call_ms: 10000,
		wait_for_finish_ms: 30000,
		score_delay_ms: 250,
		adaptive_score_delay: true,
		score_queue_target: 2,
		score_queue_poll_ms: 250,
		point_by_point: true,
		write_btp: false,
		trace_auto_call: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => argv[++i];
		if (arg === '--base-url') options.base_url = next();
		else if (arg === '--tournament') options.tournament_key = next();
		else if (arg === '--max-waves') options.max_waves = Number(next()) || 0;
		else if (arg === '--max-matches') options.max_matches = Number(next()) || 0;
		else if (arg === '--location') options.location_id = next();
		else if (arg === '--autofetch-interval-s') options.autofetch_interval_s = Number(next()) || 0;
		else if (arg === '--wait-after-fetch-ms') options.wait_after_fetch_ms = Number(next()) || 0;
		else if (arg === '--wait-for-auto-call-ms') options.wait_for_auto_call_ms = Number(next()) || 0;
		else if (arg === '--wait-for-finish-ms') options.wait_for_finish_ms = Number(next()) || 0;
		else if (arg === '--score-delay-ms') options.score_delay_ms = Number(next()) || 0;
		else if (arg === '--no-adaptive-score-delay') options.adaptive_score_delay = false;
		else if (arg === '--score-queue-target') options.score_queue_target = Number(next()) || 0;
		else if (arg === '--score-queue-poll-ms') options.score_queue_poll_ms = Number(next()) || 0;
		else if (arg === '--bulk-finish') options.point_by_point = false;
		else if (arg === '--write-btp') options.write_btp = true;
		else if (arg === '--trace-auto-call') options.trace_auto_call = true;
		else if (arg === '--help' || arg === '-h') {
			console.log([
				'Usage: node debug/auto_tournament_simulation_probe.js [options]',
				'  --max-waves N              waves to play, default 1',
				'  --max-matches N            total finished matches, default 13',
				'  --autofetch-interval-s N   BTP autofetch interval, default 30',
				'  --location ID              location id, default first location',
				'  --bulk-finish              send one final score per match instead of point-by-point',
				'  --write-btp                allow the probe to write simulated results back to BTP',
				'  --trace-auto-call          enable verbose auto-call trace on the server',
				'  --no-adaptive-score-delay  keep a fixed score update interval',
				'  --score-queue-target N     wait when BTS update queue is above N, default 2',
			].join('\n'));
			process.exit(0);
		} else {
			throw new Error('Unknown argument ' + arg);
		}
	}
	return options;
}

class AdminWsClient {
	constructor(base_url, tournament_key) {
		this.url = ws_url(base_url, '/ws/admin');
		this.tournament_key = tournament_key;
		this.ws = null;
		this.next_rid = 1;
		this.pending = new Map();
		this.errors = [];
		this.changes = [];
	}

	async connect() {
		this.ws = new WebSocket(this.url, 'bts-admin', { rejectUnauthorized: false });
		this.ws.on('message', (raw) => this._on_message(raw));
		await new Promise((resolve, reject) => {
			this.ws.on('open', resolve);
			this.ws.on('error', reject);
		});
	}

	_on_message(raw) {
		const msg = JSON.parse(raw.toString());
		if ((msg.type === 'answer' || msg.type === 'error') && msg.rid && this.pending.has(msg.rid)) {
			const pending = this.pending.get(msg.rid);
			this.pending.delete(msg.rid);
			if (msg.type === 'error') pending.reject(new Error(msg.message || msg.msg || 'Admin WebSocket error'));
			else pending.resolve(msg);
			return;
		}
		if (msg.type === 'error') this.errors.push(msg);
		if (msg.type === 'change') this.changes.push(msg);
	}

	send(type, payload = {}, timeout_ms = 30000) {
		const rid = this.next_rid++;
		const msg = {
			...payload,
			type,
			rid,
			tournament_key: payload.tournament_key || this.tournament_key,
		};
		this.ws.send(JSON.stringify(msg));
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(rid);
				reject(new Error('Timeout waiting for admin answer to ' + type));
			}, timeout_ms);
			this.pending.set(rid, {
				resolve: (value) => {
					clearTimeout(timeout);
					resolve(value);
				},
				reject: (err) => {
					clearTimeout(timeout);
					reject(err);
				},
			});
		});
	}

	async tournament() {
		const answer = await this.send('tournament_get', { key: this.tournament_key }, 30000);
		return answer.tournament;
	}

	async set_props(props) {
		return this.send('tournament_edit_props', {
			key: this.tournament_key,
			props,
		}, 30000);
	}

	async queue_stats() {
		const answer = await this.send('debug_queue_stats', {}, 5000);
		return answer.queue || {};
	}

	close() {
		if (this.ws) this.ws.close();
	}
}

class BupV2Client {
	constructor(base_url, tournament_key, court_id) {
		this.url = ws_url(base_url, '/ws/bup_v2');
		this.tournament_key = tournament_key;
		this.court_id = court_id;
		this.client_id = 'debug-auto-' + process.pid + '-' + String(court_id).replace(/[^a-zA-Z0-9_-]/g, '_');
		this.hostname = this.client_id;
		this.ws = null;
		this.errors = [];
	}

	async connect() {
		this.ws = new WebSocket(this.url, { rejectUnauthorized: false });
		this.ws.on('message', (raw) => {
			const msg = JSON.parse(raw.toString());
			if (msg.type === 'error') this.errors.push(msg);
		});
		await new Promise((resolve, reject) => {
			this.ws.on('open', resolve);
			this.ws.on('error', reject);
		});
		this.ws.send(JSON.stringify({
			type: 'select_court_assignment',
			tournament_key: this.tournament_key,
			court_id: this.court_id,
			client_id: this.client_id,
			panel_settings: {
				id: this.client_id,
				client_id: this.client_id,
				hostname: this.hostname,
				devicemode: 'umpire',
			},
		}));
		await sleep(150);
	}

	open_match(match_id) {
		this.ws.send(JSON.stringify({
			type: 'match_opened',
			tournament_key: this.tournament_key,
			court_id: this.court_id,
			match_id,
		}));
	}

	score(score) {
		this.ws.send(JSON.stringify({
			type: 'score_update',
			tournament_key: this.tournament_key,
			score,
		}));
	}

	close() {
		if (this.ws) this.ws.close();
	}
}

function match_finished(match) {
	return match?.setup?.state === 'finished'
		|| typeof match?.team1_won === 'boolean'
		|| match?.btp_winner != null
		|| match?.no_match_losing_team != null
		|| (match?.score_status && match.score_status !== 'normal');
}

function active_assignments(tournament) {
	const match_by_id = new Map((tournament.matches || []).map((match) => [match._id, match]));
	return (tournament.courts || [])
		.filter((court) => court.is_active !== false)
		.sort((a, b) => Number(a.num || 0) - Number(b.num || 0))
		.map((court) => ({ court, match: match_by_id.get(court.match_id) }))
		.filter((entry) => entry.match?.setup?.now_on_court === true && !match_finished(entry.match));
}

function preparation_matches(tournament) {
	return (tournament.matches || [])
		.filter((match) => match?.setup?.state === 'preparation' && !match_finished(match))
		.sort((a, b) => Number(a.setup?.match_num || 0) - Number(b.setup?.match_num || 0));
}

function find_invariants(tournament) {
	const problems = [];
	const on_court_by_match = new Map();
	const courts_by_match = new Map();
	for (const court of tournament.courts || []) {
		if (!court.match_id) continue;
		if (!courts_by_match.has(court.match_id)) courts_by_match.set(court.match_id, []);
		courts_by_match.get(court.match_id).push(court._id);
	}
	for (const match of tournament.matches || []) {
		if (!match?.setup?.now_on_court || match_finished(match)) continue;
		const id = match._id;
		const court_id = match.setup.court_id || '';
		if (!on_court_by_match.has(id)) on_court_by_match.set(id, []);
		on_court_by_match.get(id).push(court_id);
		const courts = courts_by_match.get(id) || [];
		if (courts.length !== 1 || courts[0] !== court_id) {
			problems.push({
				type: 'court-reference-mismatch',
				match_id: id,
				match_num: match.setup.match_num,
				match_court_id: court_id,
				court_refs: courts,
			});
		}
	}
	for (const [match_id, court_ids] of on_court_by_match.entries()) {
		const unique = Array.from(new Set(court_ids.filter(Boolean)));
		if (unique.length > 1) {
			problems.push({ type: 'match-on-multiple-courts', match_id, court_ids: unique });
		}
	}
	const active_court_ids = new Set((tournament.courts || []).filter((court) => court.is_active !== false).map((court) => court._id));
	for (const court of tournament.courts || []) {
		if (!active_court_ids.has(court._id)) continue;
		const matches = (tournament.matches || []).filter((match) => (
			match?.setup?.now_on_court === true
			&& !match_finished(match)
			&& match?.setup?.court_id === court._id
		));
		if (matches.length > 1) {
			problems.push({
				type: 'court-has-multiple-current-matches',
				court_id: court._id,
				match_ids: matches.map((match) => match._id),
				match_nums: matches.map((match) => match.setup.match_num),
			});
		}
	}
	return problems;
}

function all_player_ids(match) {
	const ids = [];
	for (const team of match?.setup?.teams || []) {
		for (const player of team.players || []) {
			if (player.btp_id != null) ids.push(player.btp_id);
		}
	}
	return Array.from(new Set(ids));
}

async function check_in_matches(admin, matches) {
	let count = 0;
	for (const match of matches) {
		for (const player_id of all_player_ids(match)) {
			await admin.send('match_player_check_in', {
				match_id: match._id,
				player_id,
				checked_in: true,
			}, 30000);
			count++;
		}
	}
	return count;
}

function build_finish_score(match, court, wave_index, slot_index) {
	const seed = String(match._id || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + wave_index + slot_index;
	const loser1 = 8 + (seed % 10);
	const loser2 = 7 + ((seed * 7) % 10);
	return {
		match_id: match._id,
		court_id: court._id,
		network_score: [[21, loser1], [21, loser2]],
		network_team1_left: true,
		network_team1_serving: false,
		network_teams_player1_even: [true, true],
		presses: [],
		duration_ms: 8 * 60 * 1000,
		end_ts: Date.now(),
		finish_confirmed: true,
		team1_won: true,
		device: {
			battery: 100,
			auto_tournament_simulation_probe: true,
		},
	};
}

function build_score_payload(match, court, network_score, options = {}) {
	const score = {
		match_id: match._id,
		court_id: court._id,
		network_score,
		network_team1_left: true,
		network_team1_serving: !!options.team1_serving,
		network_teams_player1_even: [
			[(network_score.at(-1)?.[0] || 0) % 2 === 0, true],
			[(network_score.at(-1)?.[1] || 0) % 2 === 0, true],
		],
		presses: [],
		duration_ms: options.duration_ms || 0,
		device: {
			battery: 100,
			auto_tournament_simulation_probe: true,
			client_id: options.client_id,
		},
	};
	if (options.finish_confirmed) {
		score.end_ts = Date.now();
		score.finish_confirmed = true;
		score.team1_won = true;
	}
	return score;
}

function build_point_sequence(match, court, wave_index, slot_index) {
	const seed = String(match._id || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + wave_index * 17 + slot_index * 29;
	const set_targets = [
		[21, 10 + (seed % 7)],
		[21, 9 + ((seed * 5) % 8)],
	];
	const sequence = [];
	const finished_sets = [];
	let duration_ms = 0;
	for (let set_index = 0; set_index < set_targets.length; set_index++) {
		const target = set_targets[set_index];
		const score = [0, 0];
		while (score[0] < target[0] || score[1] < target[1]) {
			const remaining1 = target[0] - score[0];
			const remaining2 = target[1] - score[1];
			let side;
			if (remaining1 <= 0) {
				side = 1;
			} else if (remaining2 <= 0) {
				side = 0;
			} else {
				side = ((score[0] * 3 + score[1] * 5 + seed + set_index) % 4) === 0 ? 1 : 0;
			}
			score[side] += 1;
			duration_ms += 18000 + ((seed + duration_ms + score[0] + score[1]) % 9000);
			const network_score = finished_sets.concat([[score[0], score[1]]]);
			sequence.push(build_score_payload(match, court, network_score, {
				duration_ms,
				team1_serving: side === 0,
				finish_confirmed: set_index === set_targets.length - 1 && score[0] === target[0] && score[1] === target[1],
			}));
		}
		finished_sets.push([score[0], score[1]]);
	}
	return sequence;
}

function interleave_point_sequences(entries, wave_index) {
	const queues = entries.map((entry, slot_index) => ({
		entry,
		queue: build_point_sequence(entry.match, entry.court, wave_index, slot_index),
	}));
	const updates = [];
	let round = 0;
	while (queues.some((item) => item.queue.length > 0)) {
		for (let i = 0; i < queues.length; i++) {
			const index = (i + round) % queues.length;
			const item = queues[index];
			if (item.queue.length > 0) {
				updates.push({
					entry: item.entry,
					score: item.queue.shift(),
				});
			}
		}
		round++;
	}
	return updates;
}

async function wait_for_assignments(admin, expected_min, timeout_ms) {
	const deadline = Date.now() + timeout_ms;
	let last = null;
	while (Date.now() < deadline) {
		last = await admin.tournament();
		const problems = find_invariants(last);
		if (problems.length > 0) {
			const err = new Error('Invariant violation while waiting for auto-call');
			err.problems = problems;
			err.tournament = last;
			throw err;
		}
		const assignments = active_assignments(last);
		if (assignments.length >= expected_min) return { tournament: last, assignments };
		await sleep(250);
	}
	return { tournament: last, assignments: last ? active_assignments(last) : [] };
}

async function wait_for_finished_matches(admin, match_ids, timeout_ms) {
	const expected = new Set(match_ids);
	const deadline = Date.now() + timeout_ms;
	let last = null;
	let finished_ok = 0;
	while (Date.now() < deadline) {
		last = await admin.tournament();
		finished_ok = (last.matches || [])
			.filter((match) => expected.has(match._id) && match_finished(match))
			.length;
		if (finished_ok >= expected.size) {
			return { tournament: last, finished_ok };
		}
		await sleep(500);
	}
	return { tournament: last || await admin.tournament(), finished_ok };
}

async function wait_for_score_queue_capacity(admin, options, monitor) {
	if (!options.adaptive_score_delay) {
		return;
	}
	let stats = await admin.queue_stats();
	monitor.samples++;
	monitor.max_queue_length = Math.max(monitor.max_queue_length, Number(stats.queue_length || 0));
	monitor.max_wait_ms = Math.max(monitor.max_wait_ms, Number(stats.recent_max_wait_ms || 0));
	monitor.max_runtime_ms = Math.max(monitor.max_runtime_ms, Number(stats.recent_max_runtime_ms || 0));
	while (Number(stats.queue_length || 0) > options.score_queue_target) {
		monitor.throttle_events++;
		if (monitor.throttle_events <= 5 || monitor.throttle_events % 10 === 0) {
			console.log('auto-probe:score-throttle', JSON.stringify({
				queue_length: stats.queue_length,
				current_task: stats.current_task,
				current_task_runtime_ms: stats.current_task_runtime_ms,
				recent_max_wait_ms: stats.recent_max_wait_ms,
				recent_max_runtime_ms: stats.recent_max_runtime_ms,
			}));
		}
		await sleep(options.score_queue_poll_ms);
		stats = await admin.queue_stats();
		monitor.samples++;
		monitor.max_queue_length = Math.max(monitor.max_queue_length, Number(stats.queue_length || 0));
		monitor.max_wait_ms = Math.max(monitor.max_wait_ms, Number(stats.recent_max_wait_ms || 0));
		monitor.max_runtime_ms = Math.max(monitor.max_runtime_ms, Number(stats.recent_max_runtime_ms || 0));
	}
}

function state_counts(tournament) {
	const counts = {};
	for (const match of tournament.matches || []) {
		const state = match?.setup?.state || 'unknown';
		counts[state] = (counts[state] || 0) + 1;
	}
	return counts;
}

async function run(options) {
	const admin = new AdminWsClient(options.base_url, options.tournament_key);
	const bup_clients = new Map();
	const summary = {
		waves: [],
		finished: 0,
	};
	try {
		await admin.connect();
		await admin.set_props({
			btp_enabled: true,
			btp_readonly: !options.write_btp,
			btp_autofetch_enabled: true,
			...(options.autofetch_interval_s > 0 ? { btp_autofetch_timeout_intervall: options.autofetch_interval_s } : {}),
			call_preparation_matches_automatically_enabled: true,
			call_next_possible_scheduled_match_in_preparation: true,
			preparation_call_debug_output_enabled: true,
			preparation_call_debug_icons_enabled: true,
			bts_client_performance_debug_enabled: true,
			bts_auto_call_trace_enabled: !!options.trace_auto_call,
		});

		let tournament = await admin.tournament();
		const location_id = options.location_id || (tournament.locations || [])[0]?._id;
		if (!location_id) throw new Error('No location available');
		console.log('auto-probe:ready', JSON.stringify({
			tournament: options.tournament_key,
			location_id,
			matches: (tournament.matches || []).length,
			courts: (tournament.courts || []).length,
			state_counts: state_counts(tournament),
		}));

		for (let wave = 1; wave <= options.max_waves && (!options.max_matches || summary.finished < options.max_matches); wave++) {
			const before_fetch_ms = Date.now();
			await admin.send('btp_fetch', {}, 60000).catch((err) => {
				console.log('auto-probe:btp-fetch-error', JSON.stringify({ wave, error: err.message }));
			});
			await sleep(options.wait_after_fetch_ms);
			tournament = await admin.tournament();
			let problems = find_invariants(tournament);
			if (problems.length) throw Object.assign(new Error('Invariant violation after BTP fetch'), { problems });

			const selection = await admin.send('preparation_selection_get', {}, 30000);
			const selected = (selection.selections || [])
				.find((entry) => entry.location_id === location_id)
				|| (selection.selections || [])[0]
				|| {};
			if ((selected.selected_match_ids || []).length > 0) {
				await admin.send('preparation_selection_execute', { location_id }, 30000);
				await sleep(300);
			}

			tournament = await admin.tournament();
			const prep = preparation_matches(tournament);
			const remaining = options.max_matches ? Math.max(0, options.max_matches - summary.finished) : prep.length;
			const checkin = prep.slice(0, remaining || prep.length);
			const checked_players = await check_in_matches(admin, checkin);

			const expected = Math.min(
				remaining || 13,
				(tournament.courts || []).filter((court) => court.is_active !== false).length,
				checkin.length || 13
			);
			const waited = await wait_for_assignments(admin, Math.max(1, expected), options.wait_for_auto_call_ms);
			tournament = waited.tournament;
			let assignments = waited.assignments;
			if (options.max_matches) {
				assignments = assignments.slice(0, Math.max(0, options.max_matches - summary.finished));
			}
			console.log('auto-probe:wave:called', JSON.stringify({
				wave,
				btp_fetch_wall_ms: Date.now() - before_fetch_ms,
				selection: {
					required: selected.required_preparation_count,
					current: selected.current_preparation_count,
					missing: selected.missing_preparation_count,
					selected_match_nums: selected.selected_match_nums,
				},
				prepared: prep.map((match) => match.setup.match_num),
				checked_players,
				assignments: assignments.map((entry) => ({
					court: entry.court.num || entry.court.name || entry.court._id,
					court_id: entry.court._id,
					match_id: entry.match._id,
					match_num: entry.match.setup.match_num,
					event: entry.match.setup.event_name,
				})),
			}));

			for (const entry of assignments) {
				if (!bup_clients.has(entry.court._id)) {
					const client = new BupV2Client(options.base_url, options.tournament_key, entry.court._id);
					await client.connect();
					bup_clients.set(entry.court._id, client);
				}
			}
			for (const entry of assignments) {
				bup_clients.get(entry.court._id).open_match(entry.match._id);
			}
			if (options.point_by_point) {
				const updates = interleave_point_sequences(assignments, wave);
				const score_monitor = {
					samples: 0,
					throttle_events: 0,
					max_queue_length: 0,
					max_wait_ms: 0,
					max_runtime_ms: 0,
				};
				console.log('auto-probe:wave:point-updates', JSON.stringify({
					wave,
					assignments: assignments.length,
					updates: updates.length,
					delay_ms: options.score_delay_ms,
					adaptive_score_delay: options.adaptive_score_delay,
					score_queue_target: options.score_queue_target,
				}));
				for (const update of updates) {
					await wait_for_score_queue_capacity(admin, options, score_monitor);
					const client = bup_clients.get(update.entry.court._id);
					client.score(update.score);
					if (options.score_delay_ms > 0) {
						await sleep(options.score_delay_ms);
					}
				}
				console.log('auto-probe:wave:score-monitor', JSON.stringify(score_monitor));
			} else {
				for (let i = 0; i < assignments.length; i++) {
					const entry = assignments[i];
					const client = bup_clients.get(entry.court._id);
					await sleep(options.score_delay_ms);
					client.score(build_finish_score(entry.match, entry.court, wave, i));
				}
			}

			const finished_ids = new Set(assignments.map((entry) => entry.match._id));
			const finished_wait = await wait_for_finished_matches(
				admin,
				Array.from(finished_ids),
				options.wait_for_finish_ms
			);
			tournament = finished_wait.tournament;
			problems = find_invariants(tournament);
			if (problems.length) throw Object.assign(new Error('Invariant violation after score wave'), { problems });
			const finished_ok = finished_wait.finished_ok;
			const wave_summary = {
				wave,
				scored: assignments.length,
				finished_ok,
				finish_wait_ms: options.wait_for_finish_ms,
				admin_errors: admin.errors.splice(0),
				bup_errors: Array.from(bup_clients.values()).flatMap((client) => client.errors.splice(0)),
				state_counts: state_counts(tournament),
			};
			summary.finished += finished_ok;
			summary.waves.push(wave_summary);
			console.log('auto-probe:wave:done', JSON.stringify(wave_summary));
			if (assignments.length === 0 || finished_ok === 0) break;
		}
		console.log('auto-probe:summary', JSON.stringify(summary));
	} catch (err) {
		console.error('auto-probe:error', err.stack || err.message || String(err));
		if (err.problems) console.error('auto-probe:problems', JSON.stringify(err.problems, null, 2));
		process.exitCode = 1;
	} finally {
		for (const client of bup_clients.values()) client.close();
		admin.close();
	}
}

run(parse_args(process.argv.slice(2)));
