'use strict';

const storage = require('nedb/lib/storage');
const owners = new WeakMap(), filenames = new Map();
let installed = false;
const elapsed = (start, end) => Math.round(Number(end - start) / 1e5) / 10;

function attach(store, active_record) {
	if (!store.filename || store.persistence.inMemoryOnly) return;
	owners.set(store, active_record); filenames.set(store.filename, new WeakRef(store));
	if (installed) return;
	installed = true;
	const original = storage.appendFile;
	storage.appendFile = function(filename, bytes, ...args) {
		const ref = filenames.get(filename), owner = ref?.deref();
		if (ref && !owner) filenames.delete(filename);
		const record = owner && owners.get(owner)?.();
		const persistence = record?.phase === 'running' && record.persistence?.kind === 'append' ? record.persistence : null;
		if (!persistence || persistence.storage_start_ts != null) return original.call(this, filename, bytes, ...args);
		const started = process.hrtime.bigint();
		persistence.serialization_ms = elapsed(persistence.started, started);
		persistence.storage_start_ts = Date.now();
		persistence.storage_bytes = typeof bytes === 'string' ? Buffer.byteLength(bytes, 'utf8') : bytes.byteLength;
		const callback = args.at(-1);
		if (typeof callback !== 'function') return original.call(this, filename, bytes, ...args);
		args[args.length - 1] = function(...results) {
			persistence.storage_wait_ms = elapsed(started, process.hrtime.bigint());
			persistence.storage_end_ts = Date.now();
			return callback.apply(this, results);
		};
		// Includes libuv/filesystem waiting and callback delivery. It cannot
		// identify physical disk time alone; timestamps allow GC/loop correlation.
		return original.call(this, filename, bytes, ...args);
	};
}

function details(persistence) {
	return Object.fromEntries(['serialization_ms', 'storage_wait_ms', 'storage_start_ts', 'storage_end_ts', 'storage_bytes']
		.filter(key => persistence?.[key] != null).map(key => [key, persistence[key]]));
}

module.exports = { attach, details };
