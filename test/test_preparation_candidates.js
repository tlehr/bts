'use strict';

const assert = require('assert');
const automation = require('../bts/match_automation');
const { promisify } = require('util');
const database = require('../bts/database');
const match_utils = require('../bts/match_utils');
const admin = require('../bts/admin');

function fixture() {
	return {
		key: 'test', call_preparation_matches_automatically_enabled: true, official_rotation_mode: 'disabled',
		locations: [{ _id: 'hall', name: 'Hall' }],
		courts: [{ _id: 'court', location_id: 'hall', is_active: true, match_id: null }],
		umpires: [], tabletoperators: [], btp_settings: {},
		matches: Array.from({ length: 8 }, (_, i) => ({ _id: 'match-' + i, match_order: i + 1, setup: {
			state: 'scheduled', is_match: true, incomplete: false, match_num: i + 1, location_id: 'hall',
			scheduled_date: '2026-10-11', scheduled_time_str: '10:00',
			teams: [{ players: [{ btp_id: i * 2 + 1, name: 'A' + i }] }, { players: [{ btp_id: i * 2 + 2, name: 'B' + i }] }],
		} })),
	};
}

function compare(tournament) {
	const options = { now_ts: 1791716400000 };
	const full = automation.calculate_location_preparation_selection(tournament, 'hall', options);
	const automatic = automation.calculate_location_preparation_selection(tournament, 'hall', { ...options, automatic_only: true });
	for (const field of ['required_preparation_count', 'current_preparation_count', 'missing_preparation_count',
		'effective_required_preparation_count', 'effective_missing_preparation_count', 'frontier', 'relevant_matches',
		'candidates', 'selected_matches', 'auto_selected_matches']) assert.deepStrictEqual(automatic[field], full[field], field);
	if (full.effective_missing_preparation_count > 0 && !full.auto_selected_matches.length) {
		assert.deepStrictEqual(automatic.display_frontier, full.display_frontier);
		const repair = full.frontier || full.display_frontier;
		if (repair) assert.deepStrictEqual(automatic.diagnostics_by_match_id[repair._id], full.diagnostics_by_match_id[repair._id]);
	}
	assert.strictEqual(automatic.call_on_court_diagnostics_by_match_id, undefined);
	assert.strictEqual(automatic.field_selection_debug, undefined);
	return { full, automatic };
}

describe('automatic preparation without UI diagnostics', function() {
	it('uses the lean default for actual calls, keeps admin diagnostics and supports the old-path override', async function() {
		const flag = 'BTS_PREPARATION_CANDIDATES_LIGHT', saved = process.env[flag];
		const original = automation.fetch_location_preparation_selection;
		try {
			for (const override of [undefined, '0']) {
				if (override === undefined) delete process.env[flag]; else process.env[flag] = override;
				const db = await database.init_test();
				const input = fixture(), { locations, courts, matches, umpires, tabletoperators, ...settings } = input;
				const insert = (collection, doc) => promisify(db[collection].insert.bind(db[collection]))(doc);
				const tournament = await insert('tournaments', settings);
				for (const [collection, documents] of Object.entries({ locations, courts, matches, umpires, tabletoperators })) {
					for (const doc of documents) await insert(collection, { ...doc, tournament_key: settings.key });
				}
				const app = { db, clock: { now_ms: () => 1791716400000 } };
				let selection;
				automation.fetch_location_preparation_selection = async (...args) => {
					selection = await original(...args);
					return selection;
				};
				await promisify(match_utils.auto_execute_preparation_selection)(app, tournament, 'hall');
				assert.strictEqual(selection.field_selection_debug === undefined, override === undefined);
				assert.deepStrictEqual(selection.auto_selected_matches.map(match => match._id), ['match-0']);
				const called = await db.matches.findOne_async({ _id: 'match-0' });
				assert.strictEqual(called.setup.state, 'preparation');
				assert.strictEqual(called.setup.preparation_call_timestamp, app.clock.now_ms());
				let response;
				await admin.async_handle_preparation_selection_get(app, {
					respond(_request, error, value) { assert.ifError(error); response = value; },
				}, { tournament_key: settings.key });
				const ui = response.selections.find(row => row.location_id === 'hall');
				assert(ui.diagnostics_by_match_id['match-1'].rules.length > 0);
				assert(Array.isArray(ui.field_selection_debug.sorted_free_court_ids));
				assert(ui.call_on_court_diagnostics_by_match_id['match-0'].court_diagnostics.length > 0);
			}
		} finally {
			automation.fetch_location_preparation_selection = original;
			if (saved === undefined) delete process.env[flag]; else process.env[flag] = saved;
		}
	});

	it('selects the same scheduled candidates and leaves the UI response complete', function() {
		const { full, automatic } = compare(fixture());
		assert.strictEqual(automatic.auto_selected_matches.length, 1);
		assert.deepStrictEqual(automatic.diagnostics_by_match_id, {});
		assert(Object.keys(full.diagnostics_by_match_id).length > 1);
		assert(full.field_selection_debug);
	});
	it('preserves the exact waiting-tabletoperator repair diagnostics', function() {
		const tournament = fixture(); tournament.matches = tournament.matches.slice(0, 1);
		tournament.preparation_call_no_player_waiting_as_tabletoperator_enabled = true;
		tournament.tabletoperators = [{ _id: 'operator', court: null, end_ts: null,
			tabletoperator: [{ btp_id: 1, name: 'A0' }] }];
		const { automatic } = compare(tournament);
		assert.strictEqual(automatic.auto_selected_matches.length, 0);
		assert(automatic.diagnostics_by_match_id['match-0'].rules.some(rule => rule.key === 'not_waiting_tabletoperator' && rule.passed === false));
	});
	it('preserves official availability, court occupancy, prepared matches and successor demand', function() {
		const tournament = fixture();
		tournament.preparation_call_technical_officials_available_enabled = true;
		tournament.official_rotation_mode = 'umpire_only';
		tournament.technical_official_auto_assignment_mode = 'on_preparation_call';
		compare(tournament);
		tournament.umpires = [{ _id: 'umpire', umpire_wait: 1000 }]; compare(tournament);
		tournament.matches[0].setup.state = 'preparation'; compare(tournament);
		tournament.courts[0].match_id = 'match-1';
		Object.assign(tournament.matches[1].setup, { state: 'oncourt', now_on_court: true, court_id: 'court', needs_preparation_successor: true });
		compare(tournament);
	});
	it('keeps byes and incomplete entries out of playable calls', function() {
		const tournament = fixture();
		tournament.matches[0].setup.is_match = false;
		tournament.matches[1].setup.incomplete = true;
		const { automatic } = compare(tournament);
		assert(automatic.candidates.every(match => match.setup.is_match && !match.setup.incomplete));
	});
	it('preserves check-in, player pause and disabled automatic selection', function() {
		const tournament = fixture();
		tournament.btp_settings = { check_in_per_match: true, pause_duration_ms: 60000 };
		tournament.preparation_call_participant_readiness_mode = 'checked_in';
		compare(tournament);
		for (const match of tournament.matches) for (const team of match.setup.teams) {
			for (const player of team.players) { player.checked_in = true; player.last_time_on_court_ts = 1791716390000; }
		}
		compare(tournament);
		tournament.preparation_call_participant_readiness_mode = 'pause_expired'; compare(tournament);
		tournament.call_preparation_matches_automatically_enabled = false; compare(tournament);
	});
});
