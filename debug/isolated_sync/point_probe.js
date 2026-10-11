'use strict';

const assert = require('assert');
const admin = require('../../bts/admin');
const update_queue = require('../../bts/update_queue');
const { elapsed } = require('./instrument');

async function point(app, match, scheduled, rows) {
	return update_queue.execute_locked([
		update_queue.lock_keys.match(app.key, match._id), update_queue.lock_keys.court(app.key, match.setup.court_id),
	], update_queue.named('handle_score_update_probe', async () => {
		rows.point_resource_wait_ms = elapsed(scheduled) - rows.dispatch_delay_ms;
		const context_start = process.hrtime.bigint();
		rows.point_context_parts = {};
		const context = await Promise.all(['match', 'tournament', 'court'].map(part => new Promise((resolve, reject) => {
			const began = process.hrtime.bigint();
			app.db.model.read_score_context_part(part, app.key, part === 'match' ? match._id : match.setup.court_id,
				(error, value, timing) => {
					rows.point_context_parts[part] = { elapsed_ms: elapsed(began), ...timing };
					error ? reject(error) : resolve(value);
				});
		})));
		assert(context.every(Boolean)); rows.point_context_ms = elapsed(context_start);
		const write_start = process.hrtime.bigint();
		await app.db.matches.update_async({ _id: match._id }, { $inc: { isolated_point: 1 } }, {});
		rows.point_write_ms = elapsed(write_start);
		admin.notify_change(app, app.key, 'score', { match_id: match._id, network_score: match.network_score, isolated_point: 1 });
		require('../../bts/foreground_work').release();
	}));
}

module.exports = point;
