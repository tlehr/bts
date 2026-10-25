'use strict';

// Only the read-only response arrays owned by preparation_selection/admin_reads
// are registered. Each socket still encodes its own request ID and envelope.
const registered = new WeakSet(), encodings = new WeakMap();
function certify(value) { registered.add(value); return value; }
async function encode(value, work) {
	if (!registered.has(value)) return work();
	if (!encodings.has(value)) {
		const pending = Promise.resolve().then(work).catch(error => { encodings.delete(value); throw error; });
		encodings.set(value, pending);
	}
	return encodings.get(value);
}
module.exports = { certify, encode };
