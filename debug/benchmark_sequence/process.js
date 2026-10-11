'use strict';

const bridge = require('../testclient_bridge');
if (require.main === module) bridge.execute('benchmark_sequence/process');
else module.exports = bridge.load('benchmark_sequence/process');
