'use strict';
const fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,capture,check,previews}) {
 const checks=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await c.evaluate(String.raw`(()=>{
  window.__speechPageDocument=document;window.__speechPageService=btsSpeechService;window.__speechPageWrites=[];window.__speechPageReplies=[];window.__speechPageChanges=0;window.__speechPageStops=0;window.__speechPageQueues=0;window.__speechPageCancels=0;
  btsSpeechService.settingsChanged=()=>__speechPageChanges++;btsSpeechService.cancel=()=>__speechPageCancels++;
  const settings=btsSpeechService.settings;btsSpeechService.settings=()=>({...settings(),mode:curt.announcement_speech_mode??'auto',voice:curt.announcement_speech_voice??'hallensprecherin',warm_other_voice:curt.announcement_speech_warm_other_voice===true});
  const queue=btsSpeechService.queue;btsSpeechService.queue=async()=>{__speechPageQueues++;return queue();};
  window.cancelAnnouncementPlayback=()=>__speechPageStops++;
  curt.normalizations=[{_id:'base',origin:'Alpha',replace:'Alfa',language:'de-DE'}];
  const original=send;window.send=(message,callback)=>{
   if(['tournament_edit_prop','normalization_add','normalization_remove'].includes(message.type)){__speechPageWrites.push(structuredClone(message));__speechPageReplies.push(callback);return;}
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   original(message,callback);
  };
  window.__speechPageEmit=(ctype,val)=>crouting.on_change({tournament_key:curt.key,ctype,val});
  window.__speechPagePanel=()=>document.querySelector('.page-speech')||document.querySelector('.settings-panel[data-settings-section=speech]');
  window.__speechPageInput=name=>__speechPagePanel().querySelector('[name="'+name+'"]');
  window.__speechPageEdit=(name,value)=>{const input=__speechPageInput(name);input.focus();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 })()`);
 await c.evaluate('document.querySelector(\'.settings-area-link[href$="/edit/speech"]\').click()');
 await verify('Speech settings keep all six labeled configuration fields with separate server-wide cards', String.raw`__speechPagePanel().querySelectorAll('.settings-card').length===4&&!__speechPagePanel().classList.contains('settings')&&['announcement_speech_mode','announcement_speech_voice','announcement_speech_warm_other_voice','announcement_speed','announcement_pause_time_ms','no_match_cascade_announcements_enabled'].every(name=>{const input=__speechPageInput(name);return input.labels.length===1&&input.getAttribute('aria-describedby');})`);
 await verify('Speech modes, voices, defaults and the shared duration format remain available', String.raw`__speechPageInput('announcement_speech_mode').options.length===3&&__speechPageInput('announcement_speech_mode').value==='auto'&&__speechPageInput('announcement_speech_voice').options.length===2&&__speechPageInput('announcement_speech_voice').value==='hallensprecherin'&&__speechPageInput('announcement_speed').value==='1.05'&&__speechPageInput('announcement_pause_time_ms').value==='0:02'`);
 await c.evaluate(String.raw`__speechPageInput('announcement_speech_mode').value='server';__speechPageInput('announcement_speech_mode').dispatchEvent(new Event('change',{bubbles:true}));__speechPageReplies.shift()({message:'Synthetic mode error'});`);
 await verify('An unsuccessful initial mode change restores the effective default instead of an empty selection', String.raw`__speechPageInput('announcement_speech_mode').value==='auto'&&document.querySelector('.live_settings_status_error')&&__speechPageChanges===0`);
 await c.evaluate(String.raw`__speechPageInput('announcement_speech_mode').value='server';__speechPageInput('announcement_speech_mode').dispatchEvent(new Event('change',{bubbles:true}));__speechPageReplies.shift()(null,{});`);
 await verify('Changing the mode retains the existing property command and refreshes the speech service', String.raw`__speechPageWrites.at(-1).field==='announcement_speech_mode'&&__speechPageWrites.at(-1).value==='server'&&__speechPageWrites.at(-1).key==='preview'&&curt.announcement_speech_mode==='server'&&__speechPageChanges===1`);
 for(const [name,value] of [['announcement_speech_voice','hallensprecher'],['announcement_speech_warm_other_voice',true],['announcement_speed',1.2],['announcement_pause_time_ms','0:00,125'],['no_match_cascade_announcements_enabled',true]]) {
  await c.evaluate(`(()=>{const input=__speechPageInput(${JSON.stringify(name)});if(input.type==='checkbox')input.click();else{input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}__speechPageReplies.shift()(null,{});})()`);
  await verify('The modern speech field preserves its saved type and storage unit: '+name, `curt[${JSON.stringify(name)}]===${JSON.stringify(name==='announcement_pause_time_ms'?.125:value)}&&document.querySelector('.live_settings_status_saved')`);
 }
 await c.evaluate(String.raw`window.__speechPageNodes=[...__speechPagePanel().querySelectorAll('*')];__speechPageEmit('prop_changed',{field:'announcement_speech_voice',value:'hallensprecherin'});`);
 await verify('External voice changes update existing controls without replacing the settings page', String.raw`__speechPageInput('announcement_speech_voice').value==='hallensprecherin'&&__speechPageNodes.every(node=>node.isConnected)`);
 for(const width of [1920,390]) {
  await metrics(width,1000);await verify('Reduced speech settings fit at '+width,String.raw`document.documentElement.scrollWidth<=innerWidth+1&&!__speechPagePanel().querySelector('.speech_queue,.normalizations_values_div')&&__speechPageInput('no_match_cascade_announcements_enabled').labels[0].textContent==='Weitere Kampflos-Ergebnisse automatisch ansagen'`);
  await capture(width===1920?'einstellungen-sprache':'einstellungen-sprache-mobil');
 }
 await metrics(1920,1080);
 await c.evaluate(String.raw`document.querySelector('.settings-speech-system-link').click();document.querySelector('#speech-tab-playback').click();`);
 await verify('The speech-system link opens the shared workspace and keeps configuration in settings',String.raw`document.querySelector('.board-page-title').textContent==='BTS – Sprachsystem'&&document.querySelector('.leitstand-nav [aria-current]').textContent==='Sprachsystem'&&document.querySelectorAll('.speech-system-tabs [role=tab]').length===3&&!__speechPagePanel().querySelector('[name=announcement_speech_voice]')&&__speechPagePanel().querySelector('.speech-system-settings').textContent.includes('Nur Server-Audio')&&document===__speechPageDocument&&__speechPageCancels===0`);
 await c.evaluate(String.raw`window.__systemBeforeLive=[...__speechPagePanel().querySelectorAll('*')];__speechPageEmit('prop_changed',{field:'announcement_speech_mode',value:'browser'});`);
 await verify('Live speech-mode changes update the read-only system summary without rebuilding its tools',String.raw`__speechPagePanel().querySelector('.speech-system-settings p').textContent.startsWith('Browser-TTS')&&__systemBeforeLive.every(node=>node.isConnected)`);
 await c.evaluate(String.raw`__speechPageEmit('prop_changed',{field:'announcement_speech_mode',value:'server'});`);
 await c.evaluate(String.raw`__speechPageInput('speech_stop_local').click();btsSpeechService.outputMessage=()=>'Testgerät: Audio bereit';window.dispatchEvent(new Event('bts-speech-output-changed'));window.__speechQueueBefore=__speechPageQueues;__speechPageInput('speech_refresh').click();`);
 await verify('Playback actions retain the explicit local stop and existing output-status event', String.raw`__speechPageStops===1&&__speechPagePanel().querySelector('.local_speech_playback_status').textContent==='Testgerät: Audio bereit'&&__speechPagePanel().querySelectorAll('.local_speech_readiness').length===4&&__speechPagePanel().querySelector('.settings-speech-links a[href$="/edit/speech"]').textContent==='Server & Sprachhelfer verwalten →'`);
 await c.evaluate(String.raw`(async()=>{for(let i=0;i<40&&__speechPageQueues===__speechQueueBefore;i++)await new Promise(resolve=>setTimeout(resolve,50));})()`);
 await verify('The refresh action still updates the existing audio queue', String.raw`__speechPageQueues>__speechQueueBefore&&__speechPagePanel().querySelector('.speech_queue_summary').textContent.includes('keine Aufträge')`);
 await c.evaluate(String.raw`document.querySelector('#speech-tab-pronunciation').click()`);
 await c.evaluate(String.raw`__speechPageEdit('normalizations_origin','Nordstadt');__speechPageEdit('normalizations_replace','Nord-stadt');__speechPageInput('normalizations_replace').setSelectionRange(2,5);window.__speechRuleRow=__speechPagePanel().querySelector('tr[data-normalization-id=base]');__speechPageEmit('normalization_add',{normalization:{_id:'new',origin:'<unsafe>',replace:'Sicher',language:'de-DE'}});`);
 await verify('Live pronunciation additions preserve the current draft, selection and existing rows, and render text safely', String.raw`__speechPageInput('normalizations_origin').value==='Nordstadt'&&document.activeElement===__speechPageInput('normalizations_replace')&&__speechPageInput('normalizations_replace').selectionStart===2&&__speechRuleRow.isConnected&&__speechPagePanel().querySelector('[data-normalization-id=new]').textContent.includes('<unsafe>')&&!__speechPagePanel().querySelector('unsafe')`);
 await c.evaluate(String.raw`window.__speechRuleMutations=[];window.__speechRuleObserver=new MutationObserver(records=>__speechRuleMutations.push(...records));__speechRuleObserver.observe(__speechPagePanel().querySelector('.normalizations_values_div'),{subtree:true,attributes:true,childList:true,characterData:true});__speechPageEmit('normalization_add',{normalization:{_id:'new',origin:'<unsafe>',replace:'Sicher',language:'de-DE'}});`);
 await verify('Duplicate live additions do not duplicate rules or mutate the pronunciation form', String.raw`__speechRuleMutations.length===0&&curt.normalizations.length===2&&__speechRuleRow.isConnected`);
 await c.evaluate(String.raw`ctournament.refresh_current_view()`);
 await verify('A deliberate speech-system refresh retains pronunciation drafts and existing rows',String.raw`__speechPageInput('normalizations_origin').value==='Nordstadt'&&__speechPageInput('normalizations_replace').selectionStart===2&&__speechRuleRow.isConnected&&__speechRuleMutations.length===0`);
 await c.evaluate(String.raw`__speechRuleObserver.disconnect();__speechPagePanel().querySelector('.settings-normalization-form').requestSubmit();__speechPagePanel().querySelector('.settings-normalization-form').requestSubmit();`);
 await verify('Adding a pronunciation uses the existing command and blocks a duplicate pending submission', String.raw`__speechPageWrites.filter(message=>message.type==='normalization_add').length===1&&__speechPageWrites.at(-1).normalization.origin==='Nordstadt'&&__speechPageWrites.at(-1).normalization.replace==='Nord-stadt'&&__speechPageWrites.at(-1).normalization.language==='de-DE'&&__speechPageWrites.at(-1).tournament_key==='preview'`);
 await c.evaluate(String.raw`__speechPageReplies.shift()({message:'Synthetic normalization error'});`);
 await verify('A pronunciation save failure preserves its draft and provides a local retry explanation', String.raw`__speechPageInput('normalizations_origin').value==='Nordstadt'&&__speechPagePanel().querySelector('.settings-normalization-status').textContent.includes('erneut hinzufügen')&&!__speechPagePanel().querySelector('.settings-normalization-form button').disabled`);
 await c.evaluate(String.raw`__speechPagePanel().querySelector('.settings-normalization-form').requestSubmit();__speechPageEmit('normalization_add',{normalization:{_id:'saved',...__speechPageWrites.at(-1).normalization}});__speechPageEdit('normalizations_origin','Neuer Entwurf');__speechPageReplies.shift()(null,{});`);
 await verify('An early successful broadcast adds the rule while a later acknowledgement preserves the newer draft', String.raw`__speechPagePanel().querySelector('[data-normalization-id=saved]')&&__speechPageInput('normalizations_origin').value==='Neuer Entwurf'&&__speechRuleRow.isConnected&&document.querySelector('.live_settings_status_saved')`);
 await c.evaluate(String.raw`__speechPagePanel().querySelector('button[data-normalization-id=base]').click();__speechPagePanel().querySelector('button[data-normalization-id=base]').click();__speechPageReplies.shift()({message:'Synthetic delete error'});`);
 await verify('Failed deletion retains the rule, restores its button and reports the error inline', String.raw`__speechPageWrites.filter(message=>message.type==='normalization_remove').length===1&&__speechRuleRow.isConnected&&!__speechRuleRow.querySelector('button').disabled&&__speechPagePanel().querySelector('.settings-normalization-status').textContent.includes('nicht gelöscht')`);
 await c.evaluate(String.raw`__speechRuleRow.querySelector('button').click();__speechPageEmit('normalization_removed',{normalization_id:'base'});__speechPageReplies.shift()(null,{});`);
 await verify('A confirmed deletion removes only its own rule and preserves the add-form draft', String.raw`!__speechRuleRow.isConnected&&__speechPageInput('normalizations_origin').value==='Neuer Entwurf'&&__speechPagePanel().querySelector('[data-normalization-id=saved]')`);
 for(const width of [1920,1280,950,390,320]) {
  await metrics(width,1000);
  await verify('Speech cards and pronunciation controls fit without horizontal scrolling at '+width, String.raw`(()=>{const panel=__speechPagePanel();return document.documentElement.scrollWidth<=innerWidth+1&&panel.scrollWidth<=panel.clientWidth+1&&[...panel.querySelectorAll('.settings-card,input,select,button')].filter(node=>node.getClientRects().length).every(node=>{const box=node.getBoundingClientRect();return box.left>=-.5&&box.right<=document.documentElement.clientWidth+.5;});})()`);
  if(width===1920)await capture('sprachsystem-aussprache',true);
  if(width===390)await capture('sprachsystem-aussprache-mobil');
 }
 await metrics(1920,1080);
 await c.evaluate(String.raw`window.__speechRetained=[...__speechPagePanel().querySelectorAll('*')];document.querySelector('#speech-tab-playback').click();document.querySelector('#speech-tab-pronunciation').click();`);
 await verify('Speech-system tabs retain controls, pronunciation drafts and the shared playback service', String.raw`document===__speechPageDocument&&btsSpeechService===__speechPageService&&__speechPageCancels===0&&__speechRetained.every(node=>node.isConnected)&&__speechPageInput('normalizations_origin').value==='Neuer Entwurf'`);
 await require('./speech-workspace-check.js')({c,open,metrics,capture,verify,previews});
 await require('./settings-speech-infrastructure-check.js')({c,open,metrics,capture,verify});
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Speech settings and pronunciation updates produce no browser exceptions',String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'settings-speech-verification.json'),JSON.stringify({date:new Date().toISOString().slice(0,10),checks,exceptions:exceptions.length},null,2)+'\n');
};
