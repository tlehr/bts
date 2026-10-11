'use strict';

function inputs(count = 3) {
	const players = new Map();
	const player = id => {
		if (!players.has(id)) players.set(id, { ID: [id], Firstname: ['Player'],
			Lastname: [String(id)], CheckedIn: [false], entries: new Map(), ClubID: [1] });
		return players.get(id);
	};
	const matches = Array.from({ length: count }, (_, index) => ({
		ID: [index + 1], DrawID: [10], PlanningID: [10000 + index],
		From1: [2 * index + 1], From2: [2 * index + 2],
		IsMatch: [true], MatchNr: [index + 1], Highlight: [0], Status: 0,
		bts_complete: true,
		bts_players: [[player(index === 1 ? 1 : 2 * index + 1)], [player(2 * index + 2)]],
	}));
	const planning_nodes = new Map();
	for (const bm of matches) {
		planning_nodes.set('10_' + bm.PlanningID[0], bm);
		for (const [index, team] of bm.bts_players.entries()) {
			const planning = index === 0 ? bm.From1[0] : bm.From2[0];
			planning_nodes.set('10_' + planning, { DrawID: [10], PlanningID: [planning],
				EntryID: [planning], bts_winners: team });
		}
	}
	const state = { matches, planning_nodes, players, links: [], courts: new Map(),
		draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['Singles'], Position: [1] }]]),
		events: new Map([[20, { ID: [20], Name: ['Singles'], GameTypeID: [1] }]]),
		stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
		clubs: new Map([[1, { ID: [1], Name: ['Club'], DistrictID: [1] }]]),
		districts: new Map([[1, { ID: [1], Name: ['NRW-District'] }]]),
	};
	return { state, tournament: { _id: 'tournament', key: 'default', last_reset_ts: 1, btp_settings: {} },
		scoring_formats: new Map(), location_map: new Map(), court_map: new Map(),
		officials: new Map(), on_court: new Set(), match_id: bm => 'default_Singles_' + bm.ID[0] };
}

function documents(input) {
	return input.state.matches.map(bm => ({
		_id: 'match_' + bm.ID[0], tournament_key: 'default', btp_id: input.match_id(bm),
		_btp_sync_signature: 'already-synced', score_status: 'normal',
		btp_match_ids: [{ draw: 10, planning: bm.PlanningID[0], id: bm.ID[0] }],
		setup: { state: 'oncourt', now_on_court: true,
			teams: bm.bts_players.map(team => ({ players: team.map(player => ({ btp_id: player.ID[0], checked_in: false })) })),
		},
	}));
}

function add_excluded_records(input) {
	const excluded = input.state.matches.map((bm, index) => ({ ...bm,
		ID: [100000 + index], PlanningID: [50000 + index],
		IsMatch: [index % 2 === 0], ...(index % 2 === 0 ? { ReverseHomeAway: [true] } : {}),
	}));
	for (const node of excluded) {
		input.state.matches.push(node);
		input.state.planning_nodes.set('10_' + node.PlanningID[0], node);
	}
	return excluded;
}

module.exports = { inputs, documents, add_excluded_records };
