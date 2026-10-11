'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const Datastore = require('nedb');
const database = require('../../bts/database');

const tables = ['courts', 'locations', 'event', 'matches', 'tournaments', 'umpires', 'logs', 'tabletoperators',
	'displaysettings', 'display_court_displaysettings', 'normalizations', 'advertisements', 'app_settings'];

async function signature(source) {
	return Promise.all(tables.map(async name => {
		const stat = await fs.stat(path.join(source, name));
		return { name, bytes: stat.size, mtime_ms: stat.mtimeMs, ctime_ms: stat.ctimeMs, inode: stat.ino };
	}));
}

async function capture(source, directory) {
	const destination = path.join(directory, 'snapshot');
	await fs.mkdir(destination);
	const before = await signature(source);
	await Promise.all(tables.map(name => fs.copyFile(path.join(source, name), path.join(destination, name))));
	const after = await signature(source);
	if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source database changed while copying; capture again between writes.');
	const files = await Promise.all(tables.map(async name => ({ name,
		sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(destination, name))).digest('hex'),
	})));
	return { source: path.resolve(source), directory: destination, files, source_stat: after };
}

async function replica(snapshot, directory) {
	await fs.mkdir(directory);
	const db = {};
	await Promise.all(tables.map(async name => {
		const filename = path.join(directory, name);
		await fs.copyFile(path.join(snapshot.directory, name), filename);
		const store = db[name] = new Datastore({ filename });
		await promisify(store.loadDatabase.bind(store))(); // NeDB rewrites only this disposable copy.
	}));
	database.setup_helpers(db);
	return db;
}

async function unchanged(snapshot) {
	if (JSON.stringify(await signature(snapshot.source)) !== JSON.stringify(snapshot.source_stat)) {
		throw new Error('Source files changed during diagnosis; the captured comparison is valid but source integrity cannot be asserted.');
	}
	for (const file of snapshot.files) {
		const hash = crypto.createHash('sha256').update(await fs.readFile(path.join(snapshot.source, file.name))).digest('hex');
		if (hash !== file.sha256) throw new Error('Source content differs from the captured file: ' + file.name);
	}
}

async function reload(directory) {
	const db = {};
	await Promise.all(tables.map(async name => {
		const store = db[name] = new Datastore({ filename: path.join(directory, name) });
		await promisify(store.loadDatabase.bind(store))();
	}));
	return db;
}

module.exports = { capture, replica, unchanged, reload, tables };
