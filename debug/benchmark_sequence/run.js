'use strict';

const bridge = require('../testclient_bridge');
if (require.main === module) bridge.execute('benchmark_sequence/run');
else module.exports = bridge.load('benchmark_sequence/run');
