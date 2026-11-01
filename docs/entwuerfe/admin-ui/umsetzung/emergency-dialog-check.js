'use strict';
/* eslint no-console: off */
const fs = require('fs'), path = require('path');

module.exports = async function({c,check,click,open,metrics,previews,key}) {
 const checks=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 const eventually=expression=>c.evaluate('(async()=>{for(let i=0;i<100;i++){if('+expression+')return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error("Emergency dialog did not settle");})()');
 await open(1920,1080);
 await c.evaluate(String.raw`(()=>{
  window.__emergencyButton=()=>document.querySelector('#announce_emergency_btn');
  window.__emergencyDialog=()=>document.querySelector('.bts-confirm-dialog');
  window.__emergencyCommands=[];window.__emergencyReplies=[];window.__emergencyAudio=[];window.__emergencyNative=0;
  window.confirm=()=>{__emergencyNative++;throw new Error('Native confirm must not be used');};
  // Simulate change notifications with a stub: never instantiate emergency audio.
  window.emergency_announce=enable=>__emergencyAudio.push(enable);
  const connection=conn(()=>{},()=>{});
  window.__emergencyGrant=enable=>connection._test_handle_message({data:JSON.stringify({type:'emergency_playback',enable})});
  window.__emergencyState=enable=>crouting.on_change({ctype:'emergency_announce',tournament_key:curt.key,val:enable});
  window.__emergencyReply=(error=null,notify=true)=>{const request=__emergencyReplies.shift();if(!error&&notify){__emergencyState(request.message.enable);if(request.message.enable)__emergencyGrant(true);}request.callback(error);};
  const original=window.send;
  window.send=(message,callback)=>{
   if(message.type!=='emergency_announce'){original(message,callback);return;}
   __emergencyCommands.push(structuredClone(message));__emergencyReplies.push({message,callback});
  };
  const text=document.querySelector('#custom_announcement');text.value='Unveränderter Freitextentwurf';text.dispatchEvent(new Event('input'));
 })()`);
 await click('#announce_emergency_btn');
 await verify('Start uses a named modal warning without sending a command or starting audio',String.raw`__emergencyDialog().open&&__emergencyDialog().getAttribute('role')==='alertdialog'&&document.getElementById(__emergencyDialog().getAttribute('aria-labelledby')).textContent==='Evakuierungsdurchsage starten?'&&__emergencyCommands.length===0&&__emergencyAudio.length===0&&__emergencyNative===0`);
 await verify('Starting has a red header, darker two-pixel border and warning symbol',String.raw`(()=>{const d=__emergencyDialog(),s=getComputedStyle(d);return d.classList.contains('is-danger')&&s.borderTopWidth==='2px'&&s.borderTopColor==='rgb(125, 46, 41)'&&getComputedStyle(d.querySelector('.bts-confirm-heading')).backgroundColor==='rgb(175, 69, 62)'&&!!d.querySelector('.bts-confirm-warning');})()`);
 await verify('The explanation names every host, exactly one page per host, immediate playback and the 20-second repeat',String.raw`(()=>{const text=__emergencyDialog().querySelector('.bts-confirm-content').textContent;return text.includes('jedem Rechner')&&text.includes('Pro Rechner spielt genau eine Seite')&&text.includes('Tabs oder Browsern')&&text.includes('sofort')&&text.includes('20 Sekunden')&&text.includes('ausdrücklichen Stoppen');})()`);
 await verify('The tournament page subscribes to host-specific emergency playback',String.raw`__emergencySubscriptions.some(message=>message.tournament_key==='preview')`);
 await verify('Both actions sit in the footer and cancellation is focused by default',String.raw`__emergencyDialog().querySelectorAll('.bts-confirm-actions button').length===2&&__emergencyDialog().querySelector('.bts-confirm-accept').textContent==='Evakuierungsdurchsage starten'&&document.activeElement.matches('.bts-confirm-cancel')&&!__emergencyDialog().querySelector('.bts-confirm-content button')&&getComputedStyle(document.body).overflowY==='hidden'`);
 await click('#announce_emergency_btn');
 await verify('Repeated trigger activation cannot create another confirmation',String.raw`document.querySelectorAll('.bts-confirm-dialog').length===1&&__emergencyCommands.length===0`);
 await click('.bts-confirm-cancel');
 await verify('Cancelling changes neither emergency state nor the free-text draft and restores focus',String.raw`!__emergencyDialog()&&!curt.enable_emergency&&__emergencyCommands.length===0&&document.activeElement===__emergencyButton()&&document.querySelector('#custom_announcement').value==='Unveränderter Freitextentwurf'`);
 await click('#announce_emergency_btn');await key('Escape','Escape',27);
 await verify('Escape dismisses the warning without output',String.raw`!__emergencyDialog()&&__emergencyCommands.length===0&&__emergencyAudio.length===0`);
 await click('#announce_emergency_btn');await key('Enter','Enter',13,'\r');
 await verify('Enter on the initially focused action cancels rather than starts the emergency',String.raw`!__emergencyDialog()&&__emergencyCommands.length===0`);

 await click('#announce_emergency_btn');await click('.bts-confirm-accept');
 await verify('Explicit start sends exactly the tournament and intended action and shows a busy trigger',String.raw`JSON.stringify(__emergencyCommands[0])===JSON.stringify({type:'emergency_announce',tournament_key:'preview',enable:true})&&__emergencyCommands.length===1&&!__emergencyDialog()&&__emergencyButton().disabled&&__emergencyButton().getAttribute('aria-busy')==='true'&&__emergencyButton().textContent==='Wird gestartet…'`);
 await c.evaluate(String.raw`__emergencyButton().dispatchEvent(new Event('click'))`);
 await verify('A pending start cannot be submitted twice',String.raw`__emergencyCommands.length===1&&__emergencyReplies.length===1`);
 await c.evaluate(String.raw`__emergencyReply(new Error('Isolated emergency request failure'))`);
 await verify('Request failure keeps the inactive state, preserves the draft and permits retry',String.raw`!curt.enable_emergency&&!__emergencyButton().disabled&&!__emergencyButton().hasAttribute('aria-busy')&&__emergencyButton().textContent==='Evakuierung'&&__emergencyAudio.length===0&&document.querySelector('#custom_announcement').value==='Unveränderter Freitextentwurf'&&cerror.entries().some(entry=>entry.message.includes('Isolated emergency request failure'))`);
 await click('#announce_emergency_btn');await click('.bts-confirm-accept');await c.evaluate(String.raw`__emergencyReply()`);
 await verify('Successful start displays the stop action only after the simulated live notification',String.raw`curt.enable_emergency&&!__emergencyButton().disabled&&__emergencyButton().classList.contains('stop_emergency_button')&&__emergencyButton().textContent==='Evakuierung stoppen'&&__emergencyAudio.join('|')==='true'`);

 await click('#announce_emergency_btn');
 await verify('Stopping is a yellow warning with a dark border and the matching action labels',String.raw`(()=>{const d=__emergencyDialog(),s=getComputedStyle(d);return d.classList.contains('is-warning')&&s.borderTopWidth==='2px'&&s.borderTopColor==='rgb(138, 100, 0)'&&getComputedStyle(d.querySelector('.bts-confirm-heading')).backgroundColor==='rgb(241, 194, 27)'&&d.querySelector('.bts-confirm-title').textContent==='Evakuierungsdurchsage stoppen?'&&d.querySelector('.bts-confirm-cancel').textContent==='Weiter abspielen'&&d.querySelector('.bts-confirm-accept').textContent==='Durchsage stoppen';})()`);
 await verify('The stop dialog explains current playback and automatic repetition',String.raw`(()=>{const text=__emergencyDialog().querySelector('.bts-confirm-content').textContent;return text.includes('laufende Wiedergabe')&&text.includes('automatische Wiederholung')&&text.includes('erneut gestartet');})()`);
 await click('.bts-confirm-cancel');
 await verify('Cancelling stop keeps playback enabled without sending a stop',String.raw`curt.enable_emergency&&__emergencyCommands.length===2&&__emergencyAudio.join('|')==='true'`);
 await click('#announce_emergency_btn');await click('.bts-confirm-accept');
 await verify('Explicit stop sends enable false once and shows progress',String.raw`__emergencyCommands.length===3&&__emergencyCommands.at(-1).enable===false&&__emergencyButton().disabled&&__emergencyButton().textContent==='Wird gestoppt…'`);
 await c.evaluate(String.raw`__emergencyReply()`);
 await verify('Successful stop restores the initial action without sending free text',String.raw`!curt.enable_emergency&&__emergencyAudio.join('|')==='true|false'&&__emergencyButton().textContent==='Evakuierung'&&!__emergencyButton().disabled&&!__writes.some(message=>message.type==='free_announce')`);

 await click('#announce_emergency_btn');await c.evaluate(String.raw`window.__emergencyPreviousStarts=__emergencyAudio.filter(Boolean).length;__emergencyState(true)`);
 await verify('A tournament-wide start notification cannot bypass the host-specific playback grant',String.raw`__emergencyAudio.filter(Boolean).length===__emergencyPreviousStarts`);
 await verify('A start notification from another device dismisses an obsolete start warning',String.raw`!__emergencyDialog()&&curt.enable_emergency&&__emergencyCommands.length===3&&__emergencyButton().textContent==='Evakuierung stoppen'`);
 await click('#announce_emergency_btn');await c.evaluate(String.raw`__emergencyState(false)`);
 await verify('A stop notification also dismisses an obsolete stop warning',String.raw`!__emergencyDialog()&&!curt.enable_emergency&&__emergencyCommands.length===3`);
 await click('#announce_emergency_btn');await c.evaluate(String.raw`curt.enable_emergency=true`);await click('.bts-confirm-accept');
 await verify('The approval guard cannot invert an emergency state that changed during confirmation',String.raw`__emergencyCommands.length===3&&curt.enable_emergency&&!__emergencyButton().disabled`);
 await c.evaluate(String.raw`__emergencyState(false)`);
 await click('#announce_emergency_btn');await c.evaluate(String.raw`curt.key='other-tournament'`);await click('.bts-confirm-accept');
 await verify('Approval after a tournament change sends nothing to either tournament',String.raw`__emergencyCommands.length===3&&!__emergencyDialog()`);
 await c.evaluate(String.raw`curt.key='preview';ctournament.update_emergency_btn()`);

 for(const enabled of [false,true]) {
  await c.evaluate('__emergencyState('+enabled+')');await click('#announce_emergency_btn');
  for(const [width,height]of [[1920,1080],[390,844],[320,568],[844,390]]) {
   await metrics(width,height);
   await verify('Emergency '+(enabled?'stop':'start')+' fits the viewport at '+width+'x'+height,String.raw`(()=>{const d=__emergencyDialog(),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&r.width<=innerWidth-30&&r.height<=innerHeight-30&&Math.abs(r.x+r.width/2-innerWidth/2)<1&&d.scrollWidth<=d.clientWidth;})()`);
   await c.evaluate(String.raw`__emergencyDialog().querySelector('.bts-confirm-content').scrollTop=10000`);
   await verify('Emergency '+(enabled?'stop':'start')+' keeps its heading and actions visible at '+width+'x'+height,String.raw`(()=>{const d=__emergencyDialog(),body=d.querySelector('.bts-confirm-content'),h=d.querySelector('.bts-confirm-heading').getBoundingClientRect(),f=d.querySelector('.bts-confirm-actions').getBoundingClientRect();return h.top>=0&&f.bottom<=innerHeight&&body.scrollWidth<=body.clientWidth&&body.getBoundingClientRect().top>=h.bottom-1&&body.getBoundingClientRect().bottom<=f.top+1&&[...d.querySelectorAll('button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=f.left&&r.right<=f.right&&r.top>=f.top&&r.bottom<=f.bottom;});})()`);
  }
  await click('.bts-confirm-cancel');await metrics(1920,1080);
 }
 await c.evaluate(String.raw`__emergencyState(false)`);await click('#announce_emergency_btn');
 await c.evaluate(String.raw`document.querySelector('#announce_emergency_btn').closest('form').remove()`);
 await verify('Leaving the form dismisses its confirmation without submitting',String.raw`!__emergencyDialog()&&__emergencyCommands.length===3`);
 await c.evaluate(String.raw`ctournament.ui_show()`);await eventually('!!__emergencyButton()');
 await click('#announce_emergency_btn');await click('.bts-confirm-accept');
 await c.evaluate(String.raw`ctournament.ui_show()`);await eventually('!!__emergencyButton()');await click('#announce_emergency_btn');
 await c.evaluate(String.raw`window.__emergencyCurrentDialog=__emergencyDialog();__emergencyReply(null,false)`);
 await verify('A late reply for a removed form cannot close or refocus a newer dialog',String.raw`__emergencyDialog()===__emergencyCurrentDialog&&__emergencyDialog().open&&document.activeElement.matches('.bts-confirm-cancel')&&!__emergencyButton().disabled`);
 await click('.bts-confirm-cancel');
 await verify('Only explicit emergency actions were sent and the native confirm was never invoked',String.raw`__emergencyCommands.length===4&&__emergencyNative===0&&!__writes.some(message=>message.type==='free_announce')`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Emergency confirmation lifecycle causes no browser exceptions',String(!exceptions.length));
 fs.writeFileSync(path.join(previews,'emergency-dialog-verification.json'),JSON.stringify({date:'2026-11-01',scope:'Isolated frontend with synthetic command replies and a stubbed emergency audio handler; no real emergency playback.',checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
