'use strict';

const assert = require('assert'), {promisify} = require('util');
const calculator = require('../bts/call_status/calculator');
const rules = require('../bts/match_automation');
const transport = require('../bts/call_status/transport');
const statuses = require('../bts/call_status');
const deferred = () => { let resolve;const promise = new Promise(done => { resolve = done; });return {promise,resolve}; };
const now = 1794560000000;
function fixture() {
	const input = {key:'worker-status',official_rotation_mode:'disabled',call_preparation_matches_automatically_enabled:true,
		preparation_call_participant_readiness_mode:'checked_in',call_on_court_participant_readiness_mode:'checked_in',
		locations:[{_id:'hall',name:'Häll 🏸'},{_id:'second'}],courts:[
			{_id:'court',num:1,location_id:'hall',is_active:true},{_id:'other',num:2,location_id:'second',is_active:true}],
		umpires:[],tabletoperators:[],matches:[]};
	for (let n = 0;n < 120;n++) input.matches.push({_id:'game-' + n,tournament_key:input.key,match_order:n,
		presses:[{at:new Date(now),optional:undefined}],setup:{is_match:true,state:n === 1 ? 'preparation' : 'scheduled',
			location_id:n % 2 ? 'second' : 'hall',match_num:n,preparation_call_timestamp:n === 1 ? now - 60000 : undefined,
			teams:[{players:[{btp_id:n*2,name:'Änne ' + n,checked_in:true}]},{players:[{btp_id:n*2+1,name:'B ' + n,checked_in:true}]}]}});
	return input;
}
async function app_fixture(input) {
	const db = await require('../bts/database').init_test(), app = {db,clock:{now_ms:() => now}};
	const {matches,locations,courts,umpires,tabletoperators,...tournament} = input;
	await promisify(db.tournaments.insert.bind(db.tournaments))(tournament);
	for (const [name,docs] of Object.entries({matches,locations,courts,umpires,tabletoperators})) if (docs.length) {
		await promisify(db[name].insert.bind(db[name]))(docs.map(doc => ({...doc,tournament_key:input.key})));
	}
	return app;
}

describe('isolated shared call status calculations',function() {
	this.timeout(10000);
	let original_run,previous,apps;
	beforeEach(function() { original_run = calculator.client.run;previous = process.env.BTS_CALL_STATUS_WORKER;process.env.BTS_CALL_STATUS_WORKER = '1';apps = []; });
	afterEach(function() {
		calculator.client.run = original_run;calculator.client.close();for (const app of apps) statuses.close(app);
		if (previous === undefined) delete process.env.BTS_CALL_STATUS_WORKER;else process.env.BTS_CALL_STATUS_WORKER = previous;
	});
	for (const automatic_only of [false,true]) it('retains every decision and original document reference (automatic=' + automatic_only + ')',async function() {
		const input = fixture(), options = {now_ts:now,automatic_only,cooperative:true};let calls = 0;
		calculator.client.run = function(...args) { calls++;return original_run.apply(this,args); };
		const expected = await rules.calculate_all_location_preparation_selections(input,options);
		const actual = await calculator.calculate(input,options);
		assert.strictEqual(calls,1);assert.deepStrictEqual(actual,expected);
		for (const row of actual) {
			assert.strictEqual(row.location,input.locations.find(location => location._id === row.location_id));
			for (const match of row.relevant_matches) assert.strictEqual(match,input.matches.find(candidate => candidate._id === match._id));
		}
	});
	it('retains dates, undefined values, empty collections and marker-shaped user data in the input transport',async function() {
		const input = fixture();input.optional = undefined;input.date = new Date(now);input.extra = ['bts-call-status-ref',1];input.umpires = [];
		const output = transport.decode_input(await transport.encode_input(input));assert.deepStrictEqual(output,input);
	});
	it('reuses unchanged diagnostics while restoring every current input document',async function() {
		const input = fixture(),options = {now_ts:now,cooperative:true};
		const first = await calculator.calculate(input,options),changed = structuredClone(input);
		changed.matches[1].setup.teams[0].players[0].checked_in = false;
		const second = await calculator.calculate(changed,options,first);
		assert.deepStrictEqual(second,await rules.calculate_all_location_preparation_selections(changed,options));
		const oldHall = first.find(row => row.location_id === 'hall'),newHall = second.find(row => row.location_id === 'hall');
		assert.strictEqual(newHall.diagnostics_by_match_id['game-0'],oldHall.diagnostics_by_match_id['game-0']);
		const oldSecond = first.find(row => row.location_id === 'second'),newSecond = second.find(row => row.location_id === 'second');
		assert.notStrictEqual(newSecond.call_on_court_diagnostics_by_match_id['game-1'],oldSecond.call_on_court_diagnostics_by_match_id['game-1']);
		for (const row of second) for (const match of row.relevant_matches) assert.strictEqual(match,changed.matches.find(candidate => candidate._id === match._id));
	});
	it('honors a custom calculator and the explicit comparison switch',async function() {
		const input = fixture(), original = rules.calculate_all_location_preparation_selections;let calls = 0;
		calculator.client.run = () => { throw Error('unexpected worker'); };
		rules.calculate_all_location_preparation_selections = (...args) => { calls++;return original(...args); };
		try { await calculator.calculate(input,{now_ts:now,cooperative:true});assert.strictEqual(calls,1); }
		finally { rules.calculate_all_location_preparation_selections = original; }
		process.env.BTS_CALL_STATUS_WORKER = '0';await calculator.calculate(input,{now_ts:now,cooperative:true});
	});
	it('recalculates a check-in changed while the real worker result was in flight',async function() {
		const input = fixture(), app = await app_fixture(input);apps.push(app);
		const entered = deferred(), gate = deferred();let calls = 0;
		calculator.client.run = async function(...args) {
			const result = await original_run.apply(this,args);if (++calls === 1) { entered.resolve();await gate.promise; }return result;
		};
		const reading = statuses(app).snapshot(input.key);await entered.promise;
		await app.db.matches.update_async({_id:'game-1'},{$set:{'setup.teams.0.players.0.checked_in':false}},{});
		gate.resolve();const result = await reading;assert(calls >= 2);
		const diagnosis = result.selections.find(row => row.location_id === 'second').call_on_court_diagnostics_by_match_id['game-1'].court_diagnostics[0];
		assert.strictEqual(diagnosis.rules.find(rule => rule.key === 'players_checked_in').passed,false);
	});
	it('does not publish a late worker result after the service is closed',async function() {
		const input = fixture(),app = await app_fixture(input);apps.push(app);
		const entered = deferred(),gate = deferred();let publications = 0;
		calculator.client.run = async function(...args) { const result = await original_run.apply(this,args);entered.resolve();await gate.promise;return result; };
		const service = statuses(app);service.publish = () => { publications++; };
		const reading = service.snapshot(input.key);await entered.promise;service.close();gate.resolve();
		await assert.rejects(reading,/beendet/);assert.strictEqual(publications,0);
	});
	it('logs the worker failure and falls back to the identical local decisions',async function() {
		const input = fixture(),options = {now_ts:now,cooperative:true};const original = console.error,errors = [];
		calculator.client.run = () => Promise.reject(new Error('worker unavailable'));
		console.error = (...args) => errors.push(args.join(' '));
		try {
			assert.deepStrictEqual(await calculator.calculate(input,options),await rules.calculate_all_location_preparation_selections(input,options));
			assert.strictEqual(errors.length,1);assert(errors[0].includes('worker unavailable'));
		} finally { console.error = original; }
	});
});
