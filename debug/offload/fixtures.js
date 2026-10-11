'use strict';

// Synthetic BTP data only, shared by isolated tests and the offline comparison.
function response(count = 519) {
	const players = Array.from({ length: count * 2 }, (_, index) => ({ ID: [index + 1],
		Firstname: ['Player'], Lastname: [String(index + 1)], CheckedIn: [false] }));
	const nodes = players.map(player => ({ ID: [100000 + player.ID[0]], DrawID: [10],
		PlanningID: player.ID, EntryID: player.ID }));
	const matches = Array.from({ length: count }, (_, index) => ({ ID: [index + 1], DrawID: [10],
		PlanningID: [10000 + index], From1: [2 * index + 1], From2: [2 * index + 2],
		IsMatch: [true], IsPlayable: [true], MatchNr: [index + 1], Highlight: [0], Status: [0],
		RoundName: ['G1'], PlannedTime: [{ year: 2026, month: 10, day: 10, hour: 10, minute: index % 60 }] }));
	return { Result: [{ Tournament: [{ Matches: [{ Match: [...nodes, ...matches] }], Players: [{ Player: players }],
		Entries: [{ Entry: players.map(player => ({ ID: player.ID, Player1ID: player.ID })) }],
		Events: [{ Event: [{ ID: [20], Name: ['HE'], GameTypeID: [1] }] }],
		Stages: [{ Stage: [{ ID: [30], EventID: [20], Name: ['Group'], StageType: [1], DisplayOrder: [1] }] }],
		Draws: [{ Draw: [{ ID: [10], EventID: [20], StageID: [30], Name: ['HE'], Position: [1] }] }],
		Settings: [{ Setting: [{ ID: [1001], Value: ['Synthetic'] }, { ID: [1008], Value: ['URN'] },
			{ ID: [1003], Value: [false] }, { ID: [1303], Value: [2] }] }],
	}] }] };
}

module.exports = { response };
