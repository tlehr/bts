'use strict';
/* eslint-disable no-console, quotes -- Native browser checks embed JavaScript scripts. */
const assert=require('assert'),fs=require('fs');
module.exports=async({c,open,previews})=>require('./call-status-benchmark')({c,open,afterSetup:async()=>{
 const result=await c.evaluate(`(async()=>{
  const m=curt.matches[30],qa={phases:[]},original=cleitstand.refreshPlanned;
  let sorts=0;cleitstand.refreshPlanned=function(...args){sorts++;return original.apply(this,args)};
  const update=async(name,change)=>{const incoming=structuredClone(m),before=sorts;change(incoming);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:m._id,match:incoming}});await btsAdminUpdates.whenSettled();await __statusBench.settle();qa.phases.push({name,sorts:sorts-before});};
  try {
   await update('new official',m=>m.setup.umpire={btp_id:991001,name:'Test Official',checked_in:false});
   await update('official attendance',m=>m.setup.umpire.checked_in=true);
   await update('preparation state',m=>m.setup.state='preparation');
   await update('one location',m=>m.setup.location_id='SN');
   await update('deferral',m=>m.setup.preparation_call_deferred=true);
   await update('participant identity',m=>m.setup.teams[0].players[0].btp_id=991002);
   await update('real schedule change with official',m=>{m.setup.umpire.name='New Official';m.setup.scheduled_time_str='18:27'});
   qa.atEnd=[...document.querySelectorAll('.unassigned_container tr[data-match_id]')].at(-1).dataset.match_id===m._id;
   await update('restore schedule',m=>m.setup.scheduled_time_str='12:00');
   qa.restored=document.querySelector('tr[data-match_id="'+m._id+'"]').previousElementSibling?.dataset.match_id==='status-29';
   return {...qa,errors:__statusErrors};
  } finally {cleitstand.refreshPlanned=original;}
 })()`);
 fs.writeFileSync(previews+'/planned-sort-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert(result.atEnd&&result.restored&&!result.errors.length,'Actual schedule changes still reorder the existing row');
 assert(result.phases.slice(0,6).every(p=>p.sorts===0),'Non-ordering changes must not sort the whole upcoming list');
 assert(result.phases.slice(6).every(p=>p.sorts>0),'Actual ordering changes must still sort');
}});
