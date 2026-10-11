'use strict';

require('../offload/worker')(payload => ({ value: require('./parse').parse(Buffer.from(payload.bytes)) }));
