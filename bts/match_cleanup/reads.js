'use strict';

const { promisify } = require('util');

const call = (object, method, ...args) => promisify(object[method].bind(object))(...args);

function match(app, key, id) {
	return app.db.model?.read_cleanup_match ? call(app.db.model, 'read_cleanup_match', key, id)
		: call(app.db.matches, 'findOne', { tournament_key: key, _id: id });
}

async function context(app, key, id, provided) {
	if (provided) return provided;
	const model = app.db.model;
	const [current_match, tournament] = await Promise.all([
		match(app, key, id),
		model?.read_cleanup_tournament ? call(model, 'read_cleanup_tournament', key) : call(app.db.tournaments, 'findOne', { key }),
	]);
	return { match: current_match, tournament };
}

function matches(app, key, players, include_blocked) {
	if (app.db.model?.find_cleanup_matches) return call(app.db.model, 'find_cleanup_matches', key, players, include_blocked);
	return call(app.db.matches, 'find', { tournament_key: key });
}

module.exports = { call, context, match, matches };
