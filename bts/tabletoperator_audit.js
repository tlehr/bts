'use strict';

function enabled(tournament_key) {
	if (process.env.BTS_TABLETOPERATOR_AUDIT !== undefined) return process.env.BTS_TABLETOPERATOR_AUDIT === '1';
	return require('./server_diagnostics').enabled(null, tournament_key);
}

function player_names(entry) {
	return (Array.isArray(entry?.tabletoperator) ? entry.tabletoperator : [])
		.map((player) => player && (player.name || [player.firstname, player.lastname].filter(Boolean).join(' ')))
		.filter(Boolean);
}

function compact_doc(doc) {
	if (!doc || typeof doc !== 'object') {
		return doc;
	}
	return {
		_id: doc._id,
		tournament_key: doc.tournament_key,
		match_id: doc.match_id,
		court: doc.court,
		played_on_court: doc.played_on_court,
		start_ts: doc.start_ts,
		end_ts: doc.end_ts,
		names: player_names(doc),
	};
}

function compact_stack() {
	const stack = new Error().stack || '';
	return stack
		.split('\n')
		.slice(3, 11)
		.map((line) => line.trim());
}

function log_insert(doc) {
	if (!enabled(doc?.tournament_key)) {
		return;
	}
	console.warn('[bts] tabletoperator_audit:insert', JSON.stringify({ // eslint-disable-line no-console
		doc: compact_doc(doc),
		stack: compact_stack(),
	}));
}

function wrap_datastore(datastore) {
	if (!datastore || datastore.__tabletoperator_audit_wrapped || typeof datastore.insert !== 'function') {
		return;
	}
	const original_insert = datastore.insert;
	datastore.insert = function audited_insert(doc, ...args) {
		if (Array.isArray(doc)) {
			doc.forEach(log_insert);
		} else {
			log_insert(doc);
		}
		return original_insert.call(this, doc, ...args);
	};
	datastore.__tabletoperator_audit_wrapped = true;
}

module.exports = {
	wrap_datastore,
	enabled,
};
