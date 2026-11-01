'use strict';
/* eslint no-console: off */
const fs=require('fs'),path=require('path');

module.exports=async function({c,check,click,open,metrics,previews,key}) {
 const checks=[],verify=async(name,expression)=>{
  try {await check(name,expression);checks.push(name);}
  catch(error) {
   console.error(JSON.stringify(await c.evaluate(String.raw`({open:__announcementMenu()?.open,caption:__announcementMenu()?.querySelector('h2').textContent,waitDisabled:__announcementWait()?.disabled,localState:document.querySelector('#local_announce_btn')?.dataset.speechState,plays:__localAnnouncements,previousPlays:window.__announcementPlayCount})`)));
   throw error;
  }
 };
 const eventually=expression=>c.evaluate(`(async()=>{for(let i=0;i<160;i++){if(${expression})return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Announcement did not settle: '+${JSON.stringify(expression)});})()`);
 const pause=()=>c.evaluate('new Promise(resolve=>setTimeout(resolve,1100))');
 await open(1920,1080);
 await c.evaluate(String.raw`(()=>{
  window.__announcementMenu=()=>document.querySelector('.announcement-playback-menu');
  window.__announcementWait=()=>__announcementMenu().querySelector('.announcement-wait-button');
  window.__announcementSet=async(text,status='queued',mode='auto',settings={})=>{
   Object.assign(__speechFixture.settings,{enabled:true,key:'preview',language:'de-DE',voice:'hallensprecherin',mode,max_text:1200,max_part_length:undefined},settings);
   __speechFixture.status=status;
   const field=document.querySelector('#custom_announcement');field.value=text;field.dispatchEvent(new Event('input'));
   await btsSpeechReadiness.refresh(true);
  };
  window.__announcementPrepare=btsSpeechService.prepare;window.__announcementInspect=btsSpeechService.inspect;
  window.__announcementBefore=()=>{window.__announcementPlayCount=__localAnnouncements.length;window.__announcementWriteCount=__writes.filter(message=>message.type==='free_announce').length;};
 })()`);
 await c.evaluate(String.raw`__announcementSet(['  Hinweis an alle Spieler.','<b>Bitte zur Turnierleitung kommen.</b>  '].join(String.fromCharCode(10)))`);
 await click('#local_announce_btn');
 await verify('Missing audio opens a named warning dialog without playing or sending an announcement',String.raw`__announcementMenu().open&&__announcementMenu().classList.contains('is-warning')&&__announcementMenu().getAttribute('role')==='alertdialog'&&document.getElementById(__announcementMenu().getAttribute('aria-labelledby')).tagName==='H2'&&document.getElementById(__announcementMenu().getAttribute('aria-describedby')).getAttribute('role')==='status'&&__localAnnouncements.length===0&&__writes.length===0`);
 await verify('The warning has an amber header, darker two-pixel border and warning symbol',String.raw`(()=>{const d=__announcementMenu(),header=d.querySelector('.dialog-heading'),s=getComputedStyle(d);return getComputedStyle(header).backgroundColor==='rgb(241, 194, 27)'&&s.borderTopColor==='rgb(138, 100, 0)'&&s.borderTopWidth==='2px'&&header.querySelector('h2 path').getAttribute('d').includes('10 18H2Z')})()`);
 await verify('The modal warning prevents background scrolling',String.raw`getComputedStyle(document.body).overflowY==='hidden'`);
 await verify('Target and exact trimmed multiline text appear as text rather than HTML',String.raw`__announcementMenu().querySelector('.announcement-target').textContent.includes('Dieses Gerät')&&__announcementMenu().querySelector('.announcement-preview-text').textContent===['Hinweis an alle Spieler.','<b>Bitte zur Turnierleitung kommen.</b>'].join(String.fromCharCode(10))&&!__announcementMenu().querySelector('.announcement-preview b')`);
 await verify('All playback choices sit in the footer with the primary petrol action last',String.raw`[...__announcementMenu().querySelectorAll('.ls-dialog-footer button')].map(node=>node.textContent).join('|')==='Abbrechen|Mit Browserstimme abspielen|Im Hintergrund warten und abspielen|Warten und abspielen'&&getComputedStyle(__announcementWait()).backgroundColor==='rgb(14, 90, 99)'&&__announcementMenu().querySelectorAll('.dialog-content button').length===0`);
 await verify('The header uses the same 28-pixel close button as the other dialogs',String.raw`__announcementMenu().querySelector('.ls-dialog-close').offsetWidth===28&&__announcementMenu().querySelector('.ls-dialog-close').offsetHeight===28&&__announcementMenu().querySelector('.ls-dialog-close .ico').getBoundingClientRect().width===15`);
 await eventually('__speechPreparationRequests.length>0');
 await verify('Typing a draft prepares it without marking it as an actual call',String.raw`__speechPreparationRequests.every(request=>!request.urgent)&&__localAnnouncements.length===0`);
 await c.evaluate(String.raw`window.__announcementPrepareCount=__speechPrepared.length`);
 await click('.announcement-wait-button');
 await verify('Waiting disables duplicate starts, shows progress and keeps cancellation and browser output available',String.raw`__announcementWait().disabled&&__announcementWait().textContent==='Wird vorbereitet…'&&__announcementWait().getAttribute('aria-busy')==='true'&&document.querySelector('#local_announce_btn').disabled&&document.querySelector('#remote_announce_btn').disabled&&!__announcementMenu().querySelector('.announcement-cancel-button').disabled&&!__announcementMenu().querySelector('.announcement-browser-button').disabled&&__localAnnouncements.length===0`);
 await verify('Waiting explicitly promotes the exact text into the actual-call priority',String.raw`__speechPreparationRequests.at(-1).urgent&&__speechPreparationRequests.at(-1).parts[0]===__announcementMenu().querySelector('.announcement-preview-text').textContent&&__localAnnouncements.length===0`);
 await c.evaluate(String.raw`__announcementWait().dispatchEvent(new Event('click'));__announcementWait().dispatchEvent(new Event('click'))`);
 await verify('Repeated activation during preparation admits only one explicit preparation',String.raw`__speechPrepared.length===__announcementPrepareCount+1&&__localAnnouncements.length===0`);
 await c.evaluate(String.raw`__speechFixture.status='completed';btsSpeechReadiness.refresh(true)`);
 await eventually('__localAnnouncements.length===1');await pause();
 await verify('An explicitly awaited local announcement starts exactly once as server audio and closes the dialog',String.raw`__localAnnouncements.length===1&&__localAnnouncements[0].speechMode==='server'&&__localAnnouncements[0].parts[0].startsWith('Hinweis an alle Spieler.')&&!__announcementMenu().open&&!document.querySelector('#local_announce_btn').disabled`);

 await c.evaluate(String.raw`__announcementSet('Browserdurchsage an die aktivierten Geräte.','missing')`);await click('#remote_announce_btn');
 await verify('Remote output states which devices receive the announcement',String.raw`__announcementMenu().querySelector('.announcement-target').textContent.includes('Geräte mit aktivierten freien Durchsagen')`);
 await click('.announcement-browser-button');
 await verify('Remote browser output sends the exact text, mode and tournament only once',String.raw`__writes.filter(message=>message.type==='free_announce').length===1&&__writes.some(message=>message.type==='free_announce'&&message.text==='Browserdurchsage an die aktivierten Geräte.'&&message.speech_mode==='browser'&&message.tournament_key==='preview')&&!__announcementMenu().open`);

 await c.evaluate(String.raw`__announcementSet('Lokaler Wechsel zur Browserstimme.');__announcementBefore()`);await click('#local_announce_btn');await click('.announcement-wait-button');await click('.announcement-browser-button');
 await c.evaluate(String.raw`__speechFixture.status='completed'`);await pause();
 await verify('Switching to browser output cancels a pending server start and does not play a second time later',String.raw`__localAnnouncements.length===__announcementPlayCount+1&&__localAnnouncements.at(-1).speechMode==='browser'&&!__announcementMenu().open`);

 await c.evaluate(String.raw`__announcementSet('Diese Durchsage wird abgebrochen.');__announcementBefore()`);await click('#local_announce_btn');await click('.announcement-wait-button');await click('.announcement-cancel-button');
 await c.evaluate(String.raw`__speechFixture.status='completed'`);await pause();
 await verify('Cancel prevents late playback and restores focus and the original controls',String.raw`__localAnnouncements.length===__announcementPlayCount&&!__announcementMenu().open&&!document.querySelector('#local_announce_btn').disabled&&document.activeElement.id==='local_announce_btn'&&document.querySelector('#local_announce_btn').getAttribute('aria-expanded')==='false'`);

 await c.evaluate(String.raw`__announcementSet('Fertige Durchsage noch bestätigen.','missing');__announcementBefore()`);await click('#local_announce_btn');
 await c.evaluate(String.raw`__speechFixture.status='completed';btsSpeechReadiness.refresh(true)`);
 await verify('Readiness updates an open choice without automatically starting an unconfirmed announcement',String.raw`__announcementMenu().open&&!__announcementMenu().classList.contains('is-warning')&&__announcementMenu().querySelector('h2').textContent==='Durchsage ist bereit'&&__announcementWait().textContent==='Jetzt abspielen'&&__announcementMenu().querySelector('.announcement-background-button').hidden&&__localAnnouncements.length===__announcementPlayCount`);
 await click('.announcement-wait-button');
 await eventually('__localAnnouncements.length===__announcementPlayCount+1');
 await verify('Confirming a now-ready announcement uses server audio and closes the choice',String.raw`!__announcementMenu().open&&__localAnnouncements.length===__announcementPlayCount+1&&__localAnnouncements.at(-1).speechMode==='server'`);

 for(const [settings,fragment]of [[{enabled:false},'ausgeschaltet'],[{language:'en-US'},'Sprache'],[{max_part_length:10},'maximal 10']]) {
  await c.evaluate(`__announcementSet('Serveraudio nicht verfügbar.','missing','auto',${JSON.stringify(settings)})`);await click('#local_announce_btn');
  await verify('Unavailable server action explains '+fragment,String.raw`__announcementWait().disabled&&__announcementWait().title.includes(`+JSON.stringify(fragment)+String.raw`)&&__announcementMenu().querySelector('.announcement-status').textContent===__announcementWait().title&&__announcementMenu().querySelector('.announcement-background-button').disabled&&__announcementMenu().querySelector('.announcement-background-button').title===__announcementWait().title&&!__announcementMenu().querySelector('.announcement-browser-button').hidden`);
  await click('.announcement-cancel-button');
 }
 await c.evaluate(String.raw`__announcementSet('Nur Serveraudio erlaubt.','queued','server')`);await click('#local_announce_btn');
 await verify('Server-only settings remove browser output completely',String.raw`__announcementMenu().querySelector('.announcement-browser-button').hidden&&__announcementMenu().querySelector('.announcement-browser-button').getClientRects().length===0&&!__announcementWait().disabled`);
 await click('.ls-dialog-close');

 await c.evaluate(String.raw`__announcementSet('Fehlgeschlagenes Audio erneut versuchen.','failed')`);await click('#local_announce_btn');
 await verify('Generation failure appears inline with a retry action',String.raw`__announcementMenu().querySelector('.announcement-status').classList.contains('is-error')&&__announcementWait().textContent==='Erneut versuchen'&&!__announcementWait().disabled`);
 await click('.announcement-wait-button');await eventually('!__announcementWait().disabled');
 await verify('A failed preparation leaves the warning open and permits retry or cancellation',String.raw`__announcementMenu().open&&__announcementMenu().querySelector('.announcement-status').getAttribute('role')==='alert'&&__announcementMenu().querySelector('.announcement-status').textContent.includes('fehlgeschlagen')&&__announcementWait().textContent==='Erneut versuchen'`);
 await c.evaluate(String.raw`__speechFixture.status='queued';__announcementBefore()`);await click('.announcement-wait-button');await c.evaluate(String.raw`__speechFixture.status='completed'`);await eventually('__localAnnouncements.length===__announcementPlayCount+1');
 await verify('Retry can complete and play the chosen text once',String.raw`__localAnnouncements.at(-1).speechMode==='server'&&__localAnnouncements.at(-1).parts[0]==='Fehlgeschlagenes Audio erneut versuchen.'&&!__announcementMenu().open`);

 await c.evaluate(String.raw`__announcementSet('Statusabfrage schlägt fehl.');btsSpeechService.inspect=async()=>null;__announcementBefore()`);await click('#local_announce_btn');await click('.announcement-wait-button');await eventually('!__announcementWait().disabled');
 await verify('Unavailable status responses finish waiting with an actionable error',String.raw`__announcementMenu().open&&__announcementMenu().querySelector('.announcement-status').textContent.includes('nicht abgerufen')&&__announcementWait().textContent==='Erneut versuchen'&&__localAnnouncements.length===__announcementPlayCount`);
 await click('.announcement-cancel-button');await c.evaluate(String.raw`btsSpeechService.inspect=__announcementInspect`);

 for(const disabled of [false,true]) {
  await c.evaluate(String.raw`__announcementSet('Fehlerantwort mit altem fertigen Audio.');__announcementBefore()`);
  await c.evaluate(disabled?String.raw`btsSpeechService.inspect=async()=>({speech:{enabled:false},clips:[{status:'completed'}]})`:String.raw`btsSpeechService.inspect=async()=>({speech_error:'unavailable',clips:[{status:'completed'}]})`);
  await click('#local_announce_btn');await click('.announcement-wait-button');await eventually('!__announcementWait().disabled');
  await verify('Cached completion cannot override a failed or disabled response ('+disabled+')',String.raw`__announcementMenu().open&&__announcementMenu().querySelector('.announcement-status').classList.contains('is-error')&&__localAnnouncements.length===__announcementPlayCount`);
  await click('.announcement-cancel-button');await c.evaluate(String.raw`btsSpeechService.inspect=__announcementInspect`);
 }

 for(const response of ['null','throw']) {
  await c.evaluate(String.raw`__announcementSet('Audioanforderung schlägt fehl.');__announcementBefore()`);
  await c.evaluate(response==='null'?String.raw`btsSpeechService.prepare=async()=>null`:String.raw`btsSpeechService.prepare=async()=>{throw new Error('request failed')}`);
  await click('#local_announce_btn');await click('.announcement-wait-button');await eventually('!__announcementWait().disabled');
  await verify('A failed preparation request is actionable ('+response+')',String.raw`__announcementMenu().open&&__announcementMenu().querySelector('.announcement-status').classList.contains('is-error')&&__announcementWait().textContent==='Erneut versuchen'&&__localAnnouncements.length===__announcementPlayCount`);
  await click('.announcement-cancel-button');await c.evaluate(String.raw`btsSpeechService.prepare=__announcementPrepare`);
 }

 await c.evaluate(String.raw`__announcementSet('Abbruch während einer ausstehenden Antwort.');btsSpeechService.prepare=()=>new Promise((_resolve,reject)=>{window.__announcementReject=reject});__announcementBefore()`);await click('#local_announce_btn');await click('.announcement-wait-button');await click('.announcement-cancel-button');
 await c.evaluate(String.raw`btsSpeechService.prepare=__announcementPrepare;__announcementSet('Neue Auswahl nach dem Abbruch.','missing')`);await click('#remote_announce_btn');
 await c.evaluate(String.raw`__announcementReject(new Error('late preparation failure'));new Promise(resolve=>setTimeout(resolve,50))`);
 await verify('A late failure from a cancelled preparation cannot overwrite or play a newer choice',String.raw`__announcementMenu().open&&__announcementMenu().querySelector('.announcement-preview-text').textContent==='Neue Auswahl nach dem Abbruch.'&&!__announcementMenu().querySelector('.announcement-status').classList.contains('is-error')&&!__announcementWait().disabled&&__localAnnouncements.length===__announcementPlayCount`);
 await click('.announcement-cancel-button');

 await c.evaluate(String.raw`__announcementSet('Durchsage bei geänderter Stimme.');__announcementBefore()`);await click('#local_announce_btn');await click('.announcement-wait-button');
 await c.evaluate(String.raw`__speechFixture.settings.voice='hallensprecher';btsSpeechReadiness.changed(true);btsSpeechReadiness.refresh(true)`);
 await verify('Changing speech settings invalidates a pending choice and prevents playback',String.raw`!__announcementMenu().open&&!document.querySelector('#local_announce_btn').disabled&&__localAnnouncements.length===__announcementPlayCount`);

 await c.evaluate(String.raw`__announcementSet('Textänderung verwirft das Warten.');__announcementBefore()`);await click('#remote_announce_btn');await click('.announcement-wait-button');
 await c.evaluate(String.raw`document.querySelector('#custom_announcement').value='Geänderter Text';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));__speechFixture.status='completed'`);await pause();
 await verify('Changing text prevents an outdated remote announcement',String.raw`!__announcementMenu().open&&__writes.filter(message=>message.type==='free_announce').length===__announcementWriteCount`);

 await c.evaluate(String.raw`__announcementSet('Native Schließen-Aktion prüfen.');__announcementBefore()`);await click('#local_announce_btn');await click('.announcement-wait-button');await c.evaluate(String.raw`__announcementMenu().close()`);
 await verify('Native close also stops waiting and restores the controls',String.raw`!__announcementMenu().open&&!document.querySelector('#local_announce_btn').disabled&&__localAnnouncements.length===__announcementPlayCount`);
 await c.evaluate(String.raw`document.querySelector('#local_announce_btn').click();__announcementMenu().querySelector('.ls-dialog-close').click();document.querySelector('#remote_announce_btn').click()`);
 await verify('A queued close event cannot dismiss a newly reopened choice',String.raw`__announcementMenu().open&&__announcementMenu().querySelector('.announcement-target').textContent.includes('Geräte mit aktivierten')`);
 await key('Escape','Escape',27);
 await verify('Escape closes the warning and restores the initiating control',String.raw`!__announcementMenu().open&&document.activeElement.id==='remote_announce_btn'`);

 await c.evaluate(String.raw`__announcementSet('Browsermodus startet direkt.','missing','browser');__announcementBefore()`);await click('#local_announce_btn');
 await eventually('__localAnnouncements.length===__announcementPlayCount+1');
 await verify('Configured browser mode starts directly without a warning dialog',String.raw`!__announcementMenu().open&&__localAnnouncements.length===__announcementPlayCount+1&&__localAnnouncements.at(-1).speechMode==='browser'`);
 await c.evaluate(String.raw`__announcementSet('Bereites Serveraudio startet direkt.','completed');__announcementBefore()`);await click('#local_announce_btn');
 await eventually('__localAnnouncements.length===__announcementPlayCount+1');
 await verify('Already-ready server audio retains its direct-play behavior',String.raw`!__announcementMenu().open&&__localAnnouncements.length===__announcementPlayCount+1&&__localAnnouncements.at(-1).parts[0]==='Bereites Serveraudio startet direkt.'`);

 await c.evaluate(String.raw`__announcementSet(('Bitte melden.'+String.fromCharCode(10)).repeat(10)+'A'.repeat(30))`);await click('#remote_announce_btn');
 for(const [width,height]of [[1920,1080],[390,844],[320,568],[844,390]]) {
  await metrics(width,height);
  await verify('The warning is centered and fits the viewport at '+width+'x'+height,String.raw`(()=>{const d=__announcementMenu(),r=d.getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1&&Math.abs(r.y+r.height/2-innerHeight/2)<1&&r.width<=innerWidth-20&&r.height<=innerHeight*.9+1&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth})()`);
  await c.evaluate(String.raw`__announcementMenu().querySelector('.dialog-content').scrollTop=10000`);
  await verify('Only the warning body scrolls while header and footer remain visible at '+width+'x'+height,String.raw`(()=>{const d=__announcementMenu(),body=d.querySelector('.dialog-content'),h=d.querySelector('.dialog-heading').getBoundingClientRect(),f=d.querySelector('.ls-dialog-footer').getBoundingClientRect(),button=__announcementWait().getBoundingClientRect();return body.scrollWidth<=body.clientWidth&&body.getBoundingClientRect().top>=h.bottom-1&&body.getBoundingClientRect().bottom<=f.top+1&&h.top>=0&&f.bottom<=innerHeight&&button.right<=f.right&&button.left>=f.left})()`);
 }
 await click('.ls-dialog-close');await metrics(1920,1080);
 await require('./announcement-background-check')({c,verify,click,eventually,pause,metrics});
 await c.evaluate(String.raw`__announcementSet('Formular beim Warten verlassen.');btsSpeechService.prepare=()=>new Promise(resolve=>{window.__announcementRelease=resolve});__announcementBefore()`);await click('#local_announce_btn');await click('.announcement-wait-button');
 await c.evaluate(String.raw`document.querySelector('#custom_announcement').closest('form').remove()`);
 await verify('Leaving the form disposes the open warning and its pending playback',String.raw`!document.querySelector('.announcement-playback-menu')&&__localAnnouncements.length===__announcementPlayCount`);
 await c.evaluate(String.raw`__announcementRelease();new Promise(resolve=>setTimeout(resolve,50))`);
 await verify('A detached form cannot resume playback after preparation resolves',String.raw`__localAnnouncements.length===__announcementPlayCount`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Warning lifecycle and playback choices cause no browser exceptions',String(!exceptions.length));
 fs.writeFileSync(path.join(previews,'announcement-dialog-verification.json'),JSON.stringify({date:'2026-11-01',scope:'Isolated real frontend with synthetic audio responses; no live announcements.',checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
