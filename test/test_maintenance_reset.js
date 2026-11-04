'use strict';

const assert = require('assert');
const {promisify} = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');
const manager = require('../bts/btp_manager');
const maintenance = require('../bts/maintenance_reset');

describe('Selected maintenance resets', function() {
 let app, original;
 beforeEach(async function() {
  original = {get_status:manager.get_status,clear_court_assignments:manager.clear_court_assignments,update_players:manager.update_players,reset_match_results:manager.reset_match_results,fetch:manager.fetch};
  manager.get_status = () => ({status:'connected'});manager.clear_court_assignments = async (_key,matches) => ({allowed_match_ids:matches.map(match => match._id),btp_changed_matches:matches.length,skipped_matches:0});
  manager.update_players = () => true;manager.reset_match_results = async () => {};manager.fetch = () => {};
  app = {db:await database.init_test(),clock:{now_ms:() => 123456}};
  for (const table of ['tournaments','matches','courts']) app.db[table].insert_async = promisify(app.db[table].insert.bind(app.db[table]));
  await app.db.tournaments.insert_async({key:'cup',name:'Keep',btp_enabled:false,btp_readonly:true});
  const teams = [{players:[{btp_id:1,name:'A',checked_in:true,last_time_on_court_ts:100}]},{players:[{btp_id:2,name:'B',tablet_break_until_ts:200}]}];
  await app.db.matches.insert_async([
   {_id:'finished',tournament_key:'cup',btp_match_ids:[{id:1}],team1_won:false,btp_winner:2,end_ts:100,presses:[['point',1]],network_score:[[12,21]],
    setup:{state:'finished',now_on_court:false,court_id:'c1',event_name:'JE',match_num:1,teams,called_timestamp:90}},
   {_id:'planned',tournament_key:'cup',setup:{state:'scheduled',court_id:'c2',teams}},
   {_id:'running',tournament_key:'cup',team1_won:true,setup:{state:'oncourt',now_on_court:true,court_id:'c3',teams}},
   {_id:'bye',tournament_key:'cup',team1_won:true,setup:{state:'finished',teams:[{players:[]},teams[1]]}},
   {_id:'foreign',tournament_key:'other',team1_won:true,setup:{state:'finished',teams}},
  ]);
  await app.db.courts.insert_async([{_id:'c1',tournament_key:'cup',match_id:'finished',is_active:true},{_id:'c2',tournament_key:'cup',match_id:'planned'},{_id:'c3',tournament_key:'cup',match_id:'running'}]);
 });
 afterEach(function() {Object.assign(manager,original);});
 async function call(values) {
  let reply;await admin.handle_maintenance_reset(app,{respond:(...args) => {reply = args;}},{type:'maintenance_reset',tournament_key:'cup',...values});
  assert(reply);return {error:reply[1],result:reply[2]};
 }
 it('validates all selection fields before executing any action', async function() {
  let calls = 0;
  for (const plan of [{target:'both',actions:[]},{target:'remote',actions:['player_pauses']},{target:'bts',actions:['tournament']},
   {target:'bts',actions:['player_pauses','player_pauses']},{target:'bts',actions:['__proto__']},{target:'bts',actions:['court_assignments'],match_ids:['finished']},
   {target:'bts',actions:['match_results'],match_ids:[]},{target:'bts',actions:['match_results'],match_ids:['finished','finished']}]) {
   await assert.rejects(maintenance.execute(plan,{player_pauses:() => calls++,court_assignments:() => calls++}));
  }
  assert.strictEqual(calls,0);
 });
 it('resets only local court assignments and pauses without any BTP request or disabling its configuration', async function() {
  manager.clear_court_assignments = manager.update_players = () => {throw new Error('Must not contact BTP');};
  const {error,result} = await call({target:'bts',actions:['player_pauses','court_assignments']});assert.ifError(error);
  assert.deepStrictEqual(result.completed,['court_assignments','player_pauses']);
  const match = await app.db.matches.findOne_async({_id:'planned'});assert.strictEqual(match.setup.court_id,null);
  assert.strictEqual(match.setup.teams[0].players[0].last_time_on_court_ts,undefined);
  assert.strictEqual((await app.db.matches.findOne_async({_id:'running'})).setup.court_id,'c3');
  assert.strictEqual((await app.db.tournaments.findOne_async({key:'cup'})).btp_readonly,true);
 });
 it('clears selected results and winners while preserving players, draws, schedule, other games and current courts', async function() {
  manager.reset_match_results = () => {throw new Error('Must not contact BTP');};
  const before = await app.db.matches.findOne_async({_id:'finished'}), foreign = await app.db.matches.findOne_async({_id:'foreign'});
  const {error,result} = await call({target:'bts',actions:['match_results'],match_ids:['finished']});assert.ifError(error);
  assert.strictEqual(result.results.match_results.changed_matches,1);
  const match = await app.db.matches.findOne_async({_id:'finished'});
  for (const field of ['team1_won','btp_winner','end_ts','network_score']) assert.strictEqual(match[field],undefined);
  assert.deepStrictEqual(match.presses,[]);assert.strictEqual(match.setup.state,'scheduled');assert.strictEqual(match.setup.court_id,'c1');
  assert.deepStrictEqual(match.setup.teams,before.setup.teams);assert.deepStrictEqual(match.btp_match_ids,before.btp_match_ids);
  assert.deepStrictEqual(await app.db.matches.findOne_async({_id:'foreign'}),foreign);
  assert.strictEqual((await app.db.courts.findOne_async({_id:'c1'})).match_id,null);
  assert.strictEqual((await app.db.courts.findOne_async({_id:'c3'})).match_id,'running');
 });
 it('skips running games and automatic bye winners when all results are selected', async function() {
  const {error,result} = await call({target:'bts',actions:['match_results']});assert.ifError(error);assert.strictEqual(result.results.match_results.changed_matches,1);
  assert.strictEqual((await app.db.matches.findOne_async({_id:'running'})).team1_won,true);
  assert.strictEqual((await app.db.matches.findOne_async({_id:'bye'})).team1_won,true);
 });
 it('rejects unknown, foreign, running or bye selections before changing any result', async function() {
  for (const id of ['missing','foreign','running','bye']) {
   const {error} = await call({target:'bts',actions:['match_results'],match_ids:['finished',id]});assert(error);
   assert.strictEqual((await app.db.matches.findOne_async({_id:'finished'})).team1_won,false);
  }
 });
 it('requires a writable connected BTP session before any combined reset', async function() {
  for (const settings of [{btp_enabled:false,btp_readonly:false},{btp_enabled:true,btp_readonly:true},{btp_enabled:true,btp_readonly:false}]) {
   await app.db.tournaments.update_async({key:'cup'},{$set:settings},{});manager.get_status = () => ({status:'error'});
   assert((await call({target:'both',actions:['player_pauses']})).error);
   assert.strictEqual((await app.db.matches.findOne_async({_id:'planned'})).setup.teams[0].players[0].last_time_on_court_ts,100);
  }
 });
 it('waits for BTP winner verification before clearing the local results', async function() {
  await app.db.tournaments.update_async({key:'cup'},{$set:{btp_enabled:true,btp_readonly:false}},{});
  manager.reset_match_results = async () => {assert.strictEqual((await app.db.matches.findOne_async({_id:'finished'})).team1_won,false);throw new Error('BTP kept its winner');};
  const {error} = await call({target:'both',actions:['match_results'],match_ids:['finished']});assert(error.message.includes('BTP kept its winner'));
  assert.strictEqual((await app.db.matches.findOne_async({_id:'finished'})).team1_won,false);
 });
 it('reports completed steps if a later reset fails, instead of reporting total success', async function() {
  await app.db.tournaments.update_async({key:'cup'},{$set:{btp_enabled:true,btp_readonly:false}},{});
  manager.clear_court_assignments = async () => {throw new Error('Court transfer failed');};
  const {error} = await call({target:'both',actions:['match_results','court_assignments'],match_ids:['finished']});
  assert.deepStrictEqual(error.completed,['match_results']);assert(error.message.includes('Bereits ausgeführt: Ergebnisse und Sieger'));
  assert.strictEqual((await app.db.matches.findOne_async({_id:'finished'})).team1_won,undefined);
  assert.strictEqual((await app.db.matches.findOne_async({_id:'planned'})).setup.court_id,'c2');
 });
 it('requests a fresh BTP import after resetting results so BTP owns the draw dependencies', async function() {
  await app.db.tournaments.update_async({key:'cup'},{$set:{btp_enabled:true,btp_readonly:false}},{});
  let imported;manager.fetch = key => {imported = key;};
  const {error} = await call({target:'both',actions:['match_results'],match_ids:['finished']});assert.ifError(error);assert.strictEqual(imported,'cup');
 });
 it('rejects malformed tournament IDs and unsupported remote full resets without changing data', async function() {
  assert((await call({target:'bts',actions:['player_pauses'],tournament_key:{$ne:''}})).error);
  let reply;await admin.handle_tournament_reset(app,{respond:(...args) => {reply = args;}},{tournament_key:'cup',target:'both'});
  assert(reply[1].message.includes('nur für BTS'));assert.strictEqual((await app.db.matches.find_async({})).length,5);
 });
});
