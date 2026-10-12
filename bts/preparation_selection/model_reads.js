'use strict';

const profile = require('../offload/profile');
const tournament_model = require('../tournament_model');

function supported(app, collection, immutable) {
	const store = app.db[collection];
	return immutable && profile.enabled('preparation_reads') && store?.executor &&
		typeof store.getAllData === 'function' && typeof store.updateIndexes === 'function';
}

async function read(app, key, collection, immutable = false) {
	if (supported(app, collection, immutable)) {
		const documents = (await tournament_model.attach(app.db).snapshot(key, [collection]))[collection];
		return collection === 'tournaments' ? documents[0] || null : documents;
	}
	return collection === 'tournaments' ? app.db[collection].findOne_async({ key })
		: app.db[collection].find_async({ tournament_key: key });
}

module.exports = { read, supported };
