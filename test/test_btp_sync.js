'use strict';

const assert = require('assert');

const {_describe, _it} = require('./tutils.js');

const btp_sync = require('../bts/btp_sync');

_describe('btp_sync', () => {
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

	_it('drops stale local preparation state when the highlight is already cleared', () => {
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

		assert.strictEqual(merged.setup.state, 'scheduled');
		assert.strictEqual(merged.setup.preparation_call_timestamp, undefined);
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
	});
