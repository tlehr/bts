'use strict';
/* eslint-disable no-console -- Isolated browser regression checks. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const match=curt.matches.find(match=>match._id==='match-37');
  match.setup.umpire={btp_id:99001,name:'Alexander Maximilian Keo Boun Khoune',firstname:'Alexander Maximilian',surname:'Keo Boun Khoune',checked_in:true};
  ctournament.ui_show();
  const qa=window.__fixedColumns={rects:[],sourceRects:[],native:Element.prototype.getBoundingClientRect};
  qa.settle=()=>new Promise((resolve,reject)=>{let stable=0;const end=performance.now()+8000;const frame=()=>{if(performance.now()>end)return reject(new Error('Fixed columns did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.columns=()=>[...document.querySelectorAll('.leitstand .match_table:not(.ls-probe-context)')].map(table=>[...table.querySelectorAll('colgroup>col')].map(col=>col.getBoundingClientRect().width));
  qa.edit=async(change)=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-37'));change(match);crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});await qa.settle();};
  Element.prototype.getBoundingClientRect=function(...args){if(this.closest('.ls-layout-probe'))qa.rects.push(this.closest('tr')?.dataset.lsProbeMatch||this.closest('.ls-layout-probe')?.dataset.lsProbeMatch);else if(this.matches('.team-one,.team-two,td.umpire_and_tablet'))qa.sourceRects.push(this.className);return qa.native.apply(this,args)};
 })()`);
 const checks=[],check=(name,value)=>{assert(value,name);checks.push(name);console.log('OK '+name);};
 try {
  await c.evaluate('__fixedColumns.settle()');
  const initial=await c.evaluate('__fixedColumns.columns()');
  const counts=await c.evaluate('(async()=>{const qa=__fixedColumns;qa.rects=[];qa.sourceRects=[];cleitstand.refreshCounts();await qa.settle();return{rects:qa.rects,source:qa.sourceRects}})()');
  check('A counter refresh does not measure participant or official cells',counts.rects.length===0&&counts.source.length===0);
  const name=await c.evaluate('(async()=>{const qa=__fixedColumns;qa.rects=[];qa.sourceRects=[];await qa.edit(match=>{Object.assign(match.setup.umpire,{name:"Alexandra Neuer Nachname",firstname:"Alexandra",surname:"Neuer Nachname"})});return{columns:qa.columns(),full:document.querySelector(\'tr[data-match_id="match-37"] .umpire_and_tablet [data-ls-full-name]\').dataset.lsFullName,rects:qa.rects,source:qa.sourceRects}})()');
  check('A changed name retains every column width',JSON.stringify(name.columns)===JSON.stringify(initial));
  check('The changed official retains the complete accessible name',name.full==='Alexandra Neuer Nachname');
  check('A changed official only measures its own row and uses observed cell sizes',name.rects.every(id=>id==='match-37')&&name.source.length===0);
  const control=await c.evaluate('(async()=>{const qa=__fixedColumns;const button=document.querySelector(\'tr[data-match_id="match-37"] .umpire_and_tablet .match_second_call_button\')||document.querySelector(\'tr[data-match_id="match-37"] .umpire_and_tablet .match_second_preparation_call_button\');button.style.display="none";await qa.settle();return qa.columns()})()');
  check('Changing control visibility retains every column width',JSON.stringify(control)===JSON.stringify(initial));
  const player=await c.evaluate('(async()=>{const qa=__fixedColumns;qa.rects=[];qa.sourceRects=[];await qa.edit(match=>{Object.assign(match.setup.teams[0].players[0],{name:"Christopher Konstantin Maximilian Mustermann",firstname:"Christopher Konstantin Maximilian",lastname:"Mustermann"})});return{columns:qa.columns(),full:document.querySelector(\'tr[data-match_id="match-37"] .team-one .player\').dataset.lsFullName,source:qa.sourceRects}})()');
  check('A longer player name fits the existing columns without reading cell geometry',JSON.stringify(player.columns)===JSON.stringify(initial)&&player.full==='Christopher Konstantin Maximilian Mustermann'&&player.source.length===0);
  await c.call('Emulation.setDeviceMetricsOverride',{width:1200,height:1080,deviceScaleFactor:1,mobile:false});await c.evaluate('__fixedColumns.settle()');
  const narrow=await c.evaluate('__fixedColumns.columns()');
  check('A window resize changes responsive columns',JSON.stringify(narrow)!==JSON.stringify(initial));
  await c.call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await c.evaluate('__fixedColumns.settle()');
  check('Returning to the original width restores the column widths',JSON.stringify(await c.evaluate('__fixedColumns.columns()'))===JSON.stringify(initial));
  await c.evaluate('document.fonts.dispatchEvent(new Event("loadingdone"));__fixedColumns.settle()');
  check('Font invalidation drains without leaving measurement copies',await c.evaluate('!cleitstand.isUpdating()&&document.querySelectorAll(".ls-layout-probe").length===0'));
  const canvas=await c.evaluate(`(async()=>{
   const qa=__fixedColumns,match=structuredClone(curt.matches.find(match=>match._id==='match-53'));
   match._id='qa-plain-names';match.setup.now_on_court=false;match.setup.state='finished';match.team1_won=true;match.end_ts=Date.now();
   match.setup.teams[0].players=[{btp_id:88801,firstname:'Alexandra-Johanna Constantina',lastname:'Meyer',name:'Alexandra-Johanna Constantina Meyer'},{btp_id:88802,firstname:'Maximilian-Theodor',lastname:'Zhang',name:'Maximilian-Theodor Zhang'}];
   delete match.setup.umpire;delete match.setup.service_judge;delete match.setup.tabletoperators;
   curt.matches.push(match);cmatch.add_match(match,'finished');await qa.settle();
   const container=document.querySelector('tr[data-match_id="qa-plain-names"] .team-one'),labels=[...container.querySelectorAll('.player')].map(node=>node.firstChild.nodeValue.replaceAll(String.fromCharCode(160),' ')),stages=cleitstand.nameStages(match.setup.teams[0].players),width=container.clientWidth;
   const probe=container.cloneNode(true);probe.classList.add('ls-layout-probe','ls-name-measuring');
   for(const node of probe.querySelectorAll('[data-match_id]'))node.removeAttribute('data-match_id');container.parentElement.append(probe);
   const targets=[...probe.querySelectorAll('.player')],range=document.createRange();range.selectNodeContents(probe);
   let expected=stages.at(-1);const widths=[];
   try{for(const stage of stages){targets.forEach((node,index)=>node.firstChild.nodeValue=stage[index].replace(' ',String.fromCharCode(160)));const measured=range.getBoundingClientRect().width;widths.push(measured);if(measured<=width+.25){expected=stage;break;}}}finally{probe.remove();}
   return{labels,expected,width,widths,plain:[...container.querySelectorAll('.player')].every(node=>node.children.length===0)};
  })()`);
  check('Canvas chooses the same plain-name abbreviations as independent native layout',canvas.plain&&JSON.stringify(canvas.labels)===JSON.stringify(canvas.expected));

  const finish=await c.evaluate(`(async()=>{
   const qa=__fixedColumns,template=structuredClone(curt.matches.find(match=>match._id==='match-53'));
   for(let i=0;i<60;i++){
    const match=structuredClone(template);match._id='column-history-'+i;match.setup.match_num=1000+i;
    Object.assign(match.setup,{state:'finished',now_on_court:false});delete match.shuttle_count;
    match.network_score=[[21,15],[21,17]];match.team1_won=true;match.btp_winner=1;match.end_ts=Date.now()-i*60000;
    curt.matches.push(match);cmatch.add_match(match,'finished');
   }
   await qa.settle();
   qa.reference=document.querySelector('tr[data-match_id="column-history-0"] .team-one');
   qa.nameWidth=()=>qa.reference.getBoundingClientRect().width;
   const before=qa.nameWidth(),match=curt.matches.find(match=>match._id==='match-44');
   crouting.on_change({ctype:'score',tournament_key:curt.key,val:{match_id:match._id,network_score:[[21,15],[21,17]],presses:[],team1_won:true,court_id:match.setup.court_id,now_on_court:false,end_ts:Date.now()}});
   const during=qa.nameWidth(),table=qa.reference.closest('table'),row=table.querySelector('tr[data-match_id="match-44"]');
   const schema=table.querySelectorAll('colgroup>col').length===row.cells.length;
   await qa.settle();return{before,during,after:qa.nameWidth(),schema};
  })()`);
  check('Finishing a game without shuttle counts never adds an implicit table column before sorting',finish.schema&&Math.abs(finish.before-finish.during)<.25&&Math.abs(finish.before-finish.after)<.25);
  const shuttles=await c.evaluate(`(async()=>{
   const qa=__fixedColumns,match=structuredClone(curt.matches.find(match=>match._id==='match-37'));
   Object.assign(match.setup,{state:'finished',now_on_court:false});match.shuttle_count=5;match.network_score=[[21,15],[21,17]];match.team1_won=true;match.btp_winner=1;match.end_ts=Date.now();
   crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
   const table=qa.reference.closest('table'),during=qa.nameWidth(),column=!!table.querySelector('.ls-shuttle-column');
   const schema=[...table.querySelectorAll('tr[data-match_id]')].every(row=>row.cells.length===table.querySelectorAll('colgroup>col').length);
   await qa.settle();return{column,schema,during,after:qa.nameWidth()};
  })()`);
  check('The first counted shuttles create the explicit column and matching cells before layout',shuttles.column&&shuttles.schema&&Math.abs(shuttles.during-shuttles.after)<.25);
  const existing=await c.evaluate(`(async()=>{
   const qa=__fixedColumns,before=qa.nameWidth(),match=structuredClone(curt.matches.find(match=>match._id==='match-40'));
   Object.assign(match.setup,{state:'finished',now_on_court:false});delete match.shuttle_count;match.network_score=[[21,15],[21,17]];match.team1_won=true;match.btp_winner=1;match.end_ts=Date.now();
   crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
   const during=qa.nameWidth();await qa.settle();return{before,during,after:qa.nameWidth()};
  })()`);
  check('Further results preserve a visible shuttle column without changing name widths',Math.abs(existing.before-existing.during)<.25&&Math.abs(existing.before-existing.after)<.25);
  check('Finished history cannot gain an inner vertical scrollbar from changing name glyphs',await c.evaluate(`getComputedStyle(__fixedColumns.reference.closest('.table-wrap')).overflowY==='hidden'`));
  check('The full final visible result remains inside the history frame',await c.evaluate(`(()=>{const wrap=__fixedColumns.reference.closest('.table-wrap'),bottom=wrap.getBoundingClientRect().top+wrap.clientTop+wrap.clientHeight;return [...wrap.querySelectorAll('tr[data-match_id]')].filter(row=>row.getBoundingClientRect().height).at(-1).getBoundingClientRect().bottom<=bottom+.5})()`));
  check('Fixed columns introduce no browser exceptions',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
  fs.writeFileSync(path.join(previews,'fixed-columns-verification.json'),JSON.stringify({scope:'Isolated fixture; changed player/official names and controls must retain columns, while resizing must update them. Counts of actual source-cell geometry reads.',checks},null,2)+'\n');
 } finally {await c.evaluate('Element.prototype.getBoundingClientRect=__fixedColumns.native');}
};
