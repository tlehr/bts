'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
module.exports=async function({c,previews,matchCount,timerCount}) {
 await c.call('Performance.enable');
 await c.evaluate(`(()=>{
  const qa=window.__containment={timers:[...document.querySelectorAll('.player .timer')],style:document.createElement('style')};document.head.append(qa.style);
  qa.frames=n=>new Promise(resolve=>{const next=()=>--n?requestAnimationFrame(next):resolve();requestAnimationFrame(next)});
  qa.geometry=()=>[...document.querySelectorAll('.courts_container tr[data-match_id]')].map(row=>row.getBoundingClientRect().height);
  qa.timers.forEach(timer=>cleitstand.timerDisplay(timer,'1:23'));
 })()`);
 await c.evaluate('__containment.frames(3)');
 const metric=async()=>Object.fromEntries((await c.call('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
 const samples=[];
 for(const contain of ['none','size layout','none','size layout']) {
  await c.evaluate(`__containment.style.textContent='.leitstand .timer-value {contain:${contain}!important}';__containment.frames(3)`);
  const before=await metric();
  const geometry=await c.evaluate(`(async()=>{
   const qa=__containment,before=qa.geometry();
   for(let frame=0;frame<30;frame++){await qa.frames(1);qa.timers.forEach(timer=>cleitstand.timerDisplay(timer,'1:'+String(20+frame%40).padStart(2,'0')));void document.body.offsetHeight;}
   await qa.frames(2);return{before,after:qa.geometry(),text:qa.timers[0].getAttribute('aria-label')};
  })()`);
  const after=await metric();
  assert.deepStrictEqual(geometry.after,geometry.before,'Timer containment must preserve every current match row height');
  assert.strictEqual(geometry.text,'1:49');
  samples.push({contain,layout_ms:(after.LayoutDuration-before.LayoutDuration)*1000,style_ms:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,layouts:after.LayoutCount-before.LayoutCount});
 }
 const mean=kind=>{const values=samples.filter(sample=>sample.contain===kind);return values.reduce((sum,sample)=>sum+sample.layout_ms,0)/values.length;};
 const report={date:'2026-10-30',scope:'Isolierter Browser, abwechselnd deaktivierte/aktivierte Layoutbegrenzung auf derselben großen Liste. Vier Durchläufe mit je 30 Frames und 200 Uhraktualisierungen pro Frame. Zusätzliche Geometrieabfrage erzwingt die Layoutberechnung. Keine Live-Dienste.',checks:4,matchCount,timerCount,samples,mean_layout_ms_before:mean('none'),mean_layout_ms_after:mean('size layout'),layout_ratio:mean('size layout')/mean('none')};
 await c.evaluate('__containment.style.remove()');
 fs.writeFileSync(path.join(previews,'timer-containment-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
};
