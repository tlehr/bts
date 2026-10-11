'use strict';

const Relations = require('./relations');
const Player = require('./player');
const FingerprintIndex = require('./fingerprint_index');

class Tournament {
	constructor(model, key) {
		this.model = model;
		this.key = key;
		this.record = null;
		this.players = new Map();
		this.records = new Map();
		this.relations = new Relations();
		this._registrations = new Map();
		this._normalization = new Map();
		this._normalization_signature = null;
	}
	collection(name) {
		if (!this.records.has(name)) this.records.set(name, new Map());
		return this.records.get(name);
	}
	get matches() { return this.collection('matches'); }
	get data() { return this.record?.data || null; }
	get present() { return this.record?.present || false; }
	get courts() { return this.collection('courts'); }
	get locations() { return this.collection('locations'); }
	get umpires() { return this.collection('umpires'); }
	get tabletoperators() { return this.collection('tabletoperators'); }
	normalization_index(collection) {
		if (!this._normalization.has(collection)) this._normalization.set(collection, new FingerprintIndex());
		return this._normalization.get(collection);
	}
	player(id) {
		id = String(id);
		if (!this.players.has(id)) this.players.set(id, new Player(id, this));
		return this.players.get(id);
	}
}

module.exports = Tournament;
