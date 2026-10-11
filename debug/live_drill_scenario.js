'use strict';

const BENCHMARK_PHASES = [
	{ name: 'checkin-and-play', start_ms: 0, end_ms: 120000, idle: false },
	{ name: 'load', start_ms: 120000, end_ms: 360000, idle: false },
	{ name: 'idle', start_ms: 360000, end_ms: 480000, idle: true },
	{ name: 'load-after-idle', start_ms: 480000, end_ms: 600000, idle: false },
];
const BENCHMARK_RUNTIME_MS = BENCHMARK_PHASES[BENCHMARK_PHASES.length - 1].end_ms;

function benchmark_phase(elapsed_ms) {
	return BENCHMARK_PHASES.find((phase) => elapsed_ms >= phase.start_ms && elapsed_ms < phase.end_ms) || null;
}

// Separate streams keep battery traffic and other courts from changing a match's points.
const streams_by_options = new WeakMap();
function random_source(options, namespace) {
	if (options.seed == null) return Math.random;
	if (!streams_by_options.has(options)) streams_by_options.set(options, new Map());
	const streams = streams_by_options.get(options);
	if (!streams.has(namespace)) {
		let state = 2166136261;
		for (const char of String(options.seed) + ':' + namespace) {
			state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
		}
		streams.set(namespace, () => {
			state = (state + 0x6D2B79F5) >>> 0;
			let value = Math.imul(state ^ (state >>> 15), 1 | state);
			value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
			return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
		});
	}
	return streams.get(namespace);
}

function checkin_key(request) {
	// Check-in may be per match: the same player in two matches needs two requests.
	return JSON.stringify([String(request.match_id), String(request.player_id)]);
}

class CheckinPacer {
	constructor(started_at) {
		this.started_at = started_at;
		this.jobs = new Map();
		this.initialized = false;
		this.initial_requests = 0;
	}

	due(requests, now, limit = 32) {
		const unique = new Map(requests.map((request) => [checkin_key(request), request]));
		if (!this.initialized) {
			this.initialized = true;
			this.initial_requests = unique.size;
			const match_ids = [...new Set([...unique.values()].map((request) => String(request.match_id)))];
			const due_by_match = new Map(match_ids.map((id, index) => [id,
				this.started_at + Math.floor(index * 110000 / match_ids.length)]));
			for (const key of unique.keys()) {
				// Leave ten seconds for the final responses and a refreshed snapshot.
				// Keep the players of one match together so a court can fill promptly.
				this.jobs.set(key, { next_at: due_by_match.get(String(unique.get(key).match_id)) });
			}
		}
		const due = [];
		for (const [key, request] of unique) {
			if (!this.jobs.has(key)) this.jobs.set(key, { next_at: now });
			if (this.jobs.get(key).next_at <= now && due.length < limit) due.push(request);
		}
		return due;
	}

	complete(request, now, succeeded) {
		// Permit later re-check-ins after a game, but avoid replaying stale snapshots.
		this.jobs.set(checkin_key(request), { next_at: now + (succeeded ? 5000 : 10000) });
	}
}

function sample_summary(values) {
	if (!values.length) return { count: 0, mean: null, p50: null, p95: null, p99: null, max: null };
	const sorted = values.slice().sort((a, b) => a - b);
	const round = (value) => Math.round(value * 10) / 10;
	return {
		count: sorted.length,
		mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
		p50: round(sorted[Math.ceil(sorted.length * 0.5) - 1]),
		p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
		p99: round(sorted[Math.ceil(sorted.length * 0.99) - 1]),
		max: round(sorted[sorted.length - 1]),
	};
}

function latency_summary(values, sent_updates) {
	return { ...sample_summary(values), sent_updates, unmatched_updates: sent_updates - values.length,
		coverage: sent_updates ? Math.round(values.length / sent_updates * 1000) / 1000 : null,
		over_50_ms: values.filter(value => value > 50).length,
		over_100_ms: values.filter(value => value > 100).length,
		over_200_ms: values.filter(value => value > 200).length };
}

module.exports = { BENCHMARK_PHASES, BENCHMARK_RUNTIME_MS, benchmark_phase, random_source, CheckinPacer, sample_summary, latency_summary };
