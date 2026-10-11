'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const match_utils = require('../bts/match_utils.js');

function make_collection(rows) {
	return {
		rows,
		find(query, callback) {
			const result = rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value));
			callback(null, result);
		},
		update(query, update, _options, callback) {
			const row = rows.find((candidate) => Object.entries(query).every(([key, value]) => candidate[key] === value));
			if (!row) {
				callback(null, 0, null);
				return;
			}
			Object.assign(row, update.$set || {});
			callback(null, 1, row);
		},
	};
}

function make_match() {
	return {
		_id: 'm1',
		setup: {
			now_on_court: true,
			state: 'running',
			teams: [
				{
					players: [
						{ btp_id: 11, name: 'Player 11', checked_in: true, tablet_break_active: true },
						{ btp_id: 12, name: 'Player 12', checked_in: true, tablet_break_active: true },
					],
				},
				{
					players: [
						{ btp_id: 21, name: 'Player 21', checked_in: true, tablet_break_active: true },
						{ btp_id: 22, name: 'Player 22', checked_in: true, tablet_break_active: true },
					],
				},
			],
		},
	};
}

_describe('match utils player state helpers', () => {
	_it('ignores incomplete on-court setup without crashing', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'default_5',
			teams: [{ players: [] }],
		});

		assert.strictEqual(result, null);
		assert.strictEqual(match.setup.state, 'running');
	});

	_it('sets player on court by BTP id instead of fixed player position', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'default_5',
			teams: [
				{ players: [{ btp_id: 12 }] },
				{ players: [{ btp_id: 22 }] },
			],
		});

		assert.strictEqual(result, match);
		assert.strictEqual(match.setup.state, 'blocked');
		assert.strictEqual(match.setup.teams[0].players[0].now_playing_on_court, undefined);
		assert.strictEqual(match.setup.teams[0].players[1].now_playing_on_court, 'default_5');
		assert.strictEqual(match.setup.teams[1].players[0].now_playing_on_court, undefined);
		assert.strictEqual(match.setup.teams[1].players[1].now_playing_on_court, 'default_5');
		assert.strictEqual(match.setup.teams[0].players[1].tablet_break_active, false);
		assert.strictEqual(match.setup.teams[1].players[1].tablet_break_active, false);
	});

	_it('does not block the match that is currently being called on court', async () => {
		const match = make_match();
		match.setup.state = 'oncourt';

		const result = await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'default_5',
			teams: [
				{ players: [{ btp_id: 11 }, { btp_id: 12 }] },
				{ players: [{ btp_id: 21 }, { btp_id: 22 }] },
			],
		}, match._id);

		assert.strictEqual(result, null);
		assert.strictEqual(match.setup.state, 'oncourt');
		assert.strictEqual(match.setup.teams[0].players[0].now_playing_on_court, undefined);
		assert.strictEqual(match.setup.teams[1].players[0].now_playing_on_court, undefined);
	});

	_it('releases a blocked future match after all on-court player flags are gone', () => {
		const match = make_match();
		match.setup.now_on_court = false;
		match.setup.state = 'blocked';
		match.setup.teams[0].players[0].now_playing_on_court = false;
		match.setup.teams[1].players[0].now_playing_on_court = false;

		const changed = match_utils._release_blocked_match_if_no_players_on_court(match.setup);

		assert.strictEqual(changed, true);
		assert.strictEqual(match.setup.state, 'scheduled');
	});

	_it('keeps a blocked match blocked while a player is still marked on court', () => {
		const match = make_match();
		match.setup.now_on_court = false;
		match.setup.state = 'blocked';
		match.setup.teams[0].players[0].now_playing_on_court = 'default_5';

		const changed = match_utils._release_blocked_match_if_no_players_on_court(match.setup);

		assert.strictEqual(changed, false);
		assert.strictEqual(match.setup.state, 'blocked');
	});

	_it('keeps the active on-court match blocked during play', () => {
		const match = make_match();
		match.setup.now_on_court = true;
		match.setup.state = 'blocked';

		const changed = match_utils._release_blocked_match_if_no_players_on_court(match.setup);

		assert.strictEqual(changed, false);
		assert.strictEqual(match.setup.state, 'blocked');
	});

	_it('ignores incomplete tablet-operator setup without crashing', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_tablet(match, {
			court_id: 'default_5',
			tabletoperators: null,
		});

		assert.strictEqual(result, null);
		assert.strictEqual(match.setup.teams[0].players[0].checked_in, true);
	});

	_it('sets tablet operator by BTP id instead of fixed player position', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_tablet(match, {
			court_id: 'default_6',
			tabletoperators: [{ btp_id: 21 }],
		});

		assert.strictEqual(result, match);
		assert.strictEqual(match.setup.teams[0].players[0].now_tablet_on_court, undefined);
		assert.strictEqual(match.setup.teams[1].players[0].now_tablet_on_court, 'default_6');
		assert.strictEqual(match.setup.teams[1].players[0].checked_in, false);
	});

	_it('does not rewrite unchanged on-court and tablet player flags', async () => {
		const match = make_match();
		match.setup.state = 'blocked';
		const player = match.setup.teams[0].players[0];
		player.now_playing_on_court = 'court-1';
		player.tablet_break_active = false;
		player.now_tablet_on_court = 'court-2';
		player.checked_in = false;
		assert.strictEqual(await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'court-1', teams: [{ players: [{ btp_id: 11 }] }],
		}), null);
		assert.strictEqual(await match_utils.calc_match_set_player_on_tablet(match, {
			court_id: 'court-2', tabletoperators: [{ btp_id: 11 }],
		}), null);
		match.setup.state = 'scheduled';
		assert.strictEqual(await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'court-1', teams: [{ players: [{ btp_id: 11 }] }],
		}), match);
		assert.strictEqual(match.setup.state, 'blocked');
	});

	_it('merges assignments from multiple courts in one scan and one write per affected match', async () => {
		const target = { ...make_match(), tournament_key: 'default' };
		const sources = [
			{ _id: 'source-1', setup: { court_id: 'court-1', teams: [{ players: [{ btp_id: 11 }] }] } },
			{ _id: 'source-2', setup: { court_id: 'court-2', tabletoperators: [{ btp_id: 21 }] } },
		];
		let reads = 0;
		let writes = 0;
		const collection = make_collection([target]);
		const find = collection.find;
		collection.find = (query, callback) => {
			reads++;
			find(query, (err, rows) => callback(err, JSON.parse(JSON.stringify(rows))));
		};
		const update = collection.update;
		collection.update = (...args) => { writes++; update(...args); };
		const app = { db: { matches: collection } };
		const run = () => new Promise((resolve, reject) => {
			match_utils.set_players_on_courts(app, 'default', sources, err => err ? reject(err) : resolve());
		});
		await run();
		assert.strictEqual(reads, 1);
		assert.strictEqual(writes, 1);
		assert.strictEqual(target.setup.teams[0].players[0].now_playing_on_court, 'court-1');
		assert.strictEqual(target.setup.teams[1].players[0].now_tablet_on_court, 'court-2');
		assert.strictEqual(target.setup.teams[1].players[0].checked_in, false);
		await run();
		assert.strictEqual(writes, 1);
	});

	for (const role of ['court', 'tablet']) {
		_it('waits for the ' + role + ' player-state write before completing', async () => {
			const target = { ...make_match(), tournament_key: 'default' };
			const collection = make_collection([target]);
			const update = collection.update;
			let finish_write;
			collection.update = (...args) => { finish_write = () => update(...args); };
			let completed = false;
			const operation = new Promise((resolve, reject) => {
				const callback = err => { completed = true; err ? reject(err) : resolve(); };
				const setup = { court_id: 'court-1', teams: [{ players: [{ btp_id: 11 }] }], tabletoperators: [{ btp_id: 11 }] };
				const app = { db: { matches: collection } };
				if (role === 'court') match_utils.set_player_on_court(app, 'default', setup, callback);
				else match_utils.set_player_on_tablet(app, 'default', setup, callback);
			});
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(completed, false);
			assert.strictEqual(typeof finish_write, 'function');
			finish_write();
			await operation;
			assert.strictEqual(completed, true);
		});
	}

	_it('waits for all outstanding writes when one player-state write fails', async () => {
		const matches = [make_match(), { ...make_match(), _id: 'm2' }];
		const callbacks = [];
		let completed = false;
		let callback_count = 0;
		const expected = new Error('write failed');
		const operation = new Promise(resolve => {
			match_utils.set_players_on_courts({ db: { matches: {
				find(_query, callback) { callback(null, matches); },
				update(_query, _update, _options, callback) { callbacks.push(callback); },
			} } }, 'default', [{
				_id: 'source', setup: { court_id: 'court-1', teams: [{ players: [{ btp_id: 11 }] }] },
			}], err => { completed = true; callback_count++; resolve(err); });
		});
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(callbacks.length, 2);
		callbacks[0](expected);
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(completed, false);
		callbacks[1](null);
		assert.strictEqual(await operation, expected);
		assert.strictEqual(callback_count, 1);
	});

	_it('closes the active tablet-operator assignment for a finished court', async () => {
		const app = {
			db: {
				tabletoperators: make_collection([
					{ _id: 'active', tournament_key: 'default', court: 'default_2', end_ts: null },
					{ _id: 'waiting', tournament_key: 'default', court: null, end_ts: null },
					{ _id: 'other', tournament_key: 'default', court: 'default_3', end_ts: null },
				]),
			},
		};

		await new Promise((resolve, reject) => {
			match_utils._close_tabletoperator_assignment_on_court(app, 'default', 'default_2', 12345, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		assert.strictEqual(app.db.tabletoperators.rows[0].court, -1);
		assert.strictEqual(app.db.tabletoperators.rows[0].end_ts, 12345);
		assert.strictEqual(app.db.tabletoperators.rows[1].court, null);
		assert.strictEqual(app.db.tabletoperators.rows[2].court, 'default_3');
	});
});
