'use strict';

const queue = require('./update_queue');
const status = require('../static/js/btp_entry_status');

// Repeated/announcement-only calls must use the stored status too. Legacy
// clients identify setup-only calls by the unique event and match number.
async function announce(app, ws, msg, type, setup_only = true, extract = setup => setup) {
	try {
		const id = msg.match_id || msg.match?._id || msg.setup?._match_id;
		const query = { tournament_key: msg.tournament_key };
		if (id) query._id = id;
		else {
			if (msg.setup?.match_num == null || !msg.setup.event_name) throw new Error('Match identity is required for a player call');
			query['setup.match_num'] = msg.setup.match_num;
			query['setup.event_name'] = msg.setup.event_name;
		}
		const initial = await app.db.matches.findOne_async(query);
		if (!initial) throw new Error('Match not found');
		await queue.execute_locked([queue.lock_keys.match(msg.tournament_key, initial._id)], async () => {
			const current = await app.db.matches.findOne_async({ _id: initial._id, tournament_key: msg.tournament_key });
			if (!current) throw new Error('Match not found');
			const error = status.call_error(current);
			if (error) throw error;
			require('./admin').notify_change(app, msg.tournament_key, type, setup_only ? { setup: extract(current.setup) } : current);
		});
		ws.respond(msg);
	} catch (error) { ws.respond(msg, error); }
}

module.exports = { announce };
