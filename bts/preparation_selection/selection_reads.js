'use strict';

// Automatic selection only inspects immutable records. Public/admin selections
// keep detached copies so callers can safely modify their returned candidates.
module.exports = async function read_selection_inputs(app, key, location_id, timing, immutable = false) {
	const reads = require('./model_reads');
	const collections = ['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators'];
	const values = await Promise.all(collections.map(async collection => {
		const done = timing?.step('selection_read_' + collection, { location_id,
			read_source: reads.supported(app, collection, immutable) ? 'object_model' : 'database' });
		let error, documents;
		try {
			documents = await reads.read(app, key, collection, immutable);
			return documents;
		} catch (err) { error = err; throw err; }
		finally { done?.(error, { documents: collection === 'tournaments' ? Number(!!documents) : documents?.length }); }
	}));
	return Object.fromEntries(collections.map((collection, index) => [collection, values[index]]));
};
