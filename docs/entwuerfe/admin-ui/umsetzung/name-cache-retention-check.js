'use strict';
/* eslint-disable no-console, quotes -- Native browser checks embed JavaScript scripts. */
const fs=require('fs'),assert=require('assert');
module.exports=async({c,open,previews})=>require('./call-status-benchmark')({c,open,afterSetup:async()=>{
 const result=await c.evaluate(`(async()=>{
  for(const match of curt.matches){delete match.btp_winner;}
  for(const match of curt.matches)for(const team of match.setup.teams)for(const player of team.players)Object.assign(player,{firstname:'Paula',lastname:'Metric-'+player.btp_id,name:'Paula Metric-'+player.btp_id,check_in_per_match:true,checked_in:true});
  ctournament.ui_show();await __statusBench.settle();
  const match=curt.matches.at(-1),row=document.querySelector('tr[data-match_id="'+match._id+'"]'),player=match.setup.teams[0].players[0],node=row.querySelector('.player[data-btp_id="'+player.btp_id+'"]'),name=node.firstChild;
  row.scrollIntoView({block:'center'});await new Promise(resolve=>setTimeout(resolve,100));await __statusBench.settle();
  const prototypes=[...new Set([CanvasRenderingContext2D.prototype,globalThis.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean))],originals=prototypes.map(prototype=>[prototype,prototype.measureText]);let calls=0;
  for(const [prototype,native]of originals)prototype.measureText=function(...args){calls++;return native.apply(this,args)};
  const before=row.querySelector('.team-one').className;
  try {
   player.now_playing_on_court='C0';cmatch.update_player_status_indicators_for_match_players(match,{immediate:true});await btsAdminUpdates.whenSettled();await __statusBench.settle();
   const recentCalls=calls,early=curt.matches[30],earlyPlayer=early.setup.teams[0].players[0];earlyPlayer.now_playing_on_court='C1';cmatch.update_player_status_indicators_for_match_players(early,{immediate:true});await btsAdminUpdates.whenSettled();await __statusBench.settle();
   document.querySelector('tr[data-match_id="'+early._id+'"]').scrollIntoView({block:'center'});await new Promise(resolve=>setTimeout(resolve,100));await __statusBench.settle();
   const earlyNode=document.querySelector('tr[data-match_id="'+early._id+'"] .player[data-btp_id="'+earlyPlayer.btp_id+'"]');
   return {canvas_calls:recentCalls,evicted_canvas_calls:calls-recentCalls,evicted_resource_correct:earlyNode.querySelector('.ls-resource-court')?.textContent==='C1',before,after:row.querySelector('.team-one').className,nameRetained:node.firstChild===name,badge:node.querySelector('.ls-resource-court')?.textContent,status:node.className,resourceCorrect:node.querySelector('.ls-resource-court')?.textContent==='C0',errors:__statusErrors};
  } finally {for(const [prototype,native]of originals)prototype.measureText=native;}
 })()`);
 fs.writeFileSync(previews+'/name-cache-retention-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert(result.nameRetained&&result.resourceCorrect&&!result.errors.length,'The actual name and new court badge stay correct');
 assert(result.evicted_canvas_calls>0&&result.evicted_resource_correct,'Evicted names are actually measured again and retain the new field indicator');
 assert.strictEqual(result.canvas_calls,0,'Recent known names must remain cached after a large-board fitting');
}});
