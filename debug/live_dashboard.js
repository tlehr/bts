'use strict';

const bridge = require('./testclient_bridge');
if (require.main === module) bridge.execute('live_dashboard');
else module.exports = bridge.load('live_dashboard');
