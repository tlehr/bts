'use strict';

// Buffer subphases so a slow parent can report even short component steps.
module.exports = function timed_steps(log, prefix, options = {}) {
	const now = options.now || (() => process.hrtime.bigint());
	const started = log ? now() : null;
	const rows = [];
	const record = (name, start, end, extra, error) => rows.push({ name, start, end,
		extra: { ...extra, ...(error ? { error: error.message || String(error) } : {}) } });
	return {
		async async(name, work, extra = {}) {
			if (!log) return work();
			const start = now(); let error;
			try { return await work(); }
			catch (err) { error = err; throw err; }
			finally { record(name, start, now(), extra, error); }
		},
		sync(name, work, extra = {}) {
			if (!log) return work();
			const start = now(); let error;
			try { return work(); }
			catch (err) { error = err; throw err; }
			finally { record(name, start, now(), extra, error); }
		},
		flush() {
			if (!log) return;
			const parent_slow = Number(now() - started) / 1e6 >= (options.threshold_ms ?? 100);
			for (const row of rows) log(prefix + '_' + row.name, row.start,
				{ ...row.extra, timing_end_ns: row.end, parent_slow });
			rows.length = 0;
		},
	};
};
