'use strict';

// Observe Node's existing append implementation, including its error and close
// handling. Never replace the persistence operation with a timed approximation.
module.exports = function append(fs, request) {
	if (!request.diagnostics) { fs.appendFileSync(request.filename, request.bytes, request.encoding);return null; }
	const phases = [], originals = new Map();
	for (const name of ['openSync', 'writeSync', 'closeSync']) {
		const original = fs[name];originals.set(name, original);
		fs[name] = function(...args) {
			const started = process.hrtime.bigint(), start_ts = Date.now();let failed = false;
			try { return original.apply(this, args); }
			catch (error) { failed = true;throw error; }
			finally { phases.push({name:'append_' + name, start_ts,
				duration_ms:Number(process.hrtime.bigint() - started) / 1e6, status:failed ? 'error' : 'ok'}); }
		};
	}
	try { fs.appendFileSync(request.filename, request.bytes, request.encoding);return phases; }
	finally { for (const [name, original] of originals) fs[name] = original; }
};
