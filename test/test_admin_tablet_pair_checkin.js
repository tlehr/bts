'use strict';

const assert = require('assert');
const {promisify} = require('util');
const admin = require('../bts/admin');
const database = require('../bts/database');
const update_queue = require('../bts/update_queue');

let sequence = 0;
async function fixture(split = false) {
	const db = await database.init_test();
	const key = 'tablet-pair-' + (++sequence);
	await promisify(db.tournaments.insert.bind(db.tournaments))({key, btp_enabled: false, tabletoperator_split_doubles: split});
	await promisify(db.matches.insert.bind(db.matches))({_id: 'match', tournament_key: key,
		setup: {state: 'preparation', counting: '3x21', teams: [{players: []}, {players: []}],
			tabletoperators: [{btp_id: 11, name: 'Alex', checked_in: false}, {btp_id: 12, name: 'Sam', checked_in: true}]},
	});
	return {db, key};
}
function checkin(app, fields = {}) {
	return new Promise((resolve, reject) => admin.handle_match_participant_check_in(app,
		{respond: (_message, error) => error ? reject(error) : resolve()},
		{tournament_key: app.key, match_id: 'match', role: 'tabletoperator', participant_ids: [11, 12], checked_in: true, ...fields}));
}
const attendance = async app => (await app.db.matches.findOne_async({_id: 'match'})).setup.tabletoperators.map(person => person.checked_in);

describe('tablet pair check-in', function() {
	it('checks both operators in and out together through one normal match write', async function() {
		const app = await fixture();
		await checkin(app); assert.deepStrictEqual(await attendance(app), [true, true]);
		await checkin(app, {checked_in: false}); assert.deepStrictEqual(await attendance(app), [false, false]);
		assert.strictEqual((await app.db.matches.findOne_async({_id: 'match'})).btp_needsync, true);
	});
	it('rejects partial, foreign, duplicate and individually called groups without changing either person', async function() {
		for (const ids of [[11], [11, 99], [11, 11], '11,12']) {
			const app = await fixture(); await assert.rejects(checkin(app, {participant_ids: ids}), /pairing/);
			assert.deepStrictEqual(await attendance(app), [false, true]);
		}
		const app = await fixture(true); await assert.rejects(checkin(app), /individually/);
		assert.deepStrictEqual(await attendance(app), [false, true]);
	});
	it('keeps individual operator check-in available', async function() {
		const app = await fixture(true);
		await checkin(app, {participant_ids: undefined, participant_id: 11});
		assert.deepStrictEqual(await attendance(app), [true, true]);
		await checkin(app, {participant_ids: undefined, participant_id: 12, checked_in: false});
		assert.deepStrictEqual(await attendance(app), [true, false]);
	});
	it('validates the pairing after waiting for the match lock', async function() {
		const app = await fixture(); let release, started;
		const entered = new Promise(resolve => {started = resolve;});
		const gate = new Promise(resolve => {release = resolve;});
		const blocker = update_queue.execute_locked([update_queue.lock_keys.match(app.key, 'match')], async () => {started(); await gate;});
		await entered;
		const result = assert.rejects(checkin(app), /pairing/);
		try {await app.db.matches.update_async({_id: 'match'}, {$set: {'setup.tabletoperators.1.btp_id': 13}}, {});}
		finally {release();}
		await Promise.all([blocker, result]); assert.deepStrictEqual(await attendance(app), [false, true]);
	});
});
