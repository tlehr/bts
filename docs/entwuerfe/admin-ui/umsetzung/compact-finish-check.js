'use strict';
/* eslint-disable no-console -- Native confirmation/render regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const match=curt.matches.find(match=>match._id==='match-44'),qa=window.__compactFinish={id:match._id,receipts:[]};
  qa.settle=()=>new Promise((resolve,reject)=>{const deadline=performance.now()+10000;let stable=0;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Compact finish did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>qa.receipts.push(receipt));
  qa.connection=conn(()=>{},message=>crouting.on_change(message));qa.receive=message=>qa.connection._test_handle_message({data:JSON.stringify(message)});
  qa.receive({type:'change',ctype:'score',tournament_key:curt.key,val:{match_id:match._id,
   network_score:[[21,12],[21,13]],presses:[],team1_won:true,btp_winner:1,state:'finished',score_status:'normal',
   end_ts:Date.now(),duration_ms:600000,court_id:match.setup.court_id,now_on_court:false,
   needs_preparation_successor:false,needs_preparation_successor_ts:null}});
 })()`);
 await c.evaluate('__compactFinish.settle();btsAdminUpdates.whenSettled()');
 const first=await c.evaluate(`(()=>{const qa=__compactFinish,row=document.querySelector('.finished_container tr[data-match_id="'+qa.id+'"]');qa.row=row;qa.players=[...row.querySelectorAll('.player')];qa.texts=qa.players.map(player=>player.firstChild);qa.officials=row.querySelector('.umpire_and_tablet');return{state:row.dataset.state,confirmation:row.querySelectorAll('.match_confirm_button').length,score:row.querySelector('.match_score')?.textContent,winner:curt.matches.find(match=>match._id===qa.id).btp_winner}})()`);
 assert.strictEqual(first.state,'finished');assert.strictEqual(first.confirmation,0);assert.strictEqual(first.winner,1);
 const following=await c.evaluate(`(async()=>{const qa=__compactFinish;let mutations=0;const observer=new MutationObserver(records=>{mutations+=records.length});observer.observe(qa.row,{subtree:true,childList:true,characterData:true,attributes:true});const match=structuredClone(curt.matches.find(match=>match._id===qa.id));match.btp_needsync=true;try{qa.receive({type:'change',ctype:'court_current_match',tournament_key:curt.key,val:{match__id:qa.id,match}});await qa.settle();await btsAdminUpdates.whenSettled();return{mutations,row:document.querySelector('.finished_container tr[data-match_id="'+qa.id+'"]')===qa.row,players:qa.players.every((player,index)=>player===qa.row.querySelectorAll('.player')[index]&&player.firstChild===qa.texts[index]),officials:qa.officials===qa.row.querySelector('.umpire_and_tablet'),jobs:qa.receipts.filter(receipt=>receipt.message.ctype==='court_current_match').flatMap(receipt=>receipt.ui_jobs)}}finally{observer.disconnect();qa.unsubscribe()}})()`);
 assert(!!(await c.evaluate('__compactFinish.receipts.find(receipt=>receipt.message.ctype==="score"&&receipt.status==="presented")')),'The compact finish must complete the real receive queue and presentation receipt');
 assert(following.row&&following.players&&following.officials,'The authoritative follow-up must retain the result row, names and officials');
 assert.strictEqual(following.mutations,0,'An identical confirmed snapshot must not rebuild an intermediate result');
 assert(!following.jobs.some(job=>job.name==='names.layout'||job.name==='finished.sort'),'The same confirmed snapshot needs no second fitting or sort');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Compact confirmation must not throw');
 fs.writeFileSync(path.join(previews,'compact-finish-verification.json'),JSON.stringify({scope:'Native browser: a persisted confirmed result must render completely from its first score event. The following authoritative full snapshot must preserve the same visible result.',first,following},null,2)+'\n');
 console.log(JSON.stringify({first,following},null,2));
};
