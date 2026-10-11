'use strict';

const { hash } = require('./fingerprints');

// Only changed member hashes invalidate the aggregate. An unchanged read uses
// the cached digest without walking documents or even the member hashes.
class FingerprintIndex {
	constructor() { this._records = new Map(); this._hash = null; }
	set(id, digest) {
		id = String(id);
		if (this._records.get(id) === digest) return;
		this._records.set(id, digest);
		this._hash = null;
	}
	delete(id) {
		if (this._records.delete(String(id))) this._hash = null;
	}
	get hash() {
		if (this._hash === null) {
			this._hash = hash(['bts-fingerprint-index-v1', [...this._records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
		}
		return this._hash;
	}
}

module.exports = FingerprintIndex;
