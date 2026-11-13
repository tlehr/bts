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
  else if (!options.ignore) {node.Winner=[0];node.ScoreStatus=[0];if (!options.keepScore && value.Update.Tournament.Matches[0].Match.Sets?.length === 0) delete node.Sets;if (options.reorder) node.DisplayOrder=[0];}
  setImmediate(() => callback(options.offline ? null : response));
 }};
 return {connection,node,requests,matches};
}
function delayed_peer({count = 33,fail_id,restore_id,active_id,rows_per_read = Infinity} = {}) {
 const nodes = Array.from({length:count},(_,index) => ({ID:[index + 1],MatchNr:[index + 101],DrawID:[10],PlanningID:[index + 20],
  Winner:[1],ScoreStatus:[0],DisplayOrder:[index],Sets:[{Set:[{T1:[21],T2:[12]}]}]}));
 const requests = [], matches = nodes.map(node => ({_id:'m' + node.ID[0],btp_match_ids:[{id:node.ID[0]}]}));
 let pending,reads = 0;
 const connection = {key_unicode:'session',send(value,callback) {
  requests.push(value);const response = {Action:[{Result:[1]}]};
  if (value.Action.ID === 'SENDTOURNAMENTINFO') {
   if (pending && ++reads >= 2) {
    const applied = pending.rows.slice(pending.offset,pending.offset + rows_per_read);
    for (const row of applied) {
     const node = nodes.find(node => node.ID[0] === row.Match.ID);
     if (node.ID[0] !== fail_id) {delete node.Winner;delete node.Sets;}
    }
    pending.offset += applied.length;
    if (pending.offset === pending.rows.length) {
     if (restore_id && pending.rows.some(row => row.Match.ID === count)) nodes[restore_id - 1].Winner = [2];
     pending = null;
    }
   }
   response.Result = [{Tournament:[{Matches:[{Match:structuredClone(nodes)}],Courts:[{Court:active_id ? [{MatchID:[active_id]}] : []}]}]}];
  } else {
   assert(!pending,'Do not submit more work while the previous batch is still being applied');
   pending = {rows:value.Update.Tournament.Matches,offset:0};reads = 0;
  }
  setImmediate(() => callback(response));
 }};
 return {connection,nodes,requests,matches};
}
describe('Resetting BTP match winners to unknown', function() {
 it('sets only the selected source winner to unknown and preserves order, court, check-in and draw IDs', async function() {
  const {connection,node,requests,matches} = peer();await reset(connection,matches,{verify_timeout_ms:0});
  assert.deepStrictEqual(requests.map(request => request.Action.ID),['SENDTOURNAMENTINFO','SENDUPDATE','SENDTOURNAMENTINFO']);
  assert.deepStrictEqual(requests[1].Update.Tournament.Matches[0].Match,{ID:1,DrawID:10,PlanningID:20,Winner:0,ScoreStatus:0,Sets:[],Status:15,Highlight:0,MatchOrder:42,CourtID:7});
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
 it('splits a large selection and waits for delayed readback before submitting the next batch', async function() {
  const {connection,nodes,requests,matches} = delayed_peer({count:65,rows_per_read:8});
  // Slow BTP applies only part of a write on each read. One giant request
  // exceeds the verification deadline; bounded requests finish in time.
  const now = Date.now;let time = 0;Date.now = () => {const current = time;time += 10;return current;};
  try {await reset(connection,matches,{verify_timeout_ms:30,verify_interval_ms:0});}
  finally {Date.now = now;}
  const writes = requests.filter(request => request.Action.ID === 'SENDUPDATE');
  assert(writes.every(request => request.Update.Tournament.Matches.length <= 16));
  assert.deepStrictEqual(writes.flatMap(request => request.Update.Tournament.Matches.map(row => row.Match.ID)),nodes.map(node => node.ID[0]));
  assert(requests.filter(request => request.Action.ID === 'SENDTOURNAMENTINFO').length > writes.length * 2);
  assert(nodes.every(node => !node.Winner && !node.Sets));
 });
 it('validates the entire selection before submitting even the first batch', async function() {
  const {connection,requests,matches} = delayed_peer({active_id:33});
  await assert.rejects(reset(connection,matches),/läuft inzwischen/);
  assert(!requests.some(request => request.Action.ID === 'SENDUPDATE'));
 });
 it('stops after an unconfirmed batch and explains that BTP may already have changed earlier games', async function() {
  const {connection,requests,matches} = delayed_peer({count:49,fail_id:17});
  // Allow each stale read, then expire when the second read confirms the
  // failed batch. A fake clock keeps this timeout regression deterministic.
  const now = Date.now;let time = 0;Date.now = () => time++;
  try {
   await assert.rejects(reset(connection,matches,{verify_timeout_ms:2,verify_interval_ms:0}),error => {
    assert.strictEqual(error.code,'BTP_RESET_NOT_CONFIRMED');
    assert(error.message.includes('Spiel #117 (BTP-ID 17)'));
    assert(error.message.includes('Sieger: 1; Punkte: 21:12'));
    assert(error.message.includes('bereits einen Teil der Auswahl'));
    return true;
   });
  } finally {Date.now = now;}
  assert.strictEqual(requests.filter(request => request.Action.ID === 'SENDUPDATE').length,2);
 });
 it('checks earlier games again after the final batch instead of reporting partial success', async function() {
  const {connection,matches} = delayed_peer({restore_id:1});
  const now = Date.now;let time = 0;Date.now = () => time++;
  try {
   await assert.rejects(reset(connection,matches,{verify_timeout_ms:2,verify_interval_ms:0}),/Spiel #101 \(BTP-ID 1\).*Sieger: 2/);
  } finally {Date.now = now;}
 });
 it('retains the actual transport error instead of replacing it with a generic rejection', async function() {
  const error = Object.assign(new Error('Connection reset by peer'),{code:'ECONNRESET'});
  const connection = {key_unicode:'session',send(_value,callback) {setImmediate(() => callback(null,error));}};
  await assert.rejects(reset(connection,[{btp_match_ids:[{id:1}]}]),failure => failure === error);
 });
});
