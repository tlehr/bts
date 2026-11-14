'use strict';

// Local clocks share wakeups within 100 ms. Point/state changes still update
// synchronously; each clock continues to derive its value from the real time.
// eslint-disable-next-line no-unused-vars -- Shared with cmatch.
var btsTimerUpdates = (function createTimerUpdates(env) {
	const entries = new Set();
	const watched = new Map();
	const watches = new Set();
	let timeout = null, wakeAt = null, running = false, batches = 0, updates = 0;
	let observer = null, sweep = null;
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
	function sweepDetached() {
		sweep = null;
		for (const entry of watches) if (!entry.owner.isConnected) {
			entry.cancel();entry.detached?.();
		}
		if (watches.size) sweep = env.setTimeout(sweepDetached,1000);
	}
	// Observe a stable row/player, rather than the clock that can be display:none.
	// Several clocks can share that target while retaining independent lifetimes.
	function observe(element, callback, detached, owner = element) {
		if (typeof env.IntersectionObserver !== 'function') return null;
		observer ||= new env.IntersectionObserver(records => {
			for (const record of records) {
				const group = watched.get(record.target);
				if (!group) continue;
				group.visible = record.isIntersecting;
				for (const entry of [...group.entries]) if (watches.has(entry)) entry.callback(group.visible);
			}
		}, {rootMargin:'600px 0px'});
		const entry = {callback,detached,owner,cancel:() => {
			if (!watches.delete(entry)) return;
			const group = watched.get(element);
			group.entries.delete(entry);
			if (!group.entries.size) {watched.delete(element);observer.unobserve(element);}
			if (!watches.size && sweep != null) {env.clearTimeout(sweep);sweep=null;}
		}};
		let group = watched.get(element);
		const first = !group;
		if (first) {group = {entries:new Set(),visible:null};watched.set(element,group);}
		group.entries.add(entry);watches.add(entry);
		if (first) observer.observe(element);
		else if (group.visible !== null) callback(group.visible);
		if (sweep == null) sweep = env.setTimeout(sweepDetached,1000);
		return entry.cancel;
	}
	if (typeof module !== 'undefined' && module.exports) module.exports = createTimerUpdates;
	return {schedule,observe,stats:()=>({pending:entries.size,batches,updates,observed:watches.size})};
})(typeof window === 'undefined' ? {Date,setTimeout,clearTimeout} : window);
