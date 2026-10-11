'use strict';

const FingerprintIndex = require('./fingerprint_index');
const { calculate, hash } = require('./fingerprints');

const COLLECTIONS = ['tournaments', 'matches', 'umpires'];
const supported = collection => COLLECTIONS.includes(collection);
const signature = digests => hash(['bts-normalization-v1', digests]);

// Working snapshots are mutable. Hash their final values directly rather than
// caching them as immutable datastore revisions. Concurrent external writes
// must not be silently accepted as if this pass had processed them.
function snapshot_signature(snapshot) {
	return signature(COLLECTIONS.map(collection => {
		const index = new FingerprintIndex();
		const documents = collection === 'tournaments' ? [snapshot.tournament].filter(Boolean) : snapshot[collection];
		for (const document of documents) index.set(document._id, calculate(collection, document, 'normalization'));
		return index.hash;
	}));
}

module.exports = { COLLECTIONS, supported, signature, snapshot_signature };
