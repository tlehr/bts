'use strict';

// Automatic field selection inspects committed immutable records. Only the
// selected match is copied before the existing call helpers modify its setup.
const reads = require('./model_reads');
function read(app, key, collection) { return reads.read(app, key, collection, true); }
function callback(app, key, collection, done) { return read(app, key, collection).then(value => done(null, value), done); }
module.exports = { read, callback };
