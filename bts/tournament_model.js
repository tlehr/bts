'use strict';

const TournamentModel = require('./tournament_model/model');
const DatastoreBinding = require('./tournament_model/datastore');
const { player_ids } = require('./tournament_model/player_ids');
const models = new WeakMap();
const COLLECTIONS = ['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators'];

function attach(db) {
	if (models.has(db)) return models.get(db);
	const model = new TournamentModel(db);
	models.set(db, model);
	const binding = new DatastoreBinding(model);
	model.snapshot = binding.snapshot.bind(binding);
	model.find_matches_by_players = binding.find_matches_by_players.bind(binding);
	require('./tournament_model/cleanup_reads')(model);
	Object.defineProperty(db, 'model', { value: model, configurable: true });
	for (const collection of COLLECTIONS) {
		const datastore = db[collection];
		if (datastore?.executor && typeof datastore.getAllData === 'function' && typeof datastore.updateIndexes === 'function') {
			binding._watch(collection, datastore);
		}
	}
	if (require('./tournament_model/normalization_fingerprints').COLLECTIONS.every(collection =>
		db[collection]?.executor && typeof db[collection].getAllData === 'function' && typeof db[collection].updateIndexes === 'function')) {
		model.normalization_state = (key, include_documents) => require('./tournament_model/normalization_reads')(model, key, include_documents);
	}
	if (['matches', 'tournaments', 'courts'].every(collection => db[collection]?.executor &&
		typeof db[collection].getAllData === 'function' && typeof db[collection].updateIndexes === 'function')) {
		require('./tournament_model/score_reads')(model);
	}
	return model;
}

module.exports = { attach, player_ids };
