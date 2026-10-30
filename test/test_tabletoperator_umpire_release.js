'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const match_utils = require('../bts/match_utils');
const admin = require('../bts/admin');
let sequence = 0;

async function fixture(options = {}) {
	const db = await database.init_test(), key = 'umpire-release-' + (++sequence);
	const tournament = { key, btp_enabled: false, tabletoperator_enabled: true,
		tabletoperator_release_on_umpire_enabled: true, tabletoperator_assignment_scope: 'same_court',
		technical_official_auto_assignment_mode: 'manual_only', official_rotation_mode: 'umpire_only',
		tabletoperator_set_break_after_tabletservice: true, tabletoperator_break_seconds: 300,
		btp_settings: { check_in_per_match: true }, ...options };
	await promisify(db.tournaments.insert.bind(db.tournaments))(tournament);
	await promisify(db.courts.insert.bind(db.courts))({ _id: 'court_1', tournament_key: key, is_active: true, has_umpire: true });
	const umpire = { _id: 'umpire', name: 'Schiedsrichter', is_umpire: true, status: 'ready' };
	await promisify(db.umpires.insert.bind(db.umpires))({ ...umpire, tournament_key: key });
	const match = { _id: 'next', tournament_key: key, btp_match_ids: [{ id: 10 }], setup: { is_match: true, counting: '3x21', state: 'scheduled',
		now_on_court: false, court_id: 'court_1', match_num: 10, umpire,
		teams: [{ players: [{ btp_id: 1, name: 'Spieler 1' }] }, { players: [{ btp_id: 2, name: 'Spieler 2' }] }] } };
	await promisify(db.matches.insert.bind(db.matches))([match, { _id: 'future', tournament_key: key, setup: { state: 'scheduled',
		teams: [{ players: [{ btp_id: 3, name: 'Bediener 3', checked_in: false }, { btp_id: 4, name: 'Bediener 4', checked_in: false }] },
			{ players: [{ btp_id: 7, name: 'Spieler 7' }] }] }, presses: [{ type: 'point', team: 0 }] }]);
	await promisify(db.tabletoperators.insert.bind(db.tabletoperators))([
		{ _id: 'oldest-other', tournament_key: key, court: null, played_on_court: 'court_2', start_ts: 1, tabletoperator: [{ btp_id: 5, name: 'Anderes Feld' }] },
		{ _id: 'waiting', tournament_key: key, court: null, played_on_court: 'court_1', start_ts: 2, match_id: 'previous',
			tabletoperator: [{ btp_id: 3, name: 'Bediener 3' }, { btp_id: 4, name: 'Bediener 4' }] },
		{ _id: 'later', tournament_key: key, court: null, played_on_court: 'court_1', start_ts: 3, tabletoperator: [{ btp_id: 6, name: 'Später' }] },
	]);
	return { db, tournament, match, clock: { now_ms: () => 1000000 } };
}
async function call(app) {
	const match = await app.db.matches.findOne_async({ _id: 'next' });
	match.setup.now_on_court = true;
	await new Promise((resolve, reject) => match_utils.call_match(app, app.tournament, match, null, error => error ? reject(error) : resolve()));
	return app.db.matches.findOne_async({ _id: 'next' });
}

describe('Tablet operator release when an umpire takes over', function() {
	it('waives exactly the oldest entry from this court, keeps the pair together and creates no service break', async function() {
		const app = await fixture(), match = await call(app);
		assert(!match.setup.tabletoperators?.length);
		const released = await app.db.tabletoperators.findOne_async({ _id: 'waiting' });
		assert.strictEqual(released.court, -1);
		assert.strictEqual(released.release_reason, 'umpire');
		assert.strictEqual(released.released_for_match_id, 'next');
		assert.strictEqual(released.played_on_court, 'court_1');
		assert.strictEqual(released.tabletoperator.length, 2);
		for (const id of ['oldest-other', 'later']) assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: id })).court, null);
		const future = await app.db.matches.findOne_async({ _id: 'future' });
		assert(future.setup.teams[0].players.every(player => !player.now_tablet_on_court && !player.tablet_break_active && !player.tablet_break_until_ts));
		assert.deepStrictEqual(future.presses, [{ type: 'point', team: 0 }]);
	});
	it('leaves the queue unchanged when the option is off and no extra operator is needed', async function() {
		const app = await fixture({ tabletoperator_release_on_umpire_enabled: false });
		await call(app);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'waiting' })).court, null);
	});
	it('assigns a genuine tablet operator when both umpire and tablet operator are requested', async function() {
		const app = await fixture({ tabletoperator_with_umpire_enabled: true }), match = await call(app);
		assert.deepStrictEqual(match.setup.tabletoperators.map(player => player.btp_id), [3, 4]);
		const row = await app.db.tabletoperators.findOne_async({ _id: 'waiting' });
		assert.strictEqual(row.court, 'court_1');
		assert.strictEqual(row.release_reason, undefined);
	});
	it('prefers a reserved preparation operator and releases its flags without waiving another entry', async function() {
		const app = await fixture();
		await app.db.matches.update_async({ _id: 'next' }, { $set: { 'setup.tabletoperators': [{ btp_id: 3 }, { btp_id: 4 }] } }, {});
		await app.db.matches.update_async({ _id: 'future' }, { $set: { 'setup.teams.0.players.0.now_tablet_on_court': 'prep_call' } }, {});
		await app.db.tabletoperators.update_async({ _id: 'waiting' }, { $set: { court: 'prep_call', assigned_match_id: 'next' } }, {});
		const match = await call(app);
		assert(!match.setup.tabletoperators?.length);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'waiting' })).court, -1);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'later' })).court, null);
		assert.strictEqual((await app.db.matches.findOne_async({ _id: 'future' })).setup.teams[0].players[0].now_tablet_on_court, false);
	});
	it('can save the option through the existing live settings endpoint', async function() {
		const app = await fixture({ tabletoperator_release_on_umpire_enabled: false });
		await new Promise((resolve, reject) => admin.handle_tournament_edit_prop(app,
			{ respond: (_message, error) => error ? reject(error) : resolve() },
			{ key: app.tournament.key, field: 'tabletoperator_release_on_umpire_enabled', value: true }));
		assert.strictEqual((await app.db.tournaments.findOne_async({ key: app.tournament.key })).tabletoperator_release_on_umpire_enabled, true);
		await new Promise((resolve, reject) => admin.handle_tournament_edit_props(app,
			{ respond: (_message, error) => error ? reject(error) : resolve() },
			{ key: app.tournament.key, props: { tabletoperator_release_on_umpire_enabled: false } }));
		assert.strictEqual((await app.db.tournaments.findOne_async({ key: app.tournament.key })).tabletoperator_release_on_umpire_enabled, false);
	});
	for (const umpire of [undefined, { service_judge: true }]) {
		it('keeps normal tablet assignment when the match has ' + (umpire ? 'only a service judge' : 'no umpire'), async function() {
			const app = await fixture();
			await app.db.matches.update_async({ _id: 'next' }, { $unset: { 'setup.umpire': true }, ...(umpire ? { $set: { 'setup.service_judge': { _id: 'judge', name: 'Aufschlagrichter' } } } : {}) }, {});
			const match = await call(app);
			assert.deepStrictEqual(match.setup.tabletoperators.map(person => person.btp_id), [3, 4]);
			assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'waiting' })).release_reason, undefined);
		});
	}
	it('releases even when the waiting timer has not elapsed, and repeated calls do not waive another entry', async function() {
		const app = await fixture();
		await app.db.tabletoperators.update_async({ _id: 'waiting' }, { $set: { start_ts: 2000000 } }, {});
		await app.db.tabletoperators.update_async({ _id: 'later' }, { $set: { start_ts: 3000000 } }, {});
		await call(app);await call(app);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'waiting' })).court, -1);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'later' })).court, null);
	});
	it('does not waive an entry if the requested court is occupied', async function() {
		const app = await fixture();
		await promisify(app.db.matches.insert.bind(app.db.matches))({ _id: 'occupied', tournament_key: app.tournament.key,
			setup: { now_on_court: true, court_id: 'court_1', teams: [{ players: [{ btp_id: 20 }] }, { players: [{ btp_id: 21 }] }] } });
		await assert.rejects(call(app), /already occupied/);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'waiting' })).court, null);
	});
	it('never waives an operator from another court as a location or global fallback', async function() {
		for (const scope of ['any', 'same_location', 'same_court']) {
			const app = await fixture({ tabletoperator_assignment_scope: scope });
			await app.db.tabletoperators.update_async({ played_on_court: 'court_1' }, { $set: { court: -1 } }, { multi: true });
			await call(app);
			assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'oldest-other' })).court, null);
		}
	});
	it('releases after an umpire is assigned automatically during the court call', async function() {
		const app = await fixture({ technical_official_auto_assignment_mode: 'on_match_call_if_possible' });
		await app.db.matches.update_async({ _id: 'next' }, { $unset: { 'setup.umpire': true } }, {});
		const match = await call(app);
		assert.strictEqual(match.setup.umpire?._id, 'umpire');
		assert(!match.setup.tabletoperators?.length);
		assert.strictEqual((await app.db.tabletoperators.findOne_async({ _id: 'waiting' })).court, -1);
	});
});
