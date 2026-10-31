'use strict';
const fs=require('fs'),path=require('path');
module.exports=async function({c,check,click,open,metrics,previews,capture}) {
 const checks=[],samples=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const match=curt.matches.find(match=>match._id==='match-44'),presses=[],now=Date.now();match.setup.is_doubles=false;match.setup.match_name='13/16';
  const add=(type,extra={})=>presses.push({type,timestamp:now+presses.length*100,...extra});
  const state=()=>calc.remote_state({settings:{negative_timers:true},lang:'de'},match.setup,presses);
  add('pick_side',{team1_left:true});add('love-all');
  const scores=[[17,21],[21,17],[10,11]];
  for(const[set,points]of scores.entries()){
   for(let point=0;point<Math.max(...points);point++)for(let team=0;team<2;team++)if(point<points[team])add('score',{side:state().game.team1_left===(team===0)?'left':'right'});
   if(set<scores.length-1){add('postgame-confirm');add('love-all');}
  }
  const shift=20000+(presses.length-1)*100;presses.forEach(press=>press.timestamp-=shift);match.presses=presses;match.network_score=scores;
  const officials=curt.matches.find(match=>match._id==='match-37');officials.setup.match_name='Finale';officials.setup.umpire={btp_id:99001,name:'Alexander Maximilian Anderson',checked_in:true};officials.setup.service_judge={btp_id:99002,name:'Bertha Alexandra Baller',checked_in:true};
  const finished=structuredClone(match);finished._id='compact-finished';finished.presses=[];finished.network_score=[[21,17],[21,15]];finished.team1_won=true;finished.btp_winner=1;finished.end_ts=now;finished.setup={...finished.setup,state:'finished',now_on_court:false,match_num:900,tabletoperators:[]};curt.matches.push(finished);
  for(const num of [14,15]) {
   const court={_id:'SN_'+num,num:String(num),location_id:'SN',is_active:true,match_id:'compact-court-'+num},game=structuredClone(match);
   game._id=court.match_id;game.presses=[];game.network_score=[[21,19],[19,21],[9,11]];game.setup={...game.setup,match_num:900+num,court_id:court._id,location_id:'SN'};
   curt.courts.push(court);curt.matches.push(game);
  }
  ctournament.ui_show();
  const qa=window.__compactQA={};
  qa.lastMatch=structuredClone(curt.matches.find(match=>match._id==='compact-court-15'));
  qa.lastState=kind=>{
   const match=structuredClone(qa.lastMatch);
   if(kind==='pause'){match.network_score=[[17,21],[21,17],[10,11]];match.presses=structuredClone(curt.matches.find(match=>match._id==='match-44').presses);}
   if(kind==='warmup'){match.network_score=[[0,0]];match.setup.warmup='call-up';}
   crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});
  };
  const speechStates=['ready','preparing','checking','failed','locked','audio_error','unavailable','browser'];
  qa.bells=[...document.querySelectorAll('.match_table :is(.match_second_call_button,.match_second_preparation_call_button)')];
  // Readiness is stubbed in the isolated fixture: render the actual badge
  // states explicitly so geometry checks include the pseudo-elements too.
  qa.bells.forEach((button,index)=>button.dataset.speechState=speechStates[index%speechStates.length]);
  qa.geometry=()=>[...document.querySelectorAll('tr.ls-match')].filter(row=>getComputedStyle(row).display!=='none').map(row=>{
   const planned=!!row.closest('.unassigned_container'),box=row.getBoundingClientRect(),reference=row.querySelector(planned?'.player':'.ls-set-score>span'),r=reference?.getBoundingClientRect();
   const visible=node=>{const s=getComputedStyle(node);return s.visibility!=='hidden'&&s.display!=='none'&&node.getBoundingClientRect().width>0;};
   const selectors='.timer,.ls-icon-action,.preparation_debug_icon,.ls-match-open,.ls-role-icon,.court_num,.court_history,.ico,.match_confirm_button';
   const controls=[...row.querySelectorAll(selectors)].filter(visible).map(node=>{const b=node.getBoundingClientRect();return{class:node.className.baseVal??node.className,height:b.height,top:b.top-box.top,bottom:box.bottom-b.bottom};});
   for(const node of [...row.querySelectorAll('[data-speech-state]')].filter(visible)){
    const badge=getComputedStyle(node,'::after');if(badge.content==='none')continue;
    const height=parseFloat(badge.height)+(badge.boxSizing==='border-box'?0:parseFloat(badge.borderTopWidth)+parseFloat(badge.borderBottomWidth)),top=node.getBoundingClientRect().top+parseFloat(badge.top);
    controls.push({class:node.className+'::after',height,top:top-box.top,bottom:box.bottom-top-height});
   }
   return{id:row.dataset.match_id,planned,height:box.height,reference:r?.height,top:r?.top-box.top,bottom:r?box.bottom-r.bottom:null,controls};
  });
  qa.baseline=qa.geometry();qa.rows=[...document.querySelectorAll('tr.ls-match')];qa.people=qa.rows.flatMap(row=>[...row.querySelectorAll('.player,.umpire_and_tablet .name')]);qa.texts=qa.people.map(node=>node.firstChild);
  qa.same=()=>qa.rows.every(row=>row.isConnected)&&qa.people.every((node,index)=>node.isConnected&&node.firstChild===qa.texts[index])&&qa.bells.every(button=>button.isConnected);
 })()`);
 await verify('Normal baseline includes running, pending, prepared and finished games',`__compactQA.baseline.some(row=>row.id==='compact-finished')&&!!document.querySelector('tr[data-match_id="match-44"] .timer')&&!!document.querySelector('tr[data-match_id="match-37"] .service_judge')`);
 await click('.board-toolbar-actions [data-action="density"]');await click('.board-toolbar-actions [data-action="density"]');
 for(const width of [2560,1920,1536,390]) {
  await metrics(width,width===390?844:1080);
  await verify('Compact mode is selected at '+width,`document.querySelector('.leitstand').dataset.density==='compact'&&__compactQA.same()`);
  const geometry=await c.evaluate('__compactQA.geometry()');samples.push({width,geometry});
  const scrolling=await c.evaluate(`(()=>{const wrap=document.querySelector('.courts_container .table-wrap'),table=wrap.querySelector('table');return{height:wrap.clientHeight,scrollHeight:wrap.scrollHeight,width:wrap.clientWidth,scrollWidth:wrap.scrollWidth,tableHeight:table.getBoundingClientRect().height};})()`);samples[samples.length-1].scrolling=scrolling;console.log(JSON.stringify({width,scrolling}));
  await verify('Fifteen current courts need no inner vertical scrollbar at '+width,String(scrolling.scrollHeight===scrolling.height));
  await verify('The court table grows to all rows and still scrolls horizontally when needed at '+width,String(scrolling.height>=scrolling.tableHeight-.5&&(width!==390||scrolling.scrollWidth>scrolling.width)));
  const outliers=geometry.filter(row=>row.reference&&(Math.abs(row.top-2)>.15||Math.abs(row.bottom-2)>.15||row.controls.some(control=>control.height>row.reference+.15||control.top<1.85||control.bottom<1.85)));
  console.log(JSON.stringify({width,rowHeights:[...new Set(geometry.map(row=>row.height))],outliers}));
  await verify('Current and finished rows have exactly 2px above and below the score at '+width,String(geometry.filter(row=>!row.planned&&row.reference).every(row=>Math.abs(row.top-2)<.15&&Math.abs(row.bottom-2)<.15&&Math.abs(row.height-row.reference-4)<.15)));
  await verify('Planned rows have exactly 2px above and below the player status at '+width,String(geometry.filter(row=>row.planned&&row.reference).every(row=>Math.abs(row.top-2)<.15&&Math.abs(row.bottom-2)<.15&&Math.abs(row.height-row.reference-4)<.15)));
  await verify('Clocks, actions, role icons and court graphics never exceed their row reference at '+width,String(geometry.filter(row=>row.reference).every(row=>row.controls.every(control=>control.height<=row.reference+.15&&control.top>=1.85&&control.bottom>=1.85))));
  await verify('Bells sit at the bottom of their unchanged click targets at '+width,`(()=>{const buttons=[...document.querySelectorAll('.match_table :is(.match_second_call_button,.match_second_preparation_call_button)')].filter(button=>button.getBoundingClientRect().width>0);return buttons.length>0&&buttons.every(button=>{const icon=button.querySelector('.ico').getBoundingClientRect(),target=button.getBoundingClientRect();return Math.abs(icon.bottom-target.bottom)<.15&&target.height===parseFloat(getComputedStyle(button).getPropertyValue('--compact-row-content'));});})()`);
  await verify('Speech badges for player, tablet and official bells stay inside the row at '+width,String(geometry.some(row=>row.controls.some(control=>control.class.includes('match_second')&&control.class.endsWith('::after')))&&geometry.every(row=>row.controls.filter(control=>control.class.endsWith('::after')).every(control=>control.top>=1.85&&control.bottom>=1.85))));
  await verify('Court backgrounds fill the reference height without distortion and keep the tablet number style at '+width,`(()=>{const tablet=getComputedStyle(document.querySelector('.tabletoperators_table .court_history'));return [...document.querySelectorAll('.match_table .court_number :is(.court_num,.court_history)')].every(node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect(),range=document.createRange(),reference=parseFloat(style.getPropertyValue('--compact-row-content'));range.selectNodeContents(node);return style.backgroundImage===tablet.backgroundImage&&style.backgroundSize===tablet.backgroundSize&&style.fontWeight===tablet.fontWeight&&style.webkitTextStrokeWidth===tablet.webkitTextStrokeWidth&&style.textShadow===tablet.textShadow&&Math.abs(box.height-reference)<.15&&Math.abs(box.width/box.height-17/12)<.02&&Math.abs(parseFloat(style.fontSize)-Math.min(parseFloat(tablet.fontSize),reference*5/6))<.02&&range.getBoundingClientRect().width<=box.width;});})()`);
  await verify('Several officials share one line without overlapping at '+width,`(()=>{const cell=document.querySelector('tr[data-match_id="match-37"] .umpire_and_tablet'),bounds=cell.getBoundingClientRect(),people=[...cell.children].map(node=>node.getBoundingClientRect());return people.length===3&&people.every((person,index)=>person.left>=bounds.left&&person.right<=bounds.right+.15&&(!index||person.left>=people[index-1].right-.15));})()`);
  await verify('Finale and 13/16 remain fully visible at '+width,`['match-37','match-44'].every(id=>{const cell=document.querySelector('tr[data-match_id="'+id+'"] .match_round');return cell.scrollWidth<=cell.clientWidth;})`);
  for(const kind of ['pause','warmup']){
   await c.evaluate(`__compactQA.lastState(${JSON.stringify(kind)})`);
   await verify('The last court displays its '+kind+' clock at '+width,`!!document.querySelector('tr[data-match_id="compact-court-15"] .timer:not([style*="display: none"])')`);
   await verify('A '+kind+' clock in the last row adds no vertical scrolling at '+width,`(()=>{const wrap=document.querySelector('.courts_container .table-wrap'),row=document.querySelector('tr[data-match_id="compact-court-15"]');return !!row.querySelector('.timer:not([style*="display: none"])')&&wrap.scrollHeight===wrap.clientHeight&&__compactQA.same();})()`);
  }
  await c.evaluate(`__compactQA.lastState('score')`);
  await verify('Returning the last row to a score retains its objects and scroll height at '+width,`(()=>{const wrap=document.querySelector('.courts_container .table-wrap');return wrap.scrollHeight===wrap.clientHeight&&__compactQA.same();})()`);
  if(width===1920)await capture('kompakt');
  if(width===390){
   await c.evaluate("document.querySelector('.courts_container').scrollIntoView({block:'start'});window.scrollBy(0,-document.querySelector('.leitstand-header').getBoundingClientRect().height-8)");
   const shot=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(previews,'kompakt-mobil.png'),Buffer.from(shot.data,'base64'));
  }
 }
 await metrics(1920,1080);
 await verify('The compact final-set timer remains in its existing action cell',`!!document.querySelector('tr[data-match_id="match-44"] td.call_td>.match_timer .timer')&&__compactQA.same()`);
 await c.evaluate(`(()=>{const match=curt.matches.find(match=>match._id==='match-44');crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:match._id,network_score:[[17,21],[21,17],[12,13]],presses:[],court_id:match.setup.court_id,now_on_court:true}});})()`);
 await verify('Live point updates retain the same compact rows and player objects','__compactQA.same()');
 await verify('Changing the score and removing its clock keeps the compact height','__compactQA.geometry().filter(row=>row.id===\'match-44\').every(row=>Math.abs(row.top-2)<.15&&Math.abs(row.bottom-2)<.15&&Math.abs(row.height-row.reference-4)<.15)');
 await click('.board-toolbar-actions [data-action="density"]');
 await verify('Returning to Normal restores the original sizes','__compactQA.geometry().every(row=>{const before=__compactQA.baseline.find(before=>before.id===row.id);return Math.abs(row.height-before.height)<.15;})&&__compactQA.same()');
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');await verify('Compact layout updates produce no browser exceptions',String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'compact-density-verification.json'),JSON.stringify({date:'2026-10-31',checks,exceptions:exceptions.length,samples},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
