'use strict';

const { deepCopy } = require('nedb/lib/model');
const tournament_projection = require('../panel_tournament_projection');
const COLLECTIONS = { tournament: 'tournaments', court: 'courts', match: 'matches' };

module.exports = function attach_display_reads(model) {
	model.read_display_context_part = (part, key, id, callback) => {
		const collection = COLLECTIONS[part];
		const store = model.db[collection];
		const capture = done => {
			// TTL queries can remove expired records. Retain NeDB's normal cursor
			// inside this executor slot, including TTL indexes added after enqueue.
			if (Object.keys(store.ttlIndexes).length) {
				const query = part === 'tournament' ? { key } : { tournament_key: key, _id: id };
				const projection = part === 'tournament' ? tournament_projection : {};
				return store.findOne(query, projection)._exec(done);
			}
			let value;
			try {
				const tournament = model.tournament(key);
				const entity = part === 'tournament' ? tournament.record : tournament.collection(collection).get(String(id));
				const data = entity?.present ? entity.data : null;
				const key_field = part === 'tournament' ? 'key' : 'tournament_key';
				if (!data || data[key_field] !== key) value = null;
				else if (part === 'tournament') {
					const settings = { _id: data._id };
					for (const field of Object.keys(tournament_projection)) {
						if (data[field] !== undefined) settings[field] = data[field];
					}
					value = deepCopy(settings);
				} else value = deepCopy(data);
			} catch (error) { return done(error); }
			done(null, value);
		};
		// Canonical objects change before persistence finishes. Never bypass the
		// executor or read a score/court snapshot cached by an earlier request.
		// Leave this task uncertified: its TTL fallback is a potential writer.
		store.executor.push({ this: store, fn: capture, arguments: [callback], diagnostic_name: 'display_context_' + part });
	};
};
