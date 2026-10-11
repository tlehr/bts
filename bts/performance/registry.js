'use strict';

// Weak references do not keep closed sockets, test stores or workers alive.
const entries = new Map();
let sequence = 0;

function register(owner, name, snapshot) {
	const id = ++sequence;
	entries.set(id, { owner: new WeakRef(owner), name, snapshot });
	return () => entries.delete(id);
}

function snapshots() {
	const result = [];
	for (const [id, entry] of entries) {
		const owner = entry.owner.deref();
		if (!owner) { entries.delete(id); continue; }
		result.push({ id, name: entry.name, ...entry.snapshot(owner) });
	}
	return result;
}

module.exports = { register, snapshots };
