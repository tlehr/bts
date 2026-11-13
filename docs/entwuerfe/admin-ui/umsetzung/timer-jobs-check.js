'use strict';
/* eslint-disable no-console -- Isolated fitting dependency regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  const native=window.ResizeObserver,qa=window.__timerJobs={held:[],errors:[],receipts:[],firstReadyObservation:null,uncontainedObservation:null};
  window.addEventListener('error',event=>{if(event instanceof ErrorEvent)qa.errors.push(event.message);});
  window.ResizeObserver=class extends native {constructor(callback){super((entries,observer)=>{const held=entries.filter(entry=>entry.target.closest('[data-hold-clock]'));const ready=entries.filter(entry=>!held.includes(entry));if(ready.length){callback(ready,observer);for(const entry of ready)if(entry.target.closest('[data-qa-clock="ready"]')&&!qa.firstReadyObservation)qa.firstReadyObservation={scale:parseFloat(entry.target.style.getPropertyValue('--timer-scale')),width:entry.contentRect.width};for(const entry of ready)if(entry.target.closest('[data-qa-clock="uncontained"]')&&!qa.uncontainedObservation)qa.uncontainedObservation={scale:parseFloat(entry.target.style.getPropertyValue('--timer-scale')),width:entry.contentRect.width};}if(held.length)qa.held.push(()=>callback(held,observer));});}};
 })()`});
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=__timerJobs;qa.frames=n=>new Promise(resolve=>{const frame=()=>--n?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);});
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__timerJob)qa.receipts.push(receipt);});
  qa.connection=conn(()=>{},message=>{
   const node=message.val.existing?document.querySelector('[data-qa-clock="ready"]'):document.createElement('span');
   if(!message.val.existing){node.className='timer';node.dataset.qaClock=message.__timerJob;if(message.val.hold)node.dataset.holdClock='';const table=document.createElement('table'),body=table.createTBody(),cell=body.insertRow().insertCell();cell.append(node);document.querySelector('[data-board-card="automation"]').append(table);}
   cleitstand.timerDisplay(node,message.val.value||'-22222:22:22');if(message.val.afterFont)node.style.fontSize=message.val.afterFont;if(message.val.uncontained)node.querySelector('.timer-value').style.contain='none';if(message.val.addRow)node.closest('tbody').insertRow().insertCell().textContent='Other game';if(message.val.colorOnly){node.closest('tr').classList.add('call_on_court_debug_blocked');node.style.color='red';}
  });
  qa.receive=(id,hold,value,extra={})=>{const message={type:'change',ctype:'qa_timer_fit',tournament_key:curt.key,val:{hold,value,...extra},__timerJob:id};qa.connection._test_handle_message({data:JSON.stringify(message)});};
  qa.release=()=>{document.querySelectorAll('[data-hold-clock]').forEach(node=>node.removeAttribute('data-hold-clock'));qa.held.splice(0).forEach(release=>release());};
 })()`);
 await c.evaluate('new Promise(resolve=>{const frame=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(frame):resolve();frame();})');
 await c.evaluate('__timerJobs.initialBlock={};btsAdminUpdates.setQueuePending(__timerJobs.initialBlock,true);__timerJobs.receive("held",true);__timerJobs.receive("ready",false);__timerJobs.frames(8)');
 const isolated=await c.evaluate('({heldObservations:__timerJobs.held.length,heldReceipt:__timerJobs.receipts.some(receipt=>receipt.message.__timerJob==="held"),readyReceipt:__timerJobs.receipts.some(receipt=>receipt.message.__timerJob==="ready"&&receipt.status==="presented"),readyFitted:parseFloat(document.querySelector("[data-qa-clock=ready] .timer-value").style.getPropertyValue("--timer-scale"))<1})');
 await c.evaluate('btsAdminUpdates.setQueuePending(__timerJobs.initialBlock,false);__timerJobs.release();btsAdminUpdates.whenSettled()');
 const final=await c.evaluate('({firstReadyObservation:__timerJobs.firstReadyObservation,receipts:__timerJobs.receipts.map(({message,status,timings,ui_jobs})=>({id:message.__timerJob,status,timings,ui_jobs})),errors:__timerJobs.errors,pending:btsAdminUpdates.stats().pending})');
 assert(final.errors.length===0,'Normal fitting must produce no native window errors');
 const known=[];
 for(const [id,value,extra]of [['known','-12222:22:22',{addRow:true}],['status','-22222:22:22',{colorOnly:true}],['moved','-12222:22:22',{afterFont:'17px'}]]) {
  await c.evaluate(`(()=>{const qa=__timerJobs;qa.block={};btsAdminUpdates.setQueuePending(qa.block,true);qa.receive(${JSON.stringify(id)},false,${JSON.stringify(value)},{existing:true,...${JSON.stringify(extra)}})})()`);
  let sample;
  try {await c.evaluate('__timerJobs.frames(8)');sample=await c.evaluate(`({id:${JSON.stringify(id)},presented:__timerJobs.receipts.some(r=>r.message.__timerJob===${JSON.stringify(id)}&&r.status==='presented')})`);}
  finally {await c.evaluate('btsAdminUpdates.setQueuePending(__timerJobs.block,false);btsAdminUpdates.whenSettled()');}
  known.push(sample);
 }
 await c.evaluate('__timerJobs.receive("uncontained",false,"-22222:22:22",{uncontained:true});btsAdminUpdates.whenSettled()');
 const uncontained=await c.evaluate('({first:__timerJobs.uncontainedObservation,receipt:__timerJobs.receipts.find(r=>r.message.__timerJob==="uncontained")?.status})');
 assert(uncontained.first&&uncontained.first.scale===null&&uncontained.receipt==='presented','A clock without size containment retains the deferred fitting fallback');
 await c.evaluate(`(()=>{
  const native=CanvasRenderingContext2D.prototype.measureText;
  CanvasRenderingContext2D.prototype.measureText=function(...args){CanvasRenderingContext2D.prototype.measureText=native;throw new Error('intentional timer fitting failure');};
  __timerJobs.receive('failed',false,'-222222222:22:22');__timerJobs.receive('unaffected',false);
 })()`);
 await c.evaluate('btsAdminUpdates.whenSettled()');
 const failure=await c.evaluate('({receipts:__timerJobs.receipts.filter(receipt=>["failed","unaffected"].includes(receipt.message.__timerJob)).map(({message,status})=>({id:message.__timerJob,status})),errors:__timerJobs.errors,pending:btsAdminUpdates.stats().pending,layout:cleitstand.isUpdating()})');
 assert(failure.receipts.some(receipt=>receipt.id==='failed'&&receipt.status==='failed')&&failure.receipts.some(receipt=>receipt.id==='unaffected'&&receipt.status==='presented'),'A fitting failure fails its own receipt and preserves independent fitting work');
 assert(failure.errors.length===1&&failure.errors[0].includes('intentional timer fitting failure')&&!failure.pending&&!failure.layout,'Fitting errors are reported and all jobs drain');
 const report={failure,known,scope:'Native browser receive queue and fitting. One first observation is withheld. Existing clock geometry must bypass an unrelated pending queue; a font change later in the same handler must retain its fresh fitting dependency. No live writes.',isolated,...final};
 fs.writeFileSync(path.join(previews,(process.env.BTS_TIMER_PREFIX||'timer-jobs')+'-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 assert(isolated.heldObservations>0&&!isolated.heldReceipt,'A clock must wait for its own first observation');
 assert(isolated.readyReceipt&&isolated.readyFitted,'An independently fitted clock must not wait for an unrelated missing observation');
 assert(final.firstReadyObservation?.scale>0&&final.firstReadyObservation.scale<1,'A size-contained clock is fitted from its own first native observation before another frame');
 assert(final.receipts.length===2&&final.receipts.every(receipt=>receipt.status==='presented')&&final.pending===0&&final.errors.length===0,'All owned fitting work and native rendering frames complete without errors');
 assert(known[0].presented,'An existing clock with unchanged geometry must fit without waiting for unrelated queued messages');
 assert(known[1].presented,'Pure status colors must retain known clock geometry');
 assert(!known[2].presented,'A structural write after fitting must still retain the updated clock geometry dependency');
};
