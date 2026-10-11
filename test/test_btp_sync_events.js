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
