'use strict';

const path = require('path');
const WorkerClient = require('../offload/client');
const profile = require('../offload/profile');
const timing = require('../offload/timing');
const client = new WorkerClient('xlsx_parse', path.join(__dirname, 'worker.js'));

function parse(buffer, context = {}) {
	if (!profile.enabled('xlsx_import')) return timing.measure('xlsx_parse', 'main', context, () => require('./parse').parse(buffer));
	const start = process.hrtime.bigint();
	const bytes = Uint8Array.from(buffer);
	return client.run({ bytes: bytes.buffer }, { ...context, input_bytes: buffer.length,
		input_copy_ms: timing.ms(process.hrtime.bigint() - start) }, [bytes.buffer]);
}

module.exports = { parse, client };
