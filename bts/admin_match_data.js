'use strict';

const { deepCopy } = require('nedb/lib/model');
const { certify_read } = require('./database_read_barrier');

// Keep all live histories for timer reconstruction. Finished histories are
// fetched separately by the admin when editing or opening a scoresheet.
function overview(match) {
	if (match.setup?.state !== 'finished' || match.setup?.now_on_court || !match.presses?.length) return deepCopy(match);
	const fields = { ...match };
	delete fields.presses;
	return deepCopy({ ...fields, presses_deferred: true });
}

function read_matches(db, key, defer_history, callback, options = {}) {
	const traces = require('./performance/traces'), read_span = traces.begin('admin_match_read', 'phase');
	const original_callback = callback;
	callback = (error, matches) => { traces.end(read_span, error); return original_callback(error, matches); };
	const background = require('./offload/profile').enabled('admin_response_background');
	const revision_cache = require('./offload/profile').enabled('admin_match_revision_cache');
	if (!db.model || !defer_history && (!background || !revision_cache)) {
		return db.matches.find({ tournament_key: key }, (error, matches) => {
			if (error) return callback(error);
			callback(null, defer_history ? matches.map(overview) : matches);
		});
	}
	const capture = done => {
		let matches;
		try {
			matches = [...db.model.tournament(key).matches.values()]
				.filter(match => match.present && match.data.tournament_key === key)
				.map(match => background ? match.data : overview(match.data));
		} catch (error) { return done(error); }
		done(null, matches);
	};
	const finish = background && revision_cache && options.immutable === true ? (error, records) => {
		if (error) return callback(error);
		const span = traces.begin('admin_match_copy', 'phase');
		const snapshots = records.map(record => require('./admin_response/match_cache').snapshot(record, defer_history));
		traces.end(span, null, { skipped: true, reason: 'immutable-datastore-revisions' });
		callback(null, snapshots);
	} : background ? (error, records) => {
		if (error) return callback(error);
		const copy_span = traces.begin('admin_match_copy', 'phase');
		const finish_copy = (err, matches) => { traces.end(copy_span, err); return callback(err, matches); };
		// NeDB revisions are immutable. Capture their references behind the
		// append barrier, then release the executor before copying short slices.
		const matches = [];
		let offset = 0;
		function copy() {
			const foreground = require('./foreground_work');
			if (foreground.busy()) { foreground.idle().then(() => setImmediate(copy)); return; }
			try {
				const start = process.hrtime.bigint();
				do { const record = records[offset++]; matches.push(defer_history ? overview(record) : deepCopy(record)); }
				while (offset < records.length && process.hrtime.bigint() - start < 2000000n);
			} catch (err) { return finish_copy(err); }
			if (offset < records.length) setImmediate(copy); else finish_copy(null, matches);
		}
		if (records.length) setImmediate(copy); else finish_copy(null, []);
	} : callback;
	// The model changes at index commit, before the append callback. Capture
	// behind earlier writers so an admin cannot observe an unpersisted update.
	db.matches.executor.push(certify_read({ this: db.matches, fn: capture,
		arguments: [finish], diagnostic_name: 'admin_match_overview' }));
}

function handle_match_history_get(app, ws, msg) {
	if (!msg.tournament_key || !msg.match_id) return ws.respond(msg, new Error('Missing tournament_key or match_id'));
	app.db.matches.findOne({ tournament_key: msg.tournament_key, _id: msg.match_id }, (error, match) => {
		if (error || !match) return ws.respond(msg, error || new Error('Match not found in tournament'));
		ws.respond(msg, null, { tournament_key: match.tournament_key, match_id: match._id, presses: match.presses || [] });
	});
}

module.exports = { read_matches, handle_match_history_get };
