'use strict';

const { reception } = require('../live_drill_performance');
const { fields } = require('./options');

function snapshot(dashboard) {
	dashboard.prune_latencies();
	const monitor = dashboard.performance, latest = monitor.history.at(-1);
	const receipts = reception(dashboard), status = monitor.status();
	const receipt_warnings = receipts.filter(row => row.oldest_ms > 1000 || row.expired > 0 || (row.count >= 20 && row.p95 > 100));
	return {
		ts: Date.now(), started_at: dashboard.started_at, runtime_ms: Date.now() - dashboard.started_at,
		paused: dashboard.paused, points: dashboard.points, checkins: dashboard.checkins,
		settings: { ...Object.fromEntries(fields.map(field => [field.key, dashboard.options[field.key] ?? ''])), scenario: dashboard.options.scenario },
		phase: dashboard.phase_stats ? { name: dashboard.phase_stats.name, start_ms: dashboard.phase_stats.start_ms,
			end_ms: dashboard.phase_stats.end_ms, idle: dashboard.phase_stats.idle } : null,
		status: { level: status.level === 'UNKNOWN' ? 'UNKNOWN' : status.level === 'WARN' || receipt_warnings.length ? 'WARN' : 'OK',
			reasons: [...status.reasons, ...receipt_warnings.map(row => row.target + (row.expired ? ': expired unmatched receipts' : ': point reception delayed'))] },
		receipts, cumulative: { tv: dashboard.tv_latency_stats.summary(dashboard.score_updates), admin: dashboard.admin_latency_stats.summary(dashboard.score_updates) },
		payloads: { tv: dashboard.payload_type_stats(), admin: dashboard.admin_payload_type_stats() },
		queues: monitor.rows(), event_loop: latest?.snapshot.event_loop || null,
		probe: { age_ms: monitor.last_at ? Date.now() - monitor.last_at : null, rtt_ms: latest?.rtt_ms ?? null, failures: monitor.failures },
		server_id: monitor.server_id || null, drain: monitor.drain,
		processing: latest?.snapshot.processing ? { ...latest.snapshot.processing,
			completed: [...monitor.traces.values()].filter(trace => trace.server_id === monitor.server_id).slice(-80)
				.map(trace => ({ ...trace, reception: dashboard.receipt_traces.get(trace.trace_id) || null })) } : null,
		unobserved_db: (latest?.snapshot.database || []).filter(row => row.observed === false).map(row => row.name),
		lock: latest ? { pending_tasks: latest.snapshot.lock.pending_tasks, active_tasks: latest.snapshot.lock.active_tasks } : null,
		buffered_bytes: latest?.snapshot.outgoing.buffered_bytes ?? null,
		courts: dashboard.courts.map(court => {
			const row = dashboard.ensure_row(court._id), state = row.state || {};
			const team = side => {
				const value = (state.teams || []).find(entry => entry.side === side);
				return (value?.players || []).join(' / ') || value?.name || '—';
			};
			return { id: court._id, num: court.num, name: court.name, tv_connected: row.tv_connected, error: row.error,
				match: state.match?.id || null, status: state.match?.status || state.view?.screen || null,
				teams: [team('left'), team('right')], score: [...(state.score?.finished_sets || []), state.score?.current_set]
					.filter(Boolean).map(set => set.left + ':' + set.right).join(' '),
				tablet_battery: row.tablet_battery, tablet_charging: row.tablet_charging,
				tv_last_ms: row.last_latency_ms, admin_last_ms: row.last_admin_latency_ms,
				tv_mean_ms: dashboard.avg_latency(court._id, 'tv', false), admin_mean_ms: dashboard.avg_latency(court._id, 'admin', false),
				updates: row.update_count, payload_type: row.last_payload_type, drill_status: row.drill_status };
		}),
		events: [...monitor.events.map(event => ({ ...event, kind: 'server' })),
			...dashboard.events.map(event => ({ ts: event.ts, label: event.label, details: event.data, kind: 'test' }))]
			.sort((a, b) => b.ts - a.ts).slice(0, 100),
	};
}

module.exports = snapshot;
