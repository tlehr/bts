'use strict';

const assert = require('assert');
const {promisify} = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');
const manager = require('../bts/btp_manager');
const random = require('../bts/random_results');
const scoring = require('../static/js/match_scoring');

function match(id,number,extra = {}) {
 return {_id:id,tournament_key:'cup',btp_match_ids:[{id:number,draw:1,planning:number}],setup:{match_num:number,is_match:true,
  state:'scheduled',scheduled_date:'2026-11-21',scheduled_time_str:'12:00',
  teams:[{players:[{name:'A',btp_id:1}]},{players:[{name:'B',btp_id:2}]}]},...extra};
}
describe('Debug random results',function() {
 let app,original,writes,syncs;
 beforeEach(async function() {
  original = {...manager};writes = [];syncs = 0;
  manager.get_status = () => ({status:'connected'});
  manager.sync_random_results = async () => {syncs++;};
  manager.write_random_results = async (key,matches) => {writes.push(...matches);return {changed:matches.length};};
  app = {db:await database.init_test()};
  for (const table of ['matches','tournaments']) app.db[table].insert_async = promisify(app.db[table].insert.bind(app.db[table]));
  await app.db.tournaments.insert_async({key:'cup',btp_enabled:true});
 });
 afterEach(function() {Object.assign(manager,original);});
 async function call(action,values = {}) {
  let response;
  await admin.handle_debug_random_results(app,{respond:(_message,error,result) => {response = {error,result};}},
   {type:'debug_random_results',tournament_key:'cup',action,...values});
  return response;
 }
 it('validates inclusive match and calendar cutoffs without timezone conversion',function() {
  for (const bad of [{mode:'number',number:0},{mode:'number',number:1.1},{mode:'number',number:'5'},
   {mode:'time',time:'2026-02-30T12:00'},{mode:'time',time:'2026-11-21T25:00'},{mode:'all'}]) assert.throws(() => random.validate(bad));
  assert(random.within(match('a',12),random.validate({mode:'number',number:12})));
  assert(!random.within(match('a',13),{mode:'number',number:12}));
  assert(random.within(match('a',12),random.validate({mode:'time',time:'2026-11-21T12:00'})));
  assert(!random.within(match('a',12),{mode:'time',time:'2026-11-20T12:00'}));
  const unscheduled = match('a',1);delete unscheduled.setup.scheduled_date;
  assert(!random.within(unscheduled,{mode:'time',time:'2026-11-21T23:59'}));
 });
 for (const [numSets,end,max,lastEnd,lastMax] of [[3,21,30,21,30],[1,21,30,15,21],[5,11,15,7,9],[3,1,1,1,1]]) {
  it('generates complete legal scores for best-of-' + numSets + ' with ' + end + '/' + lastEnd + ' points',function() {
   const format = {numSets,set_points:{end_points:end,max_points:max},last_set_points:{end_points:lastEnd,max_points:lastMax}};
   let seed = 42;const roll = bound => {seed = (1664525 * seed + 1013904223) >>> 0;return Math.floor(seed / 4294967296 * bound);};
   const winners = new Set(),lengths = new Set();
   for (let trial = 0; trial < 200; trial++) {
    const result = random.generate({scoring_format:format},{},roll);winners.add(result.team1_won);lengths.add(result.network_score.length);
    assert(scoring.is_match_over(result.network_score,format));
    assert(!scoring.is_match_over(result.network_score.slice(0,-1),format));
    let wins = 0;
    result.network_score.forEach((set,index) => {
     const points = index === numSets - 1 ? format.last_set_points : format.set_points;
     assert(scoring.is_set_over(...set,points));assert(set.every(value => value >= 0 && value <= points.max_points));
     const previous = [...set];previous[set[0] > set[1] ? 0 : 1]--;
     assert(!scoring.is_set_over(...previous,points));if (set[0] > set[1]) wins++;
    });
    assert.strictEqual(result.team1_won,wins >= Math.floor(numSets / 2) + 1);
   }
   assert.strictEqual(winners.size,2);if (numSets > 1) assert(lengths.size > 1);
  });
 }
 it('rejects unsupported formats instead of hanging or generating invalid scores',function() {
  assert.throws(() => random.generate({scoring_format:{numSets:2}},{}));
  assert.throws(() => random.generate({scoring_format:{set_points:{end_points:21,max_points:10}}},{}));
 });
 it('previews without writes and excludes existing results, running matches, pending writes, byes and other tournaments',async function() {
  const running = match('running',2);running.setup.now_on_court = true;
  const bye = match('bye',3);bye.setup.teams[1].players = [];
  const future = match('future',4);future.setup.incomplete = true;future.setup.teams[1].players = [];
  await app.db.matches.insert_async([match('open',1),running,bye,future,match('finished',5,{team1_won:false}),
   match('partial',6,{network_score:[[0,1]]}),match('pending',7,{btp_needsync:true}),match('foreign',8,{tournament_key:'other'}),match('late',9)]);
  const {result,error} = await call('preview',{limit:{mode:'number',number:8}});assert.ifError(error);
  assert.strictEqual(result.count,2);assert.strictEqual(result.skipped,5);assert.strictEqual(result.waiting,1);
  assert.deepStrictEqual(result.matches.map(item => item.number),[1,4]);assert.strictEqual(writes.length,0);assert.strictEqual(syncs,0);
 });
 it('honors the planned date and includes the exact cutoff minute',async function() {
  const later = match('later',2);later.setup.scheduled_time_str = '12:01';
  const previous = match('previous',3);previous.setup.scheduled_date = '2026-11-20';
  await app.db.matches.insert_async([match('exact',1),later,previous]);
  const {result} = await call('preview',{limit:{mode:'time',time:'2026-11-21T12:00'}});
  assert.deepStrictEqual(result.matches.map(item => item.number),[3,1]);
 });
 it('revalidates local matches and never broadens the confirmed selection',async function() {
  await app.db.matches.insert_async([match('open',1),match('now-running',2),match('new-score',3),match('changed-id',4),match('rescheduled',5)]);
  const plan = await random.preview(app,'cup',{mode:'number',number:5});
  await app.db.matches.update_async({_id:'now-running'},{$set:{'setup.now_on_court':true}});
  await app.db.matches.update_async({_id:'new-score'},{$set:{network_score:[[2,0]]}});
  await app.db.matches.update_async({_id:'changed-id'},{$set:{btp_match_ids:[{id:99}]}});
  await app.db.matches.update_async({_id:'rescheduled'},{$set:{'setup.match_num':99}});
  await app.db.matches.insert_async(match('new',4));
  assert.deepStrictEqual(await random.execute(app,'cup',plan.token),{changed:1,skipped:4});
  assert.deepStrictEqual(writes.map(item => item._id),['open']);assert.strictEqual(syncs,2);
  await assert.rejects(random.execute(app,'cup',plan.token),/Vorschau/);
 });
 it('completes newly resolved successors after integrating the previous BTP results',async function() {
  const next = match('next',2);next.setup.incomplete = true;next.setup.teams[1].players = [];
  await app.db.matches.insert_async([match('first',1),next]);
  manager.sync_random_results = async () => {
   syncs++;if (writes.length) await app.db.matches.update_async({_id:'next'},{$set:{'setup.incomplete':false,'setup.teams':match('a',1).setup.teams}});
  };
  const plan = await random.preview(app,'cup',{mode:'number',number:2});
  assert.deepStrictEqual(await random.execute(app,'cup',plan.token),{changed:2,skipped:0});
  assert.deepStrictEqual(writes.map(item => item._id),['first','next']);assert.strictEqual(syncs,3);
 });
 it('bounds BTP batches and accounts for remote games that became ineligible',async function() {
  await app.db.matches.insert_async(Array.from({length:33},(_,i) => match('m'+i,i+1)));
  const sizes = [];manager.write_random_results = async (_key,batch) => {sizes.push(batch.length);return {changed:batch.length - 1};};
  const plan = await random.preview(app,'cup',{mode:'number',number:33});
  assert.deepStrictEqual(await random.execute(app,'cup',plan.token),{changed:30,skipped:3});assert.deepStrictEqual(sizes,[16,16,1]);
 });
 it('blocks disconnected/read-only BTP both before preview and after confirmation',async function() {
  await app.db.matches.insert_async(match('open',1));
  const plan = await random.preview(app,'cup',{mode:'number',number:1});
  await app.db.tournaments.update_async({key:'cup'},{$set:{btp_readonly:true}});
  assert((await call('preview',{limit:{mode:'number',number:1}})).error);
  assert((await call('execute',{token:plan.token})).error);assert.strictEqual(writes.length,0);
 });
 it('reports a partial BTP failure and still imports the final remote state',async function() {
  await app.db.matches.insert_async(match('open',1));
  const plan = await random.preview(app,'cup',{mode:'number',number:1});
  manager.write_random_results = async () => {throw Object.assign(new Error('Synthetic BTP failure'),{confirmed:1});};
  const result = await call('execute',{token:plan.token});
  assert.match(result.error.message,/1 Ergebnisse in BTP bestätigt/);assert.match(result.error.message,/Synthetic BTP failure/);assert.strictEqual(syncs,2);
 });
 it('rejects double execution while the first request waits for BTP',async function() {
  await app.db.matches.insert_async(match('open',1));
  const plan = await random.preview(app,'cup',{mode:'number',number:1});
  let release,started;const entered = new Promise(resolve => {started = resolve;});
  manager.sync_random_results = async () => {if (!release) await new Promise(resolve => {release = resolve;started();});};
  const first = random.execute(app,'cup',plan.token);await entered;
  await assert.rejects(random.execute(app,'cup',plan.token));release();await first;
  assert.strictEqual(writes.length,1);
 });
 it('rejects unknown actions and invalid or cross-tournament tokens',async function() {
  assert((await call('unknown')).error);assert((await call('execute',{token:'missing'})).error);
  const plan = await random.preview(app,'cup',{mode:'number',number:1});
  await assert.rejects(random.execute(app,'other',plan.token),/Vorschau/);assert.strictEqual(syncs,0);
 });
 it('expires previews using real time even when the tournament clock is simulated',async function() {
  const plan = await random.preview(app,'cup',{mode:'number',number:1});
  const now = Date.now, expired = now() + 11 * 60 * 1000;
  try {Date.now = () => expired;await assert.rejects(random.execute(app,'cup',plan.token),/abgelaufen/);}
  finally {Date.now = now;}
  assert.strictEqual(syncs,0);
 });
 it('retries briefly when BTP publishes successor participants after the winner',async function() {
  const next = match('next',2);next.setup.incomplete = true;next.setup.teams[1].players = [];
  await app.db.matches.insert_async(next);
  manager.sync_random_results = async () => {
   if (++syncs === 2) await app.db.matches.update_async({_id:'next'},{$set:{'setup.incomplete':false,'setup.teams':match('a',1).setup.teams}});
  };
  const plan = await random.preview(app,'cup',{mode:'number',number:2});
  assert.deepStrictEqual(await random.execute(app,'cup',plan.token),{changed:1,skipped:0});
 });
});
