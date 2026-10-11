'use strict';

const WebSocket = require('ws');
const calc = require('../static/bup/dev/js/calc');
const fs = require('fs');
const crypto = require('crypto');
const { LatencyStats, PayloadStats } = require('./live_drill_metrics');
const { PerformanceHistory, render_performance } = require('./live_drill_performance');
const {
	BENCHMARK_PHASES, BENCHMARK_RUNTIME_MS, benchmark_phase, random_source, CheckinPacer, sample_summary, latency_summary,
} = require('./live_drill_scenario');

const DEFAULT_BASE_URL = 'https://localhost:4433';
const DEFAULT_TOURNAMENT_KEY = 'default';
const DEFAULT_SLOW_LATENCY_MS = 500;
let next_trace_seq = 1;

class StopError extends Error {
	constructor(message = 'Live drill stopped') {
		super(message);
		this.code = 'LIVE_DRILL_STOPPED';
	}
}

function is_stop_error(err) {
	return err && err.code === 'LIVE_DRILL_STOPPED';
}

function is_admin_closed_error(err) {
	return err && /^(Admin WebSocket closed|Admin WebSocket is not open)/.test(err.message || '');
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function close_ws(ws) {
	if (!ws || ws.readyState === WebSocket.CLOSED) return;
	try {
		if (typeof ws.terminate === 'function') {
			ws.terminate();
		} else {
			ws.close();
		}
	} catch (_err) {
		// Shutdown path: there is nothing useful left to report here.
	}
}

function ws_url(base_url, path) {
	const url = new URL(base_url);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = path;
	url.search = '';
	url.hash = '';
	return url.toString();
}

function random_int(min, max, random = Math.random) {
	return min + Math.floor(random() * (max - min + 1));
}

function round_ms(value) {
	return Math.round(Number(value || 0) * 10) / 10;
}

function round_probability(value) {
	return Math.round(Number(value || 0) * 1000) / 1000;
}

function average(values) {
	if (!values.length) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function recent_count(entries, window_ms) {
	const cutoff = Date.now() - window_ms;
	return entries.filter((entry) => entry.ts >= cutoff).length;
}

function recent_rate_per_sec(entries, window_ms, started_at) {
	const denominator_ms = Math.max(1000, Math.min(window_ms, Date.now() - started_at));
	return recent_count(entries, window_ms) / (denominator_ms / 1000);
}

function truncate_text(value, width) {
	const text = String(value == null ? '' : value);
	if (width <= 0) return '';
	if (text.length <= width) return text.padEnd(width, ' ');
	if (width <= 1) return text.slice(0, width);
	return (text.slice(0, width - 1) + '~');
}

function pad_left(value, width) {
	return String(value == null ? '' : value).slice(0, width).padStart(width, ' ');
}

function format_age(ms) {
	if (!Number.isFinite(ms)) return '-';
	if (ms < 1000) return String(Math.max(0, Math.round(ms))) + 'ms';
	return round_ms(ms / 1000) + 's';
}

function score_payload_text(score) {
	if (!score) return '';
	const parts = [];
	for (const set_score of score.finished_sets || []) {
		parts.push(`${Number(set_score.left || 0)}:${Number(set_score.right || 0)}`);
	}
	if (score.current_set) {
		parts.push(`${Number(score.current_set.left || 0)}:${Number(score.current_set.right || 0)}`);
	}
	return parts.join(' ');
}

function network_score_text(network_score) {
	return (network_score || []).map((set_score) => set_score.join(':')).join(' ');
}

function ensure_score_trace_id(score) {
	if (!score) return null;
	if (!score.debug_trace_id) {
		score.debug_trace_id = 'live-drill-' + process.pid + '-' + Date.now().toString(36) + '-' + next_trace_seq++;
	}
	return score.debug_trace_id;
}

function normalize_match_id(match_id) {
	if (match_id == null) return '';
	return String(match_id).replace(/^bts_/, '');
}

function compact_player_name(name) {
	const text = String(name || '').trim();
	if (!text) return '';
	const slash_parts = text.split(/\s*\/\s*/).filter(Boolean);
	if (slash_parts.length > 1) {
		return slash_parts.map(compact_player_name).join(' / ');
	}
	const parts = text.split(/\s+/).filter(Boolean);
	if (parts.length <= 1) return text;
	const lastname = parts[parts.length - 1];
	const first = parts.slice(0, -1).join(' ');
	if (!first) return lastname;
	return first[0] + '. ' + lastname;
}

function player_detail_name(player) {
	if (!player) return '';
	if (player.name) return compact_player_name(player.name);
	const full_name = [player.firstname, player.lastname].filter(Boolean).join(' ');
	return compact_player_name(full_name);
}

function side_players_label(state, side) {
	const team = (state?.teams || []).find((entry) => entry.side === side);
	const details = (team?.player_details || []).map(player_detail_name).filter(Boolean);
	if (details.length > 0) return details.join(' / ');
	const players = (team?.players || []).map(compact_player_name).filter(Boolean);
	if (players.length > 0) return players.join(' / ');
	return team?.name || '';
}

class Dashboard {
	constructor(options) {
		this.enabled = !!options.dashboard;
		this.options = options;
		this.started_at = Date.now();
		this.courts = [];
		this.court_rows = new Map();
		this.pending_by_court = new Map();
		this.pending_admin_by_court = new Map();
		this.latencies = [];
		this.admin_latencies = [];
		this.tv_latency_stats = new LatencyStats();
		this.admin_latency_stats = new LatencyStats();
		this.tv_payload_stats = new PayloadStats();
		this.admin_payload_stats = new PayloadStats();
		this.score_updates = 0;
		this.score_sent_events = [];
		this.display_update_events = [];
		this.events = [];
		this.points = 0;
		this.checkins = 0;
		this.paused = false;
		this.render_timer = null;
		this.stopped = false;
		this.phase_stats = null;
		this.view = options.dashboard_view || 1;
		this.performance = new PerformanceHistory();
		this.expired = { tv: 0, admin: 0 };
		this.receipt_traces = new Map(); this.receipt_traces_dropped = 0;
		this.event_archive = []; this.events_dropped = 0;
	}

	start() {
		if (!this.enabled) return;
		process.stdout.write('\x1b[?25l');
		this.render_timer = setInterval(() => this.render(), 250);
		this.render();
	}

	stop() {
		if (!this.enabled || this.stopped) return;
		this.stopped = true;
		if (this.render_timer) clearInterval(this.render_timer);
		this.render();
		process.stdout.write('\x1b[?25h\n');
	}

	log(label, data = {}) {
		if (!this.enabled && !this.options.quiet) console.log(label, JSON.stringify(data));
		this.events.unshift({
			ts: Date.now(),
			label,
			data,
		});
		this.events = this.events.slice(0, this.options.quiet ? 50 : 8);
		this.event_archive.push(this.events[0]);
		if (this.event_archive.length > 10000) { this.event_archive.shift(); this.events_dropped++; }
	}

	update_tournament(tournament) {
		this.courts = (tournament?.courts || [])
			.filter((court) => court.is_active !== false)
			.slice()
			.sort((a, b) => Number(a.num || 0) - Number(b.num || 0));
		for (const court of this.courts) {
			if (!this.court_rows.has(court._id)) {
				this.court_rows.set(court._id, {
					court,
					tv_connected: false,
					state: null,
					last_payload_type: null,
					last_update_ts: null,
					last_latency_ms: null,
					last_admin_latency_ms: null,
					tablet_battery: null,
					tablet_charging: false,
					update_count: 0,
					error: null,
					drill_status: null,
				});
			}
			this.court_rows.get(court._id).court = court;
		}
	}

	set_tv_status(court_id, connected, error = null) {
		const row = this.ensure_row(court_id);
		row.tv_connected = connected;
		row.error = error;
	}

	ensure_row(court_id) {
		if (!this.court_rows.has(court_id)) {
			this.court_rows.set(court_id, {
				court: { _id: court_id, num: court_id },
				tv_connected: false,
				state: null,
				last_payload_type: null,
				last_update_ts: null,
				last_latency_ms: null,
				last_admin_latency_ms: null,
				tablet_battery: null,
				tablet_charging: false,
				update_count: 0,
				error: null,
				drill_status: null,
			});
		}
		return this.court_rows.get(court_id);
	}

	set_drill_status(court_id, status) {
		const row = this.ensure_row(court_id);
		row.drill_status = status || null;
	}

	set_tablet_battery(court_id, battery) {
		const row = this.ensure_row(court_id);
		if (battery && typeof battery === 'object') {
			if (Number.isFinite(Number(battery.level))) {
				row.tablet_battery = Math.round(Number(battery.level) * 100);
			}
			row.tablet_charging = battery.charging === true;
			return;
		}
		if (Number.isFinite(Number(battery))) {
			row.tablet_battery = Math.round(Number(battery));
			row.tablet_charging = false;
		}
	}

	record_score_sent(score) {
		if (!score?.court_id || !score?.match_id) return;
		const trace_id = ensure_score_trace_id(score);
		this.set_drill_status(score.court_id, null);
		this.set_tablet_battery(score.court_id, score.device?.battery);
		this.score_sent_events.push({ ts: Date.now(), court_id: score.court_id });
		this.prune_latencies();
		const pending = {
			ts: Date.now(),
			court_id: score.court_id,
			match_id: score.match_id,
			admin_score_text: network_score_text(score.network_score),
			press_signature: Array.isArray(score.presses) ? JSON.stringify([score.presses.length, score.presses.at(-1)]) : null,
			ended: !!score.finish_confirmed || !!score.end_ts,
			// TVs show left/right; network scores retain team 1/team 2 ordering.
			score_text: network_score_text((score.network_score || []).map((set_score) => (
				score.network_team1_left === false ? [set_score[1], set_score[0]] : set_score
			))),
			trace_id,
			phase_stats: this.phase_stats,
		};
		if (this.phase_stats) this.phase_stats.score_updates++;
		this.receipt_traces.set(trace_id, { trace_id, sent_ts: pending.ts, court_id: pending.court_id, match_id: pending.match_id });
		if (this.receipt_traces.size > 5000) { this.receipt_traces.delete(this.receipt_traces.keys().next().value); this.receipt_traces_dropped++; }
		this.score_updates++;
		if (!this.pending_by_court.has(score.court_id)) {
			this.pending_by_court.set(score.court_id, []);
		}
		this.pending_by_court.get(score.court_id).push(pending);
		if (!this.pending_admin_by_court.has(score.court_id)) this.pending_admin_by_court.set(score.court_id, []);
		this.pending_admin_by_court.get(score.court_id).push(pending);
	}

	record_display_payload(court_id, payload_type, state, now = Date.now()) {
		this.prune_latencies();
		const row = this.ensure_row(court_id);
		row.state = state || row.state;
		row.last_payload_type = payload_type;
		row.last_update_ts = now;
		row.update_count++;
		row.error = null;
		this.display_update_events.push({ ts: now, court_id, payload_type });
		this.tv_payload_stats.receive(payload_type);
		const match_id = state?.match?.id || null;
		const displayed_score = score_payload_text(state?.score);
		const pending = this.pending_by_court.get(court_id) || [];
		const idx = pending.findIndex((item) => (
			normalize_match_id(item.match_id) === normalize_match_id(match_id)
			&& item.score_text && item.score_text === displayed_score
		));
		if (idx >= 0) {
			const [item] = pending.splice(idx, 1);
			const latency = now - item.ts;
			Object.assign(this.receipt_traces.get(item.trace_id) || {}, { tv_ms: latency, tv_received_ts: now });
			if (item.phase_stats) item.phase_stats.latencies.push(latency);
			row.last_latency_ms = latency;
			this.latencies.push({ ts: now, court_id, ms: latency });
			this.tv_latency_stats.add(latency);
			this.tv_payload_stats.match(payload_type, latency);
			if (this.options.slow_latency_ms > 0 && latency >= this.options.slow_latency_ms) {
				this.log('live-drill:slow-latency', {
					trace_id: item.trace_id || null,
					court: court_id,
					match_id: item.match_id,
					score: item.score_text,
					payload_type,
					latency_ms: latency,
					slow_latency_ms: this.options.slow_latency_ms,
				});
			}
		}
		this.prune_latencies();
	}

	record_admin_payload(msg, received_at = Date.now()) {
		if (msg.tournament_key && msg.tournament_key !== this.options.tournament_key) return;
		this.prune_latencies();
		const type = msg.type === 'change' ? 'change:' + (msg.ctype || 'unknown') : msg.type || 'unknown';
		this.admin_payload_stats.receive(type);
		if (msg.ctype === 'queue_hang_warning') this.performance.event('Long running lock task', msg.val, received_at);
		if (msg.type !== 'change' || msg.ctype !== 'score' || !msg.val?.match_id) return;
		const score = msg.val, score_text = network_score_text(score.network_score);
		if (!score_text) return;
		const signature = Array.isArray(score.presses) ? JSON.stringify([score.presses.length, score.presses.at(-1)]) : null;
		for (const [court_id, pending] of this.pending_admin_by_court) {
			if (score.court_id && score.court_id !== court_id) continue;
			const index = pending.findIndex(item => normalize_match_id(item.match_id) === normalize_match_id(score.match_id) &&
				item.admin_score_text === score_text && item.ended === !!score.end_ts &&
				(item.press_signature == null || item.press_signature === signature) && received_at >= item.ts);
			if (index < 0) continue;
			const [item] = pending.splice(index, 1), latency = received_at - item.ts;
			Object.assign(this.receipt_traces.get(item.trace_id) || {}, { admin_ms: latency, admin_received_ts: received_at });
			this.ensure_row(court_id).last_admin_latency_ms = latency;
			this.admin_latencies.push({ ts: received_at, court_id, ms: latency });
			this.admin_latency_stats.add(latency); this.admin_payload_stats.match(type, latency);
			if (item.phase_stats) {
				if (!item.phase_stats.admin_latencies) item.phase_stats.admin_latencies = [];
				item.phase_stats.admin_latencies.push(latency);
			}
			if (this.options.slow_latency_ms > 0 && latency >= this.options.slow_latency_ms) {
				this.log('live-drill:slow-admin-latency', { trace_id: item.trace_id, court: court_id,
					match_id: item.match_id, latency_ms: latency, payload_type: type });
			}
			break;
		}
	}

	prune_event_windows() {
		const cutoff = Date.now() - 60000;
		this.score_sent_events = this.score_sent_events.filter((entry) => entry.ts >= cutoff);
		this.display_update_events = this.display_update_events.filter((entry) => entry.ts >= cutoff);
	}

	prune_latencies() {
		const cutoff = Date.now() - 60000;
		this.prune_event_windows();
		this.latencies = this.latencies.filter((entry) => entry.ts >= cutoff);
		this.admin_latencies = this.admin_latencies.filter((entry) => entry.ts >= cutoff);
		for (const [target, map] of [['tv', this.pending_by_court], ['admin', this.pending_admin_by_court]]) for (const [court_id, pending] of map.entries()) {
			const fresh = pending.filter((entry) => entry.ts >= Date.now() - 30000);
			this.expired[target] += pending.length - fresh.length;
			if (fresh.length) map.set(court_id, fresh);
			else map.delete(court_id);
		}
	}

	avg_latency(court_id, target = 'tv', prune = true) {
		if (prune) this.prune_latencies();
		const values = (target === 'admin' ? this.admin_latencies : this.latencies)
			.filter((entry) => !court_id || entry.court_id === court_id)
			.map((entry) => entry.ms);
		const avg = average(values);
		return avg == null ? null : round_ms(avg);
	}

	score_frequency_per_sec() {
		this.prune_event_windows();
		return round_ms(recent_rate_per_sec(this.score_sent_events, 60000, this.started_at));
	}

	display_frequency_per_sec() {
		this.prune_event_windows();
		return round_ms(recent_rate_per_sec(this.display_update_events, 60000, this.started_at));
	}

	payload_type_stats() { return this.tv_payload_stats.summary(); }

	admin_payload_type_stats() { return this.admin_payload_stats.summary(); }

	set_paused(paused) {
		this.paused = !!paused;
		this.performance.pause(this.paused);
	}

	render() {
		if (!this.enabled) return;
		this.prune_latencies();
		const now = Date.now();
		const width = process.stdout.columns || 140;
		const lines = [];
		lines.push('BTS Live Drill - Tablet -> TV / Admin event reception');
		lines.push([
			this.paused ? 'PAUSED' : 'RUNNING',
			...(this.phase_stats ? ['Phase ' + this.phase_stats.name] : []),
			'Runtime ' + format_age(now - this.started_at),
			'Points ' + this.points,
			(this.options.scenario ? 'Player check-ins ' : 'Check-ins ') + this.checkins,
			'Speed ' + this.options.point_min_ms + '-' + this.options.point_max_ms + 'ms',
			'Gap ' + this.options.score_gap_min_ms + '-' + this.options.score_gap_max_ms + 'ms',
		].join(' | '));
		lines.push([
			'Score ' + this.score_frequency_per_sec() + '/s',
			'TV ' + this.display_frequency_per_sec() + '/s',
			'TV avg 1m ' + (this.avg_latency(null, 'tv', false) == null ? '-' : this.avg_latency(null, 'tv', false) + 'ms'),
			'Admin avg 1m ' + (this.avg_latency(null, 'admin', false) == null ? '-' : this.avg_latency(null, 'admin', false) + 'ms'),
		].join(' | '));
		lines.push('Views: 1 Overview | 2 Queues | 3 Payloads | 4 Events (current ' + this.view + ')');
		lines.push(this.options.scenario ? 'Benchmark controls: q/Ctrl+C quit' : 'Keys: p/space pause/resume | + faster | - slower | q quit');
		lines.push(...render_performance(this, this.view === 2));
		if (this.view === 1 || this.view === 3) {
			lines.push('Tablet score send -> client WebSocket event received, entire run (no rendering)');
			lines.push(truncate_text('Target', 10) + pad_left('Sent', 7) + pad_left('Samples', 9) + pad_left('Unmatched', 11) +
				pad_left('Avg', 10) + pad_left('p95', 10) + pad_left('p99', 10) + pad_left('Max', 10));
			for (const [target, metrics] of [['TV', this.tv_latency_stats], ['Admin', this.admin_latency_stats]]) {
				const stats = metrics.summary(this.score_updates);
				lines.push(truncate_text(target, 10) + pad_left(stats.sent_updates, 7) + pad_left(stats.count, 9) +
					pad_left(stats.unmatched_updates, 11) + [stats.mean, stats.p95, stats.p99, stats.max]
						.map(value => pad_left(value == null ? '-' : value + 'ms', 10)).join(''));
			}
		}
		if (this.view === 1) {
			lines.push('-'.repeat(Math.min(width, 132)));
			lines.push(
				truncate_text('Feld', 6) +
				truncate_text('TV', 5) +
				truncate_text('Tab', 6) +
				truncate_text('Match', 8) +
				truncate_text('Status', 11) +
				truncate_text('Teams', 30) +
				truncate_text('Score', 15) +
				truncate_text('Payload', 13) +
				pad_left('TVLast', 8) +
				pad_left('TV1m', 8) +
				pad_left('AdmLast', 8) +
				pad_left('Adm1m', 8) +
				pad_left('Upd', 5),
			);
			for (const court of this.courts) {
				const row = this.ensure_row(court._id);
				const state = row.state || {};
				const match = state.match || {};
				const teams = [side_players_label(state, 'left'), side_players_label(state, 'right')].filter(Boolean).join(' v ');
				const score = score_payload_text(state.score) || '-';
				const last = row.last_latency_ms == null ? '-' : round_ms(row.last_latency_ms) + 'ms';
				const avg = this.avg_latency(court._id, 'tv', false);
				const admin_last = row.last_admin_latency_ms == null ? '-' : round_ms(row.last_admin_latency_ms) + 'ms';
				const admin_avg = this.avg_latency(court._id, 'admin', false);
				const payload_label = row.drill_status || row.last_payload_type || '-';
				lines.push(
					truncate_text(String(court.num ?? court.name ?? court._id), 6) +
					truncate_text(row.error ? 'ERR' : (row.tv_connected ? 'ok' : '...'), 5) +
					truncate_text(row.tablet_battery == null ? '-' : row.tablet_battery + '%' + (row.tablet_charging ? '+' : ''), 6) +
					truncate_text(match.id ? '#' + (match.id.split('_').pop() || match.id).slice(-5) : '-', 8) +
					truncate_text(match.status || state.view?.screen || '-', 11) +
					truncate_text(teams || '-', 30) +
					truncate_text(score, 15) +
					truncate_text(payload_label, 13) +
					pad_left(last, 8) +
					pad_left(avg == null ? '-' : avg + 'ms', 8) +
					pad_left(admin_last, 8) +
					pad_left(admin_avg == null ? '-' : admin_avg + 'ms', 8) +
					pad_left(row.update_count, 5),
				);
			}
			lines.push('-'.repeat(Math.min(width, 132)));
		}
		if (this.view === 3) {
			lines.push('Payload latency by type, entire run');
			const payload_stats = [
				...this.payload_type_stats().map(stats => ({ source: 'TV', ...stats })),
				...this.admin_payload_type_stats().map(stats => ({ source: 'Admin', ...stats })),
			];
			const measured_payloads = payload_stats.filter(stats => stats.latency_count > 0);
			if (measured_payloads.length) lines.push(
				truncate_text('Source', 7) + truncate_text('Type', 31) +
				pad_left('Count', 7) +
				pad_left('Lat', 6) +
				pad_left('Avg', 9) +
				pad_left('Min', 9) +
				pad_left('p95', 9) +
				pad_left('p99', 9) +
				pad_left('Max', 9),
			);
			if (measured_payloads.length === 0) {
				lines.push('No tablet score latency samples yet');
			}
			for (const stats of measured_payloads) {
				lines.push(
					truncate_text(stats.source, 7) + truncate_text(stats.type, 31) +
					pad_left(stats.count, 7) +
					pad_left(stats.latency_count, 6) +
					pad_left(stats.avg == null ? '-' : stats.avg + 'ms', 9) +
					pad_left(stats.min == null ? '-' : stats.min + 'ms', 9) +
					pad_left(stats.p95 == null ? '-' : stats.p95 + 'ms', 9) +
					pad_left(stats.p99 == null ? '-' : stats.p99 + 'ms', 9) +
					pad_left(stats.max == null ? '-' : stats.max + 'ms', 9),
				);
			}
			const counted_payloads = payload_stats.filter(stats => stats.latency_count === 0);
			if (counted_payloads.length) {
				lines.push('Other payload counts, entire run');
				for (const source of ['TV', 'Admin']) {
					const entries = counted_payloads.filter(stats => stats.source === source);
					let line = truncate_text(source, 7);
					for (const stats of entries) {
						const entry = stats.type + '=' + stats.count;
						if (line.length > 7 && line.length + entry.length + 3 > width) {
							lines.push(line); line = ' '.repeat(7);
						}
						line += (line.length > 7 ? ' | ' : '') + entry;
					}
					if (entries.length) lines.push(line);
				}
			}
			lines.push('-'.repeat(Math.min(width, 132)));
		}
		if (this.view === 4) {
			lines.push('Server diagnostics (existing lock records / warnings, latest 50)');
			for (const event of this.performance.events.slice(0, Math.max(3, (process.stdout.rows || 40) - 19))) lines.push(truncate_text(`${new Date(event.ts).toLocaleTimeString()} ${event.label} ${JSON.stringify(event.details)}`, width));
			lines.push('Test events');
			for (const event of this.events) {
				lines.push(truncate_text(`${new Date(event.ts).toLocaleTimeString()} ${event.label} ${JSON.stringify(event.data)}`, width));
			}
		}
		process.stdout.write('\x1b[H\x1b[2J' + lines.map((line) => truncate_text(line, width)).join('\n'));
	}
}

function parse_args(argv) {
	const options = {
		scenario: null,
		seed: null,
		expected_matches: null,
		report_path: null,
		base_url: DEFAULT_BASE_URL,
		tournament_key: DEFAULT_TOURNAMENT_KEY,
		point_min_ms: 5000,
		point_max_ms: 10000,
		score_gap_min_ms: 0,
		score_gap_max_ms: 0,
		pause_visible_ms: 3000,
		score_probability_min: 0.4,
		score_probability_max: 0.6,
		checkin_min_ms: 30000,
		checkin_max_ms: 45000,
		score_all_active: true,
		processing_traces: true,
		max_runtime_ms: 0,
		dashboard: process.stdout.isTTY,
		display_ack_render_ms: 0,
		slow_latency_ms: DEFAULT_SLOW_LATENCY_MS,
		tablet_battery_min: 55,
		tablet_battery_max: 100,
		tablet_battery_drain_min: 0.05,
		tablet_battery_drain_max: 0.25,
		tablet_charging_ratio: 0.25,
		tablet_charge_min: 0.1,
		tablet_charge_max: 0.5,
	};

	const provided = new Set();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		provided.add(arg);
		const next = () => {
			if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
			return argv[++i];
		};
		const next_number = (fallback) => {
			const value = Number(next());
			return Number.isFinite(value) ? value : fallback;
		};
		if (arg === '--scenario') options.scenario = next();
		else if (arg === '--seed') options.seed = next();
		else if (arg === '--expected-matches') options.expected_matches = Number(next());
		else if (arg === '--report') options.report_path = next();
		else if (arg === '--base-url') options.base_url = next();
		else if (arg === '--tournament') options.tournament_key = next();
		else if (arg === '--point-min-ms') options.point_min_ms = Number(next()) || options.point_min_ms;
		else if (arg === '--point-max-ms') options.point_max_ms = Number(next()) || options.point_max_ms;
		else if (arg === '--score-gap-min-ms') options.score_gap_min_ms = next_number(options.score_gap_min_ms);
		else if (arg === '--score-gap-max-ms') options.score_gap_max_ms = next_number(options.score_gap_max_ms);
		else if (arg === '--pause-visible-ms') options.pause_visible_ms = next_number(options.pause_visible_ms);
		else if (arg === '--score-probability-min') options.score_probability_min = next_number(options.score_probability_min);
		else if (arg === '--score-probability-max') options.score_probability_max = next_number(options.score_probability_max);
		else if (arg === '--checkin-min-ms') options.checkin_min_ms = Number(next()) || options.checkin_min_ms;
		else if (arg === '--checkin-max-ms') options.checkin_max_ms = Number(next()) || options.checkin_max_ms;
		else if (arg === '--no-processing-traces') options.processing_traces = false;
		else if (arg === '--processing-traces') options.processing_traces = true;
		else if (arg === '--score-all-active') options.score_all_active = true;
		else if (arg === '--score-one-active') options.score_all_active = false;
		else if (arg === '--include-blocked-checkins') throw new Error('Only preparation matches may be checked in');
		else if (arg === '--max-runtime-ms') options.max_runtime_ms = Number(next()) || 0;
		else if (arg === '--dashboard') options.dashboard = true;
		else if (arg === '--dashboard-view') options.dashboard_view = Number(next());
		else if (arg === '--plain-log' || arg === '--no-dashboard') options.dashboard = false;
		else if (arg === '--display-ack-render-ms') options.display_ack_render_ms = Number(next()) || 0;
		else if (arg === '--slow-latency-ms') options.slow_latency_ms = next_number(options.slow_latency_ms);
		else if (arg === '--tablet-battery-min') options.tablet_battery_min = next_number(options.tablet_battery_min);
		else if (arg === '--tablet-battery-max') options.tablet_battery_max = next_number(options.tablet_battery_max);
		else if (arg === '--tablet-battery-drain-min') options.tablet_battery_drain_min = next_number(options.tablet_battery_drain_min);
		else if (arg === '--tablet-battery-drain-max') options.tablet_battery_drain_max = next_number(options.tablet_battery_drain_max);
		else if (arg === '--tablet-charging-ratio') options.tablet_charging_ratio = next_number(options.tablet_charging_ratio);
		else if (arg === '--tablet-charge-min') options.tablet_charge_min = next_number(options.tablet_charge_min);
		else if (arg === '--tablet-charge-max') options.tablet_charge_max = next_number(options.tablet_charge_max);
		else if (arg === '--help' || arg === '-h') {
			console.log([
				'Usage: node debug/live_tournament_drill.js [options]',
				'',
				'Simulates a live tournament against a running BTS instance.',
				'Every running match gets its own random point interval of 5-10 seconds.',
				'Match-end confirmation is sent separately after another point interval.',
				'Score updates include tablet presses for match start, set breaks, points, and match end.',
				'Interactive mode checks in one preparation match at startup and then every 30-45 seconds.',
				'Stop with Ctrl+C.',
				'',
				'Options:',
				'  --scenario benchmark        10-minute sequence: check-in/play 2m, load 4m, idle 2m, load 2m',
				'                              continuous preparation-only check-ins; initially spread over <=2m',
				'                              defaults: seed 519, points 3200-6400ms, all active courts',
				'  --seed TEXT                 reproducible random streams per match and tablet',
				'  --expected-matches N        require N matches at startup (benchmark default 519, 0 disables)',
				'  --report PATH               write final JSON report (benchmark: /tmp/bts-live-drill-report.json)',
				'  --base-url URL              BTS URL, default https://localhost:4433',
				'  --tournament KEY            tournament key, default default',
				'  --point-min-ms N            minimum point interval, default 5000',
				'  --point-max-ms N            maximum point interval, default 10000',
				'  --score-gap-min-ms N        extra delay after each score send, default 0',
				'  --score-gap-max-ms N        extra delay after each score send, default 0',
				'  --pause-visible-ms N        minimum delay after interval/set-break timer updates, default 3000',
				'  --score-probability-min N   minimum fixed team-1 point probability per match, default 0.4',
				'  --score-probability-max N   maximum fixed team-1 point probability per match, default 0.6',
				'  --checkin-min-ms N          minimum check-in interval, default 30000',
				'  --checkin-max-ms N          maximum check-in interval, default 45000',
				'  --score-all-active          score every active match per point tick (default)',
				'  --score-one-active          score only one random active match per point tick',
				'  --max-runtime-ms N          stop automatically after N milliseconds',
				'  --dashboard                 show a stable ANSI terminal dashboard (default on TTY)',
				'  --dashboard-view N          start in view 1 overview, 2 queues, 3 payloads, 4 events',
				'  --no-processing-traces      disable detailed operation/lock/DB/worker recording (queue probes remain)',
				'  --plain-log                 print line-oriented JSON logs instead of the dashboard',
				'  --display-ack-render-ms N   simulated display render time sent in display_rendered ACKs',
				'  --slow-latency-ms N         log tablet-to-TV/Admin latency samples at or above N ms, default 500, 0 disables',
				'  --tablet-battery-min N      minimum initial simulated tablet battery, default 55',
				'  --tablet-battery-max N      maximum initial simulated tablet battery, default 100',
				'  --tablet-battery-drain-min N minimum battery drain per score update, default 0.05',
				'  --tablet-battery-drain-max N maximum battery drain per score update, default 0.25',
				'  --tablet-charging-ratio N   share of tablets that start charging, default 0.25',
				'  --tablet-charge-min N       minimum battery gain per score update while charging, default 0.1',
				'  --tablet-charge-max N       maximum battery gain per score update while charging, default 0.5',
				'',
				'Keys while running on a TTY (benchmark only allows q/Ctrl+C):',
				'  p or space                  pause/resume score and check-in simulation',
				'  + or =                      faster score updates',
				'  - or _                      slower score updates',
				'  q or Ctrl+C                 stop',
			].join('\n'));
			process.exit(0);
		} else {
			throw new Error('Unknown argument ' + arg);
		}
	}
	if (options.scenario && options.scenario !== 'benchmark') throw new Error('Unknown scenario ' + options.scenario);
	if (options.scenario === 'benchmark') {
		if (provided.has('--max-runtime-ms') && options.max_runtime_ms !== BENCHMARK_RUNTIME_MS) {
			throw new Error('Benchmark duration is fixed at 600000 ms');
		}
		options.max_runtime_ms = BENCHMARK_RUNTIME_MS;
		if (!provided.has('--point-min-ms')) options.point_min_ms = 3200;
		if (!provided.has('--point-max-ms')) options.point_max_ms = 6400;
		if (!provided.has('--seed')) options.seed = '519';
		if (!provided.has('--expected-matches')) options.expected_matches = 519;
		if (!provided.has('--report')) options.report_path = '/tmp/bts-live-drill-report.json';
	}
	if (options.expected_matches != null && (!Number.isInteger(options.expected_matches) || options.expected_matches < 0)) {
		throw new Error('--expected-matches must be a non-negative integer');
	}

	if (options.point_min_ms > options.point_max_ms) {
		[options.point_min_ms, options.point_max_ms] = [options.point_max_ms, options.point_min_ms];
	}
	options.score_gap_min_ms = Math.max(0, Math.round(Number(options.score_gap_min_ms) || 0));
	options.score_gap_max_ms = Math.max(0, Math.round(Number(options.score_gap_max_ms) || 0));
	if (options.score_gap_min_ms > options.score_gap_max_ms) {
		[options.score_gap_min_ms, options.score_gap_max_ms] = [options.score_gap_max_ms, options.score_gap_min_ms];
	}
	options.pause_visible_ms = Math.max(0, Math.round(Number(options.pause_visible_ms) || 0));
	options.score_probability_min = Math.max(0, Math.min(1, Number(options.score_probability_min)));
	options.score_probability_max = Math.max(0, Math.min(1, Number(options.score_probability_max)));
	if (!Number.isFinite(options.score_probability_min)) options.score_probability_min = 0.4;
	if (!Number.isFinite(options.score_probability_max)) options.score_probability_max = 0.6;
	if (options.score_probability_min > options.score_probability_max) {
		[options.score_probability_min, options.score_probability_max] = [options.score_probability_max, options.score_probability_min];
	}
	if (options.checkin_min_ms > options.checkin_max_ms) {
		[options.checkin_min_ms, options.checkin_max_ms] = [options.checkin_max_ms, options.checkin_min_ms];
	}
	{
		const slow_latency_ms = Number(options.slow_latency_ms);
		options.slow_latency_ms = Number.isFinite(slow_latency_ms)
			? Math.max(0, Math.round(slow_latency_ms))
			: DEFAULT_SLOW_LATENCY_MS;
	}
	options.tablet_battery_min = Math.max(1, Math.min(100, Number(options.tablet_battery_min) || 55));
	options.tablet_battery_max = Math.max(1, Math.min(100, Number(options.tablet_battery_max) || 100));
	if (options.tablet_battery_min > options.tablet_battery_max) {
		[options.tablet_battery_min, options.tablet_battery_max] = [options.tablet_battery_max, options.tablet_battery_min];
	}
	options.tablet_battery_drain_min = Math.max(0, Number(options.tablet_battery_drain_min) || 0);
	options.tablet_battery_drain_max = Math.max(0, Number(options.tablet_battery_drain_max) || 0);
	if (options.tablet_battery_drain_min > options.tablet_battery_drain_max) {
		[options.tablet_battery_drain_min, options.tablet_battery_drain_max] = [options.tablet_battery_drain_max, options.tablet_battery_drain_min];
	}
	options.tablet_charging_ratio = Math.max(0, Math.min(1, Number(options.tablet_charging_ratio) || 0));
	options.tablet_charge_min = Math.max(0, Number(options.tablet_charge_min) || 0);
	options.tablet_charge_max = Math.max(0, Number(options.tablet_charge_max) || 0);
	if (options.tablet_charge_min > options.tablet_charge_max) {
		[options.tablet_charge_min, options.tablet_charge_max] = [options.tablet_charge_max, options.tablet_charge_min];
	}
	if (options.dashboard_view != null && ![1, 2, 3, 4].includes(options.dashboard_view)) throw new Error('--dashboard-view must be 1, 2, 3 or 4');
	return options;
}

class AdminWsClient {
	constructor(base_url, tournament_key, dashboard = null, { handshake_timeout_ms } = {}) {
		this.url = ws_url(base_url, '/ws/admin');
		this.dashboard = dashboard;
		this.handshake_timeout_ms = handshake_timeout_ms;
		this.tournament_key = tournament_key;
		this.ws = null;
		this.next_rid = 1;
			this.pending = new Map();
			this.errors = [];
			this.changes = [];
			this.closing = false;
			this.connecting = null;
		}

		async connect() {
			if (this.closing) {
				throw new StopError();
			}
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				return;
			}
			if (this.connecting) {
				return this.connecting;
			}
			close_ws(this.ws);
			const ws = new WebSocket(this.url, 'bts-admin', { rejectUnauthorized: false, handshakeTimeout: this.handshake_timeout_ms });
			this.ws = ws;
			ws.on('message', (raw) => this._on_message(raw));
			ws.on('close', () => {
				this._reject_pending(this.closing ? new StopError() : new Error('Admin WebSocket closed'));
			});
			this.connecting = new Promise((resolve, reject) => {
				const on_open = () => {
					cleanup();
					resolve();
			};
			const on_error = (err) => {
				cleanup();
				reject(this.closing ? new StopError() : err);
			};
				const on_close = () => {
					cleanup();
					reject(this.closing ? new StopError() : new Error('Admin WebSocket closed before open'));
				};
				const cleanup = () => {
					ws.off('open', on_open);
					ws.off('error', on_error);
					ws.off('close', on_close);
				};
				ws.on('open', on_open);
				ws.on('error', on_error);
				ws.on('close', on_close);
			});
			try {
				await this.connecting;
			} finally {
				this.connecting = null;
			}
		}

	_on_message(raw) {
		const received_at = Date.now();
		const msg = JSON.parse(raw.toString());
		if (this.dashboard) this.dashboard.record_admin_payload(msg, received_at);
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

		async send(type, payload = {}, timeout_ms = 30000) {
			try {
				return await this._send_once(type, payload, timeout_ms);
			} catch (err) {
				if (this.closing || is_stop_error(err) || !is_admin_closed_error(err)) {
					throw err;
				}
				await sleep(250);
				return this._send_once(type, payload, timeout_ms);
			}
		}

		async _send_once(type, payload = {}, timeout_ms = 30000) {
			if (this.closing) {
				throw new StopError();
			}
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
				await this.connect();
			}
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
				throw new Error('Admin WebSocket is not open');
			}
			const rid = this.next_rid++;
			const msg = {
			...payload,
			type,
				rid,
				tournament_key: payload.tournament_key || this.tournament_key,
			};
			const response = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					this.pending.delete(rid);
					reject(new Error('Timeout waiting for admin answer to ' + type));
			}, timeout_ms);
			this.pending.set(rid, {
				timeout,
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
			try {
				this.ws.send(JSON.stringify(msg));
			} catch (err) {
				this._reject_pending(new Error(err.message || String(err)));
				throw err;
			}
			return response;
		}

	async tournament() {
		const answer = await this.send('tournament_get', { key: this.tournament_key }, 30000);
		if (!answer.tournament) throw new Error('Turnier „' + this.tournament_key + '“ wurde auf diesem Server nicht gefunden.');
		return answer.tournament;
	}

	async relocate_display(client_id, court_id) {
		return this.send('relocate_display', {
			display_setting_id: client_id,
			new_court_id: court_id,
		}, 30000);
	}

	_reject_pending(err) {
		for (const [rid, pending] of this.pending.entries()) {
			this.pending.delete(rid);
			if (pending.timeout) clearTimeout(pending.timeout);
			pending.reject(err);
		}
	}

	close() {
		this.closing = true;
		this._reject_pending(new StopError());
		close_ws(this.ws);
	}
}

class BupV2Client {
	constructor(base_url, tournament_key, court_id, options, dashboard) {
		this.url = ws_url(base_url, '/ws/bup_v2');
		this.tournament_key = tournament_key;
		this.court_id = court_id;
		this.client_id = 'debug-live-drill-' + process.pid + '-' + String(court_id).replace(/[^a-zA-Z0-9_-]/g, '_');
		this.hostname = this.client_id;
		this.options = options;
		this.dashboard = dashboard;
		this.random = random_source(options, 'battery:' + court_id);
		this.battery = random_int(options.tablet_battery_min, options.tablet_battery_max, this.random);
		this.charging = this.random() < options.tablet_charging_ratio;
		this.ws = null;
		this.errors = [];
		this.closing = false;
	}

	battery_payload() {
		const level = Math.max(0.01, Math.min(1, this.battery / 100));
		const charge_rate = Math.max(0.01, (this.options.tablet_charge_min + this.options.tablet_charge_max) / 2);
		const drain_rate = Math.max(0.01, (this.options.tablet_battery_drain_min + this.options.tablet_battery_drain_max) / 2);
		return {
			level,
			charging: this.charging,
			chargingTime: this.charging ? Math.round(((100 - this.battery) / charge_rate) * 20) : 0,
			dischargingTime: this.charging ? 0 : Math.round((this.battery / drain_rate) * 20),
		};
	}

	current_device_info() {
		return {
			battery: this.battery_payload(),
			client_id: this.client_id,
			hostname: this.hostname,
			live_tournament_drill: true,
		};
	}

	advance_battery() {
		if (this.charging) {
			const min = this.options.tablet_charge_min;
			const max = this.options.tablet_charge_max;
			const charge = min + this.random() * (max - min);
			this.battery = Math.min(100, this.battery + charge);
			if (this.battery >= 99.5) {
				this.charging = false;
			}
		} else {
			const min = this.options.tablet_battery_drain_min;
			const max = this.options.tablet_battery_drain_max;
			const drain = min + this.random() * (max - min);
			this.battery = Math.max(1, this.battery - drain);
			if (this.battery <= 15) {
				this.charging = true;
			}
		}
		if (this.dashboard) {
			this.dashboard.set_tablet_battery(this.court_id, this.battery_payload());
		}
		return this.current_device_info();
	}

	async connect() {
		if (this.closing) throw new StopError();
		if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
		this.ws = new WebSocket(this.url, { rejectUnauthorized: false });
		this.ws.on('message', (raw) => {
			const msg = JSON.parse(raw.toString());
			if (msg.type === 'error') this.errors.push(msg);
			if (msg.type === 'change') {
				this.ws.send(JSON.stringify({
					type: 'command_done',
					tournament_key: msg.tournament_key || this.tournament_key,
					wait_for_command: {
						ctype: msg.ctype,
						val: msg.val,
					},
				}));
			}
		});
		await new Promise((resolve, reject) => {
			const on_open = () => {
				cleanup();
				resolve();
			};
			const on_error = (err) => {
				cleanup();
				reject(this.closing ? new StopError() : err);
			};
			const on_close = () => {
				cleanup();
				reject(this.closing ? new StopError() : new Error('Tablet WebSocket closed before open'));
			};
			const cleanup = () => {
				this.ws.off('open', on_open);
				this.ws.off('error', on_error);
				this.ws.off('close', on_close);
			};
			this.ws.on('open', on_open);
			this.ws.on('error', on_error);
			this.ws.on('close', on_close);
		});
		if (this.closing) throw new StopError();
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
		this.ws.send(JSON.stringify({
			type: 'device_info',
			tournament_key: this.tournament_key,
			device: this.current_device_info(),
		}));
		if (this.dashboard) {
			this.dashboard.set_tablet_battery(this.court_id, this.battery_payload());
		}
		await sleep(150);
	}

	async score(match, score, before_send) {
		await this.connect();
		this.ws.send(JSON.stringify({
			type: 'match_opened',
			tournament_key: this.tournament_key,
			court_id: this.court_id,
			match_id: match._id,
		}));
		await sleep(30);
		score.device = {
			...(score.device || {}),
			...this.advance_battery(),
		};
		ensure_score_trace_id(score);
		if (typeof before_send === 'function' && before_send() === false) return false;
		this.ws.send(JSON.stringify({
			type: 'score_update',
			tournament_key: this.tournament_key,
			score,
		}));
		return true;
	}

	close() {
		this.closing = true;
		close_ws(this.ws);
	}
}

class DisplayV2Client {
	constructor(base_url, tournament_key, court, dashboard, options) {
		this.url = ws_url(base_url, '/ws/bup_v2');
		this.tournament_key = tournament_key;
		this.court = court;
		this.court_id = court._id;
		this.client_id = 'debug-live-tv-' + process.pid + '-' + String(this.court_id).replace(/[^a-zA-Z0-9_-]/g, '_');
		this.hostname = this.client_id;
		this.dashboard = dashboard;
		this.options = options;
		this.ws = null;
		this.state = null;
		this.connected = false;
		this.closing = false;
	}

	async connect(admin) {
		if (this.closing) throw new StopError();
		if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
		this.ws = new WebSocket(this.url, { rejectUnauthorized: false });
		this.ws.on('message', (raw) => this._on_message(raw));
		this.ws.on('close', () => {
			this.connected = false;
			this.dashboard.set_tv_status(this.court_id, false);
		});
		this.ws.on('error', (err) => {
			this.dashboard.set_tv_status(this.court_id, false, err.message || String(err));
		});
		await new Promise((resolve, reject) => {
			const on_open = () => {
				cleanup();
				resolve();
			};
			const on_error = (err) => {
				cleanup();
				reject(this.closing ? new StopError() : err);
			};
			const on_close = () => {
				cleanup();
				reject(this.closing ? new StopError() : new Error('Display WebSocket closed before open'));
			};
			const cleanup = () => {
				this.ws.off('open', on_open);
				this.ws.off('error', on_error);
				this.ws.off('close', on_close);
			};
			this.ws.on('open', on_open);
			this.ws.on('error', on_error);
			this.ws.on('close', on_close);
		});
		if (this.closing) throw new StopError();
		this.connected = true;
		this.dashboard.set_tv_status(this.court_id, true);
		this.ws.send(JSON.stringify({
			type: 'init',
			tournament_key: this.tournament_key,
			client_id: this.client_id,
			hostname: this.hostname,
			panel_settings: {
				client_id: this.client_id,
				hostname: this.hostname,
				devicemode: 'display',
			},
		}));
		await sleep(150);
		await admin.relocate_display(this.client_id, this.court_id);
		await sleep(150);
	}

	_on_message(raw) {
		const received_at = Date.now();
		let msg;
		try {
			msg = JSON.parse(raw.toString());
		} catch (err) {
			this.dashboard.set_tv_status(this.court_id, false, err.message || String(err));
			return;
		}
		if (msg.type === 'error') {
			this.dashboard.set_tv_status(this.court_id, false, msg.message || msg.msg || 'display error');
			return;
		}
		if (msg.type === 'use-bup-v1') {
			this.dashboard.set_tv_status(this.court_id, false, 'BUP v2 disabled');
			return;
		}
		const display_state = this._extract_display_state(msg);
		if (display_state) {
			this._apply_display_state(msg.type, display_state, received_at);
		} else if (this._is_incremental_display_update(msg)) {
			this._apply_incremental_update(msg, received_at);
		}
		if (msg.message_id && this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({
				type: 'display_rendered',
				tournament_key: this.tournament_key,
				message_id: msg.message_id,
				ok: true,
				render_ms: this.options.display_ack_render_ms || 0,
			}));
		}
	}

	_extract_display_state(msg) {
		if (msg.type === 'display_state') return msg;
		if (msg.type !== 'display_multi_state' || !Array.isArray(msg.court_states)) return null;
		return msg.court_states.find((state) => state?.court?.id === this.court_id) || null;
	}

	_is_incremental_display_update(msg) {
		return msg.type === 'display_points_update'
			|| msg.type === 'display_score_update'
			|| msg.type === 'display_timer_update';
	}

	_apply_display_state(payload_type, display_state, received_at) {
		this.state = display_state;
		this.dashboard.record_display_payload(this.court_id, payload_type, this.state, received_at);
	}

	_apply_incremental_update(msg, received_at) {
		if (msg.court_id && msg.court_id !== this.court_id) return;
		if (!this.state) {
			this.state = {
				court: { id: this.court_id, num: this.court.num, label: String(this.court.num || '') },
				view: { screen: 'unknown' },
				match: msg.match_id ? { id: msg.match_id, status: msg.status || null } : null,
				teams: [],
				score: null,
				service: {},
				timers: {},
			};
		}
		if (msg.match_id) {
			this.state.match = {
				...(this.state.match || {}),
				id: msg.match_id,
				status: msg.status || this.state.match?.status || null,
				end_timestamp: msg.end_timestamp || this.state.match?.end_timestamp || null,
			};
		}
		if (msg.score) this.state.score = msg.score;
		if (msg.service) this.state.service = msg.service;
		if (msg.timers) this.state.timers = { ...(this.state.timers || {}), ...msg.timers };
		if (msg.winner_side && Array.isArray(this.state.teams)) {
			this.state.teams = this.state.teams.map((team) => ({
				...team,
				is_winner: team.side === msg.winner_side,
			}));
		}
		this.dashboard.record_display_payload(this.court_id, msg.type, this.state, received_at);
	}

	close() {
		this.closing = true;
		close_ws(this.ws);
	}
}

function match_finished(match) {
	return match?.setup?.state === 'finished'
		|| typeof match?.team1_won === 'boolean'
		|| match?.btp_winner != null
		|| match?.no_match_losing_team != null
		|| (match?.score_status && match.score_status !== 'normal');
}

function match_players(match) {
	return (match?.setup?.teams || []).flatMap((team) => team.players || []);
}

function is_concrete_match(match) {
	const players = match_players(match);
	return players.length > 0 && players.every((player) => player?.btp_id != null);
}

function set_winner(set_score) {
	if (!Array.isArray(set_score) || set_score.length < 2) return null;
	const [a, b] = set_score;
	if ((a >= 21 || b >= 21) && Math.abs(a - b) >= 2) return a > b ? 0 : 1;
	if (a >= 30 || b >= 30) return a > b ? 0 : 1;
	return null;
}

function match_wins(network_score) {
	const wins = [0, 0];
	for (const set_score of network_score || []) {
		const winner = set_winner(set_score);
		if (winner != null) wins[winner]++;
	}
	return wins;
}

function calc_set_winner(match, game_idx, set_score) {
	if (!Array.isArray(set_score) || set_score.length < 2) return null;
	try {
		const winner = calc.game_winner(match.setup, game_idx, set_score[0], set_score[1]);
		if (winner === 'left') return 0;
		if (winner === 'right') return 1;
		return null;
	} catch (_err) {
		return set_winner(set_score);
	}
}

function normalize_network_score(match) {
	const score = Array.isArray(match.network_score)
		? match.network_score
			.filter((set_score) => Array.isArray(set_score) && set_score.length >= 2)
			.map((set_score) => [Number(set_score[0]) || 0, Number(set_score[1]) || 0])
		: [];
	if (score.length === 0) score.push([0, 0]);
	return score;
}

function normalize_presses(match) {
	return Array.isArray(match.presses)
		? match.presses
			.filter((press) => press && typeof press === 'object')
			.map((press) => ({ ...press }))
		: [];
}

function add_start_presses(presses, match, timestamp) {
	if (presses.some((press) => press.type === 'love-all')) return;
	const base = timestamp - 3000;
	presses.push({ type: 'pick_side', team1_left: true, court_id: match.setup.court_id, timestamp: base });
	presses.push({ type: 'pick_server', team_id: 0, player_id: 0, timestamp: base + 1000 });
	presses.push({ type: 'pick_receiver', team_id: 1, player_id: match.setup.is_doubles ? 1 : 0, timestamp: base + 2000 });
	presses.push({ type: 'love-all', timestamp: base + 3000 });
}

function add_next_set_start_presses(presses, match, timestamp) {
	const last = presses[presses.length - 1];
	if (last?.type !== 'postgame-confirm') {
		presses.push({ type: 'postgame-confirm', timestamp });
		timestamp += 1000;
	}
	presses.push({ type: 'pick_server', team_id: 0, player_id: 0, timestamp });
	presses.push({ type: 'pick_receiver', team_id: 1, player_id: match.setup.is_doubles ? 1 : 0, timestamp: timestamp + 1000 });
	presses.push({ type: 'love-all', timestamp: timestamp + 2000 });
	return timestamp + 3000;
}

function score_press_side_for_team(match, presses, team_id) {
	const state = remote_state_from_presses(match, presses);
	if (state?.game && typeof state.game.team1_left === 'boolean') {
		return state.game.team1_left === (team_id === 0) ? 'left' : 'right';
	}
	return team_id === 0 ? 'left' : 'right';
}

function add_score_press(presses, match, team_id, timestamp) {
	presses.push({
		type: 'score',
		side: score_press_side_for_team(match, presses, team_id),
		timestamp,
	});
}

function add_finished_presses(presses, timestamp) {
	const last = presses[presses.length - 1];
	if (last?.type === 'postmatch-confirm') {
		return;
	}
	presses.push({ type: 'postmatch-confirm', timestamp });
}

function scores_equal(a, b) {
	return Array.isArray(a) && Array.isArray(b) && Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function game_winner_status(match, game_idx, score) {
	try {
		return calc.game_winner(match.setup, game_idx, score[0], score[1]);
	} catch (_err) {
		const winner = set_winner(score);
		if (winner === 0) return 'left';
		if (winner === 1) return 'right';
		return 'inprogress';
	}
}

function point_sequence_for_target_score(match, game_idx, target_score) {
	const target = [Number(target_score?.[0]) || 0, Number(target_score?.[1]) || 0];
	const score = [0, 0];
	const sequence = [];
	while (score[0] < target[0] || score[1] < target[1]) {
		const candidates = [0, 1].filter((team_id) => score[team_id] < target[team_id]);
		if (candidates.length === 0) break;
		const valid = candidates.filter((team_id) => {
			const next_score = score.slice();
			next_score[team_id] += 1;
			const status = game_winner_status(match, game_idx, next_score);
			return status === 'inprogress' || scores_equal(next_score, target);
		});
		const pool = valid.length > 0 ? valid : candidates;
		pool.sort((a, b) => (target[b] - score[b]) - (target[a] - score[a]) || a - b);
		const team_id = pool[0];
		score[team_id] += 1;
		sequence.push(team_id);
	}
	return sequence;
}

function reconstruct_presses_from_network_score(match, network_score) {
	const presses = [];
	let timestamp = Date.now() - Math.max(30000, (network_score || []).flat().reduce((sum, value) => sum + (Number(value) || 0), 0) * 900);
	add_start_presses(presses, match, timestamp);
	timestamp += 1000;
	for (let game_idx = 0; game_idx < network_score.length; game_idx += 1) {
		const target_score = network_score[game_idx];
		const sequence = point_sequence_for_target_score(match, game_idx, target_score);
		for (let point_idx = 0; point_idx < sequence.length; point_idx += 1) {
			const team_id = sequence[point_idx];
			timestamp += 1000;
			add_score_press(presses, match, team_id, timestamp);
			const remaining_points = sequence.length - point_idx - 1;
			const state = remote_state_from_presses(match, presses);
			if (state?.game?.interval && remaining_points > 0) {
				timestamp += 1000;
				presses.push({ type: 'postinterval-confirm', timestamp });
			}
		}
		const is_last_set_in_score = game_idx === network_score.length - 1;
		if (!is_last_set_in_score) {
			if (calc_set_winner(match, game_idx, target_score) == null) {
				return null;
			}
			timestamp = add_next_set_start_presses(presses, match, timestamp + 1000);
		}
	}
	clamp_new_press_timestamps_to_now(presses, 0, Date.now());
	return presses;
}

function repair_score_from_network_score(match, duration_ms) {
	const network_score = normalize_network_score(match);
	const presses = reconstruct_presses_from_network_score(match, network_score);
	if (!presses) return null;
	const state = remote_state_from_presses(match, presses);
	if (!state) return null;
	const last = network_score[network_score.length - 1] || [0, 0];
	const score = {
		match_id: match._id,
		court_id: match.setup.court_id,
		network_score,
		network_team1_left: typeof state.game?.team1_left === 'boolean' ? state.game.team1_left : true,
		network_team1_serving: state.game?.team1_serving === true,
		network_teams_player1_even: [
			[last[0] % 2 === 0, true],
			[last[1] % 2 === 0, true],
		],
		presses,
		duration_ms,
		device: {
			live_tournament_drill: true,
			live_tournament_drill_repair: true,
		},
	};
	return score;
}

function clamp_new_press_timestamps_to_now(presses, start_idx, now) {
	const new_presses = presses.slice(start_idx).filter((press) => Number.isFinite(press?.timestamp));
	if (new_presses.length === 0) return;
	const max_ts = Math.max(...new_presses.map((press) => press.timestamp));
	if (max_ts <= now) return;
	const delta = max_ts - now;
	new_presses.forEach((press) => {
		press.timestamp -= delta;
	});
}

function remote_state_from_presses(match, presses) {
	try {
		return calc.remote_state({}, match.setup, presses);
	} catch (_err) {
		return null;
	}
}

function match_scoreability(match) {
	try {
		const state = calc.remote_state({}, match.setup, normalize_presses(match));
		if (state.match && state.match.finish_confirmed) {
			return { ok: false, reason: 'calc-finished' };
		}
		return { ok: true, reason: null };
	} catch (err) {
		return {
			ok: false,
			reason: 'calc-error',
			error: err && err.message ? err.message : String(err),
		};
	}
}

function match_is_scoreable_by_calc(match) {
	return match_scoreability(match).ok;
}

function add_interval_resume_press(presses, match, timestamp) {
	const state = remote_state_from_presses(match, presses);
	if (!state?.game?.interval) return timestamp;
	presses.push({ type: 'postinterval-confirm', timestamp });
	return timestamp + 1000;
}

function has_visible_pause_timer(match, score) {
	if (!score || score.finish_confirmed) return false;
	const state = remote_state_from_presses(match, score.presses || []);
	if (state?.match?.finished) return false;
	return !!state?.timer?.start;
}

function next_random_score(match, duration_ms, team1_point_probability, random = Math.random) {
	const network_score = normalize_network_score(match);
	const presses = normalize_presses(match);
	if (!match_is_scoreable_by_calc({ ...match, presses })) return null;
	const new_press_start_idx = presses.length;
	let timestamp = Date.now();
	const previous_state = remote_state_from_presses(match, presses);
	const confirm_finish = previous_state?.match?.finished === true;
	let side;
	if (confirm_finish) {
		// Confirmation is a separate action on the next scheduled point interval.
		add_finished_presses(presses, timestamp);
	} else {
		add_start_presses(presses, match, timestamp);
		timestamp = add_interval_resume_press(presses, match, timestamp);

		const wins = match_wins(network_score);
		if (wins[0] >= 2 || wins[1] >= 2) return null;

		let current_set = network_score[network_score.length - 1];
		if (set_winner(current_set) != null) {
			timestamp = add_next_set_start_presses(presses, match, timestamp);
			current_set = [0, 0];
			network_score.push(current_set);
		}

		const probability = Number.isFinite(Number(team1_point_probability)) ? Number(team1_point_probability) : 0.5;
		side = random() < probability ? 0 : 1;
		current_set[side]++;
		add_score_press(presses, match, side, timestamp + 3000);
	}
	clamp_new_press_timestamps_to_now(presses, new_press_start_idx, Date.now());
	const score_state = remote_state_from_presses(match, presses);
	const team1_left = typeof score_state?.game?.team1_left === 'boolean' ? score_state.game.team1_left : true;
	const last = network_score[network_score.length - 1] || [0, 0];
	const score = {
		match_id: match._id,
		court_id: match.setup.court_id,
		network_score,
		network_team1_left: team1_left,
		network_team1_serving: confirm_finish ? match.network_team1_serving === true : side === 0,
		network_teams_player1_even: [
			[last[0] % 2 === 0, true],
			[last[1] % 2 === 0, true],
		],
		presses,
		duration_ms,
		device: {
			live_tournament_drill: true,
		},
	};
	if (confirm_finish) {
		score.end_ts = Date.now();
		score.finish_confirmed = true;
		score.team1_won = previous_state.match.team1_won;
	}
	return score;
}

function active_matches(tournament) {
	return (tournament.matches || [])
		.filter((match) => is_concrete_match(match))
		.filter((match) => match?.setup?.now_on_court === true && match?.setup?.court_id)
		.filter((match) => !match_finished(match))
		.filter((match) => match_is_scoreable_by_calc(match))
		.sort((a, b) => String(a.setup.court_id).localeCompare(String(b.setup.court_id)));
}

function update_scoreability_dashboard(tournament, dashboard) {
	const active_court_ids = new Set();
	(tournament.matches || [])
		.filter((match) => is_concrete_match(match))
		.filter((match) => match?.setup?.now_on_court === true && match?.setup?.court_id)
		.filter((match) => !match_finished(match))
		.forEach((match) => {
			const court_id = match.setup.court_id;
			active_court_ids.add(court_id);
			const scoreability = match_scoreability(match);
			if (scoreability.ok) {
				dashboard.set_drill_status(court_id, null);
				return;
			}
			dashboard.set_drill_status(court_id, 'skip:' + scoreability.reason);
		});
	for (const court of tournament.courts || []) {
		if (court && court._id && !active_court_ids.has(court._id)) {
			dashboard.set_drill_status(court._id, null);
		}
	}
}

async function repair_unscoreable_matches(tournament, bup_clients, options, dashboard, repaired_match_ids, duration_ms_ref, log_event, TabletClient = BupV2Client, can_send = () => true) {
	const candidates = (tournament.matches || [])
		.filter((match) => is_concrete_match(match))
		.filter((match) => match?.setup?.now_on_court === true && match?.setup?.court_id)
		.filter((match) => !match_finished(match))
		.filter((match) => !repaired_match_ids.has(match._id))
		.map((match) => ({ match, scoreability: match_scoreability(match) }))
		.filter((entry) => !entry.scoreability.ok);

	for (const { match, scoreability } of candidates) {
		if (!can_send()) break;
		const court_id = match.setup.court_id;
		duration_ms_ref.value += random_int(9000, 18000, random_source(options, 'duration:' + match._id));
		const repair_score = repair_score_from_network_score(match, duration_ms_ref.value);
		if (!repair_score) {
			repaired_match_ids.add(match._id);
			dashboard.set_drill_status(court_id, 'repair:failed');
			log_event('live-drill:repair:failed', {
				match_num: match.setup?.match_num,
				event: match.setup?.event_name,
				court: court_id,
				reason: scoreability.reason,
				error: scoreability.error || null,
			});
			continue;
		}
		if (!bup_clients.has(court_id)) {
			bup_clients.set(court_id, new TabletClient(options.base_url, options.tournament_key, court_id, options, dashboard));
		}
		ensure_score_trace_id(repair_score);
		dashboard.set_drill_status(court_id, 'repair:sent');
		log_event('live-drill:repair', {
			trace_id: repair_score.debug_trace_id,
			match_num: match.setup?.match_num,
			event: match.setup?.event_name,
			court: court_id,
			score: score_text(repair_score),
			reason: scoreability.reason,
			error: scoreability.error || null,
		});
		const sent = await bup_clients.get(court_id).score(match, repair_score, () => {
			if (!can_send()) return false;
			dashboard.record_score_sent(repair_score);
			if (dashboard.phase_stats) dashboard.phase_stats.repair_score_updates++;
			return true;
		});
		if (sent !== false) repaired_match_ids.add(match._id);
	}
}

function checkin_candidates(tournament) {
	return (tournament.matches || [])
		.filter((match) => is_concrete_match(match))
		.filter((match) => !match_finished(match))
		.filter((match) => match?.setup?.now_on_court !== true)
		.filter((match) => match?.setup?.state === 'preparation')
		.filter((match) => match_players(match).some((player) => player.checked_in !== true))
		.sort((a, b) => {
			const at = `${a.setup?.scheduled_date || ''} ${a.setup?.scheduled_time_str || ''}`;
			const bt = `${b.setup?.scheduled_date || ''} ${b.setup?.scheduled_time_str || ''}`;
			return at.localeCompare(bt)
				|| Number(a.setup?.match_num || 0) - Number(b.setup?.match_num || 0)
				|| String(a.setup?.event_name || '').localeCompare(String(b.setup?.event_name || ''));
		});
}

function benchmark_checkin_requests(tournament) {
	// Re-evaluate every poll: later preparation matches must also be checked in.
	return checkin_candidates(tournament)
		.flatMap((match) => match_players(match)
		.filter((player) => player.checked_in !== true && !player.now_playing_on_court && !player.now_tablet_on_court)
		.map((player) => ({ match_id: match._id, player_id: player.btp_id, match_num: match.setup.match_num })));
}

async function check_in_match(admin, match) {
	let count = 0;
	for (const player of match_players(match)) {
		if (player.checked_in === true) continue;
		await admin.send('match_player_check_in', {
			match_id: match._id,
			player_id: player.btp_id,
			checked_in: true,
			require_preparation: true,
		}, 30000);
		count++;
		await sleep(250);
	}
	return count;
}

function score_text(score) {
	return (score.network_score || []).map((set_score) => set_score.join(':')).join(' ');
}

function schedule_next_point(point_schedule, match_id, base_time, options, minimum_delay_ms = 0) {
	const delay_ms = Math.max(
		random_int(options.point_min_ms, options.point_max_ms, random_source(options, 'interval:' + match_id)),
		Math.max(0, Number(minimum_delay_ms) || 0),
	);
	point_schedule.set(match_id, base_time + delay_ms);
}

function match_score_probability(match_probabilities, match, options) {
	if (!match_probabilities.has(match._id)) {
		const min = options.score_probability_min;
		const max = options.score_probability_max;
		match_probabilities.set(match._id, min + random_source(options, 'bias:' + match._id)() * (max - min));
	}
	return match_probabilities.get(match._id);
}

function clamp_interval_ms(value) {
	return Math.max(50, Math.min(120000, Math.round(Number(value) || 0)));
}

function scale_speed(options, factor) {
	options.point_min_ms = clamp_interval_ms(options.point_min_ms * factor);
	options.point_max_ms = clamp_interval_ms(options.point_max_ms * factor);
	if (options.point_min_ms > options.point_max_ms) {
		[options.point_min_ms, options.point_max_ms] = [options.point_max_ms, options.point_min_ms];
	}
}

async function run(options, { AdminClient = AdminWsClient, TabletClient = BupV2Client, DisplayClient = DisplayV2Client,
	on_dashboard = () => {}, on_controls = () => {}, on_report = () => {}, keyboard = true } = {}) {
	const dashboard = new Dashboard(options);
	const admin = new AdminClient(options.base_url, options.tournament_key, dashboard);
	const probe = AdminClient === AdminWsClient ? new AdminWsClient(options.base_url, options.tournament_key, null, { handshake_timeout_ms: 3000 }) : null;
	let probe_timer = null, probe_busy = false, probe_stopped = false;
	async function poll_performance() {
		if (probe_stopped || stopped || probe_busy || !probe) return;
		probe_busy = true; const start = Date.now(); dashboard.performance.inflight_at = start;
		try {
			const result = await probe.send('debug_performance_stats', { probe: true, trace: options.processing_traces !== false,
				trace_cursor: dashboard.performance.trace_cursor || 0 }, 3000);
			if (!probe_stopped && !stopped) dashboard.performance.record(result.performance, Date.now() - start);
		} catch (error) { if (!probe_stopped && !stopped) dashboard.performance.fail(error); }
		finally { probe_busy = false; dashboard.performance.inflight_at = null; probe.changes.length = 0; probe.errors.length = 0; }
	}
	const bup_clients = new Map();
	const display_clients = new Map();
	const point_schedule = new Map();
	const match_probabilities = new Map();
	const repaired_match_ids = new Set();
	const duration_ms_ref = { value: 0 };
	let stopped = false;
	let paused = false;
	let pause_started_at = 0;
	let duration_ms = 0;
	let points = 0;
	let checkins = 0;
	let started_at = Date.now();
	let checkin_pacer = null;
	let initial_state = null;
	let server_offloading = null;
	const server_profiles = [];
	let failure = null;
	let phase = null;
	const phase_stats = [];
	let next_occupancy_sample_at = 0;
	let checkin_window_reported = false;
	let checkin_window = null;
	let last_no_active_log_at = 0;
	let next_checkin_at = Date.now();
	let cleanup_keyboard = () => {};

	function stop() {
		if (stopped) return;
		stopped = true;
		probe_stopped = true;
		if (probe_timer) clearInterval(probe_timer);
		if (probe) probe.close();
		admin.close();
		for (const client of bup_clients.values()) client.close();
		for (const client of display_clients.values()) client.close();
	}
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);

	function log_event(label, data = {}) {
		dashboard.log(label, data);
		if (dashboard.enabled && ['live-drill:start', 'live-drill:initial-state', 'live-drill:phase', 'live-drill:checkin-window', 'live-drill:report'].includes(label)) {
			console.log(label, JSON.stringify(data));
		}
	}

	function update_phase(now) {
		if (!options.scenario) return true;
		const next = benchmark_phase(now - started_at);
		if (phase?.name !== next?.name) {
			if (dashboard.phase_stats) dashboard.phase_stats.actual_end_ms = now - started_at;
			phase = next;
			if (phase) {
				const stats = {
					...phase, actual_start_ms: now - started_at, actual_end_ms: null,
					points: 0, score_updates: 0, finish_confirmations: 0,
					repair_score_updates: 0,
					player_checkins: 0, checkin_errors: 0, latencies: [], admin_latencies: [], occupied_courts: [], free_courts: [],
				};
				phase_stats.push(stats);
				dashboard.phase_stats = stats;
				set_paused(phase.idle);
				log_event('live-drill:phase', { ...phase, elapsed_ms: now - started_at, ts: now });
			}
		}
		return !!phase && !phase.idle;
	}

	async function check_in_benchmark(tournament) {
		const due = checkin_pacer.due(benchmark_checkin_requests(tournament), Date.now());
		for (let offset = 0; offset < due.length; offset += 4) {
			if (stopped || !update_phase(Date.now())) break;
			const stats = dashboard.phase_stats;
			await Promise.all(due.slice(offset, offset + 4).map(async (request) => {
				try {
					await admin.send('match_player_check_in', {
						match_id: request.match_id, player_id: request.player_id, checked_in: true,
						require_preparation: true,
					}, 30000);
					checkin_pacer.complete(request, Date.now(), true);
					checkins++;
					dashboard.checkins = checkins;
					stats.player_checkins++;
					log_event('live-drill:checkin:player', request);
				} catch (err) {
					if (is_stop_error(err)) return;
					checkin_pacer.complete(request, Date.now(), false);
					if (err.message === 'Match is no longer in preparation') {
						log_event('live-drill:checkin:skipped', { ...request, reason: 'no-longer-in-preparation' });
						return;
					}
					stats.checkin_errors++;
					log_event('live-drill:checkin:error', { ...request, error: err.message });
				}
			}));
		}
	}

	function reschedule_points_from_now() {
		const now = Date.now();
		for (const match_id of point_schedule.keys()) {
			schedule_next_point(point_schedule, match_id, now, options);
		}
	}

	function set_paused(next_paused) {
		if (paused === next_paused) return;
		paused = next_paused;
		dashboard.set_paused(paused);
		if (paused) {
			pause_started_at = Date.now();
			log_event('live-drill:paused', {});
			return;
		}
		const paused_ms = pause_started_at ? Date.now() - pause_started_at : 0;
		for (const [match_id, scheduled_at] of point_schedule.entries()) {
			point_schedule.set(match_id, scheduled_at + paused_ms);
		}
		next_checkin_at += paused_ms;
		pause_started_at = 0;
		log_event('live-drill:resumed', { paused_ms });
	}

	function speed_up() {
		scale_speed(options, 0.8);
		reschedule_points_from_now();
		log_event('live-drill:speed', {
			point_interval_ms: [options.point_min_ms, options.point_max_ms],
		});
	}

	function slow_down() {
		scale_speed(options, 1.25);
		reschedule_points_from_now();
		log_event('live-drill:speed', {
			point_interval_ms: [options.point_min_ms, options.point_max_ms],
		});
	}

	function setup_keyboard_controls() {
		if (!process.stdin.isTTY) return () => {};
		const stdin = process.stdin;
		const was_raw = stdin.isRaw;
		const was_paused = stdin.isPaused();
		stdin.setRawMode(true);
		stdin.resume();
		const on_data = (chunk) => {
			const key = chunk.toString('utf8');
			if (key === '\u0003' || key === 'q') {
				stop();
				return;
			}
			if (/^[1-4]$/.test(key)) { dashboard.view = Number(key); dashboard.render(); return; }
			if (options.scenario) return;
			if (key === 'p' || key === 'P' || key === ' ') {
				set_paused(!paused);
				return;
			}
			if (key === '+' || key === '=') {
				speed_up();
				return;
			}
			if (key === '-' || key === '_') {
				slow_down();
			}
		};
		stdin.on('data', on_data);
		return () => {
			stdin.off('data', on_data);
			if (!was_paused) {
				stdin.resume();
			} else {
				stdin.pause();
			}
			if (stdin.isTTY) stdin.setRawMode(!!was_raw);
		};
	}

	async function ensure_display_clients(tournament) {
		dashboard.update_tournament(tournament);
		const active_courts = (tournament.courts || [])
			.filter((court) => court.is_active !== false)
			.sort((a, b) => Number(a.num || 0) - Number(b.num || 0));
		for (const court of active_courts) {
			if (display_clients.has(court._id)) continue;
			const client = new DisplayClient(options.base_url, options.tournament_key, court, dashboard, options);
			display_clients.set(court._id, client);
			client.connect(admin).catch((err) => {
				if (is_stop_error(err)) return;
				dashboard.set_tv_status(court._id, false, err.message || String(err));
				log_event('live-drill:display:error', {
					court: court.num || court._id,
					court_id: court._id,
					error: err.message,
				});
			});
		}
	}

	try {
		on_dashboard(dashboard);
		on_controls({ stop,
			pause() { if (options.scenario) throw new Error('Die feste Testsequenz kann nicht manuell pausiert werden.'); set_paused(!paused); },
			faster() { if (options.scenario) throw new Error('Das Tempo ist in der festen Testsequenz unveränderlich.'); speed_up(); },
			slower() { if (options.scenario) throw new Error('Das Tempo ist in der festen Testsequenz unveränderlich.'); slow_down(); },
		});
		dashboard.start();
		if (keyboard) cleanup_keyboard = setup_keyboard_controls();
		await admin.connect();
		if (probe) { poll_performance(); probe_timer = setInterval(poll_performance, 1000); }
		const initial_tournament = await admin.tournament();
		server_offloading = initial_tournament.debug_offloading || null;
		server_profiles.push({ elapsed_ms: 0, profile: server_offloading });
		if (options.expected_matches && initial_tournament.matches.length !== options.expected_matches) {
			throw new Error(`Expected ${options.expected_matches} matches, found ${initial_tournament.matches.length}`);
		}
		const initial_requests = benchmark_checkin_requests(initial_tournament);
		initial_state = {
			matches: initial_tournament.matches.length,
			finished_matches: initial_tournament.matches.filter(match_finished).length,
			active_matches: active_matches(initial_tournament).length,
			active_courts: (initial_tournament.courts || []).filter((court) => court.is_active !== false).length,
			pending_player_checkins: initial_requests.length,
			pending_players: new Set(initial_requests.map((request) => String(request.player_id))).size,
			check_in_per_match: initial_tournament.btp_settings?.check_in_per_match,
			state_sha256: crypto.createHash('sha256').update(JSON.stringify({
				matches: initial_tournament.matches.slice().sort((a, b) => String(a._id).localeCompare(String(b._id)))
					.map((match) => ({ _id: match._id, btp_id: match.btp_id, setup: match.setup,
						network_score: match.network_score, presses: match.presses, end_ts: match.end_ts,
						team1_won: match.team1_won, btp_winner: match.btp_winner })),
				courts: initial_tournament.courts,
				check_in_per_match: initial_tournament.btp_settings?.check_in_per_match,
			})).digest('hex'),
		};
		started_at = Date.now();
		dashboard.started_at = started_at;
		checkin_pacer = new CheckinPacer(started_at);
		checkin_pacer.due(initial_requests, started_at);
		log_event('live-drill:start', {
			server_offloading,
			scenario: options.scenario,
			seed: options.seed,
			max_runtime_ms: options.max_runtime_ms,
			phases: options.scenario ? BENCHMARK_PHASES : null,
			tournament: options.tournament_key,
			base_url: options.base_url,
			point_interval_ms: [options.point_min_ms, options.point_max_ms],
			score_gap_ms: [options.score_gap_min_ms, options.score_gap_max_ms],
			checkin_interval_ms: options.scenario ? null : [options.checkin_min_ms, options.checkin_max_ms],
			checkin_mode: options.scenario ? 'continuous' : 'one-match-per-interval',
			checkin_count_unit: options.scenario ? 'player requests' : 'matches',
			score_all_active: options.score_all_active,
			checkin_states: ['preparation'],
			dashboard: options.dashboard,
		});
		log_event('live-drill:initial-state', initial_state);
		update_phase(started_at);

		while (!stopped && (!options.max_runtime_ms || Date.now() - started_at < options.max_runtime_ms)) {
			const tournament = await admin.tournament();
			if (stopped) break;
			const now = Date.now();
			const observed_profile = tournament.debug_offloading || null;
			if (JSON.stringify(observed_profile) !== JSON.stringify(server_profiles.at(-1).profile)) {
				const change = { elapsed_ms: now - started_at, profile: observed_profile };
				server_profiles.push(change); log_event('live-drill:server-profile-changed', change);
			}
			update_phase(now);
			if (options.scenario && !phase) break;
			await ensure_display_clients(tournament);
			update_scoreability_dashboard(tournament, dashboard);
			if (options.scenario && now >= next_occupancy_sample_at) {
				const courts = (tournament.courts || []).filter((court) => court.is_active !== false);
				const court_ids = new Set(courts.map((court) => court._id));
				const occupied = new Set((tournament.matches || [])
					.filter((match) => match.setup?.now_on_court && court_ids.has(match.setup.court_id))
					.map((match) => match.setup.court_id));
				dashboard.phase_stats.occupied_courts.push(occupied.size);
				dashboard.phase_stats.free_courts.push(courts.length - occupied.size);
				next_occupancy_sample_at = now + 1000;
			}
			if (options.scenario && !checkin_window_reported && now - started_at >= 120000) {
				checkin_window_reported = true;
				const pending_requests = benchmark_checkin_requests(tournament);
				checkin_window = {
					elapsed_ms: now - started_at, initial_requests: checkin_pacer.initial_requests,
					player_checkins: checkins, pending_player_checkins: pending_requests.length,
					pending_players: new Set(pending_requests.map((request) => String(request.player_id))).size,
				};
				log_event('live-drill:checkin-window', checkin_window);
			}
			duration_ms_ref.value = duration_ms;
			if (!paused) await repair_unscoreable_matches(tournament, bup_clients, options, dashboard, repaired_match_ids, duration_ms_ref, log_event, TabletClient,
				() => !stopped && update_phase(Date.now()) && !paused);
			duration_ms = duration_ms_ref.value;
			const active = active_matches(tournament);
			const active_ids = new Set(active.map((match) => match._id));
			for (const match_id of Array.from(point_schedule.keys())) {
				if (!active_ids.has(match_id)) {
					point_schedule.delete(match_id);
					match_probabilities.delete(match_id);
				}
			}
			for (const match of active) {
				if (!paused && !point_schedule.has(match._id)) {
					schedule_next_point(point_schedule, match._id, now, options);
					const probability = match_score_probability(match_probabilities, match, options);
					log_event('live-drill:match-bias', {
						match_num: match.setup?.match_num,
						event: match.setup?.event_name,
						match_id: match._id,
						team1_point_probability: round_probability(probability),
					});
				}
			}

			const due = paused ? [] : active.filter((match) => (point_schedule.get(match._id) || 0) <= now);
			const selected = options.score_all_active
				? due
				: (due.length > 0 ? [due[random_int(0, due.length - 1, random_source(options, 'selection'))]] : []);

			if (active.length === 0 && Date.now() - last_no_active_log_at > 10000) {
				last_no_active_log_at = Date.now();
				log_event('live-drill:point:none', { reason: 'no-active-match' });
			}

			for (const match of selected) {
				if (stopped || !update_phase(Date.now()) || paused) break;
				duration_ms += random_int(9000, 18000, random_source(options, 'duration:' + match._id));
				duration_ms_ref.value = duration_ms;
				const probability = match_score_probability(match_probabilities, match, options);
				const score = next_random_score(match, duration_ms, probability, random_source(options, 'score:' + match._id));
				if (!score) {
					schedule_next_point(point_schedule, match._id, Date.now(), options);
					continue;
				}
				schedule_next_point(
					point_schedule,
					match._id,
					Date.now(),
					options,
					has_visible_pause_timer(match, score) ? options.pause_visible_ms : 0,
				);
				const court_id = match.setup.court_id;
				if (!bup_clients.has(court_id)) {
					bup_clients.set(court_id, new TabletClient(options.base_url, options.tournament_key, court_id, options, dashboard));
				}
				const sent = await bup_clients.get(court_id).score(match, score, () => {
					if (stopped || !update_phase(Date.now()) || paused) return false;
					dashboard.record_score_sent(score);
					return true;
				});
				if (sent === false) continue;
				if (!score.finish_confirmed) points++;
				if (dashboard.phase_stats) {
					if (score.finish_confirmed) dashboard.phase_stats.finish_confirmations++;
					else dashboard.phase_stats.points++;
				}
				dashboard.points = points;
				log_event(score.finish_confirmed ? 'live-drill:finish-confirm' : 'live-drill:point', {
					trace_id: score.debug_trace_id || null,
					match_num: match.setup.match_num,
					event: match.setup.event_name,
					court: court_id,
					score: score_text(score),
					finished: !!score.finish_confirmed,
					team1_point_probability: round_probability(probability),
				});
				if (options.score_gap_max_ms > 0) {
					await sleep(random_int(options.score_gap_min_ms, options.score_gap_max_ms, random_source(options, 'gap:' + match._id)));
				}
			}

			if (options.scenario) {
				if (!stopped && update_phase(Date.now())) await check_in_benchmark(tournament);
			} else if (!paused && Date.now() >= next_checkin_at) {
				const candidate = checkin_candidates(tournament, options)[0];
				if (!candidate) {
					log_event('live-drill:checkin:none', { reason: 'no-preparation-match' });
				} else {
					try {
						const players = await check_in_match(admin, candidate);
						checkins++;
						dashboard.checkins = checkins;
						log_event('live-drill:checkin', {
							match_num: candidate.setup.match_num,
							event: candidate.setup.event_name,
							id: candidate._id,
							players,
						});
					} catch (err) {
						log_event('live-drill:checkin:error', {
							match_num: candidate.setup?.match_num,
							event: candidate.setup?.event_name,
							id: candidate._id,
							error: err.message,
						});
					}
				}
				next_checkin_at = Date.now() + random_int(options.checkin_min_ms, options.checkin_max_ms, random_source(options, 'checkin'));
			}

			await sleep(250);
		}
	} catch (err) {
		if (!is_stop_error(err) && !(stopped && is_admin_closed_error(err))) {
			failure = err.message;
			throw err;
		}
	} finally {
		process.off('SIGINT', stop);
		process.off('SIGTERM', stop);
		if (cleanup_keyboard) cleanup_keyboard();
		probe_stopped = true;
		if (probe_timer) clearInterval(probe_timer);
		for (const client of bup_clients.values()) client.close();
		for (const client of display_clients.values()) client.close();
		admin.close();
		// Stop generating tournament traffic, then collect the last completions.
		// This is a bounded, read-only tail, not a wait for every server task.
		if (probe) {
			const tail_deadline = Date.now() + 1200;
			try {
				for (let batch = 0; batch < 8 && Date.now() < tail_deadline; batch++) {
					const start = Date.now();
					const result = await probe.send('debug_performance_stats', { probe: true, trace_cursor: dashboard.performance.trace_cursor || 0 },
						Math.max(1, Math.min(500, tail_deadline - start)));
					dashboard.performance.record(result.performance, Date.now() - start);
					if (!result.performance.processing?.remaining) break;
				}
			} catch (error) { dashboard.performance.fail(error); }
			finally { probe.close(); }
		}
		dashboard.stop();
		const runtime_ms = Date.now() - started_at;
		if (dashboard.phase_stats) dashboard.phase_stats.actual_end_ms = runtime_ms;
		const report = {
			server_offloading,
			server_profiles, mixed_server_profiles: server_profiles.length > 1,
			scenario: options.scenario, seed: options.seed,
			latency_matching: 'display-side-score',
			admin_latency_matching: 'admin-score-event:match+team-score+last-press+finish',
			latency_endpoint: 'client-websocket-message-received-before-json-parse',
			started_at: new Date(started_at).toISOString(), runtime_ms,
			stop_reason: failure ? 'error' : stopped ? 'interrupted' : 'completed', failure,
			initial_state, checkin_window, points, checkins,
			checkin_count_unit: options.scenario ? 'player requests' : 'matches',
			settings: {
				tournament: options.tournament_key, base_url: options.base_url,
				point_interval_ms: [options.point_min_ms, options.point_max_ms],
				score_gap_ms: [options.score_gap_min_ms, options.score_gap_max_ms],
				pause_visible_ms: options.pause_visible_ms, score_all_active: options.score_all_active,
				score_probability: [options.score_probability_min, options.score_probability_max],
			},
			tablet_to_tv_ms: dashboard.tv_latency_stats.summary(dashboard.score_updates),
			tablet_to_admin_ms: dashboard.admin_latency_stats.summary(dashboard.score_updates),
			payload_types: { tv: dashboard.payload_type_stats(), admin: dashboard.admin_payload_type_stats() },
			server_performance: dashboard.performance.report(),
			point_receptions: [...dashboard.receipt_traces.values()],
			test_events: dashboard.event_archive,
			diagnostic_archive: { dropped_point_receptions: dashboard.receipt_traces_dropped, dropped_test_events: dashboard.events_dropped,
				limits: { point_receptions: 5000, test_events: 10000 }, processing_traces_requested: options.processing_traces !== false },
			reception_expired: dashboard.expired,
			phases: phase_stats.map(({ latencies, admin_latencies, occupied_courts, free_courts, ...stats }) => ({
				...stats, tablet_to_tv_ms: latency_summary(latencies, stats.score_updates),
				tablet_to_admin_ms: latency_summary(admin_latencies, stats.score_updates),
				occupied_courts: sample_summary(occupied_courts), free_courts: sample_summary(free_courts),
			})),
		};
		if (options.report_path) {
			try {
				await fs.promises.writeFile(options.report_path, JSON.stringify(report, null, 2) + '\n');
				log_event('live-drill:report', { path: options.report_path });
			} catch (err) {
				console.error('live-drill:report:error', err.message);
				process.exitCode = 1;
			}
		}
		on_report(report);
		if (!options.quiet) console.log('live-drill:stop', JSON.stringify({
			runtime_ms,
			points,
			checkins,
			stop_reason: report.stop_reason,
			tablet_to_tv_ms: report.tablet_to_tv_ms,
			tablet_to_admin_ms: report.tablet_to_admin_ms,
			payload_types: report.payload_types,
			server_performance: report.server_performance,
			reception_expired: report.reception_expired,
			phases: report.phases,
			display_latency_avg_1m_ms: dashboard.avg_latency(),
			admin_latency_avg_1m_ms: dashboard.avg_latency(null, 'admin'),
		}));
	}
}

if (require.main === module) {
	run(parse_args(process.argv.slice(2))).catch((err) => {
		if (is_stop_error(err)) return;
		console.error('live-drill:error', err.stack || err.message || String(err));
		process.exitCode = 1;
	});
}

module.exports = { parse_args, run, benchmark_checkin_requests, next_random_score, schedule_next_point, Dashboard, AdminWsClient };
