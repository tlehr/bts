'use strict';

const batch = require('../btp_planner/batch_writes');
const document = require('../btp_planner/prepared_document');
const query = change => ({ _id: change.id, tournament_key: change.before.tournament_key });

async function ordinary(store, changes, published) {
	const results = await Promise.allSettled(changes.map(change => new Promise((resolve, reject) => {
		store.update(query(change), change.update, { returnUpdatedDocs: true }, (error, _count, record) => {
			if (error) return reject(error);
			const current = record || change.before;
			published([current]); resolve(current);
		});
	})));
	const failure = results.find(result => result.status === 'rejected');
	if (failure) throw failure.reason;
	return results.map(result => result.value);
}

// At most four participant patches per append. Other courts can enqueue reads
// and score writes between groups. Prepare against each current executor-ordered
// revision, sharing untouched histories while copying changed array ancestors.
module.exports = async function write(app, edits, published = () => {}) {
	const store = app.db.matches, updated = [];
	for (let offset = 0; offset < edits.length; offset += 4) {
		const changes = edits.slice(offset, offset + 4).map(({ match, patch }) => ({
			collection: 'matches', id: match._id, before: match, after: match, update: { $set: patch },
		}));
		let records;
		if (!batch.supported(store) || store.timestampData) records = await ordinary(store, changes, published);
		else {
			const stats = await batch.write(store, changes, query, (change, current) =>
				document.prepare({ ...change, before: current }, 'matches', true), {
				diagnostic_name: 'participant_patch_group', return_records: true,
				fallback: done => {
					// Inside the existing executor slot; queuing a public update here
					// would wait for itself. TTL/timestamp behaviour stays native.
					const records = [];
					let index = 0;
					const next = error => {
						if (error) return done(error);
						if (index === changes.length) return done(null, { records, native_fallback: true });
						const change = changes[index++];
						store._update(query(change), change.update, { returnUpdatedDocs: true }, (error, _count, record) => {
							if (!error) { records.push(record || change.before); published([record || change.before]); }
							next(error);
						});
					};
					next();
				},
			});
			records = stats.records; if (!stats.native_fallback) published(records);
		}
		updated.push(...records);
	}
	return updated;
};
