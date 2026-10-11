'use strict';

const profile = require('../offload/profile');
const tournament_model = require('../tournament_model');

function supports_model(db) {
	return ['courts', 'matches'].every(collection => {
		const store = db[collection];
		// TTL queries may delete expired records; immutable model reads must not
		// bypass that behaviour. Partial adapters keep their existing query path.
		return store?.executor && typeof store.getAllData === 'function' && typeof store.updateIndexes === 'function' &&
			!Object.keys(store.ttlIndexes || {}).length;
	});
}

async function inspect(app, tournament, timing) {
	const key = tournament.key;
	const model = profile.enabled('preparation_reads') && supports_model(app.db) ? tournament_model.attach(app.db) : null;
	const read_source = model ? 'object_model' : 'database';
	async function read(collection) {
		const done = timing?.step('status_read_' + collection, { read_source: collection === 'locations' ? 'database' : read_source });
		let error, documents;
		try {
			if (model && collection !== 'locations') documents = (await model.snapshot(key, [collection]))[collection];
			else documents = await new Promise((resolve, reject) => {
				const callback = (err, values) => err ? reject(err) : resolve(values);
				if (collection === 'locations') app.db.locations.find({ tournament_key: key }).sort({ name: 1 }).exec(callback);
				else app.db[collection].find({ tournament_key: key }, callback);
			});
			return documents || [];
		} catch (err) { error = err; throw err; }
		finally { done?.(error, { documents: documents?.length }); }
	}
	// Preserve the original read order and executor barriers. Only the copying
	// of court/match documents is removed; location ordering remains unchanged.
	const locations = await read('locations');
	const courts = await read('courts');
	const matches = await read('matches');
	const status_tournament = { ...tournament, courts, matches };
	const calculate = () => locations.filter(location => location?._id &&
		Number(require('../match_automation').calculate_location_preparation_status(status_tournament, location._id)?.missing_preparation_count || 0) > 0);
	const runnable_locations = timing ? timing.sync('status_calculation', { locations: locations.length, matches: matches.length }, calculate) : calculate();
	return { locations, runnable_locations, read_source };
}

module.exports = { inspect };
