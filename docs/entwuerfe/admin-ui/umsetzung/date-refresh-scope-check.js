'use strict';
/* eslint-disable no-console -- Native browser performance regression. */
const assert=require('assert');
module.exports=async function({c,open}) {
 await open(1920,1080);
 await c.evaluate(`(async()=>{
  const settle=()=>new Promise(resolve=>{const frame=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame)});await settle();
  const qa=window.__dateScopeQA={receipts:[],queries:{planned:0,finished:0},owners:{planned:document.querySelector('.unassigned_container'),finished:document.querySelector('.finished_container')},native:{}};
  qa.unsubscribe=btsAdminUpdates.subscribe(r=>{if(r.message.__dateScopeQA)qa.receipts.push(r)});
  for(const [key,owner]of Object.entries(qa.owners)){qa.native[key]=owner.querySelectorAll;owner.querySelectorAll=function(...args){qa.queries[key]++;return qa.native[key].apply(this,args)}}
  qa.connection=conn(()=>{},message=>{cleitstand.refreshDates(qa.owners.planned);cleitstand.refreshDates(qa.owners.planned);if(message.val.finished)cleitstand.refreshDates(qa.owners.finished)});
  qa.receive=async finished=>{qa.queries.planned=qa.queries.finished=0;const count=qa.receipts.length;qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'qa-date-scope',tournament_key:curt.key,__dateScopeQA:true,val:{finished}})});await new Promise((resolve,reject)=>{const end=performance.now()+3000;const frame=()=>qa.receipts.length>count?resolve():performance.now()>end?reject(Error('Missing date receipt')):requestAnimationFrame(frame);requestAnimationFrame(frame)});return {queries:{...qa.queries},receipt:qa.receipts.at(-1)}};
 })()`);
 try {
  const planned=await c.evaluate('__dateScopeQA.receive(false)');
  assert(planned.queries.planned>0&&planned.queries.finished===0,'An unassigned-list update must not traverse the unrelated finished history');
  assert.strictEqual(planned.receipt.status,'presented');
  assert.strictEqual(planned.receipt.ui_jobs.filter(job=>job.name==='lists.dates'&&job.status==='complete').length,1,'Repeated requests must share one completed date job');
  const both=await c.evaluate('__dateScopeQA.receive(true)');
  assert(both.queries.planned>0&&both.queries.finished>0,'A coalesced update must retain every explicitly requested list');
  assert.strictEqual(both.receipt.status,'presented');
  assert.strictEqual(both.receipt.ui_jobs.filter(job=>job.name==='lists.dates'&&job.status==='complete').length,1);
  assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
  console.log(JSON.stringify({checks:7,planned_queries:planned.queries,both_queries:both.queries}));
 } finally {await c.evaluate('for(const [key,owner]of Object.entries(__dateScopeQA.owners))owner.querySelectorAll=__dateScopeQA.native[key];__dateScopeQA.unsubscribe()');}
};
