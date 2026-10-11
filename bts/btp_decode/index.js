'use strict';

const DecodePool = require('./pool');
let pool;

exports.decode = function(packet, context, callback) {
	if (!pool || pool.closed) pool = new DecodePool();
	return pool.decode(packet, context, callback);
};

// Useful for orderly shutdown and tests; a subsequent request creates a worker.
exports.close = function() { if (pool) pool.close(); };
