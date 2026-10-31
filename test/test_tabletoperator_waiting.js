'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const waiting = require('../static/js/tabletoperator_waiting');
const database = require('../bts/database');
const admin = require('../bts/admin');
const match_utils = require('../bts/match_utils');
const { promisify } = require('util');

const call = (store, method, ...args) => promisify(store[method].bind(store))(...args);
const player = (btp_id, name = 'Alex Beispiel') => ({ btp_id, name });
const entry = (people, extra = {}) => ({ tabletoperator: people, court: null, ...extra });

describe('Tablet waiting-list identity and activity', function() {
	it('identifies both members of a pair by ID, preserving namesakes with other IDs', function() {
		const index = waiting.index([entry([player(1), player(2, 'Other')])]);
		assert(index.has(player('1', 'Renamed')));
		assert(index.has(player(2)));
		assert(!index.has(player(3)));
	});

	it('matches typed and legacy names independently of case, spaces and Unicode composition', function() {
		const index = waiting.index([entry([player(1, 'Jörg Beispiel')])]);
		assert(index.has(player(null, '  JO\u0308RG   beispiel  ')));
		for (const btp_id of [null, '', undefined, -1]) {
			assert.strictEqual(waiting.id({ btp_id }), null);
			assert(waiting.index([entry([player(btp_id)])]).has(player(9)));
		}
		assert(!waiting.index([entry([{}])]).has({}));
	});

	it('ignores assigned and removed records and permits adding a person again after removal', function() {
		const rows = [null, entry([player(1)], { court: -1 }), entry([player(2)], { court: 'court_1' }), entry([player(3)])];
		assert(!waiting.index(rows).has(player(1)));
		assert(!waiting.index(rows).has(player(2)));
		assert(waiting.index(rows).has(player(3)));
		rows[3].court = -1;
		assert(!waiting.index(rows).has(player(3)));
	});

	it('deduplicates state-based duties without treating every anonymous person as ID zero', function() {
		const index = waiting.index([entry([player(-1, 'Club A')])], true);
		assert(index.has({ ...player(1), state: 'Club A' }));
		assert(!index.has({ ...player(2), state: 'Club B' }));
		assert(!index.has(player(0)));
	});

	it('uses current match activity rather than historical player flags, including anonymous people', function() {
		const matches = [
			{ setup: { now_on_court: true, court_id: 'court_1', teams: [{ players: [player(1), player(-1, 'Guest')] }], tabletoperators: [player(2)] } },
			{ setup: { state: 'preparation', teams: [{ players: [player(3)] }], tabletoperators: [player(4)] } },
			{ setup: { state: 'preparation', preparation_call_deferred: true, teams: [{ players: [player(5)] }] } },
			{ setup: { state: 'scheduled', teams: [{ players: [{ ...player(6), now_playing_on_court: 'old' }] }] } },
		];
		const activity = waiting.activity_index(matches);
		for (const p of [player(1), player(2), player(null, 'Guest')]) assert(activity.playing.has(p));
		for (const id of [3, 4]) assert(activity.preparing.has(player(id)));
		for (const id of [5, 6]) assert(!activity.playing.has(player(id)) && !activity.preparing.has(player(id)));
	});

	for (const finished of [{ team1_won: false }, { btp_winner: 2 }, { state: 'finished' }]) {
		it('allows completed players despite old court flags: ' + JSON.stringify(finished), function() {
			const match = { ...finished, setup: { state: finished.state, now_on_court: true, court_id: 'court_1', teams: [{ players: [player(1)] }] } };
			assert(!waiting.activity_index([match]).playing.has(player(1)));
		});
	}
});

describe('Manual tablet waiting-list additions', function() {
	let original_selection, original_call, app;
	beforeEach(async function() {
		// Isolated in-memory stores and automation stubs; never use live services.
		original_selection = match_utils.queue_auto_execute_preparation_selections;
		original_call = match_utils.auto_call_matches_on_free_courts;
		match_utils.queue_auto_execute_preparation_selections = (_app, _key, cb) => cb?.();
		match_utils.auto_call_matches_on_free_courts = (_app, _key, cb) => cb?.();
		const db = await database.init_test();
		app = { db, clock: { now_ms: () => 1000 } };
		await call(db.tournaments, 'insert', { key: 'queue', tabletoperator_enabled: true, btp_enabled: false });
	});
	afterEach(function() {
		match_utils.queue_auto_execute_preparation_selections = original_selection;
		match_utils.auto_call_matches_on_free_courts = original_call;
	});
	const add = message => new Promise((resolve, reject) => admin.handle_tabletoperator_add(app,
		{ respond: (_request, error) => error ? reject(error) : resolve() }, { tournament_key: 'queue', ...message }));
	const add_person = p => add({ match: { setup: { teams: [{ players: [p] }] } }, team_id: 0 });
	const rows = () => promisify(app.db.tabletoperators.find.bind(app.db.tabletoperators))({ tournament_key: 'queue', court: null });

	it('rejects duplicate IDs and typed names without changing the existing order or timestamps', async function() {
		await add_person(player(1));
		const before = await rows();
		await assert.rejects(add_person(player('1', 'Renamed')), /already on the waiting list/);
		await assert.rejects(add({ tabletoperator_name: '  ALEX   BEISPIEL  ' }), /already on the waiting list/);
		assert.deepStrictEqual(await rows(), before);
	});

	it('acknowledges successful additions once, after the database insert', async function() {
		let responses = 0;
		await admin.handle_tabletoperator_add(app, { respond: (_request, error) => {
			assert.ifError(error); responses++;
		} }, { tournament_key: 'queue', tabletoperator_name: 'Guest' });
		assert.strictEqual(responses, 1);
		assert.strictEqual((await rows())[0].tabletoperator[0].name, 'Guest');
	});

	it('serializes concurrent additions from different clients', async function() {
		const results = await Promise.allSettled(Array.from({ length: 8 }, () => add_person(player(1))));
		assert.strictEqual(results.filter(result => result.status === 'fulfilled').length, 1);
		assert.strictEqual((await rows()).length, 1);
	});

	it('keeps an existing pair together and only adds the missing team member', async function() {
		await call(app.db.tabletoperators, 'insert', entry([player(1), player(2, 'Partner')], { tournament_key: 'queue', start_ts: 10 }));
		await assert.rejects(add_person(player(2)), /already on the waiting list/);
		await add({ team_id: 0, match: { setup: { teams: [{ players: [player(1), player(3, 'New'), player('3', 'New')] }] } } });
		assert.deepStrictEqual((await rows()).flatMap(row => row.tabletoperator.map(p => p.btp_id)).sort(), [1, 2, 3]);
	});

	it('allows distinct registered namesakes and re-adding after removal, ignoring other tournaments', async function() {
		await add_person(player(1));
		await add_person(player(2));
		await call(app.db.tabletoperators, 'update', { tournament_key: 'queue' }, { $set: { court: -1 } }, { multi: true });
		await call(app.db.tabletoperators, 'insert', entry([player(1)], { tournament_key: 'other' }));
		await add_person(player(1));
		assert.strictEqual((await rows()).length, 1);
	});

	it('deduplicates state-based representation as well as people', async function() {
		await call(app.db.tournaments, 'update', { key: 'queue' }, { $set: { tabletoperator_with_state_enabled: true } }, {});
		await add_person({ ...player(1), state: 'Club A' });
		await assert.rejects(add_person({ ...player(2), state: 'Club A' }), /already on the waiting list/);
		assert.strictEqual((await rows()).length, 1);
	});

	it('resolves typed names without mistaking an empty selected ID for player zero', async function() {
		await call(app.db.matches, 'insert', { tournament_key: 'queue', setup: {
			state: 'scheduled', teams: [{ players: [player(0, 'Zero'), player(1, 'Alex Beispiel')] }],
		} });
		await add({ tabletoperator_name: 'Alex Beispiel', tabletoperator_btp_id: null });
		await add({ tabletoperator_name: 'Zero', tabletoperator_btp_id: '0' });
		assert.deepStrictEqual((await rows()).flatMap(row => row.tabletoperator.map(p => p.btp_id)).sort(), [0, 1]);
	});

	for (const mode of ['playing', 'preparing', 'tablet']) {
		it('rejects manual additions while ' + mode + ', including exact free-text names', async function() {
			const on_court = mode !== 'preparing';
			await call(app.db.matches, 'insert', { tournament_key: 'queue', setup: {
				now_on_court: on_court, court_id: 'court_1', state: on_court ? 'oncourt' : 'preparation',
				teams: [{ players: mode === 'tablet' ? [] : [player(1)] }], tabletoperators: mode === 'tablet' ? [player(1)] : [],
			} });
			const pattern = on_court ? /already playing or operating/ : /already called in preparation/;
			await assert.rejects(add_person(player(1)), pattern);
			await assert.rejects(add({ tabletoperator_name: 'Alex Beispiel' }), pattern);
			assert.strictEqual((await rows()).length, 0);
			await call(app.db.matches, 'update', { tournament_key: 'queue' }, { $set: { team1_won: false, 'setup.state': 'finished' } }, {});
			await add_person(player(1));
			assert.strictEqual((await rows()).length, 1, 'the person becomes available after the current match finishes');
		});
	}

	it('does not block the automatic finish path while the old court flags are still set', async function() {
		const tournament = await app.db.tournaments.findOne_async({ key: 'queue' });
		const match = { _id: 'finished', tournament_key: 'queue', network_score: [[21, 10], [21, 11]], btp_winner: 1,
			setup: { now_on_court: true, court_id: 'court_1', match_name: 'HF', teams: [
				{ players: [player(2, 'Winner')] }, { players: [{ ...player(1), now_playing_on_court: 'court_1' }] },
			] } };
		await call(app.db.matches, 'insert', match);
		assert(tournament.tabletoperator_enabled);
		const finish = () => new Promise((resolve, reject) => match_utils.add_player_to_tabletoperator_list(
			app, 'queue', match._id, 1000, error => error ? reject(error) : resolve()));
		await finish(); await finish();
		assert.strictEqual((await rows()).length, 1);
		assert.deepStrictEqual((await rows())[0].tabletoperator.map(p => p.btp_id), [1]);
	});
});

describe('Client guard for tablet additions', function() {
	function client() {
		const requests = [], errors = [];
		const context = { tabletoperator_waiting: waiting, curt: { key: 'queue', matches: [], tabletoperators: [] },
			send: (message, callback) => requests.push({ message, callback }), cerror: { net: error => errors.push(error) } };
		vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/ctabletoperator'), 'utf8'), context);
		return { context, requests, errors, add: p => context.ctabletoperator.add_to_tabletoperator(null, null, p.name, p.btp_id) };
	}
	it('guards double clicks while waiting for acknowledgement and permits retry after failure', function() {
		const c = client();
		c.add(player(1)); c.add(player('1')); c.add(player(null));
		assert.strictEqual(c.requests.length, 1);
		c.requests[0].callback(new Error('Connection failed'));
		c.add(player(1));
		assert.strictEqual(c.requests.length, 2);
		assert.strictEqual(c.errors.length, 1);
	});

	it('guards existing pair members and currently busy people without sending a request', function() {
		const c = client();
		c.context.curt.tabletoperators = [entry([player(1), player(2)])];
		c.add(player(1)); c.add(player(2));
		c.context.curt.matches = [{ setup: { state: 'preparation', teams: [{ players: [player(3)] }] } },
			{ setup: { now_on_court: true, court_id: 'court_1', teams: [{ players: [player(4)] }] } }];
		c.add(player(3)); c.add(player(4));
		assert.strictEqual(c.requests.length, 0);
	});
});
