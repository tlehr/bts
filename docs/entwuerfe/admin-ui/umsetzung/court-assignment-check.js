'use strict';
/* eslint no-console: off */
const fs=require('fs'),path=require('path');

module.exports=async function({c,check,click,open,metrics,previews}) {
 const checks=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const now=Date.now();let next=10000;
  const person=(checked=true)=>({btp_id:next++,name:'Assignment Player '+next,checked_in:checked,check_in_per_match:true});
  const template=curt.matches.find(match=>match._id==='match-44');
  const game=(id,minutes=0,ready=true)=>{
   const match=structuredClone(template);match._id=id;match.presses=[];match.network_score=[];
   match.setup={...match.setup,is_doubles:false,state:minutes?'preparation':'scheduled',now_on_court:false,court_id:null,
    preparation_call_timestamp:minutes?now-minutes*60000:undefined,match_num:next++,scheduled_date:'2026-11-01',scheduled_time_str:'09:00',
    teams:[{players:[person()]},{players:[person(ready)]}],tabletoperators:[]};return match;
  };
  const readyOld=game('ready-old',5),readyNew=game('ready-new',1),otherOld=game('other-old',10,false),otherNew=game('other-new',2,false);
  const official=game('other-official',9);official.setup.umpire=person(false);
  const tablet=game('other-tablet',8);tablet.setup.tabletoperators=[person(false)];
  const early=game('scheduled-early'),tieFirst=game('scheduled-tie-first'),tieSecond=game('scheduled-tie-second'),late=game('scheduled-late');
  early.setup.scheduled_date='2026-10-31';late.setup.scheduled_time_str='10:00';
  tieFirst.match_order=10;tieFirst.setup.match_num=99;tieSecond.match_order=20;tieSecond.setup.match_num=1;
  const playing=game('busy-player',30),operating=game('busy-tablet',31),queued=game('busy-queue',32),unknown=game('unknown'),partial=game('partial-double');
  playing.setup.teams[0].players=[structuredClone(template.setup.teams[0].players[0])];
  operating.setup.teams[1].players=[structuredClone(template.setup.tabletoperators[0])];
  const queuePerson=person();queued.setup.teams[1].players=[queuePerson];
  const blocked=game('btp-blocked');blocked.setup.teams[1].entry_status='DSQ';
  unknown.setup.teams[1].players=[];partial.setup.is_doubles=true;
  const stale=game('scheduled-stale');stale.setup.scheduled_time_str='11:00';Object.assign(stale.setup.teams[0].players[0],{now_playing_on_court:'old',now_tablet_on_court:'old'});
  const ended=game('old-finished');ended.team1_won=false;ended.setup={...ended.setup,state:'finished',now_on_court:true,court_id:'old',tabletoperators:[structuredClone(stale.setup.teams[0].players[0])]};
  const guests=game('scheduled-guest');guests.setup.scheduled_time_str='12:00';guests.setup.teams[0].players=[{btp_id:-1,name:'Known Guest',checked_in:true}];
  curt.tabletoperators=[{_id:'assignment-queue',court:null,tabletoperator:[person(),queuePerson]}];
  curt.matches=curt.matches.filter(match=>cmatch.calc_section(match).startsWith('court_')).concat([
   late,readyNew,otherNew,readyOld,otherOld,official,tablet,early,tieSecond,tieFirst,playing,operating,queued,unknown,partial,blocked,stale,ended,guests]);
  ctournament.ui_show();
  window.__assignmentSend=send;window.__assignmentCalls=[];
  window.send=(message,callback)=>{if(message.type==='match_call_on_court'){__assignmentCalls.push({message,callback});return;}return __assignmentSend(message,callback);};
  window.__assignmentSelect=()=>document.querySelector('.leitstand-dialog select');
  window.__assignmentIds=()=>[...__assignmentSelect().options].map(option=>option.value).join(',');
  window.__assignmentChange=(id,mutate)=>{const match=structuredClone(curt.matches.find(match=>match._id===id));mutate(match);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:id,match}});};
 })()`);
 const trigger='.courts_container tr[data-court_id="CH_4"] .call_td button';
 await click(trigger);
 await verify('The assignment dropdown exposes the three groups in priority order',String.raw`[...__assignmentSelect().children].map(group=>group.dataset.group).join(',')==='ready,preparing,other'`);
 await verify('Preparation groups are ordered by longest waiting time, followed by normal scheduled order',String.raw`__assignmentIds()==='ready-old,ready-new,other-old,other-official,other-tablet,other-new,scheduled-early,scheduled-tie-first,scheduled-tie-second,scheduled-late,scheduled-stale,scheduled-guest'`);
 await verify('Current players, current tablet operators, waiting-list partners, unknown teams and BTP blocks are absent',String.raw`!__assignmentSelect().querySelector('option[value^="busy"],option[value="unknown"],option[value="partial-double"],option[value="btp-blocked"]')`);
 await verify('Old player flags and completed duties do not hide available players',String.raw`!!__assignmentSelect().querySelector('option[value="scheduled-stale"]')&&!!__assignmentSelect().querySelector('option[value="scheduled-guest"]')`);
 await c.evaluate(String.raw`(()=>{__assignmentSelect().value='other-new';__assignmentSelect().dispatchEvent(new Event('change',{bubbles:true}));window.__assignmentOption=__assignmentSelect().selectedOptions[0];__assignmentChange('other-new',match=>match.setup.teams[1].players[0].checked_in=true);})()`);
 await verify('A live check-in moves the same selected option into the ready group without changing selection',String.raw`__assignmentSelect().value==='other-new'&&__assignmentSelect().selectedOptions[0]===__assignmentOption&&__assignmentOption.parentElement.dataset.group==='ready'&&__assignmentIds().startsWith('ready-old,other-new,ready-new,')`);
 await c.evaluate(String.raw`(()=>{__assignmentChange('other-new',match=>match.setup.teams[1].players[0].checked_in=false);})()`);
 await verify('Check-out returns a prepared game to the correct position in the second group',String.raw`__assignmentOption.parentElement.dataset.group==='preparing'&&__assignmentSelect().value==='other-new'&&__assignmentIds().includes('other-tablet,other-new,scheduled-early')`);
 await c.evaluate(String.raw`(()=>{window.__assignmentMutations=[];window.__assignmentObserver=new MutationObserver(records=>__assignmentMutations.push(...records));__assignmentObserver.observe(__assignmentSelect(),{childList:true,subtree:true,attributes:true,characterData:true});const match=curt.matches.find(match=>match._id==='match-44');crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:match._id,presses:[],network_score:[[6,5]],now_on_court:true,court_id:match.setup.court_id}});})()`);
 await verify('An ordinary point does not rebuild or mutate the open assignment dropdown',String.raw`__assignmentMutations.length===0&&__assignmentSelect().selectedOptions[0]===__assignmentOption`);
 await c.evaluate(String.raw`(()=>{__assignmentObserver.disconnect();const match=curt.matches.find(match=>match._id==='ready-old');crouting.on_change({ctype:'tabletoperator_add',tournament_key:'preview',val:{tabletoperator:{_id:'new-assignment-queue',court:null,tabletoperator:[match.setup.teams[0].players[0]]}}});})()`);
 await verify('A newly queued player removes their game while preserving another selected game',String.raw`!__assignmentSelect().querySelector('option[value="ready-old"]')&&__assignmentSelect().value==='other-new'`);
 await c.evaluate(String.raw`(()=>{const entry=curt.tabletoperators.find(entry=>entry._id==='new-assignment-queue');crouting.on_change({ctype:'tabletoperator_removed',tournament_key:'preview',val:{tabletoperator:{...entry,court:-1}}});})()`);
 await verify('Removing a waiting entry restores its game at its original priority',String.raw`__assignmentIds().startsWith('ready-old,ready-new,')&&__assignmentSelect().value==='other-new'`);
 await c.evaluate(String.raw`(()=>{const selected=curt.matches.find(match=>match._id==='other-new');__assignmentChange('match-44',match=>match.setup.tabletoperators=[structuredClone(selected.setup.teams[0].players[0])]);})()`);
 await verify('A player taking a tablet removes a selected game and disables assignment instead of silently selecting another',String.raw`!__assignmentSelect().querySelector('option[value="other-new"]')&&__assignmentSelect().value===''&&document.querySelector('.leitstand-dialog button[type="submit"]').disabled&&__assignmentCalls.length===0`);
 await c.evaluate(String.raw`(()=>{document.querySelector('.leitstand-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()`);
 await verify('Submitting a now-unavailable selection sends no court call',String.raw`__assignmentCalls.length===0`);
 await c.evaluate(String.raw`(()=>{__assignmentSelect().value='ready-new';__assignmentSelect().dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await verify('An explicit available selection re-enables assignment',String.raw`!document.querySelector('.leitstand-dialog button[type="submit"]').disabled`);
 for(const [width,height]of [[390,844],[320,568],[1920,1080]]) {
  await metrics(width,height);
  await verify('Grouped assignment controls fit the viewport at '+width,String.raw`(()=>{const d=document.querySelector('.leitstand-dialog'),s=__assignmentSelect(),box=d.getBoundingClientRect(),field=s.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight&&field.left>=box.left&&field.right<=box.right&&d.scrollWidth<=d.clientWidth})()`);
 }
 await c.evaluate(String.raw`(()=>{document.querySelector('.leitstand-dialog form').requestSubmit()})()`);
 await verify('Assignment sends the chosen game and actual destination court',String.raw`__assignmentCalls.length===1&&__assignmentCalls[0].message.match_id==='ready-new'&&__assignmentCalls[0].message.court_id==='CH_4'&&__assignmentCalls[0].message.tournament_key==='preview'`);
 await c.evaluate(String.raw`(()=>{__assignmentCalls[0].callback(null,{})})()`);
 await verify('An acknowledged assignment closes the window',String.raw`!document.querySelector('.leitstand-dialog[open]')`);
 await click(trigger);
 await c.evaluate(String.raw`(()=>{__assignmentChange('ready-new',match=>{match.setup.now_on_court=true;match.setup.court_id='CH_4';match.setup.state='oncourt';})})()`);
 await verify('A court filled by another client disables the open assignment form',String.raw`document.querySelector('.leitstand-dialog button[type="submit"]').disabled&&document.querySelector('.leitstand-dialog button[type="submit"]').title.includes('Feld')`);
 await click('.leitstand-dialog .dialog-heading button');
 await verify('Closing the assignment dialog releases its live-update view',String.raw`!document.querySelector('.leitstand-dialog')`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Grouped court assignment produces no browser exceptions',String(!exceptions.length));
 fs.writeFileSync(path.join(previews,'court-assignment-verification.json'),JSON.stringify({date:'2026-11-01',checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
