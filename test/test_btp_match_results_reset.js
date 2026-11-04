'use strict';

const assert = require('assert');
const {reset} = require('../bts/btp_match_results_reset');
function peer(options = {}) {
 const node = {ID:[1],DrawID:[10],PlanningID:[20],Winner:[2],ScoreStatus:[0],Status:[15],Highlight:[0],DisplayOrder:[42],CourtID:[7],
  Sets:[{Set:[{T1:[12],T2:[21]}]}],PlannedTime:['Keep']};
 const requests = [], matches = [{_id:'match',btp_match_ids:[{id:1}]}];
 const connection = {key_unicode:'session',password:'secret',send(value,callback) {
  requests.push(value);const response = {Action:[{Result:[options.reject ? 0 : 1]}]};
  if (value.Action.ID === 'SENDTOURNAMENTINFO') response.Result = [{Tournament:[{Matches:[{Match:[structuredClone(node)]}],Courts:[{Court:options.active ? [{MatchID:[1]}] : []}]}]}];
  else if (!options.ignore) {node.Winner=[0];node.ScoreStatus=[0];if (!options.keepScore) delete node.Sets;if (options.reorder) node.DisplayOrder=[0];}
  setImmediate(() => callback(options.offline ? null : response));
 }};
 return {connection,node,requests,matches};
}
describe('Resetting BTP match winners to unknown', function() {
 it('sets only the selected source winner to unknown and preserves order, court, check-in and draw IDs', async function() {
  const {connection,node,requests,matches} = peer();await reset(connection,matches,{verify_timeout_ms:0});
  assert.deepStrictEqual(requests.map(request => request.Action.ID),['SENDTOURNAMENTINFO','SENDUPDATE','SENDTOURNAMENTINFO']);
  assert.deepStrictEqual(requests[1].Update.Tournament.Matches[0].Match,{ID:1,DrawID:10,PlanningID:20,Winner:0,ScoreStatus:0,Status:15,Highlight:0,MatchOrder:42,CourtID:7});
  assert.strictEqual(node.PlannedTime[0],'Keep');assert.strictEqual(node.Winner[0],0);
 });
 for (const [option,pattern] of [['ignore',/nicht vollständig/],['keepScore',/nicht vollständig/],['reorder',/Spielreihenfolge/],['reject',/nicht bestätigt/],['offline',/nicht bestätigt/]]) {
  it('does not claim success when BTP reports '+option,async function() {
   const {connection,matches} = peer({[option]:true});await assert.rejects(reset(connection,matches,{verify_timeout_ms:0}),pattern);
  });
 }
 it('does not send a write if any selected game is missing or already active in BTP', async function() {
  for (const options of [{active:true},{}]) {
   const {connection,matches,requests} = peer(options);if (!options.active) matches.push({_id:'missing',btp_match_ids:[{id:999}]});
   await assert.rejects(reset(connection,matches,{verify_timeout_ms:0}));assert(!requests.some(request => request.Action.ID==='SENDUPDATE'));
  }
 });
 it('requires an active writable session and does not guess BTP IDs for local matches', async function() {
  for (const connection of [null,{terminated:true},{key_unicode:'session',readonly:true}]) await assert.rejects(reset(connection,[]));
  const {connection} = peer();await assert.rejects(reset(connection,[{_id:'local'}]),/nicht in BTP gefunden/);
 });
});
