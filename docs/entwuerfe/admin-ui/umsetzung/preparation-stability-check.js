'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const container=document.querySelector('.unassigned_container'),row=container.querySelector('tr[data-match_id]'),match=curt.matches.find(match=>match._id===row.dataset.match_id),selection=curt.location_preparation_selection_by_location_id.CH;
  selection.display_cutoff_match_id=match._id;selection.display_cutoff_match_num=match.setup.match_num;
  window.__prepQA={container,row,match,selection};cmatch.refresh_unassigned_preparation_context();
 })()`);
 const settle=()=>c.evaluate('new Promise(resolve=>{const wait=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(wait):requestAnimationFrame(()=>requestAnimationFrame(resolve));wait()})');
 await settle();
 const repeated=await c.evaluate(`(()=>{
  const qa=__prepQA;qa.boundary=qa.container.querySelector('.ls-call-boundary');qa.info=qa.row.querySelector('.preparation_debug_icon');qa.button=qa.row.querySelector('.match_preparation_call_button');qa.player=qa.row.querySelector('.player').firstChild;
  const observer=new MutationObserver(()=>{});observer.observe(qa.container,{subtree:true,attributes:true,childList:true,characterData:true});
  const start=performance.now();cmatch.refresh_unassigned_preparation_context();
  const records=observer.takeRecords();observer.disconnect();
  return{handler_ms:performance.now()-start,mutations:records.length,childChanges:records.filter(record=>record.type==='childList').length,sameBoundary:qa.boundary===qa.container.querySelector('.ls-call-boundary'),sameInfo:qa.info===qa.row.querySelector('.preparation_debug_icon'),samePlayer:qa.player===qa.row.querySelector('.player').firstChild,layout:cleitstand.isUpdating()};
 })()`);
 console.log('Repeated diagnosis '+JSON.stringify(repeated));
 assert.strictEqual(repeated.mutations,0,'An unchanged preparation diagnosis must make no DOM mutations');
 assert(repeated.sameBoundary&&repeated.sameInfo&&repeated.samePlayer&&!repeated.layout,'Unchanged diagnostics preserve every object and skip layout scheduling');
 await settle();
 const changed=await c.evaluate(`(()=>{
  const qa=__prepQA;qa.selection.display_cutoff_match_num=999;
  const before=qa.boundary.querySelector('.ls-call-boundary-label>span');cmatch.refresh_unassigned_preparation_context();
  const title=qa.row.querySelector('.match_num');const original=title.textContent;title.textContent='999';cleitstand.refreshUnassigned(qa.container);title.textContent=original;
  return{same:qa.boundary===qa.container.querySelector('.ls-call-boundary'),updated:qa.boundary.textContent.includes('999'),sameInfo:qa.info===qa.row.querySelector('.preparation_debug_icon'),sameLabel:before===qa.boundary.querySelector('.ls-call-boundary-label>span')};
 })()`);
 assert(changed.same&&changed.updated&&changed.sameInfo&&changed.sameLabel,'A changed boundary updates its existing label and preserves neighboring controls');
 const permission=await c.evaluate(`(()=>{
  const qa=__prepQA;qa.selection.diagnostics_by_match_id[qa.match._id]={manual_eligible:false,rules:[]};cmatch.refresh_unassigned_preparation_context();
  const removed=!qa.row.querySelector('.match_preparation_call_button');qa.selection.diagnostics_by_match_id[qa.match._id]={manual_eligible:true,rules:[]};cmatch.refresh_unassigned_preparation_context();
  return{removed,restored:!!qa.row.querySelector('.match_preparation_call_button'),sameInfo:qa.info===qa.row.querySelector('.preparation_debug_icon')};
 })()`);
 assert(permission.removed&&permission.restored&&permission.sameInfo,'Changed preparation permission removes/restores the proper button without replacing its info icon');
 await settle();
 const report={date:'2026-10-30',checks:4,scope:'Isolierte native Oberfläche: identische Diagnosen, geänderte Grenze und wechselnde Aufrufberechtigung.',repeated,changed,permission};
 fs.writeFileSync(path.join(previews,'preparation-stability-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
};
