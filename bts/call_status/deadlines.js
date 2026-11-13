'use strict';

module.exports = function next_check(input, now) {
	const rules = require('../match_automation');
	let next = Infinity;
	const consider = value => { if (Number.isFinite(value) && value > now) next = Math.min(next, value); };
	const age = rules.get_call_on_court_preparation_age_minutes(input);
	const pause = Number(input.btp_settings?.pause_duration_ms);
	const check_pause = ['preparation_call', 'call_on_court'].some(prefix => rules.get_participant_readiness_mode(input, prefix) === 'pause_expired');
	for (const match of input.matches || []) {
		const setup = match.setup || {};
		if (setup.state === 'finished' || setup.now_on_court) continue;
		for (const prefix of ['preparation_call', 'call_on_court']) {
			const limit = rules.get_time_limit_before_scheduled_minutes_for_prefix(input, prefix);
			const scheduled = rules.get_scheduled_timestamp(match);
			if (limit != null && scheduled != null) consider(scheduled - limit * 60000);
		}
		if (age != null && setup.state === 'preparation' && setup.preparation_call_timestamp != null) consider(Number(setup.preparation_call_timestamp) + age * 60000);
		if (!check_pause || !Number.isFinite(pause) || pause <= 0) continue;
		for (const team of setup.teams || []) for (const player of team.players || []) {
			if (player?.last_time_on_court_ts) consider(Number(player.last_time_on_court_ts) + pause);
			if (player?.tablet_break_active === true) consider(Number(player.tablet_break_until_ts));
		}
	}
	if (input.tabletoperator_enabled === true) for (const operator of input.tabletoperators || []) if (operator.court == null) consider(Number(operator.start_ts));
	return next;
};
