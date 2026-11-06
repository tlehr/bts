'use strict';
/* eslint no-undef: off -- The serialized callbacks execute in the browser fixture. */
const fs = require('fs'), path = require('path'), assert = require('assert');

module.exports = async function({c,open,metrics,check,capture,previews,key}) {
 const passed = [], run = fn => c.evaluate('(' + fn.toString() + ')()');
 const verify = async (name, fn) => {await check(name, '(' + fn.toString() + ')()');passed.push(name);};
 await open(1920,1050);await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await run(() => {
  curt.displaysettings[0].description = 'Spielzählung';curt.displaysettings[1].description = 'Hallenanzeige';
  curt.displaysettings.push({id:'check-in',description:'Check-in',devicemode:'umpire',tablet_mode:'self_check_in'},
   {id:'multi',description:'Mehrere Felder',devicemode:'display',displaymode_style:'tournament_overview_dm'});
  curt.locations.push({_id:'OT',name:'Andere Halle'});curt.courts.push({_id:'OT_1',num:'1',location_id:'OT',is_active:true});
  curt.displays.push({client_id:'client_with_underscores',hostname:'Check-in im Foyer',court_id:'',displaysetting_id:'check-in',online:true,panel_devicemode:'umpire'});
  curt.displays.find(item=>item.client_id==='21').battery.dischargingTime=14400;
  curt.displays.find(item=>item.client_id==='22').battery.chargingTime=5400;
  const now = Date.now();
  curt.displays.find(item=>item.client_id==='30').display_render_stats={ack_count:1,avg_roundtrip_ms:9,last_ack_ts:now-8000};
  window.__deviceSnapshot = {version:'test-version',now,verbose_until:0,store:{ready:true,error:null,dropped:0},commands:[],pages:[
   {id:'panel-page-21',device_id:'device-tablet-21',panel_client_id:'21',role:'umpire',label:'21',path:'/bup/',tournament_key:'preview',court_id:'CH_1',online:true,last_seen:now,version:'test-version',address:'192.0.2.21'},
   {id:'admin-page-21',device_id:'device-tablet-21',role:'admin',label:'Turnierleitung',path:'/admin/t/preview/',tournament_key:'preview',online:true,last_seen:now,version:'test-version',address:'192.0.2.21'},
   {id:'old-panel-page',device_id:'device-old',role:'umpire',label:'22',path:'/bup/',tournament_key:'preview',court_id:'CH_2',online:false,last_seen:now-60000,version:'old-version',address:'192.0.2.22'},
   {id:'check-in-page',device_id:'device-check-in',panel_client_id:'client_with_underscores',role:'umpire',label:'Foyer',path:'/bup/',tournament_key:'preview',online:true,last_seen:now,version:'test-version',address:'192.0.2.31'},
   {id:'other-tournament',device_id:'device-other',role:'admin',label:'Weiteres Turnier',path:'/admin/t/other/',tournament_key:'other',online:true,last_seen:now,version:'test-version',address:'192.0.2.40'}]};
  __deviceSnapshot.panel_contacts=[
   {client_id:'22',tournament_key:'preview',last_contact:now-15000},
   {client_id:'23',tournament_key:'preview',last_contact:now-10000},
   {client_id:'25',tournament_key:'preview',last_contact:now-30000},
   {client_id:'21',tournament_key:'preview',last_contact:now-60000},
   {client_id:'22',tournament_key:'other',last_contact:now+60000},
  ];
  window.__deviceLogs = [
   {id:'log-one',revision:1,level:'warn',source:'umpire',message:'Akku niedrig',page_id:'panel-page-21',device_id:'device-tablet-21',tournament_key:'preview',updated_at:now,count:1},
   {id:'log-two',revision:2,level:'error',source:'server',message:'Servermeldung <img src=x onerror=alert(1)>',tournament_key:'preview',updated_at:now+1,count:1},
   {id:'log-three',revision:3,level:'info',source:'admin',message:'Anmeldung aktualisiert',page_id:'admin-page-21',device_id:'device-tablet-21',tournament_key:'preview',updated_at:now+2,count:1}];
  window.__deviceRequests = [];window.__deviceWrites = [];window.__devicePending = [];window.__heldLogReplies = [];window.__heldSnapshots = [];window.__deviceSnapshotFail = false;
  const original = send;
  window.send = (message,callback) => {
   if (message.type === 'tournament_get') return setTimeout(() => callback(null,{tournament:structuredClone(curt)}),0);
   if (message.type.startsWith('diagnostics_')) {
    __deviceRequests.push(structuredClone(message));
    if (message.type === 'diagnostics_snapshot') {
     const reply = () => callback(null,__deviceSnapshotFail ? {diagnostics_error:'Testverbindung getrennt'} : {diagnostics:structuredClone(__deviceSnapshot)});
     if (window.__holdSnapshots) __heldSnapshots.push(reply);else setTimeout(reply,0);return;
    }
    if (message.type === 'diagnostics_logs') {
     const filter = message.filter || {};
     const matching = __deviceLogs.filter(item =>
      (!filter.page_id || item.page_id === filter.page_id) && (!filter.device_id || item.device_id === filter.device_id) &&
      (!filter.source || item.source === filter.source) && (!filter.level || item.level === filter.level) && (!filter.tournament_key || item.tournament_key === filter.tournament_key) &&
      (!filter.search || item.message.toLowerCase().includes(filter.search.toLowerCase()))).sort((a,b) => b.revision-a.revision);
     const selected = matching.filter(item => (!filter.cursor || item.revision > filter.cursor) && (filter.before_revision == null || item.revision < filter.before_revision));
     const limit = Math.min(200, filter.limit || 200), items = selected.slice(0,limit);
     let logs = {items,retained:__deviceLogs.length,cursor:Math.max(0,...__deviceLogs.map(item=>item.revision)),truncated:selected.length>limit,total:selected.length,matching_total:matching.length,next_before:selected.length>limit?items.at(-1).revision:null};
     if (filter.export) {window.__deviceExportRows=structuredClone(selected);logs={...logs,items:selected.slice(0,1),export_id:'export-fixture',next_offset:selected.length>1?1:null};}
     if (filter.export_id) {logs.items=__deviceExportRows.slice(filter.export_offset);logs.next_offset=null;}
     const reply=()=>callback(null,{logs});if(window.__holdLogs)__heldLogReplies.push(reply);else setTimeout(reply,0);return;
    }
   }
   if (['relocate_display','change_display_mode','display_delete','display_reset','diagnostics_reload','diagnostics_cancel','diagnostics_verbose'].includes(message.type)) {
    __deviceWrites.push(structuredClone(message));__devicePending.push({message,callback});return;
   }
   original(message,callback);
  };
  window.__deviceReply = (type,error=null) => {const index=__devicePending.findIndex(item=>item.message.type===type);if(index<0)throw new Error('Missing '+type);__devicePending.splice(index,1)[0].callback(error,{});};
  window.__deviceRow = id => [...document.querySelectorAll('.devices-assignments>tr')].find(row=>row.dataset.displayId===id);
  window.__deviceAction = (id,label) => [...__deviceRow(id).querySelectorAll('button')].find(node=>node.textContent===label);
  window.__deviceChange = (selector,value,type='change') => {const node=document.querySelector(selector);node.value=value;node.dispatchEvent(new Event(type,{bubbles:true}));};
  window.__devicePoll = async () => {const before=__deviceRequests.filter(item=>item.type==='diagnostics_snapshot').length;document.querySelector('.page-devices [name=device_search]').dispatchEvent(new Event('input'));const button=[...document.querySelectorAll('.devices-toolbar>.btn')].find(node=>node.textContent==='Aktualisieren');if(!button.disabled)button.click();for(let i=0;i<120;i++){if(__deviceRequests.filter(item=>item.type==='diagnostics_snapshot').length>before&&!button.disabled)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Poll did not finish');};
  document.querySelector('.leitstand-nav a[href$="/devices"]').click();
 });
 await verify('Device workspace has two tabs and keeps the tournament navigation', () => document.querySelectorAll('.devices-tabs [role=tab]').length===2&&document.querySelector('.board-page-title').textContent==='BTS – Geräte & Logs'&&document.querySelector('.devices-assignments').children.length===7);
 await run(async()=>{for(let i=0;i<100;i++){if(document.querySelector('.devices-topline .devices-status').classList.contains('is-online'))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('No live snapshot');});
 await verify('Connections, battery, surface and explicit diagnostic contact appear together', () => __deviceRow('21').querySelector('.devices-battery-value').textContent==='76 %'&&__deviceRow('21').textContent.includes('Verbunden')&&__deviceRow('21').textContent.includes('Spielzählung')&&!__deviceRow('21').textContent.includes('Noch nicht erfasst')&&__deviceRow('client_with_underscores').textContent.includes('Selbst-Check-in'));
 await verify('Battery graphics occupy a separate column rather than the device name', () => document.querySelector('.devices-assignments').closest('table').tHead.rows[0].cells[2].textContent==='Akku'&&[...document.querySelector('.devices-assignments').rows].every(row=>row.cells.length===7&&row.cells[2].querySelector('.devices-battery')&&!row.cells[0].querySelector('.devices-battery')));
 await verify('Device assignments have no picture previews, embedded documents or preview renderer', () => !document.querySelector('.page-devices iframe,.devices-preview-mark,.devices-preview-button,.devices-preview-dialog,.settings-profile-renderer')&&![...document.querySelector('.devices-assignments').closest('table').tHead.rows[0].cells].some(cell=>cell.textContent==='Vorschau'));
 assert(!c.events.some(event=>event.method==='Network.requestWillBeSent'&&new URL(event.params.request.url).pathname.startsWith('/bup/')),'Opening device management must not request the BUP preview application');
 await verify('Battery interiors are exactly 100 pixels wide and each percent fills one pixel', () => [['21',76],['22',25],['23',8]].every(([id,percent])=>__deviceRow(id).querySelector('.devices-battery-gauge').clientWidth===100&&__deviceRow(id).querySelector('.devices-battery-fill').getBoundingClientRect().width===percent));
 await verify('Percentages and charging bolts stay inside the taller battery', () => [...document.querySelectorAll('.devices-battery')].every(battery=>{
  const gauge=battery.querySelector('.devices-battery-gauge'), bounds=gauge.getBoundingClientRect();
  return gauge.clientHeight===30&&[...battery.querySelectorAll('.devices-battery-value,.devices-battery-charging')].filter(node=>node.getClientRects().length).every(node=>{
   const rect=node.getBoundingClientRect();return rect.left>=bounds.left&&rect.right<=bounds.right&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom;
  });
 }));
 await run(()=>{
  const device=curt.displays.find(item=>item.client_id==='21'),original=device.battery;
  window.__batteryWarningStates=[.09,.10,.24,.25].map(level=>{
   device.battery={level,charging:false};ctournament.update_display(device,{tablets:false});
   const battery=__deviceRow('21').querySelector('.devices-battery'),fill=getComputedStyle(battery.querySelector('.devices-battery-fill')),gauge=getComputedStyle(battery.querySelector('.devices-battery-gauge'));
   return {fill:fill.backgroundColor,gradient:fill.backgroundImage,track:gauge.backgroundColor,border:gauge.borderTopColor};
  });device.battery=original;ctournament.update_display(device,{tablets:false});
 });
 await verify('Battery warning thresholds use solid red below 10 percent, yellow below 25 and green from 25', () => __batteryWarningStates.every((item,index)=>item.gradient==='none'&&item.fill===['rgb(163, 54, 42)','rgb(223, 189, 63)','rgb(223, 189, 63)','rgb(50, 114, 87)'][index]));
 await verify('Low batteries keep their warning visible in the frame and empty track', () => __batteryWarningStates[0].border==='rgb(163, 54, 42)'&&__batteryWarningStates[0].track==='rgb(255, 240, 236)'&&__batteryWarningStates[1].border==='rgb(178, 139, 37)'&&__batteryWarningStates[1].track==='rgb(255, 246, 216)'&&__batteryWarningStates[3].track==='rgb(255, 255, 255)');
 await verify('Charging is identified by a visible inline bolt and an accessible label', () => !__deviceRow('22').querySelector('.devices-battery-charging').hidden&&!!__deviceRow('22').querySelector('.devices-battery-gauge .devices-battery-charging svg')&&__deviceRow('22').querySelector('.devices-battery').getAttribute('aria-label').includes('wird geladen')&&__deviceRow('21').querySelector('.devices-battery-charging').hidden);
 await require('./battery-gif-check')({c,check:async(name,expression)=>{await check(name,expression);passed.push(name);},selector:'.devices-assignments>tr[data-display-id="22"] .devices-battery',width:100,height:30,asset:'battery-charge.gif'});
 await run(()=>{
  const device=curt.displays.find(item=>item.client_id==='22'),graphic=__deviceRow('22').querySelector('.devices-battery'),charge=graphic.querySelector('.devices-battery-charge'),source=getComputedStyle(charge).backgroundImage;
  ctournament.update_display(device,{tablets:false});
  window.__chargingPreserved=graphic.querySelector('.devices-battery-charge')===charge&&getComputedStyle(charge).backgroundImage===source;
 });
 await verify('Unchanged device polling preserves the shared charging GIF and its existing element', () => __chargingPreserved);
 await capture('geraete-ladeanimation',true);
 await run(()=>{
  const device=curt.displays.find(item=>item.client_id==='22'),original=device.battery;device.battery={level:.25,charging:false};ctournament.update_display(device,{tablets:false});
  const graphic=__deviceRow('22').querySelector('.devices-battery'),fill=graphic.querySelector('.devices-battery-fill');
  const charge=graphic.querySelector('.devices-battery-charge');
  window.__unpluggedBattery=charge.getAnimations().length===0&&getComputedStyle(charge).display==='none'&&fill.getBoundingClientRect().width===25&&graphic.querySelector('.devices-battery-charging').hidden;
  device.battery=original;ctournament.update_display(device,{tablets:false});
 });
 await verify('Unplugging stops the animation immediately at the real battery level', () => __unpluggedBattery);
 await c.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await verify('Reduced motion disables the charging animation while preserving the charge indication', () => getComputedStyle(__deviceRow('22').querySelector('.devices-battery-charge')).display==='none'&&getComputedStyle(__deviceRow('22').querySelector('.devices-battery-charge')).backgroundImage==='none'&&__deviceRow('22').querySelector('.devices-battery-fill').getBoundingClientRect().width===25&&!__deviceRow('22').querySelector('.devices-battery-charging').hidden);
 await c.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await verify('Devices without battery information show an unknown level rather than an empty battery', () => ['24','30'].every(id=>__deviceRow(id).querySelector('.devices-battery-value').textContent==='Nicht verfügbar'&&__deviceRow(id).querySelector('.devices-battery-fill').hidden&&__deviceRow(id).querySelector('.devices-battery').getAttribute('aria-label')==='Akkustand nicht verfügbar'));
 await verify('Remaining time appears below the graphic using the reported charge and discharge times', () => __deviceRow('21').querySelector('.devices-battery-estimate').textContent==='Bis Warnungca. 2 Std. 41 Min.'&&__deviceRow('22').querySelector('.devices-battery-estimate').textContent==='Bis vollca. 1 Std. 30 Min.'&&__deviceRow('21').querySelector('.devices-battery-estimate').getBoundingClientRect().top>=__deviceRow('21').querySelector('.devices-battery-gauge').getBoundingClientRect().bottom);
 await run(()=>{
  const device=curt.displays.find(item=>item.client_id==='21'),original=device.battery,online=device.online;
  const estimate=__deviceRow('21').querySelector('.devices-battery-estimate');
  const cases=[
   {level:.5,charging:true,chargingTime:5400},
   {level:.75,charging:false,dischargingTime:10800},
   {level:.2,charging:false,dischargingTime:1440},
   {level:.09,charging:false,dischargingTime:900},
   {level:.25,charging:false,dischargingTime:3600},
   {level:.1,charging:false,dischargingTime:3600},
   {level:1,charging:true,chargingTime:0},
   {level:0,charging:false,dischargingTime:0},
  ];
  window.__batteryEstimateCases=cases.map(data=>{device.battery=data;ctournament.update_display(device,{tablets:false});return estimate.textContent;});
  window.__invalidBatteryTimes=[null,Infinity,NaN,-1,0,undefined,'3600'].every(time=>[true,false].every(charging=>{
   device.battery={level:.5,charging,chargingTime:time,dischargingTime:time};ctournament.update_display(device,{tablets:false});return estimate.textContent.endsWith('nicht verfügbar');
  }));
  device.battery={level:.5,charging:true,chargingTime:7200};ctournament.update_display(device,{tablets:false});
  const graphic=__deviceRow('21').querySelector('.devices-battery'),charge=graphic.querySelector('.devices-battery-charge'),source=getComputedStyle(charge).backgroundImage;
  device.battery={level:.5,charging:true,chargingTime:3600};ctournament.update_display(device,{tablets:false});
  window.__batteryTimeOnlyUpdate=estimate.textContent==='Bis vollca. 1 Std.'&&__deviceRow('21').querySelector('.devices-battery-estimate')===estimate&&graphic.querySelector('.devices-battery-charge')===charge&&getComputedStyle(charge).backgroundImage===source;
  device.online=false;ctournament.update_display(device,{tablets:false});window.__offlineBatteryEstimate=estimate.textContent;
  device.online=online;device.battery=original;ctournament.update_display(device,{tablets:false});
 });
 await verify('Battery estimates select full charge, warning and reserve at the correct thresholds', () => __batteryEstimateCases.join('|')==='Bis vollca. 1 Std. 30 Min.|Bis Warnungca. 2 Std.|Bis Reserveca. 12 Min.|Reserve erreicht|Bis Warnung< 1 Min.|Bis Reserve< 1 Min.|Voll geladen|Reserve erreicht');
 await verify('Missing, infinite, zero and invalid reported times do not produce invented estimates', () => __invalidBatteryTimes);
 await verify('Changed time estimates update without restarting the charging animation or replacing their label', () => __batteryTimeOnlyUpdate);
 await verify('Offline devices do not show a current time estimate', () => __offlineBatteryEstimate==='Gerät getrennt'&&__deviceRow('25').querySelector('.devices-battery-estimate').textContent==='Gerät getrennt');
 await run(()=>{
  const device=curt.displays.find(item=>item.client_id==='21'), original=device.battery;
  const graphic=__deviceRow('21').querySelector('.devices-battery'), fill=graphic.querySelector('.devices-battery-fill');
  window.__batterySteps=[0,.01,.375,1].map(level=>{
   device.battery={level,charging:true};ctournament.update_display(device,{tablets:false});
   const bounds=graphic.querySelector('.devices-battery-gauge').getBoundingClientRect();
   return {width:fill.getBoundingClientRect().width,value:graphic.querySelector('.devices-battery-value').textContent,known:!fill.hidden,same:__deviceRow('21').querySelector('.devices-battery')===graphic,
    charging:[...graphic.querySelectorAll('.devices-battery-charging')].every(node=>!node.hidden),animated:getComputedStyle(graphic.querySelector('.devices-battery-charge')).display!=='none'&&getComputedStyle(graphic.querySelector('.devices-battery-charge')).backgroundImage!=='none',
    contained:[...graphic.querySelectorAll('.devices-battery-value,.devices-battery-charging')].every(node=>{const r=node.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right&&r.top>=bounds.top&&r.bottom<=bounds.bottom;})};
  });
  window.__invalidBatteryLevels=[-1,2,NaN,Infinity,null,undefined,'0.5'].map(level=>{
   device.battery={level};ctournament.update_display(device,{tablets:false});
   return fill.hidden&&graphic.querySelector('.devices-battery-value').textContent==='Nicht verfügbar'&&!graphic.textContent.includes('NaN');
  });
  device.battery=original;ctournament.update_display(device,{tablets:false});
 });
 await verify('Empty, fractional and full battery updates retain the graphic and fill the correct pixel count', () => __batterySteps.every((step,index)=>step.same&&step.known&&step.width===[0,1,38,100][index]&&step.value===[0,1,38,100][index]+' %'));
 await verify('Empty and full charging batteries keep the percentage and bolt inside the outline', () => __batterySteps.every(step=>step.charging&&step.contained));
 await verify('A full battery keeps the charging bolt without running an empty animation', () => __batterySteps.slice(0,3).every(step=>step.animated)&&!__batterySteps[3].animated);
 await verify('Invalid battery readings remain unavailable without producing overflowing fills', () => __invalidBatteryLevels.every(Boolean));
 await verify('A legacy page label does not associate browser logs with a protocol-only device', () => __deviceAction('22','Logs').disabled&&!__deviceAction('21','Logs').disabled);
 await verify('Tablet and display contacts appear without a matching browser page, scoped to their tournament', () => ['22','23','25'].every(id=>{
  const contact=__deviceSnapshot.panel_contacts.find(item=>item.client_id===id&&item.tournament_key==='preview');
  return __deviceRow(id).cells[1].querySelector('small').textContent==='Letzter Kontakt: '+new Date(contact.last_contact).toLocaleString('de-DE');
 }));
 await verify('Existing display ACK timestamps count as contact even before a protocol snapshot arrives', () => __deviceRow('30').cells[1].querySelector('small').textContent==='Letzter Kontakt: '+new Date(curt.displays.find(item=>item.client_id==='30').display_render_stats.last_ack_ts).toLocaleString('de-DE'));
 await verify('The newest browser or protocol contact wins and devices without either remain unknown', () => __deviceRow('21').cells[1].querySelector('small').textContent==='Letzter Kontakt: '+new Date(__deviceSnapshot.pages.find(item=>item.id==='panel-page-21').last_seen).toLocaleString('de-DE')&&__deviceRow('24').textContent.includes('Letzter Kontakt: Noch nicht erfasst'));
 await run(()=>{
  window.__contactRow=__deviceRow('22');__deviceSnapshot.panel_contacts.find(item=>item.client_id==='22'&&item.tournament_key==='preview').last_contact+=5000;
 });await run(()=>__devicePoll());
 await verify('Polling updates protocol contacts without replacing the device row or enabling unrelated logs', () => __deviceRow('22')===__contactRow&&__deviceRow('22').cells[1].querySelector('small').textContent==='Letzter Kontakt: '+new Date(__deviceSnapshot.panel_contacts.find(item=>item.client_id==='22'&&item.tournament_key==='preview').last_contact).toLocaleString('de-DE')&&__deviceAction('22','Logs').disabled);
 await run(()=>{
  window.__liveAckAt=__deviceSnapshot.now+5000;
  crouting.on_change({ctype:'display_render_stats',tournament_key:'preview',val:{client_id:'30',display_render_stats:{ack_count:2,avg_roundtrip_ms:8,last_ack_ts:__liveAckAt}}});
 });
 await verify('Incoming display confirmations update the visible contact immediately', () => __deviceRow('30').cells[1].querySelector('small').textContent==='Letzter Kontakt: '+new Date(__liveAckAt).toLocaleString('de-DE'));
 await run(()=>{const device=curt.displays.find(item=>item.client_id==='23');device.wait_for_done=true;ctournament.update_display(device,{tablets:false});});
 await capture('geraete-verbindungsfarben',true);
 await run(()=>{const device=curt.displays.find(item=>item.client_id==='23');device.wait_for_done=false;ctournament.update_display(device,{tablets:false});});
 await run(()=>{
  window.__keptDeviceRow=__deviceRow('21');window.__keptProfile=document.querySelector('[name=displaysettings_21]');window.__keptSearch=document.querySelector('[name=device_search]');window.__keptBattery=__deviceRow('21').querySelector('.devices-battery');
  const details=document.querySelector('[data-device-id="device-tablet-21"]');details.open=true;window.__keptBrowser=details;
  __keptProfile.focus();__keptProfile.value='check-in';
  crouting.on_change({ctype:'display_status_changed',tournament_key:'preview',val:{display_court_displaysetting:{client_id:'21',battery:{level:.5}}}});
 });
 await run(()=>__devicePoll());
 await verify('Polling and live score metadata preserve focused inputs and open browser groups', () => __deviceRow('21')===__keptDeviceRow&&document.querySelector('[name=displaysettings_21]')===__keptProfile&&__keptProfile.value==='check-in'&&document.activeElement===__keptProfile&&__keptBrowser.open&&__keptSearch.isConnected&&__deviceRow('21').querySelector('.devices-battery')===__keptBattery&&__keptBattery.querySelector('.devices-battery-value').textContent==='50 %'&&__keptBattery.querySelector('.devices-battery-fill').getBoundingClientRect().width===50);
 await run(()=>crouting.on_change({ctype:'update_display_setting',tournament_key:'preview',val:{setting:{id:'new-profile',devicemode:'umpire',description:'Zusätzliches Profil'}}}));
 await verify('A live change to available profiles preserves the focused draft selection', () => __keptProfile.value==='check-in'&&[...__keptProfile.options].some(option=>option.value==='new-profile'));
 await run(()=>{__keptProfile.dispatchEvent(new Event('change',{bubbles:true}));__keptProfile.dispatchEvent(new Event('change',{bubbles:true}));});
 await run(()=>__devicePoll());
 await verify('Profile assignment locks only its row and suppresses duplicate writes across polls', () => __deviceWrites.filter(item=>item.type==='change_display_mode').length===1&&__keptProfile.disabled&&document.querySelector('[name=court_21]').disabled&&!document.querySelector('[name=displaysettings_22]').disabled);
 await run(()=>__deviceReply('change_display_mode',{message:'Speichern abgelehnt'}));
 await verify('A failed assignment restores its saved value with an inline explanation', () => !__keptProfile.disabled&&__keptProfile.value==='tablet-profile'&&__deviceRow('21').textContent.includes('Speichern abgelehnt'));
 await run(()=>{__deviceChange('[name=displaysettings_client_with_underscores]','tablet-profile');__deviceReply('change_display_mode');});
 await verify('Client IDs containing underscores reach the existing assignment command intact', () => __deviceWrites.filter(item=>item.type==='change_display_mode').at(-1).display_setting_id==='client_with_underscores'&&curt.displays.find(item=>item.client_id==='client_with_underscores').displaysetting_id==='tablet-profile');
 await run(()=>{__deviceChange('[name=court_21]','OT_1');__deviceReply('relocate_display');});
 await verify('Court selection identifies the hall and preserves fields with duplicate numbers', () => document.querySelector('[name=court_21]').selectedOptions[0].textContent==='Andere Halle · Feld 1'&&__deviceWrites.filter(item=>item.type==='relocate_display').at(-1).new_court_id==='OT_1');
 await run(()=>{
  __deviceChange('[name=displaysettings_30]','multi');
  crouting.on_change({ctype:'display_status_changed',tournament_key:'preview',val:{display_court_displaysetting:{client_id:'30',displaysetting_id:'multi',court_id:'__multi__',panel_devicemode:'display'}}});
  __deviceReply('change_display_mode');
 });
 await verify('A display profile for several courts retains its server-provided assignment', () => document.querySelector('[name=court_30]').value==='__multi__'&&document.querySelector('[name=court_30]').selectedOptions[0].textContent.includes('Auswahl im Profil'));
 await verify('Offline assignments remain editable and removal is restricted to offline panels', () => !document.querySelector('[name=court_25]').disabled&&!document.querySelector('[name=displaysettings_25]').disabled&&!__deviceAction('25','Entfernen').disabled&&__deviceAction('21','Entfernen').disabled);
 await run(()=>{__deviceChange('[name=device_search]','FOYER','input');});
 await verify('Search matches names without changing assignments', () => [...document.querySelectorAll('.devices-assignments>tr')].filter(row=>!row.hidden).map(row=>row.dataset.displayId).join()==='client_with_underscores');
 await run(()=>{__deviceChange('[name=device_search]','','input');__deviceChange('[name=device_connection]','offline');});
 await verify('Connection filter includes offline panels and browser pages', () => [...document.querySelectorAll('.devices-assignments>tr')].filter(row=>!row.hidden).map(row=>row.dataset.displayId).join()==='25'&&!document.querySelector('[data-device-id="device-old"]').hidden&&document.querySelector('[data-device-id="device-tablet-21"]').hidden);
 await run(()=>{__deviceChange('[name=device_connection]','all');__deviceAction('21','Neu laden').click();});
 await run(()=>__devicePoll());
 await verify('A controlled reload targets the explicit page and stays locked while the request is open', () => __deviceWrites.at(-1).type==='diagnostics_reload'&&__deviceWrites.at(-1).scope==='page'&&__deviceWrites.at(-1).value==='panel-page-21'&&__deviceAction('21','Neu laden').disabled);
 await run(()=>{
  __deviceSnapshot.commands=[{id:'reload-one',at:Date.now(),scope:'page',targets:[{page_id:'panel-page-21',path:'/bup/',state:'waiting',reason:'Laufendes Spiel'}]}];
  __deviceReply('diagnostics_reload');
 });
 await run(()=>__devicePoll());
 await verify('Reload safeguards and progress remain visible with a cancellation action', () => document.querySelector('.devices-command').textContent.includes('Laufendes Spiel')&&document.querySelector('.devices-command button').textContent==='Ausstehende abbrechen');
 await run(()=>{document.querySelector('.devices-command button').click();__deviceReply('diagnostics_cancel');});
 await run(()=>{__deviceAction('25','Entfernen').click();});
 await verify('Removing an offline panel uses the shared modal and blur styling', () => !!document.querySelector('.bts-confirm-dialog:modal')&&getComputedStyle(document.querySelector('.bts-confirm-dialog'),'::backdrop').backdropFilter.includes('blur'));
 await run(()=>{document.querySelector('.bts-confirm-cancel').click();});
 await verify('Cancelling removal leaves the panel and its assignment unchanged', () => !!__deviceRow('25')&&!__deviceWrites.some(item=>item.type==='display_delete'));
 await run(()=>{__deviceAction('25','Entfernen').click();document.querySelector('.bts-confirm-accept').click();});
 await run(()=>__deviceReply('display_delete'));
 await verify('Confirmed removal uses the existing deletion command and removes exactly one offline panel', () => !__deviceRow('25')&&!!__deviceRow('21')&&__deviceWrites.find(item=>item.type==='display_delete').display_client_id==='25');
 await run(()=>{__deviceAction('21','Logs').click();});
 await run(async()=>{for(let i=0;i<100;i++){if(document.querySelectorAll('.devices-log-list>li').length===1)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Page logs did not load');});
 await verify('Panel logs open in the same workspace with an exact page filter', () => location.pathname.endsWith('/devices/logs')&&document.querySelector('.devices-tabs [aria-selected=true]').textContent==='Logs'&&document.querySelectorAll('.devices-log-list>li').length===1&&document.querySelector('.devices-log-list').textContent.includes('Akku niedrig')&&__deviceRequests.filter(item=>item.type==='diagnostics_logs').at(-1).filter.page_id==='panel-page-21');
 await run(()=>{document.querySelector('.devices-log-target button').click();});
 await run(async()=>{for(let i=0;i<100;i++){if(document.querySelectorAll('.devices-log-list>li').length===3)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('All logs did not load');});
 await verify('Logs show all sources in newest order and render server messages as plain text', () => document.querySelector('.devices-log-list>li:first-child').textContent.includes('Anmeldung aktualisiert')&&document.querySelector('.devices-log-list').textContent.includes('<img src=x onerror=alert(1)>')&&!document.querySelector('.devices-log-list img'));
 await run(()=>{
  const node=document.querySelector('.devices-log-list>li:first-child');node.querySelector('details').open=true;window.__keptLog=node;
  __deviceLogs[2].revision=4;__deviceLogs[2].count=2;__deviceLogs[2].updated_at=Date.now();
 });
 await run(()=>__devicePoll());
 await verify('Repeated log updates preserve the open row and display the updated count', () => __keptLog.isConnected&&__keptLog.querySelector('details').open&&__keptLog.textContent.includes('2×'));
 await run(()=>{document.querySelector('#devices-tab-devices').click();document.querySelector('[data-device-id="device-tablet-21"] .devices-row-actions button:nth-child(2)').click();});
 await run(async()=>{for(let i=0;i<100;i++){if(document.querySelectorAll('.devices-log-list>li').length===2)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Device logs did not load');});
 await verify('Device logs include multiple pages from the selected browser profile', () => document.querySelectorAll('.devices-log-list>li').length===2&&__deviceRequests.filter(item=>item.type==='diagnostics_logs').at(-1).filter.device_id==='device-tablet-21');
 await run(()=>{
  window.__oldCreateObjectURL=URL.createObjectURL;URL.createObjectURL=blob=>{window.__exportBlob=blob;return __oldCreateObjectURL(blob);};
  const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__exportName=this.download;else click.call(this);};
  [...document.querySelectorAll('.devices-toolbar>.btn')].find(node=>node.textContent==='Logs exportieren').click();
 });
 await run(async()=>{for(let i=0;i<150;i++){if(window.__exportBlob){window.__exportData=JSON.parse(await __exportBlob.text());return;}await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Export did not finish');});
 await verify('Export retains the exact device filter and retrieves all bounded result pages', () => __exportData.items.length===2&&__exportData.filters.device_id==='device-tablet-21'&&__exportName.endsWith('.json')&&__deviceRequests.some(item=>item.filter?.export_id==='export-fixture'));
 await run(()=>{document.querySelector('.devices-log-target button').click();__deviceChange('[name=log_level]','error');});
 await run(async()=>{for(let i=0;i<100;i++){if(document.querySelectorAll('.devices-log-list>li').length===1&&document.querySelector('.devices-log-list').textContent.includes('Servermeldung'))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Severity filter failed');});
 await verify('Severity filters update the query and displayed results', () => __deviceRequests.filter(item=>item.type==='diagnostics_logs').at(-1).filter.level==='error'&&document.querySelectorAll('.devices-log-list>li').length===1);
 await run(()=>{
  window.__holdLogs=true;
  [...document.querySelectorAll('.devices-toolbar>.btn')].find(node=>node.textContent==='Aktualisieren').click();
 });
 await run(async()=>{for(let i=0;i<100;i++){if(__heldLogReplies.length)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('No delayed logs');});
 await run(()=>{__deviceChange('[name=log_level]','warn');window.__holdLogs=false;__heldLogReplies.splice(0).forEach(reply=>reply());});
 await run(async()=>{for(let i=0;i<100;i++){if(document.querySelectorAll('.devices-log-list>li').length===1&&document.querySelector('.devices-log-list').textContent.includes('Akku niedrig'))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Changed log filter failed');});
 await verify('A delayed response from an earlier filter cannot restore obsolete log rows', () => !document.querySelector('.devices-log-list').textContent.includes('Servermeldung')&&__deviceRequests.filter(item=>item.type==='diagnostics_logs').at(-1).filter.level==='warn');
 await run(async()=>{
  // Finish the previous filter request before measuring requests made while paused.
  const refresh=[...document.querySelectorAll('.devices-toolbar>.btn')].find(node=>node.textContent==='Aktualisieren');
  for(let i=0;refresh.disabled;i++){if(i===200)throw new Error('Log filter did not settle before pausing');await new Promise(resolve=>setTimeout(resolve,20));}
  [...document.querySelectorAll('.devices-toolbar>.btn')].find(node=>node.textContent==='Live-Ansicht pausieren').click();
  window.__logRequestsBeforePause=__deviceRequests.filter(item=>item.type==='diagnostics_logs').length;
  __deviceLogs.push({id:'log-four',revision:5,level:'warn',source:'umpire',message:'Zweite Akkuwarnung',device_id:'device-tablet-21',updated_at:Date.now(),count:1});
 });await run(()=>__devicePoll());
 await verify('Pausing logs keeps the displayed history and continues connection monitoring', () => document.querySelectorAll('.devices-log-list>li').length===1&&__deviceRequests.filter(item=>item.type==='diagnostics_logs').length===__logRequestsBeforePause&&document.querySelector('.devices-topline .is-online'));
 await run(()=>[...document.querySelectorAll('.devices-toolbar>.btn')].find(node=>node.textContent==='Live-Ansicht fortsetzen').click());
 await run(async()=>{for(let i=0;i<100;i++){if(document.querySelectorAll('.devices-log-list>li').length===2)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Logs did not resume');});
 await verify('Resuming the log view retrieves messages that arrived during the pause', () => document.querySelector('.devices-log-list>li:first-child').textContent.includes('Zweite Akkuwarnung'));
 await run(()=>{
  window.__savedDeviceLogs=__deviceLogs;
  __deviceLogs=Array.from({length:125},(_,i)=>({id:'page-log-'+i,revision:1000+i,level:'info',source:'server',message:'Historie '+String(i).padStart(3,'0'),updated_at:Date.now(),count:1}));
  __deviceChange('[name=log_level]','');
 });
 const waitLogCount=async count=>run(async()=>{}).then(()=>c.evaluate(`(async()=>{for(let i=0;i<200;i++){if(document.querySelectorAll('.devices-log-list>li').length===${count}&&!document.querySelector('.devices-toolbar>.btn').disabled)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Wrong paginated log count: '+document.querySelectorAll('.devices-log-list>li').length)})()`));
 await waitLogCount(50);
 await verify('Logs initially request and display only the newest 50 matching messages',()=>document.querySelector('.devices-log-list>li:first-child').textContent.includes('Historie 124')&&document.querySelector('.devices-log-list>li:last-child').textContent.includes('Historie 075')&&!document.querySelector('.devices-log-pages').hidden&&__deviceRequests.filter(item=>item.type==='diagnostics_logs').at(-1).filter.limit===50);
 await run(()=>__deviceChange('[name=log_search]','Historie 000','input'));await waitLogCount(1);
 await verify('Log search includes messages outside the first page',()=>document.querySelector('.devices-log-list').textContent.includes('Historie 000')&&document.querySelector('.devices-log-pages').hidden);
 await run(()=>__deviceChange('[name=log_search]','','input'));await waitLogCount(50);
 await run(()=>{window.__firstPagedLog=document.querySelector('.devices-log-list>li');__firstPagedLog.querySelector('details').open=true;document.querySelector('.devices-log-pages button').click();});await waitLogCount(100);
 await verify('Loading older logs preserves open entries and uses an exclusive revision boundary',()=>__firstPagedLog.isConnected&&__firstPagedLog.querySelector('details').open&&__deviceRequests.filter(item=>item.type==='diagnostics_logs').at(-1).filter.before_revision===1075&&document.querySelector('.devices-log-list>li:last-child').textContent.includes('Historie 025'));
 await run(()=>{__deviceLogs.push({id:'live-page-new',revision:2000,level:'info',source:'server',message:'Live nach erster Seite',updated_at:Date.now(),count:1});});await run(()=>__devicePoll());
 await verify('Live arrivals retain the chosen 100-message window',()=>document.querySelectorAll('.devices-log-list>li').length===100&&document.querySelector('.devices-log-list>li:first-child').textContent.includes('Live nach erster Seite')&&document.querySelector('.devices-log-list>li:last-child').textContent.includes('Historie 026'));
 await run(()=>{__deviceLogs.push({id:'live-during-history',revision:2001,level:'info',source:'server',message:'Live während Historie',updated_at:Date.now(),count:1});document.querySelector('.devices-log-pages button').click();});await waitLogCount(126);
 await run(()=>__devicePoll());await waitLogCount(127);
 await verify('Loading history does not advance the live cursor past unseen arrivals or duplicate entries',()=>document.querySelector('.devices-log-list>li:first-child').textContent.includes('Live während Historie')&&document.querySelector('.devices-log-pages').hidden&&new Set([...document.querySelectorAll('.devices-log-list summary strong')].map(node=>node.textContent)).size===127);
 await run(()=>{
  __deviceLogs=Array.from({length:350},(_,i)=>({id:'burst-history-'+i,revision:3000+i,level:'info',source:'server',message:'Vorher '+i,updated_at:Date.now(),count:1}));
  __deviceChange('[name=log_level]','');
 });await waitLogCount(50);
 for(const count of [100,150,200,250]){await run(()=>document.querySelector('.devices-log-pages button').click());await waitLogCount(count);}
 await run(()=>{for(let i=0;i<260;i++)__deviceLogs.push({id:'burst-live-'+i,revision:10000+i,level:'info',source:'server',message:'Burst '+i,updated_at:Date.now(),count:1});});await run(()=>__devicePoll());
 await verify('A live burst beyond the transport cap fills the complete chosen window without gaps',()=>JSON.stringify([...document.querySelectorAll('.devices-log-list summary strong')].map(node=>node.textContent))===JSON.stringify(Array.from({length:250},(_,i)=>'Burst '+(259-i)))&&__deviceRequests.filter(item=>item.type==='diagnostics_logs'&&!item.filter.export_id&&!item.filter.export).every(item=>item.filter.limit<=200));
 await run(()=>{window.__holdLogs=true;document.querySelector('.devices-log-pages button').click();});
 await run(async()=>{for(let i=0;i<100;i++){if(__heldLogReplies.length)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('No delayed history');});
 await run(()=>{__deviceChange('[name=log_level]','warn');window.__holdLogs=false;__heldLogReplies.splice(0).forEach(reply=>reply());});await waitLogCount(0);
 await verify('Changing a filter rejects an older history response and resets its page size',()=>!document.querySelector('.devices-log-list').textContent.includes('Burst')&&document.querySelector('.devices-log-pages').hidden);
 await run(()=>{__deviceLogs=__savedDeviceLogs;__deviceChange('[name=log_level]','warn');});await waitLogCount(2);
 await run(()=>{document.querySelector('#devices-tab-devices').click();window.__deviceSnapshotFail=true;});await run(()=>__devicePoll());
 await verify('A connection failure marks the data stale and disables remote actions', () => document.querySelector('.devices-topline').textContent.includes('Stand veraltet')&&__deviceRow('21').querySelector('.devices-status').classList.contains('is-stale')&&__deviceAction('21','Neu laden').disabled&&!!document.querySelector('[name=displaysettings_21]'));
 await run(()=>{window.__deviceSnapshotFail=false;});await run(()=>__devicePoll());
 await verify('Reconnection restores live status and actions without replacing assignment inputs', () => document.querySelector('.devices-topline .devices-status').classList.contains('is-online')&&!__deviceAction('21','Neu laden').disabled&&document.querySelector('[name=displaysettings_21]')===__keptProfile);
 for (const width of [1920,1440,1024,768,390,320]) {
  await metrics(width,1000);
  await verify('Device workspace stays inside the viewport at '+width, () => document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.devices-workspace').getBoundingClientRect().right<=innerWidth+1);
  if(width===1920)await capture('geraete-uebersicht',true);
  if(width===390)await capture('geraete-uebersicht-mobil');
 }
 await metrics(1440,1000);await run(()=>document.querySelector('#devices-tab-logs').click());await capture('geraete-logs',true);
 await metrics(390,1000);await capture('geraete-logs-mobil');
 await verify('Log filters and messages fit a narrow viewport', () => document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.devices-log-filters input,.devices-log-filters select')].every(node=>node.getBoundingClientRect().right<=innerWidth+1));
 await metrics(1440,1000);await run(()=>{document.querySelector('#devices-tab-logs').focus();});await key('ArrowLeft','ArrowLeft',37);
 await verify('Arrow keys switch tabs and move keyboard focus', () => document.activeElement.id==='devices-tab-devices'&&document.querySelector('#devices-tab-devices').getAttribute('aria-selected')==='true');
 await run(()=>{window.__holdSnapshots=true;[...document.querySelectorAll('.devices-toolbar>.btn')].find(node=>node.textContent==='Aktualisieren').click();});
 await run(async()=>{for(let i=0;i<100;i++){if(__heldSnapshots.length)return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('No delayed snapshot');});
 await run(()=>{document.querySelector('.devices-related-link').click();window.__holdSnapshots=false;__heldSnapshots.splice(0).forEach(reply=>reply());});
 await run(async()=>{await new Promise(resolve=>setTimeout(resolve,2500));window.__deviceRequestsAfterLeaving=__deviceRequests.length;await new Promise(resolve=>setTimeout(resolve,2200));});
 await verify('Leaving for profile settings stops device polling and retains the document', () => location.pathname.endsWith('/edit/devices')&&!document.querySelector('.page-devices')&&__deviceRequests.length===__deviceRequestsAfterLeaving);
 const exceptions=c.events.filter(item=>item.method==='Runtime.exceptionThrown').map(item=>item.params.exceptionDetails.exception?.description||item.params.exceptionDetails.text);
 const failedAssets=c.events.filter(item=>item.method==='Network.responseReceived'&&item.params.response.status>=400).map(item=>item.params.response.url);
 if(exceptions.length)throw new Error(JSON.stringify(exceptions));
 if(failedAssets.length)throw new Error(JSON.stringify(failedAssets));
 fs.writeFileSync(path.join(previews,'devices-workspace-verification.json'),JSON.stringify({date:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'}),scope:'Echte Frontendmodule mit isolierten Beispieldaten und simulierten Diagnose- und Zuordnungsantworten. Keine produktiven Verbindungen oder Neuladeaufträge.',checks:passed,exceptions,failedAssets},null,2)+'\n');
};
