'use strict';

const graph_index = require('./graph');
const MatchInput = require('./match_input');
const input_revision = require('./input_revision');
const integrated_match = require('./integrated_match');

const json = value => JSON.stringify(value);

function add(index, key, id) {
	if (!index.has(key)) index.set(key, new Set());
	index.get(key).add(id);
}

// Compare independent incoming records. Reverse indexes route changed player
// and planning records to their consumers; no combined per-match signature is
// built until that match actually needs the existing integration checks.
function source_index(inputs, previous) {
	const { state, tournament, scoring_formats, location_map, court_map, officials, on_court, match_id } = inputs;
	const memo = new WeakMap();
	const fingerprint = (value, old) => {
		if (!memo.has(value)) memo.set(value, input_revision(value, old));
		return memo.get(value);
	};
	const players = new Map();
	const variants = new Map();
	const profiles = new WeakMap();
	const profile_revisions = new Map();
	const player_matches = new Map();
	const consumers = new Map();
	const player_key = player => String(player.ID?.[0]);
	const remember_player = player => {
		const key = player_key(player);
		if (!profiles.has(player)) profiles.set(player, input_revision(player, previous?.profile_revisions.get(key), true));
		const revision = profiles.get(player);
		const signature = revision.signature;
		if (!players.has(key)) { players.set(key, signature); profile_revisions.set(key, revision); }
		else if (players.get(key) !== signature) {
			if (!variants.has(key)) variants.set(key, new Set([players.get(key)]));
			variants.get(key).add(signature);
		}
		return key;
	};
	const global = json({
		warmup: tournament.warmup, warmup_ready: tournament.warmup_ready,
		warmup_start: tournament.warmup_start,
		check_in_per_match: !!tournament.btp_settings?.check_in_per_match,
		reset: tournament.last_reset_ts, identity: tournament._id,
		scoring_formats: Array.from(scoring_formats),
		clubs: Array.from(state.clubs || []), districts: Array.from(state.districts || []),
	});
	const contexts = new Map();
	for (const [id, draw] of state.draws) contexts.set(String(id), json([
		global, draw, state.events.get(draw.EventID?.[0]), state.stages.get(draw.StageID?.[0]),
	]));
	const graph = graph_index(state, previous?.graph, fingerprint);
	const index = { contexts, graph, players };
	const matches = new Map();
	let excluded_from_selection = 0;
	for (const bm of state.matches) {
		// The graph above retains ALL nodes, including hidden bye branches.
		// Only records that can own a local match need allocation/player indexes
		// and comparisons with local match documents.
		if (!integrated_match(bm)) { excluded_from_selection++; continue; }
		const id = match_id(bm);
		const draw = String(bm.DrawID?.[0]);
		const sources = [bm.From1?.[0], bm.From2?.[0]].map(planning => graph.key(bm.DrawID?.[0], planning));
		for (const source of sources) add(consumers, source, id);
		const dependencies = [...(bm.bts_players || []).flat(), ...(bm.bts_winners || [])].filter(Boolean);
		for (const source of sources) {
			const node = graph.nodes.get(source)?.data;
			if (node) dependencies.push(...(node.bts_players || []).flat().filter(Boolean), ...(node.bts_winners || []));
		}
		const player_ids = new Set(dependencies.map(remember_player));
		for (const player of player_ids) add(player_matches, player, id);
		const record = new MatchInput(bm, draw, fingerprint(bm, previous?.matches.get(id)?.revision), json([
				location_map.get(bm.LocationID?.[0]), court_map.get(bm.CourtID?.[0]), on_court.has(bm.ID?.[0]),
				officials.get(String(bm.Official1ID?.[0])), officials.get(String(bm.Official2ID?.[0])),
		]), player_ids, sources, index);
		matches.set(id, record);
	}
	// Parsed BTP players are normally shared objects. Preserve conflicting
	// embedded copies too, so any changed source still reaches its consumers.
	for (const [player, signatures] of variants) players.set(player, json([...signatures].sort()));
	return { matches, players, profile_revisions, player_matches, consumers, contexts, graph,
		raw_incoming: state.matches.length, excluded_from_selection };
}

module.exports = source_index;
