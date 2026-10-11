'use strict';

const rules = require('../match_automation');

// These are the same thresholds used by the existing allocation rules. Passing
// any future threshold can change the result without a datastore write.
function next_check(state, now) {
	const tournament = state.tournaments[0];
	const age = rules.get_call_on_court_preparation_age_minutes(tournament);
	const start_limit = rules.get_time_limit_before_scheduled_minutes_for_prefix(tournament, 'call_on_court');
	const pause = Number(tournament?.btp_settings?.pause_duration_ms);
	const check_pause = rules.get_participant_readiness_mode(tournament, 'call_on_court') === 'pause_expired' &&
		Number.isFinite(pause) && pause > 0;
	let next = Infinity;
	const consider = deadline => {
		if (Number.isFinite(deadline) && deadline > now) next = Math.min(next, deadline);
	};
	for (const match of state.matches) {
		const setup = match.setup;
		if (setup?.state !== 'preparation' && (age != null || setup?.state !== 'scheduled')) continue;
		if (age != null) consider(Number(setup.preparation_call_timestamp) + age * 60000);
		if (start_limit != null) {
			const scheduled = rules.get_scheduled_timestamp(match);
			if (Number.isFinite(scheduled)) consider(scheduled - start_limit * 60000);
		}
		if (!check_pause) continue;
		for (const team of setup.teams || []) for (const player of team.players || []) {
			if (!player) continue;
			if (player.last_time_on_court_ts) consider(Number(player.last_time_on_court_ts) + pause);
			if (player.tablet_break_active === true) consider(Number(player.tablet_break_until_ts));
		}
	}
	if (tournament?.tabletoperator_enabled === true) {
		for (const operator of state.tabletoperators) if (operator.court == null) consider(Number(operator.start_ts));
	}
	return next;
}

module.exports = next_check;
