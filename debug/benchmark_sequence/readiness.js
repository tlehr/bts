'use strict';

const bridge = require('../testclient_bridge');
if (require.main === module) bridge.execute('benchmark_sequence/readiness');
else module.exports = bridge.load('benchmark_sequence/readiness');
