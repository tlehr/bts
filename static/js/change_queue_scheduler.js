'use strict';

// Message tasks yield between batches without chaining background-tab timers.
// A frozen page can still pause all tasks; wake pending work when it resumes.
var change_queue_scheduler = function(callback) {
	let channel;
	let ticket = 0;
	let pending = null;
	let timer = null;

	function run(id) {
		if (pending !== id) return;
		pending = null;
		timer = null;
		callback();
	}

	function schedule() {
		if (pending !== null) return;
		const id = ++ticket;
		pending = id;
		if (typeof window !== 'undefined' && typeof window.MessageChannel === 'function') {
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
		pending = null;
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	function wake() {
		if (pending === null) return;
		cancel();
		schedule();
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
