'use strict';

const fs = require('fs');

require('../offload/worker')(request => {
	const phases = !request.warmup ? require('./diagnostics')(fs, request) : null;
	return { value: phases ? {diagnostic_phases:phases} : null };
});
