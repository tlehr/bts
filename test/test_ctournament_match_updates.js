'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const utils = require('../static/bup/dev/js/utils');
const { cmp_scheduled_match_order } = require('../bts/match_automation');

function harness() {
	const matches = [1, 2, 3].map(id => ({ _id: 'm' + id, match_order: id + 1, presses: [], score_status: 'normal',
		setup: { state: 'scheduled', scheduled_date: '2026-10-23', scheduled_time_str: '10:30', match_num: id } }));
	const calls = { reorder: [], update: [], score: [], players: [], playerIds: [], metadata: [], demand: [], preparation: [], demandIds: [], warnings:[] }, routes = [];
	const context = {
		curt: { key: 'default', matches }, utils, console, btsCallStatusUpdates:require('../static/js/call_status_updates'),
		setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, requestAnimationFrame() {},
		window: { addEventListener() {} }, document: { querySelector() { return null; }, querySelectorAll() { return []; } },
		crouting: { register(regex, load, handler) { routes.push({ regex, handler }); } },
		change: { default_handler(render, handlers) { return handlers; } },
		uiu: { qsEach() {} },
		cerror: { silent(message) { throw new Error(message); } },
		send(_message, callback) { callback(null, { selections: [] }); },
		cmatch: {
			calc_section(match) { return match.setup.state === 'finished' ? 'finished' : 'unassigned'; },
			cmp_match_order: cmp_scheduled_match_order,
			reorder_match_row(...args) { calls.reorder.push(args); },
			update_match(...args) { calls.update.push(args); },
			update_match_score(...args) { calls.score.push(args); },
			update_match_metadata(match, fields) { calls.metadata.push([match, Array.from(fields)]); },
			update_preparation_demand_court_markers(match, _immediate, ids) { calls.demand.push(match); calls.demandIds.push(ids && Array.from(ids).sort()); },
			update_player_status_indicators_for_match_players(...args) { calls.players.push(args); },
			update_player_status_indicators_for_player_ids(ids) { calls.playerIds.push(Array.from(ids)); },
			refresh_unassigned_preparation_context(immediate, changes) { calls.preparation.push({immediate, changes}); },
			refresh_unassigned_status_context() { calls.warnings.push(true); },
		},
	};
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(require.resolve('../static/js/ctournament'), 'utf8'), context);
	return { context, matches, calls, routes, update: context.ctournament.update_match };
}

describe('live tournament match ordering', function() {
	it('keeps existing alias lookups through allocation changes and refreshes them for actual new records',function() {
		const h = harness(),handler = h.routes.find(route => route.regex.test('t/default/')).handler;
		h.matches[1].btp_match_ids = [{planning:'legacy-alias'}];
		const score = id => handler.score({val:{match_id:id,network_score:[[7,6]],presses:[]}});
		score('legacy-alias');assert.strictEqual(h.calls.score.at(-1)[0],h.matches[1]);
		let foreignReads = 0;
		Object.defineProperty(h.matches[2],'btp_match_ids',{configurable:true,get() { foreignReads++;return []; }});
		const incoming = structuredClone(h.matches[0]);incoming.setup.state = 'preparation';
		h.update({val:{match__id:incoming._id,match:incoming}});score('legacy-alias');
		assert.strictEqual(foreignReads,0,'A state-only update must not rebuild aliases from unrelated games');
		const added = {_id:'m4',match_order:5,presses:[],btp_match_ids:[{planning:'new-alias'}],setup:{state:'scheduled',match_num:4}};
		h.context.cmatch.add_match = () => {};
		h.update({val:{match__id:added._id,match:added}});score('new-alias');
		assert.strictEqual(h.calls.score.at(-1)[0],added,'A newly added legacy alias must become available');
		const replacement = structuredClone(h.matches[1]);
		h.context.curt.matches = h.context.curt.matches.map(match => match._id === replacement._id ? replacement : match);
		score('legacy-alias');assert.strictEqual(h.calls.score.at(-1)[0],replacement,'A replaced source must use the current model record');
	});
	it('skips the tournament-wide todo inventory for allocation and attendance changes',function() {
		const h = harness(),match = h.matches[0];
		match.setup.teams = [{players:[{btp_id:1,name:'A',checked_in:false}]},{players:[{btp_id:2,name:'B'}]}];
		const incoming = structuredClone(match);
		Object.assign(incoming.setup,{state:'preparation',location_id:'hall',preparation_call_timestamp:1000,
			umpire:{name:'Official'},tabletoperators:[{btp_id:3}]});
		Object.assign(incoming.setup.teams[0].players[0],{checked_in:true,now_playing_on_court:'field',last_time_on_court_ts:1000});
		h.update({val:{match__id:match._id,match:incoming}});
		assert.strictEqual(h.calls.update.length,1);assert.strictEqual(h.calls.update[0][3].warningsChanged,false);
		assert.strictEqual(h.calls.warnings.length,0);
	});
	for (const [name,change] of [
		['special result',match => { match.score_status = 'disqualified';match.team1_won = true; }],
		['entry status',match => { match.setup.teams[0].players[0].entries = {draw:'DNS'}; }],
		['discipline',match => { match.setup.event_name = 'Different event'; }],
		['schedule',match => { match.setup.scheduled_time_str = '12:00'; }],
		['participant name',match => { match.setup.teams[0].players[0].name = 'Changed name'; }],
		['participant identity',match => { match.setup.teams[0].players[0].btp_id = 99; }],
		['unknown participant metadata',match => { match.setup.teams[0].players[0].future_entry_property = 1; }],
	]) it('refreshes todos when the ' + name + ' changes, including a retained row',function() {
		const h = harness(),match = h.matches[0];h.context.cmatch.update_match_player_names = () => {};
		match.setup.teams = [{players:[{btp_id:1,name:'A'}]},{players:[{btp_id:2,name:'B'}]}];
		const incoming = structuredClone(match);change(incoming);h.update({val:{match__id:match._id,match:incoming}});
		assert(h.calls.warnings.length === 1 || h.calls.update.some(call => call[3]?.warningsChanged === true));
	});
	it('subscribes once, coalesces initial requests and does not poll during ordinary updates', function() {
		const h = harness(), ui = h.context.ctournament, requests = [];
		const jobs = new Set();
		h.context.btsAdminUpdates = {hasSubscribers:() => true,createJob:() => {
			const promise = {};jobs.add(promise);
			return {promise,claim() {},run:callback => callback(),complete:() => jobs.delete(promise)};
		}};
		h.context.send = (message,callback) => requests.push({message,callback});
		for (let i = 0; i < 5; i++) ui.request_location_preparation_selections();
		assert.strictEqual(requests.length,1);assert.strictEqual(requests[0].message.call_status_delta,true);
		requests[0].callback(null,{call_status:{epoch:'stream',revision:1},selections:[],call_status_subscribed:true});
		for (let i = 0; i < 50; i++) ui.request_location_preparation_selections();
		assert.strictEqual(requests.length,1);assert.strictEqual(h.context.curt.call_status_subscribed,true);
		assert.strictEqual(jobs.size,0,'The coalesced request releases its UI receipt when the stream takes over');
		assert.strictEqual(ui.isUpdating(),false);
	});
	it('recovers a missed delta with one full subscription read and resumes push delivery', function() {
		const h = harness(), ui = h.context.ctournament, requests = [];
		h.context.send = (message,callback) => requests.push({message,callback});
		ui.apply_call_status({call_status:{epoch:'stream',revision:1},selections:[]},'default');
		h.context.curt.call_status_subscribed = true;
		const missed = {call_status:{epoch:'stream',revision:4},selections_delta:{epoch:'stream',base:3,changed:[],removed:[]}};
		assert.strictEqual(ui.apply_call_status(missed,'default'),false);
		assert.strictEqual(ui.apply_call_status(missed,'default'),false);
		assert.strictEqual(requests.length,1);assert.strictEqual(h.context.curt.call_status.revision,1);
		requests[0].callback(null,{call_status:{epoch:'stream',revision:4},selections:[],call_status_subscribed:true});
		assert.strictEqual(requests.length,1);assert.strictEqual(h.context.curt.call_status.revision,4);
		assert.strictEqual(ui.apply_call_status({call_status:{epoch:'stream',revision:5},selections_delta:{epoch:'stream',base:4,changed:[],removed:[]}},'default'),true);
	});
	it('resubscribes after connection loss and ignores a response from the old connection', function() {
		const h = harness(), ui = h.context.ctournament, requests = [];
		const jobs = new Set();
		h.context.btsAdminUpdates = {hasSubscribers:() => true,createJob:() => {
			const promise = {};jobs.add(promise);
			return {promise,claim() {},run:callback => callback(),complete:() => jobs.delete(promise)};
		}};
		h.context.btsServiceStatus = {createMonitor:() => ({connected() {}})};
		h.context.send = (message,callback) => requests.push({message,callback});
		ui.request_location_preparation_selections();
		ui.request_location_preparation_selections();assert.strictEqual(jobs.size,2);
		ui.bts_status_changed({val:{status:'waiting'}});
		assert.strictEqual(jobs.size,0,'Connection loss releases both the abandoned read and its coalesced follow-up');
		ui.request_location_preparation_selections();assert.strictEqual(requests.length,2);
		requests[0].callback(null,{call_status:{epoch:'old',revision:10},selections:[],call_status_subscribed:true});
		assert.strictEqual(h.context.curt.call_status,undefined);assert.strictEqual(h.context.curt.call_status_subscribed,false);
		requests[1].callback(null,{call_status:{epoch:'new',revision:1},selections:[],call_status_subscribed:true});
		assert.strictEqual(h.context.curt.call_status.epoch,'new');assert.strictEqual(h.context.curt.call_status_subscribed,true);
		ui.request_location_preparation_selections();assert.strictEqual(requests.length,2);
	});
	it('accepts newer metadata without any UI work when the status content stays the same', function() {
		const h = harness(), ui = h.context.ctournament;
		const value = {call_status:{epoch:'one',revision:1,evaluated_at:100,valid_until:200},selections:[{
			location_id:'hall',manual_callable_match_ids:['m1','m2'],diagnostics_by_match_id:{m1:{eligible:true,rules:[]}},
		}]};
		ui.apply_call_status(value,'default');
		const selection = h.context.curt.location_preparation_selection_by_location_id.hall;
		h.calls.preparation.length = h.calls.demand.length = 0;
		h.context.document.querySelector = () => assert.fail('An equal result does not need a DOM lookup');
		const same = structuredClone(value);same.call_status = {epoch:'one',revision:3,evaluated_at:150,valid_until:250};
		assert.strictEqual(ui.apply_call_status(same,'default'),true);
		assert.strictEqual(h.context.curt.call_status.valid_until,250);
		assert.strictEqual(h.context.curt.location_preparation_selection_by_location_id.hall,selection);
		assert.strictEqual(h.calls.preparation.length,0);assert.strictEqual(h.calls.demand.length,0);
		value.call_status.revision = 2;value.selections[0].manual_callable_match_ids = [];
		assert.strictEqual(ui.apply_call_status(value,'default'),false,'The accepted newer metadata must reject a delayed intermediate result');
	});
	it('targets only changed manual permissions, including removed halls and reordered ID sets', function() {
		const h = harness(), ui = h.context.ctournament;
		const value = {selections:[{location_id:'hall',manual_callable_match_ids:['m1','m2']},{location_id:'other',manual_callable_match_ids:['m3']}]};
		ui.apply_call_status(value,'default');h.calls.preparation.length = 0;
		let next = structuredClone(value);next.selections[0].manual_callable_match_ids.reverse();
		ui.apply_call_status(next,'default');assert.strictEqual(h.calls.preparation.length,0);
		const other = h.context.curt.location_preparation_selection_by_location_id.other;
		next = structuredClone(value);next.selections[0].manual_callable_match_ids = ['m2'];ui.apply_call_status(next,'default');
		assert.deepStrictEqual(Array.from(h.calls.preparation.at(-1).changes.match_ids),['m1']);
		assert.strictEqual(h.context.curt.location_preparation_selection_by_location_id.other,other);
		next = structuredClone(next);next.selections.pop();ui.apply_call_status(next,'default');
		assert.deepStrictEqual(Array.from(h.calls.preparation.at(-1).changes.match_ids),['m3']);
	});
	it('refreshes changed diagnostics and boundary endpoints without visiting other games', function() {
		const h = harness(), ui = h.context.ctournament;
		const value = {selections:[{location_id:'hall',manual_callable_match_ids:['m1','m2'],display_cutoff_match_id:'m1',
			diagnostics_by_match_id:{m2:{eligible:false,rules:[{key:'player_pause',detail:'before'}]}},
			call_on_court_diagnostics_by_match_id:{m3:{eligible:false}},
		}]};
		ui.apply_call_status(value,'default');h.calls.preparation.length = 0;
		let next = structuredClone(value);next.selections[0].diagnostics_by_match_id.m2.rules[0].detail = 'after';ui.apply_call_status(next,'default');
		assert.deepStrictEqual(Array.from(h.calls.preparation.at(-1).changes.match_ids),['m2']);
		assert.strictEqual(h.calls.preparation.at(-1).changes.boundaries,false,'A player-pause detail does not alter the call boundary');
		next = structuredClone(next);next.selections[0].call_on_court_diagnostics_by_match_id.m3.eligible = true;ui.apply_call_status(next,'default');
		assert.deepStrictEqual(Array.from(h.calls.preparation.at(-1).changes.match_ids),['m3']);
		next = structuredClone(next);next.selections[0].display_cutoff_match_id = 'm2';ui.apply_call_status(next,'default');
		assert.deepStrictEqual(Array.from(h.calls.preparation.at(-1).changes.match_ids).sort(),['m1','m2']);
	});
	it('updates only changed field markers and skips game rows for a pure demand change', function() {
		const h = harness(), ui = h.context.ctournament;
		const value = {selections:[{location_id:'hall',manual_callable_match_ids:[],demand_court_ids:['c1','shared']},
			{location_id:'other',manual_callable_match_ids:[],demand_court_ids:['shared']}]};
		ui.apply_call_status(value,'default');h.calls.preparation.length = h.calls.demand.length = h.calls.demandIds.length = 0;
		const next = structuredClone(value);next.selections[0].demand_court_ids = ['c2'];ui.apply_call_status(next,'default');
		assert.strictEqual(h.calls.preparation.length,0);
		assert.deepStrictEqual(h.calls.demandIds,[['c1','c2']]);
	});
	it('uses the negotiated changed-game keys without traversing unrelated diagnosis trees', function() {
		const h = harness(), ui = h.context.ctournament;
		const diagnoses = Object.fromEntries(Array.from({length:584}, (_, index) => ['m'+index, {eligible:false,rules:[{key:'ready',passed:false}]}]));
		const first = {call_status:{epoch:'stream',revision:1},selections:[{location_id:'hall',manual_callable_match_ids:[],diagnostics_by_match_id:diagnoses}]};
		ui.apply_call_status(first,'default');h.calls.preparation.length = 0;
		// A status patch for m1 must never inspect the detailed rule trees of
		// the 583 games whose object identities the patch already preserves.
		for (const [id, value] of Object.entries(diagnoses)) if (id !== 'm1') Object.defineProperty(value,'rules',{
			enumerable:true,get() {assert.fail('Unrelated diagnosis was traversed: '+id);},
		});
		const next = {call_status:{epoch:'stream',revision:2},selections_delta:{epoch:'stream',base:1,removed:[],changed:[{
			location_id:'hall',fields:{},unset:[],diagnostics_by_match_id:{set:{m1:{eligible:true,rules:[]}},remove:[]},
		}]}};
		assert.strictEqual(ui.apply_call_status(next,'default'),true);
		assert.deepStrictEqual(Array.from(h.calls.preparation.at(-1).changes.match_ids),['m1']);
		assert.strictEqual(h.context.curt.location_preparation_selection_by_location_id.hall.diagnostics_by_match_id.m2,diagnoses.m2);
		h.calls.preparation.length = 0;
		h.context.document.querySelector = () => assert.fail('An empty patch needs no DOM lookup');
		assert.strictEqual(ui.apply_call_status({call_status:{epoch:'stream',revision:3},selections_delta:{epoch:'stream',base:2,removed:[],changed:[]}},'default'),true);
		assert.strictEqual(h.calls.preparation.length,0);
	});
	it('retains fresh rule explanations without revisiting unchanged row statuses and controls', function() {
		const h = harness(), ui = h.context.ctournament, dialogs = [], tooltips = [];
		h.context.cleitstand = {refreshCallStatus(ids) {dialogs.push(Array.from(ids));}};
		h.context.cmatch.refresh_call_status_details = ids => tooltips.push(Array.from(ids));
		const diagnosis = {manual_eligible:true,criteria_eligible:true,within_call_window:true,rules:[{key:'player_pause',passed:true,detail:'before'}]};
		ui.apply_call_status({call_status:{epoch:'stream',revision:1},selections:[{
			location_id:'hall',manual_callable_match_ids:['m1'],diagnostics_by_match_id:{m1:diagnosis},
		}]},'default');
		h.calls.preparation.length = dialogs.length = tooltips.length = 0;
		const changed = {...diagnosis,rules:[{key:'player_pause',passed:true,detail:'after'}]};
		ui.apply_call_status({call_status:{epoch:'stream',revision:2},selections_delta:{epoch:'stream',base:1,removed:[],changed:[{
			location_id:'hall',fields:{},unset:[],diagnostics_by_match_id:{set:{m1:changed},remove:[]},
		}]}},'default');
		assert.strictEqual(h.calls.preparation.length,0,'Unchanged controls and colours need no row pass');
		assert.deepStrictEqual(dialogs,[['m1']]);assert.deepStrictEqual(tooltips,[['m1']]);
		assert.strictEqual(h.context.curt.location_preparation_selection_by_location_id.hall.diagnostics_by_match_id.m1,changed);
	});
	it('does not recolour a future game when criteria change outside its call window', function() {
		const h=harness(),ui=h.context.ctournament;
		const diagnosis={manual_eligible:true,criteria_eligible:false,within_call_window:false,rules:[]};
		ui.apply_call_status({call_status:{epoch:'stream',revision:1},selections:[{location_id:'hall',manual_callable_match_ids:['m1'],diagnostics_by_match_id:{m1:diagnosis}}]},'default');
		h.calls.preparation.length=0;
		const patch=(revision,value)=>({call_status:{epoch:'stream',revision},selections_delta:{epoch:'stream',base:revision-1,removed:[],changed:[{
			location_id:'hall',fields:{},unset:[],diagnostics_by_match_id:{set:{m1:value},remove:[]},
		}]}});
		ui.apply_call_status(patch(2,{...diagnosis,criteria_eligible:true}),'default');
		assert.strictEqual(h.calls.preparation.length,0);
		ui.apply_call_status(patch(3,{...diagnosis,criteria_eligible:true,within_call_window:true}),'default');
		assert.deepStrictEqual(Array.from(h.calls.preparation.at(-1).changes.match_ids),['m1']);
	});
	it('replaces local fallback permissions when a location first receives authoritative IDs', function() {
		const h = harness();h.context.curt.location_preparation_selection_by_location_id = {};
		h.context.ctournament.apply_call_status({selections:[{location_id:'hall',manual_callable_match_ids:[]}]},'default');
		assert.strictEqual(h.calls.preparation.length,1);
		assert.strictEqual(h.calls.preparation[0].changes.match_ids,null);
	});
	it('applies shared call status once, rejects late revisions and preserves the current tournament', function() {
		const h = harness(), ui = h.context.ctournament;
		let refreshes = 0; h.context.cmatch.refresh_unassigned_preparation_context = () => { refreshes++; };
		const snapshot = (revision, epoch = 'server-one') => ({call_status:{epoch,revision}, selections:[{location_id:'hall',manual_callable_match_ids:['m' + revision]}]});
		assert.strictEqual(ui.apply_call_status(snapshot(2), 'default'), true);
		assert.strictEqual(ui.apply_call_status(snapshot(2), 'default'), false);
		assert.strictEqual(ui.apply_call_status(snapshot(1), 'default'), false);
		assert.strictEqual(ui.apply_call_status(snapshot(3), 'another'), false);
		assert.strictEqual(refreshes, 1);
		assert.strictEqual(ui.apply_call_status(snapshot(1, 'restarted-server'), 'default'), true);
		assert.strictEqual(ui.apply_call_status(snapshot(4), 'default'), false);
		assert.strictEqual(refreshes, 2);
		assert.strictEqual(h.context.curt.call_status.epoch, 'restarted-server');
	});
	it('skips all registration entries of drawn disciplines before preparing the todo overview', function() {
		const h = harness(); let pendingReads = 0;
		h.matches[0].setup.event_name = 'Drawn through matches';
		const drawn = [{ name: 'Drawn', is_drawn: true }, { name: 'Counted', match_count: 2 }, { name: 'Drawn through matches' }];
		for (const event of drawn) Object.defineProperty(event, 'stages', { enumerable: true, get() { return assert.fail('Drawn entry inventory must not be rebuilt'); } });
		const pending = { name: 'Pending', get stages() { pendingReads++; return []; } };
		h.context.curt.events = { events: [...drawn, pending] };
		assert.strictEqual(h.context.ctournament.get_registration_main_todos().length, 0);
		assert(pendingReads > 0, 'The remaining registration inventory must still be considered');
	});
	it('clears completion timestamps from an authoritative reopened snapshot without replacing the match object', function() {
		const h = harness(), match = h.matches[0];
		Object.assign(match, {end_ts: 1234, duration_ms: 7890, btp_winner: 1, team1_won: true});match.setup.state = 'finished';
		const reopened = structuredClone(match);
		for (const key of ['end_ts', 'duration_ms', 'btp_winner', 'team1_won']) delete reopened[key];
		reopened.setup.state = 'scheduled';reopened.setup.preparation_call_deferred = true;
		h.update({val: {match__id: match._id, match: reopened}});
		assert.strictEqual(h.matches[0], match);
		assert.strictEqual(match.end_ts, undefined);assert.strictEqual(match.duration_ms, undefined);
		assert.strictEqual(match.btp_winner, undefined);assert.strictEqual(match.team1_won, undefined);
		assert.strictEqual(match.setup.state, 'scheduled');
	});
	it('keeps device acknowledgement traffic out of document searches while the device table is unmounted', function() {
		const h = harness();
		h.context.document.querySelectorAll = () => assert.fail('No device table lookup is needed without a mounted device table');
		h.context.document.querySelector = () => assert.fail('No device table lookup is needed without a mounted device table');
		for (let index = 0; index < 1000; index++) h.context.ctournament.update_display({client_id:'one'}, {tablets:false});
	});
	it('applies the successor flag with the point, including false and a cleared timestamp', function() {
		const h = harness(), match = h.matches[0], handler = h.routes.find(route => route.regex.test('t/default/')).handler;
		for (const needed of [true, false]) {
			handler.score({ val: { match_id: match._id, network_score: [[21, 18], [10, 7]], presses: [],
				needs_preparation_successor: needed, needs_preparation_successor_ts: needed ? 12345 : null } });
			assert.strictEqual(match.setup.needs_preparation_successor, needed);
			assert.strictEqual(match.setup.needs_preparation_successor_ts, needed ? 12345 : null);
		}
		assert.strictEqual(h.calls.score.length, 2);
		assert.strictEqual(h.calls.update.length, 0);
		handler.score({ val: { match_id: match._id, network_score: [[21, 18], [9, 7]], presses: [] } });
		assert(!('needs_preparation_successor' in match.setup), 'older score messages must not retain an out-of-date flag');
	});
	it('applies a duration directly from compact score updates and accepts older messages without it', function() {
		const h = harness(), match = h.matches[0], handler = h.routes.find(route => route.regex.test('t/default/')).handler;
		for (const duration_ms of [1234, 2345, null]) {
			handler.score({val:{match_id:match._id,network_score:[[2,1]],presses:[],duration_ms}});
			assert.strictEqual(match.duration_ms, duration_ms);
		}
		handler.score({val:{match_id:match._id,network_score:[[3,1]],presses:[]}});
		assert.strictEqual(match.duration_ms, null);
		assert.strictEqual(h.calls.update.length, 0);
	});
	it('uses the confirmed state and winner while building the first finished row', function() {
		const h=harness(),match=h.matches[0],handler=h.routes.find(route=>route.regex.test('t/default/')).handler;
		match.setup.state='oncourt';match.setup.now_on_court=true;
		let rendered=false;
		h.context.cmatch.update_match=(value,_old,section)=>{
			assert.strictEqual(section,'finished');assert.strictEqual(value.setup.state,'finished');
			assert.strictEqual(value.btp_winner,2);assert.strictEqual(value.team1_won,false);rendered=true;
		};
		handler.score({val:{match_id:match._id,network_score:[[12,21],[13,21]],presses:[],
			end_ts:10000,duration_ms:9000,now_on_court:false,state:'finished',btp_winner:2,team1_won:false}});
		assert(rendered);
	});
	it('keeps warning inventory work for special results while skipping ordinary played results', function() {
		for (const status of ['normal','disqualified','retired','walkover','no_match']) {
			const h=harness(),match=h.matches[0],handler=h.routes.find(route=>route.regex.test('t/default/')).handler;
			Object.assign(match.setup,{is_match:true,state:'oncourt',now_on_court:true,teams:[{players:[{btp_id:1}]},{players:[{btp_id:2}]}]});
			match.score_status='normal';
			handler.score({val:{match_id:match._id,network_score:[[21,5],[21,8]],presses:[],state:'finished',now_on_court:false,team1_won:true,btp_winner:1,score_status:status}});
			assert.strictEqual(h.calls.update.length,1);
			assert.strictEqual(h.calls.update[0][3].warningsChanged,status!=='normal',status);
		}
	});

	it('patches a successor-only snapshot without rebuilding the row or its score', function() {
		const h = harness(), match = h.matches[0], incoming = structuredClone(match);
		incoming.setup.needs_preparation_successor = true;
		incoming.setup.needs_preparation_successor_ts = 12345;
		h.update({ val: { match__id: match._id, match: incoming } });
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.score.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
		assert.deepStrictEqual(h.calls.demand, [match]);
	});

    it('copies changed or cleared durations through the incremental update without rebuilding a row', function() {
        const h = harness(), match = h.matches[0], incoming = structuredClone(match);
        incoming.duration_ms = 1800000;
        h.update({ val: { match__id: match._id, match: incoming } });
        assert.strictEqual(match.duration_ms, 1800000);
        assert.deepStrictEqual(h.calls.score, [[match]]);
        assert.strictEqual(h.calls.update.length, 0);
        assert.strictEqual(h.calls.reorder.length, 0);
        incoming.duration_ms = null;
        h.update({ val: { match__id: match._id, match: incoming } });
        assert.strictEqual(match.duration_ms, null);
        assert.strictEqual(h.calls.score.length, 2);
        assert.strictEqual(h.calls.update.length, 0);
    });

    it('patches a score/history-only full snapshot without refreshing players or rebuilding its row', function() {
        const h = harness(), match = h.matches[0], incoming = structuredClone(match);
        incoming.network_score = [[7, 8]];
        incoming.presses = [{ type: 'score', timestamp: 1234 }];
        h.update({ val: { match__id: match._id, match: incoming } });
        assert.deepStrictEqual(h.calls.score, [[match]]);
        assert.strictEqual(h.calls.update.length, 0);
        assert.strictEqual(h.calls.players.length, 0);
        h.update({ val: { match__id: match._id, match: structuredClone(incoming) } });
        assert.strictEqual(h.calls.score.length, 1, 'an identical follow-up is a no-op');
    });
    it('retains an unchanged history during metadata edits and replaces it for an actual score revision', function() {
        const h=harness(),match=h.matches[0],history=[{type:'love-all',timestamp:1000}];match.presses=history;
        let incoming=structuredClone(match);incoming.setup.match_name='Finale';
        h.update({val:{match__id:match._id,match:incoming}});
        assert.strictEqual(match.presses,history);
        assert.strictEqual(match.setup.match_name,'Finale');
        incoming=structuredClone(match);incoming.presses.push({type:'score',timestamp:2000});
        h.update({val:{match__id:match._id,match:incoming}});
        assert.strictEqual(match.presses,incoming.presses);
        assert.strictEqual(match.presses.length,2);
    });

    for (const count of [1, 2]) {
        it('patches check-in and check-out for '+(count===1?'singles':'doubles')+' without rebuilding the row or its actions', function() {
            const h = harness(), match = h.matches[0];
            match.setup.teams = [0, 1].map(team => ({name: 'Team '+team, players: Array.from({length: count}, (_, index) =>
                ({btp_id: team*2+index+1, name: 'Player '+team+' '+index, checked_in: false}))}));
            for (const checked_in of [true, false]) {
                const previous_setup = match.setup, incoming = structuredClone(match);
                incoming.setup.teams[0].players[0].checked_in = checked_in;
                h.update({val: {match__id: match._id, match: incoming}});
                assert.strictEqual(match.setup.teams[0].players[0].checked_in, checked_in);
                assert.strictEqual(h.calls.players.at(-1)[0], match);
                assert.strictEqual(h.calls.players.at(-1)[1].previous_setup, previous_setup);
                assert.strictEqual(h.calls.update.length, 0);
                assert.strictEqual(h.calls.score.length, 0);
                assert.strictEqual(h.calls.metadata.length, 0);
                assert.strictEqual(h.calls.reorder.length, 0);
                const calls = h.calls.players.length;
                h.update({val: {match__id: match._id, match: structuredClone(incoming)}});
                assert.strictEqual(h.calls.players.length, calls, 'Repeated check-in snapshots must be a no-op');
            }
        });
    }

    for (const field of ['last_time_on_court_ts', 'tablet_break_active', 'tablet_break_until_ts']) {
        it('patches and clears '+field+' with check-in without rebuilding the row or changing its order', function() {
            const h = harness(), match = h.matches[0];
            match.setup.teams = [{players: [{btp_id: 1, checked_in: false}]}, {players: [{btp_id: 2}]}];
            for (const value of [field === 'tablet_break_active' ? true : 1234, undefined]) {
                const previous_setup = match.setup, incoming = structuredClone(match);
                incoming.setup.teams[0].players[0].checked_in = !incoming.setup.teams[0].players[0].checked_in;
                if (value === undefined) delete incoming.setup.teams[0].players[0][field];
                else incoming.setup.teams[0].players[0][field] = value;
                h.update({val: {match__id: match._id, match: incoming}});
                assert.strictEqual(match.setup.teams[0].players[0][field], value);
                assert.strictEqual(h.calls.players.at(-1)[0], match);
                assert.strictEqual(h.calls.players.at(-1)[1].previous_setup, previous_setup);
                assert.strictEqual(h.calls.update.length, 0);
                assert.strictEqual(h.calls.score.length, 0);
                assert.strictEqual(h.calls.reorder.length, 0);
            }
        });
    }

    it('combines a check-in with metadata and score changes without rebuilding the row', function() {
        const h = harness(), match = h.matches[0];
        match.setup.teams = [{players: [{btp_id: 1, checked_in: false}]}, {players: [{btp_id: 2}]}];
        const incoming = structuredClone(match);
        incoming.setup.teams[0].players[0].checked_in = true;
        incoming.setup.match_name = 'Finale';incoming.network_score = [[5, 6]];
        h.update({val: {match__id: match._id, match: incoming}});
        assert.strictEqual(h.calls.players.length, 1);
        assert.deepStrictEqual(h.calls.metadata, [[match, ['match_name']]]);
        assert.deepStrictEqual(h.calls.score, [[match]]);
        assert.strictEqual(h.calls.update.length, 0);
    });

    for (const field of ['now_playing_on_court', 'now_tablet_on_court']) {
        it('patches and clears '+field+' without rebuilding names, controls or scores', function() {
            const h = harness(), match = h.matches[0];
            match.setup.teams = [{players: [{btp_id: 1, name: 'One'}]}, {players: [{btp_id: 2, name: 'Two'}]}];
            for (const value of ['CH_10', false, undefined]) {
                const previous_setup = match.setup, incoming = structuredClone(match);
                if (value === undefined) delete incoming.setup.teams[0].players[0][field];
                else incoming.setup.teams[0].players[0][field] = value;
                h.update({val: {match__id: match._id, match: incoming}});
                assert.strictEqual(match.setup.teams[0].players[0][field], value);
                assert.strictEqual(h.calls.players.at(-1)[1].previous_setup, previous_setup);
                assert.strictEqual(h.calls.update.length, 0);
                assert.strictEqual(h.calls.score.length, 0);
                assert.strictEqual(h.calls.reorder.length, 0);
            }
            const incoming = structuredClone(match);incoming.setup.state = 'blocked';
            incoming.setup.teams[0].players[0][field] = 'CH_11';
            h.update({val: {match__id: match._id, match: incoming}});
            assert.strictEqual(h.calls.update.length, 1, 'a changed match state still updates the whole row');
        });
    }

    it('retains structural updates for changed participant identities and names', function() {
        for (const change of [
            teams => {teams[0].players[0].btp_id = 99;},
            teams => {teams[0].players[0].name = 'New name';},
            teams => {teams[0].players.push({btp_id: 3});},
            teams => {teams[0].name = 'New team';},
            teams => {teams.reverse();},
        ]) {
            const h = harness(), match = h.matches[0];
            match.setup.teams = [{players: [{btp_id: 1, name: 'One'}]}, {players: [{btp_id: 2, name: 'Two'}]}];
            const incoming = structuredClone(match);change(incoming.setup.teams);
            h.update({val: {match__id: match._id, match: incoming}});
            assert.deepStrictEqual(h.calls.update.map(([value,old,next,options])=>[value,old,next,{...options}]), [[match, 'unassigned', 'unassigned', {warningsChanged:true,orderChanged:false}]]);
        }
    });

    it('keeps the existing setup and player nodes untouched for identical player status messages', function() {
        const h = harness(), match = h.matches[0], setup = match.setup;
        const handler = h.routes.find(route => route.regex.test('t/default/')).handler;
        handler.update_player_status({ val: { match__id: match._id, setup: structuredClone(setup) } });
        assert.strictEqual(match.setup, setup);
        assert.strictEqual(h.calls.players.length, 0);
        const changed = structuredClone(setup);
        changed.teams = [{ players: [{ btp_id: 1, checked_in: true }] }];
        handler.update_player_status({ val: { match__id: match._id, setup: changed } });
        assert.strictEqual(match.setup, changed);
        assert.strictEqual(h.calls.players.length, 1);
        assert.strictEqual(h.calls.players[0][0], match);
        assert.strictEqual(h.calls.players[0][1].previous_setup, setup);
        handler.update_player_status({ val: { match__id: match._id, setup: structuredClone(changed) } });
        assert.strictEqual(h.calls.players.length, 1);
    });

	it('refreshes only previous and current participants when queue entries change', function() {
		const h = harness(), handler = h.routes.find(route => route.regex.test('t/default/')).handler;
		h.context.curt.tabletoperators = [{ _id: 'queue', court: null, tabletoperator: [{ btp_id: 1 }, { btp_id: 2 }] }];
		handler.tabletoperator_add({ val: { tabletoperator: { _id: 'queue', court: null, tabletoperator: [{ btp_id: 2 }] } } });
		handler.tabletoperator_removed({ val: { tabletoperator: { _id: 'queue', court: 'court_1', tabletoperator: [{ btp_id: 2 }] } } });
		assert.deepStrictEqual(h.calls.playerIds, [['1', '2'], ['2']]);
		assert.strictEqual(h.calls.update.length, 0);
	});

	it('applies live pronunciation additions in the same order as after reloading and refreshes readiness', function() {
		const h = harness(), changes = [];
		h.context.curt.normalizations = [{ _id: 'j-specific', origin: 'Nguyen', replace: 'Nuehjen', language: 'de-DE' }];
		h.context.btsSpeechReadiness = { changed: () => changes.push(true) };
		h.context.ctournament.add_normalization({ val: { normalization: { _id: 'Z-general', origin: 'Ng', replace: 'Nick', language: 'de-DE' } } });
		assert.deepStrictEqual(h.context.curt.normalizations.map(n => n._id), ['Z-general', 'j-specific']);
		const texts = require('../static/js/announcement_text')({ tournament: h.context.curt,
			translate: key => key === 'announcements:lang' ? 'de-DE' : key });
		assert.strictEqual(texts.normalizeNames('Nguyen'), 'Nickuyen');
		h.context.ctournament.remove_normalization({ val: { normalization_id: 'Z-general' } });
		assert.strictEqual(texts.normalizeNames('Nguyen'), 'Nuehjen');
		assert.strictEqual(changes.length, 2);
		assert.strictEqual(h.calls.update.length, 0, 'pronunciation updates need no match-table rebuild');
	});

	it('applies a changed BTP order by moving only the affected row', function() {
		const h = harness(), target = h.matches[2];
		const incoming = { ...structuredClone(target), match_order: 1, _btp_sync_signature: 'new' };
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.match_order, 1);
		assert.deepStrictEqual(h.matches.map(match => match._id), ['m3', 'm1', 'm2']);
		assert.deepStrictEqual(h.calls.reorder, [[target, 'unassigned']]);
		assert.strictEqual(h.calls.update.length, 0);
	});

	it('patches the planned time and repositions the existing row without updating players or scores', function() {
		const h = harness(), target = h.matches[2];
		const incoming = structuredClone(target);
		incoming.match_order = 7;
		incoming.setup.scheduled_time_str = '09:00';
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.setup.scheduled_time_str, '09:00');
		assert.deepStrictEqual(h.matches.map(match => match._id), ['m3', 'm1', 'm2']);
		assert.deepStrictEqual(h.calls.metadata, [[target, ['scheduled_time_str']]]);
		assert.deepStrictEqual(h.calls.reorder, [[target, 'unassigned']]);
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.score.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
	});

	it('does not sort the match list again for unrelated metadata changes', function() {
		const h = harness(), target = h.matches[1];
		h.matches.sort = () => { throw new Error('unnecessary list sort'); };
		const incoming = structuredClone(target);
		incoming.setup.event_name = 'Changed event';
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(h.calls.reorder.length, 0);
		assert.strictEqual(h.calls.update.length, 0);
		assert.deepStrictEqual(h.calls.metadata, [[target, ['event_name']]]);
		assert.strictEqual(h.calls.score.length, 0);
	});

	it('changes only the preparation clock when its start timestamp changes', function() {
		const h = harness(), target = h.matches[0];
		target.setup.state = 'preparation';
		target.setup.preparation_call_timestamp = 10000;
		const incoming = structuredClone(target);
		incoming.setup.preparation_call_timestamp = 20000;
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.setup.preparation_call_timestamp, 20000);
		assert.deepStrictEqual(h.calls.score, [[target]]);
		assert.strictEqual(h.calls.metadata.length, 0);
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
	});

	it('patches changed metadata and scores together without reconstructing the row', function() {
		const h = harness(), target = h.matches[0], incoming = structuredClone(target);
		incoming.setup.match_name = 'Finale';
		incoming.network_score = [[12, 15]];
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.deepStrictEqual(h.calls.metadata, [[target, ['match_name']]]);
		assert.deepStrictEqual(h.calls.score, [[target]]);
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
	});

	it('retains the structural update for unknown setup fields or changed pairings', function() {
		for (const [warningsChanged,update] of [[false,setup => { setup.new_unknown_dependency = true; }], [true,setup => { setup.teams = [{ players: [{ btp_id: 123, name: 'Neue Person' }] }]; }]]) {
			const h = harness(), target = h.matches[0], incoming = structuredClone(target);
			update(incoming.setup);
			h.update({ val: { match__id: target._id, match: incoming } });
			assert.deepStrictEqual(h.calls.update.map(([value,old,next,options])=>[value,old,next,{...options}]), [[target, 'unassigned', 'unassigned', {warningsChanged,orderChanged:false}]]);
			assert.strictEqual(h.calls.metadata.length, 0);
		}
	});

	it('does not touch the DOM for an update containing only unchanged data and bookkeeping', function() {
		const h = harness(), target = h.matches[1];
		h.matches.sort = () => { throw new Error('unnecessary list sort'); };
		const incoming = { ...structuredClone(target), _btp_sync_signature: 'new' };
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(h.calls.reorder.length, 0);
		assert.strictEqual(h.calls.update.length, 0);
	});

	it('also updates the order used by the public upcoming view', function() {
		const h = harness(), target = h.matches[0];
		const incoming = { ...structuredClone(target), match_order: 0 };
		const route = h.routes.find(route => route.regex.test('t/default/upcoming'));
		route.handler.match_edit({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.match_order, 0);
		assert.deepStrictEqual(h.matches.map(match => match._id), ['m2', 'm3', 'm1']);
	});
});
