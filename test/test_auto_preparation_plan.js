'use strict';

const assert=require('assert'),{promisify}=require('util');
const database=require('../bts/database'),calls=require('../bts/match_utils'),rules=require('../bts/match_automation');
const queue=require('../bts/update_queue'),worker=require('../bts/btp_planner').client;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
let sequence=0;
async function fixture() {
	const db=await database.init_test(),key='preparation-plan-'+ ++sequence;
	const app={db,wss:{clients:[]},clock:{now_ms:()=>1000000}};
	const insert=(collection,value)=>promisify(db[collection].insert.bind(db[collection]))(value);
	await insert('tournaments',{key,btp_enabled:false,automation_enabled:true,official_rotation_mode:'disabled',
		call_preparation_matches_automatically_enabled:true,preparation_call_min_gap_seconds:0});
	await insert('locations',{_id:'hall',tournament_key:key,name:'Hall',highlight:1});
	await insert('courts',[{_id:'free',tournament_key:key,location_id:'hall',is_active:true},
		{_id:'occupied',tournament_key:key,location_id:'hall',is_active:true,match_id:'running'}]);
	const setup=n=>({is_match:true,incomplete:false,state:'scheduled',location_id:'hall',match_num:n,
		teams:[{players:[{btp_id:n*2,name:'A'+n}]},{players:[{btp_id:n*2+1,name:'B'+n}]}]});
	await insert('matches',[{_id:'scheduled',tournament_key:key,setup:setup(1)},
		{_id:'running',tournament_key:key,network_score:[[1,0]],setup:{...setup(2),state:'oncourt',now_on_court:true,court_id:'occupied'}}]);
	const call=()=>new Promise((resolve,reject)=>calls.queue_auto_execute_preparation_selections(app,key,error=>error?reject(error):resolve()));
	return {app,key,call};
}

describe('automatic preparation planning outside allocation locks',function(){
	let previous;
	beforeEach(function(){previous=process.env.BTS_SYNC_PLAN_WORKER;});
	afterEach(function(){worker.close();if(previous===undefined)delete process.env.BTS_SYNC_PLAN_WORKER;else process.env.BTS_SYNC_PLAN_WORKER=previous;});
	for(const mode of ['0','1'])it('prepares an eligible local game without a BTP connection (worker='+mode+')',async function(){
		process.env.BTS_SYNC_PLAN_WORKER=mode;const {app,call}=await fixture();await call();
		const match=await app.db.matches.findOne_async({_id:'scheduled'});
		assert.strictEqual(match.setup.state,'preparation');assert.strictEqual(match.setup.location_id,'hall');
		assert.strictEqual(match.setup.preparation_call_timestamp,1000000);assert.strictEqual(match.setup.now_on_court,undefined);
	});
	it('does not start a worker plan when automatic preparation is disabled',async function(){
		process.env.BTS_SYNC_PLAN_WORKER='1';const {app,key,call}=await fixture(),native=worker.run;
		await app.db.tournaments.update_async({key},{$set:{call_preparation_matches_automatically_enabled:false}},{});
		worker.run=()=>{throw new Error('unnecessary preparation plan');};
		try{await call();}finally{worker.run=native;}
		assert.strictEqual((await app.db.matches.findOne_async({_id:'scheduled'})).setup.state,'scheduled');
	});
	it('lets an independent finish proceed during selection and replans against the finished game',async function(){
		process.env.BTS_SYNC_PLAN_WORKER='0';const {app,key,call}=await fixture(),entered=deferred(),gate=deferred();
		const original=rules.fetch_location_preparation_selection;let selections=0,finished=false;
		rules.fetch_location_preparation_selection=async function(...args){selections++;if(selections===1){entered.resolve();await gate.promise;}return original.apply(this,args);};
		const planning=call();let finish;
		try {
			await entered.promise;
			finish=queue.execute_locked([queue.lock_keys.preparation(key),queue.lock_keys.tabletoperators(key),queue.lock_keys.umpires(key)],
				queue.named('independent_test_finish',async()=>{await app.db.matches.update_async({_id:'running'},{$set:{team1_won:true,'setup.state':'finished','setup.now_on_court':false}},{});finished=true;}));
			for(let n=0;n<20&&!finished;n++)await turn();
			assert(finished,'selection must not hold the locks needed to finish another game');
		}finally{gate.resolve();await planning;await finish;rules.fetch_location_preparation_selection=original;}
		assert(selections>=2,'the changed planning input must be validated and recomputed');
		assert.strictEqual((await app.db.matches.findOne_async({_id:'running'})).team1_won,true);
		assert.strictEqual((await app.db.matches.findOne_async({_id:'scheduled'})).setup.state,'preparation');
	});
	it('defers the minimum-gap timer from the worker until the validated plan is committed',async function(){
		process.env.BTS_SYNC_PLAN_WORKER='1';const {app,key,call}=await fixture();
		await app.db.tournaments.update_async({key},{$set:{preparation_call_min_gap_seconds:30}},{});
		await promisify(app.db.courts.insert.bind(app.db.courts))({_id:'second-free',tournament_key:key,location_id:'hall',is_active:true});
		const prepared=await app.db.matches.findOne_async({_id:'scheduled'});
		await promisify(app.db.matches.insert.bind(app.db.matches))({...prepared,_id:'previous',setup:{...prepared.setup,match_num:0,
			state:'preparation',preparation_call_timestamp:990000,
			teams:[{players:[{btp_id:50,name:'Previous A'}]},{players:[{btp_id:51,name:'Previous B'}]}]}});
		const native=setTimeout,run=worker.run,scheduled=[],effects=[];
		global.setTimeout=(callback,ms,...args)=>{if(ms===20000){scheduled.push(callback);return {unref(){}};}return native(callback,ms,...args);};
		worker.run=async function(...args){const value=await run.apply(this,args);effects.push(...(value.effects||[]));return value;};
		try {
			await call();
			assert.strictEqual((await app.db.matches.findOne_async({_id:'scheduled'})).setup.state,'scheduled');
			assert(effects.some(effect=>effect.command?.method==='schedule_auto_execute_preparation_selection_after_gap'&&effect.resources.deferred_job));
			assert.strictEqual(scheduled.length,1,'only the real application may install the deferred gap timer');
		}finally{global.setTimeout=native;worker.run=run;}
	});
	it('discards a planned call when its participants become incomplete before commit',async function(){
		process.env.BTS_SYNC_PLAN_WORKER='0';const {app,call}=await fixture(),entered=deferred(),gate=deferred();
		const original=rules.fetch_location_preparation_selection;let selections=0;
		rules.fetch_location_preparation_selection=async function(...args){
			const value=await original.apply(this,args);if(++selections===1){entered.resolve();await gate.promise;}return value;
		};
		const planning=call();
		try {
			await entered.promise;
			assert.strictEqual((await app.db.matches.findOne_async({_id:'scheduled'})).setup.state,'scheduled');
			await app.db.matches.update_async({_id:'scheduled'},{$set:{'setup.incomplete':true,'setup.teams.0.players':[]}},{});
		}finally{gate.resolve();try{await planning;}finally{rules.fetch_location_preparation_selection=original;}}
		const match=await app.db.matches.findOne_async({_id:'scheduled'});
		assert.strictEqual(match.setup.incomplete,true);assert.strictEqual(match.setup.state,'scheduled');
		assert.strictEqual(match.setup.preparation_call_timestamp,undefined);assert(selections>=2);
	});
	it('subtracts elapsed planning time when replaying a deferred gap timer',function(){
		let now=1000;const app={db:{},clock:{now_ms:()=>now},_btp_sync_effects:[],_btp_serializable_effects:true};
		calls.schedule_auto_execute_preparation_selection_after_gap(app,'gap-replay-'+ ++sequence,10000);
		assert.strictEqual(app._btp_sync_effects.length,1);now=4000;
		const native=setTimeout,delays=[];
		global.setTimeout=(callback,ms)=>{delays.push(ms);return {unref(){}};};
		try {require('../bts/btp_sync_effects').restore(app._btp_sync_effects[0]).run({db:{},clock:app.clock});}
		finally{global.setTimeout=native;}
		assert.deepStrictEqual(delays,[7000]);
	});
});
