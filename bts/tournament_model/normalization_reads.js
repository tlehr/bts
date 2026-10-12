'use strict';

const { deepCopy } = require('nedb/lib/model');
const normalization = require('./normalization_fingerprints');
const { certify_read } = require('../database_read_barrier');

function match_projection(document) {
	const { _id, end_ts, team1_won, btp_winner, btp_needsync, setup } = document;
	return { _id, end_ts, team1_won, btp_winner, btp_needsync, setup };
}

function tournament_projection(document) {
	const { _id, btp_settings, last_reset_ts } = document;
	return { _id, btp_settings, last_reset_ts };
}

// Capturing each digest and its optional documents in the same executor task
// preserves datastore ordering. The fast path never visits the document maps.
module.exports = async function normalization_state(model, key, include_documents = false) {
	const tournament = model.tournament(key);
	const result = {};
	const digests = await Promise.all(normalization.COLLECTIONS.map(collection => new Promise((resolve, reject) => {
		const store = model.db[collection];
		const capture = done => {
			let digest;
			try {
				digest = tournament.normalization_index(collection).hash;
				if (include_documents) {
					if (collection === 'tournaments') {
						result.tournament = tournament.record?.present && tournament.record.data.key === String(key)
							? deepCopy(tournament_projection(tournament.record.data)) : null;
					} else {
						result[collection] = [...tournament.collection(collection).values()].filter(entity => entity.present)
							.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
							.map(entity => deepCopy(collection === 'matches' ? match_projection(entity.data) : entity.data));
					}
				}
			} catch (error) { return done(error); }
			done(null, digest);
		};
		store.executor.push(certify_read({ this: store, fn: capture, diagnostic_name: 'normalization_read_' + collection, arguments: [
			(error, digest) => error ? reject(error) : resolve(digest),
		] }));
	})));
	const key_signature = digests.join(':');
	if (tournament._normalization_signature?.key !== key_signature) {
		tournament._normalization_signature = { key: key_signature, value: normalization.signature(digests) };
	}
	result.signature = tournament._normalization_signature.value;
	return result;
};
