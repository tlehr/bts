'use strict';

const { deepCopy } = require('nedb/lib/model');

// NeDB-specific lifecycle hooks and ordered, read-only snapshots.
class DatastoreBinding {
	constructor(model) { this.model = model; this.db = model.db; }

	_reset(collection, datastore) {
		this.model._reset(collection, datastore.getAllData());
	}
	_watch(collection, datastore) {
		if (collection === 'tournaments') require('./registration_rollback').attach(datastore, this.model);
		const wrap = (name, changed) => {
			const original = datastore[name];
			datastore[name] = (...args) => {
				const result = original.apply(datastore, args);
				changed(...args);
				return result;
			};
		};
		// Observe index commits, which cover callback/async writers, upserts and
		// NeDB's own batch rollback. Reads still preserve their normal copy semantics.
		wrap('addToIndexes', documents => {
			for (const document of Array.isArray(documents) ? documents : [documents]) this.model._upsert(collection, document);
		});
		wrap('updateIndexes', (old, next) => {
			for (const pair of Array.isArray(old) ? old : [{ oldDoc: old, newDoc: next }]) this.model._upsert(collection, pair.newDoc);
		});
		wrap('removeFromIndexes', documents => {
			for (const document of Array.isArray(documents) ? documents : [documents]) this.model._remove(collection, document);
		});
		wrap('resetIndexes', () => this._reset(collection, datastore));
		this._reset(collection, datastore);
	}
	find_matches_by_players(key, players, callback) {
		const store = this.db.matches;
		const capture = done => {
			let docs;
			try {
				const tournament = this.model.tournament(key);
				const ids = new Set();
				for (const player of players) for (const id of tournament.relations.for_player(player)) ids.add(id);
				docs = [...ids].map(id => tournament.matches.get(id)).filter(match => match?.present && match.data.tournament_key === key)
					.map(match => deepCopy(match.data));
			} catch (error) { return done(error); }
			done(null, docs);
		};
		store.executor.push({ this: store, fn: capture, arguments: [callback], diagnostic_name: 'player_match_lookup' });
	}
	async snapshot(key, collections) {
		const tournament = this.model.tournament(key);
		const result = {};
		await Promise.all(collections.map(collection => new Promise((resolve, reject) => {
			const capture = done => {
				try {
					const field = collection === 'tournaments' ? 'key' : 'tournament_key';
					result[collection] = [...tournament.collection(collection).values()].filter(entity => entity.present && entity.data[field] === key)
						.map(entity => entity.data).sort((a, b) => String(a._id).localeCompare(String(b._id)));
					if (collection === 'matches') Object.defineProperty(result, 'relations', { value: tournament.relations });
					done(null);
				} catch (error) { done(error); }
			};
			// Preserve datastore write ordering without scanning or copying its docs.
			this.db[collection].executor.push({ this: this.db[collection], fn: capture, diagnostic_name: 'sync_snapshot_' + collection,
				arguments: [error => error ? reject(error) : resolve()] });
		})));
		return result;
	}
}

module.exports = DatastoreBinding;
