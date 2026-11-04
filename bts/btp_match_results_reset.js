'use strict';

const proto = require('./btp_proto');
function request(connection,value,timeout = 15000) {
 return new Promise((resolve,reject) => {
  let cancel;
  const timer = setTimeout(() => {if (typeof cancel === 'function') cancel();reject(new Error('BTP antwortet nicht. Das Zurücksetzen wurde nicht bestätigt.'));},timeout);
  try {cancel = connection.send(value,response => {clearTimeout(timer);response?.Action?.[0]?.Result?.[0] === 1 ? resolve(response) : reject(new Error('BTP hat das Zurücksetzen nicht bestätigt.'));});}
  catch (error) {clearTimeout(timer);reject(error);}
 });
}
async function read(connection) {
 const response = await request(connection,proto.get_info_request(connection.password));
 const tournament = response.Result?.[0]?.Tournament?.[0];if (!tournament) throw new Error('BTP hat keine Turnierdaten geliefert.');return tournament;
}
async function reset(connection,matches,{verify_timeout_ms = 5000,verify_interval_ms = 100} = {}) {
 if (!connection || connection.terminated || !connection.key_unicode || connection.readonly) throw new Error('BTP muss schreibend verbunden sein.');
 if (!matches.length) return;
 const before = await read(connection), nodes = new Map((before.Matches?.[0]?.Match || []).map(node => [String(node.ID[0]),node]));
 const active = new Set((before.Courts?.[0]?.Court || []).map(court => String(court.MatchID?.[0])));
 const updates = new Map();
 for (const match of matches) {
  if (!match.btp_match_ids?.length) throw new Error('Das ausgewählte Spiel wurde nicht in BTP gefunden. Bitte zuerst abgleichen.');
  for (const id of match.btp_match_ids) {
   const node = nodes.get(String(id.id));if (!node) throw new Error('Ein ausgewähltes Spiel fehlt in BTP. Bitte zuerst abgleichen.');
   if (active.has(String(id.id))) throw new Error('Ein ausgewähltes Spiel läuft inzwischen in BTP. Es wurde nichts zurückgesetzt.');
   updates.set(String(id.id),node);
  }
 }
 // Reset the winner of the selected source game. Let BTP resolve its own
 // draw dependencies; do not guess or overwrite participants in later games.
 const value = proto.reset_match_winners_request([...updates.values()],connection.key_unicode,connection.password);
 await request(connection,value);
 const deadline = Date.now() + verify_timeout_ms;
 for (;;) {
  const after = await read(connection), verified = new Map((after.Matches?.[0]?.Match || []).map(node => [String(node.ID[0]),node]));
  let failure;
  for (const [id,previous] of updates) {
   const node = verified.get(id), sets = node?.Sets?.[0]?.Set || [];
   if (!node || Number(node.Winner?.[0]) > 0 || Number(node.ScoreStatus?.[0]) > 0 || sets.some(set => Number(set.T1?.[0]) > 0 || Number(set.T2?.[0]) > 0)) {
    failure = 'BTP hat Sieger oder Ergebnis für Spiel-ID ' + id + ' nicht vollständig zurückgesetzt. Bitte den BTP-Stand prüfen; BTS wurde noch nicht geändert.';break;
   }
   if ((node.DisplayOrder?.[0] ?? 0) !== (previous.DisplayOrder?.[0] ?? 0)) {failure = 'BTP hat beim Zurücksetzen die Spielreihenfolge verändert. Bitte den BTP-Stand prüfen.';break;}
  }
  if (!failure) return;
  if (Date.now() >= deadline) throw new Error(failure);
  await new Promise(resolve => setTimeout(resolve,verify_interval_ms));
 }
}
module.exports = {reset};
