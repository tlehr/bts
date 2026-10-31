'use strict';

const assert = require('assert');
const automation = require('../bts/match_automation');

function match(id, order, setup = {}) {
	return {_id: id, match_order: order, setup: {
		state: 'scheduled', is_match: true, match_num: order, location_id: 'hall',
		scheduled_date: '2026-10-31', scheduled_time_str: '10:00',
		event_name: 'MX U17', phase_block_key: 'A',
		teams: [{players: [{btp_id: order * 2}]}, {players: [{btp_id: order * 2 + 1}]}],
		...setup,
	}};
}

function tournament(matches, settings = {}) {
	return {
		key: 'test', call_preparation_matches_automatically_enabled: true,
		official_rotation_mode: 'disabled', matches,
		locations: [{_id: 'hall'}],
		courts: [{_id: 'court', num: 1, location_id: 'hall', is_active: true, match_id: null}],
		umpires: [], tabletoperators: [], ...settings,
	};
}

const options = Object.freeze({now_ts: Date.parse('2026-10-31T10:00:00')});
const ids = matches => matches.map(item => item._id);
const selection_fields = ['required_preparation_count', 'current_preparation_count', 'missing_preparation_count',
	'effective_required_preparation_count', 'effective_missing_preparation_count', 'frontier', 'relevant_matches',
	'candidates', 'selected_matches', 'auto_selected_matches'];

function compare_without_deferred(input) {
	const snapshot = structuredClone(input);
	const reference = {...input, matches: input.matches.filter(item => item.setup.preparation_call_deferred !== true)};
	for (const automatic_only of [false, true]) {
		const full = automation.calculate_location_preparation_selection(input, 'hall', {...options, automatic_only});
		const expected = automation.calculate_location_preparation_selection(reference, 'hall', {...options, automatic_only});
		for (const field of selection_fields) assert.deepStrictEqual(full[field], expected[field], field);
		if (!automatic_only) {
			for (const field of ['display_frontier', 'display_cutoff', 'display_relevant_matches', 'display_candidates']) {
				assert.deepStrictEqual(full[field], expected[field], field);
			}
			for (const item of reference.matches) {
				assert.deepStrictEqual(full.diagnostics_by_match_id[item._id], expected.diagnostics_by_match_id[item._id], item._id);
			}
		}
	}
	assert.deepStrictEqual(automation.find_global_preparation_candidates(input, options),
		automation.find_global_preparation_candidates(reference, options), 'Global preparation');
	assert.deepStrictEqual(automation.find_call_on_court_candidates(input, 'court', options),
		automation.find_call_on_court_candidates(reference, 'court', options), 'Court candidates');
	assert.deepStrictEqual(automation.find_call_on_court_frontier_match(input, 'court', options),
		automation.find_call_on_court_frontier_match(reference, 'court', options), 'Court frontier');
	assert.deepStrictEqual(input, snapshot, 'Calculating candidates must not modify deferred games or their participants');
}

describe('Deferred games do not influence call candidates', function() {
	it('does not use an early deferred game as a time, block or match-count frontier', function() {
		const input = tournament([
			match('deferred', 1, {preparation_call_deferred: true, phase_block_key: 'old', scheduled_time_str: '08:00'}),
			match('ready', 2),
		], {
			preparation_call_block_ahead_limit_enabled: true, preparation_call_block_ahead_limit: 0,
			preparation_call_matches_ahead_of_frontier_enabled: true, preparation_call_matches_ahead_of_frontier_limit: 0,
			preparation_call_time_ahead_of_frontier_enabled: true, preparation_call_time_ahead_of_frontier_minutes: 0,
			call_on_court_block_ahead_limit_enabled: true, call_on_court_block_ahead_limit: 0,
			call_on_court_matches_ahead_of_frontier_enabled: true, call_on_court_matches_ahead_of_frontier_limit: 0,
			call_on_court_time_ahead_of_frontier_enabled: true, call_on_court_time_ahead_of_frontier_minutes: 0,
		});
		compare_without_deferred(input);
		const selection = automation.calculate_location_preparation_selection(input, 'hall', options);
		assert.strictEqual(selection.frontier, null);
		assert.strictEqual(selection.display_frontier, null);
		assert.deepStrictEqual(ids(selection.auto_selected_matches), ['ready']);
	});

	for (const kind of ['block', 'matches']) {
		it('does not count intervening deferred games towards the '+kind+' limit', function() {
			const settings = kind === 'block' ? {
				preparation_call_block_ahead_limit_enabled: true, preparation_call_block_ahead_limit: 1,
				call_on_court_block_ahead_limit_enabled: true, call_on_court_block_ahead_limit: 1,
			} : {
				preparation_call_matches_ahead_of_frontier_enabled: true, preparation_call_matches_ahead_of_frontier_limit: 1,
				call_on_court_matches_ahead_of_frontier_enabled: true, call_on_court_matches_ahead_of_frontier_limit: 1,
			};
			const input = tournament([
				match('frontier', 1, {incomplete: true}),
				match('deferred', 2, {preparation_call_deferred: true, phase_block_key: 'B'}),
				match('ready', 3, {phase_block_key: 'C'}),
			], settings);
			compare_without_deferred(input);
			assert.deepStrictEqual(ids(automation.find_location_preparation_candidates(input, 'hall', options)), ['ready']);
			assert.deepStrictEqual(ids(automation.find_call_on_court_candidates(input, 'court', options)), ['ready']);
		});
	}

	it('does not extend the displayed boundary to a trailing deferred game', function() {
		const input = tournament([match('ready', 1), match('deferred', 2, {preparation_call_deferred: true})]);
		compare_without_deferred(input);
		assert.strictEqual(automation.get_location_preparation_display_window(input, 'hall', options).display_cutoff._id, 'ready');
	});

	it('does not count a deferred preparation as an available successor', function() {
		const input = tournament([
			match('deferred', 1, {state: 'preparation', preparation_call_deferred: true}), match('ready', 2),
		]);
		compare_without_deferred(input);
		assert.strictEqual(automation.calculate_location_preparation_status(input, 'hall').current_preparation_count, 0);
	});

	it('has no frontier, boundary or candidates when every game is deferred', function() {
		const input = tournament([match('deferred', 1, {preparation_call_deferred: true})]);
		compare_without_deferred(input);
		const selection = automation.calculate_location_preparation_selection(input, 'hall', options);
		assert.strictEqual(selection.frontier, null);
		assert.strictEqual(selection.display_cutoff, null);
		assert.deepStrictEqual(selection.candidates, []);
	});

	it('retains an explicit not-deferred diagnostic for inspection and manual calls', function() {
		const input = tournament([match('deferred', 1, {preparation_call_deferred: true}), match('ready', 2)]);
		const selection = automation.calculate_location_preparation_selection(input, 'hall', options);
		const diagnostic = selection.diagnostics_by_match_id.deferred;
		assert.strictEqual(diagnostic.eligible, false);
		assert.strictEqual(diagnostic.rules.find(rule => rule.key === 'not_deferred').passed, false);
		assert.strictEqual(diagnostic.manual_eligible, true);
	});

	it('recalculates immediately when the same game is deferred or released', function() {
		const input = tournament([match('first', 1), match('second', 2)]);
		const selected = () => ids(automation.calculate_location_preparation_selection(input, 'hall', options).auto_selected_matches);
		assert.deepStrictEqual(selected(), ['first']);
		input.matches[0].setup.preparation_call_deferred = true;
		compare_without_deferred(input);
		assert.deepStrictEqual(selected(), ['second']);
		delete input.matches[0].setup.preparation_call_deferred;
		assert.deepStrictEqual(selected(), ['first']);
	});

	it('keeps cooperative multi-location calculations consistent', async function() {
		const input = tournament([match('deferred', 1, {preparation_call_deferred: true}), match('ready', 2)]);
		input.locations.push({_id: 'other'});
		input.courts.push({_id: 'other-court', num: 2, location_id: 'other', is_active: true});
		input.matches.push(match('other-ready', 3, {location_id: 'other'}));
		const direct = await automation.calculate_all_location_preparation_selections(input, options);
		const cooperative = await automation.calculate_all_location_preparation_selections(input, {...options, cooperative: true});
		assert.deepStrictEqual(cooperative, direct);
		for (const selection of direct) assert(!selection.relevant_matches.some(item => item._id === 'deferred'));
	});
});
