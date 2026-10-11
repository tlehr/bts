'use strict';

const { deepCopy } = require('nedb/lib/model');
const utils = require('../utils');
const PROFILE_FIELDS = require('./profile_fields');

class Participation {
	constructor(match, slot, player) {
		this.match = match;
		this.slot = slot;
		this.player = player;
		this.data = {};
		this._source = null;
	}
	_replace(source, player) {
		if (this.player !== player) {
			this.player.participations.delete(this);
			this.player._detach(this);
			this.player = player;
		}
		player.participations.add(this);
		player._profile(this, source);
		// Check-in, pause and assignment flags belong to the participation. They
		// must never overwrite another match's per-match check-in on the Player.
		for (const field of Object.keys(this.data)) if (!(field in source)) delete this.data[field];
		for (const [field, value] of Object.entries(source)) {
			if (!PROFILE_FIELDS.has(field) && field !== 'btp_id') {
				if (!utils.deep_equal(this.data[field], value)) this.data[field] = deepCopy(value);
			}
		}
		this._source = source;
	}
	toJSON() { return { ...this.player.data, ...this.data, btp_id: this._source?.btp_id }; }
}

module.exports = Participation;
