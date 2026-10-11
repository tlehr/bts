'use strict';

const bridge = require('./testclient_bridge');
if (require.main === module) bridge.execute('run_benchmark_sequence');
else module.exports = bridge.load('run_benchmark_sequence');
