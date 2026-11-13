'use strict';
/* eslint-disable no-console -- Isolated responsiveness and visibility regressions. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,previews}) {
 const checks=[],check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('OK '+name);};
 const instrument=require('./startup-check').instrumentation;
 await open(1366,900,{startup:true,beforeFixture:()=>c.evaluate('('+instrument.toString()+')()'),transformFixture:source=>source.replace('tournament:structuredClone(fixture)','tournament:__startup.make(fixture)')});
 await c.evaluate('__startup.ready');
 await c.evaluate(`(()=>{
  const qa=window.__listVisibility={receipts:[]};
  qa.settle=__startup.settle;
  const spacer=document.createElement('div');spacer.style.height='12000px';document.querySelector('.unassigned_container').before(spacer);
  qa.connection=conn(()=>{},message=>crouting.on_change(message));
  qa.receive=(ctype,val)=>qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype,tournament_key:curt.key,val})});
  qa.subscribe=btsAdminUpdates.subscribe(receipt=>qa.receipts.push({status:receipt.status,type:receipt.message.ctype,ms:receipt.timings.total_ms}));
 })();__listVisibility.settle()`);
 const ready=await c.evaluate('[...document.querySelectorAll(\'.unassigned_container,.finished_container\')].every(node=>getComputedStyle(node).contentVisibility===\'visible\')');
 check('Distant lists retain normal layout without delaying their first reveal',ready);
 const operations=await c.evaluate(`(async()=>{
  const upcoming=structuredClone(curt.matches.find(match=>match.setup.state==='scheduled')),finished=structuredClone(curt.matches.find(match=>match.setup.state==='finished'));
  for(const [match,name]of [[upcoming,'Johanna Fernliste'],[finished,'Frieda Ergebnisliste']])Object.assign(match.setup.teams[0].players[0],{firstname:name.split(' ')[0],lastname:name.split(' ')[1],name});
  __listVisibility.upcoming=upcoming;__listVisibility.finished=finished;
  __listVisibility.receive('match_edit',{match__id:upcoming._id,match:upcoming});
  __listVisibility.receive('match_edit',{match__id:finished._id,match:finished});
  const oncourt=curt.matches.find(match=>match.setup.now_on_court);__listVisibility.oncourt=oncourt._id;
  __listVisibility.receive('score',{match_id:oncourt._id,network_score:[[9,8]],presses:[],court_id:oncourt.setup.court_id,now_on_court:true});
  await __listVisibility.settle();await btsAdminUpdates.whenSettled();
  return{pending:btsAdminUpdates.stats().pending,receipts:__listVisibility.receipts,score:document.querySelector('tr[data-match_id="'+oncourt._id+'"] .match_score').textContent};
 })()`);
 check('Offscreen edits and the visible point finish without stale jobs',operations.pending===0&&operations.receipts.length===3&&operations.receipts.every(receipt=>receipt.status==='presented')&&operations.score==='9:8');
 const reveals=[];
 for(const kind of ['upcoming','finished']) {
  const value=await c.evaluate(`(async()=>{
   const qa=__listVisibility,match=qa.${kind},row=document.querySelector('tr[data-match_id="'+match._id+'"]'),start=performance.now();
   row.closest('.unassigned_container,.finished_container').scrollIntoView({block:'start'});await qa.settle();
   const elapsed=performance.now()-start,team=row.querySelector('.team-one'),player=team.querySelector('.player');
   return{kind:${JSON.stringify(kind)},ms:elapsed,visible:team.checkVisibility({contentVisibilityAuto:true}),name:player.dataset.lsFullName,label:player.firstChild.nodeValue,pending:btsAdminUpdates.stats().pending,stacked:team.classList.contains('ls-team-stacked')};
  })()`);reveals.push(value);
  check('Scrolling reveals the corrected '+kind+' name and completes fitting',value.visible&&value.name.includes(kind==='finished'?'Ergebnisliste':'Fernliste')&&value.label.includes(kind==='finished'?'Ergebnisliste':'Fernliste')&&!value.pending);
 }
 await c.evaluate('window.scrollTo(0,0);__listVisibility.settle()');
 await metrics(1920,900);
 await c.evaluate('(()=>{const button=document.querySelector(\'[data-action="density"]\');for(let i=0;i<3&&document.querySelector(\'.leitstand\').dataset.density!==\'normal\';i++)button.click();})()');
 await c.evaluate('__listVisibility.settle()');
 const resized=await c.evaluate('(async()=>{const match=__listVisibility.upcoming,row=document.querySelector(\'tr[data-match_id="\'+match._id+\'"]\');row.closest(\'.unassigned_container\').scrollIntoView({block:\'start\'});await __listVisibility.settle();return{visible:row.checkVisibility({contentVisibilityAuto:true}),pending:cleitstand.isUpdating()||ctournament.isUpdating(),name:row.querySelector(\'.player\').dataset.lsFullName};})()');
 check('Changing density and width offscreen produces a fitted view when revealed',resized.visible&&!resized.pending&&resized.name==='Johanna Fernliste');
 const number=await c.evaluate(`(async()=>{
  const form=document.createElement('form'),fieldset=document.createElement('fieldset');form.inert=true;document.querySelector('.main').append(form);form.append(fieldset);
  const input=document.createElement('input');input.type='number';input.value='2';fieldset.append(input);await new Promise(requestAnimationFrame);
  const wrap=input.closest('.number-input-wrap'),arrows=[...wrap.querySelectorAll('[data-step]')];
  fieldset.disabled=true;await new Promise(requestAnimationFrame);const fieldsetDisabled=arrows.every(button=>button.disabled);arrows[0].click();const blocked=input.value==='2';
  fieldset.disabled=false;input.readOnly=true;await new Promise(requestAnimationFrame);const readonly=arrows.every(button=>button.disabled);
  input.readOnly=false;form.inert=false;await new Promise(requestAnimationFrame);arrows[0].click();
  const result={value:input.value,arrows:arrows.length,wrappers:form.querySelectorAll('.number-input-wrap').length,fieldsetDisabled,blocked,readonly};form.remove();return result;
 })()`);
 check('Deferred forms retain exactly one functional number stepper',number.value==='3'&&number.arrows===2&&number.wrappers===1);
 check('Disabled fieldsets and readonly controls keep both arrows disabled',number.fieldsetDisabled&&number.blocked&&number.readonly);
 check('No uncaught browser errors',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
 await c.evaluate('__listVisibility.subscribe()');
 const report={checks,operations,reveals,resized,number};fs.writeFileSync(path.join(previews,'list-visibility-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
};
