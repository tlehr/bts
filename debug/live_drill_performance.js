'use strict';

const bridge = require('./testclient_bridge');
if (require.main === module) bridge.execute('live_drill_performance');
else module.exports = bridge.load('live_drill_performance');
