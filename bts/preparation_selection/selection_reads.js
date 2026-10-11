'use strict';

// These reads retain the existing candidate-selection inputs and copy semantics.
// Measure them independently from the synchronous candidate calculation.
module.exports = async function read_selection_inputs(app, key, location_id, timing) {
	const collections = ['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators'];
	const values = await Promise.all(collections.map(async collection => {
		const done = timing?.step('selection_read_' + collection, { location_id, read_source: 'database' });
		let error, documents;
		try {
			documents = collection === 'tournaments'
				? await app.db[collection].findOne_async({ key })
				: await app.db[collection].find_async({ tournament_key: key });
			return documents;
		} catch (err) { error = err; throw err; }
		finally { done?.(error, { documents: collection === 'tournaments' ? Number(!!documents) : documents?.length }); }
	}));
	return Object.fromEntries(collections.map((collection, index) => [collection, values[index]]));
};
