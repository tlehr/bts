'use strict';

// Message tasks yield between batches without chaining background-tab timers.
// A frozen page can still pause all tasks; wake pending work when it resumes.
var change_queue_scheduler = function(callback, options = {}) {
	let channel;
	let ticket = 0;
	let pending = null;
	let timer = null, controller = null, urgent = false;

	function run(id) {
		if (pending !== id) return;
		pending = null;
		timer = null;controller = null;urgent = false;
		callback();
	}

	function schedule(high = false) {
		if (pending !== null) {
			if (!(high && !urgent && controller)) return;
			cancel();
		}
		const id = ++ticket;
		pending = id;urgent = high;
		if (typeof window !== 'undefined' && typeof window.scheduler?.postTask === 'function' && typeof window.AbortController === 'function') {
			controller = new window.AbortController();
			window.scheduler.postTask(() => run(id), {priority: high ? 'user-blocking' : options.priority || 'user-visible', signal:controller.signal})
				.catch(error => {if(error?.name !== 'AbortError')setTimeout(()=>{throw error;},0);});
		} else if (typeof window !== 'undefined' && typeof window.MessageChannel === 'function') {
			if (!channel) {
				channel = new window.MessageChannel();
				channel.port1.onmessage = event => run(event.data);
			}
			channel.port2.postMessage(id);
		} else {
			timer = setTimeout(() => run(id), 0);
		}
	}

	function cancel() {
		pending = null;urgent = false;controller?.abort();controller = null;
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	function wake() {
		if (pending === null) return;
		const high=urgent;cancel();
		schedule(high);
	}

	if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) wake();
		});
		document.addEventListener('resume', wake);
	}
	if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
		window.addEventListener('pageshow', wake);
	}
	return { schedule, cancel };
};

/*@DEV*/
if (typeof module !== 'undefined') module.exports = change_queue_scheduler;
/*/@DEV*/
