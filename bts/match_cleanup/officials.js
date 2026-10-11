'use strict';

const reads = require('./reads');

async function assignments(app, key, id) {
	if (app.db.model?.read_official_assignments) return reads.call(app.db.model, 'read_official_assignments', key, id);
	const matches = await reads.call(app.db.matches, 'find', { tournament_key: key,
		$or: [{ 'setup.umpire._id': id }, { 'setup.service_judge._id': id }] });
	return matches.flatMap(match => ['umpire', 'service_judge'].filter(role => match.setup?.[role]?._id === id)
		.map(role => ({ role, match_id: match._id, court_id: match.setup.court_id, now_on_court: match.setup.now_on_court === true,
			state: match.setup.state, finished: typeof match.team1_won === 'boolean' || !!match.btp_winner || !!match.btp_needsync })));
}

module.exports = async function release_officials(app, key, id, end_ts, provided, helpers) {
	const { match, tournament } = await reads.context(app, key, id, provided);
	const wanted = new Map();
	for (const role of ['umpire', 'service_judge']) {
		const official_id = match?.setup?.[role]?._id;
		if (official_id != null) wanted.set(official_id, role);
	}
	const results = await Promise.allSettled([...wanted].map(async ([official_id, role]) => {
		// The embedded match copy can predate profile changes or a subsequent
		// assignment. Read the current record and only its linked matches.
		const [official, linked] = await Promise.all([
			reads.call(app.db.umpires, 'findOne', { tournament_key: key, _id: official_id }),
			assignments(app, key, official_id),
		]);
		if (!official) return; // A removed official must not be recreated.
		const remaining = linked.filter(assignment => assignment.match_id !== id && !assignment.finished);
		const active = remaining.filter(assignment => assignment.now_on_court);
		const other_court = ['umpire_on_court', 'service_judge_on_court'].some(field => official[field] &&
			official[field] !== true && official[field] !== match.setup.court_id);
		if (!active.length && !other_court) {
			helpers.apply_official_on_court_release(official, role, end_ts, {
				tournament, official_rotation_mode: tournament?.official_rotation_mode || 'umpire_and_service_judge',
				technical_official_break_after_assignment_ms: helpers.get_technical_official_break_after_assignment_ms(tournament),
			});
		} else {
			for (const performed_role of ['umpire', 'service_judge']) {
				const field = `${performed_role}_on_court`;
				if (official[field] === match.setup.court_id || official[field] === true) official[field] = null;
			}
			for (const assignment of active) official[`${assignment.role}_on_court`] = assignment.court_id || true;
			if (active.length) { official.court_id = active[0].court_id; official.status = 'oncourt'; }
		}
		for (const planned_role of ['umpire', 'service_judge']) {
			official[`is_planed_as_${planned_role}`] = remaining.some(assignment =>
				assignment.role === planned_role && !assignment.now_on_court && !!assignment.state);
		}
		await new Promise((resolve, reject) => helpers.update_umpire(app, key, official, error => error ? reject(error) : resolve()));
	}));
	const failure = results.find(result => result.status === 'rejected');
	if (failure) throw failure.reason;
};
