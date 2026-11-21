'use strict';

const proto = require('./btp_proto');
const participants = require('./btp_participant_guard');

function request(connection,value,timeout = 15000) {
 return new Promise((resolve,reject) => {
  let cancel;
  const timer = setTimeout(() => {if (typeof cancel === 'function') cancel();reject(new Error('BTP antwortet nicht auf den Zufallslauf.'));},timeout);
  try {cancel = connection.send(value,(response,error) => {
   clearTimeout(timer);
   if (error) reject(error);
   else if (response?.Action?.[0]?.Result?.[0] === 1) resolve(response);
   else reject(new Error('BTP hat die Ergebnisübertragung nicht bestätigt.'));
  });} catch (error) {clearTimeout(timer);reject(error);}
 });
}
async function read(connection) {
 const response = await request(connection,proto.get_info_request(connection.password));
 if (!response.Result?.[0]?.Tournament?.[0]) throw new Error('BTP hat keine Turnierdaten geliefert.');
 return response;
}
function empty(node,active) {
 return node && !active.has(String(node.ID[0])) && !Number(node.Winner?.[0]) && !Number(node.ScoreStatus?.[0]) &&
  !(node.Sets?.[0]?.Set || []).some(set => Number(set.T1?.[0]) > 0 || Number(set.T2?.[0]) > 0);
}
function confirmed(match,nodes) {
 return match.btp_match_ids.every(id => {
  const node = nodes.get(String(id.id));
  const sets = (node?.Sets?.[0]?.Set || []).map(set => [Number(set.T1?.[0]) || 0,Number(set.T2?.[0]) || 0]);
  while (sets.length && sets.at(-1).every(value => value === 0)) sets.pop();
  return Number(node?.Winner?.[0]) === (match.team1_won ? 1 : 2) && !Number(node.ScoreStatus?.[0]) &&
   JSON.stringify(sets) === JSON.stringify(match.network_score);
 });
}
async function write(connection,matches,{verify_timeout_ms = 5000,verify_interval_ms = 100} = {}) {
 if (!connection || connection.terminated || connection.readonly || !connection.key_unicode) throw new Error('BTP muss schreibend verbunden sein.');
 const response = await read(connection), state = require('./btp_parse').get_btp_state(response);
 if (state.is_league) throw new Error('Zufallsergebnisse sind nur für Badminton Tournament Planner verfügbar.');
 const nodes = new Map(state.matches.map(node => [String(node.ID[0]),node]));
 const active = new Set([...state.courts.values()].flatMap(court => (court.MatchID || []).map(String)));
 const selected = matches.filter(match => match.btp_match_ids?.length && match.btp_match_ids.every(id => {
  const node = nodes.get(String(id.id));
  return empty(node,active) && String(node.DrawID?.[0]) === String(id.draw) && String(node.PlanningID?.[0]) === String(id.planning) &&
   !(node.bts_players_entry_status || []).some(status => require('../static/js/btp_entry_status').blocking_status(status)) &&
   JSON.stringify(participants.setup_ids(match.setup)) === JSON.stringify(participants.raw_ids(node));
 }));
 if (!selected.length) return {changed:0};
 const updates = selected.flatMap(match => {
  const request = proto.update_request(match,connection.key_unicode,connection.password,null,null,null,{write_match_check_in_status:false});
  return request.Update.Tournament.Matches.map(row => {
   const node = nodes.get(String(row.Match.ID));
   row.Match.Status = node.Status?.[0] ?? 0;row.Match.Highlight = node.Highlight?.[0] ?? 0;
   row.Match.MatchOrder = node.DisplayOrder?.[0] ?? 0;
   if (node.CourtID?.[0] != null) row.Match.CourtID = node.CourtID[0];
   delete row.Match.Duration;return row;
  });
 });
 const envelope = proto.update_request({btp_match_ids:[{id:0}],setup:{}},connection.key_unicode,connection.password,null,null,null,{write_match_check_in_status:false});
 envelope.Update.Tournament.Matches = updates;
 try {
  if (connection.terminated || connection.readonly || !connection.key_unicode) throw new Error('Die schreibende BTP-Verbindung wurde unterbrochen.');
  await request(connection,envelope);
  const deadline = Date.now() + verify_timeout_ms;
  for (;;) {
   const after = await read(connection);
   const verified = new Map((after.Result[0].Tournament[0].Matches?.[0]?.Match || []).map(node => [String(node.ID[0]),node]));
   const count = selected.filter(match => confirmed(match,verified)).length;
   if (updates.some(({Match:row}) => verified.has(String(row.ID)) && (verified.get(String(row.ID)).DisplayOrder?.[0] ?? 0) !== row.MatchOrder)) {
    throw Object.assign(new Error('BTP hat die Spielreihenfolge verändert. Bitte den BTP-Stand prüfen.'),{confirmed:count});
   }
   if (count === selected.length) return {changed:count};
   if (Date.now() >= deadline) throw Object.assign(new Error('BTP hat nicht alle Zufallsergebnisse zurückgemeldet.'),{confirmed:count});
   await new Promise(resolve => setTimeout(resolve,verify_interval_ms));
  }
 } finally {
  // Invalidate snapshots received before the writes, including an automatic
  // fetch already waiting for the tournament lock held by our caller.
  connection.court_assignments_revision = (connection.court_assignments_revision || 0) + 1;
  connection.last_applied_fetch_response_hash = null;
 }
}
module.exports = {write};
