'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const { copy } = require('./btp_sync_effects');
const update_queue = require('./update_queue');
const utils = require('./utils');
const tournament_model = require('./tournament_model');
const resources = require('./btp_sync_locks/resources');
const { dependency_setup } = require('./btp_sync_locks/match_changes');

const { COLLECTIONS, memory_db, refresh, planning_snapshot, patch, differences } = require('./btp_planner/staging');
const POINT_FIELDS = ['network_score', 'network_team1_left', 'network_team1_serving',
	'network_teams_player1_even', 'presses', 'duration_ms', 'shuttle_count'];
const caches = new WeakMap();
const yield_turn = () => new Promise(resolve => setImmediate(resolve));

function cache_for(app, tkey, namespace = 'btp') {
	let tournaments = caches.get(app.db);
	if (!tournaments) caches.set(app.db, tournaments = new Map());
	const key = `${namespace}:${tkey}`;
	let cache = tournaments.get(key);
	if (!cache) tournaments.set(key, cache = { tail: Promise.resolve() });
	return cache;
}

function query_for(collection, tkey) {
	return collection === 'tournaments' ? { key: tkey } : { tournament_key: tkey };
}

async function snapshot(db, tkey) {
	return tournament_model.attach(db).snapshot(tkey, COLLECTIONS);
}

function local_projection(match) {
	const result = { ...match };
	for (const field of ['presses', 'duration_ms', 'network_team1_left', 'network_team1_serving', 'network_teams_player1_even']) delete result[field];
	if (match.setup?.now_on_court && !match.btp_needsync) delete result.network_score;
	return result;
}

function dependency_projection(match, locked_matches, ignore_successor = false) {
	if (locked_matches.has(match._id)) return match;
	const setup = dependency_setup(match.setup);
	if (ignore_successor) {
		delete setup.needs_preparation_successor;
		delete setup.needs_preparation_successor_ts;
	}
	return {
		_id: match._id, btp_id: match.btp_id, btp_match_ids: match.btp_match_ids, btp_player_ids: match.btp_player_ids,
		team1_won: match.team1_won, btp_winner: match.btp_winner,
		end_ts: match.end_ts, score_status: match.score_status, btp_needsync: match.btp_needsync,
		match_order: match.match_order, forward_loser: match.forward_loser, no_match_losing_team: match.no_match_losing_team,
		// Fewer locks must not hide a completed dependency change while planning
		// or waiting. Ignore ordinary points/profiles, but retain all setup flags.
		setup,
	};
}

function validation_input(state) {
	return Object.fromEntries(COLLECTIONS.map(collection => [collection, new Map(state[collection].map(doc => [
		doc._id, { document: doc },
	]))]));
}

function point_projection(match) {
	const result = { ...match };
	for (const field of POINT_FIELDS) delete result[field];
	return result;
}

function live_point_match(match) {
	return match?.setup?.state === 'oncourt' && match.setup.now_on_court === true &&
		!match.end_ts && typeof match.team1_won !== 'boolean' && !match.btp_winner && !match.btp_needsync &&
		(!match.score_status || match.score_status === 'normal');
}

function point_preserving_change(before, after) {
	if (!live_point_match(after)) return false;
	// A remote score reset/result or changed scoring/opponents must still be
	// planned against the latest local score. Player metadata/check-ins may merge.
	if (![...POINT_FIELDS, 'end_ts', 'team1_won', 'btp_winner', 'btp_needsync',
		'score_status', 'score_status_network_score', 'forward_loser', 'no_match_losing_team']
		.every(field => utils.deep_equal(before[field], after[field]))) return false;
	if (!['state', 'now_on_court', 'court_id', 'counting', 'scoring_format',
		'needs_preparation_successor', 'needs_preparation_successor_ts']
		.every(field => utils.deep_equal(before.setup[field], after.setup[field]))) return false;
	const opponents = match => (match.setup.teams || []).map(team => (team.players || [])
		.map(player => player.btp_id != null ? { btp_id: player.btp_id } : player));
	return utils.deep_equal(opponents(before), opponents(after));
}

function point_rebase_matches(before, changes, effects, locked_matches) {
	const by_id = new Map(changes.filter(change => change.collection === 'matches').map(change => [change.id, change]));
	// Opaque external effects can contain a captured score. Notifications are
	// rebuilt from final_state; other match effects retain strict validation.
	const strict = new Set(effects.filter(effect => !effect.resources.notification && !effect.resources.deferred_job)
		.flatMap(effect => effect.resources.matches || []));
	return new Set(before.matches.filter(match => locked_matches.has(match._id) && !strict.has(match._id) &&
		live_point_match(match) && (!by_id.has(match._id) || point_preserving_change(match, by_id.get(match._id).after)))
		.map(match => match._id));
}

function merge_point_rebases(plan, final_state, rebased) {
	for (const change of plan.changes) {
		if (change.collection !== 'matches' || !rebased.has(change.id)) continue;
		const current = rebased.get(change.id);
		// Keep the validated current document as the rollback baseline. The patch
		// already changes only remote metadata, never any of these point fields.
		change.before = current;
		change.after = { ...change.after };
		for (const field of POINT_FIELDS) {
			if (Object.prototype.hasOwnProperty.call(current, field)) change.after[field] = current[field];
			else delete change.after[field];
		}
	}
	const changed = new Map(plan.changes.filter(change => change.collection === 'matches').map(change => [change.id, change.after]));
	final_state.matches = final_state.matches.map(match => rebased.has(match._id)
		? changed.get(match._id) || rebased.get(match._id) : match);
}

async function unchanged(db, tkey, expected, locked_matches, skip = false, diagnostics, point_rebase, ignore_successor = false) {
	const checked = await Promise.all(COLLECTIONS.map(async collection => {
		const visited = new Set();
		let mismatches = 0;
		const samples = [];
		const projection = doc => collection === 'matches'
			? (skip ? local_projection(doc) : point_rebase?.matches.has(doc._id)
				? point_projection(doc) : dependency_projection(doc, locked_matches, ignore_successor)) : doc;
		// Most records still have the same immutable identity. Only replacements
		// need a value comparison, with score traffic filtered as before.
		const different = await db[collection].find_async({
			...query_for(collection, tkey),
			$where: function() {
				visited.add(this._id);
				const entry = expected[collection].get(this._id);
				if (entry?.document === this) return false;
				if (entry && entry.signature === undefined) entry.signature = JSON.stringify(projection(entry.document));
				const same = entry && entry.signature === JSON.stringify(projection(this));
				if (same) {
					if (collection === 'matches' && point_rebase?.matches.has(this._id) &&
						POINT_FIELDS.some(field => !utils.deep_equal(entry.document[field], this[field]))) {
						point_rebase.rebased.set(this._id, this);
					}
					entry.document = this;
					return false;
				}
				mismatches++;
				if (diagnostics && samples.length < 4) {
					const update = entry && patch(projection(entry.document), projection(this));
					samples.push({ id: this._id, kind: entry ? 'changed' : 'added',
						fields: update ? [...Object.keys(update.$set || {}), ...Object.keys(update.$unset || {})] : [],
					});
				}
				return true;
			},
		}, { _id: 1, tournament_key: 1, key: 1 });
		if (diagnostics) {
			for (const id of expected[collection].keys()) if (!visited.has(id)) {
				mismatches++;
				if (samples.length < 4) samples.push({ id, kind: 'removed', fields: [] });
			}
			if (mismatches) diagnostics.push({ collection, count: mismatches, samples });
		}
		return different.length === 0 && visited.size === expected[collection].size;
	}));
	return checked.every(Boolean);
}

async function guard(app, tkey, options) {
	if (options.is_current && !options.is_current()) return 'connection_terminated';
	const tournament = await app.db.tournaments.findOne_async({ key: tkey }, { btp_enabled: 1, last_reset_ts: 1 });
	if (options.is_current && !options.is_current()) return 'connection_terminated';
	if (!tournament) return options.worker_operation === 'auto_call' ? 'tournament_missing' : 'btp_disabled';
	// Automatic local allocation uses the same validated planner, also when
	// this tournament is operated without a BTP connection.
	if (options.worker_operation !== 'auto_call' && tournament.btp_enabled !== true) return 'btp_disabled';
	if (options.expected_reset_ts !== undefined && tournament.last_reset_ts !== options.expected_reset_ts) return 'tournament_reset_during_sync';
	return null;
}

function resulting_state(before, changes) {
	const result = {};
	for (const collection of COLLECTIONS) {
		const docs = new Map(before[collection].map(doc => [doc._id, doc]));
		for (const change of changes) if (change.collection === collection) {
			if (change.after) docs.set(change.id, change.after);
			else docs.delete(change.id);
		}
		result[collection] = Array.from(docs.values()).sort((a, b) => String(a._id).localeCompare(String(b._id)));
	}
	return result;
}

function remember_committed_records(db, changes, expected) {
	for (const collection of new Set(changes.map(change => change.collection))) {
		const changed_ids = new Set(changes.filter(change => change.collection === collection).map(change => change.id));
		for (const doc of db[collection].getAllData()) {
			if (!changed_ids.has(doc._id)) continue;
			const entry = expected[collection].get(doc._id);
			if (entry) { entry.document = doc; delete entry.signature; }
		}
	}
}

function next_pause_check(state, now) {
	const tournament = state.tournaments[0];
	if (tournament?.btp_settings?.check_in_per_match) return Infinity;
	const duration = Number(tournament?.btp_settings?.pause_duration_ms) || 0;
	let next = Infinity;
	for (const match of state.matches) for (const team of match.setup?.teams || []) for (const player of team.players || []) {
		if (player.checked_in) continue;
		for (const deadline of [Number(player.last_time_on_court_ts) + duration, Number(player.tablet_break_until_ts)]) {
			if (Number.isFinite(deadline) && deadline > now) next = Math.min(next, deadline);
		}
	}
	return next;
}

async function publish(app, effects, final_state) {
	const admin = require('./admin');
	const by_id = collection => new Map(final_state[collection].map(doc => [doc._id, doc]));
	const matches = by_id('matches');
	const umpires = by_id('umpires');
	const seen = new Set();
	const jobs = [];
	for (const effect of effects) {
		if (effect.resources.deferred_job) { jobs.push(effect); continue; }
		const notification = effect.resources.notification;
		if (!notification) { effect.run(app); continue; }
		const { tournament_key, ctype } = notification;
		let value = copy(notification.value);
		const id = value?.match__id || value?.match?._id || (value?.setup && value?._id);
		const key = `${ctype}:${id || value?._id || ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (id && ctype !== 'match_remove') {
			const current = matches.get(id);
			if (!current) continue;
			if (value.match) value.match = current;
			else if (value.match__id) value = { ...value, setup: current.setup, btp_winner: current.btp_winner };
			else value = current;
		}
		if (ctype === 'umpire_updated') value = umpires.get(value._id) || value;
		if (value?.all_courts) value.all_courts = final_state.courts;
		if (value?.all_locations) value.all_locations = final_state.locations;
		if (value?.all_umpires) value.all_umpires = final_state.umpires;
		admin.notify_change(app, tournament_key, ctype, value);
	}
	return jobs;
}

async function apply(app, tkey, plan) {
	const completed = [];
	const batch_writes = require('./btp_planner/batch_writes');
	const enabled = require('./offload/profile').enabled('sync_batch_writes');
	const stats = { batch_groups: 0, batch_changes: 0, individual_writes: 0, prepared_tournament_writes: 0, prepared_tournament_fallbacks: 0 };
	const count_prepared = counts => {
		stats.prepared_tournament_writes += counts.prepared_writes;
		stats.prepared_tournament_fallbacks += counts.prepared_fallbacks;
	};
	try {
		// Deletions first permit court-number changes and renamed identifiers.
		const ordered = [...plan.changes.filter(change => !change.after), ...plan.changes.filter(change => change.after)];
		for (let i = 0; i < ordered.length; i++) {
			const change = ordered[i];
			const store = app.db[change.collection];
			if (enabled && batch_writes.supported(store)) {
				const group = [change];
				while (ordered[i + 1]?.collection === change.collection) group.push(ordered[++i]);
				count_prepared(await batch_writes.write(store, group, entry => ({ _id: entry.id, ...query_for(entry.collection, tkey) }), plan.prepared));
				completed.push(...group);
				stats.batch_groups++; stats.batch_changes += group.length;
				continue;
			}
			const query = { _id: change.id, ...query_for(change.collection, tkey) };
			if (plan.prepared.has(change) && batch_writes.supported(store) && !store.timestampData) {
				count_prepared(await batch_writes.write(store, [change], () => query, plan.prepared));
				completed.push(change); stats.individual_writes++;
				continue;
			}
			if (!change.after) await store.remove_async(query, {});
			else if (!change.before) await promisify(store.insert.bind(store))(change.after);
			else {
				const [count] = await store.update_async(query, change.update, {});
				if (count !== 1) throw new Error(`BTP sync lost ${change.collection}/${change.id}`);
			}
			completed.push(change);
			stats.individual_writes++;
		}
		return stats;
	} catch (error) {
		// NeDB has no multi-document transaction. Restore completed writes under
		// the same locks, and never publish or cache a partially applied plan.
		for (const change of completed.reverse()) {
			const store = app.db[change.collection];
			const query = { _id: change.id, ...query_for(change.collection, tkey) };
			try {
				if (!change.before) await store.remove_async(query, {});
				else if (!change.after) await promisify(store.insert.bind(store))(change.before);
				else await store.update_async(query, change.before, {});
			} catch (rollback_error) {
				error.message += `; rollback failed: ${rollback_error.message}`;
			}
		}
		throw error;
	}
}

function timing(tkey, phase, start, details = {}) {
	const ts = Date.now();
	const duration_ms = ts - start;
	require('./performance/traces').phase(phase, start, duration_ms, details);
	if (require('./server_diagnostics').sync_timing_enabled(tkey)) {
		console.warn('[bts] btp_sync:phase_timing ' + JSON.stringify({ tournament_key: tkey, phase, start_ts: start, ts, duration_ms, ...details })); // eslint-disable-line no-console
	}
}

async function run(app, tkey, response, options, integrate, cache) {
	const started = Date.now();
	const log_timing = (phase, start, details = {}) => timing(tkey, phase, start, {
		task: options.task_name || 'fetch_sync_apply', ...details,
	});
	const initial_reason = await guard(app, tkey, options);
	if (initial_reason) return { skipped: true, reason: initial_reason };
	let preflight_state;
	if (options.preflight) {
		const check_start = Date.now();
		const checked = await options.preflight.inspect(app, tkey, cache.preflight);
		log_timing('auto_call_precheck', check_start, { skipped: !!checked.reason,
			reason: checked.reason, next_check_ts: Number.isFinite(checked.next_check_ts) ? checked.next_check_ts : null });
		if (checked.reason) return { skipped: true, reason: checked.reason };
		preflight_state = checked.state;
		cache.preflight = null;
	}
	const fingerprint_start = Date.now();
	const response_json = JSON.stringify(response);
	const source_hash = crypto.createHash('sha256').update(response_json).digest('hex');
	const now = app.clock ? app.clock.now_ms() : Date.now();
	const skip_unchanged = options.skip_unchanged !== false && cache.source_hash === source_hash && now < cache.next_pause_check && !cache.hidden_retry && !cache.pending &&
		await unchanged(app.db, tkey, cache.skip_input, new Set(), true);
	log_timing('incremental_fingerprint', fingerprint_start, { skipped: skip_unchanged, reason: skip_unchanged ? 'unchanged' : 'inspect_changes' });
	if (skip_unchanged) {
		log_timing('incremental_plan', started, { skipped: true, changes: 0, locks: 0 });
		return { skipped: true, reason: 'no_sync_changes' };
	}
	for (let attempt = 0; ; attempt++) {
		const snapshot_start = Date.now();
		const before = preflight_state || await snapshot(app.db, tkey);
		preflight_state = null;
		log_timing('incremental_snapshot', snapshot_start, { attempt });
		cache.source_hash = null;
		let effects = [], changes;
		let after, diff_start, worker_clock;
		const worker_planning = options.worker_operation && require('./offload/profile').enabled('sync_plan');
		const planning_timing = require('./offload/timing').start('sync_plan', worker_planning ? 'worker' : 'main', {
			tournament_key: tkey, planner_operation: options.worker_operation || 'custom', attempt,
		});
		let planning_error;
		try {
			if (worker_planning) {
				const plan_start = Date.now();
				const result = await require('./btp_planner').plan(cache, before, app, tkey, response_json, options);
				worker_clock = result.clock;
				if (result.result !== true) return result.result;
				effects = result.effects.map(require('./btp_sync_effects').restore);
				const documents = Object.fromEntries(COLLECTIONS.map(collection => [collection,
					new Map(before[collection].map(doc => [doc._id, doc]))]));
				changes = result.changes.map(change => ({ ...change, before: documents[change.collection].get(change.id) }));
				log_timing('incremental_worker_plan', plan_start, { attempt, copied_records: result.copied_records,
					selection_calls: result.selection_calls, phases: result.phases });
			} else {
				if (!cache.db) cache.db = memory_db();
				const refresh_start = Date.now();
				const refresh_metrics = {};
				const copied_records = await refresh(cache.db, before, cache.stage_state, cache.source_state, refresh_metrics);
				cache.source_state = before;
				log_timing('incremental_refresh', refresh_start, { attempt, copied_records, ...refresh_metrics });
				const planning_app = cache.planning_app || (cache.planning_app = { db: cache.db, wss: { clients: [] } });
				planning_app.clock = app.clock;
				planning_app._btp_sync_effects = effects;
				const result = await require('./offload/timing').measure('sync_plan_integrate', 'main', {
					tournament_key: tkey, planner_operation: options.worker_operation || 'custom',
				}, async () => {
					const value = await integrate(planning_app, tkey, JSON.parse(response_json), options);
					// Include writes whose helpers returned before their callbacks.
					await cache.db.wait_for_writes();
					return value;
				});
				after = planning_snapshot(cache.db);
				cache.stage_state = after;
				if (result !== true) return result;
			}
			diff_start = Date.now();
			if (!changes) changes = await differences(before, after, cache.db);
		} catch (error) {
			planning_error = error;
			cache.db = cache.planning_app = cache.stage_state = cache.source_state = null;
			throw error;
		} finally { if (planning_timing) planning_timing.finish(planning_error); }
		const scope = resources(tkey, before, changes, effects);
		const plan = { before, changes, effects, ...scope };
		plan.prepared = new Map();
		if (require('./offload/profile').enabled('sync_prepared_tournament')) {
			const prepare_start = Date.now();
			for (const change of changes) {
				const store = app.db[change.collection];
				if (change.collection !== 'tournaments' || store.timestampData || !require('./btp_planner/batch_writes').supported(store)) continue;
				const prepared = require('./btp_planner/prepared_tournament').prepare(change);
				if (prepared) plan.prepared.set(change, prepared);
			}
			log_timing('incremental_prepare_writes', prepare_start, { prepared_tournaments: plan.prepared.size });
		}
		const input = validation_input(before);
		const final_state = resulting_state(before, changes);
		const point_matches = point_rebase_matches(before, changes, effects, scope.locked_matches);
		// With automatic preparation disabled, point-derived successor markers on
		// unlocked games affect neither pure ordering writes nor court selection.
		// Preserve validation of every other field and all locked-game markers.
		const ignore_successor = !before.tournaments.some(tournament => tournament.call_preparation_matches_automatically_enabled === true) &&
			(options.worker_operation === 'auto_call' || scope.diagnostics.allocation_scope === 'ordering_only');
		log_timing('incremental_diff', diff_start, { attempt, changes: changes.length });
		const queued = Date.now();
		log_timing('incremental_plan', started, { attempt, changes: changes.length, match_locks: scope.locked_matches.size, locks: scope.locks, lock_scope: scope.diagnostics });
		const commit = async () => {
			log_timing('integration_lock_wait', queued, { locks: scope.locks });
			const reason = await guard(app, tkey, options);
			if (reason) return { skipped: true, reason };
			if (worker_clock && !require('./btp_planner/clock').current(app.clock, worker_clock)) {
				log_timing('incremental_replan', Date.now(), { attempt, reason: 'clock_changed' });
				return { retry: true };
			}
			const validation_start = Date.now();
			const mismatches = [];
			const rebased = new Map();
			const valid = await unchanged(app.db, tkey, input, scope.locked_matches, false, mismatches, { matches: point_matches, rebased }, ignore_successor);
			log_timing('incremental_validate', validation_start, { attempt, valid, rebased_matches: rebased.size });
			if (!valid) {
				log_timing('incremental_replan', validation_start, { attempt, mismatches });
				return { retry: true };
			}
			if (options.is_current && !options.is_current()) return { skipped: true, reason: 'connection_terminated' };
			if (rebased.size) {
				const rebase_start = Date.now();
				merge_point_rebases(plan, final_state, rebased);
				log_timing('incremental_point_rebase', rebase_start, { attempt, matches: rebased.size, match_ids: [...rebased.keys()].slice(0, 4) });
			}
			const skip_input = validation_input(final_state);
			const pending = final_state.matches.some(match => match.btp_needsync);
			const pause_check = next_pause_check(final_state, now);
			const apply_start = Date.now();
			const write_stats = await apply(app, tkey, plan);
			log_timing('incremental_writes', apply_start, { changes: changes.length,
				...write_stats,
				collections: Object.fromEntries(COLLECTIONS.map(collection => [collection, changes.filter(change => change.collection === collection).length])) });
			const publish_start = Date.now();
			const jobs = await publish(app, effects, final_state);
			log_timing('incremental_publish', publish_start, { effects: effects.length, deferred_jobs: jobs.length });
			const cache_start = Date.now();
			remember_committed_records(app.db, changes, skip_input);
			cache.hidden_retry = effects.some(effect => effect.resources.hidden_bye) && cache.last_hidden_response !== source_hash;
			if (effects.some(effect => effect.resources.hidden_bye)) cache.last_hidden_response = source_hash;
			cache.source_hash = source_hash;
			cache.skip_input = skip_input;
			cache.pending = pending;
			cache.next_pause_check = pause_check;
			log_timing('incremental_cache', cache_start);
			log_timing('incremental_apply', apply_start, { changes: changes.length, match_locks: scope.locked_matches.size, rebased_matches: rebased.size });
			const changed = changes.length > 0 || effects.some(effect => !effect.resources.notification && !effect.resources.deferred_job);
			if (options.preflight) cache.preflight = changed ? null : options.preflight.remember(final_state, now);
			return { applied: true, jobs, changed };
		};
		const committed = await update_queue.execute_locked(scope.locks, update_queue.hang_after(30000,
			update_queue.named(options.task_name || 'fetch_sync_apply', commit)));
		if (!committed.retry) {
			if (!committed.applied) return committed;
			for (const job of committed.jobs) job.run(app);
			log_timing('total_incremental', started, { attempts: attempt + 1 });
			return committed.changed ? true : { skipped: true, reason: 'no_sync_changes' };
		}
		// Release before replanning; never request additional locks from inside a
		// task. Continuous activity yields to existing work instead of starving it.
		await yield_turn();
		if (attempt >= 7) throw new Error('BTP sync changed repeatedly while waiting; retry on next fetch');
		const reason = await guard(app, tkey, options);
		if (reason) return { skipped: true, reason };
	}
}

function sync(app, tkey, response, options, integrate) {
	const traces = require('./performance/traces');
	const independent_call = !traces.capture()?.suppressed && options.worker_operation === 'auto_call' && traces.capture()?.record?.type !== 'calling';
	if ((!traces.capture() || independent_call) && traces.enabled()) return traces.operation(options.task_name || 'sync_plan', {
		tournament_key: tkey, type: options.worker_operation === 'auto_call' ? 'calling' : 'sync',
	}, () => sync(app, tkey, response, options, integrate), independent_call);
	const cache = cache_for(app, tkey, options.planning_namespace);
	// Direct callers and replacement connections must not overtake an older
	// integration. This promise holds no resource lock.
	const wait = traces.begin('sync_serialization', 'queue_wait');
	const work = cache.tail.then(() => { traces.end(wait); return run(app, tkey, response, options, integrate, cache); });
	cache.tail = work.catch(() => {});
	return work;
}

module.exports = { sync, _patch: patch, _resources: resources, _snapshot: snapshot };
