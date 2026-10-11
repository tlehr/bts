'use strict';

const { parentPort } = require('worker_threads');

module.exports = function serve(work) {
	parentPort.on('message', async job => {
		const started = process.hrtime.bigint();
		const worker_start_ts = Date.now();
		let result, error;
		try { result = await work(job.payload); }
		catch (err) { error = { name: err.name, message: err.message, code: err.code }; }
		parentPort.postMessage({ id: job.id, value: result?.value, error,
			worker_start_ts, worker_end_ts: Date.now(),
			started, returning: process.hrtime.bigint() }, result?.transfers || []);
	});
};
