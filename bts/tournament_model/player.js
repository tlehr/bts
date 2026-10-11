'use strict';

const { deepCopy } = require('nedb/lib/model');
const utils = require('../utils');
const PROFILE_FIELDS = require('./profile_fields');
const { hash } = require('./fingerprints');

class Player {
	constructor(id, tournament) {
		this.id = id;
		this.tournament = tournament;
		this.data = {};
		this.matches = new Set();
		this.participations = new Set();
		this._profiles = new Map();
		this._profile_revision = 0;
		this._fingerprint = null;
	}
	_profile(owner, source, authoritative = false) {
		let profile = this._profiles.get(owner);
		if (!profile) this._profiles.set(owner, profile = { source: null, fields: new Map() });
		const previous = profile.source;
		let changed = false;
		for (const field of PROFILE_FIELDS) {
			if (previous && utils.deep_equal(previous[field], source[field])) continue;
			// A newly encountered, older embedded copy must not revert a profile
			// already learned from registration or an updated participation.
			if (source[field] === undefined && previous?.[field] === undefined) continue;
			const revision = !previous && !authoritative && this.data[field] !== undefined ? 0 : ++this._profile_revision;
			profile.fields.set(field, { revision, value: source[field] });
			changed = true;
		}
		profile.source = source;
		if (changed) this._refresh_profile();
	}
	_detach(owner) {
		this._profiles.delete(owner);
		this._refresh_profile();
	}
	_refresh_profile() {
		let changed = false;
		for (const field of PROFILE_FIELDS) {
			let newest;
			for (const profile of this._profiles.values()) {
				const candidate = profile.fields.get(field);
				if (candidate && (!newest || candidate.revision > newest.revision)) newest = candidate;
			}
			if (newest?.value === undefined) {
				if (Object.prototype.hasOwnProperty.call(this.data, field)) { delete this.data[field]; changed = true; }
			} else if (!utils.deep_equal(this.data[field], newest.value)) {
				this.data[field] = deepCopy(newest.value);
				changed = true;
			}
		}
		if (changed) this._fingerprint = null;
	}
	fingerprint() {
		if (this._fingerprint === null) this._fingerprint = hash(['bts-player-profile-v1', this.id, this.data]);
		return this._fingerprint;
	}
	toJSON() { return { id: this.id, ...this.data }; }
}

module.exports = Player;
