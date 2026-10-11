'use strict';

const model = require('nedb/lib/model');

module.exports = function serialize(payload) {
	const lines = payload.documents.map(doc => model.serialize(doc) + '\n');
	for (const index of payload.indexes) lines.push(model.serialize({ $$indexCreated: index }) + '\n');
	return lines.join('');
};
