'use strict';

const assert = require('assert');

const {_describe, _it} = require('./tutils.js');

const btp_sync = require('../bts/btp_sync');
const database = require('../bts/database');
const btp_manager = require('../bts/btp_manager');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
		});
	});
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function singleMatchBtpState(overrides = {}) {
	return {
		matches: [{
			ID: [1],
			DrawID: [10],
			PlanningID: [100],
			From1: [1],
			From2: [2],
			IsMatch: [true],
			MatchNr: [1],
			Highlight: [0],
			Status: 0,
			bts_complete: true,
			bts_players: [[{ ID: [1] }], [{ ID: [2] }]],
			...overrides,
		}],
		draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MX U17'], Position: [1] }]]),
		events: new Map([[20, { ID: [20], Name: ['MX U17'], GameTypeID: [2] }]]),
		stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
		links: [],
		planning_nodes: new Map(),
		courts: new Map(),
		clubs: new Map(),
		districts: new Map(),
	};
}

_describe('btp_sync', () => {
	_it('preserves an unconfirmed final score and avoids a repeated BTP court call while automation is paused', async () => {
		const db = await database.init_test();
		const app = { db, wss: { clients: [] }, _btp_sync_effects: [], clock: { now_ms: () => 1000000 } };
		await insert(db, 'tournaments', {
			key: 'default', btp_enabled: false, automation_enabled: false, btp_settings: {}, official_rotation_mode: 'disabled',
		});
		await insert(db, 'courts', {
			_id: 'court-13', tournament_key: 'default', num: 13, btp_id: 21, is_active: true, match_id: null,
		});
		const state = singleMatchBtpState({ CourtID: [21] });
		state.courts.set(21, { ID: [21], MatchID: [1] });
		const sync = () => new Promise((resolve, reject) => btp_sync._integrate_matches(
			app, 'default', state, new Map(), new Map(), new Map([[21, 'court-13']]), err => err ? reject(err) : resolve()));
		const admin = require('../bts/admin');
		const original_notify = admin.notify_change;
		const original_highlight = btp_manager.update_highlight;
		const notifications = [];
		admin.notify_change = (_app, _key, type) => notifications.push(type);
		btp_manager.update_highlight = () => {};
		try {
			await sync();
			const id = 'btp_default_MX U17_1';
			const score = [[21, 14], [15, 21], [21, 19]];
			const presses = [{ type: 'score', side: 'left', timestamp: 999000 }];
			await db.matches.update_async({ _id: id }, { $set: {
				network_score: score, presses, end_ts: 999000, btp_needsync: false,
				'setup.state': 'oncourt', 'setup.now_on_court': true, 'setup.called_timestamp': 1000,
			} }, {});
			const pending = await db.matches.findOne_async({ _id: id });
			assert.strictEqual(pending.btp_winner, undefined);
			assert.strictEqual(pending.team1_won, undefined);
			assert.strictEqual(btp_sync._btp_match_clears_local_normal_result(pending, state.matches[0]), false);
			await sync();
			await sync();
			notifications.length = 0;
			await new Promise((resolve, reject) => btp_sync._integrate_now_on_court(
				app, 'default', err => err ? reject(err) : resolve()));
			const current = await db.matches.findOne_async({ _id: id });
			assert.deepStrictEqual(current.network_score, score);
			assert.deepStrictEqual(current.presses, presses);
			assert.strictEqual(current.end_ts, 999000);
			assert.strictEqual(current.btp_winner, undefined);
			assert.strictEqual(current.team1_won, undefined);
			assert.strictEqual(current.setup.now_on_court, true);
			assert.strictEqual(current.setup.state, 'oncourt');
			assert.strictEqual(current.setup.called_timestamp, 1000);
			assert.strictEqual((await db.tournaments.findOne_async({ key: 'default' })).automation_enabled, false);
			assert(!notifications.includes('match_called_on_court'));
		} finally {
			admin.notify_change = original_notify;
			btp_manager.update_highlight = original_highlight;
		}
	});

	_it('retains the tablet finish identity through BTP result corrections and clears it for a genuine result reset', async () => {
		const db = await database.init_test();
		const app = { db, wss: { clients: [] }, _btp_sync_effects: [] };
		await insert(db, 'tournaments', { key: 'default', btp_settings: {}, tabletoperator_enabled: true });
		const state = singleMatchBtpState();
		const sync = () => new Promise((resolve, reject) => btp_sync._integrate_matches(
			app, 'default', state, new Map(), new Map(), new Map(), err => err ? reject(err) : resolve()));
		await sync();
		const id = 'btp_default_MX U17_1';
		await db.matches.update_async({ _id: id }, { $set: {
			team1_won: false, btp_winner: 2, end_ts: 50000, tabletoperator_finish_ts: 50000,
			network_score: [[19, 21], [15, 21]], 'setup.state': 'finished', 'setup.now_on_court': false,
		} }, {});
		Object.assign(state.matches[0], { Winner: [2], Sets: [{ Set: [
			{ T1: [19], T2: [21] }, { T1: [15], T2: [21] },
		] }] });
		await sync();
		assert.strictEqual((await db.matches.findOne_async({ _id: id })).tabletoperator_finish_ts, 50000);
		await db.matches.update_async({ _id: id }, { $set: { end_ts: 51217 } }, {});
		state.matches[0].DisplayOrder = [7];
		await sync();
		let current = await db.matches.findOne_async({ _id: id });
		assert.strictEqual(current.end_ts, 51217);
		assert.strictEqual(current.tabletoperator_finish_ts, 50000);
		delete state.matches[0].Winner;
		delete state.matches[0].Sets;
		await sync();
		current = await db.matches.findOne_async({ _id: id });
		assert.strictEqual(current.end_ts, undefined);
		assert.strictEqual(current.tabletoperator_finish_ts, undefined);
		assert.deepStrictEqual(await db.tabletoperators.find_async({ tournament_key: 'default' }), []);
		// The next actual result must create a new duty from the newly stored loser.
		Object.assign(state.matches[0], { Winner: [2], Sets: [{ Set: [{ T1: [19], T2: [21] }] }] });
		app.clock = { now_ms: () => 60000 };
		await sync();
		current = await db.matches.findOne_async({ _id: id });
		assert.strictEqual(current.tabletoperator_finish_ts, 60000);
		const entries = await db.tabletoperators.find_async({ tournament_key: 'default', match_id: id });
		assert.strictEqual(entries.length, 1);
		assert.deepStrictEqual(entries[0].tabletoperator.map(player => player.btp_id), [1]);
		assert.strictEqual(entries[0].source_match_end_ts, 60000);
		await sync();
		assert.strictEqual((await db.tabletoperators.find_async({ tournament_key: 'default', match_id: id })).length, 1);
	});

	_it('keeps a no-match result without a winner finished through import and later syncs', async () => {
		const db = await database.init_test();
		const app = { db, wss: { clients: [] } };
		await insert(db, 'tournaments', { key: 'default', btp_settings: {} });
		const state = singleMatchBtpState({ ScoreStatus: [4] });
		const sync = () => new Promise((resolve, reject) => btp_sync._integrate_matches(
			app, 'default', state, new Map(), new Map(), new Map(), err => err ? reject(err) : resolve()));
		await sync();
		const id = 'btp_default_MX U17_1';
		const check = async () => {
			const match = await db.matches.findOne_async({ _id: id });
			assert.strictEqual(match.score_status, 'no_match');
			assert.strictEqual(match.setup.state, 'finished');
			assert.strictEqual(match.setup.now_on_court, false);
			assert.strictEqual(match.team1_won, undefined);
			assert.strictEqual(match.btp_winner, undefined);
			assert.strictEqual(match.network_score, undefined);
		};
		await check();
		// Reproduce an older stored record, retaining its identical BTP signature.
		await db.matches.update_async({ _id: id }, { $set: { 'setup.state': 'scheduled' } }, {});
		await sync();
		await check();
		await sync();
		await check();
		delete state.matches[0].ScoreStatus;
		await sync();
		const cleared = await db.matches.findOne_async({ _id: id });
		assert.strictEqual(cleared.score_status, 'normal');
		assert.notStrictEqual(cleared.setup.state, 'finished');
	});

	_it('accepts a no-winner no-match result while a local match is prepared or on court', async () => {
		for (const previous_state of ['preparation', 'oncourt', 'blocked']) {
			const db = await database.init_test();
			const app = { db, wss: { clients: [] } };
			await insert(db, 'tournaments', { key: 'default', btp_settings: {} });
			await insert(db, 'matches', {
				_id: 'btp_default_MX U17_1', tournament_key: 'default', btp_id: 'default_MX U17_1',
				btp_match_ids: [{ id: 1, draw: 10, planning: 100 }], score_status: 'normal',
				setup: { is_match: true, state: previous_state, now_on_court: previous_state !== 'preparation',
					called_timestamp: 1000, preparation_call_timestamp: 500,
					teams: [{ players: [{ btp_id: 1 }] }, { players: [{ btp_id: 2 }] }] },
			});
			await new Promise((resolve, reject) => btp_sync._integrate_matches(
				app, 'default', singleMatchBtpState({ ScoreStatus: [4] }), new Map(), new Map(), new Map(),
				err => err ? reject(err) : resolve()));
			const match = await db.matches.findOne_async({ _id: 'btp_default_MX U17_1' });
			assert.strictEqual(match.setup.state, 'finished', previous_state);
			assert.strictEqual(match.setup.now_on_court, false, previous_state);
			assert.strictEqual(match.team1_won, undefined);
			assert.strictEqual(match.btp_winner, undefined);
		}
	});

	_it('normalizes standard scoring formats from BTP fields', () => {
		const normalized = btp_sync._normalize_scoring_format({
			ID: ['10'],
			Name: ['Best of 3 to 21'],
			NumSets: ['3'],
			SetType: ['0'],
			LastSetType: ['0'],
			Score: ['21'],
			IsDefault: [true],
		});

		assert.deepStrictEqual(normalized, {
			id: 10,
			name: 'Best of 3 to 21',
			numSets: 3,
			score: 21,
			isDefault: true,
			setType: 0,
			lastSetType: 0,
			set_points: {
				end_points: 21,
				max_points: 30,
				end_points_editable: false,
				max_points_editable: false,
				interval_at: 11,
				interval_duration_ms: 60000,
				break_before_set_duration_ms: 120000,
			},
			last_set_points: {
				end_points: 21,
				max_points: 30,
				end_points_editable: false,
				max_points_editable: false,
				interval_at: 11,
				interval_duration_ms: 60000,
				break_before_set_duration_ms: 120000,
			},
		});
	});

	_it('skips BTP sync when BTP was disabled before parsing the response', async () => {
		const app = {
			db: {
				tournaments: {
					findOne_async: async () => ({ key: 'default', btp_enabled: false, last_reset_ts: 1 }),
				},
			},
		};

		const result = await btp_sync.sync_btp_data(app, 'default', { invalid: true }, { expected_reset_ts: 1 });

		assert.deepStrictEqual(result, { skipped: true, reason: 'btp_disabled' });
	});

	_it('skips stale BTP sync responses after a tournament reset', async () => {
		const app = {
			db: {
				tournaments: {
					findOne_async: async () => ({ key: 'default', btp_enabled: true, last_reset_ts: 2 }),
				},
			},
		};

		const result = await btp_sync.sync_btp_data(app, 'default', { invalid: true }, { expected_reset_ts: 1 });

		assert.deepStrictEqual(result, { skipped: true, reason: 'tournament_reset_during_sync' });
	});

	_it('does not treat pure check-in match updates as now-on-court changes', () => {
		assert.strictEqual(btp_sync._match_update_affects_now_on_court_state({
			$set: {
				'setup.teams.0.players.0.checked_in': true,
				'_btp_sync_signature': 'abc',
			},
		}), false);
	});

	_it('treats field and tabletoperator match updates as now-on-court changes', () => {
		assert.strictEqual(btp_sync._match_update_affects_now_on_court_state({
			$set: {
				'setup.court_id': 'default_7',
			},
		}), true);
		assert.strictEqual(btp_sync._match_update_affects_now_on_court_state({
			$unset: {
				'setup.teams.0.players.0.now_tablet_on_court': true,
			},
		}), true);
	});

	_it('waits for BTP match inserts before reporting match integration complete', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_enabled: true,
			last_reset_ts: 1,
			btp_settings: {},
		});

		const originalInsert = db.matches.insert.bind(db.matches);
		let delayed_insert_callback_finished = false;
		db.matches.insert = (doc, cb) => {
			originalInsert(doc, (err, inserted) => {
				setTimeout(() => {
					delayed_insert_callback_finished = true;
					cb(err, inserted);
				}, 25);
			});
		};

		let integration_callback_returned = false;
		const integration = new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', singleMatchBtpState(), new Map(), new Map(), new Map(), (err) => {
				integration_callback_returned = true;
				if (err) reject(err);
				else resolve();
			});
		});

		await delay(5);
		assert.strictEqual(integration_callback_returned, false);

		await integration;
		assert.strictEqual(delayed_insert_callback_finished, true);

		const inserted_match = await db.matches.findOne_async({ btp_id: 'default_MX U17_1' });
		assert.ok(inserted_match);
	});

	_it('does not add BTP matches after a tournament reset invalidated the sync', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_enabled: true,
			last_reset_ts: 2,
			btp_settings: {},
		});

		let insert_called = false;
		db.matches.insert = (doc, cb) => {
			insert_called = true;
			cb(new Error('stale sync must not insert matches'));
		};

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(
				app,
				'default',
				singleMatchBtpState(),
				new Map(),
				new Map(),
				new Map(),
				(err) => {
					if (err) reject(err);
					else resolve();
				},
				{ expected_reset_ts: 1 }
			);
		});

		const inserted_match = await db.matches.findOne_async({ btp_id: 'default_MX U17_1' });
		assert.strictEqual(insert_called, false);
		assert.strictEqual(inserted_match, null);
	});

	_it('normalizes editable scoring formats using the score fallback', () => {
		const normalized = btp_sync._normalize_scoring_format({
			ID: ['11'],
			Name: ['Custom 1x17'],
			NumSets: ['1'],
			SetType: ['999'],
			LastSetType: ['999'],
			Score: ['17'],
			IsDefault: [false],
		});

		assert.deepStrictEqual(normalized.set_points, {
			end_points: 17,
			max_points: 17,
			end_points_editable: false,
			max_points_editable: true,
			defaults_from_score: true,
			interval_at: 9,
			interval_duration_ms: 60000,
			break_before_set_duration_ms: 120000,
		});
		assert.deepStrictEqual(normalized.last_set_points, {
			end_points: 17,
			max_points: 17,
			end_points_editable: false,
			max_points_editable: true,
			defaults_from_score: true,
			interval_at: 9,
			interval_duration_ms: 60000,
			break_before_set_duration_ms: 120000,
		});
	});

	_it('normalizes fully editable set rules for set type 1000', () => {
		const normalized = btp_sync._normalize_scoring_format({
			ID: ['13'],
			Name: ['Custom free'],
			NumSets: ['3'],
			SetType: ['1000'],
			LastSetType: ['1000'],
			Score: ['0'],
			IsDefault: [false],
		});

		assert.deepStrictEqual(normalized.set_points, {
			end_points: 1,
			max_points: 1,
			end_points_editable: true,
			max_points_editable: true,
			interval_at: 1,
			interval_duration_ms: 60000,
			break_before_set_duration_ms: 120000,
		});
		assert.deepStrictEqual(normalized.last_set_points, {
			end_points: 1,
			max_points: 1,
			end_points_editable: true,
			max_points_editable: true,
			interval_at: 1,
			interval_duration_ms: 60000,
			break_before_set_duration_ms: 120000,
		});
	});

	_it('defaults interval point to rounded-up half of end points', () => {
		const normalized = btp_sync._normalize_scoring_format({
			ID: ['14'],
			Name: ['Custom 1x15'],
			NumSets: ['1'],
			SetType: ['999'],
			LastSetType: ['999'],
			Score: ['15'],
			IsDefault: [false],
		});

		assert.strictEqual(normalized.set_points.interval_at, 8);
		assert.strictEqual(normalized.last_set_points.interval_at, 8);
	});

	_it('normalizes BTP stage entries into registration entries', () => {
		const btpState = {
			entries: new Map([
				[10, {
					ID: [10],
					Player1ID: [101],
					Player2ID: [102],
				}],
			]),
			players: new Map([
				[101, {
					ID: [101],
					ClubID: [201],
					Firstname: ['Ada'],
					Lastname: ['Lovelace'],
					MemberID: ['09-010496'],
					Country: ['ENG'],
					GenderID: [2],
					DateOfBirth: [{ year: 1815, month: 12, day: 10 }],
				}],
				[102, {
					ID: [102],
					ClubID: [202],
					Firstname: ['Grace'],
					Lastname: ['Hopper'],
					Country: ['USA'],
					GenderID: [2],
				}],
			]),
			clubs: new Map([
				[201, { ID: [201], Name: ['Analytical Engines BC'], DistrictID: [301] }],
				[202, { ID: [202], Name: ['Compiler Club'] }],
			]),
			districts: new Map([
				[301, { ID: [301], Name: ['04-WI'] }],
			]),
		};

		const normalized = btp_sync._normalize_stage_entry_for_event_payload({
			ID: [20],
			StageID: [30],
			EntryID: [10],
			Status: [0],
			Seed1: [2],
			Rank: [1815],
			Points: [2067],
			CreatedAt: [{ year: 2026, month: 4, day: 9, hour: 18, minute: 29 }],
		}, btpState);

		assert.strictEqual(normalized.stage_entry_id, 20);
		assert.strictEqual(normalized.entry_id, 10);
		assert.strictEqual(normalized.status, 0);
		assert.strictEqual(normalized.seed1, 2);
		assert.strictEqual(normalized.seed2, null);
		assert.strictEqual(normalized.rank, 1815);
		assert.strictEqual(normalized.points, 2067);
		assert.strictEqual(normalized.entered_at, '2026-04-09 18:29');
		assert.deepStrictEqual(normalized.team.players.map((player) => player.name), [
			'Ada Lovelace',
			'Grace Hopper',
		]);
		assert.deepStrictEqual(normalized.team.players.map((player) => player.club), [
			'Analytical Engines BC',
			'Compiler Club',
		]);
		assert.strictEqual(normalized.team.players[0].association, '04-WI');
		assert.strictEqual(normalized.team.players[0].member_id, '09-010496');
		assert.strictEqual(normalized.team.players[0].gender, 'W');
		assert.strictEqual(normalized.team.players[0].date_of_birth, '1815-12-10');
	});

	_it('stores registration entries on event stages during event integration', (done) => {
		const updated = {};
		const app = {
			db: {
				tournaments: {
					findOne(query, projection, cb) {
						assert.strictEqual(query.key, 't1');
						assert.deepStrictEqual(projection, { key: 1, _id: 0 });
						const tournament = { key: 't1' };
						cb(null, query.$where && !query.$where.call(tournament) ? null : tournament);
					},
					update(query, update, options, cb) {
						assert.deepStrictEqual(query, { key: 't1' });
						Object.assign(updated, update.$set);
						cb(null);
					},
				},
			},
		};
		const btpState = {
			events: new Map([
				[1, {
					ID: [1],
					Name: ['JE U15'],
					GameTypeID: [1],
					GenderID: [1],
					MinAge: [0],
					MaxAge: [15],
					Fee: [0],
					SeparateSeeding: [false],
					AllowOnlineEntry: [true],
					GradingID: [0],
					SubGradingID: [0],
					SubGrading2ID: [0],
				}],
			]),
			stages: new Map([
				[10, {
					ID: [10],
					Name: ['Hauptfeld'],
					EventID: [1],
					StageType: [1],
					DisplayOrder: [1],
				}],
			]),
			stage_entries: new Map([
				[20, {
					ID: [20],
					StageID: [10],
					EntryID: [30],
					Status: [0],
				}],
			]),
			entries: new Map([
				[30, {
					ID: [30],
					Player1ID: [40],
				}],
			]),
			players: new Map([
				[40, {
					ID: [40],
					Firstname: ['Tjorve'],
					Lastname: ['Von Deetzen'],
				}],
			]),
			clubs: new Map(),
			districts: new Map(),
		};

		btp_sync._integrate_events(app, 't1', btpState, (err) => {
			assert.ifError(err);
			assert.strictEqual(updated.events.events[0].name, 'JE U15');
			assert.strictEqual(updated.events.events[0].is_drawn, false);
			assert.strictEqual(updated.events.events[0].match_count, 0);
			assert.strictEqual(updated.events.events[0].stages[0].entry_count, 1);
			assert.strictEqual(updated.events.events[0].stages[0].entries[0].stage_entry_id, 20);
			assert.strictEqual(updated.events.events[0].stages[0].entries[0].team.players[0].name, 'Tjorve Von Deetzen');
			done();
		});
	});

	_it('marks registration events as drawn when BTP has matches for them', (done) => {
		const updated = {};
		const app = {
			db: {
				tournaments: {
					findOne(query, projection, cb) {
						assert.strictEqual(query.key, 't1');
						assert.deepStrictEqual(projection, { key: 1, _id: 0 });
						const tournament = { key: 't1' };
						cb(null, query.$where && !query.$where.call(tournament) ? null : tournament);
					},
					update(query, update, options, cb) {
						assert.deepStrictEqual(query, { key: 't1' });
						Object.assign(updated, update.$set);
						cb(null);
					},
				},
			},
		};
		const btpState = {
			draws: new Map([
				[50, { ID: [50], EventID: [1], Name: ['JE U15'] }],
			]),
			matches: [
				{ ID: [70], DrawID: [50], IsMatch: [true] },
				{ ID: [71], DrawID: [50], IsMatch: [false] },
			],
			events: new Map([
				[1, {
					ID: [1],
					Name: ['JE U15'],
					GameTypeID: [1],
					GenderID: [1],
					MinAge: [0],
					MaxAge: [15],
					Fee: [0],
					SeparateSeeding: [false],
					AllowOnlineEntry: [true],
					GradingID: [0],
					SubGradingID: [0],
					SubGrading2ID: [0],
				}],
			]),
			stages: new Map(),
			stage_entries: new Map(),
			entries: new Map(),
			players: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};

		btp_sync._integrate_events(app, 't1', btpState, (err) => {
			assert.ifError(err);
			assert.strictEqual(updated.events.events[0].is_drawn, true);
			assert.strictEqual(updated.events.events[0].match_count, 1);
			done();
		});
	});

	_it('resolves direct visible predecessor links for placement matches without importing extra matches', () => {
		const planning_nodes = new Map([
			['37_4009', {
				DrawID: ['37'],
				PlanningID: ['4009'],
				IsMatch: [true],
				MatchNr: ['18'],
				WinnerTo: ['3005'],
				LoserTo: ['3009'],
				PlannedTime: [{ year: 2026, month: 4, day: 18, hour: 11, minute: 30 }],
			}],
		]);

		const label = btp_sync._resolve_btp_dependency_link('37', '4009', '3005', [], planning_nodes);

		assert.strictEqual(label, 'Gewinner #18 - 2026-04-18 11:30');
	});

	_it('resolves hidden loser slots via the visible consolidation match number', () => {
		const planning_nodes = new Map([
			['37_3004', {
				DrawID: ['37'],
				PlanningID: ['3004'],
				IsMatch: [true],
				MatchNr: ['17'],
				From1: ['4007'],
				From2: ['4008'],
				WinnerTo: ['2002'],
				LoserTo: ['4010'],
				PlannedTime: [{ year: 2026, month: 4, day: 18, hour: 11, minute: 0 }],
			}],
			['37_4007', {
				DrawID: ['37'],
				PlanningID: ['4007'],
				IsMatch: [true],
				MatchNr: ['7'],
				LoserTo: ['4010'],
				PlannedTime: [{ year: 2026, month: 4, day: 18, hour: 10, minute: 30 }],
			}],
			['37_4008', {
				DrawID: ['37'],
				PlanningID: ['4008'],
				IsMatch: [true],
				MatchNr: ['8'],
				LoserTo: ['4010'],
				PlannedTime: [{ year: 2026, month: 4, day: 18, hour: 10, minute: 30 }],
			}],
		]);

		const label = btp_sync._resolve_btp_dependency_link('37', '4010', '3005', [], planning_nodes);

		assert.strictEqual(label, 'Verlierer #17 - 2026-04-18 11:00');
	});

	_it('resolves hidden predecessor nodes that only expose MatchNr without IsMatch', () => {
		const planning_nodes = new Map([
			['37_3013', {
				DrawID: ['37'],
				PlanningID: ['3013'],
				MatchNr: ['18'],
				From1: ['5017'],
				From2: ['5018'],
				WinnerTo: ['2013'],
				LoserTo: ['2015'],
			}],
		]);

		const label = btp_sync._resolve_btp_dependency_link('37', '3013', '2013', [], planning_nodes);

		assert.strictEqual(label, 'Gewinner #18');
	});

	_it('derives time from the visible sibling match when a hidden placement node feeds the target', () => {
		const planning_nodes = new Map([
			['39_2003', {
				DrawID: ['39'],
				PlanningID: ['2003'],
				MatchNr: ['49'],
				From1: ['3001'],
				From2: ['3002'],
				WinnerTo: ['1003'],
				LoserTo: ['1004'],
			}],
			['39_2001', {
				DrawID: ['39'],
				PlanningID: ['2001'],
				IsMatch: [true],
				MatchNr: ['49'],
				From1: ['3001'],
				From2: ['3002'],
				WinnerTo: ['1001'],
				LoserTo: ['1002'],
				PlannedTime: [{ year: 2026, month: 4, day: 19, hour: 14, minute: 0 }],
			}],
		]);

		const label = btp_sync._resolve_btp_dependency_link('39', '2003', '1003', [], planning_nodes);

		assert.strictEqual(label, 'Gewinner #49 - 2026-04-19 14:00');
	});

	_it('keeps successor teams empty until BTP supplies the successor players', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});
		const base_state = {
			matches: [{
				ID: [1001],
				DrawID: [10],
				PlanningID: [100],
				From1: [1],
				From2: [2],
				WinnerTo: [200],
				IsMatch: [true],
				MatchNr: [1],
				Highlight: [0],
				Status: 0,
				PlannedTime: [{ year: 2026, month: 4, day: 18, hour: 11, minute: 0 }],
				bts_complete: true,
				bts_players: [
					[{ ID: [1], Firstname: ['Alice'], Lastname: ['A'] }],
					[{ ID: [2], Firstname: ['Berta'], Lastname: ['B'] }],
				],
			}, {
				ID: [1002],
				DrawID: [10],
				PlanningID: [200],
				From1: [100],
				From2: [3],
				IsMatch: [true],
				MatchNr: [2],
				Highlight: [0],
				Status: 0,
				bts_complete: false,
				bts_players: [
					[],
					[{ ID: [3], Firstname: ['Cara'], Lastname: ['C'] }],
				],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['JE U17'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['JE U17'], GameTypeID: [1] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', base_state, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
		let successor = await db.matches.findOne_async({ _id: 'btp_default_JE U17_1002' });
		assert.strictEqual(successor.setup.incomplete, true);
		assert.deepStrictEqual(successor.setup.teams[0].players, []);
		assert.strictEqual(successor.setup.links.from1_link, 'Gewinner #1 - 2026-04-18 11:00');

		const state_with_winner = {
			...base_state,
			matches: base_state.matches.map((match) => (
				match.ID[0] === 1001
					? { ...match, Winner: [1], ScoreStatus: [0] }
					: match
			)),
		};
		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', state_with_winner, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		successor = await db.matches.findOne_async({ _id: 'btp_default_JE U17_1002' });
		assert.strictEqual(successor.setup.incomplete, true);
		assert.deepStrictEqual(successor.setup.teams[0].players, []);
		assert.strictEqual(successor.setup.teams[1].players[0].btp_id, 3);

		const state_with_btp_successor_players = {
			...state_with_winner,
			matches: state_with_winner.matches.map((match) => (
				match.ID[0] === 1002
					? {
						...match,
						bts_players: [
							[{ ID: [1], Firstname: ['Alice'], Lastname: ['A'] }],
							[{ ID: [3], Firstname: ['Cara'], Lastname: ['C'] }],
						],
					}
					: match
			)),
		};
		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', state_with_btp_successor_players, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		successor = await db.matches.findOne_async({ _id: 'btp_default_JE U17_1002' });
		assert.strictEqual(successor.setup.incomplete, false);
		assert.strictEqual(successor.setup.teams[0].players[0].btp_id, 1);
		assert.strictEqual(successor.setup.teams[0].players[0].name, 'Alice A');
		assert.strictEqual(successor.setup.teams[1].players[0].btp_id, 3);
	});

	_it('does not fill a successor team through an unfinished real KO predecessor', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});
		const btpState = {
			matches: [{
				ID: [1001],
				DrawID: [10],
				PlanningID: [4007],
				From1: [1],
				From2: [3],
				WinnerTo: [3004],
				IsMatch: [true],
				MatchNr: [23],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				Winner: [1],
				ScoreStatus: [0],
				bts_players: [
					[
						{ ID: [1], Firstname: ['Lukas'], Lastname: ['Bayerlein'] },
						{ ID: [2], Firstname: ['Maya'], Lastname: ['Herzog'] },
					],
					[
						{ ID: [3], Firstname: ['Other'], Lastname: ['Pair'] },
					],
				],
			}, {
				ID: [1002],
				DrawID: [10],
				PlanningID: [4008],
				From1: [4],
				From2: [6],
				WinnerTo: [3004],
				IsMatch: [true],
				MatchNr: [24],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				Winner: [1],
				ScoreStatus: [0],
				bts_players: [
					[
						{ ID: [4], Firstname: ['Johannes'], Lastname: ['Ernst'] },
						{ ID: [5], Firstname: ['Maira'], Lastname: ['Wochnik'] },
					],
					[
						{ ID: [6], Firstname: ['Other'], Lastname: ['Pair'] },
					],
				],
			}, {
				ID: [1003],
				DrawID: [10],
				PlanningID: [3004],
				From1: [4007],
				From2: [4008],
				WinnerTo: [2002],
				IsMatch: [true],
				MatchNr: [48],
				Highlight: [0],
				Status: 0,
				bts_complete: false,
				bts_players: [
					[],
					[],
				],
			}, {
				ID: [1004],
				DrawID: [10],
				PlanningID: [2002],
				From1: [3003],
				From2: [3004],
				IsMatch: [true],
				MatchNr: [57],
				Highlight: [0],
				Status: 0,
				bts_complete: false,
				bts_players: [
					[{ ID: [7], Firstname: ['Jonte'], Lastname: ['Spelthahn'] }],
					[],
				],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MX U15'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MX U15'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		const successor = await db.matches.findOne_async({ _id: 'btp_default_MX U15_1004' });
		assert.strictEqual(successor.setup.incomplete, true);
		assert.strictEqual(successor.setup.teams[0].players[0].btp_id, 7);
		assert.deepStrictEqual(successor.setup.teams[1].players, []);
	});

	_it('reports an empty bye-vs-bye branch to BTP as a winner without score or special status', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});
		const btpState = {
			matches: [{
				ID: [1001],
				DrawID: [10],
				PlanningID: [4007],
				From1: [1],
				From2: [2],
				WinnerTo: [3004],
				IsMatch: [true],
				MatchNr: [60],
				Highlight: [0],
				Status: 0,
				bts_complete: false,
				bts_players: [[], []],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MD U13'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MD U13'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};
		const pushed = [];
		const originalUpdateScore = btp_manager.update_score;
		btp_manager.update_score = (_app, match) => pushed.push({
			id: match._id,
			team1_won: match.team1_won,
			btp_winner: match.btp_winner,
			score_status: match.score_status,
			btp_score_status: match.btp_score_status,
			network_score: match.network_score,
			btp_winner_only_update: match.btp_winner_only_update,
		});
		try {
			await new Promise((resolve, reject) => {
				btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		} finally {
			btp_manager.update_score = originalUpdateScore;
		}

		const match = await db.matches.findOne_async({ _id: 'btp_default_MD U13_1001' });
		assert.strictEqual(match.team1_won, true);
		assert.strictEqual(match.btp_winner, 1);
		assert.strictEqual(match.btp_needsync, true);
		assert.strictEqual(match.score_status, 'normal');
		assert.strictEqual(match.btp_score_status, 0);
		assert.strictEqual(match.network_score, undefined);
		assert.strictEqual(match._btp_auto_bye_winner_sync, undefined);
		assert.deepStrictEqual(pushed, [{
			id: 'btp_default_MD U13_1001',
			team1_won: true,
			btp_winner: 1,
			score_status: 'normal',
			btp_score_status: 0,
			network_score: undefined,
			btp_winner_only_update: true,
		}]);
	});

	_it('does not report an empty match as bye-vs-bye when a predecessor can still produce players', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});
		const btpState = {
			matches: [{
				ID: [1001],
				DrawID: [10],
				PlanningID: [4007],
				From1: [1],
				From2: [2],
				WinnerTo: [3004],
				IsMatch: [true],
				MatchNr: [60],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				bts_players: [[{ ID: [1], Firstname: ['A'], Lastname: ['One'] }], [{ ID: [2], Firstname: ['B'], Lastname: ['Two'] }]],
			}, {
				ID: [1002],
				DrawID: [10],
				PlanningID: [3004],
				From1: [4007],
				From2: [3],
				IsMatch: [true],
				MatchNr: [28],
				Highlight: [0],
				Status: 0,
				bts_complete: false,
				bts_players: [[], []],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MD U13'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MD U13'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};
		const pushed = [];
		const originalUpdateScore = btp_manager.update_score;
		btp_manager.update_score = (_app, match) => pushed.push(match._id);
		try {
			await new Promise((resolve, reject) => {
				btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		} finally {
			btp_manager.update_score = originalUpdateScore;
		}

		const match = await db.matches.findOne_async({ _id: 'btp_default_MD U13_1002' });
		assert.strictEqual(match.team1_won, undefined);
		assert.strictEqual(match.btp_winner, undefined);
		assert.strictEqual(match.btp_needsync, undefined);
		assert.deepStrictEqual(pushed, []);
	});

	_it('finds hidden bye successors in either raw or planning nodes and keeps draws separate', () => {
		const branch = { ID: [201], DrawID: [10], PlanningID: [4001], From1: [9001], From2: [9002], bts_players: [[], []] };
		const otherDrawBranch = { ...branch, ID: [202], DrawID: [20] };
		const successor = { ID: [301], DrawID: [10], PlanningID: [3001], From1: ['4001'], From2: [4002], IsMatch: [true], bts_players: [[], [{ ID: [77] }]] };
		const emptySuccessor = { ...successor, bts_players: [[], []] };
		for (const inRawMatches of [true, false]) {
			const state = {
				matches: [inRawMatches ? successor : emptySuccessor],
				planning_nodes: new Map([
					[201, branch], [202, otherDrawBranch],
					[301, inRawMatches ? emptySuccessor : successor],
				]),
				links: [],
			};
			assert.deepStrictEqual(btp_sync._find_hidden_empty_bye_branch_winner_candidates(state).map(match => match.ID[0]), [201]);
		}
	});

	_it('ignores overwritten raw and planning successors when deciding hidden bye winners', () => {
		const branch = { ID: [201], DrawID: [10], PlanningID: [4001], From1: [9001], From2: [9002], bts_players: [[], []] };
		const oneSided = { ID: [301], DrawID: [10], PlanningID: [3001], From1: [4001], From2: [4002], IsMatch: [true], bts_players: [[], [{ ID: [77] }]] };
		const overwritten = { ...oneSided, ID: [302], bts_players: [[{ ID: [88] }], [{ ID: [77] }]] };
		const state = {
			matches: [oneSided, overwritten],
			planning_nodes: new Map([[201, branch], [301, oneSided], [302, overwritten]]),
			links: [],
		};
		assert.deepStrictEqual(btp_sync._find_hidden_empty_bye_branch_winner_candidates(state), []);
	});

	_it('treats a resolved source whose winner is a bye as empty for hidden bye branches', () => {
		const hiddenBranch = {
			ID: [201],
			DrawID: [10],
			PlanningID: [4001],
			From1: [3001],
			From2: [3002],
			WinnerTo: [2009],
			Highlight: [0],
			bts_players: [[], []],
		};
		const source1 = {
			ID: [301],
			DrawID: [10],
			PlanningID: [3001],
			From1: [5001],
			From2: [5002],
			Winner: [2],
			MatchNr: [3],
			bts_players: [[{ ID: [1], Firstname: ['Pairing'], Lastname: ['One'] }], []],
			bts_winners: [],
		};
		const source2 = {
			ID: [302],
			DrawID: [10],
			PlanningID: [3002],
			From1: [5003],
			From2: [5004],
			Winner: [1],
			MatchNr: [4],
			bts_players: [[], [{ ID: [2], Firstname: ['Pairing'], Lastname: ['Two'] }]],
			bts_winners: [],
		};
		const oneSidedSuccessor = {
			ID: [501],
			DrawID: [10],
			PlanningID: [2009],
			From1: [4001],
			From2: [5000],
			IsMatch: [true],
			MatchNr: [60],
			bts_players: [[], [{ ID: [3], Firstname: ['Pairing'], Lastname: ['Three'] }]],
		};
		const visibleSuccessor = {
			ID: [1009],
			DrawID: [10],
			PlanningID: [1009],
			From1: [2009],
			From2: [4002],
			IsMatch: [true],
			IsPlayable: [true],
			MatchNr: [28],
			Highlight: [0],
			Status: 0,
			bts_players: [[], []],
		};
		const btpState = {
			matches: [visibleSuccessor],
			planning_nodes: new Map([
				['10_3001', source1],
				['10_3002', source2],
				['10_4001', hiddenBranch],
				['10_2009', oneSidedSuccessor],
				['10_1009', visibleSuccessor],
			]),
			links: [],
		};

		const candidates = btp_sync._find_hidden_empty_bye_branch_winner_candidates(btpState);

		assert.deepStrictEqual(candidates.map(match => match.ID[0]), [201]);
	});

	_it('reports hidden empty bye-vs-bye predecessor branches to BTP', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});

		const realEntry1 = {
			ID: [301],
			DrawID: [10],
			PlanningID: [5001],
			EntryID: [101],
			bts_winners: [{ ID: [1], Firstname: ['Pairing'], Lastname: ['One'] }],
		};
		const realEntry2 = {
			ID: [302],
			DrawID: [10],
			PlanningID: [5002],
			EntryID: [102],
			bts_winners: [{ ID: [2], Firstname: ['Pairing'], Lastname: ['Two'] }],
		};
		const hiddenBye1 = {
			ID: [201],
			DisplayOrder: [7],
			DrawID: [10],
			PlanningID: [4001],
			EntryID: [20101],
			From1: [1],
			From2: [2],
			WinnerTo: [2009],
			Highlight: [0],
			bts_players: [[], []],
		};
		const hiddenBye2 = {
			ID: [202],
			DisplayOrder: [0],
			DrawID: [10],
			PlanningID: [4002],
			EntryID: [20201],
			From1: [3],
			From2: [4],
			WinnerTo: [2010],
			Highlight: [0],
			bts_players: [[], []],
		};
		const hiddenPredecessor1 = {
			ID: [601],
			DrawID: [10],
			PlanningID: [2009],
			From1: [5001],
			From2: [4001],
			WinnerTo: [1009],
			IsMatch: [true],
			MatchNr: [60],
			Highlight: [0],
			bts_players: [[{ ID: [1], Firstname: ['Pairing'], Lastname: ['One'] }], []],
		};
		const hiddenPredecessor2 = {
			ID: [602],
			DrawID: [10],
			PlanningID: [2010],
			From1: [4002],
			From2: [5002],
			WinnerTo: [1009],
			IsMatch: [true],
			MatchNr: [61],
			Highlight: [0],
			bts_players: [[], [{ ID: [2], Firstname: ['Pairing'], Lastname: ['Two'] }]],
		};
		const visiblePlacement = {
			ID: [1009],
			DrawID: [10],
			PlanningID: [1009],
			From1: [2009],
			From2: [2010],
			IsMatch: [true],
			IsPlayable: [true],
			MatchNr: [28],
			Highlight: [0],
			Status: 0,
			bts_complete: false,
			bts_players: [[], []],
		};
		const planning_nodes = new Map([
			['10_5001', realEntry1],
			['10_5002', realEntry2],
			['10_4001', hiddenBye1],
			['10_4002', hiddenBye2],
			['10_2009', hiddenPredecessor1],
			['10_2010', hiddenPredecessor2],
			['10_1009', visiblePlacement],
		]);
		const btpState = {
			matches: [visiblePlacement],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MD U13'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MD U13'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes,
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};
		const pushed = [];
		const originalUpdateScore = btp_manager.update_score;
		btp_manager.update_score = (_app, match) => pushed.push({
			id: match.btp_match_ids[0].id,
			match_num: match.btp_match_ids[0].nr,
			transmitted_order: require('../bts/btp_proto').update_request(match, 'session').Update.Tournament.Matches[0].Match.MatchOrder,
			winner_only: match.btp_winner_only_update,
			team1_won: match.team1_won,
			network_score: match.network_score,
			score_status_network_score: match.score_status_network_score,
		});
		try {
			await new Promise((resolve, reject) => {
				btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		} finally {
			btp_manager.update_score = originalUpdateScore;
		}

		assert.deepStrictEqual(pushed, [
			{
				id: 201,
				match_num: undefined,
				transmitted_order: 7,
				winner_only: true,
				team1_won: true,
				network_score: undefined,
				score_status_network_score: undefined,
			},
			{
				id: 202,
				match_num: undefined,
				transmitted_order: 0,
				winner_only: true,
				team1_won: true,
				network_score: undefined,
				score_status_network_score: undefined,
			},
		]);
	});

	_it('sanitizes end_points to be at least 1 and max_points to be at least end_points', () => {
		const sanitized = btp_sync._sanitize_scoring_format({
			id: 99,
			name: 'Broken',
			numSets: 1,
			score: 0,
			isDefault: false,
			setType: 1000,
			lastSetType: 1000,
			set_points: {
				end_points: 0,
				max_points: 0,
			},
			last_set_points: {
				end_points: -5,
				max_points: 2,
			},
		});

		assert.strictEqual(sanitized.set_points.end_points, 1);
		assert.strictEqual(sanitized.set_points.max_points, 1);
		assert.strictEqual(sanitized.last_set_points.end_points, 1);
		assert.strictEqual(sanitized.last_set_points.max_points, 2);
	});

	_it('normalizes different rules for the last set', () => {
		const normalized = btp_sync._normalize_scoring_format({
			ID: ['12'],
			Name: ['2x21+11'],
			NumSets: ['3'],
			SetType: ['0'],
			LastSetType: ['304'],
			Score: ['21'],
			IsDefault: [false],
		});

		assert.deepStrictEqual(normalized.set_points, {
			end_points: 21,
			max_points: 30,
			end_points_editable: false,
			max_points_editable: false,
			interval_at: 11,
			interval_duration_ms: 60000,
			break_before_set_duration_ms: 120000,
		});
			assert.deepStrictEqual(normalized.last_set_points, {
				end_points: 11,
				max_points: 15,
				end_points_editable: false,
				max_points_editable: false,
				interval_at: 6,
				interval_duration_ms: 60000,
				break_before_set_duration_ms: 120000,
			});
		});

	_it('provides a complete 3x21 fallback scoring format', () => {
		const normalized = btp_sync._fallback_scoring_format();

		assert.deepStrictEqual(normalized, {
			id: null,
			name: '3x21',
			numSets: 3,
			score: 21,
			isDefault: false,
			setType: 0,
			lastSetType: 0,
			set_points: {
				end_points: 21,
				max_points: 30,
				end_points_editable: false,
				max_points_editable: false,
				interval_at: 11,
				interval_duration_ms: 60000,
				break_before_set_duration_ms: 120000,
			},
			last_set_points: {
				end_points: 21,
				max_points: 30,
				end_points_editable: false,
				max_points_editable: false,
				interval_at: 11,
				interval_duration_ms: 60000,
				break_before_set_duration_ms: 120000,
			},
		});
	});

	_it('imports planned BTP courts even when the local assignment was explicitly emptied', () => {
		for (const state of ['scheduled', 'incomplete', 'preparation']) {
			const current = { setup: { state, now_on_court: false, court_id: null, teams: [] } };
			const incoming = { setup: { state, now_on_court: false, court_id: 'court_7', teams: [] } };
			const merged = btp_sync._merge_local_match_into_btp_match(current, structuredClone(incoming));
			assert.strictEqual(merged.setup.court_id, 'court_7');
			assert.strictEqual(merged.setup.state, state);
			const called = btp_sync._merge_local_match_into_btp_match(current, {
				setup: { ...incoming.setup, now_on_court: true, state: 'oncourt' },
			});
			assert.strictEqual(called.setup.court_id, 'court_7');
			assert.strictEqual(called.setup.now_on_court, true);
			const assigned = btp_sync._merge_local_match_into_btp_match({ setup: { ...current.setup, court_id: 'court_8' } },
				structuredClone(incoming));
			assert.strictEqual(assigned.setup.court_id, 'court_7');
			const imported = btp_sync._merge_local_match_into_btp_match({ setup: { state, teams: [] } },
				structuredClone(incoming));
			assert.strictEqual(imported.setup.court_id, 'court_7');
			assert.strictEqual(current.setup.court_id, null);
		}
	});

	_it('removes obsolete planned courts on import and keeps explicit preparation locations', () => {
		for (const state of ['scheduled', 'incomplete', 'preparation', 'blocked']) {
			const current = { setup: { state, court_id: 'court_7', now_on_court: false, location_id: 'hall',
				preparation_call_timestamp: state === 'preparation' ? 123 : undefined, teams: [] } };
			const incoming = { setup: { state, now_on_court: false, location_id: 'hall', teams: [] } };
			const merged = btp_sync._merge_local_match_into_btp_match(current, incoming);
			assert(!merged.setup.court_id);
			assert.strictEqual(merged.setup.location_id, 'hall');
			assert.strictEqual(merged.setup.state, state);
		}
		const running = { setup: { state: 'oncourt', now_on_court: true, court_id: 'court_7', teams: [] } };
		assert.strictEqual(btp_sync._merge_local_match_into_btp_match(running,
			{ setup: { state: 'scheduled', now_on_court: false, teams: [] } }).setup.court_id, 'court_7');
	});

	_it('cleans stale local courts even when the last imported BTP signature is unchanged', async () => {
		const db = await database.init_test();
		const app = { db, wss: { clients: [] } };
		await insert(db, 'tournaments', { key: 'default', btp_settings: {} });
		const state = singleMatchBtpState({ CourtID: [7], LocationID: [5] });
		const sync = () => new Promise((resolve, reject) => btp_sync._integrate_matches(
			app, 'default', state, new Map(), new Map([[5, 'hall']]), new Map([[7, 'court_7']]),
			err => err ? reject(err) : resolve()));
		await sync();
		const id = 'btp_default_MX U17_1';
		assert.strictEqual((await db.matches.findOne_async({ _id: id })).setup.court_id, 'court_7');
		delete state.matches[0].CourtID;
		await sync();
		let match = await db.matches.findOne_async({ _id: id });
		assert(!match.setup.court_id);
		assert.strictEqual(match.setup.location_id, 'hall');
		const signature = match._btp_sync_signature;
		await db.matches.update_async({ _id: id }, { $set: { 'setup.court_id': 'court_7' } }, {});
		await sync();
		match = await db.matches.findOne_async({ _id: id });
		assert(!match.setup.court_id);
		assert.strictEqual(match._btp_sync_signature, signature);
		await sync();
		assert(!(await db.matches.findOne_async({ _id: id })).setup.court_id);
	});

	_it('keeps the local court on finished matches when BTP no longer sends a court', () => {
		const currentMatch = {
			team1_won: true,
			btp_winner: 1,
			btp_needsync: false,
			setup: {
				court_id: 'court_7',
				now_on_court: false,
				state: 'finished',
				teams: [{ players: [] }, { players: [] }],
			},
		};
		const btpMatch = {
			setup: {
				now_on_court: false,
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, structuredClone(btpMatch));

		assert.strictEqual(merged.setup.state, 'finished');
		assert.strictEqual(merged.setup.court_id, 'court_7');
	});

	_it('keeps local live tablet score fields while a match is on court', () => {
		const currentMatch = {
			btp_needsync: false,
			network_score: [[17, 12], [4, 2]],
			network_team1_left: true,
			network_team1_serving: false,
			network_teams_player1_even: [false, true],
			presses: [{ type: 'score', side: 'left' }],
			duration_ms: 123000,
			shuttle_count: 2,
			setup: {
				court_id: 'court_7',
				now_on_court: true,
				state: 'oncourt',
				called_timestamp: 1770000000000,
				teams: [{ players: [] }, { players: [] }],
			},
		};
		const btpMatch = {
			network_score: [[2, 1]],
			network_team1_left: false,
			duration_ms: 9000,
			setup: {
				court_id: 'court_7',
				now_on_court: true,
				state: 'oncourt',
				teams: [{ players: [] }, { players: [] }],
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, structuredClone(btpMatch));

		assert.deepStrictEqual(merged.network_score, [[17, 12], [4, 2]]);
		assert.strictEqual(merged.network_team1_left, true);
		assert.strictEqual(merged.network_team1_serving, false);
		assert.deepStrictEqual(merged.network_teams_player1_even, [false, true]);
		assert.deepStrictEqual(merged.presses, [{ type: 'score', side: 'left' }]);
		assert.strictEqual(merged.duration_ms, 123000);
		assert.strictEqual(merged.shuttle_count, 2);
		assert.strictEqual(merged.setup.now_on_court, true);
		assert.strictEqual(merged.setup.called_timestamp, 1770000000000);
	});

	_it('keeps local blocked state when a future match contains players already on court', () => {
		const currentMatch = {
			btp_needsync: false,
			setup: {
				state: 'blocked',
				now_on_court: false,
				teams: [{
					players: [{
						btp_id: 1,
						now_playing_on_court: 'court_1',
					}],
				}, {
					players: [{ btp_id: 2 }],
				}],
			},
		};
		const btpMatch = {
			setup: {
				state: 'unscheduled',
				now_on_court: false,
				teams: [{
					players: [{ btp_id: 1 }],
				}, {
					players: [{ btp_id: 2 }],
				}],
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, structuredClone(btpMatch));

		assert.strictEqual(merged.setup.state, 'blocked');
		assert.strictEqual(merged.setup.teams[0].players[0].now_playing_on_court, 'court_1');
	});

	_it('parses BTP court numbers from localized court names', () => {
		assert.strictEqual(btp_sync._parse_btp_court_num({ ID: [2], Name: ['Feld 1'] }), 1);
		assert.strictEqual(btp_sync._parse_btp_court_num({ ID: [12], Name: ['Court 7'] }), 7);
		assert.strictEqual(btp_sync._parse_btp_court_num({ ID: [13], Name: ['3'] }), 3);
		assert.strictEqual(btp_sync._parse_btp_court_num({ ID: [14], Name: [''], SortOrder: [4] }), 4);
	});

	_it('migrates BTP courts whose global IDs are offset by another location', (done) => {
		const state = {
			courts: Array.from({ length: 17 }, (_, index) => {
				const btp_id = index + 2;
				return {
					_id: 't1_' + btp_id,
					tournament_key: 't1',
					btp_id,
					num: btp_id,
					name: 'Feld ' + (index + 1),
					location_id: 't1_main',
					is_active: true,
					has_umpire: true,
					has_service_judge: true,
				};
			}),
		};
		const matches_query = (doc, query) => Object.keys(query).every((key) => doc[key] === query[key]);
		const app = {
			db: {
				courts: {
					findOne(query, cb) {
						cb(null, state.courts.find((court) => matches_query(court, query)) || null);
					},
					find(query, cb) {
						cb(null, state.courts.filter((court) => matches_query(court, query)));
					},
					insert(doc, cb) {
						state.courts.push({ ...doc });
						cb(null, doc);
					},
					update(query, update, options, cb) {
						const court = state.courts.find((candidate) => matches_query(candidate, query));
						if (!court) return cb(null, 0);
						Object.assign(court, update.$set || {});
						cb(null, 1, court);
					},
					remove(query, options, cb) {
						const before = state.courts.length;
						state.courts = state.courts.filter((court) => !matches_query(court, query));
						cb(null, before - state.courts.length);
					},
				},
			},
		};
		const btp_state = {
			courts: new Map(Array.from({ length: 17 }, (_, index) => {
				const btp_id = index + 2;
				return [btp_id, {
					ID: [btp_id],
					Name: ['Feld ' + (index + 1)],
					LocationID: [7],
					SortOrder: [index + 1],
				}];
			})),
		};
		const location_map = new Map([[7, 't1_main']]);

		btp_sync._integrate_courts(app, 't1', btp_state, new Map(), location_map, (err, scoring_formats, returned_location_map, court_map) => {
			assert.ifError(err);
			assert.strictEqual(scoring_formats instanceof Map, true);
			assert.strictEqual(returned_location_map, location_map);
			assert.strictEqual(court_map.get(2), 't1_1');
			assert.strictEqual(court_map.get(18), 't1_17');
			assert.deepStrictEqual(
				state.courts.map((court) => court.num).sort((a, b) => a - b),
				Array.from({ length: 17 }, (_, index) => index + 1)
			);
			assert.strictEqual(state.courts.some((court) => court._id === 't1_18'), false);
			assert.strictEqual(state.courts.find((court) => court._id === 't1_1').btp_id, 2);
			done();
		});
	});

	_it('keeps the largest BTP location on natural court numbers when another location has duplicates', (done) => {
		const state = { courts: [] };
		const matches_query = (doc, query) => Object.keys(query).every((key) => doc[key] === query[key]);
		const app = {
			db: {
				courts: {
					findOne(query, cb) {
						cb(null, state.courts.find((court) => matches_query(court, query)) || null);
					},
					find(query, cb) {
						cb(null, state.courts.filter((court) => matches_query(court, query)));
					},
					insert(doc, cb) {
						state.courts.push({ ...doc });
						cb(null, doc);
					},
					update(query, update, options, cb) {
						const court = state.courts.find((candidate) => matches_query(candidate, query));
						if (!court) return cb(null, 0);
						Object.assign(court, update.$set || {});
						cb(null, 1, court);
					},
					remove(query, options, cb) {
						const before = state.courts.length;
						state.courts = state.courts.filter((court) => !matches_query(court, query));
						cb(null, before - state.courts.length);
					},
				},
			},
		};
		const main_courts = Array.from({ length: 17 }, (_, index) => {
			const btp_id = index + 2;
			return [btp_id, {
				ID: [btp_id],
				Name: ['Feld ' + (index + 1)],
				LocationID: [7],
				SortOrder: [index + 1],
			}];
		});
		const btp_state = {
			courts: new Map([
				[1, { ID: [1], Name: ['Feld 1'], LocationID: [8], SortOrder: [1] }],
				...main_courts,
			]),
		};
		const location_map = new Map([[7, 't1_main'], [8, 't1_side']]);

		btp_sync._integrate_courts(app, 't1', btp_state, new Map(), location_map, (err, scoring_formats, returned_location_map, court_map) => {
			assert.ifError(err);
			assert.strictEqual(returned_location_map, location_map);
			assert.strictEqual(court_map.get(2), 't1_1');
			assert.strictEqual(state.courts.find((court) => court._id === 't1_1').btp_id, 2);
			assert.strictEqual(court_map.get(18), 't1_17');
			assert.strictEqual(court_map.get(1), 't1_18');
			assert.strictEqual(state.courts.find((court) => court._id === 't1_18').btp_id, 1);
			done();
		});
	});

	_it('keeps locally edited timing values when BTP scoring formats are normalized again', () => {
		const existing = {
			id: 11,
			name: 'Custom 1x17',
			numSets: 1,
			score: 17,
			isDefault: false,
			setType: 999,
			lastSetType: 999,
			set_points: {
				end_points: 17,
				max_points: 19,
				end_points_editable: false,
				max_points_editable: true,
				defaults_from_score: true,
				interval_at: 9,
				interval_duration_ms: 45000,
				break_before_set_duration_ms: 30000,
				interval_enabled: false,
			},
			last_set_points: {
				end_points: 17,
				max_points: 21,
				end_points_editable: false,
				max_points_editable: true,
				defaults_from_score: true,
				interval_at: 8,
				interval_duration_ms: 40000,
				break_before_set_duration_ms: 35000,
				interval_enabled: true,
			},
		};

		const normalized = btp_sync._normalize_scoring_format({
			ID: ['11'],
			Name: ['Custom 1x17'],
			NumSets: ['1'],
			SetType: ['999'],
			LastSetType: ['999'],
			Score: ['17'],
			IsDefault: [false],
		});

		const merged = btp_sync._merge_local_scoring_format(existing, normalized);

		assert.strictEqual(merged.set_points.end_points, 17);
		assert.strictEqual(merged.set_points.max_points, 19);
		assert.strictEqual(merged.set_points.interval_at, 9);
		assert.strictEqual(merged.set_points.interval_duration_ms, 45000);
		assert.strictEqual(merged.set_points.break_before_set_duration_ms, 30000);
		assert.strictEqual(merged.set_points.interval_enabled, false);
		assert.strictEqual(merged.last_set_points.max_points, 21);
		assert.strictEqual(merged.last_set_points.interval_at, 8);
		assert.strictEqual(merged.last_set_points.interval_duration_ms, 40000);
		assert.strictEqual(merged.last_set_points.break_before_set_duration_ms, 35000);
		assert.strictEqual(merged.last_set_points.interval_enabled, true);
	});

	_it('ignores stale suppressed officials once the local match is no longer pending BTP sync', () => {
		const currentMatch = {
			btp_needsync: false,
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				suppressed_umpire_btp_id: 6,
			},
		};
		const btpMatch = {
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				umpire: {
					_id: 'default_btp_6',
					btp_id: 6,
					name: 'Michael G-Punkt',
				},
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, structuredClone(btpMatch));

		assert.ok(merged.setup.umpire);
		assert.strictEqual(merged.setup.umpire.btp_id, 6);
		assert.strictEqual(merged.setup.suppressed_umpire_btp_id, undefined);
	});

	_it('keeps suppressed officials hidden while a local match update is still pending sync', () => {
		const currentMatch = {
			btp_needsync: true,
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				suppressed_umpire_btp_id: 6,
			},
		};
		const btpMatch = {
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				umpire: {
					_id: 'default_btp_6',
					btp_id: 6,
					name: 'Michael G-Punkt',
				},
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, structuredClone(btpMatch));

		assert.strictEqual(merged.setup.umpire, undefined);
		assert.strictEqual(merged.setup.suppressed_umpire_btp_id, 6);
	});

	_it('ignores stale suppressed service judges once the local match is no longer pending BTP sync', () => {
		const currentMatch = {
			btp_needsync: false,
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				suppressed_service_judge_btp_id: 7,
			},
		};
		const btpMatch = {
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				service_judge: {
					_id: 'default_btp_7',
					btp_id: 7,
					name: 'Service Judge',
				},
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, structuredClone(btpMatch));

		assert.ok(merged.setup.service_judge);
		assert.strictEqual(merged.setup.service_judge.btp_id, 7);
		assert.strictEqual(merged.setup.suppressed_service_judge_btp_id, undefined);
	});

	_it('does not restore role capability flags from match references during reconcile', (done) => {
		const official = {
			_id: 'o1',
			tournament_key: 't1',
			btp_id: 11,
			firstname: 'Stefan',
			surname: 'Schiedsrichter',
			name: 'Stefan Schiedsrichter',
			is_umpire: false,
			is_service_judge: true,
			is_planed_as_umpire: false,
			is_planed_as_service_judge: false,
			umpire_on_court: null,
			service_judge_on_court: null,
			umpire_wait: null,
			service_judge_wait: 123,
			umpire_pause: null,
			service_judge_pause: null,
			inactive_list: null,
		};
		const match = {
			_id: 'm1',
			tournament_key: 't1',
			setup: {
				now_on_court: false,
				umpire: {
					_id: 'o1',
					btp_id: 11,
					firstname: 'Stefan',
					surname: 'Schiedsrichter',
					name: 'Stefan Schiedsrichter',
				}
			}
		};
		const state = {
			matches: [structuredClone(match)],
			umpires: [structuredClone(official)]
		};
		const app = {
			db: {
				tournaments: {
					findOne(query, cb) {
						cb(null, { key: 't1', btp_settings: { check_in_per_match: false } });
					}
				},
				matches: {
					find(query, cb) {
						cb(null, state.matches);
					}
				},
				umpires: {
					find(query, cb) {
						cb(null, state.umpires);
					},
					insert(doc, cb) {
						state.umpires.push(doc);
						cb(null, doc);
					},
					update(query, update, options, cb) {
						const idx = state.umpires.findIndex((u) => u._id === query._id);
						state.umpires[idx] = { ...state.umpires[idx], ...update.$set };
						cb(null, 1, state.umpires[idx]);
					}
				}
			}
		};

		btp_sync._reconcile_match_officials(app, 't1', (err) => {
			assert.ifError(err);
			assert.strictEqual(state.umpires[0].is_umpire, false);
			assert.strictEqual(state.umpires[0].is_service_judge, true);
			done();
		});
	});

	_it('keeps a local umpire assignment only while the match update is still pending sync', () => {
		const pendingCurrentMatch = {
			btp_needsync: true,
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				umpire: {
					_id: 'default_btp_6',
					btp_id: 6,
					name: 'Michael G-Punkt',
				},
			},
		};
		const staleCurrentMatch = {
			btp_needsync: false,
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
				umpire: {
					_id: 'default_btp_6',
					btp_id: 6,
					name: 'Michael G-Punkt',
				},
			},
		};
		const btpMatchWithoutOfficial = {
			setup: {
				state: 'scheduled',
				teams: [{ players: [] }, { players: [] }],
			},
		};

		const pendingMerged = btp_sync._merge_local_match_into_btp_match(pendingCurrentMatch, structuredClone(btpMatchWithoutOfficial));
		const staleMerged = btp_sync._merge_local_match_into_btp_match(staleCurrentMatch, structuredClone(btpMatchWithoutOfficial));

		assert.ok(pendingMerged.setup.umpire);
		assert.strictEqual(staleMerged.setup.umpire, undefined);
	});

	_it('keeps local preparation state across sync even when the highlight is zero', () => {
		const currentMatch = {
			btp_needsync: false,
			setup: {
				state: 'preparation',
				highlight: 0,
				preparation_call_timestamp: 1775701859486,
				teams: [{ players: [] }, { players: [] }],
			},
		};
		const btpMatch = {
			setup: {
				state: 'scheduled',
				highlight: 0,
				teams: [{ players: [] }, { players: [] }],
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, structuredClone(btpMatch));

		assert.strictEqual(merged.setup.state, 'preparation');
		assert.strictEqual(merged.setup.preparation_call_timestamp, 1775701859486);
	});

	_it('clears stale planned and on-court flags when an official is no longer referenced by matches', () => {
		const refState = btp_sync._build_official_reference_state([]);
		const patch = btp_sync._compute_official_visibility_patch({
			_id: 'default_btp_6',
			btp_id: 6,
			is_umpire: true,
			is_service_judge: true,
			is_planed_as_umpire: true,
			is_planed_as_service_judge: false,
			umpire_on_court: 'default_1',
			service_judge_on_court: null,
			umpire_wait: null,
			service_judge_wait: null,
			umpire_pause: null,
			service_judge_pause: null,
			inactive_list: null,
		}, refState);

		assert.strictEqual(patch.is_planed_as_umpire, false);
		assert.strictEqual(patch.umpire_on_court, null);
		assert.strictEqual(patch.umpire_wait != null, true);
		assert.strictEqual(patch.service_judge_wait, null);
		assert.strictEqual(patch.inactive_list, null);
	});

	_it('moves inactive officials back to wait when they are active-capable and no longer referenced', () => {
		const refState = btp_sync._build_official_reference_state([]);
		const patch = btp_sync._compute_official_visibility_patch({
			_id: 'default_btp_6',
			btp_id: 6,
			is_umpire: true,
			is_service_judge: false,
			is_planed_as_umpire: false,
			is_planed_as_service_judge: false,
			umpire_on_court: null,
			service_judge_on_court: null,
			umpire_wait: null,
			service_judge_wait: null,
			umpire_pause: null,
			service_judge_pause: null,
			inactive_list: 12345,
		}, refState);

		assert.strictEqual(patch.umpire_wait != null, true);
		assert.strictEqual(patch.service_judge_wait, null);
		assert.strictEqual(patch.inactive_list, null);
	});

	_it('preserves planned flags when an official is still referenced by a scheduled match', () => {
		const refState = btp_sync._build_official_reference_state([{
			setup: {
				state: 'scheduled',
				now_on_court: false,
				umpire: { _id: 'default_btp_6', btp_id: 6 },
			},
		}]);
		const patch = btp_sync._compute_official_visibility_patch({
			_id: 'default_btp_6',
			btp_id: 6,
			is_planed_as_umpire: true,
			is_planed_as_service_judge: false,
			umpire_on_court: null,
			service_judge_on_court: null,
			umpire_wait: null,
			service_judge_wait: null,
			umpire_pause: null,
			service_judge_pause: null,
			inactive_list: null,
		}, refState);

		assert.deepStrictEqual(patch, {});
	});

	_it('does not treat finished-match officials as still referenced for visibility', () => {
		const refState = btp_sync._build_official_reference_state([{
			team1_won: true,
			setup: {
				state: 'finished',
				now_on_court: false,
				umpire: { _id: 'default_btp_5', btp_id: 5 },
			},
		}]);
		const patch = btp_sync._compute_official_visibility_patch({
			_id: 'default_btp_5',
			btp_id: 5,
			is_umpire: true,
			is_service_judge: true,
			is_planed_as_umpire: false,
			is_planed_as_service_judge: false,
			umpire_on_court: null,
			service_judge_on_court: null,
			umpire_wait: null,
			service_judge_wait: null,
			umpire_pause: null,
			service_judge_pause: null,
			inactive_list: 12345,
		}, refState);

		assert.strictEqual(patch.umpire_wait != null, true);
		assert.strictEqual(patch.service_judge_wait, null);
		assert.strictEqual(patch.inactive_list, null);
	});

	_it('reuses an existing official by canonical _id when btp_id is missing locally', () => {
		const existing = {
			_id: 'default_btp_6',
			tournament_key: 'default',
			btp_id: null,
			name: 'Michael G-Punkt',
		};

		const found = btp_sync._find_existing_official_for_btp_import([existing], 'default', 6);

		assert.strictEqual(found, existing);
	});

	_it('does not crash when BTP player positions do not exist in the local match teams', (done) => {
		const localPlayer = {
			_id: 'p1',
			btp_id: 101,
			checked_in: false,
			now_tablet_on_court: false,
			now_playing_on_court: false,
		};
		const localMatch = {
			_id: 'm1',
			tournament_key: 't1',
			btp_id: 't1_HE_1',
			setup: {
				teams: [
					{ players: [localPlayer] },
					{ players: [] },
				],
			},
		};
		const btpState = {
			draws: new Map([
				['10', { EventID: ['20'], Name: ['HE'] }],
			]),
			events: new Map([
				['20', { Name: ['HE'] }],
			]),
			matches: [{
				ID: ['1'],
				DrawID: ['10'],
				bts_players: [
					[
						{ ID: [101], CheckedIn: [false] },
						{ ID: [102], CheckedIn: [false] },
					],
					[],
				],
			}],
		};
		const app = {
			db: {
				tournaments: {
					findOne(query, cb) {
						cb(null, {
							key: 't1',
							btp_settings: {
								check_in_per_match: false,
								pause_duration_ms: 0,
							},
						});
					},
				},
				matches: {
					findOne(query, cb) {
						assert.deepStrictEqual(query, {
							btp_id: 't1_HE_1',
							tournament_key: 't1',
						});
						cb(null, localMatch);
					},
				},
			},
		};

		btp_sync._integrate_player_state(app, 't1', btpState, (err) => {
			assert.ifError(err);
			assert.strictEqual(localPlayer.checked_in, true);
			assert.strictEqual(btpState.matches[0].bts_players[0][0].CheckedIn[0], true);
			assert.strictEqual(btpState.matches[0].bts_players[0][1].CheckedIn[0], false);
			done();
		});
	});

	_it('copies checked-in state by BTP id instead of player position', () => {
		const targetSetup = {
			teams: [
				{
					players: [
						{ btp_id: 101, checked_in: false },
						{ btp_id: 102, checked_in: false },
					],
				},
			],
		};
		const sourceSetup = {
			teams: [
				{
					players: [
						{ btp_id: 102, checked_in: true },
						{ btp_id: 101, checked_in: false },
					],
				},
			],
		};

		btp_sync._copy_checked_in_by_btp_id(targetSetup, sourceSetup);

		assert.strictEqual(targetSetup.teams[0].players[0].checked_in, false);
		assert.strictEqual(targetSetup.teams[0].players[1].checked_in, true);
	});

	_it('keeps player birth date information from BTP', () => {
		const team = btp_sync._craft_team([{
			ID: [101],
			Firstname: ['Ada'],
			Lastname: ['Lovelace'],
			Asianname: [false],
			DateOfBirth: [{
				year: 2016,
				month: 12,
				day: 10,
			}],
		}]);

		assert.strictEqual(team.players[0].birth_year, 2016);
		assert.strictEqual(team.players[0].date_of_birth, '2016-12-10');
	});

	_it('detects player assignment changes independent from check-in state', () => {
		const previousSetup = {
			teams: [
				{ players: [{ btp_id: 101 }, { btp_id: 102 }] },
				{ players: [{ btp_id: 201 }] },
			],
		};
		const sameSetup = {
			teams: [
				{ players: [{ btp_id: 101 }, { btp_id: 102 }] },
				{ players: [{ btp_id: 201 }] },
			],
		};
		const changedSetup = {
			teams: [
				{ players: [{ btp_id: 101 }, { btp_id: 103 }] },
				{ players: [{ btp_id: 201 }] },
			],
		};

		assert.strictEqual(btp_sync._setup_player_assignment_changed(previousSetup, sameSetup), false);
		assert.strictEqual(btp_sync._setup_player_assignment_changed(previousSetup, changedSetup), true);
	});

	_it('only treats player assignment changes as now-on-court changes for active matches', () => {
		assert.strictEqual(btp_sync._player_assignment_change_affects_now_on_court_state(
			{ setup: { now_on_court: false } },
			{ setup: { now_on_court: false } }
		), false);
		assert.strictEqual(btp_sync._player_assignment_change_affects_now_on_court_state(
			{ setup: { now_on_court: true } },
			{ setup: { now_on_court: false } }
		), true);
		assert.strictEqual(btp_sync._player_assignment_change_affects_now_on_court_state(
			{ setup: { now_on_court: false } },
			{ setup: { now_on_court: true } }
		), true);
	});

	_it('recognizes when BTP has already accepted a pending local walkover sync', () => {
		const localMatch = {
			btp_needsync: true,
			score_status: 'walkover',
			team1_won: true,
			btp_winner: 1,
		};
		const btpMatch = {
			Winner: [1],
			ScoreStatus: [1],
		};

		assert.strictEqual(btp_sync._btp_match_confirms_pending_local_sync(localMatch, btpMatch), true);
	});

	_it('does not confirm pending local sync when BTP still has a different special result', () => {
		const localMatch = {
			btp_needsync: true,
			score_status: 'walkover',
			team1_won: true,
			btp_winner: 1,
		};
		const btpMatch = {
			Winner: [2],
			ScoreStatus: [1],
		};

		assert.strictEqual(btp_sync._btp_match_confirms_pending_local_sync(localMatch, btpMatch), false);
	});

	_it('keeps local preparation location when merging a BTP match without court information', () => {
		const currentMatch = {
			setup: {
				state: 'preparation',
				now_on_court: false,
				highlight: 1,
				location_id: 'location-1',
				preparation_call_timestamp: 1234567890,
			},
		};
		const btpMatch = {
			setup: {
				state: 'scheduled',
				now_on_court: false,
			},
		};

		const merged = btp_sync._merge_local_match_into_btp_match(currentMatch, btpMatch);

		assert.strictEqual(merged.setup.state, 'preparation');
		assert.strictEqual(merged.setup.location_id, 'location-1');
		assert.strictEqual(merged.setup.highlight, 1);
		assert.strictEqual(merged.setup.preparation_call_timestamp, 1234567890);
	});

	_it('clears pending local BTP sync when an imported BTP walkover confirms it', async () => {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});
		await insert(db, 'matches', {
			_id: 'btp_default_MX U17_90',
			tournament_key: 'default',
			btp_id: 'default_MX U17_90',
			btp_match_ids: [{ id: 90, draw: 10, planning: 100 }],
			btp_needsync: true,
			score_status: 'walkover',
			btp_score_status: 1,
			team1_won: true,
			btp_winner: 1,
			forward_loser: false,
			setup: {
				state: 'finished',
				now_on_court: false,
				teams: [{ players: [{ btp_id: 1 }] }, { players: [{ btp_id: 2 }] }],
			},
		});
		const btpState = {
			matches: [{
				ID: [90],
				DrawID: [10],
				PlanningID: [100],
				From1: [1],
				From2: [2],
				IsMatch: [true],
				MatchNr: [1],
				Highlight: [0],
				Status: 0,
				Winner: [1],
				ScoreStatus: [1],
				bts_complete: true,
				bts_players: [[{ ID: [1] }], [{ ID: [2] }]],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MX U17'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MX U17'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		const updated = await db.matches.findOne_async({ _id: 'btp_default_MX U17_90' });
		assert.strictEqual(updated.btp_needsync, false);
	});

	_it('restores a cascaded no-match successor when BTP clears the source special result', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
			no_match_cascade_announcements_enabled: false,
		});
		await insert(db, 'matches', {
			_id: 'source',
			tournament_key: 'default',
			btp_id: 'default_JE U17_44',
			btp_match_ids: [{ id: 44, draw: 10, planning: 100 }],
			btp_needsync: false,
			score_status: 'walkover',
			btp_score_status: 1,
			team1_won: true,
			btp_winner: 1,
			forward_loser: false,
			setup: {
				is_match: true,
				event_name: 'JE U17',
				state: 'finished',
				now_on_court: false,
				match_num: 44,
				teams: [{ players: [{ btp_id: 1 }] }, { players: [{ btp_id: 2 }] }],
			},
		});
		await insert(db, 'matches', {
			_id: 'successor',
			tournament_key: 'default',
			btp_id: 'default_JE U17_106',
			btp_match_ids: [{ id: 106, draw: 10, planning: 200 }],
			btp_needsync: true,
			score_status: 'no_match',
			btp_score_status: 4,
			no_match_losing_team: 0,
			team1_won: false,
			btp_winner: 2,
			forward_loser: true,
			no_match_cascade_source_match_id: 'source',
			no_match_cascade_affected_btp_ids: ['2'],
			no_match_cascade_original_setup: {
				is_match: true,
				event_name: 'JE U17',
				state: 'scheduled',
				now_on_court: false,
				match_num: 106,
				teams: [{ players: [{ btp_id: 2 }] }, { players: [{ btp_id: 3 }] }],
			},
			setup: {
				is_match: true,
				event_name: 'JE U17',
				state: 'scheduled',
				now_on_court: false,
				match_num: 106,
				teams: [{ players: [{ btp_id: 2 }] }, { players: [{ btp_id: 3 }] }],
			},
		});

		const btpState = {
			matches: [{
				ID: [44],
				DrawID: [10],
				PlanningID: [100],
				From1: [1],
				From2: [2],
				IsMatch: [true],
				MatchNr: [44],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				bts_players: [[{ ID: [1] }], [{ ID: [2] }]],
			}, {
				ID: [106],
				DrawID: [10],
				PlanningID: [200],
				From1: [2],
				From2: [3],
				IsMatch: [true],
				MatchNr: [106],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				bts_players: [[{ ID: [2] }], [{ ID: [3] }]],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['JE U17'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['JE U17'], GameTypeID: [1] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};
		const pushed = [];
		const originalUpdateScore = btp_manager.update_score;
		btp_manager.update_score = (_app, match) => pushed.push(match._id);
		try {
			await new Promise((resolve, reject) => {
				btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		} finally {
			btp_manager.update_score = originalUpdateScore;
		}

		const source = await db.matches.findOne_async({ _id: 'source' });
		assert.strictEqual(source.score_status, 'normal');
		assert.strictEqual(source.team1_won, undefined);
		assert.strictEqual(source.btp_winner, undefined);
		assert.strictEqual(source.setup.state, 'unscheduled');

		const successor = await db.matches.findOne_async({ _id: 'successor' });
		assert.strictEqual(successor.score_status, 'normal');
		assert.strictEqual(successor.team1_won, undefined);
		assert.strictEqual(successor.btp_winner, undefined);
		assert.strictEqual(successor.no_match_cascade_source_match_id, undefined);
		assert.strictEqual(successor.btp_needsync, true);
		assert.deepStrictEqual(pushed, ['successor']);
	});

	_it('restores a cascaded successor when BTP replaces a local retired result with a normal score', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
			no_match_cascade_announcements_enabled: false,
		});
		await insert(db, 'matches', {
			_id: 'source',
			tournament_key: 'default',
			btp_id: 'default_MD U17_44',
			btp_match_ids: [{ id: 44, draw: 10, planning: 100 }],
			btp_needsync: false,
			score_status: 'retired',
			btp_score_status: 2,
			score_status_network_score: [[21, 19], [23, 21]],
			team1_won: true,
			btp_winner: 1,
			forward_loser: true,
			setup: {
				is_match: true,
				event_name: 'MD U17',
				state: 'finished',
				now_on_court: false,
				match_num: 44,
				teams: [
					{ players: [{ btp_id: 1, name: 'Aditri Reddy Kotla' }, { btp_id: 2, name: 'Alina Lin' }] },
					{ players: [{ btp_id: 3, name: 'Lenie Kison' }, { btp_id: 4, name: 'Lea-Sophie Mews' }] },
				],
			},
		});
		await insert(db, 'matches', {
			_id: 'successor',
			tournament_key: 'default',
			btp_id: 'default_MD U17_106',
			btp_match_ids: [{ id: 106, draw: 10, planning: 200 }],
			btp_needsync: true,
			score_status: 'no_match',
			btp_score_status: 4,
			no_match_losing_team: 0,
			team1_won: false,
			btp_winner: 2,
			forward_loser: true,
			no_match_cascade_source_match_id: 'source',
			no_match_cascade_affected_btp_ids: ['3', '4'],
			no_match_cascade_original_setup: {
				is_match: true,
				event_name: 'MD U17',
				state: 'scheduled',
				now_on_court: false,
				match_num: 106,
				teams: [
					{ players: [{ btp_id: 3, name: 'Lenie Kison' }, { btp_id: 4, name: 'Lea-Sophie Mews' }] },
					{ players: [{ btp_id: 5, name: 'Anya Kamboj' }, { btp_id: 6, name: 'Pauline Rohmel' }] },
				],
			},
			setup: {
				is_match: true,
				event_name: 'MD U17',
				state: 'scheduled',
				now_on_court: false,
				match_num: 106,
				teams: [
					{ players: [{ btp_id: 3, name: 'Lenie Kison' }, { btp_id: 4, name: 'Lea-Sophie Mews' }] },
					{ players: [{ btp_id: 5, name: 'Anya Kamboj' }, { btp_id: 6, name: 'Pauline Rohmel' }] },
				],
			},
		});

		const btpState = {
			matches: [{
				ID: [44],
				DrawID: [10],
				PlanningID: [100],
				From1: [1],
				From2: [2],
				IsMatch: [true],
				MatchNr: [44],
				Highlight: [0],
				Status: 0,
				Winner: [1],
				ScoreStatus: [0],
				ForwardLoser: [true],
				Sets: [{
					Set: [
						{ T1: [21], T2: [19] },
						{ T1: [23], T2: [21] },
					],
				}],
				bts_complete: true,
				bts_players: [[{ ID: [1] }, { ID: [2] }], [{ ID: [3] }, { ID: [4] }]],
			}, {
				ID: [106],
				DrawID: [10],
				PlanningID: [200],
				From1: [3],
				From2: [5],
				IsMatch: [true],
				MatchNr: [106],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				bts_players: [[{ ID: [3] }, { ID: [4] }], [{ ID: [5] }, { ID: [6] }]],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MD U17'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MD U17'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};
		const pushed = [];
		const originalUpdateScore = btp_manager.update_score;
		btp_manager.update_score = (_app, match) => pushed.push(match._id);
		try {
			await new Promise((resolve, reject) => {
				btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		} finally {
			btp_manager.update_score = originalUpdateScore;
		}

		const source = await db.matches.findOne_async({ _id: 'source' });
		assert.strictEqual(source.score_status, 'normal');
		assert.strictEqual(source.btp_score_status, 0);
		assert.strictEqual(source.forward_loser, false);
		assert.strictEqual(source.score_status_network_score, undefined);
		assert.strictEqual(source.team1_won, true);
		assert.strictEqual(source.btp_winner, 1);
		assert.deepStrictEqual(source.network_score, [[21, 19], [23, 21]]);

		const successor = await db.matches.findOne_async({ _id: 'successor' });
		assert.strictEqual(successor.score_status, 'normal');
		assert.strictEqual(successor.team1_won, undefined);
		assert.strictEqual(successor.btp_winner, undefined);
		assert.strictEqual(successor.no_match_cascade_source_match_id, undefined);
		assert.deepStrictEqual(pushed, ['successor']);
	});

	_it('does not signature-skip a stale local retired status after BTP already supplied the normal score', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
			no_match_cascade_announcements_enabled: false,
		});
		const btpState = {
			matches: [{
				ID: [44],
				DrawID: [10],
				PlanningID: [100],
				From1: [1],
				From2: [2],
				IsMatch: [true],
				MatchNr: [44],
				Highlight: [0],
				Status: 0,
				Winner: [1],
				ScoreStatus: [0],
				ForwardLoser: [true],
				Sets: [{
					Set: [
						{ T1: [21], T2: [19] },
						{ T1: [23], T2: [21] },
					],
				}],
				bts_complete: true,
				bts_players: [[{ ID: [1] }, { ID: [2] }], [{ ID: [3] }, { ID: [4] }]],
			}, {
				ID: [106],
				DrawID: [10],
				PlanningID: [200],
				From1: [3],
				From2: [5],
				IsMatch: [true],
				MatchNr: [106],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				bts_players: [[{ ID: [3] }, { ID: [4] }], [{ ID: [5] }, { ID: [6] }]],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MD U17'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MD U17'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
		const synced_source = await db.matches.findOne_async({ btp_id: 'default_MD U17_44' });
		assert.strictEqual(synced_source.score_status, 'normal');
		assert.ok(synced_source._btp_sync_signature);

		await db.matches.update_async(
			{ _id: synced_source._id },
			{
				$set: {
					score_status: 'retired',
					btp_score_status: 2,
					score_status_network_score: [[0, 0]],
					forward_loser: true,
				},
			},
			{}
		);
		await insert(db, 'matches', {
			_id: 'successor',
			tournament_key: 'default',
			btp_id: 'default_MD U17_106',
			btp_match_ids: [{ id: 106, draw: 10, planning: 200 }],
			btp_needsync: false,
			score_status: 'no_match',
			btp_score_status: 4,
			no_match_losing_team: 0,
			team1_won: false,
			btp_winner: 2,
			forward_loser: true,
			no_match_cascade_source_match_id: synced_source._id,
			no_match_cascade_affected_btp_ids: ['3', '4'],
			no_match_cascade_original_setup: {
				is_match: true,
				event_name: 'MD U17',
				state: 'scheduled',
				now_on_court: false,
				match_num: 106,
				teams: [
					{ players: [{ btp_id: 3, name: 'Lenie Kison' }, { btp_id: 4, name: 'Lea-Sophie Mews' }] },
					{ players: [{ btp_id: 5, name: 'Anya Kamboj' }, { btp_id: 6, name: 'Pauline Rohmel' }] },
				],
			},
			setup: {
				is_match: true,
				event_name: 'MD U17',
				state: 'scheduled',
				now_on_court: false,
				match_num: 106,
				teams: [
					{ players: [{ btp_id: 3, name: 'Lenie Kison' }, { btp_id: 4, name: 'Lea-Sophie Mews' }] },
					{ players: [{ btp_id: 5, name: 'Anya Kamboj' }, { btp_id: 6, name: 'Pauline Rohmel' }] },
				],
			},
		});

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		const source = await db.matches.findOne_async({ _id: synced_source._id });
		assert.strictEqual(source.score_status, 'normal');
		assert.strictEqual(source.btp_score_status, 0);
		assert.strictEqual(source.score_status_network_score, undefined);
		assert.strictEqual(source.forward_loser, false);

		const successor = await db.matches.findOne_async({ _id: 'successor' });
		assert.strictEqual(successor.score_status, 'normal');
		assert.strictEqual(successor.no_match_cascade_source_match_id, undefined);

		await db.matches.update_async(
			{ _id: synced_source._id },
			{ $set: { score_status: 'normal', forward_loser: true } },
			{}
		);
		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		const cleaned_source = await db.matches.findOne_async({ _id: synced_source._id });
		assert.strictEqual(cleaned_source.score_status, 'normal');
		assert.strictEqual(cleaned_source.forward_loser, false);
	});

	_it('clears a stale local normal result when BTP no longer has a result', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});
		await insert(db, 'matches', {
			_id: 'source',
			tournament_key: 'default',
			btp_id: 'default_MD U17_44',
			btp_match_ids: [{ id: 44, draw: 10, planning: 100 }],
			btp_needsync: false,
			score_status: 'normal',
			btp_score_status: 0,
			team1_won: true,
			btp_winner: 1,
			network_score: [[21, 19], [23, 21]],
			end_ts: 12345,
			setup: {
				is_match: true,
				event_name: 'MD U17',
				state: 'finished',
				now_on_court: false,
				court_id: 'old-court',
				called_timestamp: 12300,
				match_num: 44,
				teams: [
					{ players: [{ btp_id: 1, name: 'Aditri Reddy Kotla' }, { btp_id: 2, name: 'Alina Lin' }] },
					{ players: [{ btp_id: 3, name: 'Lenie Kison' }, { btp_id: 4, name: 'Lea-Sophie Mews' }] },
				],
			},
		});

		const btpState = {
			matches: [{
				ID: [44],
				DrawID: [10],
				PlanningID: [100],
				From1: [1],
				From2: [2],
				IsMatch: [true],
				MatchNr: [44],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				bts_players: [[{ ID: [1] }, { ID: [2] }], [{ ID: [3] }, { ID: [4] }]],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MD U17'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MD U17'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		const source = await db.matches.findOne_async({ _id: 'source' });
		assert.strictEqual(source.score_status, 'normal');
		assert.strictEqual(source.btp_score_status, 0);
		assert.strictEqual(source.forward_loser, false);
		assert.strictEqual(source.team1_won, undefined);
		assert.strictEqual(source.btp_winner, undefined);
		assert.strictEqual(source.network_score, undefined);
		assert.strictEqual(source.end_ts, undefined);
		assert.strictEqual(source.setup.state, 'unscheduled');
		assert.notStrictEqual(source.setup.now_on_court, true);
		assert.strictEqual(source.setup.court_id, undefined);
		assert.strictEqual(source.setup.called_timestamp, undefined);
	});

	_it('keeps a pending local normal result until BTP confirms it', async () => {
		const db = await database.init_test();
		const app = {
			db,
			wss: { clients: [] },
		};
		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Default',
			btp_settings: {},
		});
		await insert(db, 'matches', {
			_id: 'source',
			tournament_key: 'default',
			btp_id: 'default_MD U17_44',
			btp_match_ids: [{ id: 44, draw: 10, planning: 100 }],
			btp_needsync: true,
			score_status: 'normal',
			btp_score_status: 0,
			team1_won: true,
			btp_winner: 1,
			network_score: [[21, 19], [23, 21]],
			end_ts: 12345,
			setup: {
				is_match: true,
				event_name: 'MD U17',
				state: 'finished',
				now_on_court: false,
				match_num: 44,
				teams: [
					{ players: [{ btp_id: 1, name: 'Aditri Reddy Kotla' }, { btp_id: 2, name: 'Alina Lin' }] },
					{ players: [{ btp_id: 3, name: 'Lenie Kison' }, { btp_id: 4, name: 'Lea-Sophie Mews' }] },
				],
			},
		});

		const btpState = {
			matches: [{
				ID: [44],
				DrawID: [10],
				PlanningID: [100],
				From1: [1],
				From2: [2],
				IsMatch: [true],
				MatchNr: [44],
				Highlight: [0],
				Status: 0,
				bts_complete: true,
				bts_players: [[{ ID: [1] }, { ID: [2] }], [{ ID: [3] }, { ID: [4] }]],
			}],
			draws: new Map([[10, { ID: [10], EventID: [20], StageID: [30], Name: ['MD U17'], Position: [1] }]]),
			events: new Map([[20, { ID: [20], Name: ['MD U17'], GameTypeID: [2] }]]),
			stages: new Map([[30, { ID: [30], Name: ['Stage'], StageType: [1], DisplayOrder: [1] }]]),
			links: [],
			planning_nodes: new Map(),
			courts: new Map(),
			clubs: new Map(),
			districts: new Map(),
		};

		await new Promise((resolve, reject) => {
			btp_sync._integrate_matches(app, 'default', btpState, new Map(), new Map(), new Map(), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		const source = await db.matches.findOne_async({ _id: 'source' });
		assert.strictEqual(source.btp_needsync, true);
		assert.strictEqual(source.team1_won, true);
		assert.strictEqual(source.btp_winner, 1);
		assert.deepStrictEqual(source.network_score, [[21, 19], [23, 21]]);
		assert.strictEqual(source.setup.state, 'finished');
	});
});

_describe('BTP on-court reconciliation', () => {
	_it('batches all court assignments and skips unchanged courts and players', async () => {
		const db = await database.init_test();
		const app = { db };
		await insert(db, 'tournaments', { key: 'default' });
		const active = [
			{ _id: 'active-1', tournament_key: 'default', setup: {
				court_id: 'court-1', now_on_court: true, called_timestamp: 1, state: 'oncourt',
				teams: [{ players: [{ btp_id: 11 }] }], tabletoperators: [{ btp_id: 101 }],
			} },
			{ _id: 'active-2', tournament_key: 'default', setup: {
				court_id: 'court-2', now_on_court: true, called_timestamp: 1, state: 'oncourt',
				teams: [{ players: [{ btp_id: 21 }] }], tabletoperators: [{ btp_id: 201 }],
			} },
		];
		for (const match of active) await insert(db, 'matches', match);
		await insert(db, 'matches', { _id: 'shared', tournament_key: 'default', setup: {
			state: 'scheduled', teams: [{ players: [{ btp_id: 11 }, { btp_id: 201 }] }],
		} });
		await insert(db, 'courts', { _id: 'court-1', tournament_key: 'default', match_id: 'active-1' });
		await insert(db, 'courts', { _id: 'court-2', tournament_key: 'default', match_id: null });
		let match_reads = 0;
		let match_writes = 0;
		let court_writes = 0;
		let indexed_reads = 0;
		const find_related = db.model.find_matches_by_players;
		db.model.find_matches_by_players = (...args) => { indexed_reads++; return find_related(...args); };
		const find = db.matches.find.bind(db.matches);
		const find_async = db.matches.find_async.bind(db.matches);
		db.matches.find = (...args) => { match_reads++; return find(...args); };
		db.matches.find_async = (...args) => { match_reads++; return find_async(...args); };
		const update = db.matches.update.bind(db.matches);
		db.matches.update = (...args) => { match_writes++; return update(...args); };
		const update_court = db.courts.update.bind(db.courts);
		db.courts.update = (...args) => { court_writes++; return update_court(...args); };
		const run = () => new Promise((resolve, reject) => {
			btp_sync._integrate_now_on_court(app, 'default', err => err ? reject(err) : resolve());
		});
		await run();
		assert.strictEqual(match_reads, 1);
		assert.strictEqual(indexed_reads, 1);
		assert.strictEqual(match_writes, 1);
		assert.strictEqual(court_writes, 1);
		const shared = await db.matches.findOne_async({ _id: 'shared' });
		assert.strictEqual(shared.setup.teams[0].players[0].now_playing_on_court, 'court-1');
		assert.strictEqual(shared.setup.teams[0].players[1].now_tablet_on_court, 'court-2');
		assert.strictEqual(shared.setup.state, 'blocked');
		assert.strictEqual((await db.courts.findOne_async({ _id: 'court-2' })).match_id, 'active-2');
		await run();
		assert.strictEqual(match_reads, 2);
		assert.strictEqual(indexed_reads, 2);
		assert.strictEqual(match_writes, 1);
		assert.strictEqual(court_writes, 1);
	});

	_it('waits for newly called matches and propagates a failed call', async () => {
		const match_utils = require('../bts/match_utils');
		const db = await database.init_test();
		await insert(db, 'tournaments', { key: 'default' });
		await insert(db, 'matches', { _id: 'new', tournament_key: 'default', setup: {
			now_on_court: true, court_id: 'court-1', teams: [],
		} });
		let complete_call;
		let completed = false;
		const original_call = match_utils.call_match;
		try {
			const started = new Promise(resolve => {
				match_utils.call_match = (...args) => {
					complete_call = args[4];
					resolve();
				};
			});
			const operation = new Promise(resolve => {
				btp_sync._integrate_now_on_court({ db }, 'default', err => { completed = true; resolve(err); });
			});
			await started;
			assert.strictEqual(completed, false);
			const expected = new Error('cannot call match');
			complete_call(expected);
			assert.strictEqual(await operation, expected);
		} finally {
			match_utils.call_match = original_call;
		}
	});
});
