'use strict';

const Entity = require('./entity');

class Court extends Entity {
	constructor(model, id, tournament) {
		super(model, 'courts', id, tournament);
		this.matches = new Set();
	}
	get match() {
		return this.data?.match_id != null ? this.model.entity('matches', this.data.match_id, this.tournament) : null;
	}
	get location() {
		return this.data?.location_id != null ? this.model.entity('locations', this.data.location_id, this.tournament) : null;
	}
}

module.exports = Court;
