'use strict';

const { PerformanceObserver, performance } = require('perf_hooks');

// Diagnostics lease only. Keep numeric pause timestamps so a slow operation
// can be correlated with GC, without collecting heap contents or stack traces.
module.exports = function garbage_collection() {
	const recent = [];
	let count = 0, total_ms = 0, max_ms = 0;
	const observer = new PerformanceObserver(list => {
		for (const entry of list.getEntries()) {
			const duration_ms = Math.round(entry.duration * 10) / 10;
			const start_ts = performance.timeOrigin + entry.startTime;
			count++; total_ms += duration_ms; max_ms = Math.max(max_ms, duration_ms);
			recent.push({ start_ts, end_ts: start_ts + entry.duration, duration_ms, kind: entry.detail?.kind ?? null });
			if (recent.length > 100) recent.shift();
		}
	});
	observer.observe({ entryTypes: ['gc'] });
	return {
		snapshot(now = Date.now()) {
			return { count, total_ms: Math.round(total_ms * 10) / 10, max_ms,
				recent: recent.filter(row => row.end_ts >= now - 30000).map(row => ({ ...row })) };
		},
		stop() { observer.disconnect(); recent.length = 0; },
	};
};
