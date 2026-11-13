'use strict';
/* eslint-disable no-console, quotes -- Native browser checks embed JavaScript scripts. */
const fs=require('fs'),assert=require('assert');
module.exports=async({c,open,previews})=>require('./call-status-benchmark')({c,open,afterSetup:async()=>{
 const result=await c.evaluate(`(async()=>{
  const row=document.querySelector('tr[data-match_id="status-30"]'),group=row.querySelector('.ls-preparation-calls'),container=row.closest('.unassigned_container'),children=[...group.children];
  const native=Element.prototype.getBoundingClientRect;let reads=0;
  Element.prototype.getBoundingClientRect=function(...args){if(this.classList.contains('ls-preparation-calls'))reads++;return native.apply(this,args);};
  const phases=[];
  const refresh=async name=>{const before=reads;cleitstand.refreshUnassigned(container,{boundariesChanged:false,structureChanged:false,changedRows:new Set([row])});await btsAdminUpdates.whenSettled();await __statusBench.settle();const actual=native.call(group).width/(parseFloat(document.querySelector('.leitstand').style.getPropertyValue('--board-scale'))||1);phases.push({name,reads:reads-before,actual,style:group.closest('.match_table').style.getPropertyValue('--preparation-width')});};
  try {
   await refresh('prime both halls');
   children[0].remove();await refresh('second hall only');
   group.replaceChildren(children[0]);await refresh('first hall only');
   group.replaceChildren(...children);await refresh('both halls again');
   const label=children[0].querySelector('.ls-call-location'),original=label.textContent;
   label.textContent='Eine erheblich längere neue Hallenbezeichnung';await refresh('unknown hall label');
   label.textContent=original;await refresh('known label restored');
   return {phases,errors:__statusErrors};
  } finally {Element.prototype.getBoundingClientRect=native;}
 })()`);
 fs.writeFileSync(previews+'/preparation-parts-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert(!result.errors.length,'No browser exceptions');
 assert(result.phases[1].actual>0&&result.phases[2].actual>0,'Both individual hall controls stay visible');
 assert(result.phases[4].actual>result.phases[0].actual,'A new long label is actually measured');
 assert(result.phases.slice(1,4).every(p=>p.reads===0),'Known hall-button subsets require no new group geometry');
 assert(result.phases[4].reads>0,'Unknown text retains native geometry fallback');
}});
