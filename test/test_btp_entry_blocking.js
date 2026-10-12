'use strict';

const assert = require('assert');
const { promisify } = require('util');
const insert = (store, document) => promisify(store.insert.bind(store))(document);
const database = require('../bts/database');
const admin = require('../bts/admin');
const match_utils = require('../bts/match_utils');
const automation = require('../bts/match_automation');
const queue = require('../bts/update_queue');
const status = require('../static/js/btp_entry_status');

let serial = 0;
async function fixture(entry_status = 'DNS') {
	const db = await database.init_test(), key = 'dns-guard-' + ++serial;
	const tournament = await insert(db.tournaments, { key, btp_enabled: false,
		btp_settings: { check_in_per_match: true, pause_duration_ms: 0 } });
	const match = await insert(db.matches, { _id: 'match', tournament_key: key, score_status: 'normal',
		btp_match_ids: [{ draw: 5, planning: 3009 }],
		setup: { event_name: 'JE U13', match_num: 196, state: 'scheduled', is_match: true, counting: '3x21',
			teams: [{ players: [{ btp_id: 53, name: 'Blocked Player', checked_in: true, entries: { 5: entry_status || '<none>', 2: '<none>' } }] },
				{ players: [{ btp_id: 99, name: 'Opponent', checked_in: true }] }] } });
	const court = await insert(db.courts, { _id: 'court', tournament_key: key, num: 1,
		is_active: true, location_id: 'location', match_id: null });
	await insert(db.locations, { _id: 'location', tournament_key: key, name: 'Hall', highlight: 1 });
	const events = [];
	const app = { db, key, tournament, match, court, events, ws_servers: {
		admin: [{ send: raw => events.push(JSON.parse(raw)) }], bup: [] }, now: () => Date.now() };
	return app;
}

function request(app, handler, fields = {}) {
	return new Promise((resolve, reject) => admin[handler](app, {
		respond: (_msg, error) => error ? reject(error) : resolve(),
	}, { tournament_key: app.key, match_id: 'match', ...fields }));
}

async function unchanged(app, original) {
	assert.deepStrictEqual(await app.db.matches.findOne_async({ _id: 'match' }), original);
	assert.strictEqual((await app.db.courts.findOne_async({ _id: 'court' })).match_id, null);
}

for (const entry_status of ['DNS', 'WDN']) {
	describe('BTP ' + entry_status + ' player blocking', function() {
		it('rejects check-in through the API while allowing check-out', async function() {
			const app = await fixture(entry_status), original = await app.db.matches.findOne_async({ _id: 'match' });
			await assert.rejects(request(app, 'handle_match_player_check_in', { player_id: 53, checked_in: true }), new RegExp(entry_status));
			await unchanged(app, original);
			await request(app, 'handle_match_player_check_in', { player_id: 53, checked_in: false });
			assert.strictEqual((await app.db.matches.findOne_async({ _id: 'match' })).setup.teams[0].players[0].checked_in, false);
		});

		it('allows other disciplines and check-in after the imported status is removed', async function() {
			const app = await fixture(entry_status);
			await app.db.matches.update_async({ _id: 'match' }, { $set: { 'btp_match_ids.0.draw': 2 } }, {});
			await request(app, 'handle_match_player_check_in', { player_id: 53, checked_in: true });
			await app.db.matches.update_async({ _id: 'match' }, { $set: { 'btp_match_ids.0.draw': 5,
				'setup.teams.0.players.0.entries.5': '<none>' } }, {});
			await request(app, 'handle_match_player_check_in', { player_id: 53, checked_in: true });
		});

		it('checks the stored entry status after waiting for a check-in lock', async function() {
			const app = await fixture(null);
			let release, signal;
			const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { signal = resolve; });
			const held = queue.execute_locked([queue.lock_keys.match(app.key, 'match')], async () => { signal(); await gate; });
			await started;
			const denied = assert.rejects(request(app, 'handle_match_player_check_in', { player_id: 53, checked_in: true }), new RegExp(entry_status));
			try { await app.db.matches.update_async({ _id: 'match' }, { $set: { 'setup.teams.0.players.0.entries.5': entry_status } }, {}); }
			finally { release(); }
			await Promise.all([held, denied]);
		});

		it('blocks on-court calls and forced preparation against forged or stale browser data without writes', async function() {
			const app = await fixture(entry_status), original = await app.db.matches.findOne_async({ _id: 'match' });
			const stale = structuredClone(original); stale.setup.teams[0].players[0].entries[5] = '<none>';
			await assert.rejects(request(app, 'handle_match_call_on_court', { court_id: 'court' }), new RegExp(entry_status));
			await assert.rejects(request(app, 'handle_match_preparation_call', { match: stale, location_id: 'location' }), new RegExp(entry_status));
			stale.setup.court_id = 'court'; stale.setup.now_on_court = true;
			await assert.rejects(new Promise((resolve, reject) => match_utils.call_match(app, app.tournament, stale, null,
				(error, value) => error ? reject(error) : resolve(value), { reactivate: true })), new RegExp(entry_status));
			await unchanged(app, original);
		});

		it('prevents calling by match edit before changing assignments or result state', async function() {
			const app = await fixture(entry_status), original = await app.db.matches.findOne_async({ _id: 'match' });
			for (const on_court of [true, false]) {
				const proposed = structuredClone(original);
				proposed.setup.teams[0].players[0].entries[5] = '<none>';
				proposed.setup.now_on_court = on_court; proposed.setup.court_id = on_court ? 'court' : null;
				proposed.setup.state = on_court ? 'oncourt' : 'preparation'; proposed.setup.location_id = 'location';
				await assert.rejects(request(app, 'handle_match_edit', { id: 'match', match: proposed, old_court: null }), new RegExp(entry_status));
				await unchanged(app, original);
			}
		});

		it('excludes inactive entries even with readiness checks disabled, and reports it as a mandatory diagnostic rule', async function() {
			const app = await fixture(entry_status), match = app.match;
			const tournament = { ...app.tournament, courts: [app.court], matches: [match], locations: [{ _id: 'location', highlight: 1 }] };
			assert.strictEqual(automation.is_match_eligible_for_preparation(match, 'location', tournament), false);
			assert.strictEqual(automation.is_match_eligible_for_on_court_call(match, 'court', tournament), false);
			const preparation = automation.calculate_match_preparation_diagnostics(match, 'location', tournament);
			assert.strictEqual(preparation.manual_eligible, false);
			assert.strictEqual(preparation.rules.find(rule => rule.key === 'no_btp_inactive_player').passed, false);
			const court = automation.calculate_match_call_on_court_diagnostics(match, 'court', tournament);
			assert.strictEqual(court.rules.find(rule => rule.key === 'no_btp_inactive_player').passed, false);
			match.setup.teams[0].players[0].entries[5] = '<none>';
			assert.strictEqual(automation.is_match_eligible_for_preparation(match, 'location', tournament), true);
			assert.strictEqual(automation.is_match_eligible_for_on_court_call(match, 'court', tournament), true);
		});

		it('rejects repeated player announcements using stored status, including legacy setup-only messages', async function() {
			const app = await fixture(entry_status), original = await app.db.matches.findOne_async({ _id: 'match' });
			const notify = admin.notify_change;
			admin.notify_change = (_app, key, ctype, val) => { if (key === app.key) app.events.push({ ctype, val }); };
			try {
				const stale = structuredClone(original); stale.setup.teams[0].players[0].entries[5] = '<none>';
				for (const handler of ['handle_begin_to_play_call', 'handle_announce_match_manually', 'handle_second_call_team_one',
					'handle_second_call_team_two', 'handle_second_preparation_call_team_one', 'handle_second_preparation_call_team_two']) {
					await assert.rejects(request(app, handler, { match: stale, setup: stale.setup }), new RegExp(entry_status));
				}
				await assert.rejects(request(app, 'handle_second_call_team_one', { match_id: undefined, setup: stale.setup }), new RegExp(entry_status));
				assert.deepStrictEqual(app.events, []);
				await unchanged(app, original);
				await app.db.matches.update_async({ _id: 'match' }, { $set: { 'setup.teams.0.players.0.entries.5': '<none>' } }, {});
				await request(app, 'handle_second_call_team_one', { setup: stale.setup });
				assert(app.events.some(event => event.ctype === 'second_call_team_one'));
			} finally { admin.notify_change = notify; }
		});

		it('supports per-player doubles status and team fallback without trusting stale aggregate labels', function() {
			const a = { btp_id: 1, entries: { 5: entry_status === 'DNS' ? '108' : '109', 2: '<none>' } }, b = { btp_id: 2, entries: { 5: '<none>' } };
			const match = { btp_match_ids: [{ draw: 5 }], setup: { teams: [{ entry_status, players: [a, b] }] } };
			assert.deepStrictEqual(status.blocked_players(match), [a]);
			delete a.entries; assert.deepStrictEqual(status.blocked_players(match), [a]);
			a.entries = { 5: '<none>' }; assert.deepStrictEqual(status.blocked_players(match), []);
		});

		it('allows a normal manual preparation call after status removal without holding a stale resource lock', async function() {
			const app = await fixture(entry_status);
			await app.db.matches.update_async({ _id: 'match' }, { $set: { 'setup.teams.0.players.0.entries.5': '<none>' } }, {});
			const current = await app.db.matches.findOne_async({ _id: 'match' });
			await request(app, 'handle_match_preparation_call', { match: current, location_id: 'location' });
			assert.strictEqual((await app.db.matches.findOne_async({ _id: 'match' })).setup.state, 'preparation');
		});

		it('preserves imported status when an older browser edits an otherwise uncalled match', async function() {
			const app = await fixture(entry_status), proposed = structuredClone(app.match);
			proposed.setup.teams[0].players[0].entries[5] = '<none>';
			proposed.setup.teams[0].entry_status = '<none>';
			await request(app, 'handle_match_edit', { id: 'match', match: proposed, old_court: null });
			const saved = await app.db.matches.findOne_async({ _id: 'match' });
			assert.strictEqual(saved.setup.teams[0].players[0].entries[5], entry_status);
			await assert.rejects(request(app, 'handle_match_call_on_court', { court_id: 'court' }), new RegExp(entry_status));
		});

		it('allows recording a withdrawal or walkover result while preserving the imported status', async function() {
			const app = await fixture(entry_status), proposed = structuredClone(app.match);
			proposed.score_status = entry_status === 'DNS' ? 'walkover' : 'retired';
			proposed.no_match_losing_team = 0;
			proposed.team1_won = false;
			proposed.btp_winner = 2;
			proposed.setup.state = 'finished';
			proposed.setup.now_on_court = false;
			await request(app, 'handle_match_edit', { id: 'match', match: proposed, old_court: null });
			const saved = await app.db.matches.findOne_async({ _id: 'match' });
			assert.strictEqual(saved.score_status, proposed.score_status);
			assert.strictEqual(saved.team1_won, false);
			assert.strictEqual(saved.setup.teams[0].players[0].entries[5], entry_status);
		});

		it('does not let an uncalled inactive match hold back the same player in another discipline', async function() {
			const app = await fixture(entry_status), mixed = structuredClone(app.match);
			mixed._id = 'mixed'; mixed.setup.event_name = 'MX U13'; mixed.setup.match_num = 197;
			mixed.btp_match_ids[0].draw = 2;
			const tournament = { ...app.tournament, matches: [app.match, mixed], courts: [app.court],
				locations: [{ _id: 'location', highlight: 1 }] };
			assert.strictEqual(automation.is_match_eligible_for_preparation(mixed, 'location', tournament), true);
			const selection = automation.calculate_location_preparation_selection(tournament, 'location');
			assert(selection.candidates.some(match => match._id === 'mixed'), 'indexed participant lookup must agree with ordinary checks');
			app.match.setup.now_on_court = true; app.match.setup.state = 'oncourt';
			assert.strictEqual(automation.is_match_eligible_for_preparation(mixed, 'location', tournament), false,
				'an already running inactive match remains a real dependency until it is ended or uncalled');
		});

		it('preserves current imported status across swapped teams and accepts newly cleared entry status', function() {
			const current = { setup: { teams: [{ entry_status, players: [{ btp_id: 1, entries: { 5: entry_status } }] },
				{ entry_status: '<none>', players: [{ btp_id: 2, entries: { 5: '<none>' } }] }] } };
			const draft = structuredClone(current); draft.setup.teams.reverse();
			draft.setup.teams[1].players[0].btp_id = '1'; draft.setup.teams[1].players[0].entries[5] = '<none>';
			draft.setup.teams[1].entry_status = '<none>';
			const before = JSON.stringify(current);
			require('../bts/match_entry_status').preserve(current, draft);
			assert.strictEqual(draft.setup.teams[1].entry_status, entry_status);
			assert.strictEqual(draft.setup.teams[1].players[0].entries[5], entry_status);
			assert.notStrictEqual(draft.setup.teams[1].players[0].entries, current.setup.teams[0].players[0].entries);
			assert.strictEqual(JSON.stringify(current), before);
			current.setup.teams[0].entry_status = '<none>'; current.setup.teams[0].players[0].entries[5] = '<none>';
			require('../bts/match_entry_status').preserve(current, draft);
			assert.strictEqual(draft.setup.teams[1].players[0].entries[5], '<none>');
		});
	});
}

describe('BTP entry status normalization', function() {
	it('normalizes numeric codes and keeps the first-match DNS policy separate from withdrawal', function() {
		const player = { btp_id: 1, name: 'Player', entries: {} };
		const match = { btp_match_ids: [{ draw: 5 }], setup: { teams: [{ players: [player] }] } };
		for (const [raw, label] of [[108, 'DNS'], ['108', 'DNS'], ['DNS', 'DNS'], [109, 'WDN'], ['109', 'WDN'], ['WDN', 'WDN']]) {
			player.entries[5] = raw;
			assert.strictEqual(status.player_blocking_status(match, player), label);
			assert.strictEqual(status.player_has_dns(match, player), label === 'DNS');
			assert(status.call_error(match).message.includes('Player (' + label + ')'));
		}
		for (const raw of [null, undefined, '<none>', 0, 110, 'unknown']) {
			player.entries[5] = raw;
			assert.strictEqual(status.player_is_blocked(match, player), false);
			assert.strictEqual(status.call_error(match), null);
		}
	});
});
