
'use strict';
/* eslint-disable no-console -- Native browser scheduling regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}){
 await open(1920,1080);await c.evaluate('new Promise(resolve=>{const frame=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(frame):resolve();frame();})');
 await c.evaluate(`(()=>{
 const qa=window.__sliceQA={completed:0,handledAt:null,receipts:[]};
 qa.unsubscribe=btsAdminUpdates.subscribe(r=>{if(r.message.__sliceQA)qa.receipts.push(r)});
 qa.connection=conn(()=>{},message=>{
  if(message.ctype==='score'){qa.handledAt=qa.completed;crouting.on_change(message);return;}
  for(let i=0;i<6;i++)cleitstand.deferUpdate('qa-slice-'+i,()=>{
   if(!i)setTimeout(()=>{const match=curt.matches.find(m=>m._id==='match-37');qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'score',tournament_key:curt.key,__sliceQA:'point',val:{match_id:match._id,court_id:match.setup.court_id,network_score:[[7,8]],now_on_court:true,presses:[]}})})},0);
   const end=performance.now()+4;while(performance.now()<end){};qa.completed++;
  });
 });
 qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'qa-slices',tournament_key:curt.key,__sliceQA:'metadata',val:{}})});
 })()`);
 await c.evaluate('new Promise((resolve,reject)=>{const end=performance.now()+4000;const poll=()=>{if(__sliceQA.receipts.length===2)return resolve();if(performance.now()>end)return reject(Error(\'Missing sliced receipts\'));setTimeout(poll,20)};poll();})');
 const report=await c.evaluate('({completed:__sliceQA.completed,handledAt:__sliceQA.handledAt,receipts:__sliceQA.receipts.map(r=>({kind:r.message.__sliceQA,status:r.status,jobs:r.ui_jobs})),pending:btsAdminUpdates.stats().pending})');
 assert.strictEqual(report.completed,6);assert(report.handledAt>0&&report.handledAt<6,'A newly arriving point must run between shared jobs');
 assert(report.receipts.every(r=>r.status==='presented'),'Both updates must finish their native presentation frames');assert.strictEqual(report.receipts.find(r=>r.kind==='metadata').jobs.filter(j=>j.name.startsWith('qa-slice-')&&j.status==='complete').length,6,'The metadata receipt must retain all six complete owned jobs');
 assert(!c.events.some(e=>e.method==='Runtime.exceptionThrown'));
 fs.writeFileSync(path.join(previews,'shared-ui-yield-verification.json'),JSON.stringify(report));console.log(JSON.stringify(report));
 {
 await open(1920,1080);await c.evaluate('new Promise(resolve=>{const poll=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(poll):resolve();poll();})');
 await c.evaluate(`(()=>{
 const qa=window.__stageYield={receipts:[],sorted:false,sortedOnArrival:null,sortedOnPoint:null};
 const native=btsAdminUpdates.createJob;
 btsAdminUpdates.createJob=function(name){const job=native.call(this,name),run=job.run;if(name==='finished.sort')job.run=callback=>run(()=>{const value=callback();qa.sorted=true;return value});return job;};
 qa.unsubscribe=btsAdminUpdates.subscribe(r=>{if(r.message.__stageYield)qa.receipts.push(r)});
 qa.connection=conn(()=>{},message=>{
  if(message.ctype==='score'){qa.sortedOnPoint=qa.sorted;crouting.on_change(message);return;}
  cleitstand.deferUpdate('qa-before-sort',()=>queueMicrotask(()=>{
   qa.sortedOnArrival=qa.sorted;const match=curt.matches.find(m=>m._id==='match-37');
   qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'score',tournament_key:curt.key,__stageYield:'point',val:{match_id:match._id,court_id:match.setup.court_id,network_score:[[9,10]],now_on_court:true,presses:[]}})});
  }));
  cleitstand.refreshFinished();
 });
 qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'qa-stages',tournament_key:curt.key,__stageYield:'metadata',val:{}})});
 })()`);
 await c.evaluate('new Promise((resolve,reject)=>{const end=performance.now()+4000;const poll=()=>{if(__stageYield.receipts.length===2)return resolve();if(performance.now()>end)return reject(Error("Stage receipts missing"));setTimeout(poll,10)};poll();})');
 const report=await c.evaluate('({sorted:__stageYield.sorted,sortedOnArrival:__stageYield.sortedOnArrival,sortedOnPoint:__stageYield.sortedOnPoint,receipts:__stageYield.receipts.map(r=>({kind:r.message.__stageYield,status:r.status,jobs:r.ui_jobs})),pending:btsAdminUpdates.stats().pending})');
 fs.writeFileSync(path.join(previews,'shared-ui-stage-yield-verification.json'),JSON.stringify(report));console.log(JSON.stringify(report));
 assert.strictEqual(report.sortedOnArrival,false,'A new point can enter before the next expensive finished-list stage');
 assert.strictEqual(report.sortedOnPoint,false,'The point handler runs before the independent finished-list stage');
 assert(report.sorted&&report.receipts.every(r=>r.status==='presented'));assert.strictEqual(report.pending,0);
 const jobs=report.receipts.find(r=>r.kind==='metadata').jobs;
 assert(jobs.some(j=>j.name==='qa-before-sort'&&j.status==='complete'));assert(jobs.some(j=>j.name==='finished.sort'&&j.status==='complete'));
 assert(!c.events.some(e=>e.method==='Runtime.exceptionThrown'));
 }
 await require('./finished-frame-check')({c,open,previews});
};
