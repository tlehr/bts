'use strict';

const bridge = require('./testclient_bridge');
if (require.main === module) bridge.execute('reference_comparison');
else module.exports = bridge.load('reference_comparison');
