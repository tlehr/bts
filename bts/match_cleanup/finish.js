'use strict';

const reads = require('./reads');

module.exports = async function finish(app, key, id, end_ts, helpers, options = {}) {
	const phase = async (name, work) => {
		const start = process.hrtime.bigint();
		try { return await work(); }
		finally { if (options.score_phase) options.score_phase(`finish_cleanup_${name}`, start); }
	};
	const context = await phase('context', () => reads.context(app, key, id));
	if (!context.match) throw new Error(`Match cannot be fetched for cleanup: ${id}`);
	await phase('players', () => reads.call(helpers, 'remove_player_on_court', app, key, id, end_ts, context));
	await phase('tablets', () => reads.call(helpers, 'remove_tablet_on_court', app, key, id, end_ts, context));
	await phase('officials', () => reads.call(helpers, 'remove_umpire_on_court', app, key, id, end_ts, context));
	await phase('tablet_waitlist', async () => {
		if (context.tournament?.tabletoperator_enabled) {
			// Refresh only this small projection after participant changes.
			const refreshed = await reads.match(app, key, id);
			await reads.call(helpers, 'add_player_to_tabletoperator_list_by_match', app, context.tournament, key, refreshed, end_ts);
		}
	});
	await phase('btp_courts', () => reads.call(helpers, 'update_btp_courts', app, key, context.match));
	return null;
};
