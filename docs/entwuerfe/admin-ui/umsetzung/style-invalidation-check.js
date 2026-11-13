'use strict';
/* eslint-disable no-console -- Isolated native comparison, no live tournament. */
const assert=require('assert'),fs=require('fs'),path=require('path');

// The old stylesheet's colors were overridden on the board. Its positional
// dependencies still invalidated thousands of cells after one row removal.
const legacy=`
.match_table > tbody > tr:nth-of-type(even) > td {background-color:#00000010}
.match_table > tbody > tr:nth-of-type(even):hover > td {background-color:#00000030}
.match_table > tbody > tr:nth-of-type(even) > td.inactive {background-color:#00000050}
.match_table > tbody > tr:nth-of-type(even) > td.droppable_active {background-color:#fbe44d88}
.match_table > tbody > tr:nth-of-type(even):hover > td.droppable_active {background-color:#fbe44dbb}`;

module.exports=async function({c,open,previews}) {
 const phases=[];
 for(const mode of ['current','legacy','current','legacy'])await require('./call-status-benchmark')({c,open,afterSetup:async()=>{
  // Always navigate to a fresh document: removing an injected rule in place
  // can retain positional invalidation dependencies on its existing tbody.
  await c.evaluate(`(()=>{
   const qa=window.__styleProbe={body:document.querySelector('.unassigned_container .match_table tbody')};
   const style=document.createElement('style');style.textContent=${JSON.stringify(mode==='legacy'?legacy:'')};document.head.append(style);
   qa.row=qa.body.querySelector('tr[data-match_id]');qa.next=qa.row.nextSibling;
   qa.frames=n=>new Promise(resolve=>{const frame=()=>--n?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame)});
   qa.geometry=()=>[...qa.body.querySelectorAll('tr[data-match_id]')].map(row=>[row.getBoundingClientRect().width,row.getBoundingClientRect().height]);
   qa.sample=async()=>{qa.row.remove();await qa.frames(2);qa.body.insertBefore(qa.row,qa.next);await qa.frames(2)};
  })()`);
  await c.evaluate('__statusBench.settle()');await c.evaluate('(async()=>{for(let n=0;n<3;n++)await __styleProbe.sample()})()');
  await c.call('Performance.enable');
  const before=await c.call('Performance.getMetrics'),geometry=await c.evaluate('__styleProbe.geometry()');
  await c.evaluate('(async()=>{for(let n=0;n<15;n++)await __styleProbe.sample()})()');
  const after=await c.call('Performance.getMetrics'),finalGeometry=await c.evaluate('__styleProbe.geometry()');
  const result={mode,fresh_document:true,row_changes:30,geometry_unchanged:JSON.stringify(geometry)===JSON.stringify(finalGeometry),
   metrics:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(key=>[key,
    (key.endsWith('Count')?1:1000)*(after.metrics.find(item=>item.name===key).value-before.metrics.find(item=>item.name===key).value)]))};
  assert(result.geometry_unchanged,'A single game update must retain the existing table geometry');phases.push(result);
 }});
 const current=phases.filter(phase=>phase.mode==='current'),baseline=phases.filter(phase=>phase.mode==='legacy');
 const report={scope:'Isolated 584-game fixture, 558 upcoming games. Fresh document per phase; same 30 row changes and two frames after every mutation. No live BTS/BTP traffic.',phases};
 fs.writeFileSync(path.join(previews,'style-invalidation.json'),JSON.stringify(report,null,2)+'\n');
 for(let index=0;index<current.length;index++)assert(current[index].metrics.RecalcStyleDuration<baseline[index].metrics.RecalcStyleDuration*.35,
  'One game must not retain the old whole-list style invalidation cost');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
 console.log(JSON.stringify(report,null,2));
};
