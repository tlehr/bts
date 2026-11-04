'use strict';

const assert = require('assert');
const admin = require('../bts/admin');
const database = require('../bts/database');

describe('Fixed display protocol settings', function() {
	let app, changes;
	beforeEach(async function() {
		changes = [];
		app = {db: await database.init_test(), speech: {changed: (_key, type, value) => changes.push({type, value})}};
		await new Promise((resolve, reject) => app.db.tournaments.insert({
			key: 'fixed-protocol', displaysettings_general: 'display', displaysettings_general_tablet: 'tablet',
			bupws_v2_enabled: false,
		}, error => error ? reject(error) : resolve()));
	});
	const read = app => app.db.tournaments.findOne_async({key: 'fixed-protocol'});
	const save = (app, field, value, bulk = false) => new Promise((resolve, reject) => {
		const ws = {respond: (_message, error) => error ? reject(error) : resolve()};
		if (bulk) admin.handle_tournament_edit_props(app, ws, {key: 'fixed-protocol', props: {[field]: value}});
		else admin.handle_tournament_edit_prop(app, ws, {key: 'fixed-protocol', field, value});
	});

	it('rejects attempts to change the removed protocol setting through the single-property API', async function() {
		for (const value of [false, true]) await assert.rejects(save(app, 'bupws_v2_enabled', value), error => /Unsupported field/.test(error.message));
		assert.strictEqual((await read(app)).bupws_v2_enabled, false);
		assert.deepStrictEqual(changes, []);
	});

	it('ignores the obsolete protocol field in bulk updates while saving the acknowledgement preference', async function() {
		await new Promise((resolve, reject) => admin.handle_tournament_edit_props(app,
			{respond: (_message, error) => error ? reject(error) : resolve()},
			{key: 'fixed-protocol', props: {bupws_v2_enabled: true, bup_v2_admin_wait_for_score_updates: true}}));
		const tournament = await read(app);
		assert.strictEqual(tournament.bupws_v2_enabled, false);
		assert.strictEqual(tournament.bup_v2_admin_wait_for_score_updates, true);
	});

	for (const bulk of [false, true]) {
		it('retains acknowledgement saves and notifications through the ' + (bulk ? 'bulk' : 'single-property') + ' API', async function() {
			for (const value of [true, false]) {
				await save(app, 'bup_v2_admin_wait_for_score_updates', value, bulk);
				assert.strictEqual((await read(app)).bup_v2_admin_wait_for_score_updates, value);
				assert.strictEqual(changes.at(-1).type, bulk ? 'props' : 'prop_changed');
				if (bulk) assert.strictEqual(changes.at(-1).value.bup_v2_admin_wait_for_score_updates, value);
				else assert.deepStrictEqual(changes.at(-1).value, {field: 'bup_v2_admin_wait_for_score_updates', value});
			}
		});
	}
});
