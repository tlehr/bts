'use strict';

const tournament_debug_flags = new Map();
const tournament_auto_call_trace_flags = new Map();
const tournament_score_press_timing_flags = new Map();

function normalize_key(tournament_key) {
	return tournament_key || 'default';
}

function set_tournament_debug(tournament_key, enabled) {
	tournament_debug_flags.set(normalize_key(tournament_key), enabled === true);
}

function set_tournament_auto_call_trace(tournament_key, enabled) {
	tournament_auto_call_trace_flags.set(normalize_key(tournament_key), enabled === true);
}

function set_tournament_score_press_timing(tournament_key, enabled) {
	tournament_score_press_timing_flags.set(normalize_key(tournament_key), enabled === true);
}

function set_from_tournament(tournament) {
	if (!tournament || !tournament.key) {
		return;
	}
	set_tournament_debug(tournament.key, tournament.bts_debug_output_enabled === true);
	set_tournament_auto_call_trace(tournament.key, tournament.bts_auto_call_trace_enabled === true);
	set_tournament_score_press_timing(tournament.key, tournament.bts_score_press_timing_enabled === true);
}

function enabled(app, tournament_key) {
	if (process.env.BTS_DEBUG_OUTPUT === '1') {
		return true;
	}
	if (process.env.BTS_DEBUG_OUTPUT === '0') {
		return false;
	}
	const key = normalize_key(tournament_key);
	if (tournament_debug_flags.has(key)) {
		return tournament_debug_flags.get(key) === true;
	}
	return app?.config?.bts_debug_output_enabled === true;
}

function any_enabled(app) {
	if (process.env.BTS_DEBUG_OUTPUT === '1') {
		return true;
	}
	if (process.env.BTS_DEBUG_OUTPUT === '0') {
		return false;
	}
	for (const value of tournament_debug_flags.values()) {
		if (value === true) {
			return true;
		}
	}
	return app?.config?.bts_debug_output_enabled === true;
}

function auto_call_trace_enabled(app, tournament_key) {
	if (process.env.BTS_AUTO_CALL_TRACE === '1') {
		return true;
	}
	if (process.env.BTS_AUTO_CALL_TRACE === '0') {
		return false;
	}
	const key = normalize_key(tournament_key);
	if (tournament_auto_call_trace_flags.has(key)) {
		return tournament_auto_call_trace_flags.get(key) === true;
	}
	return app?.config?.bts_auto_call_trace_enabled === true;
}

function score_press_timing_enabled(app, tournament_key) {
	if (process.env.BTS_SCORE_PRESS_TIMING === '1') {
		return true;
	}
	if (process.env.BTS_SCORE_PRESS_TIMING === '0') {
		return false;
	}
	const key = normalize_key(tournament_key);
	if (tournament_score_press_timing_flags.has(key)) {
		return tournament_score_press_timing_flags.get(key) === true;
	}
	return app?.config?.bts_score_press_timing_enabled === true;
}

function any_score_press_timing_enabled() {
	if (process.env.BTS_SCORE_PRESS_TIMING === '1') return true;
	if (process.env.BTS_SCORE_PRESS_TIMING === '0') return false;
	return [...tournament_score_press_timing_flags.values()].some(value => value === true);
}

function log(app, tournament_key, ...args) {
	if (typeof args[0] === 'string' && args[0].includes('[bts] auto_call_trace:')) {
		if (auto_call_trace_enabled(app, tournament_key)) {
			console.log(...args);
		}
		return;
	}
	if (typeof args[0] === 'string' && args[0].includes('[bts] score_press_timing:')) {
		if (score_press_timing_enabled(app, tournament_key)) {
			log_compact(...args);
		}
		return;
	}
	if (enabled(app, tournament_key)) {
		console.log(...args);
	}
}

function log_compact(...args) {
	if (args.length === 2 && typeof args[0] === 'string' && args[1] && typeof args[1] === 'object') {
		try {
			console.log(`${args[0]} ${JSON.stringify(args[1])}`);
			return;
		} catch (err) {
			// Fall back to Node's formatter when a debug payload is not JSON-safe.
		}
	}
	console.log(...args);
}

module.exports = {
	any_enabled,
	any_score_press_timing_enabled,
	auto_call_trace_enabled,
	enabled,
	log,
	score_press_timing_enabled,
	set_from_tournament,
	set_tournament_auto_call_trace,
	set_tournament_debug,
	set_tournament_score_press_timing,
};
