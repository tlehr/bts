'use strict';
/* eslint-disable no-console -- Native point ordering and rendering regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=window.__historyQueue={receipts:[],handled:[]},active=curt.matches.find(match=>match._id==='match-44'),template=structuredClone(curt.matches.find(match=>match._id==='match-53'));
  qa.active=active;qa.history=Array.from({length:60},(_,index)=>{const match=structuredClone(template);match._id='queue-history-'+index;match.team1_won=true;match.btp_winner=1;match.end_ts=Date.now()-index*1000;match.network_score=[[21,12],[21,13]];match.presses=[];Object.assign(match.setup,{state:'finished',now_on_court:false,court_id:active.setup.court_id,match_num:1000+index});return match;});
  curt.matches=[active,...qa.history];curt.courts.forEach(court=>{court.match_id=court._id===active.setup.court_id?active._id:null});ctournament.ui_show();
  qa.settle=()=>new Promise((resolve,reject)=>{const deadline=performance.now()+10000;let stable=0;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Historical court queue did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.connection=conn(()=>{},message=>{qa.handled.push(message.ctype);return crouting.on_change(message)});
  qa.receive=message=>qa.connection._test_handle_message({data:JSON.stringify(message)});
 })()`);
 await c.evaluate('__historyQueue.settle()');
 await c.evaluate(`(()=>{
  const qa=__historyQueue;qa.row=document.querySelector('.courts_container tr[data-match_id="'+qa.active._id+'"]');qa.players=[...qa.row.querySelectorAll('.player')];
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>qa.receipts.push(receipt));qa.expected=new Map();
  for(const match of qa.history){const setup=structuredClone(match.setup);setup.teams[0].players[0].checked_in=!setup.teams[0].players[0].checked_in;qa.expected.set(match._id,setup.teams[0].players[0].checked_in);qa.receive({type:'change',ctype:'update_player_status',tournament_key:curt.key,val:{match__id:match._id,setup,btp_winner:1}})}
  qa.receive({type:'change',ctype:'score',tournament_key:curt.key,val:{match_id:qa.active._id,court_id:qa.active.setup.court_id,now_on_court:true,network_score:[[8,9]],presses:qa.active.presses||[],needs_preparation_successor:qa.active.setup.needs_preparation_successor,needs_preparation_successor_ts:qa.active.setup.needs_preparation_successor_ts}});
 })()`);
 await c.evaluate('__historyQueue.settle();btsAdminUpdates.whenSettled()');
 const result=await c.evaluate('(()=>{const qa=__historyQueue;qa.unsubscribe();return{first:qa.handled[0],changes:qa.handled.length,score:qa.row.querySelector(\'.match_score\')?.textContent,retained:qa.row.isConnected&&qa.players.every(player=>qa.row.contains(player)),receipts:qa.receipts.length,presented:qa.receipts.every(receipt=>receipt.status===\'presented\'),point:qa.receipts.find(receipt=>receipt.message.ctype===\'score\')?.timings,updated:qa.history.every(match=>curt.matches.find(current=>current._id===match._id).setup.teams[0].players[0].checked_in===qa.expected.get(match._id))}})()');
 assert.strictEqual(result.first,'score','A point must pass unrelated historical court assignments');assert.strictEqual(result.changes,61);assert.strictEqual(result.receipts,61);assert(result.presented,'Every point and status update must receive its actual presentation receipt');
 assert(result.retained&&result.updated&&result.score==='8:9','Current score, row objects and all historical status data must remain correct');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Historical court batching must not throw');
 fs.writeFileSync(path.join(previews,'historical-court-queue-verification.json'),JSON.stringify({scope:'Native browser receive queue: 60 finished games retain the same historical field as one current game. A new point must render before their status backlog, while all 61 messages apply and complete their full presentation receipts.',result},null,2)+'\n');console.log(JSON.stringify(result,null,2));
};
