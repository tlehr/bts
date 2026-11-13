'use strict';

const Persistence = require('nedb/lib/persistence');
const model = require('nedb/lib/model');
const storage = require('nedb/lib/storage');
const stores = new WeakMap();

// Install below the diagnostics and staged-compaction append wrappers. Only
// explicitly prepared, immutable document revisions can use an encoded line;
// every other write retains NeDB's normal serializer and current codec hooks.
function attach(store) {
	if (stores.has(store)) return true;
	const persistence = store.persistence;
	if (persistence.persistNewState !== Persistence.prototype.persistNewState) return false;
	const original = persistence.persistNewState, lines = new WeakMap();
	stores.set(store, lines);
	persistence.persistNewState = function(documents, callback = () => {}) {
		if (this.inMemoryOnly || !documents.some(document => lines.has(document))) return original.call(this, documents, callback);
		let bytes = '';
		for (const document of documents) {
			const prepared = lines.get(document);lines.delete(document);
			const encoded = prepared?.serialize === model.serialize ? prepared.bytes : model.serialize(document);
			bytes += this.afterSerialization(encoded) + '\n';
		}
		if (!bytes.length) return callback(null);
		return storage.appendFile(this.filename, bytes, 'utf8', callback);
	};
	return true;
}

function prepare(store, document) {
	const lines = stores.get(store);
	if (!lines || store.persistence.inMemoryOnly || !require('./offload/profile').enabled('sync_prepared_append')) return;
	const bytes = model.serialize(document);
	lines.set(document, { serialize: model.serialize, bytes, byte_length: Buffer.byteLength(bytes) + 1 });
	return true;
}

function byte_length(store, document) { return stores.get(store)?.get(document)?.byte_length; }

module.exports = { attach, prepare, byte_length };
