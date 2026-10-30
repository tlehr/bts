'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const utils = require('../static/bup/dev/js/utils');

function harness(settings = {}) {
	const updates = [], pauses = [];
	const context = { curt: { btp_settings: { ...settings }, matches: [] }, utils,
		ctournament: {
			update_btp_settings_ui(fields) { updates.push(Array.from(fields)); },
			refresh_player_pauses() { pauses.push(true); },
			refresh_current_view() { assert.fail('settings must retain the mounted view'); },
		},
	};
	vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/change'), 'utf8'), context);
	const handle = context.change.default_handler(() => assert.fail('settings must retain match rows'));
	return { context, updates, pauses, handle, settings: value => handle({ ctype: 'update_btp_settings', val: { btp_settings: value } }) };
}

describe('Match settings preserve the mounted view', function() {
	it('applies successor state in the generic score update path before patching the DOM', function() {
		const h = harness(), match = { _id: 'm1', setup: {} }, states = [];
		h.context.curt.matches.push(match);
		h.context.cmatch = { update_match_score(value) { states.push([value.setup.needs_preparation_successor, value.setup.needs_preparation_successor_ts]); } };
		for (const needed of [true, false]) h.context.change.apply_score_patch({ val: { match_id: 'm1', network_score: [[10, 7]], presses: [],
			needs_preparation_successor: needed, needs_preparation_successor_ts: needed ? 12345 : null } });
		assert.deepStrictEqual(states, [[true, 12345], [false, null]]);
	});

	it('passes only changed settings and retains omitted settings', function() {
		const h = harness({ pause_duration_ms: 120000, language: 'de', extra: { enabled: true } });
		h.settings({ pause_duration_ms: 180000, extra: { enabled: true } });
		assert.deepStrictEqual(h.updates, [['pause_duration_ms']]);
		assert.strictEqual(h.context.curt.btp_settings.pause_duration_ms, 180000);
		assert.strictEqual(h.context.curt.btp_settings.language, 'de');
	});

	it('ignores repeated settings without scheduling another UI update', function() {
		const h = harness({ pause_duration_ms: 120000, extra: { enabled: true } });
		h.settings({ pause_duration_ms: 120000, extra: { enabled: true } });
		h.settings({});
		assert.deepStrictEqual(h.updates, []);
	});

	it('changes check-in permissions without rebuilding the whole view', function() {
		const h = harness({ check_in_per_match: true });
		h.settings({ check_in_per_match: false });
		assert.deepStrictEqual(h.updates, [['check_in_per_match']]);
	});

	it('applies pause resets immediately to every existing occurrence without changing identities or check-ins', function() {
		const h = harness(), player = { btp_id: 1, checked_in: true, last_time_on_court_ts: 123,
			tablet_last_time_on_court_ts: 456, tablet_break_until_ts: 789, tablet_break_active: true, now_playing_on_court: 'c1' };
		const another = { ...player, checked_in: false }, untouched = { btp_id: 2, checked_in: true };
		const match = { _id: 'm1', setup: { teams: [{ players: [player, null] }, { players: [untouched] }] } };
		h.context.curt.matches.push(match, { _id: 'm2', setup: { teams: [{ players: [another] }] } });
		h.handle({ ctype: 'player_pause_reset', val: { player_count: 1, changed_matches: 2 } });
		assert.strictEqual(h.context.curt.matches[0], match);
		assert.strictEqual(match.setup.teams[0].players[0], player);
		for (const occurrence of [player, another]) {
			assert(!('last_time_on_court_ts' in occurrence));
			assert(!('tablet_last_time_on_court_ts' in occurrence));
			assert(!('tablet_break_until_ts' in occurrence));
			assert.strictEqual(occurrence.tablet_break_active, false);
			assert.strictEqual(occurrence.now_playing_on_court, 'c1');
		}
		assert.strictEqual(player.checked_in, true);
		assert.strictEqual(another.checked_in, false);
		assert(!('tablet_break_active' in untouched));
		assert.deepStrictEqual(h.pauses, [true]);
	});
});
