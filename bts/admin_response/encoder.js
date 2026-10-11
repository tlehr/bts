'use strict';

const path = require('path');
const WorkerClient = require('../offload/client');
const client = new WorkerClient('admin_response_encode', path.join(__dirname, 'worker.js'), { max_pending: 16 });

module.exports = {
	encode: async (message, context) => {
		await require('../foreground_work').idle();
		return process.env.BTS_ADMIN_RESPONSE_ENCODER === 'worker'
			? { bytes: await client.run(message, context), execution: 'worker' }
			: { bytes: await require('./cooperative')(message), execution: 'cooperative' };
	},
	close: () => client.close(),
};
