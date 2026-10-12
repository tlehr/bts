'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const bupws_v2 = require('../bts/bupws_v2');
const database = require('../bts/database');

_describe('bupws v2 score resource scope', () => {
	_it('protects finish cleanup for numeric end timestamps without blocking unrelated courts', async () => {
		const queue = require('../bts/update_queue'), original = queue.execute_keyed;
		let locks;
		queue.execute_keyed = async (_key, task) => { locks = task._queue_locks; };
		try {
			await bupws_v2.handle_score_update({}, {}, { tournament_key: 'test', score: { match_id: 'one', court_id: 'court-one', end_ts: 12345 } });
			assert(locks.includes(queue.lock_keys.preparation('test')));
			assert(locks.includes(queue.lock_keys.tabletoperators('test')));
			assert(locks.includes(queue.lock_keys.umpires('test')));
			assert(locks.includes(queue.lock_keys.court('test', 'court-one')));
			assert(!queue.lock_keys.any_conflict(locks, queue.lock_keys.score_update('test', { match_id: 'other', court_id: 'court-two' })));
		} finally { queue.execute_keyed = original; }
	});
});

_describe('bupws v2 display state', () => {
	const called_timestamp = 1770000000000;
	const pick_side_timestamp = called_timestamp + 5000;

	function build_match(warmup, presses, match_overrides) {
		return {
			_id: 'match-1',
			presses: presses || [],
			...(match_overrides || {}),
			setup: {
				match_id: 'match-1',
				state: 'called',
				called_timestamp,
				counting: '3x21',
				warmup,
				warmup_start: 180,
				warmup_ready: 150,
				teams: [
					{ players: [{ firstname: 'Max', lastname: 'Mustermann', btp_id: 1 }] },
					{ players: [{ firstname: 'Erika', lastname: 'Beispiel', btp_id: 2 }] },
				],
			},
		};
	}

	function build_state(warmup, presses, match_overrides) {
		return bupws_v2.build_display_state_v2({}, {
			tournament: { key: 'default' },
			court: { _id: 'default_6', num: 6 },
			display: { client_id: 'display-1' },
			display_settings: { displaymode_style: 'tournamentcourt', d_show_pause: true },
			match: build_match(warmup, presses, match_overrides),
		});
	}

	function assert_timer(timer, expected) {
		assert(timer);
		Object.keys(expected).forEach((key) => {
			assert.strictEqual(timer[key], expected[key], key);
		});
	}

	_it('includes call-down warmup timer before the first tablet press', () => {
		const state = build_state('call-down');

		assert_timer(state.timers.active_timer, {
			start: called_timestamp,
			duration: 180000,
			exigent: 30499,
			upwards: false,
			restart: false,
		});
	});

	_it('includes call-up warmup timer before the first tablet press', () => {
		const state = build_state('call-up');

		assert_timer(state.timers.active_timer, {
			start: called_timestamp,
			duration: undefined,
			exigent: undefined,
			upwards: true,
			restart: false,
		});
	});

	_it('hides call-down warmup timer after the first network score without press history', () => {
		const state = build_state('call-down', [], {
			network_score: [[1, 0]],
		});

		assert.strictEqual(state.timers.active_timer, null);
	});

	_it('includes interval pause timer after the interval point', () => {
		const presses = [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
			{ type: 'love-all', timestamp: pick_side_timestamp + 1000 },
		];
		for (let idx = 0; idx < 11; idx += 1) {
			presses.push({ type: 'score', side: 'left', timestamp: pick_side_timestamp + 2000 + idx * 1000 });
		}

		const state = build_state('none', presses, {
			network_score: [[11, 0]],
		});

		assert_timer(state.timers.active_timer, {
			start: pick_side_timestamp + 12000,
			duration: 60000,
			exigent: 25000,
			upwards: false,
			restart: false,
		});

		const update = bupws_v2.build_display_timer_update_v2({}, {
			court: { _id: 'default_6', num: 6 },
			match: build_match('none', presses, {
				network_score: [[11, 0]],
			}),
		});
		assert_timer(update.timers.active_timer, {
			start: pick_side_timestamp + 12000,
			duration: 60000,
			exigent: 25000,
			upwards: false,
			restart: false,
		});
	});

	_it('does not build a timer for a finished match with tablet press history', () => {
		const state = build_state('call-down', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
			{ type: 'pick_server', timestamp: pick_side_timestamp + 1000, team_id: 0, player_id: 0 },
			{ type: 'pick_receiver', timestamp: pick_side_timestamp + 2000, team_id: 1, player_id: 0 },
			{ type: 'love-all', timestamp: pick_side_timestamp + 3000 },
			{ type: 'score', side: 'left', timestamp: pick_side_timestamp + 4000 },
			{ type: 'postgame-confirm', timestamp: pick_side_timestamp + 5000 },
			{ type: 'postmatch-confirm', timestamp: pick_side_timestamp + 6000 },
		], {
			team1_won: true,
			end_ts: pick_side_timestamp + 6000,
			network_score: [[21, 5], [21, 7]],
			duration_ms: 123000,
		});

		assert.strictEqual(state.timers.active_timer, null);
	});

	_it('does not build a timer for a match with confirmed end timestamp', () => {
		const state = build_state('call-down', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
			{ type: 'love-all', timestamp: pick_side_timestamp + 1000 },
			{ type: 'score', side: 'left', timestamp: pick_side_timestamp + 2000 },
			{ type: 'postmatch-confirm', timestamp: pick_side_timestamp + 3000 },
		], {
			end_ts: pick_side_timestamp + 3000,
			network_score: [[21, 5], [20, 22]],
		});

		assert.strictEqual(state.timers.active_timer, null);
	});

	_it('starts choise warmup timer after side selection', () => {
		const without_pick_side = build_state('choise');
		assert.strictEqual(without_pick_side.timers.active_timer, null);

		const state = build_state('choise', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert_timer(state.timers.active_timer, {
			start: pick_side_timestamp,
			duration: 180000,
			exigent: 30499,
			upwards: false,
			restart: true,
		});
	});

	_it('starts bwf-2016 warmup timer after side selection', () => {
		const without_pick_side = build_state('bwf-2016');
		assert.strictEqual(without_pick_side.timers.active_timer, null);

		const state = build_state('bwf-2016', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert_timer(state.timers.active_timer, {
			start: pick_side_timestamp,
			duration: 120000,
			exigent: 30499,
			upwards: false,
			restart: true,
		});
	});

	_it('starts legacy warmup timer after side selection', () => {
		const without_pick_side = build_state('legacy');
		assert.strictEqual(without_pick_side.timers.active_timer, null);

		const state = build_state('legacy', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert_timer(state.timers.active_timer, {
			start: pick_side_timestamp,
			duration: 120000,
			exigent: 5499,
			upwards: false,
			restart: true,
		});
	});

	_it('does not expose a timer for warmup mode none', () => {
		const state = build_state('none', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert.strictEqual(state.timers.active_timer, null);
	});
});

_describe('bupws v2 score fanout', () => {
	async function fixture() {
		const db = await database.init_test();
		const insert = (table, doc) => new Promise((resolve, reject) => {
			db[table].insert(doc, err => err ? reject(err) : resolve());
		});
		await insert('tournaments', { key: 'fanout-test', bupws_v2_enabled: true });
		await insert('courts', { _id: 'court-1', tournament_key: 'fanout-test', match_id: 'match-1', num: 1 });
		await insert('matches', {
			_id: 'match-1', tournament_key: 'fanout-test', network_score: [[1, 0]], presses: [],
			setup: { match_id: 'match-1', court_id: 'court-1', now_on_court: true, state: 'oncourt',
				counting: '3x21', warmup: 'none', teams: [{ players: [] }, { players: [] }],
			},
		});
		const app = { db };
		const panels = [];
		const panel = (client_id) => {
			const ws = {
				readyState: 1, client_id, hostname: client_id, messages: [],
				send(raw) { this.messages.push(JSON.parse(raw)); if (this.on_payload) this.on_payload(); },
				sendmsg(payload) { this.messages.push(payload); },
			};
			bupws_v2.on_connect(app, ws);
			ws.last_tournament_key = 'fanout-test';
			ws.court_id = 'court-1';
			ws.last_v2_match_id = 'match-1';
			panels.push(ws);
			return ws;
		};
		return { app, panel, cleanup() { panels.forEach(ws => bupws_v2.on_close(app, ws)); } };
	}

	function wait_for_points(panels) {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('TV updates waited for a blocked refresh')), 1000);
			const check = () => {
				if (panels.every(ws => ws.messages.some(msg => msg.type === 'display_points_update'))) {
					clearTimeout(timeout);
					resolve();
				}
			};
			panels.forEach(ws => { ws.on_payload = check; });
		});
	}

	_it('uses current rally settings for scores without reading the tournament registration payload', async () => {
		const { app, panel, cleanup } = await fixture();
		const tablet = panel('score-tablet');
		tablet.panel_devicemode = 'umpire';
		await app.db.matches.update_async({ _id: 'match-1' }, { $set: {
			'setup.scoring_format': { numSets: 3,
				set_points: { end_points: 21, max_points: 30 },
				last_set_points: { end_points: 21, max_points: 30 },
			},
		} }, {});
		await app.db.tournaments.update_async({ key: 'fanout-test' }, { $set: {
			preparation_successor_rally_count: 1,
		} }, {});
		// Reading events in this path would both waste work and fail this test.
		const tournament = app.db.tournaments.getAllData()[0];
		Object.defineProperty(tournament, 'events', { enumerable: true, configurable: true,
			get() { throw new Error('score update read registration payload'); },
		});
		const send_score = score => bupws_v2.handle_score_update(app, tablet, {
			tournament_key: 'fanout-test', score: {
				match_id: 'match-1', court_id: 'court-1', network_score: score, presses: [],
			},
		});
		const find_tournament = app.db.tournaments.findOne_async;
		const read_score_context = app.db.model.read_score_context_part;
		try {
			delete app.db.tournaments.findOne_async;
			await send_score([[21, 18], [19, 15]]);
			app.db.tournaments.findOne_async = find_tournament;
			let match = await app.db.matches.findOne_async({ _id: 'match-1' });
			assert.deepStrictEqual(match.network_score, [[21, 18], [19, 15]]);
			assert.strictEqual(match.setup.needs_preparation_successor, false);
			delete tournament.events;
			await app.db.tournaments.update_async({ key: 'fanout-test' }, { $set: { preparation_successor_rally_count: 3 } }, {});
			// Partial/fake datastores retain the previous ordered query path.
			delete app.db.model.read_score_context_part;
			await send_score([[21, 18], [19, 16]]);
			match = await app.db.matches.findOne_async({ _id: 'match-1' });
			assert.strictEqual(match.setup.needs_preparation_successor, true);
			assert(!tablet.messages.some(msg => msg.type === 'error'));
		} finally {
			app.db.tournaments.findOne_async = find_tournament;
			app.db.model.read_score_context_part = read_score_context;
			cleanup();
		}
	});

	_it('sends single and multi-court TV updates while a tablet refresh is blocked', async () => {
		const { app, panel, cleanup } = await fixture();
		const tablet = panel('slow-tablet');
		tablet.panel_devicemode = 'umpire';
		let release;
		tablet.hostname = new Promise(resolve => { release = resolve; });
		const single = panel('single-tv');
		const multi = panel('multi-tv');
		multi.v2_multi_court_display = true;
		multi.last_v2_match_ids_by_court.set('court-1', 'match-1');
		let reads = 0;
		const read_context = app.db.model.read_display_context_part;
		app.db.model.read_display_context_part = (part, ...args) => {
			if (part === 'court') reads++;
			return read_context(part, ...args);
		};
		let completed = false;
		const delivered = wait_for_points([single, multi]);
		const operation = bupws_v2.handle_score_change(app, 'fanout-test', 'court-1').then(() => { completed = true; });
		try {
			await delivered;
			assert.strictEqual(completed, false);
			assert.strictEqual(tablet.messages.length, 0);
			assert.strictEqual(reads, 1);
		} finally {
			release('slow-tablet');
			await operation;
			cleanup();
		}
		assert.strictEqual(completed, true);
		assert(tablet.messages.length > 0);
	});

	_it('refreshes TVs and tablets with current presentation settings without copying registration data', async () => {
		const { app, panel, cleanup } = await fixture();
		await app.db.tournaments.update_async({ key: 'fanout-test' }, { $set: {
			name: 'Test tournament', language: 'de', logo_id: 'test-logo',
			logo_background_color: '#112233', logo_foreground_color: '#445566',
			bup_v2_admin_wait_for_score_updates: true,
		} }, {});
		await require('../bts/displaysettings_defaults').ensure_default_displaysettings(app,
			await app.db.tournaments.findOne_async({ key: 'fanout-test' }));
		const tablet = panel('projected-tablet');
		tablet.panel_devicemode = 'umpire';
		const single = panel('projected-tv');
		const multi = panel('projected-multi');
		for (const ws of [tablet, single, multi]) {
			await new Promise((resolve, reject) => app.db.display_court_displaysettings.insert({
				client_id: ws.client_id, hostname: ws.hostname, court_id: 'court-1',
				panel_devicemode: ws.panel_devicemode || 'display',
				displaysetting_id: ws === tablet ? 'fanout-test_default_umpire' : 'fanout-test_default_display',
			}, err => err ? reject(err) : resolve()));
		}
		const presses = [{ type: 'love-all', timestamp: Date.now() - 10000 }];
		await app.db.matches.update_async({ _id: 'match-1' }, { $set: { presses } }, {});
		const tournament = app.db.tournaments.getAllData()[0];
		Object.defineProperty(tournament, 'events', { enumerable: true, configurable: true,
			get() { throw new Error('panel refresh read registration payload'); },
		});
		const original_find = app.db.tournaments.findOne_async;
		try {
			await bupws_v2.handle_init(app, single, { tournament_key: 'fanout-test' });
			const state = single.messages.find(msg => msg.type === 'display_state');
			assert.strictEqual(state.tournament.name, 'Test tournament');
			assert.strictEqual(state.tournament.logo_url, '/h/fanout-test/logo/test-logo');
			assert.strictEqual(state.tournament.logo_background_color, '#112233');
			assert.strictEqual(state.tournament.logo_foreground_color, '#445566');
			// Cover the callback fallback as well as the normal async query path.
			delete app.db.tournaments.findOne_async;
			multi.v2_multi_court_display = true;
			multi.last_v2_match_ids_by_court.set('court-1', 'match-1');
			await bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
			assert(multi.messages.some(msg => msg.type === 'display_points_update'));
			const score = tablet.messages.find(msg => msg.ctype === 'score-update').val.event;
			assert.strictEqual(score.tournament_name, 'Test tournament');
			assert.strictEqual(score.tournament_logo_url, '/h/fanout-test/logo/test-logo');
			assert.deepStrictEqual(JSON.parse(score.matches[0].presses_json), presses);
			assert.strictEqual(single.v2_admin_wait_for_score_updates, true);
			app.db.tournaments.findOne_async = original_find;
			delete tournament.events;
			await app.db.tournaments.update_async({ key: 'fanout-test' }, { $set: {
				name: 'Renamed tournament', logo_id: 'new-logo', bup_v2_admin_wait_for_score_updates: false,
			} }, {});
			await bupws_v2.send_current_state(app, single, 'fanout-test');
			const updated = single.messages.filter(msg => msg.type === 'display_state').pop();
			assert.strictEqual(updated.tournament.name, 'Renamed tournament');
			assert.strictEqual(updated.tournament.logo_url, '/h/fanout-test/logo/new-logo');
			assert.strictEqual(single.v2_admin_wait_for_score_updates, false);
		} finally {
			delete tournament.events;
			app.db.tournaments.findOne_async = original_find;
			cleanup();
		}
	});

	_it('sends single-court TV updates while a multi-court full-state fallback is blocked', async () => {
		const { app, panel, cleanup } = await fixture();
		const multi = panel('slow-multi');
		multi.v2_multi_court_display = true;
		let release;
		multi.hostname = new Promise(resolve => { release = resolve; });
		const single = panel('single-tv');
		const delivered = wait_for_points([single]);
		let completed = false;
		const operation = bupws_v2.handle_score_change(app, 'fanout-test', 'court-1').then(() => { completed = true; });
		try {
			await delivered;
			assert.strictEqual(completed, false);
			assert.strictEqual(multi.messages.length, 0);
		} finally {
			release('slow-multi');
			await operation;
			cleanup();
		}
		assert(multi.messages.length > 0);
	});

	_it('uses the current court assignment and score after queued writes have persisted', async () => {
		const { app, panel, cleanup } = await fixture();
		const tv = panel('ordered-tv');
		await new Promise((resolve, reject) => app.db.matches.insert({
			_id: 'replacement', tournament_key: 'fanout-test', network_score: [[7, 4]], presses: [],
			setup: { match_id: 'replacement', court_id: 'court-1', now_on_court: true,
				state: 'oncourt', counting: '3x21', warmup: 'none', teams: [{ players: [] }, { players: [] }],
			},
		}, error => error ? reject(error) : resolve()));
		tv.last_v2_match_id = 'replacement';
		const persist = app.db.courts.persistence.persistNewState;
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		app.db.courts.persistence.persistNewState = function(docs, done) {
			release = () => persist.call(this, docs, done);
			reached();
		};
		const write = app.db.courts.update_async({ _id: 'court-1' }, { $set: { match_id: 'replacement' } }, {});
		await held;
		let requested;
		const queued = new Promise(resolve => { requested = resolve; });
		const read_context = app.db.model.read_display_context_part;
		app.db.model.read_display_context_part = (part, ...args) => {
			const result = read_context(part, ...args);
			if (part === 'court') requested();
			return result;
		};
		const operation = bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
		try {
			await queued;
			await new Promise(resolve => setImmediate(resolve));
			assert(!tv.messages.some(msg => msg.type === 'display_points_update'));
		} finally {
			app.db.courts.persistence.persistNewState = persist;
			release();
			await write;
			await operation;
			cleanup();
		}
		const points = tv.messages.find(msg => msg.type === 'display_points_update');
		assert(points, 'replacement match was not published');
		assert.deepStrictEqual(points.score.current_set, { left: 7, right: 4 });
	});

	_it('starts the current court read while presentation settings are still waiting', async () => {
		const { app, panel, cleanup } = await fixture();
		panel('parallel-tv');
		const original = app.db.model.read_display_context_part;
		let release, reached, court_requested = false;
		const held = new Promise(resolve => { reached = resolve; });
		app.db.model.read_display_context_part = (part, ...args) => {
			if (part === 'court') court_requested = true;
			if (part === 'tournament') {
				const callback = args.pop();
				return original(part, ...args, (...results) => { release = () => callback(...results); reached(); });
			}
			return original(part, ...args);
		};
		const running = bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
		try {
			await held;
			assert.strictEqual(court_requested, true);
		} finally {
			release(); await running;
			app.db.model.read_display_context_part = original; cleanup();
		}
	});
	_it('publishes single and multi-court point updates without ordinary DB cursor reads', async () => {
		const { app, panel, cleanup } = await fixture();
		const single = panel('lookup-single');
		const multi = panel('lookup-multi');
		multi.v2_multi_court_display = true;
		multi.last_v2_match_ids_by_court.set('court-1', 'match-1');
		for (const name of ['courts', 'matches', 'tournaments']) {
			app.db[name].getCandidates = () => { throw new Error('TV fanout used ordinary ' + name + ' cursor'); };
		}
		try {
			await bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
			for (const ws of [single, multi]) {
				const points = ws.messages.find(msg => msg.type === 'display_points_update');
				assert(points, 'TV point did not arrive through object lookup');
				assert.deepStrictEqual(points.score.current_set, { left: 1, right: 0 });
			}
		} finally { cleanup(); }
	});

	_it('retains ordinary async and callback display reads for partial datastores', async () => {
		const { app, panel, cleanup } = await fixture();
		const tv = panel('fallback-tv');
		delete app.db.model.read_display_context_part;
		try {
			await bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
			assert(tv.messages.some(msg => msg.type === 'display_points_update'));
			tv.messages.length = 0;
			delete app.db.courts.findOne_async;
			delete app.db.matches.findOne_async;
			delete app.db.tournaments.findOne_async;
			await app.db.matches.update_async({ _id: 'match-1' }, { $set: { network_score: [[4, 2]] } }, {});
			await bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
			const points = tv.messages.find(msg => msg.type === 'display_points_update');
			assert.deepStrictEqual(points.score.current_set, { left: 4, right: 2 });
		} finally { cleanup(); }
	});
});
