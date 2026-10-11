'use strict';

const bridge = require('./testclient_bridge');
if (require.main === module) bridge.execute('auto_tournament_simulation_probe');
else module.exports = bridge.load('auto_tournament_simulation_probe');
