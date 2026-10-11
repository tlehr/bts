'use strict';

/* global cerror */
var cmatch_history = (function() {
	const pending = new WeakMap();

	function load(match, callback) {
		if (match.presses_deferred !== true) return callback();
		const context = { tournament: curt, path: window.location.pathname, callback };
		if (pending.has(match)) {
			pending.set(match, context); // A repeated click uses the latest requested view.
			return;
		}
		pending.set(match, context);
		send({ type: 'match_history_get', tournament_key: curt.key, match_id: match._id }, (error, response) => {
			const latest = pending.get(match);
			pending.delete(match);
			if (curt !== latest.tournament || !curt.matches.includes(match) || window.location.pathname !== latest.path) return;
			// A live update carries a newer full history. Never overwrite it with
			// a response that was captured before that update.
			if (match.presses_deferred === true) {
				if (error) return cerror.net(error);
				if (!response || response.match_id !== match._id || response.tournament_key !== curt.key || !Array.isArray(response.presses)) {
					return cerror.silent('Invalid match history response');
				}
				match.presses = response.presses;
				delete match.presses_deferred;
			}
			latest.callback();
		});
	}

	return { load };
})();

/*@DEV*/
if (typeof module !== 'undefined') module.exports = cmatch_history;
/*/@DEV*/
