'use strict';

const { promisify } = require('util');
const database = require('../bts/database');

const insert = (store, docs) => promisify(store.insert.bind(store))(docs);
const match = (id, players = [1], tournament_key = 'test', court = 'court') => ({
	_id: id, tournament_key, network_score: [[0, 0]],
	setup: { state: 'ready', court_id: court,
		teams: [{ players: players.map(id => ({ btp_id: id, name: 'Player ' + id, checked_in: false })) }],
	},
});
const registration = players => ({ events: [{ stages: [{ entries: [
	{ team: { players } },
] }] }] });

async function fixture() {
	const db = await database.init_test();
	await insert(db.tournaments, { _id: 'tournament', key: 'test', btp_enabled: true, last_reset_ts: 1 });
	await insert(db.locations, { _id: 'hall', tournament_key: 'test', name: 'Hall' });
	await insert(db.courts, { _id: 'court', tournament_key: 'test', location_id: 'hall', match_id: 'one' });
	await insert(db.matches, [match('one'), match('two', [1, 2], 'test', 'second')]);
	return { db, tournament: db.model.tournament('test') };
}

module.exports = { fixture, insert, match, registration };
