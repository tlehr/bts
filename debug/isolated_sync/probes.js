'use strict';

const assert = require('assert');
const admin = require('../../bts/admin');
const point_probe = require('./point_probe');
const { elapsed } = require('./instrument');

// Measure real server read/notification functions. There is deliberately no
// socket, external BTP connection, browser renderer or speech engine here.
async function probes(app, match, scheduled, workload, appends) {
	const rows = { dispatch_delay_ms: elapsed(scheduled), append_in_flight_at_dispatch: appends() > 0 };
	const ws = { sendmsg(message) {
		const began = process.hrtime.bigint();
		const encoded = JSON.stringify(message);
		if (message.ctype === 'match_called_on_court') {
			rows.announcement_ready_ms = elapsed(scheduled);
			rows.announcement_serialize_ms = elapsed(began);
			rows.announcement_bytes = Buffer.byteLength(encoded);
		}
		if (message.ctype === 'score') rows.point_notification_ready_ms = elapsed(scheduled);
	} };
	admin.on_connect(app, ws);
	try {
		const point = point_probe(app, match, scheduled, rows);
		const requests = [point];
		if (workload === 'point-admin-announcement') {
			requests.push(new Promise((resolve, reject) => admin.handle_tournament_get(app, {
				respond(_message, error, result) {
					if (error) return reject(error);
					assert.strictEqual(result.tournament.matches.length, app.match_count);
					const began = process.hrtime.bigint();
					rows.admin_response_bytes = Buffer.byteLength(JSON.stringify(result));
					rows.admin_response_serialize_ms = elapsed(began);
					rows.admin_response_ready_ms = elapsed(scheduled);
					resolve();
				},
			}, { key: app.key, ...app.admin_request })));
			admin.handle_announce_match_manually(app, { respond(_msg, error) { if (error) throw error; } }, { tournament_key: app.key, match });
			assert(rows.announcement_ready_ms !== undefined);
		}
		await Promise.all(requests);
		assert(rows.point_notification_ready_ms !== undefined);
		return rows;
	} finally { admin.on_close(app, ws); }
}

module.exports = probes;
