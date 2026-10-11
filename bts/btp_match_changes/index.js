'use strict';

const source_index = require('./sources');
const local_state = require('./local');
const caches = new WeakMap();

// The cache belongs to the actual datastore, including a planner's private DB.
// It is only published after a successful integration. Captured local revisions
// are from BEFORE integration: its writes and concurrent edits remain visible
// to the next pass, even when a prepared plan is discarded or rolled back.
function select(db, key, inputs, documents) {
	let tournaments = caches.get(db);
	if (!tournaments) caches.set(db, tournaments = new Map());
	const previous = tournaments.get(key);
	const sources = source_index(inputs, previous?.sources);
	const locals = new Map(documents.map(doc => [doc.btp_id || 'local:' + doc._id, local_state(doc)]));
	const changed = new Set();
	const draws = new Set();
	let local_changes = 0;
	let dependency_changes = 0;
	const mark_draws = record => {
		for (const id of record?.document.btp_match_ids || []) draws.add(String(id.draw));
	};
	for (const draw of sources.graph.dirty) draws.add(draw);
	for (const [draw, context] of sources.contexts) if (previous?.sources.contexts.get(draw) !== context) draws.add(draw);
	for (const [draw] of previous?.sources.contexts || []) if (!sources.contexts.has(draw)) draws.add(draw);
	const mark_consumers = key => {
		for (const id of sources.consumers.get(key) || []) changed.add(id);
		for (const id of previous?.sources.consumers.get(key) || []) changed.add(id);
	};
	for (const [key, node] of sources.graph.records) {
		if (previous?.sources.graph.records.get(key)?.signature !== node.signature) mark_consumers(node.key);
	}
	for (const [key, node] of previous?.sources.graph.records || []) if (!sources.graph.records.has(key)) mark_consumers(node.key);
	for (const [player, signature] of sources.players) {
		if (previous?.sources.players.get(player) === signature) continue;
		for (const id of sources.player_matches.get(player) || []) changed.add(id);
		for (const id of previous?.sources.player_matches.get(player) || []) changed.add(id);
	}
	for (const [id, source] of sources.matches) {
		const old = previous?.sources.matches.get(id);
		if (!old || old.signature !== source.signature || old.assignment !== source.assignment) changed.add(id);
	}
	const source_changes = changed.size;
	for (const [id] of sources.matches) {
		const local = locals.get(id);
		const old_local = previous?.locals.get(id);
		if (!local || !old_local || local.signature !== old_local.signature) {
			changed.add(id);
			local_changes++;
		}
		if (local?.document.btp_needsync || !local?.document._btp_sync_signature) changed.add(id);
	}
	for (const [id, local] of locals) {
		const old = previous?.locals.get(id);
		if (!old || old.dependency !== local.dependency) {
			dependency_changes++;
			mark_draws(local);
			mark_draws(old);
		}
	}
	for (const [id, old] of previous?.sources.matches || []) if (!sources.matches.has(id)) draws.add(old.draw);
	for (const [id, old] of previous?.locals || []) if (!locals.has(id)) { mark_draws(old); dependency_changes++; }
	const matches = [];
	for (const [id, source] of sources.matches) if (changed.has(id) || draws.has(source.draw)) matches.push(source.bm);
	let work = sources.graph.dirty.size === 0 && dependency_changes === 0
		? previous?.work : undefined;
	return {
		matches, sources: sources.matches, cached_dependencies: work,
		remember_dependencies(value) { work = value; },
		remember_local(document) {
			const old = locals.get(document.btp_id);
			const next = local_state({ ...document });
			// A known successful profile/check-in write can become the baseline.
			// Result/participant writes must remain visible to dependent matches.
			if (old && old.dependency === next.dependency) locals.set(document.btp_id, {
				signature: next.signature, dependency: next.dependency,
				document: { btp_match_ids: (document.btp_match_ids || []).map(id => ({ ...id })) },
			});
		},
		timing: { raw_incoming: sources.raw_incoming, excluded_from_selection: sources.excluded_from_selection,
			incoming: sources.matches.size, selected: matches.length,
			skipped_by_delta: sources.matches.size - matches.length, source_changes, local_changes,
			dependency_draws: draws.size, dependency_changes, dependency_cache_hit: !!work },
		finish(error) {
			if (error) tournaments.delete(key);
			else tournaments.set(key, { sources, locals, work });
		},
	};
}

module.exports = { select };
