'use strict';

function statistics(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
	return { count: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
		p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) ?? null };
}

module.exports = { statistics };
