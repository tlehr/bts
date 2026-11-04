'use strict';

const queue = require('./update_queue');
const result_fields = ['team1_won','btp_winner','network_score','score_status_network_score','no_match_losing_team',
 'end_ts','duration_ms','tabletoperator_finish_ts','setup.end_ts','setup.called_timestamp','setup.preparation_call_timestamp'];
function eligible(match) {
 return match.setup && !match.setup.now_on_court && match.setup.state !== 'oncourt' &&
  match.setup.teams?.length === 2 && match.setup.teams.every(team => team.players?.length > 0);
}
function has_result(match) {
 return typeof match.team1_won === 'boolean' || Number(match.btp_winner) > 0 || match.setup?.state === 'finished' ||
  match.end_ts != null || match.presses?.length > 0 || match.network_score?.some(set => set.some(value => Number(value) > 0)) ||
  match.score_status && match.score_status !== 'normal';
}
async function reset(app,key,{target = 'bts',match_ids} = {},notify = () => {}) {
 if (!['bts','both'].includes(target)) throw new Error('Ungültiges Ziel für das Zurücksetzen.');
 if (match_ids !== undefined && (!Array.isArray(match_ids) || !match_ids.length || match_ids.some(id => typeof id !== 'string' || !id) || new Set(match_ids).size !== match_ids.length)) {
  throw new Error('Ungültige Spielauswahl.');
 }
 return queue.execute_locked([queue.lock_keys.tournament(key)],queue.named('match_results_reset_' + key,async () => {
  const tournament = await app.db.tournaments.findOne_async({key});if (!tournament) throw new Error('Turnier nicht gefunden.');
  if (target === 'both' && (!tournament.btp_enabled || tournament.btp_readonly)) throw new Error('BTP muss schreibend verbunden sein.');
  const matches = await app.db.matches.find_async({tournament_key:key});
  const selected = match_ids ? match_ids.map(id => matches.find(match => match._id === id)) : matches.filter(match => eligible(match) && has_result(match));
  if (selected.some(match => !match || !eligible(match))) throw new Error('Die Auswahl enthält ein unbekanntes oder laufendes Spiel beziehungsweise ein Freilos. Bitte die Auswahl aktualisieren.');
  if (target === 'both') await require('./btp_manager').reset_match_results(key,selected);
  let changed_matches = 0;
  for (const previous of selected) {
   if (!has_result(previous)) continue;
   const unset = Object.fromEntries(result_fields.map(name => [name,true]));
   const [,match] = await app.db.matches.update_async({_id:previous._id,tournament_key:key},{
    $set:{presses:[],score_status:'normal',btp_score_status:0,forward_loser:false,btp_needsync:false,
     'setup.state':'scheduled','setup.now_on_court':false,'setup.highlight':0,'setup.preparation_call_deferred':true},$unset:unset,
   },{returnUpdatedDocs:true});
   changed_matches++;notify('match_edit',{match__id:match._id,match});
  }
  if (changed_matches) {
   const courts = await app.db.courts.find_async({tournament_key:key,match_id:{$in:selected.map(match => match._id)}});
   await app.db.courts.update_async({tournament_key:key,match_id:{$in:selected.map(match => match._id)}},{$set:{match_id:null}},{multi:true});
   for (const court of courts) notify('court_changed',{...court,court_id:court._id,match_id:null});
  }
  return {changed_matches,target};
 }));
}
module.exports = {reset,eligible,has_result};
