'use strict';
/* eslint-disable no-console -- Native browser history-update regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53')),now=Date.now();
  curt.matches=Array.from({length:120},(_,i)=>{
   const match=structuredClone(template);match._id='finished-cache-'+i;match.team1_won=true;match.btp_winner=1;
   Object.assign(match.setup,{state:'finished',now_on_court:false,is_match:true,match_num:1000+i,scheduled_date:'2026-11-10',scheduled_time_str:'12:00',umpire:{btp_id:99000+i,name:'Testoffizieller '+i,checked_in:false}});
   for(const key of ['court_id','location_id','preparation_call_timestamp','tabletoperators','service_judge'])delete match.setup[key];
   match.end_ts=now-i*1000;match.duration_ms=600000;match.network_score=[[21,12],[21,13]];
   match.presses=[{type:'love-all',timestamp:match.end_ts-600000}];delete match.presses_deferred;
   return match;
  });
  curt.courts.forEach(court=>{delete court.match_id;});ctournament.ui_show();
  const qa=window.__finishedCache={};
  qa.settle=()=>new Promise((resolve,reject)=>{const deadline=performance.now()+10000;let stable=0;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Finished metadata did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.connection=conn(()=>{},message=>crouting.on_change(message));
  qa.edit=(id,change)=>{const match=structuredClone(curt.matches.find(match=>match._id===id));change(match);qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'match_edit',tournament_key:curt.key,val:{match__id:id,match}})})};
 })()`);
 await c.evaluate('__finishedCache.settle()');
 const initial=await c.evaluate(`(()=>{const qa=__finishedCache;qa.hidden=[...document.querySelectorAll('.finished_container tr[data-ls-deferred]')].map(row=>row.dataset.match_id);qa.visible=[...document.querySelectorAll('.finished_container tr[data-match_id]:not([data-ls-deferred])')];for(const id of qa.hidden)qa.edit(id,match=>{match.setup.umpire.checked_in=true});return{deferred:qa.hidden.length,visible:qa.visible.length}})()`);
 assert.strictEqual(initial.deferred,70);assert.strictEqual(initial.visible,50);
 await c.evaluate('__finishedCache.settle()');
 const repeated=await c.evaluate(`(async()=>{
  const qa=__finishedCache,receipts=[];let mutations=0;
  const observers=qa.visible.map(row=>{const observer=new MutationObserver(records=>{mutations+=records.length});observer.observe(row,{subtree:true,childList:true,characterData:true,attributes:true});return observer});
  const unsubscribe=btsAdminUpdates.subscribe(receipt=>receipts.push(receipt));
  const undo=calc.undo;let histories=0;calc.undo=state=>{histories++;return undo(state)};
  try{
   for(const id of qa.hidden)qa.edit(id,match=>{match.setup.umpire.checked_in=false});
   await qa.settle();await btsAdminUpdates.whenSettled();
   return{sortJobs:receipts.flatMap(receipt=>receipt.ui_jobs).filter(job=>job.name==='finished.sort').length,histories,mutations,
    applied:qa.hidden.every(id=>curt.matches.find(match=>match._id===id).setup.umpire.checked_in===false),
    retained:qa.visible.every(row=>row===document.querySelector('tr[data-match_id="'+row.dataset.match_id+'"]'))};
  }finally{calc.undo=undo;unsubscribe();observers.forEach(observer=>observer.disconnect())}
 })()`);
 assert.strictEqual(repeated.sortJobs,0,'Hidden official attendance changes must not sort the whole history');
 assert.strictEqual(repeated.histories,0,'Identical histories must not replay undo/redo during metadata changes');
 assert.strictEqual(repeated.mutations,0,'The 50 visible results must remain untouched');
 assert(repeated.applied&&repeated.retained,'All actual data changes must apply while visible row objects remain intact');
 await c.evaluate('__finishedCache.edit(__finishedCache.hidden.at(-1),match=>{match.end_ts=Date.now()+1000});__finishedCache.settle()');
 const changed=await c.evaluate(`(()=>{const qa=__finishedCache,row=document.querySelector('.finished_container tr[data-match_id="'+qa.hidden.at(-1)+'"]'),rows=[...document.querySelectorAll('.finished_container tr[data-match_id]')].filter(row=>!row.classList.contains('ls-history-overflow')&&!row.classList.contains('ls-date-collapsed')&&!row.hidden);return{first:rows[0]?.dataset.match_id,expected:qa.hidden.at(-1),materialized:!row.hasAttribute('data-ls-deferred'),score:row.querySelector('.match_score')?.textContent}})()`);
 assert.strictEqual(changed.first,changed.expected,'A genuinely changed finish time must move the game to the top');
 assert(changed.materialized&&changed.score.includes('21'),'A newly visible result must render its current score');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'History caching must not throw');
 fs.writeFileSync(path.join(previews,'finished-metadata-cache-verification.json'),JSON.stringify({scope:'Native browser: 120 finished games, 50 visible. Full snapshots update 70 hidden officials; a later changed finish time must reorder and materialize its game.',initial,repeated,changed},null,2)+'\n');
 console.log(JSON.stringify({initial,repeated,changed},null,2));
};
