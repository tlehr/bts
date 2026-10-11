'use strict';

const http = require('http');
const WebSocket = require('ws');

function parse_args(argv) {
	const options = {
		base_url: 'https://localhost:4433',
		cdp_url: 'http://127.0.0.1:9222',
		tournament_key: 'default',
		max_matches: 0,
		max_waves: 0,
		sync_after_wave: true,
		sync_wait_ms: 2500,
		court_limit: 0,
		scheduled_only: true,
		admin_path: '/admin/t/default/',
		call_timeout_ms: 10000,
		score_timeout_ms: 15000,
		dry_run: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => argv[++i];
		if (arg === '--base-url') options.base_url = next();
		else if (arg === '--cdp-url') options.cdp_url = next();
		else if (arg === '--tournament') options.tournament_key = next();
		else if (arg === '--max-matches') options.max_matches = Number(next()) || 0;
		else if (arg === '--max-waves') options.max_waves = Number(next()) || 0;
		else if (arg === '--sync-wait-ms') options.sync_wait_ms = Number(next()) || 0;
		else if (arg === '--court-limit') options.court_limit = Number(next()) || 0;
		else if (arg === '--all-matches') options.scheduled_only = false;
		else if (arg === '--no-sync') options.sync_after_wave = false;
		else if (arg === '--dry-run') options.dry_run = true;
		else if (arg === '--help' || arg === '-h') {
			print_help();
			process.exit(0);
		} else {
			throw new Error('Unknown argument ' + arg);
		}
	}
	options.admin_path = '/admin/t/' + encodeURIComponent(options.tournament_key) + '/';
	return options;
}

function print_help() {
	console.log([
		'Usage: node debug/tournament_simulation_probe.js [options]',
		'',
		'Options:',
		'  --base-url https://localhost:4433   BTS base URL',
		'  --cdp-url http://127.0.0.1:9222    Chrome DevTools URL',
		'  --tournament default               tournament key',
		'  --max-matches N                    stop after N finished matches (0 = no limit)',
		'  --max-waves N                      stop after N waves (0 = no limit)',
		'  --court-limit N                    use at most N active courts (0 = all)',
		'  --sync-wait-ms N                   wait after BTP fetch per wave',
		'  --all-matches                      also play unscheduled matches',
		'  --no-sync                          do not trigger BTP fetch after waves',
		'  --dry-run                          print selected matches without mutating server',
	].join('\n'));
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(values, p) {
	if (values.length === 0) return null;
	const sorted = values.slice().sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function round_ms(value) {
	return Math.round(value * 10) / 10;
}

function ws_url(base_url, path) {
	const url = new URL(base_url);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = path;
	url.search = '';
	url.hash = '';
	return url.toString();
}

function http_json(method, raw_url) {
	const url = new URL(raw_url);
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: url.hostname,
			port: url.port || 80,
			path: url.pathname + url.search,
			method,
		}, res => {
			let data = '';
			res.on('data', chunk => { data += chunk; });
			res.on('end', () => {
				try {
					resolve(JSON.parse(data));
				} catch (err) {
					reject(new Error('Bad JSON from CDP: ' + data.slice(0, 200)));
				}
			});
		});
		req.on('error', reject);
		req.end();
	});
}

class CdpClient {
	constructor(cdp_url) {
		this.cdp_url = cdp_url.replace(/\/$/, '');
		this.ws = null;
		this.next_id = 1;
		this.pending = new Map();
		this.events = [];
	}

	async connect(page_url) {
		let target;
		try {
			target = await http_json('PUT', this.cdp_url + '/json/new?' + encodeURIComponent(page_url));
		} catch (err) {
			const targets = await http_json('GET', this.cdp_url + '/json');
			target = targets.find(entry => entry.type === 'page') || targets[0];
			if (!target) throw new Error('No Chrome page target available');
		}
		this.ws = new WebSocket(target.webSocketDebuggerUrl);
		this.ws.on('message', raw => this._on_message(raw));
		await new Promise((resolve, reject) => {
			this.ws.on('open', resolve);
			this.ws.on('error', reject);
		});
		await this.send('Runtime.enable');
		await this.send('Page.enable');
		await this.send('Page.navigate', { url: page_url });
		await this.wait_for_load(15000);
	}

	_on_message(raw) {
		const msg = JSON.parse(raw);
		if (msg.id && this.pending.has(msg.id)) {
			const pending = this.pending.get(msg.id);
			this.pending.delete(msg.id);
			if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
			else pending.resolve(msg.result || {});
			return;
		}
		if (msg.method) this.events.push(msg);
	}

	send(method, params = {}) {
		const id = this.next_id++;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
	}

	async wait_for_load(timeout_ms) {
		const deadline = Date.now() + timeout_ms;
		while (Date.now() < deadline) {
			if (this.events.some(event => event.method === 'Page.loadEventFired')) return;
			await sleep(50);
		}
	}

	async eval(expression) {
		const result = await this.send('Runtime.evaluate', {
			awaitPromise: true,
			returnByValue: true,
			expression,
		});
		if (result.exceptionDetails) {
			throw new Error('CDP evaluation failed: ' + JSON.stringify(result.exceptionDetails));
		}
		return result.result && result.result.value;
	}

	close() {
		if (this.ws) this.ws.close();
	}
}

class AdminWsClient {
	constructor(base_url, tournament_key) {
		this.url = ws_url(base_url, '/ws/admin');
		this.tournament_key = tournament_key;
		this.ws = null;
		this.next_rid = 1;
		this.pending = new Map();
	}

	async connect() {
		this.ws = new WebSocket(this.url, 'bts-admin', { rejectUnauthorized: false });
		this.ws.on('message', raw => this._on_message(raw));
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
			if (msg.type === 'error') pending.reject(new Error(msg.message || 'Admin WebSocket error'));
			else pending.resolve(msg);
		}
	}

	send(type, payload = {}, timeout_ms = 10000) {
		const rid = this.next_rid++;
		const msg = Object.assign({}, payload, {
			type,
			rid,
			tournament_key: payload.tournament_key || this.tournament_key,
		});
		this.ws.send(JSON.stringify(msg));
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(rid);
				reject(new Error('Timeout waiting for admin answer to ' + type));
			}, timeout_ms);
			this.pending.set(rid, {
				resolve: value => {
					clearTimeout(timeout);
					resolve(value);
				},
				reject: err => {
					clearTimeout(timeout);
					reject(err);
				},
			});
		});
	}

	close() {
		if (this.ws) this.ws.close();
	}
}

class BupV2Client {
	constructor(base_url, tournament_key) {
		this.url = ws_url(base_url, '/ws/bup_v2');
		this.tournament_key = tournament_key;
		this.ws = null;
	}

	async connect() {
		this.ws = new WebSocket(this.url, { rejectUnauthorized: false });
		await new Promise((resolve, reject) => {
			this.ws.on('open', resolve);
			this.ws.on('error', reject);
		});
	}

	async select_court(court_id) {
		this.ws.send(JSON.stringify({
			type: 'select_court_assignment',
			tournament_key: this.tournament_key,
			court_id,
		}));
		await sleep(120);
	}

	send_score(score) {
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

class BrowserProbe {
	constructor(cdp) {
		this.cdp = cdp;
	}

	async install() {
		await this.cdp.eval(`
(async () => {
	window.__btsProbeLogs = [];
	window.__btsProbeInstalled = true;
	if (!window.__btsOriginalConsoleLog) {
		window.__btsOriginalConsoleLog = console.log.bind(console);
		console.log = (...args) => {
			try {
				window.__btsProbeLogs.push({ ts: performance.now(), args });
			} catch (err) {}
			window.__btsOriginalConsoleLog(...args);
		};
	}
	if (window.curt) window.curt.bts_client_performance_debug_enabled = true;
	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
	for (let i = 0; i < 100 && (!window.curt || !Array.isArray(curt.matches) || !Array.isArray(curt.courts)); i++) {
		await sleep(100);
	}
	return {
		matches: window.curt && curt.matches ? curt.matches.length : 0,
		courts: window.curt && curt.courts ? curt.courts.length : 0,
	};
})()
`);
	}

	async snapshot() {
		return this.cdp.eval(`
(() => {
	const slimPlayer = player => player ? ({
		btp_id: player.btp_id,
		name: player.name,
		checked_in: player.checked_in,
	}) : null;
	const slimTeam = team => ({
		name: team && team.name,
		players: ((team && team.players) || []).map(slimPlayer),
	});
	return {
		now: Date.now(),
		matches: (curt.matches || []).map(match => ({
			_id: match._id,
			btp_id: match.btp_id,
			score_status: match.score_status,
			team1_won: match.team1_won,
			btp_winner: match.btp_winner,
			no_match_losing_team: match.no_match_losing_team,
			network_score: match.network_score,
			network_team1_left: match.network_team1_left,
			network_team1_serving: match.network_team1_serving,
			network_teams_player1_even: match.network_teams_player1_even,
			presses: match.presses,
			duration_ms: match.duration_ms,
			shuttle_count: match.shuttle_count,
			setup: {
				is_match: match.setup && match.setup.is_match,
				incomplete: match.setup && match.setup.incomplete,
				is_doubles: match.setup && match.setup.is_doubles,
				match_num: match.setup && match.setup.match_num,
				event_name: match.setup && match.setup.event_name,
				match_name: match.setup && match.setup.match_name,
				state: match.setup && match.setup.state,
				court_id: match.setup && match.setup.court_id,
				now_on_court: match.setup && match.setup.now_on_court,
				scheduled_time_str: match.setup && match.setup.scheduled_time_str,
				scheduled_date: match.setup && match.setup.scheduled_date,
				scoring_format: match.setup && match.setup.scoring_format,
				teams: ((match.setup && match.setup.teams) || []).map(slimTeam),
			},
		})),
		courts: (curt.courts || []).map(court => ({
			_id: court._id,
			num: court.num,
			name: court.name,
			is_active: court.is_active,
			match_id: court.match_id,
		})),
	};
})()
`);
	}

	async log_count() {
		return this.cdp.eval('window.__btsProbeLogs ? window.__btsProbeLogs.length : 0');
	}

	async wait_for_scores(match_ids, start_log_count, timeout_ms) {
		const ids_json = JSON.stringify(match_ids);
		return this.cdp.eval(`
(async () => {
	const ids = new Set(${ids_json});
	const startLogCount = ${Number(start_log_count) || 0};
	const deadline = performance.now() + ${Number(timeout_ms) || 15000};
	const seen = {};
	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
	while (performance.now() < deadline) {
		const logs = (window.__btsProbeLogs || []).slice(startLogCount);
		for (const entry of logs) {
			const args = entry.args || [];
			if (args[0] === '[bts admin] score change received' && args[1] && ids.has(args[1].match_id)) {
				if (!seen[args[1].match_id]) seen[args[1].match_id] = entry.ts;
			}
		}
		if (Object.keys(seen).length >= ids.size) break;
		await sleep(20);
	}
	const logs = (window.__btsProbeLogs || []).slice(startLogCount).filter(entry => {
		const label = entry.args && entry.args[0];
		return typeof label === 'string' && label.indexOf('[bts admin]') === 0;
	}).map(entry => ({
		ts: entry.ts,
		label: entry.args[0],
		data: entry.args[1],
	}));
	return { seen, logs };
})()
`);
	}
}

function match_is_finished(match) {
	const setup = match && match.setup || {};
	return setup.state === 'finished' ||
		typeof match.team1_won === 'boolean' ||
		match.btp_winner != null ||
		match.no_match_losing_team != null ||
		(match.score_status && match.score_status !== 'normal');
}

function match_is_playable(match, options) {
	const setup = match && match.setup || {};
	if (!setup.is_match || setup.incomplete) return false;
	if (setup.now_on_court) return false;
	if (match_is_finished(match)) return false;
	if (options.scheduled_only && (!setup.scheduled_date || !setup.scheduled_time_str)) return false;
	const teams = setup.teams || [];
	if (teams.length < 2) return false;
	if (!teams[0].players || !teams[0].players.length) return false;
	if (!teams[1].players || !teams[1].players.length) return false;
	return true;
}

function sorted_playable_matches(snapshot, options) {
	return snapshot.matches
		.filter(match => match_is_playable(match, options))
		.sort((a, b) => {
			const date_cmp = String(a.setup.scheduled_date || '').localeCompare(String(b.setup.scheduled_date || ''));
			if (date_cmp !== 0) return date_cmp;
			const time_cmp = String(a.setup.scheduled_time_str || '').localeCompare(String(b.setup.scheduled_time_str || ''));
			if (time_cmp !== 0) return time_cmp;
			return Number(a.setup.match_num || 0) - Number(b.setup.match_num || 0);
		});
}

function free_active_courts(snapshot, options) {
	const match_by_id = new Map(snapshot.matches.map(match => [match._id, match]));
	const courts = snapshot.courts
		.filter(court => court.is_active !== false)
		.filter(court => {
			if (!court.match_id) return true;
			const match = match_by_id.get(court.match_id);
			return !match || !match.setup || !match.setup.now_on_court || match_is_finished(match);
		})
		.sort((a, b) => Number(a.num || 0) - Number(b.num || 0));
	return options.court_limit > 0 ? courts.slice(0, options.court_limit) : courts;
}

function active_on_court_assignments(snapshot, options) {
	const match_by_id = new Map(snapshot.matches.map(match => [match._id, match]));
	const courts = snapshot.courts
		.filter(court => court.is_active !== false)
		.sort((a, b) => Number(a.num || 0) - Number(b.num || 0));
	const limited_courts = options.court_limit > 0 ? courts.slice(0, options.court_limit) : courts;
	return limited_courts
		.map(court => ({ court, match: match_by_id.get(court.match_id) }))
		.filter(item => item.match && item.match.setup && item.match.setup.now_on_court && !match_is_finished(item.match))
		.map(item => ({ ...item, needs_call: false }));
}

function deterministic_margin(match, wave_index, slot_index) {
	const raw = String(match._id || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
	return 7 + ((raw + wave_index + slot_index) % 9);
}

function build_finish_score(match, court, wave_index, slot_index) {
	const margin = deterministic_margin(match, wave_index, slot_index);
	const loser_points_1 = Math.max(4, 21 - margin);
	const loser_points_2 = Math.max(3, 19 - margin);
	const start = Date.now() - 600000;
	const presses = [
		{ type: 'pick_side', team1_left: true, court_id: court._id, timestamp: start },
		{ type: 'pick_server', team_id: 0, player_id: 0, timestamp: start + 1000 },
		{ type: 'pick_receiver', team_id: 1, player_id: match.setup.is_doubles ? 1 : 0, timestamp: start + 2000 },
		{ type: 'love-all', timestamp: start + 3000 },
	];
	for (let i = 0; i < 21; i++) {
		presses.push({ type: 'score', side: 'left', timestamp: start + 4000 + i * 1000 });
		if (i < loser_points_1) {
			presses.push({ type: 'score', side: 'right', timestamp: start + 4500 + i * 1000 });
		}
	}
	presses.push({ type: 'postgame-confirm', timestamp: start + 30000 });
	presses.push({ type: 'pick_server', team_id: 0, player_id: 0, timestamp: start + 31000 });
	presses.push({ type: 'pick_receiver', team_id: 1, player_id: match.setup.is_doubles ? 1 : 0, timestamp: start + 32000 });
	presses.push({ type: 'love-all', timestamp: start + 33000 });
	for (let i = 0; i < 21; i++) {
		presses.push({ type: 'score', side: 'left', timestamp: start + 34000 + i * 1000 });
		if (i < loser_points_2) {
			presses.push({ type: 'score', side: 'right', timestamp: start + 34500 + i * 1000 });
		}
	}
	presses.push({ type: 'postgame-confirm', timestamp: Date.now() - 1000 });
	presses.push({ type: 'postmatch-confirm', timestamp: Date.now() });
	return {
		match_id: match._id,
		court_id: court._id,
		network_score: [[21, loser_points_1], [21, loser_points_2]],
		network_team1_left: true,
		network_team1_serving: false,
		network_teams_player1_even: [true, true],
		presses,
		duration_ms: 600000,
		end_ts: Date.now(),
		finish_confirmed: true,
		team1_won: true,
		shuttle_count: match.shuttle_count || 0,
		device: {
			battery: 100,
			tournament_simulation_probe: true,
		},
	};
}

function summarize_logs(logs, start_ts) {
	const batches = [];
	const slow_handlers = [];
	for (const log of logs || []) {
		if (log.label === '[bts admin] change queue batch') {
			batches.push(log.data);
		} else if (log.label === '[bts admin] slow change handler') {
			slow_handlers.push(log.data);
		}
	}
	return {
		score_events: (logs || []).filter(log => log.label === '[bts admin] score change received').length,
		batches: batches.length,
		max_batch_ms: batches.length ? Math.max(...batches.map(batch => Number(batch.duration_ms) || 0)) : 0,
		max_remaining: batches.length ? Math.max(...batches.map(batch => Number(batch.remaining) || 0)) : 0,
		slow_handlers: slow_handlers.length,
		slow_handler_types: slow_handlers.reduce((acc, item) => {
			const key = item.ctype || 'unknown';
			acc[key] = (acc[key] || 0) + 1;
			return acc;
		}, {}),
		first_log_ms: logs && logs.length ? round_ms(logs[0].ts - start_ts) : null,
		last_log_ms: logs && logs.length ? round_ms(logs[logs.length - 1].ts - start_ts) : null,
	};
}

async function run(options) {
	const page_url = options.base_url.replace(/\/$/, '') + options.admin_path;
	const cdp = new CdpClient(options.cdp_url);
	const admin = new AdminWsClient(options.base_url, options.tournament_key);
	const bup = new BupV2Client(options.base_url, options.tournament_key);
	const probe = new BrowserProbe(cdp);
	const waves = [];
	let finished_total = 0;
	try {
		await cdp.connect(page_url);
		await probe.install();
		await admin.connect();
		await bup.connect();
		console.log('probe:connected', JSON.stringify({ page_url, tournament_key: options.tournament_key }));
		for (let wave_index = 1; ; wave_index++) {
			if (options.max_waves > 0 && wave_index > options.max_waves) break;
			const snapshot = await probe.snapshot();
			const running_assignments = active_on_court_assignments(snapshot, options);
			const running_match_ids = new Set(running_assignments.map(item => item.match._id));
			const courts = free_active_courts(snapshot, options);
			const playable = sorted_playable_matches(snapshot, options);
			const remaining_limit = options.max_matches > 0 ? options.max_matches - finished_total : Infinity;
			const call_slots = Math.min(
				courts.length,
				playable.filter(match => !running_match_ids.has(match._id)).length,
				Math.max(0, remaining_limit - running_assignments.length)
			);
			const slots = Math.min(running_assignments.length + call_slots, remaining_limit);
			if (slots <= 0) {
				console.log('probe:stop', JSON.stringify({
					reason: playable.length === 0 ? 'no_playable_matches' : 'no_free_courts_or_limit',
					playable: playable.length,
					running: running_assignments.length,
					free_courts: courts.length,
					finished_total,
				}));
				break;
			}
			const assignments = running_assignments.slice(0, slots);
			const callable_matches = playable.filter(match => !running_match_ids.has(match._id));
			for (let i = 0; i < call_slots && assignments.length < slots; i++) {
				assignments.push({ court: courts[i], match: callable_matches[i], needs_call: true });
			}
			console.log('probe:wave:start', JSON.stringify({
				wave: wave_index,
				assignments: assignments.map(item => ({
					court: item.court.name || item.court._id,
					match_id: item.match._id,
					match_num: item.match.setup.match_num,
					event: item.match.setup.event_name,
					name: item.match.setup.match_name,
					already_on_court: item.needs_call === false,
				})),
			}));
			if (options.dry_run) {
				waves.push({ wave: wave_index, dry_run: true, count: assignments.length });
				finished_total += assignments.length;
				continue;
			}
			const wave_start = Date.now();
			for (const item of assignments.filter(entry => entry.needs_call !== false)) {
				await admin.send('match_call_on_court', {
					court_id: item.court._id,
					match_id: item.match._id,
				}, options.call_timeout_ms);
			}
			await sleep(250);
			const log_count = await probe.log_count();
			const perf_start = await cdp.eval('performance.now()');
			for (let i = 0; i < assignments.length; i++) {
				await bup.select_court(assignments[i].court._id);
				bup.send_score(build_finish_score(assignments[i].match, assignments[i].court, wave_index, i));
			}
			const observed = await probe.wait_for_scores(
				assignments.map(item => item.match._id),
				log_count,
				options.score_timeout_ms
			);
			const seen_ids = Object.keys(observed.seen || {});
			const latencies = seen_ids.map(id => observed.seen[id] - perf_start);
			const wave_summary = {
				wave: wave_index,
				count: assignments.length,
				seen: seen_ids.length,
				missing: assignments.map(item => item.match._id).filter(id => !observed.seen[id]),
				score_latency_ms: {
					avg: latencies.length ? round_ms(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
					p50: round_ms(percentile(latencies, 0.50) || 0),
					p95: round_ms(percentile(latencies, 0.95) || 0),
					max: round_ms(latencies.length ? Math.max(...latencies) : 0),
				},
				client_logs: summarize_logs(observed.logs, perf_start),
				wall_ms: Date.now() - wave_start,
			};
			waves.push(wave_summary);
			finished_total += assignments.length;
			console.log('probe:wave:done', JSON.stringify(wave_summary));
			if (options.sync_after_wave) {
				const sync_start = Date.now();
				await admin.send('btp_fetch', {}, options.call_timeout_ms);
				await sleep(options.sync_wait_ms);
				console.log('probe:btp_fetch:waited', JSON.stringify({
					wave: wave_index,
					wait_ms: Date.now() - sync_start,
				}));
			}
			if (options.max_matches > 0 && finished_total >= options.max_matches) break;
		}
		const all_latencies = waves.flatMap(wave => {
			const score = wave.score_latency_ms || {};
			return Number.isFinite(score.max) && score.max > 0 ? [score.max] : [];
		});
		console.log('probe:summary', JSON.stringify({
			waves: waves.length,
			finished_total,
			worst_wave_score_latency_ms: all_latencies.length ? Math.max(...all_latencies) : null,
			worst_batch_ms: Math.max(0, ...waves.map(wave => wave.client_logs ? wave.client_logs.max_batch_ms : 0)),
			slow_handlers: waves.reduce((sum, wave) => sum + (wave.client_logs ? wave.client_logs.slow_handlers : 0), 0),
		}));
	} finally {
		admin.close();
		bup.close();
		cdp.close();
	}
}

run(parse_args(process.argv.slice(2))).catch(err => {
	console.error(err.stack || err);
	process.exit(1);
});
