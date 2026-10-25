'use strict';

const Datastore = require('nedb');
const model = require('nedb/lib/model');
const writes = require('./btp_planner/batch_writes');
const profile = require('./offload/profile');

// Point updates always address one existing match, without TTL, upsert or
// timestamps. Keep NeDB's executor, validation, index/model hooks, append and
// detached callback result, but avoid its generic waterfall's extra loop turns.
module.exports = function write_score(store, query, values, callback) {
	const modifier = { $set: values }, options = { returnUpdatedDocs: true };
	const supported = () => writes.supported(store) && !store.timestampData &&
		store.getCandidates === Datastore.prototype.getCandidates;
	if (!profile.enabled('score_direct_writes') || !supported() ||
		Object.keys(query).length !== 2 || typeof query._id !== 'string' || typeof query.tournament_key !== 'string') {
		return store.update(query, modifier, options, callback);
	}
	store.executor.push({ this: store, diagnostic_name: 'score_update_write', arguments: [callback], fn: function(done) {
		// Index settings and hooks can change while this job is queued. Fall back
		// within the same barrier, without putting an update behind later jobs.
		if (!supported()) return store._update(query, modifier, options, done);
		let document;
		try {
			const before = store.indexes._id.getMatching(query._id)[0];
			if (!before || !model.match(before, query)) return done(null, 0, undefined);
			document = model.modify(before, modifier);
			store.updateIndexes([{ oldDoc: before, newDoc: document }]);
		} catch (error) { return done(error); }
		store.persistence.persistNewState([document], error => {
			if (error) return done(error);
			done(null, 1, model.deepCopy(document));
		});
	} });
};
