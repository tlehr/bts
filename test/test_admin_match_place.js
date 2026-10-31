'use strict';

const assert = require('assert');
const {promisify} = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');

async function fixture() {
	const db = await database.init_test();
	for (const collection of ['tournaments', 'locations', 'courts', 'matches']) {
		db[collection].insert_async = promisify(db[collection].insert.bind(db[collection]));
	}
	const app = {db, clock: {now_ms: () => 987654321}};
	await db.tournaments.insert_async({key: 'default', btp_enabled: false, automation_enabled: false,
		tabletoperator_enabled: false, btp_settings: {check_in_per_match: false, pause_duration_ms: 0}});
	await db.locations.insert_async([
		{_id: 'north', tournament_key: 'default', name: 'North', highlight: 4},
		{_id: 'south', tournament_key: 'default', name: 'South', highlight: 6},
	]);
	await db.courts.insert_async([
		{_id: 'court-1', tournament_key: 'default', location_id: 'north', num: 1, btp_id: 1},
		{_id: 'court-2', tournament_key: 'default', location_id: 'south', num: 2, btp_id: 2},
	]);
	await db.matches.insert_async({_id: 'match-1', tournament_key: 'default', score_status: 'normal', presses: [], btp_match_ids: [{id: 1, draw: 1}],
		setup: {state: 'scheduled', now_on_court: false, is_match: true, incomplete: false,
			event_name: 'ME U17', match_num: 1, counting: '3x21', teams: [
				{players: [{btp_id: 101, firstname: 'One', lastname: 'Player', checked_in: true}]},
				{players: [{btp_id: 102, firstname: 'Two', lastname: 'Player', checked_in: true}]},
			]}});
	const read = () => db.matches.findOne_async({_id: 'match-1'});
	const edit = async (changes = {}, extra = {}) => {
		const previous = await read();
		const match = {...previous, ...extra, setup: {...previous.setup, ...changes}};
		return new Promise((resolve, reject) => admin.handle_match_edit(app,
			{respond: (_msg, error) => error ? reject(error) : resolve()},
			{type: 'match_edit', tournament_key: 'default', id: 'match-1', match, old_court: previous.setup.court_id || 'not_on_court'}));
	};
	return {db, app, read, edit};
}

describe('match edit status and place', function() {
	it('rejects preparation without a location before changing anything', async function() {
		const {db, read, edit} = await fixture(), previous = await read();
		await assert.rejects(edit({state: 'preparation'}), /Ort oder ein Feld/);
		assert.deepStrictEqual(await read(), previous);
		assert.strictEqual((await db.tabletoperators.find_async({})).length, 0);
	});
	it('rejects an unknown preparation location', async function() {
		const {read, edit} = await fixture(), previous = await read();
		await assert.rejects(edit({state: 'preparation', location_id: 'elsewhere'}), /Ort oder ein Feld/);
		assert.deepStrictEqual(await read(), previous);
	});
	it('uses the only location automatically for preparation', async function() {
		const {db, read, edit} = await fixture();
		await db.locations.remove_async({_id: 'south'}, {});
		await edit({state: 'preparation'});
		assert.strictEqual((await read()).setup.location_id, 'north');
		assert.strictEqual((await read()).setup.state, 'preparation');
	});
	it('persists a location-only preparation call with the correct highlight and timestamp', async function() {
		const {read, edit} = await fixture();
		await edit({state: 'preparation', location_id: 'south'});
		const match = await read();
		assert.strictEqual(match.setup.state, 'preparation');
		assert.strictEqual(match.setup.location_id, 'south');
		assert.strictEqual(match.setup.court_id, undefined);
		assert.strictEqual(match.setup.highlight, 6);
		assert.strictEqual(match.setup.preparation_call_timestamp, 987654321);
	});
	it('keeps the selected court and other edits when entering preparation', async function() {
		const {read, edit} = await fixture();
		await edit({state: 'preparation', court_id: 'court-2', location_id: 'north', override_colors: {bg0: '#123456'}});
		const match = await read();
		assert.strictEqual(match.setup.state, 'preparation');
		assert.strictEqual(match.setup.location_id, 'south');
		assert.strictEqual(match.setup.court_id, 'court-2');
		assert.strictEqual(match.setup.override_colors.bg0, '#123456');
	});
	it('rejects on-court status without a court, even with a location', async function() {
		const {read, edit} = await fixture(), previous = await read();
		await assert.rejects(edit({now_on_court: true, location_id: 'north'}), /Feld ausgewählt/);
		assert.deepStrictEqual(await read(), previous);
	});
	it('rejects a court that does not belong to the tournament', async function() {
		const {db, read, edit} = await fixture(), previous = await read();
		await db.courts.insert_async({_id: 'foreign', tournament_key: 'other'});
		await assert.rejects(edit({now_on_court: true, court_id: 'foreign'}), /gehört nicht/);
		assert.deepStrictEqual(await read(), previous);
	});
	it('calls a real court and derives its location', async function() {
		const {db, read, edit} = await fixture();
		await edit({now_on_court: true, court_id: 'court-2'});
		const match = await read();
		assert.strictEqual(match.setup.state, 'oncourt');
		assert.strictEqual(match.setup.location_id, 'south');
		assert.strictEqual((await db.courts.findOne_async({_id: 'court-2'})).match_id, match._id);
	});
	it('returns an active game to preparation and releases its old court', async function() {
		const {db, read, edit} = await fixture();
		await edit({now_on_court: true, court_id: 'court-2'});
		await edit({state: 'preparation', now_on_court: false, court_id: '', location_id: 'north'});
		const match = await read();
		assert.strictEqual(match.setup.state, 'preparation');
		assert.strictEqual(match.setup.location_id, 'north');
		assert.strictEqual(match.setup.highlight, 4);
		assert.strictEqual(match.setup.called_timestamp, undefined);
		assert.strictEqual((await db.courts.findOne_async({_id: 'court-2'})).match_id, null);
	});
	it('releases the actual old court when an active game becomes unassigned', async function() {
		const {db, read, edit} = await fixture();
		await edit({now_on_court: true, court_id: 'court-2'});
		await edit({state: 'scheduled', now_on_court: false, court_id: '', location_id: undefined});
		assert.strictEqual((await read()).setup.state, 'scheduled');
		assert.strictEqual((await db.courts.findOne_async({_id: 'court-2'})).match_id, null);
	});
	it('rejects setting finished through an ordinary edit', async function() {
		const {read, edit} = await fixture(), previous = await read();
		await assert.rejects(edit({state: 'finished'}), /Spielende bestätigen/);
		assert.deepStrictEqual(await read(), previous);
	});
	it('keeps a finished game and its historical result when editing other data', async function() {
		const {db, read, edit} = await fixture();
		await db.matches.update_async({_id: 'match-1'}, {$set: {'setup.state': 'finished', 'setup.called_timestamp': 111,
			'setup.court_id': 'court-2', team1_won: false, btp_winner: 2, end_ts: 222, network_score: [[19, 21], [18, 21]]}}, {});
		await edit({override_colors: {bg0: '#abcdef'}});
		const match = await read();
		assert.strictEqual(match.setup.state, 'finished');
		assert.strictEqual(match.setup.called_timestamp, 111);
		assert.strictEqual(match.end_ts, 222);
		assert.strictEqual(match.team1_won, false);
		assert.deepStrictEqual(match.network_score, [[19, 21], [18, 21]]);
		assert.strictEqual((await db.courts.findOne_async({_id: 'court-2'})).match_id, undefined);
	});
	for (const [field, value] of [['state', 'scheduled'], ['now_on_court', true], ['court_id', 'court-1'],
		['location_id', 'north'], ['umpire', {name: 'Other umpire'}], ['service_judge', {name: 'Other judge'}],
		['tabletoperators', [{name: 'Other operator'}]]]) {
		it('rejects changing '+field+' on a finished game without any write', async function() {
			const {db, read, edit} = await fixture();
			await db.matches.update_async({_id: 'match-1'}, {$set: {'setup.state': 'finished', 'setup.court_id': 'court-2',
				'setup.location_id': 'south', team1_won: false, btp_winner: 2, end_ts: 222}}, {});
			const previous = await read();
			await assert.rejects(edit({[field]: value}), /Abschluss zurücknehmen/);
			assert.deepStrictEqual(await read(), previous);
			assert.deepStrictEqual(await db.tabletoperators.find_async({}), []);
		});
	}
	it('rejects tablet replacement and release commands even when the finished setup is unchanged', async function() {
		const {db, read} = await fixture();
		await db.matches.update_async({_id: 'match-1'}, {$set: {'setup.state': 'finished'}}, {});
		const match = await read();
		for (const assignment of [{tabletoperator_assignment_id: '__release_tabletoperators__'}, {tabletoperator_replacement_name: 'Other'}, {tabletoperator_replacement_btp_id: '123'}]) {
			await assert.rejects(new Promise((resolve, reject) => admin.handle_match_edit({db},
				{respond: (_msg, err) => err ? reject(err) : resolve()},
				{tournament_key: 'default', id: match._id, match: structuredClone(match), old_court: '', ...assignment})), /Abschluss zurücknehmen/);
			assert.deepStrictEqual(await read(), match);
		}
	});
	it('waits for an in-flight finish before validating a concurrent stale edit', async function() {
		const {db, read, edit} = await fixture(), queue = require('../bts/update_queue');
		let release, entered;
		const ready = new Promise(resolve => {entered = resolve;});
		const finishing = queue.execute_locked([queue.lock_keys.match('default', 'match-1')], async () => {
			entered();await new Promise(resolve => {release = resolve;});
			await db.matches.update_async({_id: 'match-1'}, {$set: {'setup.state': 'finished', end_ts: 1234}}, {});
		});
		await ready;
		const saving = edit({court_id: 'court-1', now_on_court: true});
		release();await finishing;
		await assert.rejects(saving, /Abschluss zurücknehmen/);
		assert.strictEqual((await read()).setup.state, 'finished');
		assert.strictEqual((await db.courts.findOne_async({_id: 'court-1'})).match_id, undefined);
	});
});
