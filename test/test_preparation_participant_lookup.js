'use strict';

const assert = require('assert');
const automation = require('../bts/match_automation');

function fixture(count = 8) {
	return {
		call_preparation_matches_automatically_enabled: true, official_rotation_mode: 'disabled',
		locations: [{ _id: 'hall' }], courts: [{ _id: 'court', location_id: 'hall', is_active: true }],
		matches: Array.from({ length: count }, (_, i) => ({ _id: 'match-' + i, setup: {
			state: 'scheduled', is_match: true, match_num: i + 1, location_id: 'hall', event_name: 'Singles',
			teams: [0, 1].map(team => ({ players: [{ btp_id: i * 2 + team + 1, name: 'Player ' + (i * 2 + team + 1) }] })),
		} })),
	};
}

const ids = matches => matches.map(match => match._id);
const rule = (diagnostic, key) => diagnostic.rules.find(entry => entry.key === key);
const options = Object.freeze({ now_ts: 1791716400000, frontier: null });

// Individual eligibility checks deliberately retain the ordinary scan fallback.
// Compare the shared batch against those rules without copying their logic.
function compare(tournament) {
	const expected = tournament.matches.filter(match => automation.is_match_eligible_for_preparation(match, 'hall', tournament, options));
	assert.deepStrictEqual(ids(automation.find_location_preparation_candidates(tournament, 'hall', options)), ids(expected));
	assert.deepStrictEqual(ids(automation.find_global_preparation_candidates(tournament, options)), ids(expected));
	const selection = automation.calculate_location_preparation_selection(tournament, 'hall', options);
	assert.deepStrictEqual(ids(selection.candidates), ids(expected));
	for (const match of selection.display_relevant_matches) {
		assert.deepStrictEqual(selection.diagnostics_by_match_id[match._id],
			automation.calculate_match_preparation_diagnostics(match, 'hall', tournament, options));
	}
	return selection;
}

describe('preparation participant references', function() {
	it('matches ordinary eligibility with shared participants and typed IDs', function() {
		const tournament = fixture();
		tournament.matches[1].setup.teams[0].players[0].btp_id = 1;
		tournament.matches[2].setup.teams[0].players[0].btp_id = '1';
		const result = compare(tournament);
		assert(!ids(result.candidates).includes('match-1'));
		assert(ids(result.candidates).includes('match-2'));
		assert.strictEqual(rule(result.diagnostics_by_match_id['match-1'], 'participant_dependencies').passed, false);
	});

	it('rebuilds references after finishes, reactivation, reassignment and reordering', function() {
		const tournament = fixture();
		const [earlier, later] = tournament.matches;
		later.setup.teams[0].players[0].btp_id = 1;
		assert(!ids(compare(tournament).candidates).includes(later._id));
		earlier.team1_won = false;
		earlier.setup.state = 'finished';
		assert(ids(compare(tournament).candidates).includes(later._id));
		delete earlier.team1_won;
		earlier.setup.state = 'scheduled';
		assert(!ids(compare(tournament).candidates).includes(later._id));
		earlier.setup.match_num = 99;
		// compare() preserves input ordering; restore it after changing the order.
		tournament.matches.sort((a, b) => a.setup.match_num - b.setup.match_num);
		assert(ids(compare(tournament).candidates).includes(later._id));
		earlier.setup.teams[0].players[0].btp_id = 999;
		assert(ids(compare(tournament).candidates).includes(earlier._id));
		assert.strictEqual(Object.getOwnPropertySymbols(options).length, 0);
		assert.strictEqual(Object.getOwnPropertySymbols(tournament).length, 0);
	});

	it('preserves special-result exclusions and named diagnostics per discipline', function() {
		const tournament = fixture();
		const [finished, same, other, empty] = tournament.matches;
		Object.assign(finished, { score_status: 'no_match', no_match_losing_team: 0, team1_won: false });
		finished.setup.state = 'finished';
		finished.setup.event_name = 'Singles - Gruppe A';
		for (const match of [same, other, empty]) match.setup.teams[0].players[0].btp_id = '1';
		other.setup.teams[0].players[0].btp_id = 1;
		other.setup.event_name = 'Doubles';
		empty.setup.event_name = '';
		let result = compare(tournament);
		assert(!ids(result.candidates).includes(same._id));
		assert(ids(result.candidates).includes(other._id));
		assert(rule(result.diagnostics_by_match_id[empty._id], 'special_result_same_discipline').passed);
		assert(!rule(result.diagnostics_by_match_id[same._id], 'special_result_same_discipline').passed);
		assert.strictEqual(rule(result.diagnostics_by_match_id[same._id], 'special_result_same_discipline').detail, 'Betroffen: Player 3');
		finished.score_status = 'normal';
		result = compare(tournament);
		assert(ids(result.candidates).includes(same._id));
	});

	it('retains unresolved predecessor and bye rules', function() {
		const tournament = fixture();
		const [bye, incomplete] = tournament.matches;
		bye.setup.is_match = false;
		bye.setup.planning_id = 101;
		incomplete.setup.links = { from1: 101 };
		incomplete.setup.teams[0].players = [];
		const selection = compare(tournament);
		assert(!ids(selection.candidates).includes(bye._id));
		assert(!ids(selection.candidates).includes(incomplete._id));
		assert.strictEqual(rule(selection.diagnostics_by_match_id[incomplete._id], 'participant_dependencies').passed, false);
	});

	it('bounds participant reads for a complete 519-game UI selection', function() {
		const tournament = fixture(519);
		let reads = 0;
		for (const match of tournament.matches) {
			const teams = match.setup.teams;
			Object.defineProperty(match.setup, 'teams', { enumerable: true, get() { reads++; return teams; } });
		}
		const expected = tournament.matches.filter(match => automation.is_match_eligible_for_preparation(match, 'hall', tournament, options));
		const ordinary_reads = reads;
		reads = 0;
		const selection = automation.calculate_location_preparation_selection(tournament, 'hall', options);
		assert.deepStrictEqual(ids(selection.candidates), ids(expected));
		assert.strictEqual(Object.keys(selection.diagnostics_by_match_id).length, 519);
		assert(reads < 519 * 30, 'UI selection repeatedly scanned participant lists: ' + reads);
		assert(ordinary_reads > reads * 5, 'fixture did not exercise the ordinary full scans');
	});

	it('shares a snapshot across locations and refreshes cross-location dependencies on the next fetch', async function() {
		const tournament = fixture();
		tournament.locations.push({ _id: 'other' });
		tournament.courts.push({ _id: 'other-court', location_id: 'other', is_active: true });
		const earlier = tournament.matches[0], later = tournament.matches.at(-1);
		later.setup.location_id = 'other';
		later.setup.teams[0].players[0].btp_id = 1;
		const db = { tournaments: { findOne_async: async () => tournament } };
		for (const name of ['locations', 'courts', 'matches', 'umpires', 'tabletoperators'])
			db[name] = { find_async: async () => tournament[name] || [] };
		const app = { db };
		async function check() {
			const all = await automation.fetch_all_location_preparation_selections(app, 'test', options);
			for (const selection of all) {
				const expected = automation.calculate_location_preparation_selection(tournament, selection.location_id, { ...options, app });
				assert.deepStrictEqual(selection, { ...expected, location: tournament.locations.find(location => location._id === selection.location_id) });
			}
			return all.find(selection => selection.location_id === 'other');
		}
		assert.strictEqual((await check()).candidates.length, 0);
		earlier.setup.state = 'finished';
		earlier.team1_won = true;
		assert.deepStrictEqual(ids((await check()).candidates), [later._id]);
	});
});
