'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
module.exports=async function({c,open,metrics,previews}) {
 await open(1424,1080);
 await c.evaluate(`(()=>{
  const person=(firstname,surname,btp_id)=>({firstname,surname,name:firstname+' '+surname,btp_id,checked_in:true,check_in_per_match:true});
  for(const [id,update] of [['match-45',m=>{m.setup.teams[0].players=[person('Alexander Maximilian','Weber',99101),person('Nina Maria','Hansen',99102)];}],['match-47',m=>{m.setup.umpire=person('Alexander Maximilian','Keo Boun Khoune',99103);}]]) {
   const m=structuredClone(curt.matches.find(m=>m._id===id));update(m);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:id,match:m}});
  }
  window.__cacheSettle=()=>new Promise((resolve,reject)=>{const start=performance.now();let clear=0;const poll=()=>{if(performance.now()-start>4000){reject(new Error('Layout did not settle'));return;}clear=cleitstand.isUpdating()||ctournament.isUpdating()?0:clear+1;if(clear>=3)resolve();else requestAnimationFrame(poll);};requestAnimationFrame(poll);});
 })()`);
 await c.evaluate('__cacheSettle()');
 await c.evaluate(`(()=>{
  const qa=window.__cacheQA={counts:{},samples:[],team:document.querySelector('tr[data-match_id="match-45"] .team-one')};
  qa.liveNames=new MutationObserver(()=>{});qa.liveNames.observe(qa.team,{subtree:true,characterData:true});
  qa.reset=()=>{qa.liveNames.takeRecords();qa.counts={canvas:0,timerRects:0,preparationRects:0,nameRanges:0,officialRanges:0,officialIntrinsic:0,nameGroupContains:0,officialCells:{}};};qa.reset();
  qa.native={canvas:CanvasRenderingContext2D.prototype.measureText,rect:Element.prototype.getBoundingClientRect,range:Range.prototype.getBoundingClientRect,contains:Element.prototype.contains};
  CanvasRenderingContext2D.prototype.measureText=function(...args){qa.counts.canvas++;return qa.native.canvas.apply(this,args);};
  Element.prototype.getBoundingClientRect=function(...args){if(this===qa.clock?.querySelector('.timer-value'))qa.counts.timerRects++;if(this.classList.contains('ls-preparation-calls'))qa.counts.preparationRects++;if(this.parentElement?.classList.contains('umpire_and_tablet')){const id=this.parentElement.dataset.lsProbeMatch||this.closest('tr').dataset.match_id;qa.counts.officialCells[id]=(qa.counts.officialCells[id]||0)+1;}return qa.native.rect.apply(this,args);};
  Element.prototype.contains=function(...args){if(this.classList.contains('team-one')||this.classList.contains('team-two'))qa.counts.nameGroupContains++;return qa.native.contains.apply(this,args);};
  Range.prototype.getBoundingClientRect=function(...args){const node=this.commonAncestorContainer;if(node===qa.team||node.nodeType===1&&node.matches('.ls-layout-probe.team-one')&&node.dataset.lsProbeMatch===qa.team.closest('tr').dataset.match_id)qa.counts.nameRanges++;if(node.nodeType===1&&node.closest('.umpire_and_tablet'))qa.counts.officialRanges++;if(node.nodeType===1&&node.classList.contains('ls-officials-heading'))qa.counts.officialIntrinsic++;return qa.native.range.apply(this,args);};
  qa.snapshot=label=>{const value={label,...qa.counts,liveNameWrites:qa.liveNames.takeRecords().length};qa.samples.push(value);return value;};
  const host=document.querySelector('[data-board-card="automation"]');qa.clock=document.createElement('span');qa.clock.className='timer';host.append(qa.clock);cleitstand.timerDisplay(qa.clock,'-222:22:22');
 })()`);
 const checks=[];
 const check=(name,value)=>{assert(value,name);checks.push(name);};
 try {
  await c.evaluate('__cacheSettle()');
  const ticks=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.reset();const time=qa.clock.querySelector('.timer-value'),before=time.style.cssText;for(const value of ['-222:22:21','-222:22:20','-222:22:29']){cleitstand.timerDisplay(qa.clock,value);await __cacheSettle();}return{...qa.snapshot('same clock form'),sameStyle:before===time.style.cssText,text:qa.clock.getAttribute('aria-label')};})()`);
  check('Digit changes preserve the fitting without Canvas measurements',ticks.canvas===0&&ticks.sameStyle&&ticks.text==='-222:22:29');
  check('Digit changes need no clock geometry reads',ticks.timerRects===0);
  const form=await c.evaluate(`(async()=>{__cacheQA.reset();cleitstand.timerDisplay(__cacheQA.clock,'-2222:22:22');await __cacheSettle();return __cacheQA.snapshot('extra clock digit');})()`);
  check('An extra digit measures a new fitting',form.canvas>0);
  const one=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.reset();qa.normal=parseFloat(getComputedStyle(qa.clock.querySelector('.timer-digits')).fontSize);cleitstand.timerDisplay(qa.clock,'-1222:22:22');await __cacheSettle();return{...qa.snapshot('leading one'),larger:parseFloat(getComputedStyle(qa.clock.querySelector('.timer-digits')).fontSize)>qa.normal};})()`);
  check('The leading-one exception remains a separate, larger fitting',one.canvas>0&&one.larger);
  const reused=await c.evaluate(`(async()=>{__cacheQA.reset();cleitstand.timerDisplay(__cacheQA.clock,'-2222:22:23');await __cacheSettle();return __cacheQA.snapshot('reused clock form');})()`);
  check('A previously measured clock form reuses its fitting',reused.canvas===0);
  const unsigned=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.reset();cleitstand.timerDisplay(qa.clock,'2222:22:23');await __cacheSettle();return{...qa.snapshot('unsigned clock'),sign:getComputedStyle(qa.clock.querySelector('.timer-sign')).display};})()`);
  check('Changing sign recalculates and releases the minus slot',unsigned.canvas>0&&unsigned.sign==='none');
  const shared=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.other=document.createElement('span');qa.other.className='timer';qa.clock.after(qa.other);qa.reset();cleitstand.timerDisplay(qa.other,'2222:22:29');await __cacheSettle();return{...qa.snapshot('shared clock fitting'),same:qa.other.querySelector('.timer-value').style.cssText===qa.clock.querySelector('.timer-value').style.cssText};})()`);
  check('Other clocks with the same font and space share the fitting',shared.canvas===0&&shared.same);
  const resized=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.beforeFont=parseFloat(getComputedStyle(qa.clock.querySelector('.timer-digits')).fontSize);qa.reset();qa.clock.style.width='70px';await __cacheSettle();return{...qa.snapshot('resized clock'),smaller:parseFloat(getComputedStyle(qa.clock.querySelector('.timer-digits')).fontSize)<qa.beforeFont};})()`);
  check('A changed available width fits from its resize observation without forcing geometry reads',resized.canvas>0&&resized.timerRects===0&&resized.smaller);
  const status=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.player=qa.team.querySelector('.player');qa.name=qa.player.firstChild;qa.reset();const m=curt.matches.find(m=>m._id==='match-45'),setup=structuredClone(m.setup);setup.teams[0].players[0].checked_in=false;crouting.on_change({ctype:'update_player_status',tournament_key:'preview',val:{match__id:m._id,setup}});await __cacheSettle();return{...qa.snapshot('check-in color change'),same:qa.player===qa.team.querySelector('.player')&&qa.name===qa.player.firstChild,changed:qa.player.classList.contains('not_checked_in')};})()`);
  check('A player update finds its existing name group without testing every team container',status.nameGroupContains===0);
  check('A check-in updates the existing player without measuring the same name',status.same&&status.changed&&status.nameRanges===0);
  const counts=await c.evaluate(`(async()=>{__cacheQA.reset();cleitstand.refreshCounts();await __cacheSettle();return __cacheQA.snapshot('unchanged table refresh');})()`);
  check('An unchanged list refresh reuses the player name fitting',counts.nameRanges===0);
  check('An unchanged list refresh reuses intrinsic official widths',counts.officialRanges===0&&counts.officialIntrinsic===0);
  check('An unchanged list refresh reuses preparation control widths',counts.preparationRects===0);
  const preparation=await c.evaluate(`(async()=>{const qa=__cacheQA,label=document.querySelector('.ls-preparation-calls .ls-call-location'),original=label.textContent;qa.reset();label.textContent='Sehr lange Hallenbezeichnung';cleitstand.refreshUnassigned(document.querySelector('.unassigned_container'));await __cacheSettle();const result=qa.snapshot('changed preparation label');label.textContent=original;cleitstand.refreshUnassigned(document.querySelector('.unassigned_container'));await __cacheSettle();return result;})()`);
  check('A changed hall label invalidates its preparation control width',preparation.preparationRects>0);
  const nearby=await c.evaluate(`(async()=>{const qa=__cacheQA,before=qa.team.textContent;qa.reset();qa.team.style.width=(qa.team.clientWidth-1)+'px';await __cacheSettle();const result={...qa.snapshot('new width with known name stages'),same:qa.team.textContent===before};qa.team.style.width='';await __cacheSettle();return result;})()`);
  check('A new available width selects known name stages without measuring their text again',nearby.same&&nearby.nameRanges===0);
  const controls=await c.evaluate(`(async()=>{const qa=__cacheQA,control=document.querySelector('tr[data-match_id="match-47"] .umpire_and_tablet .match_second_preparation_call_button'),display=control.style.display;qa.reset();control.style.display='none';cleitstand.refreshCounts();await __cacheSettle();const result=qa.snapshot('official control spacing changed');control.style.display=display;cleitstand.refreshCounts();await __cacheSettle();return result;})()`);
  check('Changed official controls measure only their own cell while retaining the header and player widths',Object.keys(controls.officialCells).length===1&&controls.officialCells['match-47']>0&&controls.officialIntrinsic===0&&controls.nameRanges===0);
  const resource=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.reset();const m=curt.matches.find(m=>m._id==='match-45'),setup=structuredClone(m.setup);setup.teams[0].players[0].now_playing_on_court='CH_5';crouting.on_change({ctype:'update_player_status',tournament_key:'preview',val:{match__id:m._id,setup}});await __cacheSettle();return{...qa.snapshot('new court badge'),badge:!!qa.player.querySelector('.court')};})()`);
  check('A new court badge invalidates the affected name fitting',resource.nameRanges>0&&resource.badge);
  await c.evaluate('__cacheQA.reset()');await metrics(1200,1080);await c.evaluate('__cacheSettle()');
  const narrower=await c.evaluate('__cacheQA.snapshot("narrower window")');
  check('Changed column widths recalculate the affected names',narrower.nameRanges>0);
  check('A window resize retains cached intrinsic official widths',narrower.officialIntrinsic===0);
  await c.evaluate('__cacheQA.reset()');await metrics(1424,1080);await c.evaluate('__cacheSettle()');
  const restored=await c.evaluate('__cacheQA.snapshot("restored window")');
  check('Returning to a known width reuses the name fitting',restored.nameRanges===0);
  const fonts=await c.evaluate(`(async()=>{__cacheQA.reset();document.fonts.dispatchEvent(new Event('loadingdone'));await __cacheSettle();return __cacheQA.snapshot('font metrics changed');})()`);
  check('Font changes invalidate clock fitting while reusing observed geometry',fonts.canvas>0&&fonts.timerRects===0);
  check('Font changes invalidate name and official measurements',fonts.nameRanges>0&&fonts.officialRanges>0&&fonts.officialIntrinsic>0);
  check('Font changes invalidate preparation control widths',fonts.preparationRects>0);
  check('Trial abbreviation stages never rewrite a visible name when the final fitting is unchanged',fonts.liveNameWrites===0);
  check('Layout measurement leaves no hidden duplicate controls or participant bindings',await c.evaluate(`document.querySelectorAll('.ls-layout-probe').length===0`));
  const official=await c.evaluate(`(async()=>{const qa=__cacheQA,m=structuredClone(curt.matches.find(m=>m._id==='match-47'));m.setup.umpire.name='Alexander Maximilian Anderer Nachname';m.setup.umpire.surname='Anderer Nachname';qa.reset();crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:m._id,match:m}});await __cacheSettle();return qa.snapshot('one official changed');})()`);
  check('Changing one official measures only that cell and retains the other intrinsic widths',Object.keys(official.officialCells).length===1&&official.officialCells['match-47']>0&&official.officialIntrinsic===0);
  const replacement=await c.evaluate(`(async()=>{const qa=__cacheQA,m=structuredClone(curt.matches.find(m=>m._id==='match-45'));m.setup.teams[0].players[0].name='Christopher Konstantin Maximilian Mustermann';m.setup.teams[0].players[0].firstname='Christopher Konstantin Maximilian';m.setup.teams[0].players[0].surname='Mustermann';crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:m._id,match:m}});qa.team=document.querySelector('tr[data-match_id="match-45"] .team-one');qa.reset();await __cacheSettle();return{...qa.snapshot('changed pairing'),full:qa.team.querySelector('.player').dataset.lsFullName};})()`);
  check('Changed pairing names invalidate the old result',replacement.nameRanges>0&&replacement.full==='Christopher Konstantin Maximilian Mustermann');
  const visibility=await c.evaluate(`(async()=>{const qa=__cacheQA;qa.originalClock=curt.test_clock;const now=Date.now();curt.test_clock={mode:'fixed',fixed_ts:now};qa.expiry=cmatch.create_timer({settings:{negative_timers:false},timer:{start:now,duration:10000,upwards:false}},qa.team.querySelector('.player'),'#fff','#fff');await __cacheSettle();qa.reset();curt.test_clock={mode:'fixed',fixed_ts:now+20000};await new Promise(resolve=>setTimeout(resolve,1200));await __cacheSettle();return{...qa.snapshot('native clock hidden'),hidden:qa.expiry.element.style.display==='none'};})()`);
  check('A native pause timer ending frees name space and invalidates that fitting',visibility.hidden&&visibility.nameRanges>0);
  const report={scope:'Isolierter Browser, synthetische Paarungen. Direkte Zählung von Canvas-, Geometrie- und Range-Messungen; keine Verbindung zu laufenden Diensten.',checks,samples:await c.evaluate('__cacheQA.samples')};
  fs.writeFileSync(path.join(previews,'layout-cache-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,samples:report.samples},null,2));
 } catch(error) {
  console.log(JSON.stringify({completed:checks,samples:await c.evaluate('__cacheQA.samples')},null,2));throw error;
 } finally {
  await c.evaluate(`(()=>{const qa=__cacheQA;qa.liveNames.disconnect();CanvasRenderingContext2D.prototype.measureText=qa.native.canvas;Element.prototype.getBoundingClientRect=qa.native.rect;Range.prototype.getBoundingClientRect=qa.native.range;Element.prototype.contains=qa.native.contains;qa.expiry?.stop();qa.expiry?.element.remove();if('originalClock'in qa)curt.test_clock=qa.originalClock;qa.clock.remove();qa.other?.remove();})()`);
 }
};
