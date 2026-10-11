'use strict';

const assert = require('assert');

const admin = require('../bts/admin');
const database = require('../bts/database');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
		});
	});
}

describe('admin tournament reset', function() {
	it('clears volatile tournament data and keeps reusable configuration', async function() {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1234567890 } };

		await insert(db, 'tournaments', {
			key: 'default',
			name: 'Old Tournament',
			tguid: 'old-guid',
			btp_enabled: true,
			btp_autofetch_enabled: true,
			btp_ip: '192.0.2.5',
			btp_password: 'secret',
			btp_settings: { tournament_urn: 'old-btp' },
			warmup_timer_behavior: 'call-down',
			call_preparation_matches_automatically_enabled: true,
			call_next_possible_scheduled_match_in_preparation: true,
			preparation_call_min_gap_seconds: 17,
			preparation_call_block_ahead_limit_enabled: true,
			preparation_call_block_ahead_limit: 3,
			official_rotation_mode: 'umpire_only',
			technical_official_auto_assignment_mode: 'least_recently_used',
			technical_official_break_after_assignment_seconds: 120,
			ticker_enabled: true,
			ticker_url: 'https://ticker.example.test',
			ticker_password: 'ticker-secret',
			displaysettings_general: 'display-a',
			displaysettings_general_tablet: 'tablet-a',
			events: { events: [{ id: 1, name: 'HE' }] },
		});
		await insert(db, 'matches', { _id: 'm1', tournament_key: 'default' });
		await insert(db, 'tabletoperators', { _id: 'to1', tournament_key: 'default' });
		await insert(db, 'logs', { _id: 'l1', tournament_key: 'default' });
		await insert(db, 'courts', { _id: 'default_1', tournament_key: 'default', num: 1, match_id: 'm1' });
		await insert(db, 'locations', { _id: 'loc1', tournament_key: 'default', name: 'Old Hall' });
		await insert(db, 'umpires', {
			_id: 'u1',
			tournament_key: 'default',
			name: 'Reusable Official',
			is_umpire: true,
			status: 'ready',
			court_id: 'default_1',
			umpire_on_court: 'default_1',
			service_judge_on_court: null,
			last_time_on_court_ts: 42,
			umpire_manual_pause: 99,
		});
		await insert(db, 'normalizations', { _id: 'n1', tournament_key: 'default', origin: 'A', replace: 'B' });
		await insert(db, 'displaysettings', {
			id: 'display-a',
			devicemode: 'display',
			description: 'Display',
			displaymode_style: 'tournament_overview_dm',
			d_tournament_overview_courts: '6,5,4,3,2',
		});
		await insert(db, 'displaysettings', { id: 'tablet-a', devicemode: 'umpire', description: 'Tablet' });
		await insert(db, 'display_court_displaysettings', {
			_id: 'd1',
			tournament_key: 'default',
			client_id: 'monitor',
			court_id: 'default_1',
			displaysetting_id: 'display-a',
		});
		await insert(db, 'display_court_displaysettings', {
			_id: 'd2',
			client_id: 'tablet',
			court_id: 'default_2',
			displaysetting_id: 'tablet-a',
		});

		await admin.reset_tournament_to_empty_default(app, 'default');

		assert.deepStrictEqual(await db.matches.find_async({ tournament_key: 'default' }), []);
		assert.deepStrictEqual(await db.tabletoperators.find_async({ tournament_key: 'default' }), []);
		assert.deepStrictEqual(await db.logs.find_async({ tournament_key: 'default' }), []);
		assert.deepStrictEqual(await db.courts.find_async({ tournament_key: 'default' }), []);
		assert.deepStrictEqual(await db.locations.find_async({ tournament_key: 'default' }), []);
		assert.deepStrictEqual(await db.umpires.find_async({ tournament_key: 'default' }), []);

		const tournament = await db.tournaments.findOne_async({ key: 'default' });
		assert.strictEqual(tournament.name, 'Default');
		assert.strictEqual(tournament.tguid, undefined);
		assert.strictEqual(tournament.btp_enabled, false);
		assert.strictEqual(tournament.btp_autofetch_enabled, false);
		assert.strictEqual(tournament.btp_ip, '192.0.2.5');
		assert.strictEqual(tournament.btp_password, 'secret');
		assert.deepStrictEqual(tournament.btp_settings, { tournament_urn: 'old-btp' });
		assert.strictEqual(tournament.warmup_timer_behavior, 'call-down');
		assert.strictEqual(tournament.call_preparation_matches_automatically_enabled, true);
		assert.strictEqual(tournament.call_next_possible_scheduled_match_in_preparation, true);
		assert.strictEqual(tournament.preparation_call_min_gap_seconds, 17);
		assert.strictEqual(tournament.preparation_call_block_ahead_limit_enabled, true);
		assert.strictEqual(tournament.preparation_call_block_ahead_limit, 3);
		assert.strictEqual(tournament.official_rotation_mode, 'umpire_only');
		assert.strictEqual(tournament.technical_official_auto_assignment_mode, 'least_recently_used');
		assert.strictEqual(tournament.technical_official_break_after_assignment_seconds, 120);
		assert.strictEqual(tournament.ticker_enabled, true);
		assert.strictEqual(tournament.ticker_url, 'https://ticker.example.test');
		assert.strictEqual(tournament.ticker_password, 'ticker-secret');
		assert.deepStrictEqual(tournament.events, { events: [] });
		assert.strictEqual(tournament.displaysettings_general, 'display-a');
		assert.strictEqual(tournament.displaysettings_general_tablet, 'tablet-a');

		assert.strictEqual((await db.normalizations.find_async({ tournament_key: 'default' })).length, 1);
		const displaysettings = await db.displaysettings.find_async({});
		assert.strictEqual(displaysettings.length, 3);
		const display_setting = displaysettings.find(setting => setting.id === 'display-a');
		assert.strictEqual(display_setting.displaymode_style, 'tournament_overview_dm');
		assert.strictEqual(display_setting.d_tournament_overview_courts, '6,5,4,3,2');
		const registration_setting = displaysettings.find(setting => setting.id === 'default_default_registration');
		assert(registration_setting);
		assert.strictEqual(registration_setting.tablet_mode, 'registration_check');
		const display_assignments = await db.display_court_displaysettings.find_async({});
		assert.strictEqual(display_assignments.length, 2);
		assert.deepStrictEqual(display_assignments.map(display => display.client_id).sort(), ['monitor', 'tablet']);
		assert(display_assignments.every(display => display.court_id === undefined));
	});
});
