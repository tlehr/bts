'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const statuses = require('../bts/call_status');
const rules = require('../bts/match_automation');
const foreground = require('../bts/foreground_work');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function delivered(condition) {
	const until = Date.now() + 1000;
	while (!condition()) { if (Date.now() >= until) throw Error('Admin outbox did not deliver'); await tick(); }
}
const initial = new Date('2026-11-11T10:00:00').getTime();
let applications;
async function fixture(settings = {}) {
	const db = await database.init_test(), app = {db};
	applications.push(app);
	const key = 'shared-call', insert = (name, document) => promisify(db[name].insert.bind(db[name]))(document);
	await require('../bts/clock').init(app);
	await app.clock.set_fixed(initial);
	await insert('tournaments', {key, official_rotation_mode:'disabled', call_preparation_matches_automatically_enabled:true, ...settings});
	await insert('locations', {_id:'hall', tournament_key:key});
	await insert('courts', {_id:'court', tournament_key:key, location_id:'hall', is_active:true});
	await insert('matches', {_id:'match', tournament_key:key, match_order:1, presses:[], setup:{
		state:'scheduled', is_match:true, location_id:'hall', match_num:1,
		scheduled_date:'2026-11-11', scheduled_time_str:'10:10', teams:[
			{players:[{btp_id:1, name:'A'}]}, {players:[{btp_id:2, name:'B'}]},
		],
	}});
	const service = statuses(app), publications = [];
	service.publish = (key, value) => publications.push({key,value});
	const set = (name, id, fields) => db[name].update_async({_id:id}, {$set:fields}, {});
	return {db, app, key, insert, set, service, publications, snapshot: options => service.snapshot(key, options)};
}

function assert_manual_matches_diagnosis(input) {
	for (const selection of input.locations.map(location => rules.calculate_location_preparation_selection(input, location._id))) {
		const manual = new Set(selection.manual_callable_match_ids);
		for (const match of input.matches) assert.strictEqual(manual.has(match._id),
			rules.calculate_match_preparation_diagnostics(match, selection.location_id, input).manual_eligible, match._id);
	}
}

describe('event and deadline based shared call status', function() {
	let calculate, calculations;
	beforeEach(function() {
		applications = []; calculations = 0; calculate = rules.calculate_all_location_preparation_selections;
		rules.calculate_all_location_preparation_selections = (...args) => { calculations++; return calculate(...args); };
	});
	afterEach(function() {
		for (const app of applications) statuses.close(app);
		rules.calculate_all_location_preparation_selections = calculate;
	});
	it('shares decisions between admin windows and automatic preparation without repeating discovery', async function() {
		const f = await fixture(), first = await f.snapshot();
		const automatic = await rules.fetch_location_preparation_selection(f.app, f.key, 'hall', {automatic_only:true});
		assert.deepStrictEqual(automatic.auto_selected_matches.map(match => match._id), first.selections[0].auto_selected_match_ids);
		assert.strictEqual(calculations, 1);
		assert.strictEqual(await f.snapshot(), first);
		const detached = await rules.fetch_location_preparation_selection(f.app, f.key, 'hall');
		detached.candidates[0].setup.teams[0].players[0].name = 'Changed by caller';
		assert.strictEqual((await rules.fetch_location_preparation_selection(f.app, f.key, 'hall')).candidates[0].setup.teams[0].players[0].name, 'A');
		assert.throws(() => first.selections[0].manual_callable_match_ids.push('bad'), TypeError);
	});
	it('reopens preparation demand for both UI and automation when a prepared game loses its participants', async function() {
		const f = await fixture();
		await f.insert('matches', {_id:'prepared', tournament_key:f.key, setup:{
			state:'preparation', is_match:true, location_id:'hall', match_num:488,
			teams:[{players:[{btp_id:3}]}, {players:[{btp_id:4}]}],
		}});
		const before = await f.snapshot();
		assert.strictEqual(before.selections[0].current_preparation_count, 1);
		assert.deepStrictEqual(before.selections[0].auto_selected_match_ids, []);
		f.service.watch(f.key, {});
		await f.set('matches', 'prepared', {'setup.incomplete':true, 'setup.teams':[{players:[]}, {players:[]}]});
		const after = await f.snapshot();
		assert.strictEqual(after.selections[0].current_preparation_count, 0);
		assert.strictEqual(after.selections[0].missing_preparation_count, 1);
		assert.deepStrictEqual(after.selections[0].auto_selected_match_ids, ['match']);
		assert.deepStrictEqual(after.selections[0].candidate_match_ids, ['match']);
		const automatic = await rules.fetch_location_preparation_selection(f.app, f.key, 'hall', {automatic_only:true});
		assert.deepStrictEqual(automatic.auto_selected_matches.map(match => match._id), after.selections[0].auto_selected_match_ids);
		assert.strictEqual(calculations, 2);
		assert.strictEqual(f.publications.length, 1);
	});
	it('upgrades a lightweight automatic answer using its existing candidate selection', async function() {
		const f = await fixture();
		const automatic = await rules.fetch_location_preparation_selection(f.app, f.key, 'hall', {automatic_only:true});
		let reused;
		rules.calculate_all_location_preparation_selections = (input, options) => {
			reused = options.base_selections.get('hall'); calculations++; return calculate(input, options);
		};
		const full = await f.snapshot();
		assert.strictEqual(reused, automatic);
		assert.deepStrictEqual(full.selections[0].manual_callable_match_ids, ['match']);
		assert.strictEqual(calculations, 2);
	});
	it('preserves a detached empty selection for a missing location', async function() {
		const f = await fixture();
		const selection = await rules.fetch_location_preparation_selection(f.app, f.key, 'removed-hall');
		assert.strictEqual(selection.location_id, 'removed-hall');
		assert.strictEqual(selection.location, null);
		assert.deepStrictEqual(selection.candidates, []);
	});
	it('subscribes through the real admin response path and broadcasts the same revision to both sockets', async function() {
		const f = await fixture(), admin = require('../bts/admin'), sockets = [];
		f.service.publish = (key,value) => admin.notify_change(f.app,key,'call_status_changed',value);
		function socket() {
			const ws = new (require('events').EventEmitter)(); ws.readyState = 1; ws.messages = [];
			ws.send = bytes => ws.messages.push(JSON.parse(bytes.toString()));
			require('../bts/wshandler').handle(admin, f.app, ws); sockets.push(ws); return ws;
		}
		try {
			const first = socket(), second = socket();
			await Promise.all(sockets.map((ws,rid) => admin.async_handle_preparation_selection_get(f.app, ws, {rid,type:'preparation_selection_get',tournament_key:f.key})));
			await delivered(() => sockets.every(ws => ws.messages.length > 0));
			assert.strictEqual(calculations, 1);
			assert.strictEqual(f.service.watchers.get(f.key).size, 2);
			assert.strictEqual(first.messages[0].rid, 0); assert.strictEqual(second.messages[0].rid, 1);
			assert.deepStrictEqual(first.messages[0].call_status, second.messages[0].call_status);
			await f.set('matches','match',{'setup.state':'preparation'});
			await f.snapshot();
			await delivered(() => sockets.every(ws => ws.messages.some(message => message.ctype === 'call_status_changed')));
			const changes = sockets.map(ws => ws.messages.find(message => message.ctype === 'call_status_changed'));
			assert(changes.every(Boolean)); assert.deepStrictEqual(changes[0],changes[1]);
			assert.strictEqual(changes[0].val.selections[0].current_preparation_count, 1);
		} finally {
			for (const ws of sockets) { ws.readyState = 3; ws.emit('close'); }
		}
		assert.strictEqual(f.service.watchers.size, 0);
		assert.strictEqual(f.service.timers.size, 0);
	});
	it('does not invalidate, recompute or push for ordinary score, serve, history and sync acknowledgements', async function() {
		const f = await fixture(), first = await f.snapshot();
		f.service.watch(f.key, {});
		for (let point = 1; point <= 50; point++) {
			await f.set('matches', 'match', {network_score:[[point,0]], network_team1_serving:point % 2 === 0,
				presses:[{type:'score',point}], duration_ms:point * 1000, btp_needsync:true, _btp_sync_signature:String(point)});
			assert.strictEqual(await f.snapshot(), first);
		}
		await tick();
		assert.strictEqual(calculations, 1);
		assert.strictEqual(f.publications.length, 0);
		await f.set('matches', 'match', {'setup.needs_preparation_successor':true});
		await f.snapshot();
		assert.strictEqual(calculations, 2);
		assert.strictEqual(f.publications.length, 1);
	});
	it('negotiates incremental updates through real admin sockets and omits status for non-subscribers', async function() {
		const f = await fixture({call_on_court_participant_readiness_mode:'checked_in'}), admin = require('../bts/admin');
		await f.set('matches','match',{'setup.state':'preparation'});
		const sockets = [];
		const socket = () => {
			const ws = new (require('events').EventEmitter)();ws.readyState = 1;ws.messages = [];
			ws.send = bytes => ws.messages.push(JSON.parse(bytes.toString()));require('../bts/wshandler').handle(admin,f.app,ws);sockets.push(ws);return ws;
		};
		f.service.publish = (key,value) => admin.notify_change(f.app,key,'call_status_changed',value);
		try {
			const subscribed = socket(), idle = socket();
			await admin.async_handle_preparation_selection_get(f.app,subscribed,{rid:1,tournament_key:f.key,call_status_delta:true});
			await delivered(() => subscribed.messages.length > 0);
			const first = subscribed.messages[0];assert.strictEqual(first.call_status_subscribed,true);
			await f.set('matches','match',{'setup.teams.0.players.0.checked_in':true,'setup.teams.1.players.0.checked_in':true});
			const current = await f.snapshot();
			await delivered(() => subscribed.messages.some(message => message.ctype === 'call_status_changed'));
			const push = subscribed.messages.find(message => message.ctype === 'call_status_changed').val;
			assert(push.selections_delta);assert.strictEqual(push.selections,undefined);assert.strictEqual(idle.messages.length,0);
			const client = require('../static/js/call_status_updates');
			assert.deepStrictEqual(client.apply(client.apply({},null,first),first.call_status,push),client.apply({},null,JSON.parse(JSON.stringify(current))));
		} finally { for (const ws of sockets) {ws.readyState = 3;ws.emit('close');} }
	});
	it('answers failed subscription reads so a browser can retry instead of waiting indefinitely', async function() {
		const f = await fixture(), admin = require('../bts/admin');let failure;
		f.service.snapshot = async () => {throw new Error('subscription test read failed');};
		await admin.async_handle_preparation_selection_get(f.app,{respond:(_msg,error) => {failure = error;}},{tournament_key:f.key});
		assert.strictEqual(failure.message,'subscription test read failed');
	});
	it('refreshes check-ins and sends one shared update to subscribed admins', async function() {
		const f = await fixture({call_on_court_participant_readiness_mode:'checked_in'});
		await f.set('matches', 'match', {'setup.state':'preparation'});
		const old = await f.snapshot();
		assert.strictEqual(old.selections[0].call_on_court_diagnostics_by_match_id.match.eligible, false);
		f.service.watch(f.key, {}); f.service.watch(f.key, {});
		await f.set('matches', 'match', {'setup.teams.0.players.0.checked_in':true, 'setup.teams.1.players.0.checked_in':true});
		const next = await f.snapshot();
		assert.strictEqual(next.selections[0].call_on_court_diagnostics_by_match_id.match.eligible, true);
		assert.strictEqual(next.call_status.revision, old.call_status.revision + 1);
		assert.strictEqual(f.publications.length, 1);
	});
	it('refreshes exactly at a scheduled threshold and retains status before it', async function() {
		const f = await fixture({preparation_call_time_limit_before_scheduled_enabled:true, preparation_call_time_limit_before_scheduled_minutes:5});
		const old = await f.snapshot();
		assert.strictEqual(old.call_status.valid_until, initial + 300000);
		assert(!old.selections[0].candidate_match_ids.length);
		await f.app.clock.set_fixed(initial + 299999);
		const before = await f.snapshot();
		assert(!before.selections[0].candidate_match_ids.length);
		await f.app.clock.set_fixed(initial + 300000);
		const next = await f.snapshot();
		assert.deepStrictEqual(next.selections[0].candidate_match_ids, ['match']);
		assert.strictEqual(next.call_status.valid_until, null);
	});
	it('uses player and tablet pause deadlines as well as preparation age', async function() {
		const f = await fixture({preparation_call_participant_readiness_mode:'pause_expired', call_on_court_participant_readiness_mode:'pause_expired',
			btp_settings:{pause_duration_ms:60000}, call_on_court_only_preparation_enabled:true, call_on_court_only_preparation_minutes:3});
		await f.set('matches', 'match', {'setup.teams.0.players.0.last_time_on_court_ts':initial - 30000,
			'setup.teams.0.players.0.tablet_break_active':true, 'setup.teams.0.players.0.tablet_break_until_ts':initial + 45000});
		let status = await f.snapshot();
		assert.strictEqual(status.call_status.valid_until, initial + 30000);
		await f.app.clock.set_fixed(initial + 30000); status = await f.snapshot();
		assert.strictEqual(status.call_status.valid_until, initial + 45000);
		assert(!status.selections[0].candidate_match_ids.length);
		await f.app.clock.set_fixed(initial + 45000); status = await f.snapshot();
		assert.deepStrictEqual(status.selections[0].candidate_match_ids, ['match']);
		await f.set('matches', 'match', {'setup.state':'preparation', 'setup.preparation_call_timestamp':initial});
		status = await f.snapshot();
		assert.strictEqual(status.call_status.valid_until, initial + 180000);
		assert.strictEqual(status.selections[0].call_on_court_diagnostics_by_match_id.match.eligible, false);
		await f.app.clock.set_fixed(initial + 180000); status = await f.snapshot();
		assert.strictEqual(status.selections[0].call_on_court_diagnostics_by_match_id.match.eligible, true);
	});
	it('pushes an elapsed deadline without polling and clears the timer when the last admin leaves', async function() {
		const f = await fixture({call_on_court_only_preparation_enabled:true, call_on_court_only_preparation_minutes:0.005});
		await f.app.clock.set_real();
		await f.set('matches', 'match', {'setup.state':'preparation', 'setup.preparation_call_timestamp':Date.now()});
		const before = await f.snapshot();
		assert.strictEqual(before.selections[0].call_on_court_diagnostics_by_match_id.match.eligible, false);
		const owner = {}, published = new Promise(resolve => { f.service.publish = (_key,value) => resolve(value); });
		f.service.watch(f.key, owner);
		let timeout;
		try {
			const after = await Promise.race([published, new Promise((_,reject) => { timeout = setTimeout(() => reject(Error('deadline was not published')),1500); })]);
			assert.strictEqual(after.selections[0].call_on_court_diagnostics_by_match_id.match.eligible, true);
		} finally { clearTimeout(timeout); }
		f.service.unwatch(owner);
		assert.strictEqual(f.service.timers.size, 0);
	});
	it('recalculates on backward and offset clock changes, without timers for a frozen clock', async function() {
		const f = await fixture({preparation_call_time_limit_before_scheduled_enabled:true, preparation_call_time_limit_before_scheduled_minutes:5});
		f.service.watch(f.key, {});
		await f.app.clock.set_fixed(initial + 300001);
		assert((await f.snapshot()).selections[0].candidate_match_ids.length);
		await f.app.clock.set_fixed(initial);
		assert(!(await f.snapshot()).selections[0].candidate_match_ids.length);
		assert.strictEqual(f.service.timers.size, 0);
		await f.app.clock.set_offset_target(initial + 300010);
		assert((await f.snapshot()).selections[0].candidate_match_ids.length);
	});
	it('discards a calculation invalidated by a concurrent check-in', async function() {
		const f = await fixture({preparation_call_participant_readiness_mode:'checked_in'});
		let release, started;
		const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
		rules.calculate_all_location_preparation_selections = async (...args) => { calculations++; if (calculations === 1) { started(); await gate; } return calculate(...args); };
		const pending = f.snapshot(); await ready;
		await f.set('matches', 'match', {'setup.teams.0.players.0.checked_in':true, 'setup.teams.1.players.0.checked_in':true});
		release();
		assert.deepStrictEqual((await pending).selections[0].candidate_match_ids, ['match']);
		assert.strictEqual(calculations, 2);
	});
	it('does not deadlock an owning operation behind a background calculation waiting for its priority', async function() {
		const f = await fixture(); let release, started;
		const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
		rules.calculate_all_location_preparation_selections = async (...args) => { calculations++; if (calculations === 1) { started(); await gate; } return calculate(...args); };
		const pending = f.snapshot(); await ready;
		const end = foreground.begin('handle_score_update_v2');
		try { assert.strictEqual((await foreground.run(end, () => f.snapshot())).selections[0].candidate_match_ids.length, 1); }
		finally { end(); release(); }
		assert.strictEqual((await pending).selections[0].candidate_match_ids.length, 1);
	});
	it('retains all manual decisions for unknown players, special results, playing players and halls', async function() {
		const f = await fixture();
		await f.insert('locations', {_id:'other',tournament_key:f.key});
		const base = await f.db.matches.findOne_async({_id:'match'}), matches = [];
		for (const [index,change] of [
			{}, {state:'blocked'}, {state:'preparation'}, {is_match:false}, {incomplete:true}, {now_on_court:true},
			{location_id:'other'}, {location_id:null,court_id:'court'}, {teams:[{players:[]},{players:[{btp_id:3}]}]},
			{teams:[{players:[{btp_id:4,now_playing_on_court:'court'}]},{players:[{btp_id:5}]}]},
			{teams:[{players:[{btp_id:6,entries:{1:108}}]},{players:[{btp_id:7}]}]},
		].entries()) {
			const match = {...structuredClone(base), _id:'case-'+index, setup:{...structuredClone(base.setup),...change}};
			for (const [team,entry] of match.setup.teams.entries()) for (const player of entry.players) player.btp_id = 100 + index * 4 + team;
			matches.push(match);
		}
		matches.push({...structuredClone(base),_id:'finished',team1_won:true});
		matches.push({...structuredClone(base),_id:'walkover',score_status:'walkover'});
		const input = {locations:[{_id:'hall'},{_id:'other'}],courts:[{_id:'court',location_id:'hall',is_active:true}],matches};
		assert_manual_matches_diagnosis(input);
		assert(rules.calculate_location_preparation_selection(input,'hall').manual_callable_match_ids.includes('case-0'));
	});
	it('does not publish unfinished work after shutdown', async function() {
		const f = await fixture(); let release, started;
		const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
		rules.calculate_all_location_preparation_selections = async (...args) => { started(); await gate; return calculate(...args); };
		const pending = f.snapshot(); await ready;
		f.service.close(); release();
		await assert.rejects(pending, /beendet/);
		assert.strictEqual(f.publications.length, 0);
	});
	it('waits for persistence before publishing an observed index change', async function() {
		const f = await fixture(); await f.snapshot(); f.service.watch(f.key, {});
		const persistence = f.db.matches.persistence, original = persistence.persistNewState;
		let release, reached;
		const held = new Promise(resolve => { reached = resolve; });
		persistence.persistNewState = function(docs, callback) { release = () => original.call(this, docs, callback); reached(); };
		const write = f.set('matches', 'match', {'setup.state':'preparation'});
		await held;
		try { await tick(); await tick(); assert.strictEqual(f.publications.length, 0); }
		finally { persistence.persistNewState = original; release(); }
		await write;
		assert.strictEqual((await f.snapshot()).selections[0].current_preparation_count, 1);
		assert.strictEqual(f.publications.length, 1);
	});
	it('does not miss changes between the initial response calculation and subscribing the socket', async function() {
		const f = await fixture(); await f.snapshot();
		await f.set('matches', 'match', {'setup.state':'preparation'});
		let published;
		const ready = new Promise(resolve => { published = resolve; });
		f.service.publish = (_key,value) => published(value);
		f.service.watch(f.key, {});
		assert.strictEqual((await ready).selections[0].current_preparation_count, 1);
	});
	it('retries instead of publishing a decision whose deadline expired during its calculation', async function() {
		const f = await fixture({call_on_court_only_preparation_enabled:true, call_on_court_only_preparation_minutes:1});
		await f.set('matches', 'match', {'setup.state':'preparation', 'setup.preparation_call_timestamp':initial});
		const key = f.app.clock.get_state.bind(f.app.clock), actual = f.app.clock.now_ms;
		let now = initial;
		// Exercise a naturally advancing clock, without a separate clock-change event.
		f.app.clock.now_ms = () => now;
		f.app.clock.get_state = () => ({...key(),mode:'offset',fixed_ts:null,offset_ms:0});
		rules.calculate_all_location_preparation_selections = async (...args) => {
			calculations++; const value = await calculate(...args); now = initial + 60000; return value;
		};
		try {
			const next = await f.snapshot();
			assert.strictEqual(next.selections[0].call_on_court_diagnostics_by_match_id.match.eligible, true);
			assert.strictEqual(calculations, 2);
		} finally { f.app.clock.now_ms = actual; }
	});
	it('recovers a subscribed status after a transient calculation error without a new UI request', async function() {
		const f = await fixture(); await f.snapshot(); f.service.watch(f.key, {});
		const original = console.error, errors = [];
		let failed = false, published;
		const ready = new Promise(resolve => { published = resolve; });
		f.service.publish = (_key,value) => published(value);
		rules.calculate_all_location_preparation_selections = (...args) => {
			if (!failed) { failed = true; return Promise.reject(Error('temporary read error')); }
			return calculate(...args);
		};
		console.error = (...args) => errors.push(args.join(' '));
		try {
			await f.set('matches','match',{'setup.state':'preparation'});
			assert.strictEqual((await ready).selections[0].current_preparation_count, 1);
			assert.strictEqual(errors.length, 1);
			assert(errors[0].includes('temporary read error'));
		} finally { console.error = original; }
	});
});
