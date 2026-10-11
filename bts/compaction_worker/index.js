'use strict';

const path = require('path');
const storage = require('nedb/lib/storage');
const WorkerClient = require('../offload/client');
const profile = require('../offload/profile');
const timing = require('../offload/timing');
const client = new WorkerClient('compaction_serialize', path.join(__dirname, 'worker.js'));
const states = new WeakMap();
let next_session = 0;

function input(store) {
	return { documents: store.getAllData(), indexes: Object.keys(store.indexes).filter(key => key !== '_id')
		.map(fieldName => ({ fieldName, unique: store.indexes[fieldName].unique, sparse: store.indexes[fieldName].sparse })) };
}

function encode(store, collection, snapshot = input(store)) {
	let state = states.get(store);
	if (!state) { state = { session: ++next_session }; states.set(store, state); }
	// A manual rewrite can overlap preparation of an automatic staged rewrite.
	// Serialize session deltas so each payload uses the actual worker baseline.
	const result = (state.tail || Promise.resolve()).then(() => encode_snapshot(collection, snapshot, state));
	state.tail = result.catch(() => {});
	return result;
}

async function encode_snapshot(collection, snapshot, state) {
	const seed = !state.source || state.generation !== client.generation;
	const old = new Map(seed ? [] : state.source.map(doc => [doc._id, doc]));
	const upserts = [];
	for (const doc of snapshot.documents) {
		if (old.get(doc._id) !== doc) upserts.push(doc);
		old.delete(doc._id);
	}
	const payload = { session: state.session, seed, upserts, removed: [...old.keys()],
		order: snapshot.documents.map(doc => doc._id), indexes: snapshot.indexes };
	const context = { collection, seed, input_documents: snapshot.documents.length, input_upserts: upserts.length };
	let result = await client.run(payload, context);
	if (result.needs_seed) result = await client.run({ ...payload, seed: true, upserts: snapshot.documents }, { ...context, seed: true, reseed: true });
	state.source = snapshot.documents; state.generation = client.generation;
	return Buffer.from(result.bytes);
}

// Install before loadDatabase so startup compaction uses the same path too.
// The caller certifies identity serialization; custom hooks retain NeDB's codec.
function attach(store, collection, options = {}) {
	const persistence = store.persistence, original = persistence.persistCachedDatabase;
	persistence.persistCachedDatabase = function(callback = () => {}) {
		require('./staged').invalidate(store);
		if (!profile.enabled('compaction') || this.inMemoryOnly || options.identity_serialization !== true) {
			const measured = !this.inMemoryOnly && timing.start('compaction', 'main', { collection });
			try {
				return original.call(this, error => { if (measured) measured.finish(error); callback(error); });
			} catch (error) { if (measured) measured.finish(error); throw error; }
		}
		const started = timing.start('compaction', 'worker', { collection });
		// NeDB owns the executor throughout, so no update or append can overtake
		// this snapshot or rewrite. The worker never receives a filename.
		encode(store, collection).then(bytes => {
			storage.crashSafeWriteFile(this.filename, bytes, error => {
				if (!error) store.emit('compaction.done');
				if (started) started.finish(error, { output_bytes: bytes.length });
				callback(error || null);
			});
		}, error => { if (started) started.finish(error); callback(error); });
	};
	if (options.identity_serialization === true) require('./staged').register(store, { input, encode,
		async encode_records(documents, collection_name) {
			return Buffer.from(await client.run({ documents, indexes: [] }, { collection: collection_name, journal: true }));
		},
	});
}

module.exports = { attach, input, encode, client };
