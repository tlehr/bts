'use strict';

const round = value => Math.round(value * 10) / 10;

// Cumulative counters survive rolling-window pruning. Cache percentiles until
// another sample arrives; keep frequencies instead of one record per payload.
class LatencyStats {
	constructor() {
		this.count = 0; this.sum = 0; this.min = null; this.max = null;
		this.frequencies = new Map(); this.cached = null;
		this.over_50_ms = 0; this.over_100_ms = 0; this.over_200_ms = 0;
	}
	add(value) {
		if (!Number.isFinite(value) || value < 0) return;
		value = round(value);
		this.count++; this.sum += value;
		this.min = this.min == null ? value : Math.min(this.min, value);
		this.max = this.max == null ? value : Math.max(this.max, value);
		this.frequencies.set(value, (this.frequencies.get(value) || 0) + 1);
		if (value > 50) this.over_50_ms++;
		if (value > 100) this.over_100_ms++;
		if (value > 200) this.over_200_ms++;
		this.cached = null;
	}
	summary(sent_updates = this.count) {
		if (!this.cached) {
			const values = [...this.frequencies.entries()].sort((a, b) => a[0] - b[0]);
			const percentile = fraction => {
				const target = Math.ceil(this.count * fraction);
				let count = 0;
				for (const [value, frequency] of values) { count += frequency; if (count >= target) return value; }
				return null;
			};
			this.cached = { count: this.count, mean: this.count ? round(this.sum / this.count) : null,
				min: this.min, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: this.max,
				over_50_ms: this.over_50_ms, over_100_ms: this.over_100_ms, over_200_ms: this.over_200_ms };
		}
		return { ...this.cached, sent_updates, unmatched_updates: sent_updates - this.count,
			coverage: sent_updates ? Math.round(this.count / sent_updates * 1000) / 1000 : null };
	}
}

class PayloadStats {
	constructor() { this.types = new Map(); }
	entry(type) {
		type = type || 'unknown';
		if (!this.types.has(type)) this.types.set(type, { type, count: 0, latencies: new LatencyStats() });
		return this.types.get(type);
	}
	receive(type) { this.entry(type).count++; }
	match(type, latency) { this.entry(type).latencies.add(latency); }
	summary() {
		return [...this.types.values()].map(({ type, count, latencies }) => {
			const stats = latencies.summary();
			return { type, count, latency_count: stats.count, avg: stats.mean, min: stats.min,
				p95: stats.p95, p99: stats.p99, max: stats.max };
		}).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
	}
}

module.exports = { LatencyStats, PayloadStats };
