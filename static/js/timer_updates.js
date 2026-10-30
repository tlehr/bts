'use strict';

// Local clocks share wakeups within 100 ms. Point/state changes still update
// synchronously; each clock continues to derive its value from the real time.
// eslint-disable-next-line no-unused-vars -- Shared with cmatch.
var btsTimerUpdates = (function createTimerUpdates(env) {
	const entries = new Set();
	let timeout = null, wakeAt = null, running = false, batches = 0, updates = 0;
	const now = () => env.Date.now();
	function arm() {
		if (running) return;
		let next = Infinity;
		for (const entry of entries) next = Math.min(next, entry.due);
		if (wakeAt === next) return;
		if (timeout != null) env.clearTimeout(timeout);
		timeout = null;wakeAt = next;
		if (next !== Infinity) timeout = env.setTimeout(flush, Math.max(0, next-now()));
	}
	function flush() {
		timeout = null;wakeAt = null;running = true;batches++;
		const time = now(), due = [...entries].filter(entry => entry.due <= time);
		let failure;
		try {
			for (const entry of due) {
				if (!entries.delete(entry)) continue;
				try {updates++;entry.callback();} catch(error) {failure ||= error;}
			}
		} finally {running=false;arm();}
		if (failure) throw failure;
	}
	function schedule(callback, delay) {
		const entry = {callback, due:Math.ceil((now()+Math.max(1,Number(delay)||1))/100)*100};
		entries.add(entry);arm();
		return () => {if(entries.delete(entry))arm();};
	}
	if (typeof module !== 'undefined' && module.exports) module.exports = createTimerUpdates;
	return {schedule,stats:()=>({pending:entries.size,batches,updates})};
})(typeof window === 'undefined' ? {Date,setTimeout,clearTimeout} : window);
