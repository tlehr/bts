'use strict';

const { isDeepStrictEqual } = require('util');

// Keep unchanged fields (especially presses) on the receiving thread. Updates
// still carry the original NeDB patch; after_delta only reconstructs the planned
// document for lock selection, validation, rebasing and notification publication.
function encode(changes) {
	return changes.map(({ collection, id, before, after, update }) => {
		if (!before || !after) return { collection, id, after, update };
		const fields = new Set([...Object.keys(update?.$set || {}), ...Object.keys(update?.$unset || {})]
			.map(path => path.split('.')[0]));
		// The reconstruction must match the actual planned document, even for
		// values/property presence the existing patch comparator ignores (dates,
		// undefined). Do not rely on the patch alone to describe that document.
		for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (!fields.has(key) && (Object.hasOwn(before, key) !== Object.hasOwn(after, key) ||
				!isDeepStrictEqual(before[key], after[key]))) fields.add(key);
		}
		const set = {}, unset = [];
		for (const key of fields) {
			if (Object.hasOwn(after, key)) Object.defineProperty(set, key, { value: after[key], enumerable: true });
			else unset.push(key);
		}
		return { collection, id, update, after_delta: { set, unset } };
	});
}

function decode(changes, before) {
	const documents = Object.fromEntries(Object.entries(before).filter(([, rows]) => Array.isArray(rows))
		.map(([collection, rows]) => [collection, new Map(rows.map(doc => [doc._id, doc]))]));
	return changes.map(({ after_delta, ...change }) => {
		if (!after_delta) return change;
		const previous = documents[change.collection]?.get(change.id);
		if (!previous) throw new Error(`Missing planner patch baseline: ${change.collection}/${change.id}`);
		const after = { ...previous, ...after_delta.set };
		for (const key of after_delta.unset) delete after[key];
		return { ...change, after };
	});
}

module.exports = { encode, decode };
