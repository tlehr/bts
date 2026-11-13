'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const container=document.querySelector('.unassigned_container'),row=container.querySelector('tr[data-match_id]'),match=curt.matches.find(match=>match._id===row.dataset.match_id),selection=curt.location_preparation_selection_by_location_id.CH;
  selection.display_cutoff_match_id=match._id;selection.display_cutoff_match_num=match.setup.match_num;
  window.__prepQA={container,row,match,selection};
  __prepQA.settle=()=>new Promise((resolve,reject)=>{const end=performance.now()+5000;let stable=0;const wait=()=>{if(performance.now()>end)return reject(Error('Preparation UI did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable>=3)resolve();else requestAnimationFrame(wait)};requestAnimationFrame(wait)});
  cmatch.refresh_unassigned_preparation_context();
 })()`);
 await c.evaluate('__prepQA.settle()');
 const repeated=await c.evaluate(`(async()=>{
  const qa=__prepQA;qa.boundary=qa.container.querySelector('.ls-call-boundary');qa.info=qa.row.querySelector('.preparation_debug_icon');qa.player=qa.row.querySelector('.player').firstChild;
  const records=[],observer=new MutationObserver(batch=>records.push(...batch));observer.observe(qa.container,{subtree:true,attributes:true,childList:true,characterData:true});
  const start=performance.now();cmatch.refresh_unassigned_preparation_context();const handler_ms=performance.now()-start;
  await qa.settle();records.push(...observer.takeRecords());observer.disconnect();
  return{handler_ms,mutations:records.length,childChanges:records.filter(record=>record.type==='childList').length,sameBoundary:qa.boundary===qa.container.querySelector('.ls-call-boundary'),sameInfo:qa.info===qa.row.querySelector('.preparation_debug_icon'),samePlayer:qa.player===qa.row.querySelector('.player').firstChild,layout:cleitstand.isUpdating()};
 })()`);
 assert.strictEqual(repeated.mutations,0,'The complete deferred preparation refresh must make no mutations for unchanged data');
 assert(repeated.sameBoundary&&repeated.sameInfo&&repeated.samePlayer&&!repeated.layout,'Unchanged diagnostics preserve objects and leave no pending layout');
 const changed=await c.evaluate(`(async()=>{
  const qa=__prepQA,before=qa.boundary.querySelector('.ls-call-boundary-label>span'),title=qa.row.querySelector('.match_num'),original=title.textContent;
  title.textContent='999';cleitstand.refreshUnassigned(qa.container);await qa.settle();
  const result={same:qa.boundary===qa.container.querySelector('.ls-call-boundary'),updated:qa.boundary.textContent.includes('999'),sameInfo:qa.info===qa.row.querySelector('.preparation_debug_icon'),sameLabel:before===qa.boundary.querySelector('.ls-call-boundary-label>span')};title.textContent=original;return result;
 })()`);
 assert(changed.same&&changed.updated&&changed.sameInfo&&changed.sameLabel,'A changed boundary updates its label and preserves neighboring controls');
 const permission=await c.evaluate(`(async()=>{
  const qa=__prepQA;qa.selection.diagnostics_by_match_id[qa.match._id]={manual_eligible:false,rules:[]};if(Array.isArray(qa.selection.manual_callable_match_ids))qa.selection.manual_callable_match_ids=qa.selection.manual_callable_match_ids.filter(id=>id!==qa.match._id);
  cmatch.refresh_unassigned_preparation_context();await qa.settle();const removed=!qa.row.querySelector('.match_preparation_call_button');
  qa.selection.diagnostics_by_match_id[qa.match._id]={manual_eligible:true,rules:[]};if(Array.isArray(qa.selection.manual_callable_match_ids))qa.selection.manual_callable_match_ids.push(qa.match._id);
  cmatch.refresh_unassigned_preparation_context();await qa.settle();return{removed,restored:!!qa.row.querySelector('.match_preparation_call_button'),sameInfo:qa.info===qa.row.querySelector('.preparation_debug_icon')};
 })()`);
 assert(permission.removed&&permission.restored&&permission.sameInfo,'Permission changes remove/restore the matching button and retain its information icon');
 const report={date:'2026-11-12',checks:4,scope:'Isolated native UI; observes each full deferred update through completion, including identical diagnoses, a changed boundary and changed permission.',repeated,changed,permission};
 fs.writeFileSync(path.join(previews,'preparation-stability-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
};
