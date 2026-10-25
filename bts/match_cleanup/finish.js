'use strict';

const reads = require('./reads');
const pending = new WeakMap();

async function finish(app, key, id, end_ts, helpers, options) {
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
		if (context.tournament?.tabletoperator_enabled && context.match.tabletoperator_finish_ts == null) {
			// Refresh only this small projection after participant changes.
			const refreshed = await reads.match(app, key, id);
			await reads.call(helpers, 'add_player_to_tabletoperator_list_by_match', app, context.tournament, key, refreshed, end_ts);
			// A corrected end time is still the same played match. Only an
			// explicit result reset/reactivation opens a new tablet duty.
			await reads.call(app.db.matches, 'update', { _id: id, tournament_key: key },
				{ $set: { tabletoperator_finish_ts: end_ts } }, {});
		}
	});
	await phase('btp_courts', () => reads.call(helpers, 'update_btp_courts', app, key, context.match));
	return null;
}

module.exports = function serialized_finish(app, key, id, end_ts, helpers, options = {}) {
	let jobs = pending.get(app);
	if (!jobs) pending.set(app, jobs = new Map());
	const identity = JSON.stringify([key, id]);
	const job = (jobs.get(identity) || Promise.resolve()).catch(() => {}).then(() => finish(app, key, id, end_ts, helpers, options));
	jobs.set(identity, job);
	const cleanup = () => { if (jobs.get(identity) === job) jobs.delete(identity); };
	job.then(cleanup, cleanup);
	return job;
};
