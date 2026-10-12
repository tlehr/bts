'use strict';

const Datastore = require('nedb');
const model = require('nedb/lib/model');
const certified = new WeakMap();
const methods = ['insert', 'update', 'remove', 'update_async', 'remove_async', '_insert', '_update', '_remove'];

function certify(store) {
	if (!(store instanceof Datastore)) return;
	for (const name of ['insert', 'update', 'remove', '_insert', '_update', '_remove']) {
		if (store[name] !== Datastore.prototype[name]) return;
	}
	certified.set(store, methods.map(name => store[name]));
}

function supported(store) {
	const original = certified.get(store);
	return !!original && !Object.keys(store.ttlIndexes || {}).length &&
		methods.every((name, i) => store[name] === original[i]);
}

function restore(store, originals) {
	// Remove the entire changed set first so restoring unique values cannot
	// collide with a value held by another changed record.
	const changed = new Map();
	for (const [id, original] of originals) {
		const current = store.indexes._id.getMatching(id)[0];
		if (current === original) continue;
		changed.set(id, original);
		if (current) {
			// Preserve canonical profile owners until the before-image is applied.
			// A truly new record still needs the ordinary removal hook.
			if (original) Datastore.prototype.removeFromIndexes.call(store, current);
			else store.removeFromIndexes(current);
		}
	}
	for (const doc of changed.values()) if (doc) store.addToIndexes(doc);
}

// One executor barrier and append per group; normal NeDB model validation and
// index hooks still update the canonical entities. No public read sees the
// staged indexes before persistence completes. Resource locks remain unchanged.
function write(store, changes, query_for, prepared = new Map(), options = {}) {
	return new Promise((resolve, reject) => store.executor.push({
		this: store, diagnostic_name: options.diagnostic_name || 'sync_batch_write', arguments: [(error, stats) => error ? reject(error) : resolve(stats)],
		fn: function(done) {
			if (options.fallback && (store.timestampData || !supported(store))) return options.fallback(done);
			const originals = new Map(), documents = [];
			const profiles = new Map();
			const rollback = () => {
				restore(store, originals);
				for (const reset of profiles.values()) if (reset) reset();
			};
			const stats = { prepared_writes: 0, prepared_fallbacks: 0 };
			try {
				for (const change of changes) {
					const old = store.indexes._id.getMatching(change.id)[0];
					const ready = typeof prepared === 'function' ? prepared(change, old) : prepared.get(change);
					if (!originals.has(change.id)) originals.set(change.id, old);
					if (change.collection === 'tournaments' && !profiles.get(change.id)) {
						profiles.set(change.id, require('../tournament_model/registration_rollback').capture(store, old, ready?.document || change.after));
					}
					if (change.before && (!old || !model.match(old, query_for(change)))) {
						throw new Error(`BTP sync lost ${change.collection}/${change.id}`);
					}
					if (!change.after) {
						if (old) store.removeFromIndexes(old);
						documents.push({ $$deleted: true, _id: change.id });
					} else if (!change.before) {
						const doc = store.prepareDocumentForInsertion(change.after);
						store.addToIndexes(doc); documents.push(doc);
					} else {
						// A queued writer may have replaced the baseline after validation.
						// Recompute the patch normally rather than losing that update.
						const doc = ready?.before === old ? ready.document : model.modify(old, change.update);
						if (ready) { if (ready.before === old) stats.prepared_writes++; else stats.prepared_fallbacks++; }
						if (store.timestampData) { doc.createdAt = old.createdAt; doc.updatedAt = new Date(); }
						store.updateIndexes([{ oldDoc: old, newDoc: doc }]); documents.push(doc);
					}
				}
			} catch (error) {
				try { rollback(); }
				catch (rollback) { error.message += `; rollback failed: ${rollback.message}`; }
				return done(error);
			}
			const persisted = error => {
				if (!error) {
					if (options.return_records) stats.records = documents;
					return done(null, stats);
				}
				try { rollback(); }
				catch (rollback) { error.message += `; rollback failed: ${rollback.message}`; return done(error); }
				// An append can fail after writing a prefix. Append before-images too,
				// so a reload restores the same state as the canonical objects.
				const before_images = [...originals].map(([id, doc]) => doc || { $$deleted: true, _id: id });
				try {
					store.persistence.persistNewState(before_images, rollback_error => {
						if (rollback_error) error.message += `; rollback failed: ${rollback_error.message}`;
						done(error);
					});
				} catch (rollback_error) { error.message += `; rollback failed: ${rollback_error.message}`; done(error); }
			};
			try { store.persistence.persistNewState(documents, persisted); }
			catch (error) { persisted(error); }
		},
	}));
}

module.exports = { certify, supported, write };
