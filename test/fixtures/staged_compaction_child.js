'use strict';

const { promisify } = require('util');
const Datastore = require('nedb');
const storage = require('nedb/lib/storage');
const compaction = require('../../bts/compaction_worker');
const staged = require('../../bts/compaction_worker/staged');

async function main() {
	process.env.BTS_COMPACTION_WORKER = '1'; process.env.BTS_COMPACTION_STAGED = '1';
	const store = new Datastore({ filename: process.argv[2] });
	compaction.attach(store, 'matches', { identity_serialization: true });
	await promisify(store.loadDatabase.bind(store))();
	await promisify(store.insert.bind(store))({ _id: 'game', score: 0, at: new Date(1234) });
	const write_stage = storage.crashSafeWriteFile, rename = storage.rename;
	storage.crashSafeWriteFile = (filename, bytes, done) => write_stage(filename, bytes, async error => {
		if (error) return done(error);
		if (!filename.endsWith('.bts-compacting')) return done(null);
		await promisify(store.update.bind(store))({ _id: 'game' }, { $set: { score: 5 } }, {});
		if (process.argv[3] === 'before') process.send({ ready: true });
		else done(null);
	});
	storage.rename = (from, to, done) => rename(from, to, error => {
		if (error) return done(error);
		if (from.endsWith('.bts-compacting')) process.send({ ready: true });
		else done(null);
	});
	await staged.run(store, 'matches');
}

if (require.main === module) main().catch(error => { process.send({ error: error.message }); process.exitCode = 1; });
