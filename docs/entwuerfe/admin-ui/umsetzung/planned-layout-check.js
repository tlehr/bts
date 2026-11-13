'use strict';
/* eslint-disable no-console, quotes -- Isolated native browser comparison with embedded scripts. */
const fs=require('fs'),path=require('path'),assert=require('assert');

// Restore the former native formatting while retaining the same data, columns,
// typography, handlers and every other optimization in the current document.
const native=`
.leitstand .ls-planned-table{display:table!important}
.leitstand .ls-planned-table>colgroup{display:table-column-group!important}
.leitstand .ls-planned-table>thead{display:table-header-group!important}
.leitstand .ls-planned-table>tbody{display:table-row-group!important}
.leitstand .ls-planned-table>thead>tr,.leitstand .ls-planned-table>tbody>tr:not(.ls-date-collapsed):not(.do_not_show):not([hidden]){display:table-row!important;contain:none!important}
.leitstand .ls-planned-table>thead>tr>th,.leitstand .ls-planned-table>tbody>tr>:is(td,th){display:table-cell!important}
.leitstand .ls-planned-table>tbody>tr[data-match_id]>td{height:30px!important;min-height:0!important}
`;

module.exports=async function({c,open,previews}) {
 const phases=[];
 for(const mode of ['native','current','native','current'])await require('./call-status-benchmark')({c,open,afterSetup:async()=>{
  await c.evaluate(`(()=>{
   const qa=window.__plannedLayout={rows:[...document.querySelectorAll('.ls-planned-table tr[data-match_id]')],times:[]};
   qa.geometry=()=>qa.rows.map(row=>[row.getBoundingClientRect().width,row.getBoundingClientRect().height]);qa.before=qa.geometry();
   const style=document.createElement('style');style.textContent=${JSON.stringify(mode==='native'?native:'')};document.head.append(style);
   qa.update=async index=>{
    const base=26+(index*20)%480;
    for(let n=0;n<20;n++) {
     const match=curt.matches[base+n],setup=structuredClone(match.setup);
     setup.teams[0].players[0].now_playing_on_court=index%2?'C1':false;
     crouting.on_change({ctype:'update_player_status',tournament_key:'preview',val:{match__id:match._id,setup}});
    }
    const match=curt.matches[index%15];match.network_score=[[5+index%10,5]];
    const start=performance.now();cmatch.update_match_score(match);
    await btsAdminUpdates.whenSettled();await __statusBench.settle();qa.times.push(performance.now()-start);
   };
  })()`);
  await c.evaluate('__statusBench.settle()');
  const initial=await c.evaluate(`({rows:__plannedLayout.rows.length,geometry_delta:Math.max(0,...__plannedLayout.geometry().flatMap((row,index)=>row.map((value,column)=>Math.abs(value-__plannedLayout.before[index][column]))))})`);
  assert(initial.geometry_delta<=.5,'Independent row layout retains native table dimensions');
  await c.evaluate('(async()=>{for(let n=0;n<3;n++)await __plannedLayout.update(n)})()');
  await c.call('Performance.enable');const before=await c.call('Performance.getMetrics'),start=c.events.length;
  await c.call('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});
  await c.evaluate('(async()=>{__plannedLayout.times=[];for(let n=0;n<25;n++)await __plannedLayout.update(n+3)})()');
  await c.call('Tracing.end');
  for(let n=0;!c.events.slice(start).some(event=>event.method==='Tracing.tracingComplete');n++) {
   assert(n<250,'Native trace must complete');await new Promise(resolve=>setTimeout(resolve,20));
  }
  const trace=c.events.slice(start).filter(event=>event.method==='Tracing.dataCollected').flatMap(event=>event.params.value);
  const after=await c.call('Performance.getMetrics');
  const timing=name=>{const rows=trace.filter(event=>event.name===name&&event.dur);return {count:rows.length,
   total_ms:rows.reduce((sum,event)=>sum+event.dur/1000,0),max_ms:Math.max(0,...rows.map(event=>event.dur/1000))};};
  phases.push({mode,fresh_document:true,initial,times:await c.evaluate('__plannedLayout.times'),
   native:{layout:timing('Layout'),paint:timing('Paint'),prepaint:timing('PrePaint'),style:timing('UpdateLayoutTree')},
   metrics:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(key=>[key,
    1000*(after.metrics.find(row=>row.name===key).value-before.metrics.find(row=>row.name===key).value)]))});
 }});
 const mean=mode=>{const rows=phases.filter(row=>row.mode===mode);return rows.reduce((sum,row)=>sum+row.native.paint.total_ms+row.native.prepaint.total_ms,0)/rows.length;};
 const report={scope:'Isolated 584-game fixture, 558 upcoming / 15 active games. Fresh document per phase, same 25 batches of 20 future-player updates plus one live score; three warmups. Native tracing and extra settling frames are diagnostic overhead. This is a layout regression comparison, not the end-to-end latency acceptance test. Paint events can be nested; totals are compared identically in both variants.',phases,
  mean_paint_and_prepaint_ms:{native:mean('native'),current:mean('current')}};
 fs.writeFileSync(path.join(previews,'planned-layout-verification.json'),JSON.stringify(report,null,2)+'\n');
 assert(report.mean_paint_and_prepaint_ms.current<report.mean_paint_and_prepaint_ms.native*.75,
  'Changing future players must retain the reduction in native painting work');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
 console.log(JSON.stringify(report,null,2));
};
