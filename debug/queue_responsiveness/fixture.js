'use strict';

// A public, deterministic BTP response: independent matches, no real players.
function response(count = 519, changed = false) {
	const players = [], entries = [], matches = [];
	for (let n = 1; n <= count; n++) {
		for (const id of [n * 2 - 1, n * 2]) {
			players.push({ ID: [id], Firstname: ['Player'], Lastname: [String(id)], CheckedIn: [true] });
			entries.push({ ID: [id], EventID: [1], Player1ID: [id] });
			matches.push({ ID: [count + id], DrawID: [1], PlanningID: [count + id], EntryID: [id], IsMatch: [false] });
		}
		matches.push({ ID: [n], DrawID: [1], PlanningID: [n], From1: [count + n * 2 - 1], From2: [count + n * 2],
			IsMatch: [true], IsPlayable: [true], MatchNr: [n + (changed && n > 1 ? 10000 : 0)],
			Round: [1], RoundName: ['Round'], Status: [0], Highlight: [0], ScoreStatus: [0] });
	}
	const list = (name, items) => [{ [name]: items }];
	return { Result: [{ Tournament: [{
		Settings: list('Setting', [
			{ ID: [1001], Value: ['Queue responsiveness fixture'] }, { ID: [1008], Value: ['urn:queue-fixture'] },
			{ ID: [1003], Value: [true] }, { ID: [1303], Value: [0] },
		]),
		Events: list('Event', [{ ID: [1], Name: ['Singles'], GameTypeID: [1] }]),
		Stages: list('Stage', [{ ID: [1], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]),
		Draws: list('Draw', [{ ID: [1], EventID: [1], StageID: [1], Name: ['Singles'], Position: [1], DrawTypeID: [1] }]),
		Players: list('Player', players), Entries: list('Entry', entries), Matches: list('Match', matches),
		Locations: list('Location', [{ ID: [1], Name: ['Hall'] }]),
		Courts: list('Court', Array.from({ length: 13 }, (_, i) => ({ ID: [i + 1], Name: ['Court ' + (i + 1)], LocationID: [1] }))),
		ScoringFormats: list('ScoringFormat', [{ ID: [1], Name: ['Standard'], NumSets: [3], SetType: [0], LastSetType: [0], Score: [21], IsDefault: [true] }]),
	}] }] };
}

module.exports = { response };
