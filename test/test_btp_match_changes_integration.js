'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const sync = require('../bts/btp_sync');
const changes = require('../bts/btp_match_changes');
const btp_manager = require('../bts/btp_manager');
const { inputs, add_excluded_records } = require('./btp_match_changes_fixture');

async function app_for(input) {
	const db = await database.init_test();
	await promisify(db.tournaments.insert.bind(db.tournaments))(input.tournament);
	return { db, wss: { clients: [] }, clock: { now_ms: () => 100000 } };
}

function integrate(app, input) {
	return new Promise((resolve, reject) => sync._integrate_matches(app, 'default', input.state,
		input.scoring_formats, input.location_map, input.court_map,
		(err, result) => err ? reject(err) : resolve(result)));
}

async function fully_integrate(app, input) {
	const original = changes.select;
	changes.select = (...args) => {
		const delta = original(...args);
		delta.matches = input.state.matches;
		delta.cached_dependencies = undefined;
		return delta;
	};
	try { return await integrate(app, input); }
	finally { changes.select = original; }
}

describe('incremental selection in real BTP integrations', function() {
	this.timeout(15000);

	it('integrates a two-match check-in among 519 and matches the full integration after subsequent edits', async function() {
		const input = inputs(519);
		add_excluded_records(input);
		const app = await app_for(input);
		await integrate(app, input);
		await integrate(app, input);
		const idle = await integrate(app, input);
		assert.strictEqual(idle.selection.selected, 0);
		assert.strictEqual(idle.selection.raw_incoming, 1038);
		assert.strictEqual(idle.selection.excluded_from_selection, 519);
		assert.strictEqual(idle.selection.incoming, 519);
		const reference = await app_for(input);
		const snapshot = db => db.model.snapshot('default', ['matches']).then(state => state.matches);
		await promisify(reference.db.matches.insert.bind(reference.db.matches))(await snapshot(app.db));
		await fully_integrate(reference, input);
		const compare = async () => assert.deepStrictEqual(await snapshot(app.db), await snapshot(reference.db));
		await compare();

		input.state.players.get(1).CheckedIn = [true];
		const checkin = await integrate(app, input);
		assert.strictEqual(checkin.selection.selected, 2);
		assert.strictEqual(checkin.selection.dependency_cache_hit, true);
		assert.strictEqual(checkin.selection.skipped_by_delta, 517);
		await fully_integrate(reference, input);
		await compare();
		assert.strictEqual((await app.db.matches.findOne_async({ btp_id: 'default_Singles_1' }))
			.setup.teams[0].players[0].checked_in, true);

		// Ordinary live score traffic must survive the next remote metadata edit.
		const point = { $set: { 'setup.now_on_court': true, 'setup.state': 'oncourt',
			network_score: [[7, 6]], presses: [{ type: 'score', team: 0 }], duration_ms: 12000 } };
		for (const target of [app, reference]) await target.db.matches.update_async({ btp_id: 'default_Singles_3' }, point, {});
		input.state.players.get(1).Lastname = ['Renamed'];
		await integrate(app, input);
		await fully_integrate(reference, input);
		await compare();
		assert.deepStrictEqual((await app.db.matches.findOne_async({ btp_id: 'default_Singles_3' })).network_score, [[7, 6]]);

		// Club names live outside player objects, and must still reach stored DTOs.
		input.state.clubs.get(1).Name = ['Updated club'];
		await integrate(app, input);
		await fully_integrate(reference, input);
		await compare();
		assert.strictEqual((await app.db.matches.findOne_async({ btp_id: 'default_Singles_1' }))
			.setup.teams[0].players[0].club, 'Updated club');

		for (const target of [app, reference]) await target.db.matches.remove_async({ btp_id: 'default_Singles_4' }, {});
		await integrate(app, input);
		await fully_integrate(reference, input);
		await compare();
		assert.strictEqual((await snapshot(app.db)).length, 519);
	});

	it('retries the same response after a failed selected write', async function() {
		const input = inputs();
		const app = await app_for(input);
		await integrate(app, input);
		await integrate(app, input);
		input.state.players.get(1).CheckedIn = [true];
		const update = app.db.matches.update;
		app.db.matches.update = (query, patch, options, cb) => cb(new Error('selected write failed'));
		try { await assert.rejects(integrate(app, input), /selected write failed/); }
		finally { app.db.matches.update = update; }
		await integrate(app, input);
		const match = await app.db.matches.findOne_async({ btp_id: 'default_Singles_1' });
		assert.strictEqual(match.setup.teams[0].players[0].checked_in, true);
	});

	it('forwards excluded raw bye branches on cached passes until acknowledgement and rechecks changed branches', async function() {
		for (const reverse of [false, true]) {
			const input = inputs(1);
			const visible = input.state.matches[0];
			visible.From2 = [700];
			visible.bts_players[1] = [];
			visible.bts_complete = false;
			const hidden = { ID: [999], DrawID: [10], PlanningID: [700], From1: [901],
				From2: [902], WinnerTo: visible.PlanningID, bts_players: [[], []],
				IsMatch: [reverse], ...(reverse ? { ReverseHomeAway: [true] } : {}) };
			input.state.planning_nodes.set('10_700', hidden);
			input.state.matches.push(hidden);
			const app = await app_for(input);
			const original = btp_manager.update_score;
			const pushed = [];
			btp_manager.update_score = (_app, match) => {
				assert.strictEqual(match.btp_winner_only_update, true);
				assert.strictEqual(match.network_score, undefined);
				pushed.push(match.btp_match_ids[0].id);
			};
			try {
				await integrate(app, input);
				await integrate(app, input);
				const cached = await integrate(app, input);
				assert.strictEqual(cached.selection.selected, 0);
				assert.strictEqual(cached.selection.dependency_cache_hit, true);
				assert.strictEqual(cached.selection.excluded_from_selection, 1);
				assert.strictEqual(cached.selection.incoming, 1);
				await integrate(app, input);
				assert.deepStrictEqual(pushed, [999, 999, 999, 999]);
				assert.strictEqual((await app.db.matches.find_async({})).length, 1);
				// A previously empty source that can now produce a player must stop
				// automatic bye forwarding, even though it is excluded from selection.
				hidden.bts_players[0] = [{ ID: [777] }];
				assert.strictEqual((await integrate(app, input)).selection.dependency_cache_hit, false);
				assert.deepStrictEqual(pushed, [999, 999, 999, 999]);
				hidden.bts_players[0] = [];
				await integrate(app, input);
				assert.deepStrictEqual(pushed, [999, 999, 999, 999, 999]);
				hidden.Winner = [1];
				const acknowledged = await integrate(app, input);
				assert.strictEqual(acknowledged.selection.dependency_cache_hit, false);
				assert.deepStrictEqual(pushed, [999, 999, 999, 999, 999]);
			} finally { btp_manager.update_score = original; }
		}
	});

	it('rechecks a result draw without rewriting unrelated match signatures or locking them through writes', async function() {
		const input = inputs();
		const app = await app_for(input);
		await integrate(app, input);
		await integrate(app, input);
		const unchanged = await app.db.matches.findOne_async({ btp_id: 'default_Singles_3' });
		const written = [];
		const original = app.db.matches.update;
		app.db.matches.update = (query, ...args) => { written.push(query._id); return original.apply(app.db.matches, [query, ...args]); };
		input.state.matches[0].Winner = [1];
		try {
			assert.strictEqual((await integrate(app, input)).selection.selected, 3);
		} finally { app.db.matches.update = original; }
		const actual = await app.db.matches.findOne_async({ _id: unchanged._id });
		assert.deepStrictEqual(actual, unchanged);
		assert.deepStrictEqual(written, ['btp_default_Singles_1']);
	});

	it('updates incomplete-match dependency labels when a direct BTP link changes', async function() {
		const input = inputs(1);
		input.state.matches[0].bts_players[0] = [];
		input.state.matches[0].bts_complete = false;
		const link = { DrawID: [10], PlanningID: [1], Link: ['First label'] };
		input.state.links.push(link);
		const app = await app_for(input);
		await integrate(app, input);
		await integrate(app, input);
		let match = await app.db.matches.findOne_async({ btp_id: 'default_Singles_1' });
		assert.strictEqual(match.setup.links.from1_link, 'First label');
		link.Link = ['Changed label'];
		await integrate(app, input);
		match = await app.db.matches.findOne_async({ btp_id: 'default_Singles_1' });
		assert.strictEqual(match.setup.links.from1_link, 'Changed label');
	});
});
