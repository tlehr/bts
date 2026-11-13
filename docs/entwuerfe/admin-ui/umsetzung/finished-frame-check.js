'use strict';
/* eslint-disable no-console -- Native animation-frame regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);await c.evaluate('new Promise(resolve=>{const poll=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(poll):resolve();poll();})');
 await c.evaluate(`(()=>{
 const qa=window.__frameSort={frame:0,sorts:[],receipts:[],running:true};
 requestAnimationFrame(function tick(){qa.frame++;if(qa.running)requestAnimationFrame(tick)});
 const native=btsAdminUpdates.createJob;btsAdminUpdates.createJob=function(name){const job=native.call(this,name),run=job.run;if(name==='finished.sort')job.run=callback=>run(()=>{const value=callback();qa.sorts.push(qa.frame);if(qa.sorts.length<12)queueMicrotask(()=>qa.receive());return value});return job;};
 btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__frameSort)qa.receipts.push(receipt)});
 qa.connection=conn(()=>{},()=>{cleitstand.deferUpdate('qa-frame-prerequisite',()=>{});cleitstand.refreshFinished()});
 qa.receive=()=>qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'qa-frame-sort',val:{},tournament_key:curt.key,__frameSort:true})});qa.receive();
 })()`);
 await c.evaluate('new Promise((resolve,reject)=>{const end=performance.now()+5000;const poll=()=>{if(__frameSort.receipts.length===12){__frameSort.running=false;return resolve()}if(performance.now()>end)return reject(Error("Frame sorting did not drain"));setTimeout(poll,10)};poll();})');
 const report=await c.evaluate('({sorts:__frameSort.sorts,receipts:__frameSort.receipts.map(r=>({status:r.status,jobs:r.ui_jobs})),pending:btsAdminUpdates.stats().pending})');
 fs.writeFileSync(path.join(previews,'finished-frame-verification.json'),JSON.stringify(report));console.log(JSON.stringify(report));
 const counts=new Map();for(const frame of report.sorts)counts.set(frame,(counts.get(frame)||0)+1);
 assert(Math.max(...counts.values())<=1,'Finished-list metadata is sorted at most once per native animation frame');
 assert(report.receipts.every(r=>r.status==='presented'&&r.jobs.some(j=>j.name==='finished.sort'&&j.status==='complete')));assert.strictEqual(report.pending,0);assert(!c.events.some(e=>e.method==='Runtime.exceptionThrown'));
};
