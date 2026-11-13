'use strict';
/* eslint-disable no-console -- Hidden resource status regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=window.__finishedResources={},template=structuredClone(curt.matches[0]);
  const make=(id,state)=>{const match=structuredClone(template);match._id=id;Object.assign(match.setup,{state,now_on_court:false,highlight:0});for(const k of ['court_id','location_id','umpire','service_judge','tabletoperators','preparation_call_timestamp'])delete match.setup[k];for(const k of ['team1_won','btp_winner','network_score','end_ts'])delete match[k];match.presses=[];return match};
  qa.finished=make('resource-finished','finished');Object.assign(qa.finished,{team1_won:true,btp_winner:1,network_score:[[21,15],[21,17]],end_ts:Date.now()});
  qa.next=make('resource-next','scheduled');qa.active=make('resource-active','oncourt');
  curt.courts.forEach(court=>{court.match_id=null});qa.court=curt.courts[0];qa.court.match_id=qa.active._id;Object.assign(qa.active.setup,{court_id:qa.court._id,now_on_court:true,location_id:qa.court.location_id});
  qa.active.setup.teams.forEach(team=>team.players.forEach(player=>player.btp_id+=10000));curt.matches=[qa.finished,qa.next,qa.active];ctournament.ui_show();
  qa.settle=()=>new Promise((resolve,reject)=>{const end=performance.now()+5000;let stable=0;const frame=()=>{if(performance.now()>end)return reject(new Error('Resource layout did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable>=3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.status=(match)=>crouting.on_change({ctype:'update_player_status',tournament_key:curt.key,val:{match__id:match._id,setup:structuredClone(match.setup),btp_winner:match.btp_winner}});
 })()`);
 await c.evaluate('__finishedResources.settle()');
 const result=await c.evaluate(`(async()=>{
  const qa=__finishedResources;qa.player=document.querySelector('tr[data-match_id="resource-finished"] .player');qa.name=qa.player.firstChild;qa.mutations=[];
  const observer=new MutationObserver(records=>qa.mutations.push(...records));observer.observe(qa.player,{subtree:true,childList:true,characterData:true,attributes:true});
  try {
   for(const match of [qa.finished,qa.next]){const incoming=structuredClone(match);incoming.setup.teams[0].players[0].now_playing_on_court=qa.court._id;qa.status(incoming)}await qa.settle();
   const playing=!!document.querySelector('tr[data-match_id="resource-next"] .player .court');
   const operator=qa.next.setup.teams[0].players[0];qa.active.setup.tabletoperators=[{...operator,now_tablet_on_court:qa.court._id}];
   crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:qa.active._id,match:structuredClone(qa.active)}});
   for(const match of [qa.finished,qa.next]){const incoming=structuredClone(match);delete incoming.setup.teams[0].players[0].now_playing_on_court;qa.status(incoming)}await qa.settle();
   const tablet=!!document.querySelector('tr[data-match_id="resource-next"] .player .tablet_inline');
   observer.disconnect();return{playing,tablet,finishedMutations:qa.mutations.length,nameRetained:qa.player.firstChild===qa.name,readonly:!qa.player.hasAttribute('data-check-in-action')};
  }finally{observer.disconnect()}
 })()`);
 assert(result.playing&&result.tablet,'Upcoming players must display their changed court and tablet resources');
 assert(result.finishedMutations===0&&result.nameRetained&&result.readonly,'Readonly result players must retain their unchanged DOM and name');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Resource patches must not throw');
 fs.writeFileSync(path.join(previews,'finished-resource-status-verification.json'),JSON.stringify({scope:'Native browser with one result, one upcoming game and one active tablet-operator assignment. No live services.',result},null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
};
