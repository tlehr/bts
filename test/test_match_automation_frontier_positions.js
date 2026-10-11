'use strict';

const assert = require('assert');
const { _describe, _it } = require('./tutils');
const automation = require('../bts/match_automation');

function fixture() {
	const make_match = (_id, num, phase, state = 'scheduled') => ({
		_id,
		setup: {
			match_num: num, state, phase_block_key: phase, event_name: 'MX U17',
			is_match: true, incomplete: false, location_id: 'hall',
			scheduled_date: '2026-10-10', scheduled_time_str: '10:00',
			teams: [{ players: [{ _id: _id + '-a' }] }, { players: [{ _id: _id + '-b' }] }],
		},
	});
	return {
		locations: [{ _id: 'hall' }],
		courts: [{ _id: 'court', location_id: 'hall', is_active: true, match_id: null }],
		matches: [make_match('frontier', 1, 'A', 'blocked'), make_match('b', 2, 'B'), make_match('c', 3, 'C')],
		preparation_call_block_ahead_limit_enabled: true,
		preparation_call_block_ahead_limit: 1,
	};
}

_describe('Preparation selection with frontier indexes', () => {
	_it('refreshes selection and diagnostics when the same objects and options are reused', () => {
		const tournament = fixture();
		const options = Object.freeze({ now_ts: Date.UTC(2026, 9, 10, 10), relevant_matches: tournament.matches });
		const calculate = () => automation.calculate_location_preparation_selection(tournament, 'hall', options);
		const block_rule = (selection, id) => selection.diagnostics_by_match_id[id].rules.find(r => r.key === 'frontier_block_limit');
		const before = calculate();
		assert.deepStrictEqual(before.candidates.map(m => m._id), ['b']);
		assert.strictEqual(block_rule(before, 'c').passed, false);
		tournament.matches[1].setup.phase_block_key = 'A';
		const after = calculate();
		assert.deepStrictEqual(after.candidates.map(m => m._id), ['b', 'c']);
		assert.strictEqual(block_rule(after, 'c').passed, true);
		assert.strictEqual(Object.getOwnPropertySymbols(options).length, 0);
		assert.strictEqual(Object.getOwnPropertySymbols(tournament).length, 0);
	});

	_it('uses distinct preparation and explicit diagnostic window lists', () => {
		const tournament = fixture();
		const [frontier, b, c] = tournament.matches;
		const options = {
			now_ts: Date.UTC(2026, 9, 10, 10), frontier,
			relevant_matches: tournament.matches, frontier_window_matches: [frontier, c],
		};
		assert.deepStrictEqual(automation.find_location_preparation_candidates(tournament, 'hall', options), [c]);
		const diagnostic = automation.calculate_match_preparation_diagnostics(c, 'hall', tournament, options);
		assert.strictEqual(diagnostic.rules.find(r => r.key === 'frontier_block_limit').passed, false);
		assert.strictEqual(automation.is_match_eligible_for_preparation(b, 'hall', tournament, options), false);
		assert.strictEqual(automation.is_match_eligible_for_preparation(c, 'hall', tournament, options), true);
	});
});
