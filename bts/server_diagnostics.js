'use strict';

// Updated by the canonical tournament lifecycle, including load and rollback.
// Reading this cache never adds a database lookup to a logging hot path.
const tournaments = new Map();

function set_from_tournament(tournament) {
	if (tournament?.key) tournaments.set(tournament.key, tournament.bts_server_diagnostics_enabled === true);
}

function remove(tournament) {
	if (tournament?.key) tournaments.delete(tournament.key);
}

function enabled(app, key) {
	if (process.env.BTS_SERVER_DIAGNOSTICS !== undefined) return process.env.BTS_SERVER_DIAGNOSTICS === '1';
	if (key != null && tournaments.has(key)) return tournaments.get(key);
	if (key == null && [...tournaments.values()].some(value => value)) return true;
	return app?.config?.bts_server_diagnostics_enabled === true;
}

function sync_timing_enabled(key) {
	if (process.env.BTS_BTP_SYNC_TIMING !== undefined) return process.env.BTS_BTP_SYNC_TIMING === '1';
	return enabled(null, key);
}

function log(app, key, ...args) {
	if (enabled(app, key)) console.warn(...args); // eslint-disable-line no-console
}

module.exports = { set_from_tournament, remove, enabled, sync_timing_enabled, log };
