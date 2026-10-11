'use strict';

const fingerprints = require('./fingerprints');

class Entity {
	constructor(model, collection, id, tournament) {
		this.model = model;
		this.collection = collection;
		this.id = String(id);
		this.tournament = tournament;
		this.revision = 0;
		this._document = null;
	}
	// Read-only persistence revision. Domain object identity stays stable; NeDB
	// revisions remain separate so an old plan can still validate its input.
	get data() { return this._document; }
	get present() { return this._document !== null; }
	fingerprint(kind = 'document') { return fingerprints.fingerprint(this.collection, this._document, kind); }
	_replace(document) {
		fingerprints.inherit(this.collection, this._document, document);
		this._document = document;
		this.revision++;
	}
	toJSON() { return this._document; }
}

module.exports = Entity;
