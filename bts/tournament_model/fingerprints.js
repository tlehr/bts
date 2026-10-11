'use strict';

const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const project = require('./fingerprint_projections');
const revisions = new WeakMap();

// Hash persisted values, not object addresses. Object key order is irrelevant;
// array order and JSON's handling of dates/undefined remain significant.
function canonical(value) {
	if (value === null || typeof value !== 'object') return value;
	if (value instanceof Date) return value.toJSON();
	if (Array.isArray(value)) return value.map(canonical);
	return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function hash(value) {
	return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function calculate(collection, document, kind = 'document') {
	return hash(['bts-fingerprint-v1', collection, kind, project(collection, document, kind)]);
}

function fingerprint(collection, document, kind = 'document') {
	if (!document) return null;
	let cached = revisions.get(document);
	if (!cached) revisions.set(document, cached = new Map());
	const key = `${collection}:${kind}`;
	if (!cached.has(key)) cached.set(key, calculate(collection, document, kind));
	return cached.get(key);
}

function inherit(collection, previous, next) {
	if (!previous || !next || previous === next) return;
	const old = revisions.get(previous);
	if (!old) return;
	for (const [key, digest] of old) {
		if (!key.startsWith(collection + ':')) continue;
		const kind = key.slice(collection.length + 1);
		if (!isDeepStrictEqual(project(collection, previous, kind), project(collection, next, kind))) continue;
		let cached = revisions.get(next);
		if (!cached) revisions.set(next, cached = new Map());
		cached.set(key, digest);
	}
}

module.exports = { fingerprint, inherit, calculate, hash };
