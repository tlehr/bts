'use strict';

const assert = require('assert');
const automation = require('../bts/match_automation');

function match(id, number, players, setup = {}, result = {}) {
	return { _id: id, score_status: 'normal', ...result, setup: {
		state: 'scheduled', is_match: true, match_num: number, event_name: 'Singles',
		teams: players.map(btp_id => ({ players: [{ btp_id }] })), ...setup,
	} };
}

function tournament(matches) {
	return { matches, courts: [{ _id: 'a', is_active: true }, { _id: 'b', is_active: true, has_umpire: false }],
		official_rotation_mode: 'disabled', call_on_court_participant_readiness_mode: 'disabled' };
}

describe('call selection participant references', function() {
	it('retains raw player ID equality, match order and nonparticipant official rules', function() {
		const data = tournament([
			match('first', 1, [1, 2], { umpire: { btp_id: 99 } }),
			match('blocked', 2, [1, 3]),
			match('string', 3, ['1', 4]),
			match('official', 4, [99, 5]),
			match('finished', 0, [4, 5], { state: 'finished' }),
		]);
		const selection = automation.calculate_call_on_court_selection(data, data.courts);
		assert.deepStrictEqual(selection.potential_matches.map(m => m._id), ['first', 'string', 'official']);
		assert.deepStrictEqual(selection.by_court.get('a').map(m => m._id), ['first', 'string', 'official']);
		data.call_on_court_require_official_space_enabled = true;
		const official_selection = automation.calculate_call_on_court_selection(data, data.courts);
		assert.deepStrictEqual(official_selection.by_court.get('a').map(m => m._id), ['first', 'string', 'official']);
		assert.deepStrictEqual(official_selection.by_court.get('b').map(m => m._id), ['string', 'official']);
	});

	it('applies no-match and retirement exclusions to the losing team in the same discipline', function() {
		const data = tournament([
			match('retired', 0, [10, 11], { event_name: 'Singles - Gruppe A', state: 'finished' }, { score_status: 'retired', team1_won: true }),
			match('no-match', 0, [12, 13], { state: 'finished' }, { score_status: 'no_match', no_match_losing_team: 0 }),
			match('empty-discipline', 0, [14, 15], { event_name: '', state: 'finished' }, { score_status: 'disqualified', team1_won: false }),
			match('loser', 1, ['11', 20], { event_name: 'Singles - Position 2' }),
			match('withdrawn', 2, [12, 21]),
			match('winner', 3, [10, 13]),
			match('other-discipline', 4, [11, 22], { event_name: 'Doubles' }),
			match('unknown-discipline', 5, [14, 15], { event_name: '' }),
		]);
		assert.deepStrictEqual(automation.find_field_independent_call_on_court_candidates(data).map(m => m._id),
			['winner', 'other-discipline', 'unknown-discipline']);
	});

	it('refreshes references on successive calls with the same objects and frozen options', function() {
		const first = match('first', 1, [1, 2]), second = match('second', 2, [1, 3]);
		const data = tournament([first, second]), options = Object.freeze({ now_ts: 1 });
		const select = () => automation.calculate_call_on_court_selection(data, data.courts, options).potential_matches.map(m => m._id);
		assert.deepStrictEqual(select(), ['first']);
		first.team1_won = true;
		assert.deepStrictEqual(select(), ['second']);
		first.score_status = 'retired'; first.team1_won = false;
		assert.deepStrictEqual(select(), []);
		first.setup.event_name = 'Doubles';
		assert.deepStrictEqual(select(), ['second']);
		first.team1_won = null; first.score_status = 'normal'; first.setup.teams[0].players[0].btp_id = 4;
		assert.deepStrictEqual(select(), ['first', 'second']);
		first.setup.teams[0].players[0].btp_id = 1; first.setup.match_num = 3;
		assert.deepStrictEqual(select(), ['second']);
		assert.strictEqual(Object.getOwnPropertySymbols(options).length, 0);
		assert.strictEqual(Object.getOwnPropertySymbols(data).length, 0);
	});

	it('matches the independent linear eligibility check for overlapping players, results and scheduling windows', function() {
		for (let variant = 0; variant < 8; variant++) {
			const matches = Array.from({ length: 48 }, (_, i) => match(i, i,
				[i % 12, (i * 7) % 19], {
					event_name: i % 3 ? 'Singles - Gruppe A' : 'Doubles',
					state: i % 7 === variant ? 'finished' : 'scheduled',
					scheduled_date: '2026-10-11', scheduled_time_str: i % 5 ? '10:00' : '00:00',
				}, i % 11 === variant ? { score_status: 'retired', team1_won: !!(i % 2) } : {}));
			matches.push(match(undefined, 60, [NaN, '1']), match(undefined, 61, [NaN, 2]));
			const data = tournament(matches), options = { now_ts: Date.UTC(2026, 9, 11, 10) };
			const selected = automation.calculate_call_on_court_selection(data, data.courts, options);
			for (const court of data.courts) {
				const expected = matches.filter(m => automation.is_match_eligible_for_on_court_call(m, court._id, data, options));
				assert.deepStrictEqual(new Set(selected.by_court.get(court._id) || []), new Set(expected));
			}
		}
	});

	it('avoids quadratic participant reads across a 519-match selection on 13 fields', function() {
		let reads = 0;
		const matches = Array.from({ length: 519 }, (_, i) => {
			const game = match('m' + i, i, [2 * i, 2 * i + 1]);
			for (const team of game.setup.teams) {
				const id = team.players[0].btp_id;
				Object.defineProperty(team.players[0], 'btp_id', { get: () => { reads++; return id; } });
			}
			return game;
		});
		const data = tournament(matches);
		data.courts = Array.from({ length: 13 }, (_, i) => ({ _id: 'c' + i, is_active: true }));
		const selected = automation.calculate_call_on_court_selection(data, data.courts);
		assert.strictEqual(selected.potential_matches.length, 519);
		for (const candidates of selected.by_court.values()) assert.strictEqual(candidates.length, 519);
		assert(reads < 519 * 2 * 30, 'Participant reads grew beyond a linear selection: ' + reads);
	});
});
