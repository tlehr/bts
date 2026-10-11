'use strict';

const { promisify } = require('util');
const Datastore = require('nedb');
const tournament_model = require('../tournament_model');
const utils = require('../utils');
const COLLECTIONS = ['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators'];
const yield_turn = () => new Promise(resolve => setImmediate(resolve));

function memory_db() {
	const db = {};
	let pending_writes = 0;
	let write_error;
	db.wait_for_writes = async () => {
		while (pending_writes) await yield_turn();
		if (write_error) throw write_error;
	};
	for (const collection of COLLECTIONS) {
		const store = db[collection] = new Datastore({ inMemoryOnly: true });
		for (const method of ['find', 'findOne', 'insert', 'remove']) store[method + '_async'] = promisify(store[method].bind(store));
		store._btp_dirty = new Set();
		const update = store.update.bind(store);
		store.update = (query, values, options, callback) => {
			if (typeof options === 'function') { callback = options; options = {}; }
			pending_writes++;
			update(query, values, { ...options, returnUpdatedDocs: true }, (err, count, docs, ...rest) => {
				if (err) write_error = write_error || err;
				for (const doc of (Array.isArray(docs) ? docs : [docs])) if (doc) store._btp_dirty.add(doc._id);
				try { if (callback) callback(err, count, docs, ...rest); }
				finally { pending_writes--; }
			});
		};
		const insert = store.insert.bind(store);
		store.insert = (docs, callback) => {
			pending_writes++;
			insert(docs, (err, inserted) => {
				if (err) write_error = write_error || err;
				for (const doc of (Array.isArray(inserted) ? inserted : [inserted])) if (doc) store._btp_dirty.add(doc._id);
				try { if (callback) callback(err, inserted); }
				finally { pending_writes--; }
			});
		};
		store.insert_async = promisify(store.insert.bind(store));
		const remove = store.remove.bind(store);
		store.remove = (query, options, callback) => {
			if (typeof options === 'function') { callback = options; options = {}; }
			const before_ids = store.getAllData().map(doc => doc._id);
			pending_writes++;
			remove(query, options, (err, count) => {
				if (err) write_error = write_error || err;
				const remaining = new Set(store.getAllData().map(doc => doc._id));
				for (const id of before_ids) if (!remaining.has(id)) store._btp_dirty.add(id);
				try { if (callback) callback(err, count); }
				finally { pending_writes--; }
			});
		};
		store.remove_async = promisify(store.remove.bind(store));
		store.update_async = (...args) => new Promise((resolve, reject) => {
			store.update(...args, (err, ...results) => err ? reject(err) : resolve(results));
		});
	}
	// Preserve the constraints used by the live datastore while calculating.
	db.tournaments.ensureIndex({ fieldName: 'key', unique: true });
	db.umpires.ensureIndex({ fieldName: 'name', unique: true });
	db.matches.ensureIndex({ fieldName: 'btp_id' });
	tournament_model.attach(db);
	return db;
}


async function refresh(db, state, previous, previous_source) {
	let copied_records = 0;
	for (const collection of COLLECTIONS) {
		const old = new Map((previous?.[collection] || []).map(doc => [doc._id, doc]));
		const source = new Map((previous_source?.[collection] || []).map(doc => [doc._id, doc]));
		for (let i = 0; i < state[collection].length; i++) {
			const doc = state[collection][i];
			const existing = old.get(doc._id);
			old.delete(doc._id);
			if (!existing) { await db[collection].insert_async(doc); copied_records++; }
			else if (source.get(doc._id) !== doc || db[collection]._btp_dirty.has(doc._id)) {
				if (JSON.stringify(existing) !== JSON.stringify(doc)) {
					await db[collection].update_async({ _id: doc._id }, doc, {});
					copied_records++;
				}
			}
			if (i % 32 === 31) await yield_turn();
		}
		for (const doc of old.values()) await db[collection].remove_async({ _id: doc._id }, {});
		db[collection]._btp_dirty.clear();
	}
	return copied_records;
}


function planning_snapshot(db) {
	// These references stay inside the private planner. NeDB replaces documents
	// on updates; planning functions receive ordinary copied query results.
	return Object.fromEntries(COLLECTIONS.map(collection => [collection,
		db[collection].getAllData().slice().sort((a, b) => String(a._id).localeCompare(String(b._id))),
	]));
}


function patch(before, after) {
	const set = {};
	const unset = {};
	function visit(left, right, path) {
		if (utils.deep_equal(left, right)) return;
		if (right === undefined) { unset[path] = true; return; }
		if (left && right && typeof left === 'object' && typeof right === 'object' &&
			!Array.isArray(left) && !Array.isArray(right) && !(left instanceof Date) && !(right instanceof Date)) {
			for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) visit(left[key], right[key], path ? `${path}.${key}` : key);
		} else set[path] = right;
	}
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (key !== '_id') visit(before[key], after[key], key);
	}
	const update = {};
	if (Object.keys(set).length) update.$set = set;
	if (Object.keys(unset).length) update.$unset = unset;
	return update;
}


async function differences(before, after, db) {
	const changes = [];
	for (const collection of COLLECTIONS) {
		const old = new Map(before[collection].map(doc => [doc._id, doc]));
		for (let i = 0; i < after[collection].length; i++) {
			const doc = after[collection][i];
			const previous = old.get(doc._id);
			old.delete(doc._id);
			if (!db[collection]._btp_dirty.has(doc._id)) continue;
			const update = previous && patch(previous, doc);
			if (!previous || Object.keys(update).length) changes.push({ collection, id: doc._id, before: previous, after: doc, update });
			if (i % 32 === 31) await yield_turn();
		}
		for (const previous of old.values()) changes.push({ collection, id: previous._id, before: previous });
	}
	return changes;
}



module.exports = { COLLECTIONS, memory_db, refresh, planning_snapshot, patch, differences };
