'use strict';
/* eslint-disable no-console, quotes -- Browser diagnostic expressions contain quoted selectors. */
const fs=require('fs'),path=require('path'),assert=require('assert');
module.exports=async function({c,previews,matchCount,timerCount}) {
 await c.evaluate(`(()=>{
  const qa=window.__paintQA={style:document.createElement('style'),timers:[...document.querySelectorAll('.player .timer')].slice(0,200)};
  document.head.append(qa.style);
  const host=document.querySelector('[data-board-card="automation"]');qa.warning=document.createElement('span');qa.warning.className='match_timer';host.append(qa.warning);
  const clock=document.createElement('span');clock.className='timer timer_overdue';qa.warning.append(clock);cleitstand.timerDisplay(clock,'-1:23');
  qa.frames=n=>new Promise(resolve=>{const next=()=>--n?requestAnimationFrame(next):resolve();requestAnimationFrame(next)});
  qa.geometry=()=>[...document.querySelectorAll('.match_table tr[data-match_id]')].map(row=>[row.getBoundingClientRect().width,row.getBoundingClientRect().height]);
 })()`);
 const samples=[];
 try {
  for(const mode of ['original','scoped','composited','original','scoped','composited']) {
   const styles=(mode==='original'?'.leitstand .table-wrap{contain:none!important}':'')+(mode!=='composited'?'.leitstand .match_timer .timer_overdue .ico{will-change:auto!important;animation:qa-stroke 1.2s ease-in-out infinite!important}@keyframes qa-stroke{0%,100%{stroke-width:1.6}50%{stroke-width:3.2}}':'');
   await c.evaluate(`__paintQA.style.textContent=${JSON.stringify(styles)};__paintQA.frames(3)`);
   const geometry=await c.evaluate('__paintQA.geometry()'),start=c.events.length;
   await c.call('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});
   await c.evaluate(`new Promise(resolve=>{const qa=__paintQA;let tick=0;const timer=setInterval(()=>{qa.timers.forEach(node=>cleitstand.timerDisplay(node,'1:'+String(20+tick%40).padStart(2,'0')));tick++;},100);setTimeout(()=>{clearInterval(timer);resolve();},4000)})`);
   await c.call('Tracing.end');
   for(let n=0;!c.events.slice(start).some(event=>event.method==='Tracing.tracingComplete');n++){assert(n<100,'Trace must finish');await new Promise(resolve=>setTimeout(resolve,20));}
   const traces=c.events.slice(start).filter(event=>event.method==='Tracing.dataCollected').flatMap(event=>event.params.value);
   const times=name=>{const events=traces.filter(event=>event.name===name&&event.dur);return {count:events.length,total_ms:Math.round(events.reduce((sum,event)=>sum+event.dur,0)/100)/10,max_ms:Math.round(Math.max(0,...events.map(event=>event.dur))/100)/10};};
   assert.deepStrictEqual(await c.evaluate('__paintQA.geometry()'),geometry,'Paint isolation must preserve all row dimensions');
   samples.push({mode,paint:times('Paint'),layout:times('Layout'),style:times('UpdateLayoutTree')});
  }
  const mean=(mode,key)=>{const group=samples.filter(sample=>sample.mode===mode);return group.reduce((sum,sample)=>sum+sample[key].total_ms,0)/group.length;};
  const report={scope:'Alternating synthetic browser comparison on identical rows; 200 clock changes per 100 ms and an overdue warning. Tracing is diagnostic overhead, not end-to-end latency acceptance.',matchCount,timerCount,samples,mean_paint_ms:Object.fromEntries(['original','scoped','composited'].map(mode=>[mode,mean(mode,'paint')]))};
  assert(report.mean_paint_ms.composited<report.mean_paint_ms.original,'Scoped paint and composited warning should reduce repaint work');
  fs.writeFileSync(path.join(previews,'paint-scope-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 } finally {await c.evaluate('__paintQA.style.remove();__paintQA.warning.remove()');}
};
