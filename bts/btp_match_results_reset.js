'use strict';

const proto = require('./btp_proto');
const RESET_BATCH_SIZE = 16;
function request(connection,value,timeout = 15000) {
 return new Promise((resolve,reject) => {
  let cancel;
  const timer = setTimeout(() => {if (typeof cancel === 'function') cancel();reject(new Error('BTP antwortet nicht. Das Zurücksetzen wurde nicht bestätigt.'));},timeout);
  try {cancel = connection.send(value,(response,error) => {clearTimeout(timer);if (error) reject(error);else response?.Action?.[0]?.Result?.[0] === 1 ? resolve(response) : reject(new Error('BTP hat das Zurücksetzen nicht bestätigt.'));});}
  catch (error) {clearTimeout(timer);reject(error);}
 });
}
async function read(connection) {
 const response = await request(connection,proto.get_info_request(connection.password));
 const tournament = response.Result?.[0]?.Tournament?.[0];if (!tournament) throw new Error('BTP hat keine Turnierdaten geliefert.');return tournament;
}
function verification_failure(updates,verified) {
 for (const [id,previous] of updates) {
  const node = verified.get(id), sets = node?.Sets?.[0]?.Set || [];
  if (!node || Number(node.Winner?.[0]) > 0 || Number(node.ScoreStatus?.[0]) > 0 || sets.some(set => Number(set.T1?.[0]) > 0 || Number(set.T2?.[0]) > 0)) {
   const game = previous.MatchNr?.[0] ? 'Spiel #' + previous.MatchNr[0] + ' (BTP-ID ' + id + ')' : 'Spiel-ID ' + id;
   const remaining = !node ? 'Spiel fehlt in der BTP-Antwort' : [
    Number(node.Winner?.[0]) > 0 ? 'Sieger: ' + node.Winner[0] : null,
    Number(node.ScoreStatus?.[0]) > 0 ? 'Ergebnisstatus: ' + node.ScoreStatus[0] : null,
    sets.some(set => Number(set.T1?.[0]) > 0 || Number(set.T2?.[0]) > 0) ? 'Punkte: ' + sets.map(set => (set.T1?.[0] ?? 0) + ':' + (set.T2?.[0] ?? 0)).join(', ') : null,
   ].filter(Boolean).join('; ');
   return Object.assign(new Error('BTP hat Sieger oder Ergebnis für ' + game + ' nicht vollständig zurückgesetzt (' + remaining + '). ' +
    'BTP kann bereits einen Teil der Auswahl geändert haben. Bitte den BTP-Stand prüfen; BTS wurde durch diese Aktion noch nicht geändert.'),
   {code:'BTP_RESET_NOT_CONFIRMED',btp_phase:'verify'});
  }
  if ((node.DisplayOrder?.[0] ?? 0) !== (previous.DisplayOrder?.[0] ?? 0)) return Object.assign(
   new Error('BTP hat beim Zurücksetzen die Spielreihenfolge für Spiel-ID ' + id + ' verändert. Bitte den BTP-Stand prüfen.'),
   {code:'BTP_RESET_ORDER_CHANGED',btp_phase:'verify'});
 }
}
async function verify(connection,updates,timeout,interval) {
 const deadline = Date.now() + timeout;
 for (;;) {
  const after = await read(connection), verified = new Map((after.Matches?.[0]?.Match || []).map(node => [String(node.ID[0]),node]));
  const failure = verification_failure(updates,verified);
  if (!failure) return;
  if (Date.now() >= deadline) throw failure;
  await new Promise(resolve => setTimeout(resolve,interval));
 }
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
 // BTP acknowledges a reset before every row and its draw dependencies have
 // been applied. Bound that work and wait for each batch before sending more.
 const entries = [...updates];
 for (let offset = 0; offset < entries.length; offset += RESET_BATCH_SIZE) {
  const batch = new Map(entries.slice(offset,offset + RESET_BATCH_SIZE));
  await request(connection,proto.reset_match_winners_request([...batch.values()],connection.key_unicode,connection.password));
  // Recheck the entire selection at the end: later draw updates must not have
  // restored a winner or score from an earlier batch.
  await verify(connection,offset + RESET_BATCH_SIZE >= entries.length ? updates : batch,verify_timeout_ms,verify_interval_ms);
 }
}
module.exports = {reset};
