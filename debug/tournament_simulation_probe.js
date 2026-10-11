'use strict';

const bridge = require('./testclient_bridge');
if (require.main === module) bridge.execute('tournament_simulation_probe');
else module.exports = bridge.load('tournament_simulation_probe');
