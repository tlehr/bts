'use strict';

const { deepCopy } = require('nedb/lib/model');

// Planning uses isolated datastores. Keep every external effect attached to
// that plan until its writes have completed and its input has been validated.
function capture(app, run, resources = {}, command) {
	if (!app?._btp_sync_effects) return false;
	if (app._btp_serializable_effects && !command && !resources.notification) {
		throw new Error('Planner captured an effect without a serializable command');
	}
	app._btp_sync_effects.push({ ...(app._btp_serializable_effects ? {} : { run }),
		resources: deepCopy(resources), ...(command ? { command: deepCopy(command) } : {}) });
	return true;
}

function restore(effect) {
	return { ...effect, run: app => {
		const { target, method, args } = effect.command;
		if (target === 'bupws' && method === 'notify_courts') {
			const notify = require('./bupws').handle_score_change;
			notify(app, args[0], args[1]);
			if (args[2]) notify(app, args[0], args[2]);
			return;
		}
		const allowed = target === 'btp_manager'
			? ['update_score', 'update_players', 'update_courts', 'update_highlight']
			: target === 'match_utils' ? ['queue_auto_execute_preparation_selections',
				'queue_auto_assign_technical_officials_when_available', 'queue_reconcile_player_court_flags',
				'queue_auto_call_matches_on_free_courts', 'auto_call_matches_on_free_courts']
				: target === 'bupws' ? ['handle_score_change'] : [];
		if (!allowed.includes(method)) throw new Error('Unknown planner effect command');
		return require('./' + target)[method](app, ...args);
	} };
}

module.exports = { capture, restore, copy: deepCopy };
