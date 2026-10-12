'use strict';

const { deepCopy } = require('nedb/lib/model');

// NeDB checkObject visits array elements both through forEach and Object.keys.
// Validate each new subtree once, preserving its checkKey rules. Unchanged
// subtrees already belong to an immutable, validated datastore revision.
function validate(value) {
	const pending = [value];
	while (pending.length) {
		const object = pending.pop();
		if (typeof object === 'function' || typeof object === 'symbol' || typeof object === 'bigint') return false;
		if (!object || typeof object !== 'object') continue;
		if (!Array.isArray(object) && !(object instanceof Date) && !plain(object)) return false;
		const keys = Object.keys(object);
		if (Array.isArray(object) && (keys.length !== object.length || keys.some((key, i) => key !== String(i)))) return false;
		for (const key of keys) {
			const child = object[key];
			if (['__proto__', 'prototype', 'constructor'].includes(key)) return false;
			if (key.includes('.')) throw new Error('Field names cannot contain a .');
			if (key[0] === '$' && !(key === '$$date' && typeof child === 'number') &&
				!(key === '$$deleted' && child === true) && key !== '$$indexCreated' && key !== '$$indexRemoved') {
				throw new Error('Field names cannot begin with the $ character');
			}
			pending.push(child);
		}
	}
	return true;
}

function plain(value) { return value && Object.getPrototypeOf(value) === Object.prototype; }

function assign(document, parts, value, unset) {
	if (!plain(document)) return null;
	const [key, ...rest] = parts;
	const copy = { ...document };
	if (!rest.length) {
		if (unset) delete copy[key]; else copy[key] = value;
	} else {
		if (document[key] === undefined && unset) return document;
		const child = assign(document[key] === undefined ? {} : document[key], rest, value, unset);
		if (!child) return null; // Arrays, Dates, null and scalar parents use NeDB.
		copy[key] = child;
	}
	return copy;
}

function prepare(change, collection) {
	if (change.collection !== collection || !change.before || !change.after || !plain(change.before)) return null;
	const update = change.update;
	if (!update || Object.keys(update).some(key => !['$set', '$unset'].includes(key))) return null;
	const paths = Object.values(update).flatMap(values => values && typeof values === 'object' ? Object.keys(values) : ['']);
	const parts = paths.map(path => path.split('.'));
	if (parts.some(path => ['_id', 'key', 'tournament_key'].includes(path[0]) || path.some(key =>
		!key || key[0] === '$' || ['__proto__', 'prototype', 'constructor'].includes(key)))) return null;
	// Overlapping modifiers depend on NeDB's operation order and coercion rules.
	if (paths.some((path, i) => paths.some((other, j) => i !== j && (path === other || other.startsWith(path + '.'))))) return null;
	let document = change.before;
	for (const [operation, values] of Object.entries(update)) for (const [path, value] of Object.entries(values)) {
		const unset = operation === '$unset';
		if (!unset && !validate(value)) return null;
		const copied = unset ? undefined : deepCopy(value);
		document = assign(document, path.split('.'), copied, unset);
		if (!document) return null;
	}
	return { before: change.before, document };
}

module.exports = { prepare, validate };
