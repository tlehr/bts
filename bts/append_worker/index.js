'use strict';

const path = require('path');
const storage = require('nedb/lib/storage');
const WorkerClient = require('../offload/client');
const profile = require('../offload/profile');
const client = new WorkerClient('database_append', path.join(__dirname, 'worker.js'));
const files = new Map();
const registered = new WeakSet();
let installed = false, warming = null;

function failure(store) { return files.get(store.filename)?.failure || null; }

// Keep the same open/write/close operation and callback boundary as NeDB.
// The worker avoids delivering each filesystem step through a busy main loop;
// it retains no descriptors that could point at a pre-compaction file.
function install() {
	if (!installed) {
		installed = true;
		const original = storage.appendFile;
		storage.appendFile = function(filename, bytes, ...args) {
			const state = files.get(filename), owner = state?.owner.deref();
			const callback = args.at(-1), encoding = args.length === 2 ? args[0] : undefined;
			if (state?.failure && typeof callback === 'function') return queueMicrotask(() => callback(state.failure));
			if (state && !owner) files.delete(filename);
			if (!owner || !profile.enabled('database_append') || typeof callback !== 'function' ||
				args.length > 2 || encoding != null && typeof encoding !== 'string') return original.call(this, filename, bytes, ...args);
			// A rejected/failed append is reported once, never retried: the worker
			// may have written bytes before losing its acknowledgement.
			const execute = () => {
				if (state.failure) return callback(state.failure);
				return client.run({ filename, bytes, encoding, diagnostics:!!require('../performance/traces').capture() }).then(() => callback(null), error => {
				if (typeof error.code !== 'string' || !/^E[A-Z0-9]+$/.test(error.code)) {
					// A timed-out or lost worker can still have reached the file.
					// Freeze this file's appends and rewrites until process restart;
					// another worker must never overtake that uncertain operation.
					state.failure = Object.assign(new Error('Database append outcome is unknown; restart BTS before writing again: ' + error.message),
						{ code: 'BTS_APPEND_UNCERTAIN', cause: error });
				}
				callback(state.failure || error);
				});
			};
			// Index-definition writes can bypass NeDB's document executor. Keep
			// them behind the same result boundary, including failure handling.
			const operation = state.tail ? state.tail.then(execute) : execute();
			const tail = state.tail = Promise.resolve(operation).then(() => {
				if (state.tail === tail) state.tail = null;
			}, error => {
				if (state.tail === tail) state.tail = null;
				queueMicrotask(() => { throw error; });
			});
		};
	}
}

function attach(store) {
	if (!store.filename || store.persistence.inMemoryOnly) return false;
	const state = files.get(store.filename) || { failure: null };
	state.owner = new WeakRef(store);files.set(store.filename, state);
	install();
	if (!registered.has(store)) {
		registered.add(store);
		const persist = store.persistence.persistCachedDatabase;
		store.persistence.persistCachedDatabase = function(callback = () => {}) {
			const error = failure(store);
			if (error) return queueMicrotask(() => callback(error));
			return persist.call(this, callback);
		};
	}
	if (profile.enabled('database_append') && !warming) {
		warming = client.run({ warmup: true }).catch(error => {
			console.error('[bts] append worker warmup failed:', error.message); // eslint-disable-line no-console
		});
	}
	return true;
}

module.exports = { install, attach, failure, client };
