'use strict';

const document = require('./prepared_document');

module.exports = { prepare: change => document.prepare(change, 'tournaments'), validate: document.validate };
