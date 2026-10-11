'use strict';

const assert = require('assert');
const { promisify } = require('util');
const match_utils = require('../bts/match_utils');
const { fixture, insert, match } = require('./tournament_model_fixture');

async function cleanup_fixture() {
	const { db, tournament } = await fixture();
	await db.tournaments.update_async({ key: 'test' }, { $set: {
		tabletoperator_set_break_after_tabletservice: true, tabletoperator_break_seconds: 30,
		technical_official_break_after_assignment_seconds: 20, btp_settings: { check_in_per_match: true, pause_duration_ms: 10000 },
	} }, {});
	await insert(db.umpires, [
		{ _id: 'u', tournament_key: 'test', name: 'Current umpire', is_umpire: true, is_service_judge: true,
			umpire_on_court: 'court', status: 'oncourt', checked_in: true },
		{ _id: 'v', tournament_key: 'test', name: 'Current service judge', is_service_judge: true,
			service_judge_on_court: 'court', status: 'oncourt', checked_in: true },
	]);
	await db.matches.update_async({ _id: 'one' }, { $set: {
		team1_won: true, btp_winner: 1, btp_id: 1,
		setup: { state: 'finished', court_id: 'court', now_on_court: false,
			teams: [{ players: [1, 2].map(btp_id => ({ btp_id, checked_in: true, now_playing_on_court: 'court' })) }],
			tabletoperators: [{ btp_id: 3, checked_in: true, now_tablet_on_court: 'court' }],
			umpire: { _id: 'u', name: 'Old name', is_umpire: false }, service_judge: { _id: 'v', name: 'Old judge' },
		},
	} }, {});
	await db.matches.update_async({ _id: 'two' }, { $set: {
		'setup.state': 'blocked',
		'setup.teams.0.players': [{ btp_id: 1, checked_in: true, now_playing_on_court: 'court' },
			{ btp_id: 2, checked_in: true, now_playing_on_court: 'other-court' },
			{ btp_id: 3, checked_in: true, now_tablet_on_court: 'court' }],
	} }, {});
	await insert(db.tabletoperators, [
		{ _id: 'assigned', tournament_key: 'test', match_id: 'previous', court: 'court' },
		{ _id: 'elsewhere', tournament_key: 'test', match_id: 'previous-other', court: 'other-court' },
	]);
	const app = { db, wss: { clients: [] }, _btp_sync_effects: [] };
	return { db, tournament, app };
}

describe('targeted match finish cleanup', function() {
	it('cleans every participant without scanning 519 matches and preserves other court flags and planned assignments', async function() {
		const { db, tournament, app } = await cleanup_fixture();
		const upcoming = match('upcoming', [3]);
		upcoming.setup.state = 'preparation';
		upcoming.setup.umpire = { _id: 'u' };
		upcoming.setup.service_judge = { _id: 'v' };
		upcoming.setup.teams[0].players[0].now_tablet_on_court = 'other-court';
		upcoming.setup.teams[0].players[0].checked_in = true;
		const free_blocked = match('free-blocked', [99]);
		free_blocked.setup.state = 'blocked';
		await insert(db.matches, [upcoming, free_blocked, ...Array.from({ length: 515 }, (_, i) => match(`unrelated-${i}`, [100 + i]))]);
		const unrelated_before = tournament.matches.get('unrelated-0').data;
		const writes = [];
		const update = db.matches.update.bind(db.matches);
		db.matches.update = (query, values, options, callback) => { writes.push({ query, values }); update(query, values, options, callback); };
		db.matches.find = db.matches.findOne = () => { throw new Error('Full match read during cleanup'); };
		tournament.matches.values = () => { throw new Error('All-match object scan during cleanup'); };
		const phases = [];
		await match_utils.reset_player_tabletoperator(app, 'test', 'one', 50000, { score_phase: name => phases.push(name) });
		const player = (id, position) => tournament.matches.get(id).data.setup.teams[0].players[position];
		assert.strictEqual(player('one', 0).checked_in, false);
		assert.strictEqual(player('one', 0).last_time_on_court_ts, 50000);
		assert.strictEqual(player('two', 0).now_playing_on_court, false);
		assert.strictEqual(player('two', 1).now_playing_on_court, 'other-court');
		assert.strictEqual(player('two', 1).checked_in, true);
		assert.strictEqual(tournament.matches.get('two').data.setup.state, 'blocked');
		assert.strictEqual(player('two', 2).tablet_break_until_ts, 80000);
		assert.strictEqual(player('upcoming', 0).now_tablet_on_court, 'other-court');
		assert.strictEqual(player('upcoming', 0).checked_in, true);
		assert.strictEqual(tournament.matches.get('free-blocked').data.setup.state, 'scheduled');
		assert.strictEqual(tournament.matches.get('unrelated-0').data, unrelated_before);
		assert.deepStrictEqual([...new Set(writes.map(write => write.query._id))].sort(), ['free-blocked', 'one', 'two']);
		assert(writes.every(write => !Object.hasOwn(write.values.$set, 'setup')));
		assert.strictEqual(tournament.umpires.get('u').data.name, 'Current umpire');
		assert.strictEqual(tournament.umpires.get('u').data.is_planed_as_umpire, true);
		assert.strictEqual(tournament.umpires.get('u').data.service_judge_pause, 70000);
		assert.strictEqual(tournament.umpires.get('v').data.service_judge_pause, 70100);
		assert.strictEqual(tournament.umpires.get('v').data.is_planed_as_service_judge, true);
		assert.strictEqual(tournament.tabletoperators.get('assigned').data.court, -1);
		assert.strictEqual(tournament.tabletoperators.get('elsewhere').data.court, 'other-court');
		assert.deepStrictEqual(phases, ['context', 'players', 'tablets', 'officials', 'tablet_waitlist', 'btp_courts'].map(name => `finish_cleanup_${name}`));
	});

	it('builds the split tablet waitlist from the cleaned losing team and applies the service break', async function() {
		const { db, tournament, app } = await cleanup_fixture();
		await db.tournaments.update_async({ key: 'test' }, { $set: { tabletoperator_enabled: true, tabletoperator_split_doubles: true } }, {});
		await db.matches.update_async({ _id: 'one' }, { $set: {
			'setup.teams.1': { players: [4, 5].map(btp_id => ({ btp_id, checked_in: true, now_playing_on_court: 'court' })) },
		} }, {});
		db.matches.find = db.matches.findOne = () => { throw new Error('Full match read during waitlist creation'); };
		db.tournaments.findOne = () => { throw new Error('Repeated tournament read during cleanup'); };
		await match_utils.reset_player_tabletoperator(app, 'test', 'one', 50000);
		const waiting = [...tournament.tabletoperators.values()].filter(entry => entry.data.match_id === 'one').map(entry => entry.data);
		assert.strictEqual(waiting.length, 2);
		assert.deepStrictEqual(waiting.map(entry => entry.tabletoperator[0].btp_id).sort(), [4, 5]);
		assert(waiting.every(entry => entry.start_ts === 80000 && entry.court === null));
		assert(waiting.every(entry => entry.tabletoperator[0].checked_in === false && entry.tabletoperator[0].last_time_on_court_ts === 50000));
	});

	it('does not write unchanged participant flags when cleanup is repeated', async function() {
		const { db, app } = await cleanup_fixture();
		await promisify(match_utils.remove_player_on_court)(app, 'test', 'one', 50000);
		await promisify(match_utils.remove_tablet_on_court)(app, 'test', 'one', 50000);
		db.matches.update = () => { throw new Error('Wrote unchanged flags'); };
		await promisify(match_utils.remove_player_on_court)(app, 'test', 'one', 50000);
		await promisify(match_utils.remove_tablet_on_court)(app, 'test', 'one', 50000);
	});

	it('reads cleanup projections in datastore order without copying point histories or tournament events', async function() {
		const { db, tournament } = await fixture();
		const pending = db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.checked_in': true } }, {});
		const read = promisify(db.model.read_cleanup_match);
		const selected = read('test', 'one');
		await pending;
		assert.strictEqual((await selected).setup.teams[0].players[0].checked_in, true);
		Object.defineProperty(tournament.matches.get('one').data, 'presses', { get() { throw new Error('Copied point history'); } });
		Object.defineProperty(tournament.record.data, 'events', { enumerable: true, get() { throw new Error('Copied events'); } });
		const copy = await read('test', 'one');
		copy.setup.teams[0].players[0].checked_in = false;
		assert.strictEqual(tournament.matches.get('one').data.setup.teams[0].players[0].checked_in, true);
		assert.strictEqual((await promisify(db.model.read_cleanup_tournament)('test')).key, 'test');
	});

	it('preserves a subsequent active official assignment and writes a dual-role official only once', async function() {
		const { db, tournament, app } = await cleanup_fixture();
		await db.matches.update_async({ _id: 'one' }, { $set: { 'setup.service_judge': { _id: 'u' } } }, {});
		const active = match('active', [99], 'test', 'other-court');
		active.setup.now_on_court = true;
		active.setup.state = 'oncourt';
		active.setup.service_judge = { _id: 'u' };
		await insert(db.matches, active);
		await db.umpires.update_async({ _id: 'u' }, { $set: { service_judge_on_court: 'other-court', court_id: 'other-court' } }, {});
		const update = db.umpires.update.bind(db.umpires);
		let count = 0;
		db.umpires.update = (...args) => { count++; update(...args); };
		await promisify(match_utils.remove_umpire_on_court)(app, 'test', 'one', 50000);
		const official = tournament.umpires.get('u').data;
		assert.strictEqual(count, 1);
		assert.strictEqual(official.umpire_on_court, null);
		assert.strictEqual(official.service_judge_on_court, 'other-court');
		assert.strictEqual(official.court_id, 'other-court');
		assert.strictEqual(official.status, 'oncourt');
		assert.strictEqual(official.checked_in, true);
	});

	it('awaits all official writes before reporting a write failure', async function() {
		const { db, app } = await cleanup_fixture();
		const failure = new Error('Official write failed');
		let complete_second;
		let entered_second;
		const entered = new Promise(resolve => { entered_second = resolve; });
		db.umpires.update = (query, _values, _options, callback) => {
			if (query._id === 'u') callback(failure);
			else {
				complete_second = () => callback(null, 0, null);
				entered_second();
			}
		};
		let settled = false;
		const cleanup = promisify(match_utils.remove_umpire_on_court)(app, 'test', 'one', 50000);
		const completed = cleanup.then(() => { settled = true; return null; }, error => { settled = true; return error; });
		await Promise.race([entered, completed.then(() => { throw new Error('Cleanup completed before all writes started'); })]);
		assert.strictEqual(settled, false);
		complete_second();
		assert.strictEqual(await completed, failure);
	});

	it('does not recreate an official deleted since the match was assigned', async function() {
		const { db, app } = await cleanup_fixture();
		await db.umpires.remove_async({ tournament_key: 'test' }, { multi: true });
		db.umpires.update = () => { throw new Error('Recreated deleted official'); };
		await promisify(match_utils.remove_umpire_on_court)(app, 'test', 'one', 50000);
	});

	it('does not replace parallel point state with the setup read for cleanup', async function() {
		const { db, tournament, app } = await cleanup_fixture();
		const update = db.matches.update.bind(db.matches);
		db.matches.update = (query, values, options, callback) => {
			if (query._id !== 'two') return update(query, values, options, callback);
			update({ _id: 'two' }, { $set: { network_score: [[15, 16]], 'setup.needs_preparation_successor': true } }, {}, err => {
				if (err) return callback(err);
				update(query, values, options, callback);
			});
		};
		await promisify(match_utils.remove_player_on_court)(app, 'test', 'one', 50000);
		assert.deepStrictEqual(tournament.matches.get('two').data.network_score, [[15, 16]]);
		assert.strictEqual(tournament.matches.get('two').data.setup.needs_preparation_successor, true);
	});
});
