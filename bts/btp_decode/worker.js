'use strict';

const { parentPort } = require('worker_threads');
const codec = require('./codec');
const decode_timing = require('../timing/btp_decode');

parentPort.on('message', job => {
	const started = process.hrtime.bigint();
	let record, response, error;
	const timing = decode_timing({ ...job.context, enabled: job.timing_enabled,
		emit: row => { record = row; } }, job.packet.byteLength);
	try { response = codec.decode(Buffer.from(job.packet), timing); }
	catch (err) { error = { name: err.name, message: err.message, code: err.code, btp_parse_error: err.btp_parse_error }; }
	if (timing) timing.finish(error);
	// This timestamp precedes output cloning. The receiver's interval includes
	// serialization, delivery, deserialization and main-thread scheduling.
	parentPort.postMessage({ id: job.id, response, error, record,
		started, returning: process.hrtime.bigint() });
});
