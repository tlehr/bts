'use strict';

const bridge = require('../testclient_bridge');
if (require.main === module) bridge.execute('web_dashboard/options');
else module.exports = bridge.load('web_dashboard/options');
