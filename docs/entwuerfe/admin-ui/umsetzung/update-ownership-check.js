'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=window.__ownership={receipts:[],blocked:[],serial:0};
  qa.settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__ownership)qa.receipts.push(receipt);});
  qa.send=window.send;window.send=(message,callback)=>message.type==='preparation_selection_get'?qa.blocked.push(callback):qa.send(message,callback);
  qa.connection=conn(()=>{},message=>{
   if(message.ctype==='qa_diagnosis')ctournament.request_location_preparation_selections();
   else if(message.ctype==='qa_layout')cleitstand.refreshUnassigned(document.querySelector('.unassigned_container'));
   else if(message.ctype==='qa_clock') {qa.clock=document.createElement('span');qa.clock.className='timer';document.querySelector('[data-board-card="automation"]').append(qa.clock);cleitstand.timerDisplay(qa.clock,'-22222:22:22');}
   else crouting.on_change(message);
   qa.dispatchResolve?.();
  });
  qa.receive=(ctype,val={})=>new Promise(resolve=>{const id=++qa.serial;qa.dispatchResolve=()=>resolve(id);qa.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:curt.key,ctype,val,__ownership:id})});});
  qa.point=()=>{const match=curt.matches.find(match=>match._id==='match-44');return qa.receive('score',{match_id:match._id,network_score:[[8,9]],presses:[],court_id:match.setup.court_id,now_on_court:true,needs_preparation_successor:false,needs_preparation_successor_ts:null});};
  qa.wait=id=>new Promise((resolve,reject)=>{const started=performance.now();const check=()=>{const receipt=qa.receipts.find(receipt=>receipt.message.__ownership===id);if(receipt)return resolve(receipt);if(performance.now()-started>1200)return reject(new Error('Receipt still waits for unrelated work: '+id));requestAnimationFrame(check);};check();});
  qa.release=(error=null)=>{const callback=qa.blocked.shift();if(!callback)throw new Error('No pending diagnosis');callback(error,{selections:[]});};
  qa.row=document.querySelector('tr[data-match_id="match-44"]');qa.score=qa.row.querySelector('.match_score');qa.name=qa.row.querySelector('.player').firstChild;
 })()`);
 const checks=[],check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('OK '+name);};
 try {
  await c.evaluate('ctournament.request_location_preparation_selections()');
  const point=await c.evaluate('(async()=>__ownership.wait(await __ownership.point()))()');
  check('A point receives its presentation receipt while an older unrelated diagnosis is still blocked',point.status==='presented'&&await c.evaluate('__ownership.blocked.length===1'));
  check('An unrelated diagnosis is absent from the point dependency list',!point.ui_jobs.some(job=>job.name==='preparation.diagnosis'));
  check('The point is visible in its existing score and name objects',await c.evaluate('__ownership.row.querySelector(".match_score")===__ownership.score&&__ownership.name.isConnected&&__ownership.score.textContent.includes("8:9")'));
  check('A point with unrelated work pending meets the small-update budget',point.timings.handler_ms<16&&point.timings.total_ms<200);
  await c.evaluate('__ownership.release();__ownership.settle()');
  const first=await c.evaluate('__ownership.receive("qa_diagnosis")');
  const second=await c.evaluate('__ownership.receive("qa_diagnosis")');
  check('Both updates wait for their own required diagnosis',await c.evaluate(`!__ownership.receipts.some(receipt=>[${first},${second}].includes(receipt.message.__ownership))`));
  await c.evaluate('__ownership.release()');
  const firstReceipt=await c.evaluate(`__ownership.wait(${first})`);
  check('The first diagnosis is acknowledged while the newer requested diagnosis remains blocked',firstReceipt.status==='presented'&&await c.evaluate(`__ownership.blocked.length===1&&!__ownership.receipts.some(receipt=>receipt.message.__ownership===${second})`));
  check('The receipt names and times the requested diagnosis',firstReceipt.ui_jobs.some(job=>job.name==='preparation.diagnosis'&&job.elapsed_ms>=0&&job.status==='complete'));
  await c.evaluate('__ownership.release()');
  const secondReceipt=await c.evaluate(`__ownership.wait(${second})`);
  check('The queued diagnosis completes its own receipt after its DOM work',secondReceipt.status==='presented'&&secondReceipt.ui_jobs.some(job=>job.name==='preparation.diagnosis'));
  const shared=await c.evaluate(`(async()=>{
   const qa=__ownership,start=qa.serial;
   for(let n=0;n<2;n++)qa.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:curt.key,ctype:'qa_layout',val:{},__ownership:++qa.serial})});
   return Promise.all([qa.wait(start+1),qa.wait(start+2)]);
  })()`);
  check('Both updates claim an already scheduled shared layout instead of skipping it',shared.every(receipt=>receipt.status==='presented'&&receipt.ui_jobs.some(job=>job.name==='names.layout'&&job.status==='complete')));
  check('Deferred UI wait is reported separately from synchronous handling',shared.every(receipt=>Number.isFinite(receipt.timings.ui_wait_ms)&&receipt.timings.ui_wait_ms>=0));
  await c.evaluate(`(async()=>{
   const qa=__ownership;qa.nativeResizeObserver=window.ResizeObserver;qa.resizeCallbacks=[];qa.holdClock=false;
   window.ResizeObserver=class extends qa.nativeResizeObserver {constructor(callback){super((entries,observer)=>{if(qa.holdClock&&entries.some(entry=>entry.target.classList.contains('timer-value')))qa.resizeCallbacks.push(()=>callback(entries,observer));else callback(entries,observer)})}};
   ctournament.ui_show();await new Promise((resolve,reject)=>{const start=performance.now();const frame=()=>{while(qa.blocked.length)qa.release();if(performance.now()-start>4000)return reject(new Error('Remounted clocks did not settle'));cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(frame):requestAnimationFrame(()=>requestAnimationFrame(resolve))};frame()});qa.holdClock=true;
  })()`);
  const clockId=await c.evaluate('__ownership.receive("qa_clock")');
  await c.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  check('A new clock is not acknowledged while its first resize observation is withheld',await c.evaluate(`__ownership.resizeCallbacks.length>0&&!__ownership.receipts.some(receipt=>receipt.message.__ownership===${clockId})`));
  await c.evaluate('__ownership.holdClock=false;__ownership.resizeCallbacks.splice(0).forEach(release=>release())');
  const clock=await c.evaluate(`__ownership.wait(${clockId})`);
  check('The clock receipt includes observation and completed fitting before its presentation frames',clock.status==='presented'&&clock.ui_jobs.some(job=>job.name==='timers.fit'&&job.status==='complete')&&await c.evaluate(`parseFloat(__ownership.clock.querySelector('.timer-value').style.getPropertyValue('--timer-scale'))<1`));
  await c.evaluate('btsAdminUpdates.whenSettled()');
  check('All measured work drains without capacity failures or timeouts',await c.evaluate('__ownership.receipts.every(receipt=>receipt.status==="presented")&&btsAdminUpdates.stats().pending===0'));
  const receipts=await c.evaluate('__ownership.receipts.map(({message,status,timings,ui_jobs})=>({type:message.ctype,status,timings,ui_jobs}))');
  const report={date:'2026-10-30',scope:'Isolierter Browser, native Empfangswarteschlange, echte UI-Aufgaben und gezielt zurückgehaltene Vorbereitungsdiagnosen. Keine Live-Dienste.',checks,receipts};
  fs.writeFileSync(path.join(previews,'update-ownership-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,receipts},null,2));
 } finally {
  await c.evaluate('window.send=__ownership.send;__ownership.holdClock=false;__ownership.resizeCallbacks?.splice(0).forEach(release=>release());if(__ownership.nativeResizeObserver)window.ResizeObserver=__ownership.nativeResizeObserver;__ownership.clock?.remove();while(__ownership.blocked.length)__ownership.release();__ownership.unsubscribe()');
 }
};
