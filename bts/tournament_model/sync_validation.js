'use strict';

const read_barrier = require('../database_read_barrier');

// Visit committed records in executor order without a NeDB scan or deep copy.
// The visitor is synchronous and must not mutate its immutable document input.
module.exports = function attach_sync_validation(model) {
	model.inspect_sync_records = (collection, key, inspect, callback) => {
		const store = model.db[collection];
		const field = collection === 'tournaments' ? 'key' : 'tournament_key';
		const capture = done => {
			// Check at execution, since a TTL index can be added while queued.
			if (Object.keys(store.ttlIndexes || {}).length) {
				return store.find({ [field]: key, $where: function() { return inspect(this); } }, { _id: 1 })
					._exec((error, records) => done(error, error ? undefined : records.length === 0));
			}
			let valid = true;
			try {
				for (const entity of model.tournament(key).collection(collection).values()) {
					if (entity.present && entity.data[field] === key && inspect(entity.data)) valid = false;
				}
			} catch (error) { return done(error); }
			done(null, valid);
		};
		// A synchronous, read-only visitor sees the same committed identities as
		// an ordered capture if every preceding job is also a certified read.
		if (read_barrier.inspect_idle(store).allowed || read_barrier.inspect_readonly(store).allowed) {
			capture((...results) => queueMicrotask(() => callback(...results)));
		} else store.executor.push(read_barrier.certify_read({ this: store, fn: capture, arguments: [callback], diagnostic_name: 'sync_validate_' + collection }));
	};
};
