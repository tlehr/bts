'use strict';

const profile = require('../offload/profile');

// Only datastore revisions explicitly captured behind the append barrier are
// registered. Their contents never change; writes replace the revision object.
// Weak maps let old revisions and their encodings disappear with the snapshots.
const registered = new WeakSet(), encoded = new WeakMap(), buffers = new WeakMap(), overviews = new WeakMap();
let hits = 0, misses = 0;

function snapshot(revision, defer) {
	let result = revision;
	if (defer && revision.setup?.state === 'finished' && !revision.setup.now_on_court && revision.presses?.length) {
		result = overviews.get(revision);
		if (!result) { result = { ...revision, presses_deferred: true }; delete result.presses; overviews.set(revision, result); }
	}
	registered.add(result); return result;
}

function encode(record) {
	if (!profile.enabled('admin_match_revision_cache')) return undefined;
	if (!record || !registered.has(record) || Object.getPrototypeOf(record) !== Object.prototype || record.toJSON) return undefined;
	let text = encoded.get(record);
	if (text === undefined) { text = JSON.stringify(record); encoded.set(record, text); misses++; }
	else hits++;
	return text;
}

function stats() { return { cache_hits: hits, cache_misses: misses, scope: 'server-lifetime', retention: 'weak-datastore-revisions' }; }

function encode_buffer(record) {
	// Reuse the same certification and feature gate as the string encoder.
	// These fragments stay private; every response receives its own output.
	const text = encode(record);
	if (text === undefined) return undefined;
	let bytes = buffers.get(record);
	if (!bytes) { bytes = Buffer.from(text); buffers.set(record, bytes); }
	return bytes;
}

module.exports = { snapshot, encode, encode_buffer, stats };
