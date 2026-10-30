'use strict';
// Do not use const; this is public-facing as part of the ticker

var cerror = (function() {


	var error_list = [];
	var report_enabled = true;
	var serial = 0;
	var subscribers = new Set();

	function render() {
		if (subscribers.size) return;
		if (typeof uiu !== 'undefined') {
			try {
				uiu.show_qs('.errors');
				uiu.text_qs('.errors', error_list.map(entry => entry.time + ' - ' + entry.message).join('\n'));
			} catch (e) { /* Errors may arrive before the legacy UI exists. */ }
		}
	}

	function notify(change) {
		for (var listener of subscribers) {
			try { listener(change); } catch (e) { /* A diagnostic view must not interrupt error handling. */ }
		}
		render();
	}

	function entries() { return error_list.slice(); }

	function subscribe(listener) {
		subscribers.add(listener);
		return () => subscribers.delete(listener);
	}

	function clear() {
		error_list = [];
		notify({ type: 'clear' });
	}

	// eslint-disable-next-line no-unused-vars -- Keep the browser's window.onerror callback signature.
	function on_error(msg, script_url, line, col, err) {
		const now = new Date();
		const entry = Object.freeze({ id: ++serial, timestamp: now.getTime(), time: getCurrentTimeString(now), message: String(msg) });
		error_list.unshift(entry);
		notify({ type: 'add', entry });
	}

	function silent(msg) {
		// eslint-disable-next-line no-console -- Keep the original diagnostic available in the browser console.
		console.error(msg);
		on_error(msg, undefined, undefined, undefined, new Error());
	}

	function net(err)  {
		silent(err.message);
	}

	function init() {
		var report_enabled_json = document.getElementById('bts-data-holder').getAttribute('data-error-reporting');
		try {
			report_enabled = JSON.parse(report_enabled_json);
		} catch(e) {
			silent('Error reporting JSON invalid: ' + report_enabled_json);
			return;
		}
		if (report_enabled === null) {
			silent('Error reporting not configured');
			return;
		}
		if (report_enabled) {
			window.onerror = on_error;
		}
	}

	return {
		init,
		net,
		on_error,
		silent,
		entries,
		subscribe,
		clear,
	};

	function getCurrentTimeString(now) {

		const hh = String(now.getHours()).padStart(2, '0');
		const mm = String(now.getMinutes()).padStart(2, '0');
		const ss = String(now.getSeconds()).padStart(2, '0');

		return `${hh}:${mm}:${ss}`;
	}

})();

/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var uiu = null; // UI only

	module.exports = cerror;
}
/*/@DEV*/
