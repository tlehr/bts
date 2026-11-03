'use strict';

const assert = require('assert');
const admin = require('../bts/admin');
const database = require('../bts/database');

describe('official rotation activation and selected mode', function() {
	for (const bulk of [false, true]) {
		describe(bulk ? 'bulk settings endpoint' : 'single-property endpoint', function() {
			let app, changes;
			beforeEach(async function() {
				changes = [];
				app = {
					db: await database.init_test(),
					speech: {changed: (key, type, value) => changes.push({key, type, value})},
				};
				await new Promise((resolve, reject) => app.db.tournaments.insert({
					key: 'rotation-test', automation_enabled: false,
					displaysettings_general: 'display', displaysettings_general_tablet: 'tablet',
				}, error => error ? reject(error) : resolve()));
			});
			const read = app => app.db.tournaments.findOne_async({key: 'rotation-test'});
			const save = (app, field, value) => new Promise((resolve, reject) => {
				const ws = {respond: (_message, error) => error ? reject(error) : resolve()};
				if (bulk) admin.handle_tournament_edit_props(app, ws, {key: 'rotation-test', props: {[field]: value}});
				else admin.handle_tournament_edit_prop(app, ws, {key: 'rotation-test', field, value});
			});

			it('preserves the legacy dual rotation default when switched off', async function() {
				await save(app, 'official_rotation_mode', 'disabled');
				const tournament = await read(app);
				assert.strictEqual(tournament.official_rotation_mode, 'disabled');
				assert.strictEqual(tournament.official_rotation_selected_mode, 'umpire_and_service_judge');
			});

			it('remembers single-umpire rotation across disabling and a fresh database read', async function() {
				await save(app, 'official_rotation_mode', 'umpire_only');
				await save(app, 'official_rotation_mode', 'disabled');
				const paused = await read(app);
				assert.strictEqual(paused.official_rotation_selected_mode, 'umpire_only');
				await save(app, 'official_rotation_mode', paused.official_rotation_selected_mode);
				assert.strictEqual((await read(app)).official_rotation_mode, 'umpire_only');
			});

			it('lets a legacy enabled tournament change modes without disabling rotation', async function() {
				await save(app, 'official_rotation_selected_mode', 'umpire_only');
				const tournament = await read(app);
				assert.strictEqual(tournament.official_rotation_mode, 'umpire_only');
				assert.strictEqual(tournament.official_rotation_selected_mode, 'umpire_only');
			});

			it('lets a paused area change mode without enabling rotation or overall automation', async function() {
				await save(app, 'official_rotation_mode', 'disabled');
				await save(app, 'official_rotation_selected_mode', 'umpire_only');
				const tournament = await read(app);
				assert.strictEqual(tournament.official_rotation_mode, 'disabled');
				assert.strictEqual(tournament.official_rotation_selected_mode, 'umpire_only');
				assert.strictEqual(tournament.automation_enabled, false);
				await save(app, 'official_rotation_selected_mode', 'umpire_and_service_judge');
				assert.strictEqual((await read(app)).official_rotation_mode, 'disabled');
			});

			it('synchronizes the selected mode after a legacy board control changes rotation', async function() {
				await save(app, 'official_rotation_selected_mode', 'umpire_only');
				await save(app, 'official_rotation_mode', 'umpire_and_service_judge');
				await save(app, 'official_rotation_mode', 'disabled');
				assert.strictEqual((await read(app)).official_rotation_selected_mode, 'umpire_and_service_judge');
			});

			it('notifies other browsers about both persisted fields before acknowledging', async function() {
				await save(app, 'official_rotation_selected_mode', 'umpire_only');
				if (bulk) {
					assert.strictEqual(changes.length, 1);
					assert.strictEqual(changes[0].type, 'props');
					assert.strictEqual(changes[0].value.official_rotation_mode, 'umpire_only');
					assert.strictEqual(changes[0].value.official_rotation_selected_mode, 'umpire_only');
				} else {
					assert(changes.every(change => change.key === 'rotation-test' && change.type === 'prop_changed'));
					assert.deepStrictEqual(Object.fromEntries(changes.map(change => [change.value.field, change.value.value])), {
						official_rotation_mode: 'umpire_only', official_rotation_selected_mode: 'umpire_only',
					});
				}
			});

			it('rejects invalid modes without changing stored settings or notifying browsers', async function() {
				const before = await read(app);
				for (const [field, value] of [
					['official_rotation_mode', true], ['official_rotation_mode', 'invalid'],
					['official_rotation_selected_mode', 'disabled'], ['official_rotation_selected_mode', null],
				]) await assert.rejects(save(app, field, value), error => error.message === 'Invalid official rotation mode');
				assert.deepStrictEqual(await read(app), before);
				assert.deepStrictEqual(changes, []);
			});

			it('leaves both fields unchanged when their atomic database write fails', async function() {
				await save(app, 'official_rotation_mode', 'disabled');
				const before = await read(app);
				changes.length = 0;
				app.db.tournaments.update = (_query, _update, _options, callback) => callback(new Error('Synthetic rotation save failure'));
				await assert.rejects(save(app, 'official_rotation_selected_mode', 'umpire_only'), /Synthetic rotation save failure/);
				assert.deepStrictEqual(await read(app), before);
				assert.deepStrictEqual(changes, []);
			});
		});
	}
});
