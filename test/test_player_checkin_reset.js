'use strict';

const assert = require('assert');
const {promisify} = require('util');
const database = require('../bts/database');
const {reset} = require('../bts/player_checkin_reset');
const manager = require('../bts/btp_manager');
const bupws = require('../bts/bupws');
const queue = require('../bts/update_queue');

const insert = (store, value) => promisify(store.insert.bind(store))(value);

describe('resetting every per-game player check-in', function() {
	let app, original, sent, refreshed, notices;
	beforeEach(async function() {
		original = {get_status:manager.get_status, update_highlight:manager.update_highlight, update_players:manager.update_players,
			handle_score_change:bupws.handle_score_change};
		sent = []; refreshed = []; notices = [];
		manager.get_status = () => ({status:'connected'});
		manager.update_highlight = (_app, match) => sent.push(match);
		manager.update_players = () => {throw new Error('Unexpected global player update');};
		bupws.handle_score_change = (_app, ...args) => refreshed.push(args);
		app = {db:await database.init_test()};
		await insert(app.db.tournaments, {key:'cup', btp_enabled:true, btp_settings:{check_in_per_match:true}});
	});
	afterEach(function() {
		manager.get_status = original.get_status; manager.update_highlight = original.update_highlight; manager.update_players = original.update_players;
		bupws.handle_score_change = original.handle_score_change;
		require('../bts/call_status').close(app);
	});
	const notify = (type, value) => notices.push({type, value});
	function game(id, state = 'scheduled', checked_in = true) {
		return {_id:id, tournament_key:'cup', btp_match_ids:[{id:1, draw:2, planning:3}],
			btp_winner:state === 'finished' ? 1 : 0, network_score:[[21,12]], presses:[], setup:{
				is_match:true, state, now_on_court:state === 'oncourt', court_id:'court', location_id:'hall', match_num:1,
				teams:[{players:[{btp_id:1, name:'A', checked_in, last_time_on_court_ts:123}]},
					{players:[{btp_id:2, name:'B', checked_in, tablet_break_active:true}]}],
				umpire:{btp_id:8, checked_in:true}, service_judge:{btp_id:9, checked_in:true},
				tabletoperators:[{btp_id:10, checked_in:true}],
			}};
	}
	it('clears every occurrence in all match states while preserving scores, fields, officials and other tournaments', async function() {
		const before = [];
		for (const state of ['scheduled', 'preparation', 'oncourt', 'finished', 'incomplete']) before.push(game(state, state));
		const foreign = {...game('foreign'), tournament_key:'other'};
		await insert(app.db.matches, [...before, foreign]);
		await insert(app.db.courts, {_id:'court', tournament_key:'cup', match_id:'oncourt'});
		await app.db.matches.update_async({_id:'scheduled'}, {$set:{btp_needsync:true}}, {});
		before[0].btp_needsync = true;
		const result = await reset(app, 'cup', {target:'bts'}, notify);
		assert.deepStrictEqual(result, {target:'bts', changed_matches:5, player_count:10});
		for (const previous of before) {
			const expected = JSON.parse(JSON.stringify(previous));
			for (const team of expected.setup.teams) for (const player of team.players) player.checked_in = false;
			assert.deepStrictEqual(await app.db.matches.findOne_async({_id:previous._id}), expected);
		}
		assert.deepStrictEqual(await app.db.matches.findOne_async({_id:'foreign'}), foreign);
		assert.strictEqual((await app.db.courts.findOne_async({_id:'court'})).match_id, 'oncourt');
		assert.strictEqual(sent.length, 0);
		assert.deepStrictEqual(refreshed, [['cup']]);
		assert.strictEqual(notices.length, 6);
		assert(notices.slice(0, 5).every(event => event.type === 'update_player_status' && event.value.setup.teams.every(team => team.players.every(player => player.checked_in === false))));
		assert.deepStrictEqual(notices[5], {type:'player_checkin_reset', value:{changed_matches:5}});
	});
	it('sets missing values explicitly to false and tolerates incomplete games and participants without an ID', async function() {
		const match = game('mixed');
		match.setup.teams = [{players:[{name:'No ID'}, {btp_id:1, checked_in:null}, {btp_id:2, checked_in:false}]}, {players:[]}];
		await insert(app.db.matches, [match, {_id:'empty', tournament_key:'cup'}, {_id:'unresolved', tournament_key:'cup', setup:{teams:[{}, {players:[]}]}}]);
		const result = await reset(app, 'cup', {}, notify);
		assert.strictEqual(result.changed_matches, 1); assert.strictEqual(result.player_count, 2);
		assert((await app.db.matches.findOne_async({_id:'mixed'})).setup.teams[0].players.every(player => player.checked_in === false));
		assert.deepStrictEqual((await app.db.matches.findOne_async({_id:'unresolved'})).setup, {teams:[{}, {players:[]}]});
	});
	it('is idempotent and avoids writes, notices and device refreshes when every flag is already false', async function() {
		await insert(app.db.matches, game('done', 'scheduled', false));
		const store = app.db.matches, persist = store.persistence.persistNewState;
		let appends = 0;
		store.persistence.persistNewState = (...args) => {appends++; return persist.apply(store.persistence, args);};
		try {
			assert.strictEqual((await reset(app, 'cup', {}, notify)).changed_matches, 0);
			assert.strictEqual(appends, 0); assert.strictEqual(notices.length, 0); assert.strictEqual(refreshed.length, 0);
		} finally {store.persistence.persistNewState = persist;}
	});
	it('queues durable per-game BTP status updates with all four check-in bits cleared', async function() {
		const before = game('doubles');
		before.setup.teams.forEach((team, index) => team.players.push({btp_id:index + 3, checked_in:true}));
		await insert(app.db.matches, before);
		await reset(app, 'cup', {target:'both'}, notify);
		const after = await app.db.matches.findOne_async({_id:'doubles'});
		assert.strictEqual(after.btp_needsync, true); assert.strictEqual(sent.length, 1);
		assert.deepStrictEqual(sent[0], after);
		const request = require('../bts/btp_proto').update_request(after, 'session', null, null, null, null, {write_match_check_in_status:true});
		assert.strictEqual(request.Update.Tournament.Matches[0].Match.Status & 15, 0);
		assert.deepStrictEqual(after.network_score, before.network_score);
	});
	it('uses global BTP attendance updates when BTP is configured for global check-in', async function() {
		await app.db.tournaments.update_async({key:'cup'}, {$set:{'btp_settings.check_in_per_match':false}}, {});
		await insert(app.db.matches, [game('one'), game('two')]);
		let players;
		manager.update_players = (_app, key, value) => {assert.strictEqual(key, 'cup'); players = value; return true;};
		await reset(app, 'cup', {target:'both'}, notify);
		assert.deepStrictEqual(players, [{btp_id:1, checked_in:false}, {btp_id:2, checked_in:false}]);
		assert.strictEqual(sent.length, 0);
		assert.strictEqual((await app.db.matches.findOne_async({_id:'one'})).btp_needsync, undefined);
	});
	it('rejects unavailable combined resets before changing any local check-in', async function() {
		await insert(app.db.matches, game('one'));
		for (const settings of [{btp_enabled:false}, {btp_enabled:true, btp_readonly:true}, {btp_enabled:true, btp_readonly:false}]) {
			await app.db.tournaments.update_async({key:'cup'}, {$set:settings}, {});
			manager.get_status = () => ({status:'error'});
			await assert.rejects(reset(app, 'cup', {target:'both'}, notify), /schreibend verbunden/);
			assert.strictEqual((await app.db.matches.findOne_async({_id:'one'})).setup.teams[0].players[0].checked_in, true);
		}
		assert.strictEqual(notices.length, 0);
		// The explicit BTS-only action remains available offline and read-only.
		assert.strictEqual((await reset(app, 'cup', {}, notify)).changed_matches, 1);
	});
	it('keeps local flags intact when the global BTP update cannot be queued', async function() {
		await insert(app.db.matches, game('one'));
		await app.db.tournaments.update_async({key:'cup'}, {$set:{'btp_settings.check_in_per_match':false}}, {});
		manager.update_players = () => false;
		await assert.rejects(reset(app, 'cup', {target:'both'}, notify), /nichts zurückgesetzt/);
		assert.strictEqual((await app.db.matches.findOne_async({_id:'one'})).setup.teams[0].players[0].checked_in, true);
		assert.strictEqual(notices.length, 0);
	});
	it('reads fresh flags after earlier check-ins and excludes concurrent writes until the bulk reset completes', async function() {
		await insert(app.db.matches, game('one', 'scheduled', false));
		let release, entered;
		const ready = new Promise(resolve => {entered = resolve;});
		const earlier = queue.execute_locked([queue.lock_keys.match('cup', 'one')], async () => {
			entered(); await new Promise(resolve => {release = resolve;});
			await app.db.matches.update_async({_id:'one'}, {$set:{'setup.teams.0.players.0.checked_in':true}}, {});
		});
		await ready;
		const action = reset(app, 'cup', {}, notify);
		release(); await earlier;
		assert.strictEqual((await action).player_count, 1);
		assert.strictEqual((await app.db.matches.findOne_async({_id:'one'})).setup.teams[0].players[0].checked_in, false);
	});
	it('invalidates the shared on-court readiness status after resetting player attendance', async function() {
		await app.db.tournaments.update_async({key:'cup'}, {$set:{official_rotation_mode:'disabled', call_on_court_participant_readiness_mode:'checked_in'}}, {});
		await insert(app.db.locations, {_id:'hall', tournament_key:'cup'});
		await insert(app.db.courts, {_id:'court', tournament_key:'cup', location_id:'hall', is_active:true});
		await insert(app.db.matches, game('prepared', 'preparation'));
		const service = require('../bts/call_status')(app);
		const before = await service.snapshot('cup');
		assert.strictEqual(before.selections[0].call_on_court_diagnostics_by_match_id.prepared.eligible, true);
		await reset(app, 'cup', {}, notify);
		const after = await service.snapshot('cup');
		assert.strictEqual(after.selections[0].call_on_court_diagnostics_by_match_id.prepared.eligible, false);
		assert(after.call_status.revision > before.call_status.revision);
	});
	it('publishes only committed groups and refreshes clients after a later write fails', async function() {
		const matches = Array.from({length:6}, (_, index) => game('game-' + index));
		await insert(app.db.matches, matches);
		const store = app.db.matches, persist = store.persistence.persistNewState;
		let calls = 0;
		store.persistence.persistNewState = function(records, done) {
			if (++calls === 2) return queueMicrotask(() => done(new Error('Storage unavailable')));
			return persist.call(this, records, done);
		};
		try {
			await assert.rejects(reset(app, 'cup', {target:'both'}, notify), /Storage unavailable/);
			assert.strictEqual(sent.length, 4);
			assert.strictEqual(notices.filter(event => event.type === 'update_player_status').length, 4);
			assert.deepStrictEqual(notices.at(-1), {type:'player_checkin_reset', value:{changed_matches:4}});
			assert.deepStrictEqual(refreshed, [['cup']]);
			const after = await app.db.matches.find_async({tournament_key:'cup'});
			assert.strictEqual(after.filter(match => match.setup.teams[0].players[0].checked_in === false).length, 4);
			assert.strictEqual(after.filter(match => match.btp_needsync === true).length, 4);
		} finally {store.persistence.persistNewState = persist;}
	});
	it('rejects malformed targets and unknown tournaments before writing', async function() {
		await assert.rejects(reset(app, {$ne:''}), /Ungültiges Turnier/);
		await assert.rejects(reset(app, 'cup', {target:'remote'}), /Ungültiges Ziel/);
		await assert.rejects(reset(app, 'missing'), /Turnier nicht gefunden/);
	});
});
