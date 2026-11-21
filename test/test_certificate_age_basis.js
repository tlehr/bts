'use strict';

const assert = require('assert');
const {promisify} = require('util');
const {_describe, _it} = require('./tutils');
const admin = require('../bts/admin');
const database = require('../bts/database');

_describe('Certificate age cutoff settings', () => {
	for (const handler of ['handle_tournament_edit_props', 'handle_tournament_edit_prop']) {
		const message = value => ({key: 'age-basis-test', ...(handler.endsWith('_props')
			? {props: {certificate_senior_age_basis: value}}
			: {field: 'certificate_senior_age_basis', value})});

		_it(`persists all four cutoff choices through ${handler}`, async () => {
			const db = await database.init_test();
			await promisify(db.tournaments.insert.bind(db.tournaments))({key: 'age-basis-test', displaysettings_general: 'display', displaysettings_general_tablet: 'tablet'});
			for (const value of ['season', 'previous_calendar', 'previous_season', 'calendar']) {
				await new Promise((resolve, reject) => admin[handler]({db}, {
					respond(_message, error) {if (error) reject(error);else resolve();},
				}, message(value)));
				const stored = await promisify(db.tournaments.findOne.bind(db.tournaments))({key: 'age-basis-test'});
				assert.strictEqual(stored.certificate_senior_age_basis, value);
			}
		});

		_it(`rejects unsupported cutoff choices before writing through ${handler}`, () => {
			for (const value of ['', '2026', 'Season', null, 2026, {}]) {
				let error;
				admin[handler]({db: {tournaments: {findOne() {throw new Error('Database must not be touched');}}}}, {
					respond(_message, err) {error = err;},
				}, message(value));
				assert(error?.message.includes('letztes Kalenderjahr oder letzte Saison'));
			}
		});
	}
});
