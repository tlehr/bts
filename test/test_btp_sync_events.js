'use strict';

const assert = require('assert');
const { promisify } = require('util');
const { _describe, _it } = require('./tutils');
const database = require('../bts/database');
const btp_sync = require('../bts/btp_sync');

async function fixture() {
	const db = await database.init_test();
	const app = { db, wss: { clients: [] } };
	await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 't1' });
	const reads = [];
	const findOne = db.tournaments.findOne;
	db.tournaments.findOne = function(...args) {
		reads.push({ query: args[0], projection: typeof args[1] === 'function' ? null : args[1] });
		return findOne.apply(this, args);
	};
	const state = {
		events: new Map([
			[1, { ID: [1], Name: ['Singles'], GameTypeID: [1], GenderID: [1] }],
			[2, { ID: [2], Name: ['Doubles'], GameTypeID: [3], GenderID: [1] }],
		]),
		stages: new Map([[10, { ID: [10], Name: ['Main'], EventID: [1], StageType: [1], DisplayOrder: [1] }]]),
		stage_entries: new Map([[20, { ID: [20], StageID: [10], EntryID: [30], Status: [0] }]]),
		entries: new Map([[30, { ID: [30], Player1ID: [40] }]]),
		players: new Map([
			[40, { ID: [40], Firstname: ['Ada'], Lastname: ['Lovelace'], ClubID: [50], entries: new Map([[100, '<none>']]) }],
			[41, { ID: [41], Firstname: ['Grace'], Lastname: ['Hopper'], ClubID: [50] }],
		]),
		clubs: new Map([[50, { ID: [50], Name: ['Club'], DistrictID: [60] }]]),
		districts: new Map([[60, { ID: [60], Name: ['BAY-01'] }]]),
		draws: new Map([[100, { ID: [100], EventID: [1] }]]),
		matches: [{ ID: [70], DrawID: [100], IsMatch: [true] }],
	};
	const sync = (key = 't1') => new Promise((resolve, reject) => {
		btp_sync._integrate_events(app, key, state, err => err ? reject(err) : resolve());
	});
	const stored = async (key = 't1') => (await db.tournaments.findOne_async({ key })).events;
	return { app, state, sync, stored, reads };
}

_describe('BTP event integration cache', () => {
	_it('skips rebuilding and copying stored registration lists when only match results change', async () => {
		const { app, state, sync, stored, reads } = await fixture();
		await sync();
		const initial = await stored();
		reads.length = 0;
		Object.assign(state.matches[0], { Winner: [1], Sets: [{ Set: [{ T1: [21], T2: [15] }] }], EndTime: ['now'] });
		// Map-based responses must use the same fast path as array-based matches.
		state.matches = new Map([[70, state.matches[0]]]);
		const original_update = app.db.tournaments.update;
		app.db.tournaments.update = () => assert.fail('unchanged registration lists must not be written');
		try { await sync(); } finally { app.db.tournaments.update = original_update; }
		assert.strictEqual(reads.length, 1);
		assert.deepStrictEqual(reads[0].projection, { key: 1, _id: 0 });
		assert.strictEqual(typeof reads[0].query.$where, 'function');
		assert.deepStrictEqual(await stored(), initial);
	});

	_it('imports changes to events, stages, registrations, players, clubs and districts, including nested Maps', async () => {
		const { state, sync, stored, reads } = await fixture();
		await sync();
		const mutations = [
			[() => { state.events.get(1).Name = ['Renamed']; }, payload => assert.strictEqual(payload.events[0].name, 'Renamed')],
			[() => { state.stages.get(10).ScoringFormat = [9]; }, payload => assert.strictEqual(payload.events[0].stages[0].scoring_format, 9)],
			[() => { state.stage_entries.get(20).Status = [109]; }, payload => assert.strictEqual(payload.events[0].stages[0].entries[0].status, 109)],
			[() => { state.players.get(40).Firstname = ['Augusta']; }, payload => assert.strictEqual(payload.events[0].stages[0].entries[0].team.players[0].firstname, 'Augusta')],
			[() => { state.players.get(40).entries.set(100, 'WDN'); }, payload => assert.strictEqual(payload.events[0].stages[0].entries[0].team.players[0].entries[100], 'WDN')],
			[() => { state.players.get(40).CheckedIn = [true]; }, payload => assert.strictEqual(payload.events[0].stages[0].entries[0].team.players[0].checked_in, true)],
			[() => { state.clubs.get(50).Name = ['New Club']; }, payload => assert.strictEqual(payload.events[0].stages[0].entries[0].team.players[0].club, 'New Club')],
			[() => { state.districts.get(60).Name = ['HAM-02']; }, payload => assert.strictEqual(payload.events[0].stages[0].entries[0].team.players[0].association, 'HAM-02')],
			[() => { state.entries.get(30).Player1ID = [41]; }, payload => assert.strictEqual(payload.events[0].stages[0].entries[0].team.players[0].name, 'Grace Hopper')],
			[() => { state.stage_entries.clear(); }, payload => assert.strictEqual(payload.events[0].stages[0].entry_count, 0)],
		];
		for (const [mutate, check] of mutations) {
			mutate();
			reads.length = 0;
			await sync();
			assert.strictEqual(reads.length, 1, 'changed payload must be compared without copying it before writing');
			assert.deepStrictEqual(reads[0].projection, { key: 1, _id: 0 });
			check(await stored());
		}
	});

	_it('updates drawn status and match counts when draws move or matches are added and removed', async () => {
		const { state, sync, stored } = await fixture();
		await sync();
		state.draws.get(100).EventID = ['2'];
		await sync();
		let events = (await stored()).events;
		assert.strictEqual(events[0].match_count, 0);
		assert.strictEqual(events[0].is_drawn, false);
		assert.strictEqual(events[1].match_count, 1);
		state.matches.push({ ID: [71], DrawID: ['100'], IsMatch: [true] });
		await sync();
		assert.strictEqual((await stored()).events[1].match_count, 2);
		state.matches.forEach(match => { match.IsMatch = [false]; });
		await sync();
		events = (await stored()).events;
		assert.strictEqual(events[1].match_count, 0);
		assert.strictEqual(events[1].is_drawn, false);
	});

	_it('repairs locally changed or reset payloads and detects deleted and replacement tournaments', async () => {
		const { app, sync, stored } = await fixture();
		await sync();
		const expected = await stored();
		await app.db.tournaments.update_async({ key: 't1' }, { $set: { 'events.events.0.name': 'Local change' } }, {});
		await sync();
		assert.deepStrictEqual(await stored(), expected);
		await app.db.tournaments.update_async({ key: 't1' }, { $set: { events: { events: [] }, last_reset_ts: 2 } }, {});
		await sync();
		assert.deepStrictEqual(await stored(), expected);
		await app.db.tournaments.remove_async({ key: 't1' }, {});
		await assert.rejects(sync(), /Tournament not found/);
		await promisify(app.db.tournaments.insert.bind(app.db.tournaments))({ key: 't1' });
		await sync();
		assert.deepStrictEqual(await stored(), expected);
	});

	_it('retains first planned games from unplayable BTP brackets without marking their disciplines drawn', async () => {
		const { app, state, sync, stored } = await fixture();
		const planned = (day, hour) => ({ year: 2026, month: 9, day, hour, minute: 0 });
		state.matches = [];
		state.draws.set(200, { ID: [200], EventID: ['2'] });
		state.planning_nodes = new Map([
			['md', { DrawID: [100], IsMatch: [true], MatchNr: [396], PlannedTime: [planned(27, 12)], DisplayOrder: [0] }],
			['mx-later', { DrawID: ['200'], IsMatch: [true], MatchNr: [50], PlannedTime: [planned(26, 14)], DisplayOrder: [0] }],
			['mx', { DrawID: [200], IsMatch: [true], MatchNr: [25], PlannedTime: [planned(26, 10)], DisplayOrder: [0] }],
			['entry', { DrawID: [100], IsMatch: [false], EntryID: [30], MatchNr: [1], PlannedTime: [planned(25, 9)] }],
			['link', { DrawID: [100], IsMatch: [true], Link: ['winner'], MatchNr: [2], PlannedTime: [planned(25, 9)] }],
		]);
		await sync();
		const events = (await stored()).events;
		assert.deepStrictEqual(events.map(event => [event.is_drawn, event.match_count]), [[false, 0], [false, 0]]);
		assert.deepStrictEqual(events[0].first_planned_match, { number: 396, date: '2026-09-27', time: '12:00', order: 0 });
		assert.deepStrictEqual(events[1].first_planned_match, { number: 25, date: '2026-09-26', time: '10:00', order: 0 });
		assert.strictEqual(await promisify(app.db.matches.count.bind(app.db.matches))({}), 0, 'schedule hints must not create matches or participant demand');
		const update = app.db.tournaments.update;
		app.db.tournaments.update = () => assert.fail('results and later slot changes must retain the registration fast path');
		try {
			state.planning_nodes.get('mx').Winner = [1];
			state.planning_nodes.get('mx-later').PlannedTime = [planned(26, 15)];
			await sync();
		} finally { app.db.tournaments.update = update; }
	});

	_it('retains only first-round numbers before the draw and refreshes changed numbers without rebuilding for later results', async () => {
		const { app, state, sync, stored } = await fixture();
		const planned = hour => ({ year: 2026, month: 9, day: 26, hour, minute: 0 });
		const node = (number, round, hour, extra = {}) => ({ DrawID: [100], IsMatch: [true],
			MatchNr: [number], Round: [round], PlannedTime: [planned(hour)], ...extra });
		state.matches = [];
		state.draws.set(200, { ID: [200], EventID: [2] });
		state.planning_nodes = new Map([
			['later-round', node(1, 2, 11)],
			['first', node(40, 1, 9)],
			['second', node(60, 1, 10, { DisplayOrder: [1] })],
			['third', node(50, 1, 10, { DisplayOrder: [2], IsPlayable: [false] })],
			['duplicate', node(40, 1, 9)],
			['other-event', node(90, 1, 9, { DrawID: ['200'] })],
			['entry', node(2, 1, 8, { EntryID: [30] })],
			['link', node(3, 1, 8, { Link: ['winner'] })],
			['hidden', node(4, 1, 8, { IsMatch: [false] })],
			['invalid-round', node(5, 0, 8)],
			['invalid-number', node(0, 1, 8)],
		]);
		await sync();
		let events = (await stored()).events;
		assert.deepStrictEqual(events.map(event => event.first_round_match_numbers), [[40, 60, 50], [90]]);
		assert(events.every(event => !event.is_drawn && event.match_count === 0));
		assert.strictEqual(await promisify(app.db.matches.count.bind(app.db.matches))({}), 0);
		const update = app.db.tournaments.update;
		app.db.tournaments.update = () => assert.fail('later-round changes must keep the registration fast path');
		try {
			state.planning_nodes.get('later-round').Winner = [1];
			state.planning_nodes.get('later-round').PlannedTime = [planned(12)];
			await sync();
		} finally { app.db.tournaments.update = update; }
		state.planning_nodes.get('third').MatchNr = [55];
		await sync();
		assert.deepStrictEqual((await stored()).events[0].first_round_match_numbers, [40, 60, 55]);
		state.planning_nodes.get('third').Round = [2];
		await sync();
		assert.deepStrictEqual((await stored()).events[0].first_round_match_numbers, [40, 60]);
		state.planning_nodes.clear();
		await sync();
		events = (await stored()).events;
		assert(events.every(event => event.first_round_match_numbers === undefined), 'remove stale numbers when BTP removes the bracket');
	});

	_it('refreshes first-game ordering when the BTP time, display order or available slots change', async () => {
		const { state, sync, stored } = await fixture();
		const planned = hour => ({ year: 2026, month: 9, day: 26, hour, minute: 0 });
		state.matches = [];
		state.planning_nodes = new Map([
			['manual', { DrawID: [100], IsMatch: [true], MatchNr: [50], PlannedTime: [planned(10)], DisplayOrder: [1] }],
			['number', { DrawID: [100], IsMatch: [true], MatchNr: [25], PlannedTime: [planned(10)], DisplayOrder: [2] }],
			['midnight', { DrawID: [100], IsMatch: [true], MatchNr: [1], PlannedTime: [planned(0)] }],
		]);
		const first = async () => (await stored()).events[0].first_planned_match;
		await sync();
		assert.strictEqual((await first()).number, 50, 'manual order breaks a same-time tie before the match number');
		state.planning_nodes.get('manual').DisplayOrder = [3];
		await sync();
		assert.strictEqual((await first()).number, 25);
		state.planning_nodes.get('manual').PlannedTime = [planned(9)];
		await sync();
		assert.strictEqual((await first()).number, 50);
		assert.strictEqual((await first()).time, '09:00');
		state.planning_nodes.clear();
		await sync();
		assert.strictEqual(await first(), undefined, 'remove stale planning hints when BTP removes the schedule');
	});

	_it('keeps tournament and datastore caches separate and retries after read or write failures', async () => {
		const first = await fixture();
		await first.sync();
		const second = await fixture();
		await second.sync();
		assert.deepStrictEqual(await second.stored(), await first.stored());
		await promisify(first.app.db.tournaments.insert.bind(first.app.db.tournaments))({ key: 't2' });
		await first.sync('t2');
		assert.deepStrictEqual(await first.stored('t2'), await first.stored());

		const store = first.app.db.tournaments;
		const original_read = store.findOne;
		store.findOne = (_query, _projection, cb) => cb(new Error('read failure'));
		try { await assert.rejects(first.sync(), /read failure/); } finally { store.findOne = original_read; }
		await first.sync();
		first.state.events.get(1).Name = ['After retry'];
		const original_update = store.update;
		store.update = (_query, _update, _options, cb) => cb(new Error('write failure'));
		try { await assert.rejects(first.sync(), /write failure/); } finally { store.update = original_update; }
		await first.sync();
		assert.strictEqual((await first.stored()).events[0].name, 'After retry');
	});
});
