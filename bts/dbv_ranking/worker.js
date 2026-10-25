'use strict';

const parser = require('./parse');
require('../offload/worker')(payload => {
	const rows = parser.parse(Buffer.from(payload.bytes));
	return { value: { ...parser.match(rows, payload.candidates), row_count: rows.length } };
});
