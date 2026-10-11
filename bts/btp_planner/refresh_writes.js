'use strict';

const Datastore = require('nedb');
const model = require('nedb/lib/model');
const registered = new WeakMap();
const methods = ['insert', 'update', 'remove', 'insert_async', 'update_async', 'remove_async',
	'_insert', '_update', '_remove', 'getCandidates', 'prepareDocumentForInsertion', 'addToIndexes', 'updateIndexes', 'removeFromIndexes'];
const now = () => Number(process.hrtime.bigint()) / 1e6;

// Only the factory's private, disposable in-memory stores are registered.
// Modified writers, timestamps and TTLs retain the ordinary NeDB path.
function register(store, lifecycle) {
	if (!(store instanceof Datastore) || !store.inMemoryOnly || store.filename) throw new Error('Refresh requires a private memory store');
	registered.set(store, { methods: methods.map(name => store[name]), lifecycle,
		persistence: store.persistence, persist: store.persistence.persistNewState });
}

function supported(store) {
	const entry = registered.get(store);
	return !!entry && store.inMemoryOnly && !store.filename && !store.timestampData &&
		store.persistence === entry.persistence && store.persistence.inMemoryOnly && !store.persistence.filename &&
		store.persistence.persistNewState === entry.persist &&
		!Object.keys(store.ttlIndexes).length && methods.every((name, i) => store[name] === entry.methods[i]);
}

function apply(store, operation) {
	let id = operation.id;
	if (operation.kind === 'insert') {
		const document = store.prepareDocumentForInsertion(operation.document);
		store.addToIndexes(document);
		id = document._id;
	} else if (operation.kind === 'update') {
		const current = store.indexes._id.getMatching(id)[0];
		if (!current) throw new Error('Refresh lost document ' + operation.id);
		const document = model.modify(current, operation.document);
		store.updateIndexes([{ oldDoc: current, newDoc: document }]);
	} else if (operation.kind === 'remove') {
		const current = store.indexes._id.getMatching(id)[0];
		if (current) store.removeFromIndexes(current);
	} else throw new Error('Unknown refresh operation');
	store._btp_dirty.add(id);
}

async function write(store, operations, metrics) {
	let position = 0;
	while (position < operations.length) {
		const queued = now(), entry = registered.get(store);
		entry.lifecycle.start();
		await new Promise((resolve, reject) => {
			let settled = false;
			const finish = error => {
				if (settled) return;
				settled = true;
				entry.lifecycle.finish(error);
				if (error) reject(error); else resolve();
			};
			try { store.executor.push({
			this: store, diagnostic_name: 'planning_refresh',
			arguments: [finish],
			fn: function(done) {
				const start = now();
				let count = 0, error;
				try {
					if (!supported(store)) throw new Error('Private refresh store changed while queued');
					do { apply(store, operations[position++]); count++; }
					while (position < operations.length && count < 32 && now() - start < 2);
				} catch (failure) { error = failure; }
				if (metrics) {
					const elapsed = now() - start;
					metrics.refresh_groups++;
					metrics.refresh_queue_wait_ms += start - queued;
					metrics.refresh_apply_ms += elapsed;
					metrics.refresh_max_group_ms = Math.max(metrics.refresh_max_group_ms, elapsed);
				}
				done(error);
			},
			}); } catch (error) { finish(error); }
		});
	}
}

module.exports = { register, supported, write };
