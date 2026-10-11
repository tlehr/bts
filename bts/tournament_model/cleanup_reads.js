'use strict';

const { deepCopy } = require('nedb/lib/model');

function project_match(doc) {
	if (!doc) return null;
	const { _id, tournament_key, setup, btp_id, btp_match_ids, btp_winner, btp_needsync, team1_won, network_score } = doc;
	return deepCopy({ _id, tournament_key, setup, btp_id, btp_match_ids, btp_winner, btp_needsync, team1_won, network_score });
}

function ordered(db, collection, read, callback) {
	const store = db[collection];
	const capture = done => {
		let value;
		try { value = read(); } catch (error) { return done(error); }
		done(null, value);
	};
	store.executor.push({ this: store, fn: capture, arguments: [callback], diagnostic_name: 'cleanup_read_' + collection });
}

module.exports = function attach_cleanup_reads(model) {
	model.read_cleanup_match = (key, id, callback) => ordered(model.db, 'matches', () => {
		const match = model.tournament(key).matches.get(String(id));
		return project_match(match?.present ? match.data : null);
	}, callback);
	model.read_cleanup_tournament = (key, callback) => ordered(model.db, 'tournaments', () => {
		const data = model.tournament(key).record?.data;
		if (!data) return null;
		const settings = {};
		for (const field of Object.keys(data)) if (field !== 'events') settings[field] = data[field];
		return deepCopy(settings);
	}, callback);
	model.find_cleanup_matches = (key, players, include_blocked, callback) => ordered(model.db, 'matches', () => {
		const tournament = model.tournament(key);
		const ids = new Set();
		for (const player of players) for (const id of tournament.relations.for_player(player)) ids.add(id);
		// Preserve the previous cleanup's repair of already unblocked games,
		// without visiting every unrelated match to discover them.
		if (include_blocked) for (const id of tournament.relations.releasable_blocked_matches()) ids.add(id);
		return [...ids].map(id => tournament.matches.get(id)).filter(match => match?.present)
			.map(match => project_match(match.data));
	}, callback);
	model.read_official_assignments = (key, id, callback) => ordered(model.db, 'matches', () => {
		const official = model.entity('umpires', id, model.tournament(key));
		return [...official.assignments].filter(assignment => assignment.match.present && assignment.match.tournament.key === String(key))
			.map(({ match, role }) => ({ role, match_id: match.id, court_id: match.data.setup?.court_id,
				now_on_court: match.data.setup?.now_on_court === true, state: match.data.setup?.state,
				finished: typeof match.data.team1_won === 'boolean' || !!match.data.btp_winner || !!match.data.btp_needsync }));
	}, callback);
};
