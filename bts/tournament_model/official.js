'use strict';

const Entity = require('./entity');

class Official extends Entity {
	constructor(model, id, tournament) {
		super(model, 'umpires', id, tournament);
		this.matches = new Set();
		this.assignments = new Set();
	}
}

module.exports = Official;
