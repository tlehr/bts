'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { performance } = require('perf_hooks');
const storage = new AsyncLocalStorage();
const round = value => Math.round(Math.max(0, value) * 10) / 10;
const LIMITS = { active: 64, completed: 500, spans: 160, db_spans: 80, summaries: 32, stages: 576, stages_per_type: 96, recent_samples: 256, response: 80 };
let until = 0, sequence = 0, revision = 0, session = 0, dropped = 0, overwritten = 0, unaggregated = 0, evicted_revision = 0;
const active = new Map(), completed = [], stages = new Map();
const span_state = new WeakMap();
const TYPES = ['point', 'finish', 'sync', 'calling', 'admin', 'other'];
const is_db = row => row.kind.startsWith('db_');
function db_name(name) {
	const [collection, task = 'other'] = name.split(':');
	const operation = ['find', 'findOne', 'insert', 'update', 'remove', 'compact', 'loadDatabase'].includes(task) ? task
		: /score_context|sync_snapshot|overview|read/.test(task) ? 'model_read' : 'other';
	return collection + ':' + operation;
}
function summarize(record, row) {
	const state = span_state.get(record), key = row.kind + ':' + db_name(row.name);
	let summary = state.summaries.get(key);
	if (!summary) {
		const name = state.summaries.size < LIMITS.summaries - 1 ? db_name(row.name) : 'other DB tasks';
		const grouped_key = name === 'other DB tasks' ? 'overflow' : key;
		summary = state.summaries.get(grouped_key);
		if (!summary) { summary = { name, kind: name === 'other DB tasks' ? 'db_summary' : row.kind, count: 0, total_ms: 0, max_ms: 0, failed: 0 };
			state.summaries.set(grouped_key, summary); record.span_summaries.push(summary); }
	}
	summary.count++; summary.total_ms = round(summary.total_ms + (row.duration_ms || 0));
	summary.failed += row.status === 'error' ? 1 : 0;
	if ((row.duration_ms || 0) >= summary.max_ms) { summary.max_ms = row.duration_ms || 0;
		summary.slowest = { ...row }; }
	record.summarized_spans++;
}
function retain(record, row, critical) {
	if (record.spans.length < LIMITS.spans) { record.spans.push(row); return true; }
	const candidates = record.spans.filter(other => is_db(other) && other.status !== 'running');
	const cheapest = candidates.reduce((best, other) => !best || other.duration_ms < best.duration_ms ? other : best, null);
	if (!cheapest || !critical && row.duration_ms <= cheapest.duration_ms) return false;
	record.spans.splice(record.spans.indexOf(cheapest), 1); summarize(record, cheapest);
	record.spans.push(row); return true;
}

// No payloads, player names or query contents. The lease is refreshed only by
// explicit dashboard requests; ordinary production work does not start traces.
function enable(now = Date.now()) {
	if (now > until && active.size === 0) { session++; completed.length = 0; stages.clear(); dropped = 0; overwritten = 0; unaggregated = 0; evicted_revision = revision; }
	until = now + 10000;
}
function enabled() { return Date.now() <= until; }
function capture() { return storage.getStore(); }
function with_context(context, work) { return storage.run(context, work); }
function clean(details = {}) {
	const result = {};
	for (const [key, value] of Object.entries(details)) {
		if (!['tournament_key', 'court_id', 'match_id', 'trace_id', 'locks', 'conflicting_locks', 'blockers', 'queue_id',
			'collection', 'execution', 'skipped', 'reason', 'attempt', 'changes', 'match_locks', 'valid', 'effects',
			'deferred_jobs', 'worker_ms', 'input_wait_ms', 'return_delivery_ms', 'dispatch_ms', 'request_id', 'ctype',
			'before_callback_ms', 'callback_ms', 'persistence_kind', 'persistence_ms', 'copied_records',
			'refresh_groups', 'refresh_operations', 'refresh_queue_wait_ms', 'refresh_apply_ms', 'refresh_max_group_ms',
			'refresh_foreground_wait_ms', 'allocation_scope', 'ordering_unchanged_notifications', 'recipients',
			'direct_match_locks', 'additional_match_locks', 'dependency_player_matches', 'dependency_court_matches',
			'dependency_effect_matches', 'allocation_reasons', 'bounded_match_groups', 'bounded_match_changes',
			'prepared_match_writes', 'prepared_match_fallbacks', 'serialization_ms', 'storage_wait_ms',
			'storage_start_ts', 'storage_end_ts', 'storage_bytes', 'read_source', 'compaction_read_bypassed',
			'compaction_read_decision', 'model_read_bypassed', 'model_read_decision', 'db_queue_wait_ms', 'read_ms', 'queue_depth_at_enqueue',
			'compaction_pending_at_enqueue', 'snapshot_encode_ms', 'stage_write_ms', 'commit_queue_wait_ms',
			'commit_start_ts', 'commit_end_ts', 'commit_locked_ms', 'input_documents', 'catchup_documents',
			'commit_documents'].includes(key)) continue;
		if (typeof value === 'string') result[key] = value.slice(0, 200);
		else if (typeof value === 'number' || typeof value === 'boolean' || value === null) result[key] = value;
		else if (Array.isArray(value)) { result[key] = value.slice(0, 40).map(item => typeof item === 'string' ? item.slice(0, 200)
			: key === 'blockers' ? { id: item.id, task: String(item.task || '').slice(0, 100), state: item.state,
				locks: (item.locks || []).slice(0, 40), conflicting_locks: (item.conflicting_locks || []).slice(0, 40),
				operation_id: item.operation_id || null, trace_id: item.trace_id || null,
				phase: String(item.phase || '').slice(0, 40), elapsed_ms: item.elapsed_ms,
				persistence_kind: item.persistence_kind || null } : null);
			if (value.length > 40) result[key + '_truncated'] = value.length - 40;
		}
	}
	return result;
}
function classify(name) {
	if (/score_update/.test(name)) return 'point';
	if (/sync|fetch/.test(name)) return 'sync';
	if (/preparation|auto_call|check_in/.test(name)) return 'calling';
	return 'other';
}
function publish(record) {
	record.revision = ++revision;
	// A deferred child can finish after its initiating handler. Send the updated
	// trace again, retaining its identity and replacing the older export entry.
	const index = completed.indexOf(record); if (index !== -1) completed.splice(index, 1);
	completed.push(record);
	if (completed.length > LIMITS.completed) { evicted_revision = completed.shift().revision; overwritten++; }
}
async function operation(name, metadata, work, independent = false) {
	const parent = capture();
	if (parent?.suppressed) return work();
	if (parent && !independent || !enabled()) return work();
	if (active.size >= LIMITS.active) { dropped++; return with_context({ suppressed: true }, work); }
	const type = metadata.type || classify(name);
	const record = { id: ++sequence, session, name, type: TYPES.includes(type) ? type : 'other', ...clean(metadata),
		start_ts: Date.now(), status: 'running', spans: [], span_summaries: [], summarized_spans: 0, pending_spans: 0, dropped_spans: 0 };
	span_state.set(record, { sequence: 0, db_count: 0, summaries: new Map() });
	if (parent) record.parent_operation_id = parent.record.id;
	const mono = performance.now(); active.set(record.id, record);
	return with_context({ record, span_id: null, lock_state: null }, async () => {
		try {
			const value = await work(); if (record.status === 'running') record.status = 'ok';
			if (value?.skipped) { record.skipped = true; record.reason = value.reason; }
			return value;
		} catch (error) { record.status = 'error'; throw error; }
		finally { record.ts = Date.now(); record.duration_ms = round(performance.now() - mono); active.delete(record.id);
			aggregate(record, { name, kind: 'operation', duration_ms: record.duration_ms, status: record.status }); publish(record); }
	});
}
function begin(name, kind, details = {}) {
	const context = capture();
	if (!context || context.suppressed) return null;
	if (!enabled()) { context.record.lease_expired = true; return null; }
	const record = context.record;
	const state = span_state.get(record);
	const row = { id: ++state.sequence, parent_id: context.span_id, name: String(name).slice(0, 120), kind,
		start_ts: Date.now(), status: 'running', held_locks: context.lock_state?.active ? context.lock_state.locks : [], ...clean(details) };
	row.offset_ms = Math.max(0, row.start_ts - record.start_ts);
	if (context.lock_state?.active && context.lock_state.truncated) row.held_locks_truncated = context.lock_state.truncated;
	const db = is_db(row), detailed = !db || state.db_count++ < LIMITS.db_spans;
	const retained = detailed && retain(record, row, !db);
	if (!retained && !db) { record.dropped_spans++; return null; }
	record.pending_spans++;
	if (!active.has(record.id)) publish(record);
	return { row, context, mono: performance.now(), retained };
}
function run(span, work) {
	if (!span) return work();
	if (span.row.kind === 'lock_hold') span.lock_state ||= { locks: span.row.locks, truncated: span.row.locks_truncated, active: true };
	return with_context({ ...span.context, span_id: span.row.id,
		lock_state: span.lock_state || span.context.lock_state }, work);
}
function aggregate(record, row) {
	if (record.session !== session) return;
	const name = is_db(row) ? db_name(row.name) : row.name;
	const key = session + ':' + record.type + ':' + row.kind + ':' + name;
	if (!stages.has(key)) {
		if (stages.size >= LIMITS.stages || [...stages.values()].filter(stage => stage.type === record.type).length >= LIMITS.stages_per_type) { unaggregated++; return; }
		stages.set(key, { key, type: record.type, name, kind: row.kind, grouped: is_db(row), count: 0, failed: 0, sum: 0, min: null, max: 0, recent: [] });
	}
	const stage = stages.get(key); stage.count++; stage.failed += row.status === 'error' ? 1 : 0;
	stage.sum += row.duration_ms; stage.min = stage.min == null ? row.duration_ms : Math.min(stage.min, row.duration_ms);
	stage.max = Math.max(stage.max, row.duration_ms); stage.last = row.duration_ms;
	stage.skipped = (stage.skipped || 0) + (row.skipped ? 1 : 0);
	stage.recent.push(row.duration_ms); if (stage.recent.length > LIMITS.recent_samples) stage.recent.shift();
	stage.cached_p95 = null;
}
function end(span, error, details = {}) {
	if (!span || span.row.status !== 'running') return;
	if (span.lock_state) span.lock_state.active = false;
	Object.assign(span.row, clean(details), { ts: Date.now(), duration_ms: round(performance.now() - span.mono), status: error ? 'error' : 'ok' });
	span.context.record.pending_spans--;
	if (!span.retained) {
		// Keep slow/error DB work individually when possible; repetitive quick
		// tasks are summarized, leaving room for later locks and sync phases.
		span.retained = (span.row.duration_ms >= 25 || error) && retain(span.context.record, span.row, false);
		if (!span.retained) summarize(span.context.record, span.row);
	}
	aggregate(span.context.record, span.row);
	if (!active.has(span.context.record.id)) publish(span.context.record);
}
function phase(name, start_ts, duration_ms, details = {}) {
	if (!Number.isFinite(duration_ms) || duration_ms < 0) return;
	const span = begin(name, 'phase', details); if (!span) return;
	span.row.start_ts = start_ts;
	span.row.offset_ms = Math.max(0, start_ts - span.context.record.start_ts);
	span.mono = performance.now() - Math.max(0, duration_ms); end(span, details.error);
}
function fail() { if (capture()?.record) capture().record.status = 'error'; }
function annotate(details) { if (capture()?.record) Object.assign(capture().record, clean(details)); }
function update(span, details) { if (span) Object.assign(span.row, clean(details)); }
function disable() { until = 0; }
function import_phases(parent, rows) {
	if (!parent || !Array.isArray(rows)) return;
	run(parent, () => { for (const row of rows.slice(0, 80)) {
		const span = begin(row.name, 'worker_phase', { execution: 'worker', skipped: row.skipped });
		if (!span) continue;
		span.row.held_locks = [];
		span.row.start_ts = row.start_ts; span.mono = performance.now() - row.duration_ms;
		span.row.offset_ms = Math.max(0, row.start_ts - span.context.record.start_ts);
		end(span, row.status === 'error');
	} });
}
function snapshot(after = revision) {
	if (!Number.isSafeInteger(after) || after < 0) after = revision;
	const eligible = completed.filter(record => record.revision > after), records = eligible.slice(0, LIMITS.response);
	const unfinished = [...active.values(), ...completed.filter(record => record.pending_spans > 0)];
	// Background encoding may yield while an operation completes or adds a
	// follow-up span. Export detached rows at this cursor, never live records.
	const exported = new Map();
	const export_record = record => {
		if (!exported.has(record)) exported.set(record, { ...record,
			spans: record.spans.map(row => ({ ...row })),
			span_summaries: record.span_summaries.map(row => ({ ...row, ...(row.slowest ? { slowest: { ...row.slowest } } : {}) })),
		});
		return exported.get(record);
	};
	return { enabled: enabled(), session, lease_remaining_ms: Math.max(0, until - Date.now()), limits: LIMITS,
		cursor: records.at(-1)?.revision ?? revision, remaining: Math.max(0, eligible.length - records.length),
		gap: after > 0 && after < evicted_revision,
		dropped_traces: dropped, buffer_overwrites: overwritten, unaggregated_samples: unaggregated,
		active_total: unfinished.length, active_truncated: Math.max(0, unfinished.length - LIMITS.active),
		active: unfinished.slice(0, LIMITS.active).map(export_record), completed: records.map(export_record),
		stages: [...stages.values()].map(stage => {
			if (stage.cached_p95 == null) { const values = [...stage.recent].sort((a, b) => a - b); stage.cached_p95 = values[Math.ceil(values.length * .95) - 1]; }
			const { recent, sum, cached_p95, ...row } = stage;
			return { ...row, mean: round(sum / stage.count), p95: cached_p95, percentile_samples: recent.length };
		}) };
}

module.exports = { enable, disable, enabled, capture, with_context, operation, classify, begin, run, end, update, phase, fail, annotate, import_phases, snapshot };
