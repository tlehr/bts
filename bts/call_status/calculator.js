'use strict';

const canonical = require('../match_automation').calculate_all_location_preparation_selections;
const WorkerClient = require('../offload/client');
const transport = require('./transport');
const client = new WorkerClient('call_status_calculation', require('path').join(__dirname,'worker.js'));

async function calculate(input, options, previous) {
	const rules = require('../match_automation');
	// Small selections and extensions of an existing lightweight answer are
	// cheaper locally. Preserve custom calculation hooks and never nest workers
	// inside the isolated automatic-allocation planner.
	if (!require('worker_threads').isMainThread || !require('../offload/profile').enabled('call_status_worker') ||
		input.matches.length < 100 || options.base_selections || rules.calculate_all_location_preparation_selections !== canonical) {
		return rules.calculate_all_location_preparation_selections(input,options);
	}
	try {
		const parts = await transport.encode_input(input);
		const result = await client.run({parts,now:options.now_ts,automatic_only:options.automatic_only},
			{tournament_key:input.key},transport.transfers(parts,2));
		return await transport.decode_output(input,result,previous);
	} catch (error) {
		console.error('[bts] call status worker failed; using local calculation:', error.message); // eslint-disable-line no-console
		return rules.calculate_all_location_preparation_selections(input,options);
	}
}
module.exports = {calculate,client};
