'use strict';

const bridge = require('../testclient_bridge');
if (require.main === module) bridge.execute('web_dashboard/server');
else module.exports = bridge.load('web_dashboard/server');
