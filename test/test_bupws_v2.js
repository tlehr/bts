'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

const { _describe, _it } = require('./tutils.js');
const bupws_v2 = require('../bts/bupws_v2');
const database = require('../bts/database');

_describe('bupws v2 court picker scoring metadata', () => {
	_it('keeps the actual scoring format for finished-state calculation instead of assuming 21 points', () => {
		const scoring_format = { numSets: 1, set_points: { end_points: 9, max_points: 9 } };
		const match = { _id: 'picker-match', setup: { counting: 'custom', scoring_format, state: 'oncourt', teams: [] }, network_score: [[9, 4]] };
		const result = bupws_v2.build_court_picker_state_v2({ courts: [{ _id: 'court-1', match_id: match._id }], matches: [match], client_mode: 'umpire' });
		const picker = result.courts[0].match;
		assert.strictEqual(picker.setup.counting, 'custom');
		assert.deepStrictEqual(picker.setup.scoring_format, scoring_format);
		assert.strictEqual(picker.setup.state, 'oncourt');
		assert.deepStrictEqual(picker.network_score, [[9, 4]]);
	});
	_it('preserves explicit completion and a winning second team in the compact picker', () => {
		const match = { _id: 'finished-picker', setup: { state: 'finished' }, end_ts: 1793946300000, team1_won: false };
		const result = bupws_v2.build_court_picker_state_v2({ courts: [{ _id: 'court-1', match_id: match._id }], matches: [match] });
		assert.strictEqual(result.courts[0].match.end_ts, match.end_ts);
		assert.strictEqual(result.courts[0].match.team1_won, false);
		assert.strictEqual(result.courts[0].match.setup.state, 'finished');
	});
});

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
		await insert('tournaments', { key: 'fanout-test' });
		await insert('courts', { _id: 'court-1', tournament_key: 'fanout-test', match_id: 'match-1', num: 1 });
		await insert('matches', {
			_id: 'match-1', tournament_key: 'fanout-test', network_score: [[1, 0]], presses: [],
			setup: { match_id: 'match-1', court_id: 'court-1', now_on_court: true, state: 'oncourt',
				counting: '3x21', warmup: 'none', teams: [{ players: [] }, { players: [] }],
			},
		});
		const app = { db };
		const panels = [];
		const panel = (client_id, route_messages = false) => {
			const ws = Object.assign(new EventEmitter(), {
				readyState: 1, client_id, hostname: client_id, messages: [],
				send(raw) { this.messages.push(JSON.parse(raw)); if (this.on_payload) this.on_payload(); },
				sendmsg(payload) { this.messages.push(payload); },
			});
			if (route_messages) require('../bts/wshandler').handle(bupws_v2, app, ws);
			else bupws_v2.on_connect(app, ws);
			ws.last_tournament_key = 'fanout-test';
			ws.court_id = 'court-1';
			ws.last_v2_match_id = 'match-1';
			panels.push(ws);
			return ws;
		};
		return { app, panel, cleanup() { panels.forEach(ws => { ws.readyState = 3; bupws_v2.on_close(app, ws); }); } };
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

	_it('reads a panel profile catalog once per state and applies edits without redundant profile or assignment queries', async () => {
		const { app, panel, cleanup } = await fixture();
		const defaults = require('../bts/displaysettings_defaults');
		await defaults.ensure_default_displaysettings(app, await app.db.tournaments.findOne_async({ key: 'fanout-test' }));
		const tv = panel('profile-catalog-tv');
		await bupws_v2.handle_init(app, tv, { tournament_key: 'fanout-test' });
		const store = app.db.displaysettings, bindings = app.db.display_court_displaysettings;
		const original = { find: store.find_async, one: store.findOne_async, update: bindings.update };
		let catalogs = 0, lookups = 0, writes = 0;
		store.find_async = (...args) => { catalogs++; return original.find.apply(store, args); };
		store.findOne_async = (...args) => { lookups++; return original.one.apply(store, args); };
		bindings.update = function(...args) { writes++; return original.update.apply(this, args); };
		try {
			await bupws_v2.send_current_state(app, tv, 'fanout-test');
			await bupws_v2.send_current_state(app, tv, 'fanout-test');
			assert.deepStrictEqual({ catalogs, lookups, writes }, { catalogs: 2, lookups: 0, writes: 0 });
			await store.update_async({ id: 'fanout-test_default_display' }, { $set: { d_c0: '#123456' } }, {});
			await bupws_v2.send_current_state(app, tv, 'fanout-test');
			const state = tv.messages.filter(message => message.type === 'court_picker_state').pop();
			assert.strictEqual(state.display_settings.d_c0, '#123456');
			assert.deepStrictEqual({ catalogs, lookups, writes }, { catalogs: 3, lookups: 0, writes: 0 });
			await new Promise((resolve, reject) => store.insert({ id: 'alternative', devicemode: 'display', d_c0: '#abcdef' }, error => error ? reject(error) : resolve()));
			await bupws_v2.send_current_state(app, tv, 'fanout-test', { panel_settings: { id: 'alternative', devicemode: 'display' } });
			assert.strictEqual(tv.messages.filter(message => message.type === 'court_picker_state').pop().display_settings.d_c0, '#abcdef');
			assert.deepStrictEqual({ catalogs, lookups, writes }, { catalogs: 4, lookups: 0, writes: 1 });
			await bupws_v2.send_current_state(app, tv, 'fanout-test');
			assert.strictEqual(tv.messages.filter(message => message.type === 'court_picker_state').pop().display_settings.d_c0, '#abcdef');
			await store.remove_async({ id: 'alternative' }, {});
			await bupws_v2.send_current_state(app, tv, 'fanout-test');
			assert.strictEqual(tv.messages.filter(message => message.type === 'court_picker_state').pop().display_settings.d_c0, '#123456');
			assert.deepStrictEqual({ catalogs, lookups, writes }, { catalogs: 6, lookups: 0, writes: 2 });
		} finally {
			store.find_async = original.find;store.findOne_async = original.one;bindings.update = original.update;cleanup();
		}
	});

	_it('records tablet points and display ACKs as contacts without browser diagnostics or extra broadcasts', async () => {
		const { app, panel, cleanup } = await fixture();
		const clock = Date.now, score_update = bupws_v2.handle_score_update;
		let now = clock(), point_work;
		Date.now = () => now;
		bupws_v2.handle_score_update = (...args) => (point_work = score_update(...args));
		const tablet = panel('contact-tablet', true), tv = panel('contact-tv', true);
		tablet.panel_devicemode = 'umpire';
		const connected_at = now;
		try {
			now += 1000;
			tablet.emit('message', JSON.stringify({type: 'score_update', tournament_key: 'fanout-test',
				score: {match_id: 'match-1', court_id: 'court-1', network_score: [[2, 0]], presses: []},
			}));
			assert.strictEqual(tablet.last_contact, now, 'contact must be captured before queued processing finishes');
			await point_work; await require('../bts/foreground_work').idle();
			assert.strictEqual(tv.last_contact, connected_at, 'outgoing points must not advance the contact time');
			const point_at = now;
			const delivered = tv.messages.find(message => message.type === 'display_points_update');
			assert(delivered?.message_id);
			now += 1000;
			tv.emit('message', JSON.stringify({type: 'display_rendered', message_id: delivered.message_id, ok: true}));
			assert.strictEqual(tv.last_contact, now);
			assert(tv.v2_render_ack_samples.length > 0);
			const snapshot = () => bupws_v2.get_panel_contacts(app);
			assert.strictEqual(snapshot().find(item => item.client_id === tablet.client_id).last_contact, point_at);
			assert.strictEqual(snapshot().find(item => item.client_id === tv.client_id).last_contact, now);
			const display_at = now;
			now += 1000; snapshot();
			assert.strictEqual(snapshot().find(item => item.client_id === tv.client_id).last_contact, display_at, 'polls must not invent contacts');
			tv.emit('pong');
			assert.strictEqual(tv.last_contact, now);
			now += 1000;
			tablet.readyState = 3; tablet.emit('close');
			assert.strictEqual(snapshot().find(item => item.client_id === tablet.client_id).last_contact, point_at, 'disconnect must retain the last received contact');
			const displays = [{client_id: tablet.client_id, online: false}];
			await bupws_v2.add_display_status(app, {key: 'fanout-test'}, displays);
			assert.strictEqual(displays.find(item => item.client_id === tablet.client_id).last_contact, point_at);
			assert.strictEqual(displays.find(item => item.client_id === tv.client_id).last_contact, tv.last_contact);
			const detached = snapshot().find(item => item.client_id === tablet.client_id);detached.last_contact = 1;
			assert.strictEqual(snapshot().find(item => item.client_id === tablet.client_id).last_contact, point_at);
			assert.deepStrictEqual(bupws_v2.get_panel_contacts({}), [], 'contact histories belong to their server instance');
			const other = panel(tablet.client_id);other.last_tournament_key = 'other';
			other.emit('message', '{}');
			assert.strictEqual(snapshot().filter(item => item.client_id === tablet.client_id).length, 2);
			assert.strictEqual(snapshot().find(item => item.client_id === tablet.client_id && item.tournament_key === 'fanout-test').last_contact, point_at);
		} finally {
			if (point_work) await point_work;
			await require('../bts/foreground_work').idle();
			bupws_v2.handle_score_update = score_update; Date.now = clock; cleanup();
		}
	});

	_it('releases only the previous owner on a real takeover, never unrelated tablets', async () => {
		const { app, panel, cleanup } = await fixture();
		const owner = panel('owner'), replacement = panel('replacement');
		const peers = [panel('same-court'), panel('other-court'), panel('unassigned'), panel('other-tournament')];
		for (const ws of [owner, replacement, ...peers]) ws.panel_devicemode = 'umpire';
		peers[1].court_id = 'court-2';
		delete peers[2].court_id;
		peers[3].last_tournament_key = 'other';
		const admin = require('../bts/admin'), notify = admin.notify_change;
		const waits = [];
		admin.notify_change = (_app, _key, type, value) => {
			if (type === 'display_wait_for_done') waits.push(value);
		};
		const open = ws => bupws_v2.handle_match_opened(app, ws, {
			tournament_key: 'fanout-test', match_id: 'bts_match-1', court_id: 'court-1',
		});
		try {
			await open(owner); await open(owner);
			assert.strictEqual(waits.length, 0);
			assert([owner, replacement, ...peers].every(ws => ws.messages.length === 0));
			await open(replacement); await open(replacement);
			assert.strictEqual(owner.messages.length, 1);
			assert.strictEqual(owner.messages[0].ctype, 'release-match');
			assert.strictEqual(owner.messages[0].val.match_id, 'match-1');
			assert.strictEqual(owner.messages[0].val.owner_client_id, replacement.client_id);
			assert.strictEqual(waits.length, 1);
			assert.strictEqual(waits[0].client_id, owner.client_id);
			assert([replacement, ...peers].every(ws => ws.messages.length === 0));
			await bupws_v2.handle_score_update(app, owner, { tournament_key: 'fanout-test',
				score: { match_id: 'match-1', court_id: 'court-1', network_score: [[9, 0]], presses: [] } });
			assert.strictEqual(owner.messages.at(-1).val.reason, 'match-owned-by-other-tablet');
			assert.deepStrictEqual((await app.db.matches.findOne_async({_id: 'match-1'})).network_score, [[1, 0]]);
			assert([replacement, ...peers].every(ws => ws.messages.length === 0));
		} finally { admin.notify_change = notify; cleanup(); }
	});

	_it('sends ongoing points to free tablets and the relevant TV, retaining assigned-tablet admin refreshes', async () => {
		const { app, panel, cleanup } = await fixture();
		const source = panel('source'), same_court = panel('same-court-peer'), other_court = panel('other-court-peer');
		const free = panel('free-tablet'), foreign = panel('foreign-tablet');
		const tv = panel('relevant-tv'), other_tv = panel('other-tv');
		for (const ws of [source, same_court, other_court, free, foreign]) ws.panel_devicemode = 'umpire';
		for (const ws of [tv, other_tv]) ws.panel_devicemode = 'display';
		other_court.court_id = other_tv.court_id = 'court-2';
		delete free.court_id;
		delete foreign.court_id;
		foreign.last_tournament_key = 'other';
		const foreground = require('../bts/foreground_work'), publication = foreground.publication;
		const publications = [];
		foreground.publication = work => { const promise = publication(work); publications.push(promise); return promise; };
		try {
			await require('../bts/displaysettings_defaults').ensure_default_displaysettings(app,
				await app.db.tournaments.findOne_async({key: 'fanout-test'}));
			await new Promise((resolve, reject) => app.db.courts.insert({
				_id: 'court-2', tournament_key: 'fanout-test', num: 2,
			}, error => error ? reject(error) : resolve()));
			for (const ws of [source, same_court, other_court, free]) {
				await new Promise((resolve, reject) => app.db.display_court_displaysettings.insert({
					client_id: ws.client_id, hostname: ws.hostname, court_id: ws.court_id || '',
					panel_devicemode: 'umpire', displaysetting_id: 'fanout-test_default_umpire',
				}, error => error ? reject(error) : resolve()));
			}
			for (let point = 2; point <= 3; point++) {
				for (const ws of [source, same_court, other_court, free, foreign, tv, other_tv]) ws.messages.length = 0;
				await bupws_v2.handle_score_update(app, source, {tournament_key: 'fanout-test',
					score: {match_id: 'match-1', court_id: 'court-1', network_score: [[point, 0]], presses: []},
				});
				await Promise.all(publications);
				assert([source, same_court, other_court, foreign, other_tv].every(ws => ws.messages.length === 0));
				assert(free.messages.some(message => message.type === 'court_picker_state' && message.client_mode === 'umpire'));
				assert(tv.messages.some(message => message.type === 'display_points_update' && message.score.current_set.left === point));
			}
			// A correction or assignment from the administration still refreshes
			// assigned tablets on this court, as well as the free court picker.
			for (const ws of [source, same_court, other_court, free]) ws.messages.length = 0;
			await bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
			assert(source.messages.some(message => message.ctype === 'score-update'));
			assert(same_court.messages.some(message => message.ctype === 'score-update'));
			assert(free.messages.some(message => message.type === 'court_picker_state'));
			assert.strictEqual(other_court.messages.length, 0);
			for (const ws of [source, same_court, other_court, free]) ws.messages.length = 0;
			await bupws_v2.handle_score_update(app, source, {tournament_key: 'fanout-test', score: {
				match_id: 'match-1', court_id: 'court-1', network_score: [[21, 0], [21, 0]],
				team1_won: true, finish_confirmed: true, end_ts: Date.now(), presses: [],
			}});
			await Promise.all(publications);
			assert(source.messages.some(message => message.ctype === 'score-update'));
			assert(same_court.messages.some(message => message.ctype === 'score-update'));
			assert(free.messages.some(message => message.type === 'court_picker_state'));
			assert.strictEqual(other_court.messages.length, 0);
		} finally {
			await Promise.all(publications);
			foreground.publication = publication;
			cleanup();
		}
	});

	_it('includes the latest battery times in device snapshots without sharing the live socket object', async () => {
		const { app, panel, cleanup } = await fixture();
		const tablet = panel('battery-snapshot');tablet.panel_devicemode = 'umpire';
		tablet.battery = { level: .6, charging: false, chargingTime: null, dischargingTime: 10800 };
		const other = panel('other-tournament-battery');other.last_tournament_key = 'other';other.battery = { level: .2 };
		const displays = [{ client_id: tablet.client_id, battery: { level: .1 } }];
		try {
			await bupws_v2.add_display_status(app, { key: 'fanout-test' }, displays);
			assert.strictEqual(displays.length, 1);
			assert.strictEqual(displays[0].online, true);
			assert.deepStrictEqual(displays[0].battery, tablet.battery);
			assert.notStrictEqual(displays[0].battery, tablet.battery);
			displays[0].battery.level = .9;
			assert.strictEqual(tablet.battery.level, .6);
		} finally { cleanup(); }
	});

	_it('initializes and refreshes displays and tablets regardless of an old missing, false or true protocol flag', async () => {
		const { app, panel, cleanup } = await fixture();
		try {
			await require('../bts/displaysettings_defaults').ensure_default_displaysettings(app,
				await app.db.tournaments.findOne_async({key: 'fanout-test'}));
			for (const legacy_value of [undefined, false, true]) {
				const update = legacy_value === undefined ? {$unset: {bupws_v2_enabled: true}} : {$set: {bupws_v2_enabled: legacy_value}};
				await app.db.tournaments.update_async({key: 'fanout-test'}, update, {});
				const tournament = await app.db.tournaments.findOne_async({key: 'fanout-test'});
				for (const devicemode of ['display', 'umpire']) {
					const ws = panel(devicemode + '-' + legacy_value);
					ws.panel_devicemode = devicemode;
					await new Promise((resolve, reject) => app.db.display_court_displaysettings.insert({
						client_id: ws.client_id, hostname: ws.hostname, court_id: 'court-1', panel_devicemode: devicemode,
						displaysetting_id: devicemode === 'umpire' ? tournament.displaysettings_general_tablet : tournament.displaysettings_general,
					}, error => error ? reject(error) : resolve()));
					await bupws_v2.handle_init(app, ws, {tournament_key: 'fanout-test', panel_settings: {devicemode}});
					assert(ws.messages.some(message => devicemode === 'display' ? message.type === 'display_state' : message.ctype === 'score-update'));
					const previous = ws.messages.length;
					await bupws_v2.send_current_state(app, ws, 'fanout-test');
					assert(ws.messages.length > previous);
					assert(!ws.messages.some(message => message.type === 'use-bup-v1'));
				}
			}
		} finally { cleanup(); }
	});

	_it('keeps sending scores while the acknowledgement toggle independently controls the admin wait indicator', async () => {
		const { app, panel, cleanup } = await fixture();
		const admin = require('../bts/admin'), notify = admin.notify_change;
		const previous_override = process.env.BUP_V2_ADMIN_WAIT_FOR_SCORE_UPDATES;
		const notifications = [];
		delete process.env.BUP_V2_ADMIN_WAIT_FOR_SCORE_UPDATES;
		admin.notify_change = (_app, _key, type, value) => notifications.push({type, value});
		const display = panel('acknowledgement-display');
		try {
			for (const [index, enabled] of [false, true, false].entries()) {
				await app.db.tournaments.update_async({key: 'fanout-test'}, {$set: {bup_v2_admin_wait_for_score_updates: enabled}}, {});
				await app.db.matches.update_async({_id: 'match-1'}, {$set: {network_score: [[index + 2, 0]]}}, {});
				notifications.length = 0; display.messages.length = 0;
				await bupws_v2.handle_score_change(app, 'fanout-test', 'court-1');
				assert(display.messages.some(message => message.type === 'display_points_update'));
				assert.strictEqual(notifications.some(item => item.type === 'display_wait_for_done' &&
					item.value.val.payload_type === 'display_points_update'), enabled);
			}
		} finally {
			admin.notify_change = notify;
			if (previous_override === undefined) delete process.env.BUP_V2_ADMIN_WAIT_FOR_SCORE_UPDATES;
			else process.env.BUP_V2_ADMIN_WAIT_FOR_SCORE_UPDATES = previous_override;
			cleanup();
		}
	});

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

	_it('returns from persistence before court notifications while publishing the committed score immediately', async () => {
		const { app, panel, cleanup } = await fixture();
		const tablet = panel('callback-source'); tablet.panel_devicemode = 'umpire';
		const tv = panel('callback-tv'); tv.panel_devicemode = 'display';
		const admin = require('../bts/admin');
		const update = app.db.matches.update, notify = admin.notify_change;
		let in_callback = false;
		const notifications = [];
		app.db.matches.update = function(query, change, options, callback) {
			return update.call(this, query, change, options, function(...args) {
				in_callback = true;
				try { return callback.apply(this, args); }
				finally { in_callback = false; }
			});
		};
		admin.notify_change = function(app, key, type, payload) {
			if (key === 'fanout-test') notifications.push({ type, in_callback });
			return notify(app, key, type, payload);
		};
		try {
			await bupws_v2.handle_score_update(app, tablet, { tournament_key: 'fanout-test',
				score: { match_id: 'match-1', court_id: 'court-1', network_score: [[2, 0]], presses: [] } });
			assert.deepStrictEqual(notifications.find(entry => entry.type === 'score'), { type: 'score', in_callback: true });
			assert.deepStrictEqual(notifications.find(entry => entry.type === 'court_current_match'), { type: 'court_current_match', in_callback: false });
			assert(tv.messages.some(message => message.type === 'display_points_update'));
			assert.deepStrictEqual((await app.db.matches.findOne_async({ _id: 'match-1' })).network_score, [[2, 0]]);
		} finally {
			app.db.matches.update = update; admin.notify_change = notify; cleanup();
		}
	});

	_it('sends only persisted points to the initialized TV before delayed presentation reads', async () => {
		const { app, panel, cleanup } = await fixture();
		const tablet = panel('point-source'); tablet.panel_devicemode = 'umpire';
		const tv = panel('committed-tv'); tv.panel_devicemode = 'display';
		const stale = panel('stale-tv'); stale.panel_devicemode = 'display'; stale.last_v2_match_id = 'different-game';
		const persist = app.db.matches.persistence.persistNewState;
		let release_persistence, reached_persistence, reached_presentation;
		const writing = new Promise(resolve => { reached_persistence = resolve; });
		const reading = new Promise(resolve => { reached_presentation = resolve; });
		const releases = [];
		app.db.matches.persistence.persistNewState = function(documents, done) {
			release_persistence = () => persist.call(this, documents, done); reached_persistence();
		};
		const original = app.db.model.read_display_context_part;
		app.db.model.read_display_context_part = (part, ...args) => {
			if (part !== 'tournament') return original(part, ...args);
			const callback = args.pop();
			return original(part, ...args, (...results) => { releases.push(() => callback(...results)); reached_presentation(); });
		};
		const delivered = wait_for_points([tv]);
		const running = bupws_v2.handle_score_update(app, tablet, { tournament_key: 'fanout-test',
			score: { match_id: 'match-1', court_id: 'court-1', network_score: [[2, 0]], presses: [] } });
		try {
			await writing; assert(!tv.messages.some(msg => msg.type === 'display_points_update'));
			app.db.matches.persistence.persistNewState = persist; release_persistence();
			await delivered; await reading;
			assert.deepStrictEqual(tv.messages.find(msg => msg.type === 'display_points_update').score.current_set, { left: 2, right: 0 });
			assert(!stale.messages.some(msg => msg.type === 'display_points_update'));
		} finally {
			app.db.matches.persistence.persistNewState = persist;
			app.db.model.read_display_context_part = original;
			for (const release of releases) release();
			await running; await require('../bts/foreground_work').idle(); cleanup();
		}
	});
	_it('keeps background admin work paused through finish cleanup while delivering the final score immediately', async () => {
		const { app, panel, cleanup } = await fixture();
		const tablet = panel('finish-source'); tablet.panel_devicemode = 'umpire';
		const tv = panel('finish-tv'); tv.panel_devicemode = 'display';
		const foreground = require('../bts/foreground_work'), helpers = require('../bts/match_utils');
		const reset = helpers.reset_player_tabletoperator, publication = foreground.publication;
		let display_publication;
		foreground.publication = work => (display_publication = publication(work));
		let entered, release;
		const started = new Promise(resolve => { entered = resolve; });
		const hold = new Promise(resolve => { release = resolve; });
		helpers.reset_player_tabletoperator = async (...args) => { entered(); await hold; return reset(...args); };
		const delivered = wait_for_points([tv]);
		const running = bupws_v2.handle_score_update(app, tablet, { tournament_key: 'fanout-test',
			score: { match_id: 'match-1', court_id: 'court-1', network_score: [[21, 0], [21, 0]],
				team1_won: true, finish_confirmed: true, end_ts: Date.now(), presses: [] },
		});
		try {
			await started; await delivered; await display_publication;
			assert.strictEqual(foreground.busy(), true);
			let resumed = false;
			const background = foreground.idle().then(() => { resumed = true; });
			await new Promise(resolve => setImmediate(resolve));
			assert.strictEqual(resumed, false);
			release(); await running; await background;
			assert(!tablet.messages.some(message => message.type === 'error'));
			assert.strictEqual((await app.db.matches.findOne_async({ _id: 'match-1' })).setup.state, 'finished');
			assert.strictEqual((await app.db.courts.findOne_async({ _id: 'court-1' })).match_id, null);
		} finally {
			release(); helpers.reset_player_tabletoperator = reset; foreground.publication = publication;
			await running; await foreground.idle(); cleanup();
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
