'use strict';

// Timer lateness over the whole wait, including a timer still overdue when the
// read completes. A fast first setImmediate does not rule out later stalls.
module.exports = function event_loop_probe(options = {}) {
	const now = options.now || (() => process.hrtime.bigint());
	const set_timer = options.set_timer || setTimeout;
	const clear_timer = options.clear_timer || clearTimeout;
	const interval_ms = options.interval_ms ?? 20;
	const interval_ns = BigInt(interval_ms) * 1000000n;
	let expected = now() + interval_ns;
	let max_delay_ns = 0n, samples = 0, timer;
	const observe = () => {
		const delay = now() - expected;
		if (delay > max_delay_ns) max_delay_ns = delay;
	};
	const schedule = () => {
		timer = set_timer(() => {
			observe(); samples++;
			expected = now() + interval_ns;
			schedule();
		}, interval_ms);
		if (timer?.unref) timer.unref();
	};
	schedule();
	return { stop() {
		observe(); clear_timer(timer);
		return { event_loop_timer_max_delay_ms: Math.round(Number(max_delay_ns) / 1e5) / 10,
			event_loop_timer_samples: samples, event_loop_timer_interval_ms: interval_ms };
	} };
};
