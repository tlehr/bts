'use strict';

const { monitorEventLoopDelay, performance } = require('perf_hooks');
const registry = require('./registry');
const id = require('../offload/profile').snapshot().server_id;
let loop, gc, previous, idle_timer, last_at = 0, last_loop = null;

function snapshot(app, sockets, key, trace_cursor) {
	const now = Date.now();
	clearTimeout(idle_timer);
	idle_timer = setTimeout(() => { loop.disable(); gc.stop(); loop = gc = null; last_loop = null; }, 10000);
	idle_timer.unref();
	if (!loop) {
		loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
		gc = require('./garbage_collection')();
		previous = performance.eventLoopUtilization(); last_at = now;
	}
	if (now - last_at >= 1000) {
		const current = performance.eventLoopUtilization();
		const measured = loop.count > 0;
		last_loop = { window_ms: now - last_at, measured,
			p95_ms: measured ? loop.percentile(95) / 1e6 : null,
			max_ms: measured ? loop.max / 1e6 : null,
			utilization: performance.eventLoopUtilization(current, previous).utilization };
		previous = current; last_at = now; loop.reset();
	}
	const lock = require('../update_queue').stats();
	const database = Object.entries(app.db || {}).filter(([, store]) => store?.executor)
		.map(([name, store]) => ({ name, ...require('../database_tasks').health(store) }));
	const outgoing = sockets.filter(ws => !ws.performance_probe && ws.outbox_stats)
		.map(ws => ({ ...ws.outbox_stats(), buffered_bytes: ws.bufferedAmount || 0 }));
	return { protocol_version: 2, server_id: id, ts: now, scope: 'server-wide', tournament_key: key,
		memory: { ...process.memoryUsage(), uptime_s: Math.round(process.uptime()) },
		lock, database, workers: registry.snapshots().filter(row => row.enqueued_count > 0),
		event_loop: last_loop ? { ...last_loop, gc: gc.snapshot(now) } : null,
		processing: require('./traces').snapshot(trace_cursor),
		admin_encoding_cache: require('../admin_response/match_cache').stats(),
		outgoing: { sockets: outgoing.length, pending: outgoing.reduce((n, s) => n + s.pending, 0),
			active: outgoing.reduce((n, s) => n + s.active, 0),
			oldest_pending_ms: Math.max(0, ...outgoing.map(s => s.oldest_pending_ms)),
			buffered_bytes: outgoing.reduce((n, s) => n + s.buffered_bytes, 0) } };
}

module.exports = { snapshot };
