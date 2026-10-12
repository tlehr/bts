'use strict';

const path = require('path');
const { module_path } = require('../debug/testclient_bridge');
require(path.join(path.dirname(module_path('live_tournament_drill')), '../test/test_isolated_reception'));
