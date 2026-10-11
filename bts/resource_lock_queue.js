'use strict';

const locks = require('./queue_lock_keys');

function default_slow_task_threshold_ms() {
	if (process.env.BTS_UPDATE_QUEUE_SLOW_TASK_MS === '0') {
		return 0;
	}
	const configured = Number(process.env.BTS_UPDATE_QUEUE_SLOW_TASK_MS);
	if (Number.isFinite(configured) && configured > 0) {
		return Math.round(configured);
	}
	return process.env.BTS_SCORE_PRESS_TIMING === '1' || process.env.BTS_BTP_SYNC_TIMING === '1' ? 50 : 500;
}

function warn_compact(label, payload) {
	try {
		console.warn(`${label} ${JSON.stringify(payload)}`); // eslint-disable-line no-console
	} catch (err) {
		console.warn(label, payload); // eslint-disable-line no-console
	}
}

class ResourceLockQueue {
	constructor(options = {}) {
		this.pending = [];
		this.active = new Map();
		this.next_id = 1;
		this.scheduled = false;
		this.hang_reporter = null;
		this.completed_count = 0;
		this.failed_count = 0;
		this.enqueued_count = 0;
		this.high_watermark = 0;
		this.recent_tasks = [];
		this.default_hang_after_ms = options.default_hang_after_ms || 5000;
	}

	execute(task, options = {}) {
		const traces = require('./performance/traces');
		if (!traces.capture() && traces.enabled()) return traces.operation(this._task_name(task), {
			trace_id: task?._queue_trace_id || null, ...(task?._queue_context || {}),
		}, () => this.execute(task, options));
		const args = Array.isArray(options.args) ? options.args : [];
		const task_locks = locks.normalize_list(options.locks || task?._queue_locks || [locks.legacy_global()]);
		const entry = {
			id: this.next_id++,
			task,
			args,
			locks: task_locks,
			name: this._task_name(task),
			mode: options.mode || null,
			key: options.key || null,
			trace_id: task?._queue_trace_id || null,
			enqueued_at: Date.now(),
			started_at: null,
			finished_at: null,
			trace_context: traces.capture(),
			wait_span: traces.begin(this._task_name(task), 'lock_wait', { locks: task_locks, queue_id: this.next_id - 1 }),
			timeout: null,
			resolve: null,
			reject: null,
		};
		this.enqueued_count++;
		this.high_watermark = Math.max(this.high_watermark, this.pending.length + this.active.size + 1);
		return new Promise((resolve, reject) => {
			entry.resolve = resolve;
			entry.reject = reject;
			this.pending.push(entry);
			this._schedule();
		});
	}

	set_hang_reporter(fn) {
		this.hang_reporter = fn;
	}

	stats() {
		const recent = this.recent_tasks.slice();
		const avg = (field) => recent.length === 0
			? null
			: Math.round(recent.reduce((sum, entry) => sum + entry[field], 0) / recent.length);
		const max = (field) => recent.length ? Math.max(...recent.map((entry) => entry[field])) : null;
		const active_entries = Array.from(this.active.values()).map((entry) => ({
			id: entry.id,
			trace_id: entry.trace_id,
			operation_id: entry.trace_context?.record?.id || null,
			task: entry.name,
			key: entry.key,
			mode: entry.mode,
			locks: entry.locks,
			runtime_ms: entry.started_at ? Date.now() - entry.started_at : null,
		}));
		return {
			active: active_entries.length > 0,
			queue_length: this.pending.length,
			oldest_pending_ms: this.pending.length ? Math.max(0, Date.now() - this.pending[0].enqueued_at) : 0,
			current_task: active_entries.length === 1
				? active_entries[0].task
				: (active_entries.length > 1 ? `active:${active_entries.length}` : null),
			current_task_runtime_ms: active_entries.length === 1 ? active_entries[0].runtime_ms : null,
			enqueued_count: this.enqueued_count,
			completed_count: this.completed_count,
			failed_count: this.failed_count,
			high_watermark: this.high_watermark,
			recent_count: recent.length,
			recent_avg_wait_ms: avg('wait_ms'),
			recent_max_wait_ms: max('wait_ms'),
			recent_avg_runtime_ms: avg('runtime_ms'),
			recent_max_runtime_ms: max('runtime_ms'),
			recent_tasks: recent,
			active_tasks: active_entries,
			pending_tasks: this.pending.slice(0, 20).map((entry) => ({
				id: entry.id,
				trace_id: entry.trace_id,
				operation_id: entry.trace_context?.record?.id || null,
				task: entry.name,
				key: entry.key,
				mode: entry.mode,
				locks: entry.locks,
				wait_ms: Date.now() - entry.enqueued_at,
				blocked_by: this._blocked_by(entry),
			})),
		};
	}

	_schedule() {
		if (this.scheduled) {
			return;
		}
		this.scheduled = true;
		const schedule_fn = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);
		schedule_fn(() => {
			this.scheduled = false;
			this._drain();
		});
	}

	_drain() {
		let started_any = false;
		for (let i = 0; i < this.pending.length; i++) {
			const entry = this.pending[i];
			if (!this._can_start(entry, i)) {
				continue;
			}
			this.pending.splice(i, 1);
			i--;
			this._start(entry);
			started_any = true;
		}
		if (started_any && this.pending.length > 0) {
			this._schedule();
		}
	}

	_can_start(entry, pending_index) {
		for (const active_entry of this.active.values()) {
			if (locks.normalized_lists_conflict(entry.locks, active_entry.locks)) {
				entry.blocked_by = [this._blocker(active_entry, 'active')];
				entry.wait_blocked_by = entry.blocked_by;
				this._trace_blockers(entry);
				return false;
			}
		}
		for (let i = 0; i < pending_index; i++) {
			if (locks.normalized_lists_conflict(entry.locks, this.pending[i].locks)) {
				entry.blocked_by = [this._blocker(this.pending[i], 'pending')];
				entry.wait_blocked_by = entry.blocked_by;
				this._trace_blockers(entry);
				return false;
			}
		}
		entry.blocked_by = [];
		return true;
	}

	_trace_blockers(entry) {
		if (!entry.wait_span) return;
		require('./performance/traces').update(entry.wait_span, { blockers: entry.wait_blocked_by.map(blocker => ({ ...blocker,
			conflicting_locks: entry.locks.filter(requested => blocker.locks.some(held => locks.lock_conflicts(requested, held))) })) });
	}

	_start(entry) {
		const traces = require('./performance/traces');
		traces.end(entry.wait_span, null, { blockers: (entry.wait_blocked_by || []).map(blocker => ({ ...blocker,
			conflicting_locks: entry.locks.filter(requested => blocker.locks.some(held => locks.lock_conflicts(requested, held))) })) });
		entry.hold_span = traces.with_context(entry.trace_context, () => traces.begin(entry.name, 'lock_hold', { locks: entry.locks, queue_id: entry.id }));
		entry.started_at = Date.now();
		entry.foreground_end = require('./foreground_work').begin(entry.name);
		this.active.set(entry.id, entry);
		this._start_watchdog(entry);
		Promise.resolve()
			.then(() => traces.with_context(entry.trace_context, () => traces.run(entry.hold_span,
				() => require('./foreground_work').run(entry.foreground_end, () => entry.task(...entry.args)))))
			.then((res) => this._finish(entry, null, res))
			.catch((err) => this._finish(entry, err));
	}

	_finish(entry, err, res) {
		if (!this.active.has(entry.id)) {
			return;
		}
		this.active.delete(entry.id);
		require('./performance/traces').end(entry.hold_span, err);
		entry.foreground_end?.();
		if (entry.timeout) {
			clearTimeout(entry.timeout);
			entry.timeout = null;
		}
		entry.finished_at = Date.now();
		if (err) {
			this.failed_count++;
		} else {
			this.completed_count++;
		}
		this._record_recent_task(entry, !!err);
		if (err) {
			entry.reject(err);
		} else {
			entry.resolve(res);
		}
		this._schedule();
	}

	_start_watchdog(entry) {
		const hang_after_ms = this._task_hang_after_ms(entry.task);
		entry.timeout = setTimeout(() => {
			const payload = {
				task: entry.name,
				key: entry.key,
				mode: entry.mode,
				locks: entry.locks,
				runtime_ms: entry.started_at ? Date.now() - entry.started_at : null,
				queue_length: this.pending.length,
			};
			if (require('./server_diagnostics').enabled()) warn_compact('[bts] update_queue:task_still_running', payload);
			if (typeof this.hang_reporter === 'function') {
				try {
					this.hang_reporter(payload);
				} catch (err) {
					warn_compact('[bts] update_queue:hang_reporter_error', {
						error: err && (err.stack || err.message || String(err)),
					});
				}
			}
		}, hang_after_ms);
	}

	_task_name(task) {
		if (!task) {
			return '<unknown>';
		}
		if (task._queue_name) {
			return task._queue_name;
		}
		return task.name && task.name.length > 0 ? task.name : '<anonymous>';
	}

	_task_hang_after_ms(task) {
		if (task && typeof task._queue_hang_after_ms === 'number' && task._queue_hang_after_ms > 0) {
			return task._queue_hang_after_ms;
		}
		return this.default_hang_after_ms;
	}

	_record_recent_task(entry, failed) {
		const recent = {
			id: entry.id,
			trace_id: entry.trace_id,
			start_ts: entry.started_at,
			enqueued_ts: entry.enqueued_at,
			ts: entry.finished_at,
			task: entry.name,
			key: entry.key,
			mode: entry.mode,
			locks: entry.locks,
			wait_ms: Math.max(0, entry.started_at - entry.enqueued_at),
			runtime_ms: Math.max(0, entry.finished_at - entry.started_at),
			failed: !!failed,
			wait_blocked_by: entry.wait_blocked_by || [],
		};
		this.recent_tasks.push(recent);
		if (this.recent_tasks.length > 100) {
			this.recent_tasks.splice(0, this.recent_tasks.length - 100);
		}
		this._log_slow_task(recent);
	}

	_log_slow_task(entry) {
		if (!require('./server_diagnostics').enabled() && !require('./debug_flags').any_score_press_timing_enabled() &&
			process.env.BTS_BTP_SYNC_TIMING !== '1' && !(Number(process.env.BTS_UPDATE_QUEUE_SLOW_TASK_MS) > 0)) return;
		const threshold_ms = default_slow_task_threshold_ms();
		if (!threshold_ms || !entry) {
			return;
		}
		const total_ms = entry.wait_ms + entry.runtime_ms;
		const slow_parts = [];
		if (entry.wait_ms >= threshold_ms) slow_parts.push('wait');
		if (entry.runtime_ms >= threshold_ms) slow_parts.push('runtime');
		if (total_ms >= threshold_ms) slow_parts.push('total');
		if (slow_parts.length === 0) {
			return;
		}
		warn_compact('[bts] update_queue:slow_task', {
			id: entry.id,
			trace_id: entry.trace_id,
			enqueued_ts: entry.enqueued_ts,
			start_ts: entry.start_ts,
			ts: entry.ts,
			task: entry.task,
			key: entry.key,
			mode: entry.mode,
			locks: entry.locks,
			wait_ms: entry.wait_ms,
			runtime_ms: entry.runtime_ms,
			total_ms,
			failed: entry.failed,
			threshold_ms,
			slow_parts,
			// The last observed blocker is evidence of a lock conflict, not an
			// attribution of the entire wait (which also includes scheduling).
			observed_lock_conflict: entry.wait_blocked_by.length > 0,
			blocked_by: entry.wait_blocked_by.map(blocker => ({ ...blocker,
				conflicting_locks: entry.locks.filter(requested => blocker.locks.some(held => locks.lock_conflicts(requested, held))) })),
			queue_length: this.pending.length,
			active_count: this.active.size,
			completed_count: this.completed_count,
			failed_count: this.failed_count,
			high_watermark: this.high_watermark,
		});
	}

	_blocker(entry, state) {
		return { id: entry.id, task: entry.name, key: entry.key, trace_id: entry.trace_id,
			operation_id: entry.trace_context?.record?.id || null,
			locks: entry.locks, state, enqueued_ts: entry.enqueued_at,
			start_ts: entry.started_at, observed_ts: Date.now() };
	}

	_blocked_by(entry) {
		const blockers = [];
		for (const active_entry of this.active.values()) {
			if (locks.normalized_lists_conflict(entry.locks, active_entry.locks)) {
				blockers.push(this._blocker(active_entry, 'active'));
				if (blockers.length === 5) return blockers;
			}
		}
		for (const pending_entry of this.pending) {
			if (pending_entry === entry) {
				break;
			}
			if (locks.normalized_lists_conflict(entry.locks, pending_entry.locks)) {
				blockers.push(this._blocker(pending_entry, 'pending'));
				if (blockers.length === 5) return blockers;
			}
		}
		return blockers.slice(0, 5);
	}

}

module.exports = {
	ResourceLockQueue,
};
