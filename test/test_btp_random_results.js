'use strict';

const assert = require('assert');
const {write} = require('../bts/btp_random_results');
const parse = require('../bts/btp_parse');

function fixture() {
 const placeholders = Array.from({length:4},(_,i) => ({ID:[i+1],DrawID:[1],PlanningID:[i+1],EntryID:[i+1]}));
 const game = (id,from1,from2) => ({ID:[id],DrawID:[1],PlanningID:[id],From1:[from1],From2:[from2],MatchNr:[id],
  IsMatch:[true],IsPlayable:[true],Winner:[0],ScoreStatus:[0],Sets:[{Set:[]}],Status:[15],Highlight:[2],DisplayOrder:[42],CourtID:[7]});
 const raw = {Matches:[{Match:[...placeholders,game(5,1,2),game(6,3,4),game(7,5,6)]}],
  Entries:[{Entry:placeholders.map((_,i) => ({ID:[i+1],Player1ID:[i+1]}))}],
  Players:[{Player:placeholders.map((_,i) => ({ID:[i+1],Name:['P'+i]}))}],
  Courts:[{Court:[{ID:[7],MatchID:[0]}]}]};
 const calls = [];let apply = true, reject = false, delay = 0, queued = [], reads = 0;
 const response = () => ({Action:[{Result:[1]}],Result:[{Tournament:[structuredClone(raw)]}]});
 const commit = updates => {
  for (const row of updates) {
   const node = raw.Matches[0].Match.find(node => node.ID[0] === row.Match.ID), update = row.Match;
   for (const field of ['Winner','ScoreStatus','Status','Highlight','CourtID']) if (update[field] != null) node[field] = [update[field]];
   node.DisplayOrder = [update.MatchOrder];node.Sets = [{Set:update.Sets.map(({Set}) => ({T1:[Set.T1],T2:[Set.T2]}))}];
  }
 };
 const connection = {key_unicode:'session',password:'secret',send(value,callback) {
  calls.push(value);
  if (value.Action.ID === 'SENDTOURNAMENTINFO') {
   reads++;if (queued.length && reads >= delay) {commit(queued);queued = [];}
   setImmediate(() => callback(response()));
  } else {
   if (apply && !reject) {if (delay) queued = value.Update.Tournament.Matches;else commit(value.Update.Tournament.Matches);}
   setImmediate(() => callback({Action:[{Result:[reject ? 0 : 1]}]}));
  }
  return () => {};
 }};
 const local = id => {
  const node = parse.get_btp_state(response()).matches.find(node => node.ID[0] === id);
  return {_id:'m'+id,btp_match_ids:[{id,draw:1,planning:id}],team1_won:true,network_score:[[21,10],[21,19]],score_status:'normal',
   setup:{teams:node.bts_players.map(team => ({players:(team || []).map(player => ({btp_id:player.ID[0]}))}))}};
 };
 return {raw,calls,connection,local,node:id => raw.Matches[0].Match.find(node => node.ID[0] === id),
  ignore:() => {apply = false;},reject:() => {reject = true;},delay:count => {delay = count;}};
}
describe('BTP random result writes',function() {
 it('writes scores and winners, verifies readback and preserves ordering, check-ins, highlights and court',async function() {
  const peer = fixture();
  const result = await write(peer.connection,[peer.local(5),peer.local(6)]);
  assert.deepStrictEqual(result,{changed:2});
  const request = peer.calls.find(value => value.Action.ID === 'SENDUPDATE');
  assert.strictEqual(request.Action.Password,'secret');assert.strictEqual(request.Action.Unicode,'session');
  assert.deepStrictEqual(Object.keys(request.Update.Tournament),['Matches']);
  for (const {Match:row} of request.Update.Tournament.Matches) {
   assert.strictEqual(row.Winner,1);assert.strictEqual(row.Status,15);assert.strictEqual(row.MatchOrder,42);
   assert.strictEqual(row.Highlight,2);assert.strictEqual(row.CourtID,7);assert.strictEqual(row.Duration,undefined);
   assert.deepStrictEqual(row.Sets,[{Set:{T1:21,T2:10}},{Set:{T1:21,T2:19}}]);
  }
  assert.strictEqual(peer.connection.court_assignments_revision,1);
  assert.strictEqual(peer.calls.filter(value => value.Action.ID === 'SENDTOURNAMENTINFO').length,2);
 });
 for (const kind of ['winner','partial','active','changed-player','changed-draw','missing']) {
  it('skips a game whose remote state changed after the local snapshot: '+kind,async function() {
   const peer = fixture(), match = peer.local(5), node = peer.node(5);
   if (kind === 'winner') node.Winner = [2];
   if (kind === 'partial') node.Sets = [{Set:[{T1:[0],T2:[1]}]}];
   if (kind === 'active') peer.raw.Courts[0].Court[0].MatchID = [5];
   if (kind === 'changed-player') match.setup.teams[0].players[0].btp_id = 99;
   if (kind === 'changed-draw') match.btp_match_ids[0].draw = 99;
   if (kind === 'missing') match.btp_match_ids[0].id = 99;
   assert.deepStrictEqual(await write(peer.connection,[match]),{changed:0});
   assert(!peer.calls.some(value => value.Action.ID === 'SENDUPDATE'));
  });
 }
 it('waits for delayed readback rather than trusting the transport acknowledgement',async function() {
  const peer = fixture();peer.delay(3);
  assert.deepStrictEqual(await write(peer.connection,[peer.local(5)],{verify_timeout_ms:100,verify_interval_ms:1}),{changed:1});
  assert.strictEqual(peer.calls.filter(value => value.Action.ID === 'SENDTOURNAMENTINFO').length,3);
 });
 it('rejects ignored scores and invalidates pending fetch snapshots even on failure',async function() {
  const peer = fixture();peer.ignore();
  await assert.rejects(write(peer.connection,[peer.local(5)],{verify_timeout_ms:0}),error => error.confirmed === 0 && /zurückgemeldet/.test(error.message));
  assert.strictEqual(peer.connection.court_assignments_revision,1);
 });
 it('reports a rejected BTP update as a failure',async function() {
  const peer = fixture();peer.reject();
  await assert.rejects(write(peer.connection,[peer.local(5)]),/nicht bestätigt/);
 });
 it('uses the BTP winner propagation to score the final with its actual participants',async function() {
  const peer = fixture();
  await write(peer.connection,[peer.local(5),{...peer.local(6),team1_won:false,network_score:[[10,21],[19,21]]}]);
  const final = peer.local(7);
  assert.deepStrictEqual(final.setup.teams.map(team => team.players.map(player => player.btp_id)),[[1],[4]]);
  assert.deepStrictEqual(await write(peer.connection,[final]),{changed:1});assert.strictEqual(peer.node(7).Winner[0],1);
 });
 it('refuses missing sessions and read-only connections without any request',async function() {
  const peer = fixture();peer.connection.readonly = true;
  await assert.rejects(write(peer.connection,[peer.local(5)]),/schreibend/);assert.strictEqual(peer.calls.length,0);
 });
 it('imports simulated BTP results into BTS and completes an elimination draw through the real importer',async function() {
  this.timeout(10000);
  const {promisify} = require('util'), database = require('../bts/database'), sync = require('../bts/btp_sync');
  const manager = require('../bts/btp_manager'), random = require('../bts/random_results');
  const peer = fixture(), originals = {...manager};
  const app = {db:await database.init_test(),wss:{clients:[]}};
  await promisify(app.db.tournaments.insert.bind(app.db.tournaments))({key:'cup',btp_enabled:true,last_reset_ts:1,automation_enabled:false});
  peer.raw.Players[0].Player.forEach((player,i) => {player.Firstname = ['Player'];player.Lastname = [String(i+1)];player.CheckedIn = [false];});
  peer.raw.Events = [{Event:[{ID:[20],Name:['HE'],GameTypeID:[1]}]}];
  peer.raw.Stages = [{Stage:[{ID:[30],EventID:[20],Name:['KO'],StageType:[2],DisplayOrder:[1]}]}];
  peer.raw.Draws = [{Draw:[{ID:[1],EventID:[20],StageID:[30],Name:['HE'],Position:[1]}]}];
  peer.raw.Settings = [{Setting:[{ID:[1001],Value:['Test']},{ID:[1008],Value:['URN']},{ID:[1003],Value:[false]},{ID:[1303],Value:[2]}]}];
  delete peer.raw.Courts;
  for (const id of [5,6,7]) {peer.node(id).RoundName = [id === 7 ? 'Finale' : 'HF'];delete peer.node(id).CourtID;}
  const integrate = async () => {
   const result = await sync.sync_btp_data(app,'cup',{Result:[{Tournament:[structuredClone(peer.raw)]}]},{expected_reset_ts:1});
   assert(result === true || result?.reason === 'no_sync_changes');
  };
  try {
   manager.get_status = () => ({status:'connected'});
   manager.sync_random_results = integrate;
   manager.write_random_results = (_key,matches) => write(peer.connection,matches);
   await integrate();
   const plan = await random.preview(app,'cup',{mode:'number',number:7});
   assert.strictEqual(plan.count,3);assert.strictEqual(plan.waiting,1);
   assert.deepStrictEqual(await random.execute(app,'cup',plan.token),{changed:3,skipped:0});
   const matches = await app.db.matches.find_async({tournament_key:'cup'});
   assert.strictEqual(matches.length,3);
   for (const match of matches) {
    assert.strictEqual(match.setup.state,'finished');assert.strictEqual(typeof match.team1_won,'boolean');
    assert(require('../static/js/match_scoring').is_match_over(match.network_score,match.setup.scoring_format));
   }
   const final = matches.find(match => match.setup.match_num === 7);
   const winners = matches.filter(match => match.setup.match_num !== 7).map(match => match.setup.teams[match.team1_won ? 0 : 1].players[0].btp_id);
   assert.deepStrictEqual(final.setup.teams.map(team => team.players[0].btp_id),winners);
   const rows = require('../static/js/ccsvexport').build_certificate_rows(matches,{name:'Test'},{max_place:2});
   assert.strictEqual(rows.length,2);
   const champion = final.setup.teams[final.team1_won ? 0 : 1].players[0];
   assert.strictEqual(rows.find(row => row.platz === '1. Platz').spieler_1,champion.name);
  } finally {Object.assign(manager,originals);}
 });
});
