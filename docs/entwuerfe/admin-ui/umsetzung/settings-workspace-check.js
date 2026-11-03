'use strict';
/* eslint no-console: off */
const fs = require('fs'), path = require('path');

module.exports = async function({c, check, click, open, metrics, previews, key, capture}) {
 const checks = [], samples = [];
 const verify = async (name, expression) => {
  try {await check(name, expression);checks.push(name);}
  catch (error) {console.error(JSON.stringify(await c.evaluate('({path:location.pathname,section:document.querySelector(".page-settings")?.dataset.settingsSection,exceptions:window.__settingsExceptions,commands:window.__settingsCommands,status:document.querySelector(".live_settings_status")?.className,contentWidth:document.documentElement.clientWidth,bounds:[...document.querySelectorAll(".main,.settings-workspace,.certificate-export-form,.certificate-workspace-tabs,.registration_container")].map(node=>({className:node.className,left:node.getBoundingClientRect().left,width:node.getBoundingClientRect().width})),boardUpdating:cleitstand.isUpdating(),tournamentUpdating:ctournament.isUpdating()})')));throw error;}
 };
 const eventually = expression => c.evaluate('(async()=>{for(let i=0;i<150;i++){if(' + expression + ')return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error("Settings did not settle");})()');
 await open(1920,1080);
 await c.call('Emulation.setFocusEmulationEnabled', {enabled: true});
 await c.evaluate(String.raw`(()=>{
  window.__settingsDocument=document;window.__settingsService=btsSpeechService;window.__settingsCancels=0;window.__settingsUnloads=0;window.__settingsCommands=[];window.__settingsPending=[];window.__settingsClockRequests=[];window.__settingsClockCallbacks=[];window.__settingsFetchRequests=[];window.__settingsFetchCallbacks=[];window.__settingsExceptions=[];
  window.addEventListener('error',event=>__settingsExceptions.push(event.message));window.addEventListener('beforeunload',()=>__settingsUnloads++);
  btsSpeechService.cancel=()=>__settingsCancels++;
  const original=send;window.send=(message,callback)=>{
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   if(message.type==='btp_fetch'){__settingsFetchRequests.push(structuredClone(message));__settingsFetchCallbacks.push(callback);return;}
   if(message.type==='clock_set'){__settingsClockRequests.push(structuredClone(message));__settingsClockCallbacks.push(callback);return;}
   if(message.type!=='tournament_edit_prop')return original(message,callback);
   __settingsCommands.push(structuredClone(message));__settingsPending.push({message:structuredClone(message),callback});
  };
  window.__settingsFetchReply=error=>__settingsFetchCallbacks.shift()(error);
  window.__settingsClockReply=clock=>__settingsClockCallbacks.shift()(null,{clock});
  window.__settingsReply=(field,error=null)=>{const index=__settingsPending.findIndex(item=>item.message.field===field);if(index<0)throw new Error('No settings request for '+field);__settingsPending.splice(index,1)[0].callback(error,{});};
  window.__settingsSection=id=>{const area=btsSettingsWorkspace.resolve(id);document.querySelector('.settings-area-link[href$="/edit'+(area==='general'?'':'/'+area)+'"]').click();};
  window.__settingsPage=()=>document.querySelector('.page-settings');
  window.__settingsNodes=[];
  // Older tournaments can have numeric rules without explicit enable flags.
  Object.assign(curt,{preparation_call_block_ahead_limit:2,call_on_court_block_ahead_limit:1,call_on_court_player_pause_expired_enabled:true});
  delete curt.automation_enabled; // A missing legacy master switch means active.
  window.__speechPlaybackGate=true;
  const text=document.querySelector('#custom_announcement');text.value='Ansage während der Einstellungsnavigation';text.dispatchEvent(new Event('input'));
  document.querySelector('#local_announce_btn').dataset.speechState='ready';document.querySelector('#local_announce_btn').click();
 })()`);
 await eventually('typeof __releaseSpeechPlayback==="function"');
 await click('.leitstand-nav a[href$="/edit"]');
 await eventually('!!__settingsPage()');
 await verify('Settings use the shared header, active navigation and settings icon', String.raw`current_view==='edit'&&location.pathname==='/admin/t/preview/edit'&&document.querySelector('.board-page-title').textContent==='BTS – Einstellungen'&&document.querySelector('.leitstand-nav [aria-current]').textContent==='Einstellungen'&&document.querySelector('.board-brand-mark svg').outerHTML===document.querySelector('.leitstand-nav [aria-current] svg').outerHTML&&document.querySelectorAll('.leitstand-nav a').length===6&&document.querySelectorAll('.toprow>.toprow_link').length===2&&!document.querySelector('.toprow_menu')&&__settingsPage().getAttribute('aria-labelledby')===document.activeElement.id`);
 await verify('Fourteen settings areas combine calls and tablet operators with officials', String.raw`document.querySelectorAll('.settings-area-link').length===14&&document.querySelectorAll('.settings-panel').length===14&&document.querySelector('[data-settings-section="btp"] [name="btp_ip"]')&&document.querySelector('[data-settings-section="ticker"] [name="ticker_url"]')&&!document.querySelector('[data-settings-section="btp"] [name="ticker_url"]')`);
 await verify('The sidebar uses the certificate tab style with a right-hand separator and active petrol line', String.raw`(()=>{const nav=getComputedStyle(document.querySelector('.settings-navigation')),active=getComputedStyle(document.querySelector('.settings-area-link[aria-current]'));return nav.backgroundColor==='rgba(0, 0, 0, 0)'&&nav.borderLeftWidth==='0px'&&nav.borderRightWidth==='1px'&&active.borderLeftWidth==='0px'&&active.borderRightWidth==='2px'&&active.borderRightColor==='rgb(14, 90, 99)'&&active.color==='rgb(14, 90, 99)'&&active.backgroundColor==='rgba(0, 0, 0, 0)'&&[...document.querySelectorAll('.settings-navigation-group')].map(node=>node.textContent).join('|')==='Turnier|Weitere Werkzeuge'&&!document.querySelector('.settings-navigation').textContent.includes('Testlabor');})()`);
 await verify('Initial navigation shows general settings and the single save status above the cards', String.raw`[...document.querySelectorAll('.settings-panel')].filter(node=>!node.hidden).map(node=>node.dataset.settingsSection).join()==='general'&&document.querySelector('.settings-save-status .live_settings_status').getBoundingClientRect().height>0&&document.querySelectorAll('.live_settings_status').length===1&&document.querySelector('.settings-save-status').getBoundingClientRect().bottom<=document.querySelector('.settings-workspace').getBoundingClientRect().top&&document.querySelector('.settings-footer .settings-back-button')&&__settingsCommands.length===0`);
 await verify('Settings content and footer share the centered 1440px certificate width', String.raw`(()=>{const content=document.querySelector('.settings-workspace').getBoundingClientRect(),footer=document.querySelector('.settings-footer').getBoundingClientRect();window.__settingsContentBounds={left:content.left,width:content.width};return Math.abs(content.width-1440)<1&&Math.abs(content.left-footer.left)<1&&Math.abs(content.width-footer.width)<1;})()`);
 await verify('Entering settings preserves the document and running announcement', String.raw`document===__settingsDocument&&btsSpeechService===__settingsService&&announcementPlaybackActive&&__localAnnouncements.length===1&&__settingsCancels===0&&__settingsUnloads===0`);
 await verify('General settings retain their labeled fields while time simulation belongs to Debug', String.raw`(()=>{const panel=document.querySelector('.settings-general'),names=['name','key','tguid','language','is_team','is_nation_competition'];return !panel.querySelector('[name^="test_clock_"]')&&document.querySelector('.settings-debug [name="test_clock_mode"]')&&names.every(name=>{const node=panel.querySelector('[name="'+name+'"]');return node&&node.labels.length===1&&node.labels[0].textContent.trim();})&&['name','key','tguid','language','is_team','is_nation_competition'].every(name=>{const node=panel.querySelector('[name="'+name+'"]');return document.getElementById(node.getAttribute('aria-describedby'))?.textContent.trim();})&&panel.querySelector('[name="key"]').disabled&&panel.querySelector('[name="key"]').readOnly&&panel.querySelector('[name="key"]').value===curt.key;})()`);
 await c.evaluate(String.raw`window.__settingsNodes=[...document.querySelectorAll('.settings-content input,.settings-content select,.settings-content textarea')];window.__settingsPanels=[...document.querySelectorAll('.settings-panel')];`);
 for (const section of ['btp','flow','calls','officials','scoring','locations','speech','upcoming','devices','advertisements','ticker','debug','maintenance','general']) {
  await c.evaluate('__settingsSection('+JSON.stringify(section)+')');
  await verify('Switching to '+section+' retains controls, data and the running announcement', String.raw`__settingsPage().dataset.settingsSection===`+JSON.stringify(section)+String.raw`&&[...document.querySelectorAll('.settings-panel')].filter(node=>!node.hidden).length===1&&__settingsNodes.every(node=>node.isConnected)&&__settingsPanels.every(node=>node.isConnected)&&__settingsCommands.length===0&&announcementPlaybackActive&&__settingsCancels===0&&__localAnnouncements.length===1`);
 }
 await c.evaluate(String.raw`window.__settingsName=document.querySelector('.settings-panel [name="name"]');__settingsName.focus();__settingsName.value='Geänderter Turniername';__settingsSection('btp');`);
 await verify('Leaving a focused general field triggers its existing autosave once', String.raw`__settingsCommands.length===1&&__settingsCommands[0].field==='name'&&__settingsCommands[0].value==='Geänderter Turniername'&&__settingsCommands[0].key==='preview'&&document.querySelector('.settings-save-status .live_settings_status_saving')&&__settingsName.isConnected`);
 await c.evaluate('__settingsSection("ticker");__settingsReply("name");__settingsSection("general")');
 await verify('A pending save survives section changes and preserves the original input', String.raw`curt.name==='Geänderter Turniername'&&document.querySelector('.settings-panel [name="name"]')===__settingsName&&__settingsName.value===curt.name&&document.querySelector('.settings-save-status .live_settings_status_saved')&&__settingsCommands.length===1`);
 await c.evaluate(String.raw`document.querySelector('.settings-general [name="is_team"]').labels[0].click()`);
 await verify('The team switch saves a boolean through its visible label', String.raw`__settingsCommands.at(-1).field==='is_team'&&__settingsCommands.at(-1).value===true&&document.querySelector('.settings-general [name="is_team"]').checked`);
 await c.evaluate('__settingsReply("is_team");document.querySelector(".settings-general [name=is_nation_competition]").focus()');
 await key(' ','Space',32,' ');
 await verify('The international switch supports keyboard operation and restores its value after a failed save', String.raw`(()=>{const node=document.querySelector('.settings-general [name="is_nation_competition"]');if(!node.checked||__settingsCommands.at(-1).field!=='is_nation_competition'||__settingsCommands.at(-1).value!==true)return false;__settingsReply('is_nation_competition',{message:'Synthetic general save failure'});return !node.checked&&!!document.querySelector('.settings-save-status .live_settings_status_error');})()`);
 await c.evaluate(String.raw`const guid=document.querySelector('.settings-general [name="tguid"]');guid.focus();guid.value='example-tournament-guid';__settingsSection('btp')`);
 await verify('Leaving the redesigned GUID field preserves its blur-save behavior', String.raw`__settingsCommands.at(-1).field==='tguid'&&__settingsCommands.at(-1).value==='example-tournament-guid'`);
 await c.evaluate(String.raw`__settingsReply('tguid');__settingsSection('general');const language=document.querySelector('.settings-general [name="language"]');language.value='auto';language.dispatchEvent(new Event('change'));`);
 await verify('The language field keeps its existing save and browser-default value', String.raw`__settingsCommands.at(-1).field==='language'&&__settingsCommands.at(-1).value==='auto'`);
 await c.evaluate(String.raw`__settingsReply('language');__settingsSection('debug');window.__settingsClockFields=[...document.querySelectorAll('.settings-debug input[name^="test_clock_"],.settings-debug select[name^="test_clock_"]')];window.__settingsSetClock=mode=>{const select=__settingsClockFields[0];select.value=mode;select.dispatchEvent(new Event('change'));};window.__settingsCommandCount=__settingsCommands.length;__settingsSetClock('fixed');`);
 await verify('Selecting a fixed time reveals its original field without saving or rebuilding it', String.raw`document.querySelector('[name="test_clock_fixed"]').getBoundingClientRect().height>0&&!document.querySelector('[name="test_clock_offset_minutes"]').getBoundingClientRect().height&&__settingsClockFields.every(node=>node.isConnected)&&__settingsCommands.length===__settingsCommandCount`);
 await c.evaluate('__settingsSetClock("offset")');
 await verify('Selecting an offset reveals both original offset fields and hides fixed time', String.raw`!document.querySelector('[name="test_clock_fixed"]').getBoundingClientRect().height&&document.querySelector('[name="test_clock_offset_minutes"]').getBoundingClientRect().height>0&&document.querySelector('[name="test_clock_offset_target"]').getBoundingClientRect().height>0&&__settingsCommands.length===__settingsCommandCount`);
 await c.evaluate(String.raw`__settingsSetClock('fixed');const fixed=document.querySelector('[name="test_clock_fixed"]');fixed.value='2026-11-02T12:30';window.__settingsFixedTime=Date.parse(fixed.value);fixed.closest('.settings-card').querySelector('.settings-card-actions .btn').click()`);
 await verify('Time simulation in Debug still sends the selected fixed time only on confirmation', String.raw`document.querySelector('.settings-debug .settings-card h2').textContent==='Zeitsimulation'&&__settingsClockRequests.length===1&&__settingsClockRequests[0].type==='clock_set'&&__settingsClockRequests[0].tournament_key==='preview'&&__settingsClockRequests[0].mode==='fixed'&&__settingsClockRequests[0].fixed_ts===__settingsFixedTime&&!!document.querySelector('.settings-save-status .live_settings_status_saving')`);
 await c.evaluate(String.raw`__settingsClockReply({mode:'fixed',fixed_ts:__settingsFixedTime,offset_ms:0});document.querySelector('[name="test_clock_reset"]').click()`);
 await verify('The visible return-to-real-time button works directly from fixed-time mode', String.raw`document.querySelector('[name="test_clock_reset"]').textContent==='Zur Echtzeit'&&document.querySelector('[name="test_clock_reset"]').getBoundingClientRect().height>0&&__settingsClockRequests.length===2&&__settingsClockRequests[1].mode==='real'&&curt.test_clock.mode==='fixed'`);
 await c.evaluate('__settingsClockReply({mode:"real",fixed_ts:null,offset_ms:0})');
 await verify('The real-time acknowledgement restores all time controls and the saved status', String.raw`curt.test_clock.mode==='real'&&document.querySelector('[name="test_clock_mode"]').value==='real'&&!document.querySelector('[name="test_clock_fixed"]').getBoundingClientRect().height&&!document.querySelector('[name="test_clock_offset_minutes"]').getBoundingClientRect().height&&!document.body.classList.contains('bts_clock_debug_mode')&&!!document.querySelector('.settings-save-status .live_settings_status_saved')`);
 await capture('einstellungen-zeitsimulation');
 await c.evaluate('__settingsSection("general")');
 await c.evaluate(String.raw`__settingsSection('btp');document.querySelector('[name="btp_enabled"]').click();`);
 await verify('Existing BTP dependency rules wait for the save acknowledgement', String.raw`document.querySelector('[name="btp_ip"]').disabled&&__settingsCommands.at(-1).field==='btp_enabled'&&__settingsPending.length===1`);
 await c.evaluate('__settingsReply("btp_enabled")');
 await verify('Acknowledging a BTP change enables the existing connection fields', String.raw`curt.btp_enabled===true&&!document.querySelector('[name="btp_ip"]').disabled`);
 await verify('BTP keeps all seven labeled settings, password masking and the server-zone default', String.raw`(()=>{const panel=document.querySelector('.settings-btp');return ['btp_enabled','btp_ip','btp_password','btp_timezone','btp_autofetch_enabled','btp_autofetch_timeout_intervall','btp_readonly'].every(name=>{const node=panel.querySelector('[name="'+name+'"]');return node.labels.length===1&&node.getAttribute('aria-describedby');})&&panel.querySelector('[name="btp_password"]').type==='password'&&panel.querySelector('[name="btp_timezone"]').value==='system'&&panel.querySelector('[name="btp_timezone"] option').textContent.includes('Europe/Berlin')&&panel.querySelector('[name="btp_autofetch_timeout_intervall"]').value==='0:30';})()`);
 await verify('Before the first known success the manual row gives an explicit unknown state', String.raw`document.querySelector('.settings-btp-last-sync').textContent==='Noch kein erfolgreicher Abgleich bekannt.'&&document.querySelector('[name="btp_fetch"]').getAttribute('aria-describedby').split(' ').includes(document.querySelector('.settings-btp-last-sync').id)`);
 await c.evaluate(String.raw`window.__settingsBtpNodes=[...document.querySelectorAll('.settings-btp input,.settings-btp select,.settings-btp button')];window.__settingsBtpStatus=value=>ctournament.btp_status_changed({val:{last_successful_fetch_ts:curt.btp_status?.last_successful_fetch_ts??null,...value}});__settingsBtpStatus({status:'connecting',message:'Fixture connecting'});`);
 await verify('The BTP card displays connection progress from the existing live handler', String.raw`document.querySelector('.settings-btp-status').textContent==='Verbindet …'&&document.querySelector('.settings-btp-message').hidden`);
 await c.evaluate(String.raw`window.__settingsBtpAddress=document.querySelector('[name="btp_ip"]');__settingsBtpAddress.value='unsaved-btp-host';__settingsBtpStatus({status:'error',message:'Fixture BTP login failed'});`);
 await verify('Connection errors appear in the card while a draft address and controls are preserved', String.raw`document.querySelector('.settings-btp-status').textContent==='Verbindungsfehler'&&document.querySelector('.settings-btp-message').textContent==='Fixture BTP login failed'&&!document.querySelector('.settings-btp-message').hidden&&document.querySelector('[name="btp_ip"]')===__settingsBtpAddress&&__settingsBtpAddress.value==='unsaved-btp-host'&&__settingsBtpNodes.every(node=>node.isConnected)`);
 await c.evaluate(String.raw`window.__settingsLastSuccess=Date.UTC(2026,10,2,12,34,56);__settingsBtpStatus({status:'connected',message:'Fixture connected',last_successful_fetch_ts:__settingsLastSuccess});window.__settingsLastSyncNode=document.querySelector('.settings-btp-last-sync');window.__settingsBtpMutations=[];window.__settingsBtpObserver=new MutationObserver(records=>__settingsBtpMutations.push(...records));__settingsBtpObserver.observe(document.querySelector('.settings-btp'),{subtree:true,childList:true,characterData:true,attributes:true});__settingsBtpStatus({status:'connected',message:'Fixture connected'});`);
 await verify('Repeated identical BTP status events do not mutate the card or replace controls', String.raw`__settingsBtpMutations.length===0&&__settingsBtpNodes.every(node=>node.isConnected)&&document.querySelector('.settings-btp-status').textContent==='Verbunden'&&document.querySelector('.settings-btp-message').hidden`);
 await verify('The server success timestamp is displayed as a full date and time in the server zone', String.raw`document.querySelector('.settings-btp-last-sync').textContent==='Letzter erfolgreicher Abgleich: 02.11.2026, 13:34:56'`);
 await c.evaluate(String.raw`__settingsBtpObserver.disconnect();document.querySelector('[name="btp_autofetch_enabled"]').click();`);
 await verify('Automatic synchronization waits for its save before enabling the seconds control', String.raw`document.querySelector('[name="btp_autofetch_timeout_intervall"]').disabled&&__settingsCommands.at(-1).field==='btp_autofetch_enabled'&&__settingsCommands.at(-1).value===true`);
 await c.evaluate(String.raw`(()=>{__settingsReply('btp_autofetch_enabled');const interval=document.querySelector('[name="btp_autofetch_timeout_intervall"]');interval.value='0:45';interval.dispatchEvent(new Event('change'));})()`);
 await verify('The redesigned interval displays minutes and saves numeric seconds without multiplying them', String.raw`!document.querySelector('[name="btp_autofetch_timeout_intervall"]').disabled&&__settingsCommands.at(-1).field==='btp_autofetch_timeout_intervall'&&__settingsCommands.at(-1).value===45&&document.querySelector('.settings-btp .settings-field-unit').textContent==='Minuten'`);
 await c.evaluate(String.raw`(()=>{__settingsReply('btp_autofetch_timeout_intervall');const interval=document.querySelector('[name="btp_autofetch_timeout_intervall"]');interval.value='1:30';interval.dispatchEvent(new Event('change'));__settingsReply('btp_autofetch_timeout_intervall',{message:'Synthetic interval failure'});})()`);
 await verify('A failed interval save restores the previous seconds in the existing control', String.raw`document.querySelector('[name="btp_autofetch_timeout_intervall"]').value==='0:45'&&curt.btp_autofetch_timeout_intervall===45&&!!document.querySelector('.settings-save-status .live_settings_status_error')`);
 await c.evaluate(String.raw`(()=>{const zone=document.querySelector('[name="btp_timezone"]');zone.value='Europe/London';zone.dispatchEvent(new Event('change'));})()`);
 await verify('An explicit BTP time zone uses the original property and zone identifier', String.raw`__settingsCommands.at(-1).field==='btp_timezone'&&__settingsCommands.at(-1).value==='Europe/London'`);
 await c.evaluate(String.raw`(()=>{__settingsReply('btp_timezone');const zone=document.querySelector('[name="btp_timezone"]');zone.value='system';zone.dispatchEvent(new Event('change'));})()`);
 await verify('The system-zone option still sends its original sentinel', String.raw`__settingsCommands.at(-1).field==='btp_timezone'&&__settingsCommands.at(-1).value==='system'`);
 await c.evaluate(String.raw`__settingsReply('btp_timezone');document.querySelector('[name="btp_readonly"]').click();__settingsReply('btp_readonly');`);
 await verify('Read-only BTP still permits importing manually while disabling write-only maintenance', String.raw`curt.btp_readonly===true&&!document.querySelector('[name="btp_fetch"]').disabled&&document.querySelector('[name="player_pause_reset"]').disabled&&document.querySelector('[name="court_assignments_reset"]').disabled`);
 await c.evaluate(String.raw`document.querySelector('[name="btp_readonly"]').click();__settingsReply('btp_readonly');document.querySelector('[name="btp_autofetch_enabled"]').click();__settingsReply('btp_autofetch_enabled');document.querySelector('[name="btp_fetch"]').click();document.querySelector('[name="btp_fetch"]').click();`);
 await verify('Manual synchronization works with automatic fetch disabled and blocks duplicate requests', String.raw`curt.btp_autofetch_enabled===false&&__settingsFetchRequests.length===1&&__settingsFetchRequests[0].type==='btp_fetch'&&__settingsFetchRequests[0].tournament_key==='preview'&&document.querySelector('[name="btp_fetch"]').disabled&&document.querySelector('[name="btp_fetch"]').getAttribute('aria-busy')==='true'&&document.querySelector('.settings-btp-status').textContent==='Abgleich läuft …'`);
 await c.evaluate(String.raw`__settingsBtpStatus({status:'connected',fetch_in_progress:true});__settingsFetchReply(null);`);
 await verify('Acknowledging a manual request keeps the button disabled while BTP is still fetching', String.raw`document.querySelector('[name="btp_fetch"]').disabled&&document.querySelector('[name="btp_fetch"]').getAttribute('aria-busy')==='true'`);
 await c.evaluate(String.raw`window.__settingsSyncIcon=document.querySelector('.settings-btp-sync .ico');window.__settingsSyncTransform=getComputedStyle(__settingsSyncIcon).transform;`);
 await c.evaluate('(async()=>{await new Promise(resolve=>setTimeout(resolve,150));})()');
 await verify('While fetching the manual icon actually rotates around its center like the header icon', String.raw`(()=>{const style=getComputedStyle(__settingsSyncIcon),header=getComputedStyle(document.querySelector('.toprow_btp_sync_button .ico'));return style.animationName==='leitstand-btp-sync'&&style.animationName===header.animationName&&style.animationDuration===header.animationDuration&&style.transformBox==='fill-box'&&style.transformOrigin.split(' ').every(value=>parseFloat(value)>0)&&style.transform!==__settingsSyncTransform&&document.querySelector('.settings-btp-last-sync').textContent==='Letzter erfolgreicher Abgleich: 02.11.2026, 13:34:56';})()`);
 await c.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await verify('Both BTP icons respect the reduced-motion preference during a fetch', String.raw`getComputedStyle(__settingsSyncIcon).animationName==='none'&&getComputedStyle(document.querySelector('.toprow_btp_sync_button .ico')).animationName==='none'`);
 await c.call('Emulation.setEmulatedMedia',{features:[]});
 await c.evaluate(String.raw`__settingsBtpStatus({status:'connected',fetch_in_progress:false,last_successful_fetch_ts:__settingsLastSuccess+60000});document.querySelector('[name="btp_fetch"]').click();__settingsFetchReply({message:'Synthetic fetch request failure'});`);
 await verify('A failed manual request releases the pending button for another attempt', String.raw`__settingsFetchRequests.length===2&&!document.querySelector('[name="btp_fetch"]').disabled&&document.querySelector('[name="btp_fetch"]').getAttribute('aria-busy')==='false'`);
 await verify('A completed success updates the existing time label and later failures preserve it with an idle icon', String.raw`document.querySelector('.settings-btp-last-sync')===__settingsLastSyncNode&&__settingsLastSyncNode.textContent==='Letzter erfolgreicher Abgleich: 02.11.2026, 13:35:56'&&getComputedStyle(__settingsSyncIcon).animationName==='none'`);
 await c.evaluate(String.raw`document.querySelector('[name="btp_enabled"]').click();__settingsReply('btp_enabled');document.querySelector('[name="btp_fetch"]').click();`);
 await verify('Disabling BTP locks dependent fields and manual fetch without losing their values', String.raw`!curt.btp_enabled&&['btp_ip','btp_password','btp_timezone','btp_autofetch_enabled','btp_readonly','btp_autofetch_timeout_intervall','btp_fetch'].every(name=>document.querySelector('[name="'+name+'"]').disabled)&&document.querySelector('.settings-btp-status').textContent==='Deaktiviert'&&__settingsFetchRequests.length===2&&document.querySelector('[name="btp_autofetch_timeout_intervall"]').value==='0:45'`);
 await c.evaluate(String.raw`document.querySelector('[name="btp_enabled"]').click();__settingsReply('btp_enabled');document.querySelector('[name="btp_password"]').focus();document.querySelector('[name="btp_password"]').value='fixture-password';__settingsSection('general');`);
 await verify('Leaving the password field keeps its existing blur-save behavior', String.raw`__settingsCommands.at(-1).field==='btp_password'&&__settingsCommands.at(-1).value==='fixture-password'`);
 await c.evaluate(String.raw`(async()=>{__settingsReply('btp_password');__settingsSection('btp');await Promise.all([...document.querySelectorAll('.settings-area-link')].flatMap(node=>node.getAnimations()).map(animation=>animation.finished));})()`);
 await capture('einstellungen-btp');
 await require('./settings-flow-check.js')({c,verify,key,capture});
 await require('./settings-duration-check.js')({c,verify,key,capture});
 await c.evaluate(String.raw`const ip=document.querySelector('[name="btp_ip"]');ip.value='192.0.2.10';ip.dispatchEvent(new Event('blur'));__settingsSection('ticker');__settingsReply('btp_ip',{message:'Synthetic settings save failure'});`);
 await verify('A failed save stays visible across areas and restores the original field value', String.raw`document.querySelector('.settings-save-status .live_settings_status_error')&&document.querySelector('[name="btp_ip"]').value===(curt.btp_ip||'')&&__settingsPage().dataset.settingsSection==='ticker'`);
 await c.evaluate(String.raw`document.querySelector('[name="ticker_enabled"]').click();__settingsReply('ticker_enabled');`);
 await verify('Ticker retains its independent switch and dependency rules', String.raw`curt.ticker_enabled===true&&curt.btp_enabled===true&&!document.querySelector('[name="ticker_url"]').disabled&&!document.querySelector('[name="ticker_password"]').disabled`);
 await c.evaluate('__settingsSection("btp");__settingsSection("ticker");history.back()');await eventually('location.pathname.endsWith("/edit/btp")');
 await verify('Browser Back selects the previous area without rebuilding controls', String.raw`__settingsPage().dataset.settingsSection==='btp'&&__settingsNodes.every(node=>node.isConnected)&&document.querySelector('.settings-area-link[aria-current]').getAttribute('href').endsWith('/edit/btp')`);
 await c.evaluate('history.forward()');await eventually('location.pathname.endsWith("/edit/ticker")');
 await verify('Browser Forward restores the selected area', String.raw`__settingsPage().dataset.settingsSection==='ticker'&&document.querySelector('[name="settings_section"]').value==='ticker'`);
 await c.evaluate(String.raw`__settingsSection('general');document.querySelector('.settings-area-link[href$="/edit/btp"]').focus()`);await key('Enter','Enter',13);
 await verify('Area links support ordinary keyboard navigation', String.raw`__settingsPage().dataset.settingsSection==='btp'&&location.pathname.endsWith('/edit/btp')`);
 await c.evaluate('__settingsSection("general");document.activeElement.blur()');
 await c.evaluate('(async()=>{await Promise.all([...document.querySelectorAll(".settings-area-link")].flatMap(node=>node.getAnimations()).map(animation=>animation.finished));})()');await capture('einstellungen-allgemein');
 for (const width of [1920,1280,950,390,320]) {
  await metrics(width,900);
  for (const section of ['general','btp','flow','calls','officials','locations','ticker','maintenance','debug']) {
   await c.evaluate('__settingsSection('+JSON.stringify(section)+')');
   if(section==='debug') await c.evaluate('__settingsSetClock("offset")');
   await verify(section+' fits the settings page at '+width, String.raw`(()=>{const page=__settingsPage().getBoundingClientRect(),panel=document.querySelector('.settings-panel:not([hidden])').getBoundingClientRect(),footer=document.querySelector('.settings-footer').getBoundingClientRect(),select=document.querySelector('[name="settings_section"]');return page.left>=0&&page.right<=innerWidth+.5&&panel.left>=page.left&&panel.right<=page.right+.5&&document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.toprow').getBoundingClientRect().height<=89&&footer.left>=0&&footer.right<=innerWidth+.5&&`+(width>950?String.raw`getComputedStyle(document.querySelector('.settings-navigation')).display!=='none'&&document.querySelector('.settings-navigation').getBoundingClientRect().right<panel.left`:String.raw`getComputedStyle(document.querySelector('.settings-navigation')).display==='none'&&select.getBoundingClientRect().width>0`)+String.raw`;})()`);
   if (['general','btp','flow','calls','officials','debug'].includes(section)) {
    await verify(section+' form rows and controls remain inside their cards at '+width, String.raw`(()=>{return [...document.querySelectorAll('.settings-panel:not([hidden]) .settings-row')].filter(row=>row.getBoundingClientRect().height).every(row=>{const box=row.getBoundingClientRect(),label=row.querySelector('.settings-field-label').getBoundingClientRect(),controls=[...row.querySelectorAll('input,select,button')].map(node=>node.getBoundingClientRect());return label.left>=box.left&&label.right<=box.right+.5&&controls.every(control=>control.left>=box.left&&control.right<=box.right+.5&&`+(width<=700?'control.top>=label.bottom':'control.left>=label.right')+String.raw`);});})()`);
    if(width===390&&section==='general') await capture('einstellungen-allgemein-mobil');
    if(width===390&&section==='btp') await capture('einstellungen-btp-mobil');
    if(width===390&&section==='flow') await capture('einstellungen-ablauf-mobil');
    if(width===390&&section==='calls') await capture('einstellungen-aufrufe-mobil');
    if(width===390&&section==='officials') await capture('einstellungen-tabletbedienung-offizielle-mobil');
    if(section==='debug') await c.evaluate('__settingsSetClock("real")');
   }
  }
  await verify('Settings workspace and footer retain the shared width limit at '+width, String.raw`(()=>{const content=document.querySelector('.settings-workspace').getBoundingClientRect(),footer=document.querySelector('.settings-footer').getBoundingClientRect();return content.width<=1440&&Math.abs(content.width-footer.width)<1&&Math.abs(content.left-footer.left)<1;})()`);
  samples.push(await c.evaluate('({width:innerWidth,section:__settingsPage().dataset.settingsSection,pageWidth:document.documentElement.scrollWidth,headerHeight:document.querySelector(".toprow").offsetHeight})'));
 }
 await c.evaluate(String.raw`const select=document.querySelector('[name="settings_section"]');select.value='speech';select.dispatchEvent(new Event('change',{bubbles:true}));`);
 await verify('The narrow-screen selector opens the same area with preserved controls', String.raw`location.pathname.endsWith('/edit/speech')&&__settingsPage().dataset.settingsSection==='speech'&&__settingsNodes.every(node=>node.isConnected)`);
 await capture('einstellungen-mobil');
 await metrics(1920,700);await c.evaluate('__settingsSection("calls");window.scrollTo(0,document.documentElement.scrollHeight)');
 await verify('Long settings keep the save status below the header and clear of the navigation', String.raw`(()=>{const nav=document.querySelector('.settings-navigation').getBoundingClientRect(),top=document.querySelector('.toprow').getBoundingClientRect(),footer=document.querySelector('.settings-footer').getBoundingClientRect(),status=document.querySelector('.settings-save-status').getBoundingClientRect();return status.top>=top.bottom&&status.bottom<innerHeight&&nav.top>=status.bottom&&nav.bottom<=footer.top+1&&footer.bottom<=innerHeight+1;})()`);
 await c.evaluate(String.raw`__flowSaved('official_rotation_enabled');__flowSaved('official_rotation_selected_mode','umpire_only');document.querySelector('.leitstand-nav a[href$="/certificates"]').click()`);
 await verify('Switching to certificates disposes settings without disturbing the shared header or playback', String.raw`!__settingsPage()&&document.querySelector('.page-certificates')&&document.body.classList.contains('leitstand-view')&&document.querySelector('.board-page-title').textContent==='BTS – Urkunden'&&announcementPlaybackActive&&__settingsCancels===0&&__settingsUnloads===0&&__localAnnouncements.length===1`);
 await verify('Certificate tabs and content align with the settings width and highlight on the corresponding edge', String.raw`(()=>{const content=document.querySelector('.certificate-export-form').getBoundingClientRect(),tabs=document.querySelector('.certificate-workspace-tabs'),tab=getComputedStyle(tabs.querySelector('[aria-selected="true"]'));return Math.abs(content.width-__settingsContentBounds.width)<1&&Math.abs(content.left-(document.documentElement.clientWidth-content.width)/2)<1&&Math.abs(tabs.getBoundingClientRect().width-content.width)<1&&Math.abs(tabs.getBoundingClientRect().left-content.left)<1&&getComputedStyle(tabs).borderBottomWidth==='1px'&&tab.borderBottomWidth==='2px'&&tab.borderBottomColor==='rgb(14, 90, 99)';})()`);
 await click('.leitstand-nav a[href$="/edit"]');await eventually('!!__settingsPage()');
 await verify('Returning from certificates recreates one settings workspace with saved values', String.raw`document.querySelectorAll('.page-settings').length===1&&document.querySelectorAll('.settings-area-link').length===14&&document.querySelector('.board-page-title').textContent==='BTS – Einstellungen'&&document.querySelector('[name="name"]').value==='Geänderter Turniername'&&document.body.classList.contains('leitstand-view')`);
 await verify('Recreating the settings workspace keeps the server-provided successful sync time', String.raw`document.querySelector('.settings-btp-last-sync').textContent==='Letzter erfolgreicher Abgleich: 02.11.2026, 13:35:56'`);
 await verify('Recreating settings preserves values configured while paused, including a zero-second tablet break', String.raw`document.querySelector('[name="tabletoperator_break_seconds"]').value==='0:00'&&curt.tabletoperator_break_seconds===0&&document.querySelector('[name="preparation_call_time_limit_before_scheduled_minutes"]').value==='40:00'&&document.querySelector('[name="call_on_court_only_preparation_minutes"]').value==='3:00'&&document.querySelector('[name="technical_official_break_after_assignment_seconds"]').value==='2:00'`);
 await verify('Recreating settings retains the paused rotation and the mode selected during the pause', String.raw`curt.official_rotation_mode==='disabled'&&!document.querySelector('[name="official_rotation_enabled"]').checked&&document.querySelector('[name="official_rotation_selected_mode"]').value==='umpire_only'&&!document.querySelector('[name="official_rotation_selected_mode"]').disabled`);
 await c.evaluate(String.raw`__flowSaved('official_rotation_enabled');`);
 await verify('The recreated rotation switch reactivates the persisted single-umpire mode', String.raw`curt.official_rotation_mode==='umpire_only'&&__settingsCommands.at(-1).field==='official_rotation_mode'&&__settingsCommands.at(-1).value==='umpire_only'&&document.querySelector('[name="official_rotation_enabled"]').checked`);
 await click('.settings-back-button');
 await verify('The footer returns to the board without restarting or cancelling playback', String.raw`!__settingsPage()&&document.querySelector('.page-leitstand')&&document.querySelector('.board-page-title').textContent==='BTS – Turnierleitung'&&announcementPlaybackActive&&__settingsCancels===0&&__settingsUnloads===0&&__localAnnouncements.length===1`);
 await verify('Tournament control keeps its full window width beyond the administration limit', String.raw`(()=>{const page=document.querySelector('.page-leitstand').getBoundingClientRect();return page.width>1440&&Math.abs(page.width-document.documentElement.clientWidth)<1;})()`);
 await c.evaluate('window.__speechPlaybackGate=false;__releaseSpeechPlayback();crouting.navigate_to("t/preview/edit/ticker")');await eventually('!!__settingsPage()');
 await verify('A direct subsection route selects its area on a fresh workspace', String.raw`location.pathname.endsWith('/edit/ticker')&&__settingsPage().dataset.settingsSection==='ticker'&&document.querySelector('[name="ticker_enabled"]').checked`);
 await c.evaluate('crouting.navigate_to("t/preview/edit/unknown")');
 await verify('An unknown area falls back to general settings', String.raw`__settingsPage().dataset.settingsSection==='general'&&document.querySelector('.settings-area-link[aria-current]').getAttribute('href').endsWith('/edit')`);
 for (const route of ['registration_check','registration_control']) {
  await c.evaluate('crouting.navigate_to('+JSON.stringify('t/preview/'+route)+')');
  await verify(route+' shares the certificate content width', String.raw`(()=>{const content=document.querySelector('.registration_container').getBoundingClientRect();return Math.abs(content.width-1440)<1&&Math.abs(content.left-(document.documentElement.clientWidth-content.width)/2)<1;})()`);
 }
 for (const [label, filename, stylesheet] of [
  ['Devices and logs','static/diagnostics.html',null],
  ['Speech helpers','static/speech_helpers.html',null],
  ['Speech planning','docs/sprachgenerierung-reihenfolge.html','/static/css/speech_planning.css'],
 ]) {
  let html=fs.readFileSync(path.join(__dirname,'../../../..',filename),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  if (stylesheet) html=html.replace('</head>','<link rel="stylesheet" href="'+stylesheet+'"></head>');
  for (const width of [1920,390]) {
   await metrics(width,900);
   await c.evaluate('(async()=>{const frame=document.createElement("iframe");frame.id="admin-width-fixture";frame.setAttribute("sandbox","allow-same-origin");frame.style="position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;visibility:hidden";const loaded=new Promise(resolve=>frame.onload=resolve);frame.srcdoc='+JSON.stringify(html)+';document.body.append(frame);await loaded;'+(stylesheet?'frame.contentDocument.querySelector("main").className="app";':'')+'await frame.contentDocument.fonts.ready;})()');
   await verify(label+' uses the shared content width at '+width, String.raw`(()=>{const frame=document.getElementById('admin-width-fixture'),doc=frame.contentDocument,main=doc.querySelector('main'),style=frame.contentWindow.getComputedStyle(main),box=main.getBoundingClientRect(),content=box.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);return style.getPropertyValue('--admin-content-width').trim()==='1440px'&&content<=1440.5&&`+(width===1920?'Math.abs(content-1440)<1':'box.left>=0&&box.right<=doc.documentElement.clientWidth+1')+String.raw`;})()`);
   await c.evaluate('document.getElementById("admin-width-fixture").remove()');
  }
 }
 await metrics(1920,700);
 await c.evaluate('crouting.navigate_to("t/preview/edit/ticker");ctournament.refresh_current_view()');
 await verify('A deliberate settings refresh retains the selected area', String.raw`__settingsPage().dataset.settingsSection==='ticker'&&document.querySelector('[name="ticker_enabled"]').checked&&document.querySelectorAll('.settings-area-link').length===14`);
 const btsExpectedArea = area => area==='tabletoperators'?'officials':['preparation','court-call'].includes(area)?'calls':area;
 for (const area of ['ticker','calls','tabletoperators','officials','preparation','court-call']) {
  const expectedArea = btsExpectedArea(area);
  await c.evaluate('crouting.navigate_to('+JSON.stringify('t/preview/edit/'+area)+')');
  const beforeReload = c.events.length;
  await c.call('Page.reload');
  for (let i=0;!c.events.slice(beforeReload).some(event=>event.method==='Page.loadEventFired');i++) {
   if (i===200) throw new Error('Settings reload did not finish');
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  await c.evaluate(fs.readFileSync(path.join(__dirname,'fixture.js'),'utf8'));
  await eventually('!!document.querySelector(".page-settings")');
  await verify('Reloading '+area+' directly opens its requested settings page', String.raw`current_view==='edit'&&location.pathname.endsWith(`+JSON.stringify('/edit/'+expectedArea)+String.raw`)&&document.querySelector('.page-settings').dataset.settingsSection===`+JSON.stringify(expectedArea)+String.raw`&&document.querySelector('.board-page-title').textContent==='BTS – Einstellungen'&&document.querySelectorAll('.settings-area-link').length===14`);
 }
 await require('./settings-scoring-check.js')({c,open,metrics,key,capture,check:verify,previews});
 await require('./settings-duration-dialogs-check.js')({c,verify,capture});
 await require('./settings-duration-editing-check.js')({c,verify,key,capture});
 await require('./settings-speech-check.js')({c,open,metrics,capture,check:verify,previews});
 await require('./settings-locations-check.js')({c,open,metrics,key,capture,check:verify,previews});
 await require('./preparation-icons-check.js')({c,open,metrics,key,capture,check:verify,previews});
 await c.evaluate('document.querySelector(".main").remove()');
 await verify('Removing the settings owner releases the shared navigation and page lifetime', String.raw`!document.querySelector('.page-settings')&&!document.body.classList.contains('leitstand-view')&&!cleitstand.isUpdating()`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 if (exceptions.length) console.error(JSON.stringify(exceptions));
 await verify('Settings navigation produces no browser exceptions', String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'settings-workspace-verification.json'),JSON.stringify({date:new Date().toISOString().slice(0,10),checks,samples,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
