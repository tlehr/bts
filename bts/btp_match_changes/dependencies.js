'use strict';

const key = (draw, planning) => `${draw}_${planning}`;

// Topology arrays and resolved labels remain valid for profile/check-in changes.
// Rebind their data indexes to THIS response and current immutable DB revisions;
// selected matches must never craft teams from a previous response's players.
function refresh(lookup, state, current_matches) {
	const result = { ...lookup,
		planning_node_by_key: new Map(), raw_match_by_key: new Map(),
		raw_match_by_draw_match_nr: new Map(), current_match_by_key: new Map(),
		current_match_by_draw_match_nr: new Map(),
	};
	for (const node of (state.planning_nodes || new Map()).values()) {
		if (node.DrawID && node.PlanningID) result.planning_node_by_key.set(key(node.DrawID[0], node.PlanningID[0]), node);
	}
	for (const match of state.matches) {
		if (match.DrawID && match.PlanningID) result.raw_match_by_key.set(key(match.DrawID[0], match.PlanningID[0]), match);
		if (match.DrawID && match.MatchNr) result.raw_match_by_draw_match_nr.set(key(match.DrawID[0], match.MatchNr[0]), match);
	}
	for (const match of current_matches) for (const id of match.btp_match_ids || []) {
		if (id.draw != null && id.planning != null) result.current_match_by_key.set(key(id.draw, id.planning), match);
		if (id.draw != null && id.nr != null) result.current_match_by_draw_match_nr.set(key(id.draw, id.nr), match);
	}
	return result;
}

module.exports = { refresh };
