'use strict';

const assert = require('assert');
const crypto = require('crypto');
const sync = require('../../bts/btp_sync_plan');
const admin = require('../../bts/admin');
const { patch } = require('../../bts/btp_planner/staging');
const { deepCopy } = require('nedb/lib/model');
const { instrument, elapsed } = require('./instrument');
const probes = require('./probes');

function workload(db, key, changes, tournament_change = 'marker') {
	const tournament = db.tournaments.getAllData().find(t => t.key === key);
	const matches = db.matches.getAllData().filter(m => m.tournament_key === key);
	const point_match = matches.find(m => m.setup?.now_on_court && m.setup.court_id && !m.end_ts);
	assert(tournament?.btp_enabled && point_match, 'Snapshot needs an enabled BTP tournament and an active match.');
	const inactive = matches.filter(m => !m.setup?.now_on_court && m.setup?.teams?.[0]?.players?.[0])
		.sort((a, b) => String(a._id).localeCompare(String(b._id))).slice(0, changes);
	assert.strictEqual(inactive.length, changes);
	const modified_tournament = deepCopy(tournament);
	modified_tournament.events.isolated_benchmark_revision = 1;
	if (tournament_change === 'entries-array') {
		const entries = modified_tournament.events.events.flatMap(event => event.stages || []).flatMap(stage => stage.entries || []);
		const player = entries.flatMap(entry => entry.team?.players || []).find(player => player.name);
		assert(player, 'Snapshot needs a registered player profile.');
		player.name += ' [offline]';
	}
	const edits = [{ collection: 'tournaments', id: tournament._id, update: patch(tournament, modified_tournament) }];
	for (const match of inactive) {
		const after = deepCopy(match);
		after.setup.teams[0].players[0].name += ' [offline]';
		edits.push({ collection: 'matches', id: match._id, update: patch(match, after) });
	}
	return { tournament, matches, point_match, edits };
}

function digest(db) {
	return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(
		Object.entries(db).filter(([, store]) => store?.getAllData).sort(([a], [b]) => a.localeCompare(b)).map(([key, store]) => [key,
			store.getAllData().slice().sort((a, b) => String(a._id).localeCompare(String(b._id))),
		])))).digest('hex');
}

async function experiment(db, key, changes, selected, now_ms, mode = 'sync', profiling = {}, admin_request = {}, diagnostics = {}) {
	const input = workload(db, key, changes, diagnostics.tournament_change);
	const app = { db, key, admin_request, match_count: input.matches.length, wss: { clients: [] },
		clock: { now_ms: () => now_ms, get_state: () => ({ now_ms, mode: 'fixed' }) } };
	const canonical = db.model.tournament(key).matches.get(input.point_match._id);
	const channel = diagnostics.transport ? await require('./websocket_probes').open(app, input.point_match, diagnostics.separate_receivers, diagnostics.probe_delay_ms) : null;
	let resolve_probes, reject_probes, scheduled, timer;
	const pending = new Promise((resolve, reject) => { resolve_probes = resolve; reject_probes = reject; });
	// The nominal arrival is recorded before the first live match write executes.
	// Its actual dispatch happens on the next event-loop check turn, like an
	// already pending request; dispatch lag counts toward every response metric.
	const trigger = appends => {
		if (scheduled) return;
		scheduled = process.hrtime.bigint();
		setImmediate(() => (channel ? channel.run(scheduled, appends) : probes(app, input.point_match, scheduled, selected, appends))
			.then(resolve_probes, reject_probes));
	};
	const instrumentation = instrument(db, trigger, profiling.start, diagnostics.arrival);
	let ticks = 0, max_delay = 0, previous = process.hrtime.bigint();
	timer = setInterval(() => {
		const delay = elapsed(previous) - 2;
		max_delay = Math.max(max_delay, delay); previous = process.hrtime.bigint(); ticks++;
	}, 2);
	try {
		const began = process.hrtime.bigint();
		if (mode === 'idle') trigger(() => 0);
		else {
			await sync.sync(app, key, input.edits, { skip_unchanged: false, task_name: 'isolated_sync' }, async (planning, _key, edits) => {
				for (const edit of edits) {
					await planning.db[edit.collection].update_async({ _id: edit.id }, edit.update, {});
					if (edit.collection === 'matches') {
						const changed = await planning.db.matches.findOne_async({ _id: edit.id });
						admin.notify_change(planning, key, 'match_edit', changed);
					}
				}
				return true;
			});
		}
		const total_ms = elapsed(began), responses = await pending;
		await new Promise(resolve => setTimeout(resolve, 4)); // Observe the final synchronous stall, too.
		clearInterval(timer);
		if (profiling.stop) await profiling.stop();
		assert.strictEqual(db.model.tournament(key).matches.get(input.point_match._id), canonical);
		assert.strictEqual(canonical.data.isolated_point, 1);
		for (const edit of input.edits) if (mode !== 'idle') {
			const doc = db[edit.collection].indexes._id.getMatching(edit.id)[0];
			assert(doc);
			for (const [field, value] of Object.entries(edit.update.$set || {})) {
				assert.deepStrictEqual(field.split('.').reduce((v, part) => v[part], doc), value);
			}
		}
		return { total_ms, ...responses, heartbeat_max_delay_ms: max_delay, heartbeat_ticks: ticks,
			stages: instrumentation.rows, final_digest: digest(db),
			fixture: { matches: input.matches.length, active: input.matches.filter(m => m.setup?.now_on_court).length,
				finished: input.matches.filter(m => m.setup?.state === 'finished').length, changes: input.edits.length,
				tournament_bytes: Buffer.byteLength(JSON.stringify(input.tournament)) },
		};
	} finally { clearInterval(timer); instrumentation.stop(); if (channel) await channel.close(); }
}

module.exports = experiment;
module.exports.digest = digest;
