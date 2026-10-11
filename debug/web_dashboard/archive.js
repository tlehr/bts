'use strict';

// Live views stay small. The download retains the complete normal ten-minute
// run, with explicit limits and loss counters for unattended, longer tests.
class Archive {
	constructor() {
		this.series = []; this.traces = new Map(); this.events = new Map();
		this.dropped = { samples: 0, traces: 0, events: 0 };
	}
	add(snapshot, point) {
		this.series.push({ ...point, stages: (snapshot.processing?.stages || []).map(row => ({
			key: row.key, type: row.type, name: row.name, kind: row.kind, count: row.count, last: row.last, p95: row.p95,
		})) });
		if (this.series.length > 43200) { this.series.shift(); this.dropped.samples++; }
		for (const trace of [...(snapshot.processing?.completed || []), ...(snapshot.processing?.active || [])]) {
			const key = snapshot.server_id + ':' + trace.id; this.traces.delete(key);
			this.traces.set(key, { ...trace, server_id: snapshot.server_id });
			if (this.traces.size > 5000) { this.traces.delete(this.traces.keys().next().value); this.dropped.traces++; }
		}
		for (const event of snapshot.events || []) {
			const key = event.kind + ':' + event.ts + ':' + event.label;
			this.events.set(key, event);
			if (this.events.size > 10000) { this.events.delete(this.events.keys().next().value); this.dropped.events++; }
		}
	}
	export() { return { series: this.series, traces: [...this.traces.values()], events: [...this.events.values()],
		dropped: this.dropped, limits: { samples: 43200, traces: 5000, events: 10000 },
		includes: 'sampled-series-and-captured-spans', raw_server_logs_included: false }; }
}

module.exports = Archive;
