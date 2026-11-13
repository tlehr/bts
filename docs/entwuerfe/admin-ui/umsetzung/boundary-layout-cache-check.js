'use strict';
/* eslint-disable no-console -- Isolated native table geometry regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=window.__boundaryCache={reads:0,native:Element.prototype.getBoundingClientRect};
  qa.settle=()=>new Promise((resolve,reject)=>{const end=performance.now()+5000;let stable=0;const frame=()=>{if(performance.now()>end)return reject(new Error('Boundary layout did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable>=3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.container=document.querySelector('.unassigned_container');qa.row=qa.container.querySelector('tr[data-match_id]');qa.row.classList.add('preparation_call_cutoff');
  curt.location_preparation_selection_by_location_id={CH:{display_cutoff_match_id:qa.row.dataset.match_id}};
  Element.prototype.getBoundingClientRect=function(...args){if(this.matches('.ls-planned-table,.ls-planned-table th.ls-teams'))qa.reads++;return qa.native.apply(this,args)};
  cleitstand.refreshUnassigned(qa.container);
  qa.geometry=()=>{const table=qa.container.querySelector('table'),heading=table.tHead.querySelector('.ls-teams'),label=table.querySelector('.ls-call-boundary-label'),a=qa.native.call(heading),b=qa.native.call(label);return{left:b.left,width:b.width,expectedLeft:a.left,expectedWidth:a.width,reads:qa.reads}};
 })()`);
 try {
  await c.evaluate('__boundaryCache.settle()');
  const checks=[];
  for(let i=0;i<8;i++)await c.evaluate('(cleitstand.refreshUnassigned(__boundaryCache.container),__boundaryCache.settle())');
  checks.push(await c.evaluate('__boundaryCache.geometry()'));
  for(const width of [1700,1000,1920]) {
   await metrics(width,1080);await c.evaluate('__boundaryCache.settle()');checks.push(await c.evaluate('__boundaryCache.geometry()'));
  }
  for(const check of checks) {
   assert.strictEqual(check.reads,0,'The boundary never measures table/header geometry, including viewport resizes');
   assert(Math.abs(check.left-check.expectedLeft)<.25&&Math.abs(check.width-check.expectedWidth)<.25,'Native table cells align the boundary with the teams column');
  }
  assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
  fs.writeFileSync(path.join(previews,'boundary-layout-cache-verification.json'),JSON.stringify({scope:'Native table-column alignment, repeated updates and viewport resizes; zero application geometry reads. No live services.',checks},null,2)+'\n');
  console.log(JSON.stringify({checks},null,2));
 }finally{await c.evaluate('Element.prototype.getBoundingClientRect=__boundaryCache.native')}
};
