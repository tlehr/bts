'use strict';

const { LatencyStats } = require('./live_drill_metrics');
const age = value => value == null ? '-' : value < 1000 ? Math.round(value) + 'ms' : (value / 1000).toFixed(1) + 's';
const fixed = value => value == null ? '-' : value.toFixed(1);
const spark = values => {
	const max = Math.max(1, ...values);
	return values.map(value => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(value / max * 7))]).join('');
};

function queues(snapshot) {
	const lock = snapshot.lock;
	return [
		{ name: 'Locks', pending: lock.queue_length, active: lock.active_tasks.length, ...lock,
			active_task: lock.active_tasks[0]?.task, active_ms: Math.max(0, ...lock.active_tasks.map(task => task.runtime_ms || 0)) },
		...snapshot.database.map(row => ({ ...row, name: 'DB ' + row.name })),
		...snapshot.workers.map(row => ({ ...row, name: 'Worker ' + row.name, name_id: row.id })),
		{ name: 'Admin send', ...snapshot.outgoing },
	].filter(row => row.observed !== false).map(row => ({ ...row, key: row.name + ':' + (row.name_id || '') }));
}

class PerformanceHistory {
	constructor() {
		this.history = []; this.runs = []; this.events = []; this.seen = new Set();
		this.error = null; this.failures = 0; this.inflight_at = null; this.drain = null;
		this.trace_cursor = 0; this.traces = new Map(); this.series = []; this.archive_events = [];
		this.archive_dropped = { samples: 0, traces: 0, events: 0 }; this.trace_gaps = 0;
	}
	record(snapshot, rtt_ms, now = Date.now()) {
		if (!snapshot?.server_id || !snapshot.lock || !Array.isArray(snapshot.database) || !Array.isArray(snapshot.workers)) {
			throw new Error('Server provides no compatible performance telemetry');
		}
		if (this.server_id !== snapshot.server_id) {
			if (this.server_id) this.event('Server restarted: queue rates reset', {}, now);
			if (this.server_id) this.drain = null;
			this.server_id = snapshot.server_id; this.history = []; this.seen.clear();
			this.trace_cursor = 0;
			this.runs.push({ server_id: snapshot.server_id, samples: 0, peak_pending: {}, peak_oldest_ms: {},
				max_event_loop_ms: 0, max_probe_rtt_ms: 0 });
		}
		this.error = null; this.last_at = now;
		const processing = snapshot.processing;
		if (processing) {
			this.trace_cursor = processing.cursor;
			if (processing.gap) this.trace_gaps++;
			for (const trace of processing.completed || []) {
				const key = snapshot.server_id + ':' + trace.id;
				this.traces.delete(key); this.traces.set(key, { ...trace, server_id: snapshot.server_id });
				if (this.traces.size > 5000) { this.traces.delete(this.traces.keys().next().value); this.archive_dropped.traces++; }
			}
			// Keep one set of active spans and aggregates, rather than copying the
			// entire completion batch into every rolling history sample.
			snapshot = { ...snapshot, processing: { ...processing, completed: [] } };
		}
		const sample = { ts: now, rtt_ms, snapshot, queues: queues(snapshot) };
		this.series.push({ ts: now, server_ts: snapshot.ts, server_id: snapshot.server_id, trace_session: processing?.session, rtt_ms,
			event_loop: snapshot.event_loop,
			queues: sample.queues.map(row => ({ key: row.key, name: row.name, pending: row.pending, active: row.active,
				oldest_pending_ms: row.oldest_pending_ms, enqueued_count: row.enqueued_count, completed_count: row.completed_count,
				failed_count: row.failed_count, rejected_count: row.rejected_count })),
			stages: (processing?.stages || []).map(row => ({ key: row.key, type: row.type, kind: row.kind, name: row.name, count: row.count, last: row.last, p95: row.p95 })) });
		if (this.series.length > 43200) { this.series.shift(); this.archive_dropped.samples++; }
		const previous = this.history.at(-1);
		this.history.push(sample);
		this.history = this.history.filter(entry => entry.ts >= now - 300000);
		// Also bound unusually fast/manual sampling and long-lived reports.
		if (this.history.length > 301) this.history.shift();
		const run = this.runs.at(-1); run.samples++;
		run.max_probe_rtt_ms = Math.max(run.max_probe_rtt_ms, rtt_ms);
		run.max_event_loop_ms = Math.max(run.max_event_loop_ms, snapshot.event_loop?.max_ms || 0);
		for (const row of sample.queues) {
			run.peak_pending[row.key] = Math.max(run.peak_pending[row.key] || 0, row.pending);
			run.peak_oldest_ms[row.key] = Math.max(run.peak_oldest_ms[row.key] || 0, row.oldest_pending_ms || 0);
			const prior = previous?.queues.find(other => other.key === row.key);
			if (prior && ((row.failed_count || 0) > (prior.failed_count || 0) || (row.rejected_count || 0) > (prior.rejected_count || 0))) {
				this.event('Queue failures: ' + row.name, { failed: row.failed_count, rejected: row.rejected_count }, now);
			}
		}
		for (const task of snapshot.lock.recent_tasks || []) {
			if (this.seen.has(task.id)) continue;
			this.seen.add(task.id);
			if (task.failed || task.wait_ms >= 100 || task.runtime_ms >= 500) this.event('Lock task: ' + task.task,
				{ wait_ms: task.wait_ms, runtime_ms: task.runtime_ms, failed: task.failed, blocked_by: task.wait_blocked_by }, task.ts || now);
		}
		if (this.seen.size > 200) this.seen = new Set((snapshot.lock.recent_tasks || []).map(task => task.id));
		if (this.drain && this.drain.finished_ms == null) {
			if (sample.queues.every(row => row.pending === 0)) {
				this.drain.clear_since ??= now;
				if (now - this.drain.clear_since >= 3000) {
					this.drain.finished_ms = this.drain.clear_since - this.drain.started;
					this.event('Queues drained during pause', { elapsed_ms: this.drain.finished_ms }, now);
				}
			} else this.drain.clear_since = null;
		}
	}
	event(label, details, ts = Date.now()) {
		this.archive_events.push({ ts, label, details });
		if (this.archive_events.length > 10000) { this.archive_events.shift(); this.archive_dropped.events++; }
		this.events.unshift({ ts, label, details }); this.events.length = Math.min(50, this.events.length);
	}
	fail(error) { this.error = error.message; this.failures++; }
	unavailable(reason) { this.unavailable_reason = reason; }
	pause(paused, now = Date.now()) {
		if (paused) this.drain = { started: now, clear_since: null, finished_ms: null };
	}
	rows(now = Date.now()) {
		const latest = this.history.at(-1);
		if (!latest) return [];
		return latest.queues.map(row => {
			const samples = this.history.filter(entry => entry.ts >= now - 60000)
				.map(entry => ({ ts: entry.ts, row: entry.queues.find(other => other.key === row.key) })).filter(entry => entry.row);
			const first = samples[0], seconds = first ? (latest.ts - first.ts) / 1000 : 0;
			const rate = field => seconds > 0 && row[field] != null && row[field] >= first.row[field]
				? (row[field] - first.row[field]) / seconds : null;
			const incoming = rate('enqueued_count'), completed = rate('completed_count'), failed = rate('failed_count');
			return { ...row, incoming, done: completed == null ? null : completed + (failed || 0),
				delta: first ? row.pending - first.row.pending : 0,
				trend: spark(this.history.filter(entry => entry.ts >= now - 300000)
					.filter((entry, i) => i % 10 === 0 || entry === latest)
					.map(entry => entry.queues.find(other => other.key === row.key)?.pending || 0)) };
		});
	}
	status(now = Date.now()) {
		if (this.unavailable_reason) return { level: 'UNKNOWN', reasons: [this.unavailable_reason] };
		if (!this.last_at || now - this.last_at + this.history.at(-1).rtt_ms > 5000 || this.error) return { level: 'UNKNOWN', reasons: [this.error || 'No fresh server telemetry'] };
		if (this.history.at(-1).snapshot.database.some(row => row.observed === false)) return { level: 'UNKNOWN', reasons: ['Some DB queues lack telemetry'] };
		const recent = this.history.filter(entry => entry.ts >= now - 30000), warnings = [];
		for (const row of this.rows(now)) {
			const values = recent.map(entry => ({ ts: entry.ts, row: entry.queues.find(other => other.key === row.key) })).filter(entry => entry.row);
			const last_clear = values.findLastIndex(entry => entry.row.pending === 0 || entry.row.oldest_pending_ms <= 1000);
			const sustained = values.slice(last_clear + 1);
			if (sustained.length && now - sustained[0].ts >= 10000) {
				warnings.push(row.name + ': waiting >1s for at least 10s');
			} else if (values.length && now - values[0].ts >= 29000 && row.pending >= values[0].row.pending + 5 && values.every(entry => entry.row.pending > 0)) {
				warnings.push(row.name + ': backlog growing over 30s');
			}
		}
		const loop = recent.slice(recent.findLastIndex(entry => !(entry.snapshot.event_loop?.p95_ms > 100)) + 1);
		if (loop.length && now - loop[0].ts >= 10000) warnings.push('Event loop p95 >100ms for 10s');
		return { level: warnings.length ? 'WARN' : 'OK', reasons: warnings.length ? warnings : ['No sustained backlog observed'] };
	}
	report() {
		return { scope: 'server-wide', available: !this.unavailable_reason && !!this.last_at, unavailable_reason: this.unavailable_reason || null, sample_interval_ms: 1000, history_window_ms: 300000,
			runs: this.runs, probe_failures: this.failures, events: this.events, drain: this.drain,
			latest_status: this.status(), latest: this.history.at(-1) || null,
			series: this.series, traces: [...this.traces.values()], diagnostic_events: this.archive_events,
			trace_gaps: this.trace_gaps, archive_dropped: this.archive_dropped,
			archive_limits: { samples: 43200, traces: 5000, events: 10000 } };
	}
}

function reception(dashboard, now = Date.now()) {
	return [['TV', dashboard.latencies, dashboard.pending_by_court, dashboard.expired.tv],
		['Admin', dashboard.admin_latencies, dashboard.pending_admin_by_court, dashboard.expired.admin]].map(([target, entries, map, expired]) => {
		const metrics = new LatencyStats(); for (const entry of entries) metrics.add(entry.ms);
		const pending = [...map.values()].flat();
		return { target, ...metrics.summary(), pending: pending.length, expired,
			oldest_ms: pending.length ? now - Math.min(...pending.map(entry => entry.ts)) : 0 };
	});
}

function render_performance(dashboard, detailed = false) {
	const monitor = dashboard.performance, rows = monitor.rows(), status = monitor.status();
	const endpoints = reception(dashboard);
	const warnings = endpoints.filter(row => row.oldest_ms > 1000 || row.expired > 0 || (row.count >= 20 && row.p95 > 100));
	const level = status.level === 'UNKNOWN' ? 'UNKNOWN' : status.level === 'WARN' || warnings.length ? 'WARN' : 'OK';
	const lines = [level + ' | ' + [...status.reasons, ...warnings.map(row => row.target + (row.expired ? ': expired unmatched receipts' : ': point reception delayed'))].join(' | ')];
	const latest = monitor.history.at(-1), loop = latest?.snapshot.event_loop;
	lines.push('Probe age ' + age(monitor.last_at ? Date.now() - monitor.last_at : null) +
		' | RTT ' + age(latest?.rtt_ms) + ' | Server event loop p95/max ' + age(loop?.p95_ms) + '/' + age(loop?.max_ms) +
		' | Busy ' + (loop ? Math.round(loop.utilization * 100) + '%' : '-'));
	lines.push('Reception last 1m       Samples      p95      p99   Pending    Oldest   Expired*');
	for (const row of endpoints) lines.push(row.target.padEnd(23) + String(row.count).padStart(7) + age(row.p95).padStart(9) + age(row.p99).padStart(9) +
		String(row.pending).padStart(10) + age(row.oldest_ms).padStart(10) + String(row.expired).padStart(11));
	if (detailed) {
		lines.push('Queues: server-wide; input/done per second and delta over up to 1m; trend up to 5m (each row scaled)');
		lines.push('Queue                         Wait   Run    Oldest     In/s   Done/s  Delta    Peak  Trend');
		for (const row of rows) lines.push(row.name.slice(0, 29).padEnd(29) + String(row.pending).padStart(5) + String(row.active).padStart(6) +
			age(row.oldest_pending_ms).padStart(10) + fixed(row.incoming).padStart(9) + fixed(row.done).padStart(9) + String(row.delta).padStart(7) +
			String(row.high_watermark ?? '-').padStart(8) + '  ' + row.trend);
		lines.push('Admin transport buffered: ' + (latest?.snapshot.outgoing.buffered_bytes ?? '-') + ' bytes');
		const lock = latest?.snapshot.lock;
		for (const task of (lock?.pending_tasks || []).slice(0, 5)) lines.push('Waiting ' + task.task + ' ' + age(task.wait_ms) +
			' | blocked by ' + (task.blocked_by || []).map(blocker => blocker.task).join(', ') + ' | ' + JSON.stringify(task.locks));
		for (const row of rows.filter(row => row.active && row.active_task)) lines.push('Running ' + row.name + ': ' + row.active_task + ' ' + age(row.active_ms));
	} else {
		lines.push('Queues waiting: ' + (rows.length ? rows.filter(row => row.pending).map(row => row.name + '=' + row.pending + ' (' + age(row.oldest_pending_ms) + ')').join(' | ') || '0' : 'unknown'));
	}
	if (monitor.drain) lines.push('Last pause: queues ' + (monitor.drain.finished_ms == null ? 'not yet clear for 3s' : 'drained after ' + age(monitor.drain.finished_ms)));
	lines.push('*Expired = no matching reception within 30s; not proof of packet loss. OK describes sampled data, not a capacity guarantee.');
	return lines;
}

module.exports = { PerformanceHistory, queues, reception, render_performance };
