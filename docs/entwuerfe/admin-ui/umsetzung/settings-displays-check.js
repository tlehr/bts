'use strict';
/* eslint no-console: off */
const defaults = require('../../../../bts/displaysettings_defaults');

module.exports = async function({c, open, metrics, check, capture}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const verify = async(name, fn) => {
  try {await check(name, '(' + fn.toString() + ')()');}
  catch (error) {
   console.error(JSON.stringify(await run(() => ({path:location.pathname,html:document.querySelector('.settings-displays')?.innerHTML,
    dialog:document.querySelector('.display_setting_edit_dialog')?.outerHTML,writes:__profileWrites,errors:__profileErrors}))));
   throw error;
  }
 };
 await open(1440,1000);
 await c.call('Emulation.setFocusEmulationEnabled', {enabled:true});
 const display = {...defaults.build_default_display_setting({key:'preview'}), id:'display-profile', description:'Halle – Live'},
  tablet = {...defaults.build_default_tablet_setting({key:'preview'}), id:'tablet-profile', description:'Schiedsrichter'},
  other = {...display, id:'other-profile', description:'Foyer'},
  registration = defaults.build_default_registration_setting({key:'preview'});
 await c.evaluate('Object.assign(curt,' + JSON.stringify({displaysettings:[display,tablet,other,registration],
  displaysettings_general:'display-profile',displaysettings_general_tablet:'tablet-profile'}) + ')');
 await run(() => {
  window.__profileDocument=document;window.__profileSpeech=btsSpeechService;window.__profileCancels=0;window.__profileUnloads=0;
  window.__profileErrors=[];window.addEventListener('error',event=>__profileErrors.push(event.message));
  btsSpeechService.cancel=()=>__profileCancels++;window.addEventListener('beforeunload',()=>__profileUnloads++);
  window.__profileWrites=[];window.__profileReplies=[];const original=send;
  window.send=(message,callback)=>{
   if(['tournament_edit_prop','create_display_setting','edit_display_setting','delete_display_setting','relocate_display','change_display_mode'].includes(message.type)) {
    __profileWrites.push(structuredClone(message));__profileReplies.push({message,callback});return;
   }
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   original(message,callback);
  };
  window.__profileEmit=(ctype,val)=>crouting.on_change({ctype,val,tournament_key:curt.key});
  window.__profilePanel=()=>document.querySelector('.settings-displays');
  window.__profileRow=id=>[...__profilePanel().querySelectorAll('[data-displaysetting-id]')].find(row=>row.dataset.displaysettingId===id);
  window.__profileAction=(id,text)=>[...__profileRow(id).querySelectorAll('button')].find(node=>node.textContent===text);
  window.__profileForm=()=>document.querySelector('.display_setting_edit_dialog form');
  window.__profileName=value=>{const input=__profileForm().querySelector('[name=display_setting_description]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
  window.__profileReply=(type,error=null)=>{const index=__profileReplies.findIndex(entry=>entry.message.type===type);if(index<0)throw new Error('No pending '+type);__profileReplies.splice(index,1)[0].callback(error,{});};
  window.__speechPlaybackGate=true;const text=document.querySelector('#custom_announcement');
  text.value='Durchsage während der Profilverwaltung';text.dispatchEvent(new Event('input'));
  document.querySelector('#local_announce_btn').dataset.speechState='ready';document.querySelector('#local_announce_btn').click();
 });
 await run(async () => {for(let i=0;i<100;i++){if(typeof __releaseSpeechPlayback==='function')return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Playback did not start');});
 await run(() => document.querySelector('.leitstand-nav a[href$="/edit"]').click());
 await run(async () => {for(let i=0;i<100;i++){if(document.querySelector('.settings-area-link[href$="/edit/devices"]'))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Settings did not open');});
 await run(() => document.querySelector('.settings-area-link[href$="/edit/devices"]').click());
 await verify('One settings area contains separate profile tabs without device assignment controls', () =>
  __profilePanel().querySelectorAll('[role=tab]').length===2&&document.querySelector('.settings-area-link[href$="/edit/devices"]').textContent==='Oberflächen & Profile'&&
  !document.querySelector('.settings-area-link[href$="/edit/upcoming"]')&&!document.querySelector('.page-settings .display_tbody')&&
  __profilePanel().querySelectorAll('.settings-display-profile').length===4&&__profilePanel().querySelector('[role=tab][aria-selected=true]').textContent==='Anzeigen');
 await verify('Standards filter the device type, protect used profiles and show assignment counts', () =>
  __profilePanel().querySelector('[name=displaysettings_general]').options.length===2&&__profilePanel().querySelector('[name=displaysettings_general_tablet]').options.length===2&&
  __profileAction('display-profile','Löschen').disabled&&__profileAction('tablet-profile','Löschen').disabled&&!__profileAction('other-profile','Löschen').disabled&&
  __profileRow('display-profile').textContent.includes('1 Gerät zugeordnet')&&__profileRow('tablet-profile').textContent.includes('5 Geräte zugeordnet'));
 await run(() => {
  window.__profileRetained=[...__profilePanel().querySelectorAll('*')];window.__profileMutations=[];
  window.__profileObserver=new MutationObserver(records=>__profileMutations.push(...records));
  __profileObserver.observe(__profilePanel(),{attributes:true,childList:true,characterData:true,subtree:true});ctournament.update_general_displaysettings();
 });
 await verify('Identical live updates cause no DOM mutations and preserve profile controls', () => __profileMutations.length===0&&__profileRetained.every(node=>node.isConnected));
 await run(() => {
  __profileObserver.disconnect();const select=__profilePanel().querySelector('[name=displaysettings_general]');
  select.value='other-profile';select.dispatchEvent(new Event('change'));ctournament.update_general_displaysettings();
 });
 await verify('A pending standard choice survives other device updates', () =>
  __profileWrites.length===1&&__profileWrites[0].field==='displaysettings_general'&&__profileWrites[0].value==='other-profile'&&
  __profilePanel().querySelector('[name=displaysettings_general]').value==='other-profile'&&__profilePanel().querySelector('[name=displaysettings_general]').disabled);
 await run(() => __profileReply('tournament_edit_prop',{message:'Synthetic failure'}));
 await verify('A failed standard save restores the confirmed choice and enables retry', () =>
  __profilePanel().querySelector('[name=displaysettings_general]').value==='display-profile'&&!__profilePanel().querySelector('[name=displaysettings_general]').disabled&&!!document.querySelector('.live_settings_status_error'));
 await run(() => {
  __profilePanel().querySelectorAll('[role=tab]')[1].click();const select=__profilePanel().querySelector('[name=displaysettings_general_tablet]');
  select.value='preview_default_registration';select.dispatchEvent(new Event('change'));__profileReply('tournament_edit_prop');
 });
 await verify('The tablet standard updates its badge and protection without switching tabs', () =>
  curt.displaysettings_general_tablet==='preview_default_registration'&&__profilePanel().querySelector('[role=tab][aria-selected=true]').textContent==='Bedienoberflächen'&&
  !__profileRow('tablet-profile').querySelector('.settings-display-default').getClientRects().length&&__profileAction('preview_default_registration','Löschen').disabled&&
  __profileRow('preview_default_registration').querySelector('.settings-display-default').getClientRects().length>0);
 await run(() => {document.querySelector('.settings-area-link[href$="/edit/flow"]').click();document.querySelector('.settings-area-link[href$="/edit/devices"]').click();});
 await verify('Section navigation retains the active profile tab and controls', () =>
  __profilePanel().querySelector('[role=tab][aria-selected=true]').textContent==='Bedienoberflächen'&&__profileRetained.every(node=>node.isConnected));
 await run(() => __profileAction('tablet-profile','Bearbeiten').click());
 await verify('The native modal retains tablet previews and labeled duration controls', () =>
  !!document.querySelector('dialog.display_setting_edit_dialog:modal')&&__profileForm().querySelectorAll('iframe').length===2&&
  __profileForm().querySelector('[name=display_setting_description]').labels[0].textContent==='Profilname'&&__profileForm().querySelector('[name=network_timeout]').value==='0:10');
 await run(() => {
  __profileName('Schiedsrichter neu');window.__profileDraft=__profileForm();window.__profilePreview=__profileForm().querySelector('iframe');
  __profileEmit('display_status_changed',{display_court_displaysetting:{client_id:'22',battery:{level:.5}}});
 });
 await verify('Live device changes preserve the profile draft and preview frame', () =>
  __profileForm()===__profileDraft&&__profileForm().querySelector('iframe')===__profilePreview&&__profileForm().querySelector('[name=display_setting_description]').value==='Schiedsrichter neu');
 await run(() => {__profileForm().requestSubmit();__profileForm().requestSubmit();});
 await verify('Saving sends one complete profile command and blocks duplicate submissions', () =>
  __profileWrites.filter(message=>message.type==='edit_display_setting').length===1&&__profileWrites.at(-1).displaysetting.description==='Schiedsrichter neu'&&
  __profileWrites.at(-1).displaysetting.network_timeout==='10000'&&__profileForm().getAttribute('aria-busy')==='true');
 await run(() => __profileReply('edit_display_setting',{message:'Synthetic save failure'}));
 await verify('A failed profile save retains the draft and enables retry', () =>
  __profileForm()===__profileDraft&&document.querySelector('.display-setting-status').textContent==='Synthetic save failure'&&!__profileForm().querySelector('[type=submit]').disabled);
 await run(() => {__profileForm().requestSubmit();__profileReply('edit_display_setting');});
 await verify('A saved edit updates profile names and default choices without replacing the page', () =>
  !__profileForm()&&__profileRow('tablet-profile').querySelector('h3').textContent==='Schiedsrichter neu'&&
  [...__profilePanel().querySelector('[name=displaysettings_general_tablet]').options].some(option=>option.textContent==='Schiedsrichter neu')&&
  __profilePanel().querySelector('[role=tab][aria-selected=true]').textContent==='Bedienoberflächen');
 await run(() => {__profileAction('tablet-profile','Kopieren').click();__profileForm().requestSubmit();});
 await verify('An unchanged copy saves immediately with a new ID and the existing profile values', () =>
  __profileWrites.at(-1).type==='create_display_setting'&&__profileWrites.at(-1).displaysetting.id!=='tablet-profile'&&
  __profileWrites.at(-1).displaysetting.description==='Schiedsrichter neu Kopie'&&__profileWrites.at(-1).displaysetting.tablet_mode==='umpire'&&
  __profileWrites.at(-1).displaysetting.d_cbg==='#000000');
 await run(() => {__profileReply('create_display_setting');window.__profileCopyId=__profileWrites.at(-1).displaysetting.id;});
 await verify('A new profile appears in its group and standard selector', () =>
  !!__profileRow(__profileCopyId)&&[...__profilePanel().querySelector('[name=displaysettings_general_tablet]').options].some(option=>option.value===__profileCopyId)&&!__profileAction(__profileCopyId,'Löschen').disabled);
 await run(() => {
  __profilePanel().querySelectorAll('[role=tab]')[0].click();
  __profileEmit('display_status_changed',{display_court_displaysetting:{client_id:'new-monitor',displaysetting_id:'other-profile',online:true}});
 });
 await verify('A new device assignment immediately protects the assigned profile', () =>
  __profileAction('other-profile','Löschen').disabled&&__profileRow('other-profile').textContent.includes('1 Gerät zugeordnet'));
 await run(() => {__profileEmit('delete_display',{client_id:'new-monitor'});__profileAction('other-profile','Löschen').click();});
 await verify('An unused profile is deleted only after confirmation', () =>
  !!document.querySelector('.bts-confirm-dialog:modal')&&__profileWrites.filter(message=>message.type==='delete_display_setting').length===0);
 await run(() => document.querySelector('.bts-confirm-accept').click());
 await verify('Confirmed deletion sends the existing command and blocks duplicate clicks', () =>
  __profileWrites.at(-1).type==='delete_display_setting'&&__profileWrites.at(-1).setting_id==='other-profile'&&__profileAction('other-profile','Löschen').disabled);
 await run(() => {__profileEmit('delete_display_setting',{setting_id:'other-profile'});__profileReply('delete_display_setting');});
 await verify('Removed profiles disappear from the list and standard choices', () =>
  !__profileRow('other-profile')&&![...__profilePanel().querySelector('[name=displaysettings_general]').options].some(option=>option.value==='other-profile'));
 await run(() => {window.__profileDefaultBefore=structuredClone(curt.displaysettings.find(profile=>profile.id===curt.displaysettings_general));__profilePanel().querySelector('.settings-display-toolbar button').click();__profileForm().requestSubmit();__profileReply('create_display_setting');});
 await verify('A new profile can save its prefilled defaults without edits', () =>
  __profileWrites.at(-1).type==='create_display_setting'&&__profileWrites.at(-1).displaysetting.description==='Neues Anzeigeprofil'&&!!__profileRow(__profileWrites.at(-1).displaysetting.id)&&
  Object.entries(__profileDefaultBefore).filter(([name])=>!['id','description','_id'].includes(name)).every(([name,value])=>JSON.stringify(__profileWrites.at(-1).displaysetting[name])===JSON.stringify(value)));
 await run(() => {
  __profilePanel().querySelectorAll('[role=tab]')[1].click();
  document.querySelector('#settings-display-panel-umpire .settings-display-toolbar button').click();
  __profileName('Selbst-Check-in am PC');
  const purpose=__profileForm().querySelector('[name=tablet_mode]');purpose.value='self_check_in';purpose.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await run(async () => {for(let i=0;i<100;i++){if(document.querySelector('.display-setting-check-in-preview'))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Check-in preview did not appear');});
 await verify('The purpose is selected independently of the hardware, with a self-check-in preview', () =>
  __profileForm().querySelector('[name=devicemode]').selectedOptions[0].textContent==='Bedienoberfläche'&&
  __profileForm().querySelector('[name=tablet_mode]').labels[0].textContent.trim()==='Einsatzzweck:'&&
  !!__profileForm().querySelector('.display_setting_meta_section [name=tablet_mode]')&&
  !!__profileForm().querySelector('.display-setting-check-in-preview')&&
  !__profileForm().querySelector('.display_setting_primary_layout').getClientRects().length);
 await run(() => {__profileForm().requestSubmit();__profileReply('create_display_setting');});
 await verify('Additional purposes stay manually assigned profiles with exactly one display and one shared input default', () =>
  __profileWrites.at(-1).displaysetting.tablet_mode==='self_check_in'&&__profileWrites.at(-1).displaysetting.devicemode==='umpire'&&
  __profileRow(__profileWrites.at(-1).displaysetting.id).textContent.includes('Selbst-Check-in')&&
  curt.displaysettings_general==='display-profile'&&curt.displaysettings_general_tablet==='preview_default_registration'&&
  __profilePanel().querySelectorAll('select[name^=displaysettings_general]').length===2);
 await run(() => __profilePanel().querySelectorAll('[role=tab]')[0].click());
 for (const width of [1920,1280,950,390,320]) {
  await metrics(width,1000);
  await verify('Profile controls fit the viewport at '+width, () =>
   document.documentElement.scrollWidth<=innerWidth+1&&__profilePanel().scrollWidth<=__profilePanel().clientWidth+1&&
   [...__profilePanel().querySelectorAll('.settings-display-profile,button,select')].filter(node=>node.getClientRects().length).every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+.5;}));
  if (width===1920) await capture('einstellungen-anzeigen-profile',true);
  if (width===390) await capture('einstellungen-anzeigen-profile-mobil');
 }
 await metrics(1440,1000);
 await run(() => __profilePanel().querySelectorAll('[role=tab]')[1].click());await capture('einstellungen-tablet-profile',true);
 await run(() => __profileAction('tablet-profile','Bearbeiten').click());await capture('einstellungen-tablet-profil-dialog');
 await run(() => {__profileName('Nicht verwerfen');document.querySelector('.display_setting_edit_dialog .ls-dialog-close').click();});
 await verify('Closing a changed profile asks before discarding its draft', () =>
  !!document.querySelector('.bts-confirm-dialog:modal')&&__profileForm().querySelector('[name=display_setting_description]').value==='Nicht verwerfen');
 await run(() => document.querySelector('.bts-confirm-cancel').click());
 await verify('Rejecting discard retains the profile draft', () =>
  __profileForm().querySelector('[name=display_setting_description]').value==='Nicht verwerfen'&&!document.querySelector('.bts-confirm-dialog'));
 await run(() => document.querySelector('.display_setting_edit_dialog .ls-dialog-close').click());
 await run(() => document.querySelector('.bts-confirm-accept').click());
 await run(() => document.querySelector('.leitstand-nav a[href$="/devices"]').click());
 await verify('Device assignments are available outside settings with the shared header', () =>
  !!document.querySelector('.page-devices .display_tbody')&&document.querySelector('.board-page-title').textContent==='BTS – Geräte & Logs'&&
  document.querySelector('.leitstand-nav [aria-current]').textContent==='Geräte & Logs'&&curt.displays.find(device=>device.client_id==='21').court_id==='CH_1'&&
  curt.displays.find(device=>device.client_id==='21').displaysetting_id==='tablet-profile');
 await run(() => {const select=document.querySelector('[name=displaysettings_21]');select.value=__profileCopyId;select.dispatchEvent(new Event('change'));});
 await verify('Device profile assignment retains the existing command', () =>
  __profileWrites.at(-1).type==='change_display_mode'&&__profileWrites.at(-1).display_setting_id==='21'&&__profileWrites.at(-1).new_displaysettings_id===__profileCopyId);
 await run(() => {__profileReply('change_display_mode');document.querySelector('.leitstand-nav a[href$="/edit"]').click();crouting.navigate_to('t/preview/edit/upcoming');});
 await verify('The old web-view settings remain accessible with their original fields', () =>
  document.querySelector('.page-settings').dataset.settingsSection==='upcoming'&&document.querySelector('.settings-area-link[aria-current]').textContent==='Oberflächen & Profile'&&
  !!document.querySelector('[name=upcoming_matches_max_count]')&&!!document.querySelector('[name=self_check_in_called_overlay_duration_ms]'));
 await verify('Editing and navigation preserve the document and audio service without browser errors', () =>
  document===__profileDocument&&btsSpeechService===__profileSpeech&&announcementPlaybackActive&&__localAnnouncements.length===1&&__profileCancels===0&&__profileUnloads===0&&__profileErrors.length===0);
 await run(() => {window.__speechPlaybackGate=false;__releaseSpeechPlayback();});
};
