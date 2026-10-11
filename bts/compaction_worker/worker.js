'use strict';

const model = require('nedb/lib/model');
const sessions = new Map();

require('../offload/worker')(payload => {
	let serialized;
	if (payload.session == null) serialized = require('./serialize')(payload);
	else {
		let lines = sessions.get(payload.session);
		if (!payload.seed && !lines) return { value: { needs_seed: true } };
		if (payload.seed) lines = new Map();
		try {
			for (const id of payload.removed) lines.delete(id);
			for (const doc of payload.upserts) lines.set(doc._id, model.serialize(doc) + '\n');
			serialized = payload.order.map(id => {
				if (!lines.has(id)) throw new Error('Missing compaction source record');
				return lines.get(id);
			}).join('') + require('./serialize')({ documents: [], indexes: payload.indexes });
		} catch (error) { sessions.delete(payload.session); throw error; }
		sessions.delete(payload.session); sessions.set(payload.session, lines);
		while (sessions.size > 32) sessions.delete(sessions.keys().next().value);
	}
	const bytes = Buffer.from(serialized, 'utf8');
	// Always own the backing store, including tiny pooled outputs.
	const owned = Uint8Array.from(bytes);
	return { value: payload.session == null ? owned.buffer : { bytes: owned.buffer }, transfers: [owned.buffer] };
});
