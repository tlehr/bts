'use strict';
/* global document, ResizeObserver, curt, cleitstand, getComputedStyle */
/* eslint-disable no-console -- Isolated browser regression and measurement. */
const assert=require('assert'),fs=require('fs'),path=require('path');
async function nativeReference() {
   const teams=[...document.querySelectorAll('.team-one,.team-two')].filter(node=>node.getClientRects().length),selected=teams.filter((_,i)=>i%Math.ceil(teams.length/12)===0),widths=new Map();
   await new Promise(resolve=>{const observer=new ResizeObserver(entries=>{for(const entry of entries)widths.set(entry.target,entry.contentRect.width);if(widths.size===selected.length){observer.disconnect();resolve();}});selected.forEach(node=>observer.observe(node));});
   return selected.map(container=>{
    const row=container.closest('tr'),match=curt.matches.find(match=>match._id===row.dataset.match_id),side=container.classList.contains('team-one')?0:1,stages=cleitstand.nameStages(match.setup.teams[side].players),scale=parseFloat(getComputedStyle(document.body).zoom)||1;
    const actual=[...container.querySelectorAll('.player')].map(node=>node.firstChild.nodeValue.replaceAll(String.fromCharCode(160),' '));
    const probe=container.cloneNode(true);probe.classList.remove('ls-team-stacked');probe.classList.add('ls-layout-probe','ls-name-measuring');probe.inert=true;probe.setAttribute('aria-hidden','true');
    for(const node of [probe,...probe.querySelectorAll('[id],[data-match_id]')]){node.removeAttribute('id');node.removeAttribute('data-match_id');}
    container.parentElement.append(probe);
    try{
     const members=[...probe.querySelectorAll('.player')],range=document.createRange();range.selectNodeContents(probe);const inline=[],stacked=[];let extra=0;
     for(const labels of stages){members.forEach((node,i)=>node.firstChild.nodeValue=labels[i].replace(' ',String.fromCharCode(160)));const width=range.getBoundingClientRect().width/scale,memberWidths=members.map(node=>node.getBoundingClientRect().width/scale);inline.push(width);stacked.push(Math.max(...memberWidths));extra=Math.max(0,width-memberWidths.reduce((sum,width)=>sum+width,0));}
     const available=widths.get(container),shouldStack=members.length>1&&inline.at(-1)>available+.25,stage=(shouldStack?stacked.map(width=>width+extra):inline).findIndex(width=>width<=available+.25),expected=stages[stage<0?stages.length-1:stage];
     return{match:match._id,actual,expected,stacked:container.classList.contains('ls-team-stacked'),shouldStack,available};
    }finally{probe.remove();}
   });
}
module.exports=async function({c,open,metrics,previews}) {
 const checks=[],check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('OK '+name);};
 await open(1366,768);
 await c.evaluate(`(()=>{
  localStorage.setItem('bts-admin-density-v2','compact');
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53'));
  curt.matches=Array.from({length:120},(_,i)=>{
   const match=structuredClone(template);match._id='batch-names-'+i;
   Object.assign(match.setup,{state:i<60?'finished':'scheduled',now_on_court:false,match_num:1000+i});
   for(const key of ['court_id','location_id','umpire','service_judge','tabletoperators','preparation_call_timestamp'])delete match.setup[key];
   match.setup.teams.forEach((team,j)=>{team.players=team.players.slice(0,2);team.players.forEach((player,k)=>Object.assign(player,{btp_id:30000+i*4+j*2+k,firstname:k?'Alexandra-Johanna':'Christopher Konstantin Maximilian',lastname:'Müller-Schwennsen '+i,name:(k?'Alexandra-Johanna':'Christopher Konstantin Maximilian')+' Müller-Schwennsen '+i}));});
   if(i<60){match.network_score=[[21,15],[21,17]];match.team1_won=true;match.end_ts=Date.now()-i*1000;}
   else {delete match.network_score;delete match.team1_won;delete match.end_ts;}
   return match;
  });
  curt.courts.forEach(court=>{delete court.match_id;});ctournament.ui_show();
  const qa=window.__nameBatch={};
  qa.settle=()=>new Promise((resolve,reject)=>{let stable=0;const end=performance.now()+15000;const frame=()=>{if(performance.now()>end)return reject(new Error('Names did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  qa.reference=(${nativeReference.toString()});
 })()`);
 // Exercise every native name group, including distant lists that a browser
 // may otherwise omit until scrolling. Scroll behavior has its own check.
 await c.evaluate('document.querySelectorAll(\'.unassigned_container,.finished_container\').forEach(node=>node.style.contentVisibility=\'visible\');__nameBatch.settle()');
 await c.call('Performance.enable');
 const before=(await c.call('Performance.getMetrics')).metrics;
 await c.evaluate('document.fonts.dispatchEvent(new Event("loadingdone"));__nameBatch.settle()');
 const after=(await c.call('Performance.getMetrics')).metrics;
 const delta=name=>after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value;
 const measurement={layout_count:delta('LayoutCount'),style_count:delta('RecalcStyleCount'),layout_ms:1000*delta('LayoutDuration'),browser_work_ms:1000*delta('TaskDuration')};
 const samples=[];
 for(const [width,density]of [[1366,'compact'],[1920,'compact'],[1920,'normal']]) {
  await metrics(width,900);
  await c.evaluate(`(()=>{const button=document.querySelector('[data-action="density"]');for(let i=0;i<3&&document.querySelector('.leitstand').dataset.density!==${JSON.stringify(density)};i++)button.click();return __nameBatch.settle();})()`);
  const reference=await c.evaluate('__nameBatch.reference()');samples.push({width,density,reference});
  check('Batched labels and stacking match independent native measurements at '+width+' / '+density,reference.length>5&&reference.every(item=>item.stacked===item.shouldStack&&JSON.stringify(item.actual)===JSON.stringify(item.expected)));
  await c.evaluate('__nameBatch.settle()');
 }
 await c.evaluate(`(()=>{
  document.querySelectorAll('.team-one .player,.team-two .player').forEach((person,index)=>{
   const hint=document.createElement('div');hint.className=['court','tablet_inline','tabletoperator_waiting_inline'][index%3];hint.textContent=String(index%15+1);person.append(hint);cleitstand.player(person);
  });return __nameBatch.settle();})()`);
 for(const [width,density]of [[1920,'normal'],[1366,'compact'],[1920,'compact']]) {
  await metrics(width,900);
  await c.evaluate(`(()=>{const button=document.querySelector('[data-action="density"]');for(let i=0;i<3&&document.querySelector('.leitstand').dataset.density!==${JSON.stringify(density)};i++)button.click();return __nameBatch.settle();})()`);
  const reference=await c.evaluate('__nameBatch.reference()');samples.push({width,density,resources:true,reference});
  check('Resource hint labels and stacking match independent native measurements at '+width+' / '+density,reference.length>5&&reference.every(item=>item.stacked===item.shouldStack&&JSON.stringify(item.actual)===JSON.stringify(item.expected)));
 }
 check('No measurement copies remain after fitting',await c.evaluate('document.querySelectorAll(".ls-layout-probe").length===0'));
 check('Name measurement produces no browser exceptions',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
 const report={scope:'120 synthetic doubles matches, 60 finished and 60 unassigned. Font invalidation must batch native measurements; independent per-team native layout checks labels and stacking at compact desktop/notebook and normal density.',checks,measurement,samples};
 try {check('A global font invalidation uses at most 40 browser layouts for 220 visible teams',measurement.layout_count<=40);}
 finally {fs.writeFileSync(path.join(previews,'name-measurement-batch-verification.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({checks:checks.length,measurement}));
};

module.exports.nativeReference=nativeReference;
