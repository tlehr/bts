/* global tabletoperator_waiting, btp_entry_status, btsMatchEditRules */
'use strict';

// Eligibility and presentation order for the manual court-assignment dropdown.
var btsCourtAssignment = ((identity, entryStatus, rules) => {
 const definitions=[['ready','In Vorbereitung · alle eingecheckt'],['preparing','Weitere Spiele in Vorbereitung'],['other','Weitere Spiele']];
 function knownTeams(setup) {
  const count=typeof setup?.is_doubles==='boolean'?(setup.is_doubles?2:1):null;
  return !setup?.incomplete&&setup?.teams?.length===2&&setup.teams.every(team=>
   Array.isArray(team?.players)&&team.players.length>0&&(count==null||team.players.length===count)&&
   team.players.every(player=>identity.id(player)!=null||!!String(player?.name||[player?.firstname,player?.lastname].filter(Boolean).join(' ')).trim()));
 }
 function everyoneCheckedIn(setup) {
  return [...setup.teams.flatMap(team=>team.players),...(setup.tabletoperators||[]),setup.umpire,setup.service_judge]
   .filter(Boolean).every(person=>person.checked_in===true);
 }
 function preparationTime(match) {
  const value=Number(match.setup.preparation_call_timestamp);
  return Number.isFinite(value)&&value>0?value:Infinity;
 }
 function groups(tournament,compare) {
  const activity=identity.activity_index(tournament.matches),waiting=identity.index(tournament.tabletoperators);
  const result=definitions.map(([key,label])=>({key,label,matches:[]}));
  for(const match of tournament.matches||[]) {
   const setup=match?.setup;
   if(!setup?.is_match||rules.finished(match)||['done','completed'].includes(setup.state)||setup.now_on_court||
    !knownTeams(setup)||entryStatus.blocked_players(match).length||
    setup.teams.flatMap(team=>team.players).some(player=>activity.playing.has(player)||waiting.has(player)))continue;
   // A deferred game can still be assigned manually but has no active call.
   const preparing=setup.state==='preparation'&&!setup.preparation_call_deferred;
   result[preparing?(everyoneCheckedIn(setup)?0:1):2].matches.push(match);
  }
  for(const group of result)group.matches.sort((a,b)=>
   (group.key==='other'?0:(preparationTime(a)<preparationTime(b)?-1:preparationTime(a)>preparationTime(b)?1:0))||compare(a,b));
  return result;
 }
 return {groups,knownTeams,everyoneCheckedIn};
})(typeof module!=='undefined'&&module.exports?require('./tabletoperator_waiting'):tabletoperator_waiting,
 typeof module!=='undefined'&&module.exports?require('./btp_entry_status'):btp_entry_status,
 typeof module!=='undefined'&&module.exports?require('./match_edit_rules'):btsMatchEditRules);

if(typeof module!=='undefined'&&module.exports)module.exports=btsCourtAssignment;
