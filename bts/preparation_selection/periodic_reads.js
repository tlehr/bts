'use strict';

const { match } = require('nedb/lib/model');
const { promisify } = require('util');
const { supported, read } = require('./model_reads');

// Private, read-only automation inputs. Keep the executor barrier so a timer
// never observes an indexed write before its persistence callback completes.
function tournaments(app, query) {
	const store = app.db.tournaments;
	if (!supported(app, 'tournaments', true)) return promisify(store.find.bind(store))(query);
	const model = require('../tournament_model').attach(app.db);
	return new Promise((resolve, reject) => {
		const capture = done => {
			if (Object.keys(store.ttlIndexes || {}).length) return store.find(query)._exec(done);
			let documents;
			try {
				documents = [...model.tournaments.values()].map(tournament => tournament.record)
					.filter(record => record?.present && match(record.data, query)).map(record => record.data);
			} catch (error) { return done(error); }
			done(null, documents);
		};
		store.executor.push({ this: store, fn: capture, diagnostic_name: 'automation_tournaments',
			arguments: [(error, values) => error ? reject(error) : resolve(values)] });
	});
}

function runner(app, name, query, process) {
	let running = false;
	return () => {
		if (running) return;
		running = true;
		return require('../performance/traces').operation(name, { type: 'calling' }, async () => {
			for (const tournament of await tournaments(app, query)) await process(tournament);
		}).catch(error => {
			console.warn('[bts] failed to process ' + name, error && (error.stack || error.message || String(error))); // eslint-disable-line no-console
		}).finally(() => { running = false; });
	};
}

async function matches(app, key, query = {}) {
	if (!supported(app, 'matches', true)) return promisify(app.db.matches.find.bind(app.db.matches))({ tournament_key: key, ...query });
	return (await read(app, key, 'matches', true)).filter(document => match(document, query));
}

module.exports = { tournaments, runner, matches };
