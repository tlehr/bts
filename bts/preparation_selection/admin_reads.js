'use strict';

// Compatibility entry point; automation and connected admins share the same
// event/deadline based status rather than separate short-lived UI calculations.
async function read(app, key, options = {}) {
	return (await require('../call_status')(app).snapshot(key, options)).selections;
}

module.exports = { read };
