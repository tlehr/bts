'use strict';

const assert = require('assert');

const database = require('../bts/database');
const displaysettings_defaults = require('../bts/displaysettings_defaults');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
		});
	});
}

describe('display settings defaults', function() {
	it('uses the existing catalog to find the registration profile and preserves the saved defaults', async function() {
		const db = await database.init_test(), app = { db }, tournament = { key: 'default' };
		await insert(db, 'tournaments', tournament);
		await displaysettings_defaults.ensure_default_displaysettings(app, tournament);
		const original = db.displaysettings.findOne_async;
		db.displaysettings.findOne_async = () => { throw new Error('redundant profile lookup'); };
		try {
			const result = await displaysettings_defaults.ensure_default_displaysettings(app, { ...tournament });
			assert.strictEqual(result.displaysettings.length, 3);
			assert.strictEqual(result.tournament.displaysettings_general, tournament.displaysettings_general);
			assert.strictEqual(result.tournament.displaysettings_general_tablet, tournament.displaysettings_general_tablet);
		} finally { db.displaysettings.findOne_async = original; }
	});
	it('builds a tablet registration setting', function() {
		const setting = displaysettings_defaults.build_default_registration_setting({ key: 'default' });

		assert.strictEqual(setting.id, 'default_default_registration');
		assert.strictEqual(setting.description, 'Anmeldung');
		assert.strictEqual(setting.devicemode, 'umpire');
		assert.strictEqual(setting.tablet_mode, 'registration_check');
		assert.strictEqual(setting.style, 'hidden');
	});

	it('adds the registration setting to existing tournaments', async function() {
		const db = await database.init_test();
		const app = { db };
		const tournament = { key: 'default', name: 'Default' };

		await insert(db, 'displaysettings', displaysettings_defaults.build_default_display_setting(tournament));
		await insert(db, 'displaysettings', displaysettings_defaults.build_default_tablet_setting(tournament));

		const result = await displaysettings_defaults.ensure_default_displaysettings(app, tournament);
		const registration = result.displaysettings.find((setting) => setting.id === 'default_default_registration');

		assert(registration);
		assert.strictEqual(registration.description, 'Anmeldung');
		assert.strictEqual(registration.tablet_mode, 'registration_check');
		assert(await db.displaysettings.findOne_async({ id: 'default_default_registration' }));
	});
});
