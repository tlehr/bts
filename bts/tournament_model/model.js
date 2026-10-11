'use strict';

const Tournament = require('./tournament');
const Match = require('./match');
const Court = require('./court');
const Official = require('./official');
const Entity = require('./entity');
const update_registrations = require('./registrations');
const normalization = require('./normalization_fingerprints');

class TournamentModel {
	constructor(db) {
		this.db = db;
		this.tournaments = new Map();
		this._identities = new Map();
	}
	tournament(key) {
		key = String(key ?? 'default');
		if (!this.tournaments.has(key)) this.tournaments.set(key, new Tournament(this, key));
		return this.tournaments.get(key);
	}
	entity(collection, id, tournament) {
		if (!this._identities.has(collection)) this._identities.set(collection, new Map());
		const identities = this._identities.get(collection);
		id = String(id);
		if (!identities.has(id)) {
			const entity = collection === 'matches' ? new Match(this, id, tournament)
				: collection === 'courts' ? new Court(this, id, tournament)
					: collection === 'umpires' ? new Official(this, id, tournament) : new Entity(this, collection, id, tournament);
			identities.set(id, entity);
		}
		return identities.get(id);
	}
	_upsert(collection, document) {
		const key = collection === 'tournaments' ? document.key : document.tournament_key;
		const tournament = this.tournament(key);
		const entity = this.entity(collection, document._id, tournament);
		const old = entity.data;
		if (entity.tournament !== tournament) {
			if (entity instanceof Match) {
				entity.tournament.relations = entity.tournament.relations.with_match(entity.id, old, null);
				entity._links(null);
			}
			entity.tournament.collection(collection).delete(entity.id);
			if (normalization.supported(collection)) entity.tournament.normalization_index(collection).delete(entity.id);
			entity.tournament = tournament;
		}
		tournament.collection(collection).set(entity.id, entity);
		entity._replace(document);
		if (normalization.supported(collection)) tournament.normalization_index(collection).set(entity.id, entity.fingerprint('normalization'));
		if (entity instanceof Match) {
			tournament.relations = tournament.relations.with_match(entity.id,
				old?.tournament_key === document.tournament_key ? old : null, document);
			entity._links(document);
		}
		if (collection === 'tournaments') {
			tournament.record = entity;
			update_registrations(tournament, document.events, old?.events);
			if (old?.key !== document.key) require('../server_diagnostics').remove(old);
			require('../server_diagnostics').set_from_tournament(document);
		}
		return entity;
	}
	_remove(collection, document) {
		const entity = this._identities.get(collection)?.get(String(document._id));
		if (!entity?.present) return;
		const tournament = entity.tournament;
		if (collection === 'tournaments') {
			update_registrations(tournament, null, entity.data.events);
			require('../server_diagnostics').remove(entity.data);
		}
		if (entity instanceof Match) {
			tournament.relations = tournament.relations.with_match(entity.id, entity.data, null);
			entity._links(null);
		}
		tournament.collection(collection).delete(entity.id);
		if (normalization.supported(collection)) tournament.normalization_index(collection).delete(entity.id);
		entity._replace(null);
	}
	_reset(collection, documents) {
		for (const entity of this._identities.get(collection)?.values() || []) {
			if (entity.present) this._remove(collection, entity.data);
		}
		for (const document of documents) this._upsert(collection, document);
	}
}

module.exports = TournamentModel;
