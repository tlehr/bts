'use strict';

require('../offload/background_priority').configure('call_status_calculation');

const transport = require('./transport');
require('../offload/worker')(async payload => {
	const input = transport.decode_input(payload.parts);
	const selections = await require('../match_automation').calculate_all_location_preparation_selections(input,
		{now_ts:payload.now, automatic_only:payload.automatic_only});
	const parts = transport.encode_output(input,selections);
	return {value:parts, transfers:transport.transfers(parts,3)};
});
