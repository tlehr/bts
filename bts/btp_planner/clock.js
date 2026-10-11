'use strict';

function snapshot(clock) {
	if (!clock) return { mode: 'real' };
	if (!clock.get_state) return { mode: 'fixed', fixed_ts: clock.now_ms() };
	const { mode, fixed_ts, offset_ms } = clock.get_state();
	return { mode, fixed_ts, offset_ms };
}

function create(state) {
	if (state.mode === 'real' || (state.mode === 'fixed' && !Number.isFinite(state.fixed_ts))) return undefined;
	return { now_ms: () => state.mode === 'offset' ? Date.now() + state.offset_ms : state.fixed_ts };
}

function current(clock, planned) {
	return !clock?.get_state || JSON.stringify(snapshot(clock)) === JSON.stringify(planned);
}

module.exports = { snapshot, create, current };
