'use strict';

const bridge = require('./testclient_bridge');
if (require.main === module) bridge.execute('live_tournament_drill');
else module.exports = bridge.load('live_tournament_drill');
