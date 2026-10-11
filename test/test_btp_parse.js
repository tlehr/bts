'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {_it, _describe, assert_snapshot} = require('./tutils.js');

const btp_parse = require('../bts/btp_parse');



_describe('btp_parse', () => {
	_it('reads string stage-entry DNS statuses into the player draw entries', async() => {
		const bm = {
			DrawID: [5],
			EntryID: [100],
			IsMatch: [false],
		};
		const player = {
			ID: [53],
			Firstname: ['Zizhan'],
			Lastname: ['Yu'],
			entries: new Map([[2, '<none>']]),
		};
		const entries = new Map([[100, { Player1ID: [53] }]]);
		const stage_entries = new Map([[900, {
			StageID: [10],
			EntryID: [100],
			Status: ['108'],
		}]]);
		const draws = new Map([[5, {
			ID: [5],
			StageID: [10],
		}]]);
		const players = new Map([[53, player]]);

		btp_parse._calc_match_players(new Map(), entries, stage_entries, draws, players, bm, false);

		assert.deepStrictEqual(bm.bts_winners.map(p => p.ID[0]), [53]);
		assert.strictEqual(player.entries.get(2), '<none>');
		assert.strictEqual(player.entries.get(5), 'DNS');
	});

	_it('propagates the winning team from a finished normal match', async() => {
		const players = new Map([
			[1, { ID: [1], Firstname: ['Anna'], Lastname: ['One'] }],
			[2, { ID: [2], Firstname: ['Berta'], Lastname: ['Two'] }],
			[3, { ID: [3], Firstname: ['Carla'], Lastname: ['Three'] }],
			[4, { ID: [4], Firstname: ['Dina'], Lastname: ['Four'] }],
		]);
		const entries = new Map([
			[101, { Player1ID: [1], Player2ID: [2] }],
			[102, { Player1ID: [3], Player2ID: [4] }],
		]);
		const draws = new Map([[5, { ID: [5], StageID: [10] }]]);
		const stage_entries = new Map();
		const source1 = { DrawID: [5], PlanningID: [2001], EntryID: [101] };
		const source2 = { DrawID: [5], PlanningID: [2002], EntryID: [102] };
		const bm = {
			DrawID: [5],
			PlanningID: [1001],
			From1: [2001],
			From2: [2002],
			IsMatch: [true],
			Winner: [2],
		};
		const matches_by_pid = new Map([
			['5_2001', source1],
			['5_2002', source2],
			['5_1001', bm],
		]);

		btp_parse._calc_match_players(matches_by_pid, entries, stage_entries, draws, players, bm, false);

		assert.deepStrictEqual(bm.bts_players.map(team => team.map(player => player.ID[0])), [[1, 2], [3, 4]]);
		assert.deepStrictEqual(bm.bts_winners.map(player => player.ID[0]), [3, 4]);
	});

	_it('DMO35 2017 finals', async() => {
		const test_file = path.join(__dirname, 'testdata', 'dmo35_finals.json');
		const contents = await fs.promises.readFile(test_file, 'utf-8');

		const response = JSON.parse(contents);
		const bs = btp_parse.get_btp_state(response);

		const matches = bs.matches;
		const get_match = num => matches.filter(m => m.MatchNr && (m.MatchNr[0] === num))[0];

		const heidi_final = get_match(251);
		assert(heidi_final);
		assert(heidi_final.IsMatch && heidi_final.IsMatch[0]);
		// assert.deepStrictEqual(heidi_final.bts_players, 'aaa'); // TODO
		// assert.deepStrictEqual(heidi_final.bts_complete, true); // TODO

		const heidi_sf = get_match(164);
		assert(heidi_sf);
		assert(heidi_sf.IsMatch && heidi_sf.IsMatch[0]);
		const heidi_sf_players = heidi_sf.bts_players;
		assert(heidi_sf_players);
		assert.deepStrictEqual(heidi_sf_players.length, 2);
		assert.deepStrictEqual(heidi_sf_players[0].length, 1);
		assert(heidi_sf_players[0][0]);
		assert.deepStrictEqual(heidi_sf_players[0][0].Firstname[0], 'Heidi');
		assert.deepStrictEqual(heidi_sf_players[0][0].Lastname[0], 'Bender');
		assert.deepStrictEqual(heidi_sf_players[1].length, 1);
		assert(heidi_sf_players[1][0]);
		assert.deepStrictEqual(heidi_sf_players[1][0].Firstname[0], 'Doris');
		assert.deepStrictEqual(heidi_sf_players[1][0].Lastname[0], 'Prior');
		const heidi_sf_winners = heidi_sf.bts_winners;
		assert(heidi_sf_winners);
		assert.deepStrictEqual(heidi_sf_winners.length, 1);
		assert(heidi_sf_winners[0]);
		assert.deepStrictEqual(heidi_sf_winners[0].Firstname[0], 'Heidi');
		assert.deepStrictEqual(heidi_sf_winners[0].Lastname[0], 'Bender');

		const doris_walkover = get_match(66);
		assert(doris_walkover);
		assert(doris_walkover.IsMatch && doris_walkover.IsMatch[0]);
		assert(doris_walkover.Winner && (doris_walkover.Winner[0] === 2));

		const heidi_walkover = get_match(65);
		assert(heidi_walkover);
		assert(heidi_walkover.EntryID && heidi_walkover.EntryID[0]);
		assert(heidi_walkover.IsMatch && heidi_walkover.IsMatch[0]);
		assert(heidi_walkover.Winner && (heidi_walkover.Winner[0] === 1));
		assert(heidi_walkover.bts_complete);
		const heidi_walkover_players = heidi_walkover.bts_players;
		assert(heidi_walkover_players);
		assert.deepStrictEqual(heidi_walkover_players.length, 2);
		assert.deepStrictEqual(heidi_walkover_players[0].length, 1);
		assert(heidi_walkover_players[0][0]);
		assert.deepStrictEqual(heidi_walkover_players[0].length, 1);
		assert.deepStrictEqual(heidi_walkover_players[0][0].Firstname[0], 'Heidi');
		assert.deepStrictEqual(heidi_walkover_players[0][0].Lastname[0], 'Bender');
		assert(heidi_walkover_players[1][0]);
		assert.deepStrictEqual(heidi_walkover_players[1].length, 1);
		assert.deepStrictEqual(heidi_walkover_players[1][0].Firstname[0], 'Bertha');
		assert.deepStrictEqual(heidi_walkover_players[1][0].Lastname[0], 'Plagens');
		const heidi_walkover_winners = heidi_walkover.bts_winners;
		assert(heidi_walkover_winners);
		assert.deepStrictEqual(heidi_walkover_winners.length, 1);
		assert(heidi_walkover_winners[0]);
		assert.deepStrictEqual(heidi_walkover_winners[0].Firstname[0], 'Heidi');
		assert.deepStrictEqual(heidi_walkover_winners[0].Lastname[0], 'Bender');

		const heidi_nomatch = bs._matches_by_pid.get(heidi_walkover.DrawID[0] + '_' + heidi_walkover.From1[0]);
		assert(heidi_nomatch);
		assert(heidi_nomatch.EntryID && heidi_nomatch.EntryID[0]);
		assert(heidi_nomatch.IsMatch && heidi_nomatch.IsMatch[0]);
		assert(heidi_nomatch.Winner && (heidi_nomatch.Winner[0] === 1));
		assert(!heidi_nomatch.bts_complete);
		const heidi_nomatch_players = heidi_nomatch.bts_players;
		assert(heidi_nomatch_players);
		assert.deepStrictEqual(heidi_nomatch_players.length, 2);
		assert.deepStrictEqual(heidi_nomatch_players[0].length, 1);
		assert(heidi_nomatch_players[0][0]);
		assert.deepStrictEqual(heidi_nomatch_players[0].length, 1);
		assert.deepStrictEqual(heidi_nomatch_players[0][0].Firstname[0], 'Heidi');
		assert.deepStrictEqual(heidi_nomatch_players[0][0].Lastname[0], 'Bender');
		assert(heidi_nomatch_players[1] === undefined);
		const heidi_nomatch_winners = heidi_nomatch.bts_winners;
		assert(heidi_nomatch_winners);
		assert.deepStrictEqual(heidi_nomatch_winners.length, 1);
		assert(heidi_nomatch_winners[0]);
		assert.deepStrictEqual(heidi_nomatch_winners[0].Firstname[0], 'Heidi');
		assert.deepStrictEqual(heidi_nomatch_winners[0].Lastname[0], 'Bender');

		const heidi_herself = bs._matches_by_pid.get(heidi_nomatch.DrawID[0] + '_' + heidi_nomatch.From1[0]);
		assert(heidi_herself);
		assert(heidi_herself.EntryID);
		assert(!heidi_herself.IsMatch);
		assert(!heidi_herself.bts_complete);
		// Players are uninteresting, this is not a match
		const heidi_herself_winners = heidi_herself.bts_winners;
		assert(heidi_herself_winners);
		assert.deepStrictEqual(heidi_herself_winners.length, 1);
		assert(heidi_herself_winners[0]);
		assert.deepStrictEqual(heidi_herself_winners[0].Firstname[0], 'Heidi');
		assert.deepStrictEqual(heidi_herself_winners[0].Lastname[0], 'Bender');

		// TODO distinguish walkovers
	});

	_it('incomplete_matches', async() => {
		const test_file = path.join(__dirname, 'testdata', 'incomplete_matches.json');
		const contents = await fs.promises.readFile(test_file, 'utf-8');

		const response = JSON.parse(contents);
		const bs = btp_parse.get_btp_state(response);

		const matches = bs.matches;
		assert.deepStrictEqual(matches, []);
	});
});
