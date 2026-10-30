'use strict';

const { promisify } = require('util');
const reads = require('../preparation_selection/model_reads');
const flags = require('./player_flags');
const tablets = require('./tablet_queue');
const queue = require('../update_queue');

async function apply(app, key, matches, expected, waiting = []) {
	await tablets.apply(app, key, waiting, new Set([...expected.playing.keys(), ...expected.tablets.keys()].map(String)));
	let changed = false;
	for (const match of matches) {
		const { set, changed_players } = flags.repair(match, expected);
		if (!Object.keys(set).length) continue;
		const updated = await new Promise((resolve, reject) => app.db.matches.update({ _id: match._id, tournament_key: key },
			{ $set: set }, { returnUpdatedDocs: true }, (error, _count, document) => error ? reject(error) : resolve(document)));
		if (!updated) continue;
		changed = true;
		if (changed_players.length) require('../btp_manager').update_players(app, key, changed_players);
		require('../admin').notify_change(app, key, 'update_player_status', {
			match__id: updated._id, btp_winner: updated.btp_winner, setup: updated.setup,
		});
	}
	if (changed) require('../match_utils').queue_auto_execute_preparation_selections(app, key);
}

async function run(app, key) {
	const tournament = reads.supported(app, 'tournaments', true) ? await reads.read(app, key, 'tournaments', true)
		: await promisify(app.db.tournaments.findOne.bind(app.db.tournaments))({ key });
	if (!tournament) throw new Error('tournament not found');
	if (!reads.supported(app, 'matches', true) || Object.keys(app.db.matches.ttlIndexes || {}).length) {
		// Partial adapters / expiring collections retain their broad repair lock.
		return queue.execute_locked([queue.lock_keys.matches(key), queue.lock_keys.courts(key),
			queue.lock_keys.tabletoperators(key), queue.lock_keys.umpires(key)],
		queue.named('player_court_reconciliation_' + key, async () => {
			const matches = await promisify(app.db.matches.find.bind(app.db.matches))({ tournament_key: key });
			const waiting = await promisify(app.db.tabletoperators.find.bind(app.db.tabletoperators))({ tournament_key: key, court: null });
			await apply(app, key, matches, flags.expected(matches), waiting);
		}));
	}
	const matches = await reads.read(app, key, 'matches', true);
	const expected = flags.expected(matches);
	const candidates = matches.filter(match => Object.keys(flags.repair(match, expected).set).length);
	const waiting = await reads.read(app, key, 'tabletoperators', true);
	const busy = tablets.busy_ids(matches);
	if (!candidates.length && !waiting.some(entry => tablets.repair(entry, busy))) return;
	// Assignment/check-in/finish writers already hold these allocation locks.
	// Normal points on unrelated courts need none of them and remain runnable.
	const locks = [queue.lock_keys.preparation(key), queue.lock_keys.auto_call(key),
		queue.lock_keys.tabletoperators(key), queue.lock_keys.umpires(key),
		...candidates.map(match => queue.lock_keys.match(key, match._id))];
	return queue.execute_locked(locks, queue.named('player_court_reconciliation_' + key, async () => {
		// Recompute after waiting. A finish or reassignment may have made the old
		// suspected flag correct, or removed/moved its match in the meantime.
		const fresh = await reads.read(app, key, 'matches', true);
		const fresh_waiting = await reads.read(app, key, 'tabletoperators', true);
		const wanted = new Set(candidates.map(match => match._id));
		await apply(app, key, fresh.filter(match => wanted.has(match._id)), flags.expected(fresh), fresh_waiting);
	}));
}

module.exports = { run, apply };
