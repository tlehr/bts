'use strict';

const { deepCopy } = require('nedb/lib/model');
const { isDeepStrictEqual: equal } = require('util');

// Participant helpers own the fields they change, not a whole captured setup.
// Numbering may change while their detached query result is being processed.
class SetupChanges {
	constructor(setup) { this.before = deepCopy(setup); }
	update(setup) {
		const set = {}, unset = {};
		for (const field of new Set([...Object.keys(this.before || {}), ...Object.keys(setup || {})])) {
			if (equal(this.before?.[field], setup?.[field])) continue;
			const path = 'setup.' + field;
			if (setup?.[field] === undefined) unset[path] = true;
			else set[path] = setup[field];
		}
		return { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
	}
}

module.exports = SetupChanges;
