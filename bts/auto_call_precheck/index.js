'use strict';

const tournament_model = require('../tournament_model');
const inputs = require('./inputs');
const next_check = require('./deadlines');

async function inspect(app, key, previous) {
	const model = tournament_model.attach(app.db);
	// Executor-ordered immutable references: no copied score histories and no
	// private planning database are needed to establish that all courts are busy.
	const occupancy = await model.snapshot(key, ['courts', 'matches']);
	const occupied = new Set(occupancy.matches.filter(match => match.setup?.now_on_court === true && match.setup.court_id)
		.map(match => match.setup.court_id));
	const free = occupancy.courts.some(court => court.is_active === true && !court.match_id && !occupied.has(court._id));
	if (!free) return { reason: 'no_free_courts' };
	const state = Object.assign(occupancy, await model.snapshot(key, ['tournaments', 'locations', 'umpires', 'tabletoperators']));
	const now = app.clock ? app.clock.now_ms() : Date.now();
	if (previous && now >= previous.observed_at && now < previous.next_check_ts && inputs.unchanged(state, previous.inputs)) {
		return { reason: 'unchanged_call_inputs', next_check_ts: previous.next_check_ts };
	}
	return { state };
}

function remember(state, now) {
	// Remember the validated plan input, never a later live snapshot: a check-in
	// arriving while a no-op is finishing must still cause the next evaluation.
	return { inputs: inputs.capture(state), observed_at: now, next_check_ts: next_check(state, now) };
}

module.exports = { inspect, remember };
