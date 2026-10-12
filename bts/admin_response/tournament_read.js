'use strict';

const { certify_read } = require('../database_read_barrier');

// Real WebSocket responses only read these nested revisions before encoding.
// Detach the response root for annotations; retain ordinary copies for callers
// that receive mutable response objects through the legacy callback API.
module.exports = function read(db, key, immutable, callback) {
	const store = db.tournaments;
	if (!immutable || !(store instanceof require('nedb'))) return store.findOne({ key }, callback);
	const model = require('../tournament_model').attach(db);
	const capture = done => {
		if (Object.keys(store.ttlIndexes || {}).length) return store.findOne({ key })._exec(done);
		const record = model.tournament(key).record;
		const data = record?.present && record.data.key === key ? record.data : null;
		done(null, data ? { ...data } : null);
	};
	store.executor.push(certify_read({ this: store, fn: capture, diagnostic_name: 'admin_tournament_read', arguments: [callback] }));
};
