'use strict';
/* eslint no-console: off, no-undef: off */
const defaults = require('../../../../bts/displaysettings_defaults');
const assert = require('assert');

module.exports = async function({c, open, metrics, capture, check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const verify = (name, fn) => check(name, '(' + fn.toString() + ')()');
 const wait = async fn => {
  const result = await c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return true;await new Promise(resolve=>setTimeout(resolve,75));}return false;})()');
  if (!result) {console.log(JSON.stringify(await run(() => ({marks:[...document.querySelectorAll('.settings-display-mark')].map(node=>({state:node.dataset.previewState,html:node.innerHTML.slice(0,180)})),worker:document.querySelector('.settings-profile-renderer')?.contentDocument?.body?.innerText.slice(0,300),errors:__previewErrors}))));console.log(JSON.stringify(c.events.filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails)));throw new Error('Preview did not become ready');}
 };
 await open(1440,1000);
 const display = {...defaults.build_default_display_setting({key:'preview'}),id:'preview-display',description:'Hallenanzeige'},
  clean = {...display,id:'preview-clean',description:'Grüne Anzeige',displaymode_style:'clean',d_cbg:'#145c40'},
  umpire = {...defaults.build_default_tablet_setting({key:'preview'}),id:'preview-input',description:'Spielzählung'},
  scorecard = {...umpire,id:'preview-scorecard',description:'Zähltafel',tablet_mode:'scorecard'},
  registration = {...umpire,id:'preview-registration',description:'Anmeldung',tablet_mode:'registration_check'},
  checkin = {...umpire,id:'preview-checkin',description:'Selbst-Check-in',tablet_mode:'self_check_in'};
 await c.evaluate('Object.assign(curt,'+JSON.stringify({displaysettings:[display,clean,umpire,scorecard,registration,checkin],displaysettings_general:display.id,displaysettings_general_tablet:umpire.id,
  logo_id:'fixture-court.svg',logo_name:'Turnierlogo.svg'})+')');
 await run(() => {
  window.__previewStorage=localStorage.getItem('bup_settings');window.__previewDocument=document;window.__previewSpeech=btsSpeechService;
  window.__previewErrors=[];window.addEventListener('error',event=>__previewErrors.push(event.message));
  const original=send;window.send=(message,callback)=>message.type==='tournament_get'?setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0):original(message,callback);
  window.__previewRow=id=>document.querySelector('[data-displaysetting-id="'+id+'"]');
  window.__previewReady=id=>__previewRow(id)?.querySelector('.settings-display-mark').dataset.previewState==='ready';
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(() => !!document.querySelector('.settings-area-link[href$="/edit/devices"]'));
 await run(() => document.querySelector('.settings-area-link[href$="/edit/devices"]').click());
 for(const id of ['preview-display','preview-clean']) {
  await c.evaluate('__previewRow('+JSON.stringify(id)+').scrollIntoView({block:"center"})');
  await c.evaluate('(async()=>{for(let i=0;i<200;i++){if(__previewReady('+JSON.stringify(id)+'))return;await new Promise(resolve=>setTimeout(resolve,75));}throw new Error("Profile preview did not load");})()');
 }
 await capture('einstellungen-profilvorschau-anzeigen',true);
 await verify('Display thumbnails contain the real BUP renderer and saved layout settings', () => {
  const frame=__previewRow('preview-display').querySelector('iframe'), clean=__previewRow('preview-clean').querySelector('iframe');
  return !!frame.contentDocument.querySelector('.displaymode_layout')&&!!clean.contentDocument.querySelector('.d_layout_clean')&&
   clean.contentDocument.querySelector('.d_clean_team').style.backgroundColor==='rgb(20, 92, 64)'&&
   frame.contentDocument.body.textContent.includes('12')&&frame.contentDocument.body.textContent.includes('5');
 });
 await run(() => {window.__previewRetained=__previewRow('preview-display').querySelector('iframe');window.__previewHTML=__previewRetained.srcdoc;ctournament.update_general_displaysettings();});
 await verify('Identical updates retain the frozen frame and do not touch device settings', () =>
  __previewRow('preview-display').querySelector('iframe')===__previewRetained&&localStorage.getItem('bup_settings')===__previewStorage&&
  !__previewRetained.contentDocument.querySelector('script')&&!__previewRetained.contentDocument.querySelector('iframe')&&
  __previewRetained.getAttribute('sandbox')==='allow-same-origin');
 await run(() => {curt.displaysettings.find(item=>item.id==='preview-display').d_cbg='#222266';ctournament.update_general_displaysettings();});
 await wait(() => __previewRow('preview-display').querySelector('iframe')!==__previewRetained);
 await verify('Saved appearance changes replace only the changed snapshot', () =>
  __previewRow('preview-display').querySelector('iframe').srcdoc!==__previewHTML&&__previewReady('preview-clean'));
 await run(() => {
  window.__colorSavedProfile=structuredClone(curt.displaysettings.find(item=>item.id==='preview-display'));
  window.__colorSavedThumbnail=__previewRow('preview-display').querySelector('iframe');
  __previewRow('preview-display').querySelector('.settings-display-actions button').click();
  window.__colorPreviews=()=>[...document.querySelectorAll('.display_setting_edit_dialog .bup_preview_frame')];
  window.__colorChange=(name,value,eventType)=>{
   const input=document.querySelector('.display_setting_edit_dialog [name="'+name+'"]');input.value=value;input.dispatchEvent(new Event(eventType,{bubbles:true}));
  };
 });
 await wait(() => __colorPreviews().length===2&&__colorPreviews().every(frame=>frame._previewState?.sceneInitialized&&frame.contentDocument.querySelectorAll('.d_tournament').length===2));
 await run(() => {
  window.__logoReferenceFrame=__colorPreviews()[0];
  clearTimeout(__logoReferenceFrame._previewState.timerIntervalId);__logoReferenceFrame._previewState.timerIntervalId=null;
  const win=__logoReferenceFrame.contentWindow;
  win.displaymode.render_v2_tournamentcourt_display_state(win.state,{
   tournament:{name:curt.name,logo_url:document.querySelector('[name=logo_preview_img]').src},
   court:{id:win.state.settings.court_id,label:'1'},match:null,
  });
 });
 await wait(() => __logoReferenceFrame.contentDocument.querySelector('.d_nomatch img')?.complete);
 for (const width of [1440,390]) {
  await metrics(width,1000);
  await verify('Logo and court label match the actual BUP idle screen proportions at '+width+' px', () => {
   const preview=document.querySelector('[name=logo_preview]'), reference=__logoReferenceFrame.contentDocument.querySelector('.d_nomatch');
   const dimensions=(parent,node)=>{
    const box=parent.getBoundingClientRect(), rect=node.getBoundingClientRect();
    return [(rect.left-box.left)/box.width,(rect.top-box.top)/box.height,rect.width/box.width,rect.height/box.height];
   };
   return [[preview.querySelector('img'),reference.querySelector('img')],[preview.querySelector('span'),reference.querySelector('div')]]
    .every(([sample,actual])=>dimensions(preview,sample).every((value,index)=>Math.abs(value-dimensions(reference,actual)[index])<.01));
  });
 }
 await metrics(1440,1000);
 await run(() => {
  window.__colorFrames=__colorPreviews();
  __colorChange('c0','#efcf41','input');
 });
 await wait(() => __colorPreviews().every(frame=>frame.contentWindow.state.settings.d_c0==='#efcf41'));
 await verify('Choosing a color updates both rendered previews on input before saving', () =>
  __colorPreviews().every(frame=>frame.contentDocument.querySelector('.d_tournament').style.color==='rgb(239, 207, 65)'));
 await run(() => __colorChange('c1','#a474de','change'));
 await wait(() => __colorPreviews().every(frame=>frame.contentWindow.state.settings.d_c1==='#a474de'));
 await verify('A confirmed color change also updates both previews', () =>
  __colorPreviews().every(frame=>frame.contentDocument.querySelectorAll('.d_tournament')[1].style.color==='rgb(164, 116, 222)'));
 await run(() => __colorChange('cb0','#101d40','input'));
 await wait(() => __colorPreviews().every(frame=>frame.contentWindow.state.settings.d_cb0==='#101d40'));
 await verify('Background colors update without replacing or reloading the preview frames', () =>
  __colorPreviews().every((frame,index)=>frame===__colorFrames[index]&&frame.contentDocument.querySelector('.d_tournament').style.backgroundColor==='rgb(16, 29, 64)'));
 await verify('Color drafts leave the saved profile and its thumbnail unchanged', () =>
  JSON.stringify(curt.displaysettings.find(item=>item.id==='preview-display'))===JSON.stringify(__colorSavedProfile)&&
  __previewRow('preview-display').querySelector('iframe')===__colorSavedThumbnail);
 await capture('einstellungen-profil-farbvorschau');
 await run(() => document.querySelector('.display_setting_edit_dialog .ls-dialog-close').click());
 await wait(() => !!document.querySelector('.bts-confirm-accept'));
 await run(() => document.querySelector('.bts-confirm-accept').click());
 await wait(() => !document.querySelector('.display_setting_edit_dialog'));
 await run(() => {window.__previewStorage=localStorage.getItem('bup_settings');});
 await run(() => document.querySelector('#settings-display-tab-umpire').click());
 for(const id of ['preview-input','preview-scorecard','preview-registration','preview-checkin']) {
  await c.evaluate('__previewRow('+JSON.stringify(id)+').scrollIntoView({block:"center"})');
  await c.evaluate('(async()=>{for(let i=0;i<200;i++){if(__previewReady('+JSON.stringify(id)+'))return;await new Promise(resolve=>setTimeout(resolve,75));}throw new Error("Profile preview did not load");})()');
 }
 await verify('Input previews show scorekeeping, scorecards, registration and self-check-in', () =>
  __previewRow('preview-input').querySelector('iframe').contentDocument.querySelector('#settings_wrapper').getBoundingClientRect().height===0&&
  __previewRow('preview-scorecard').querySelector('iframe').contentDocument.querySelector('#settings_wrapper').getBoundingClientRect().height===0&&
  __previewRow('preview-input').querySelector('iframe').contentDocument.querySelector('#game').getBoundingClientRect().height>0&&
  __previewRow('preview-scorecard').querySelector('iframe').contentDocument.querySelector('.scorecard_container').getBoundingClientRect().height>0&&
  !!__previewRow('preview-registration').querySelector('iframe').contentDocument.querySelector('.display_setting_registration_page')&&
  !!__previewRow('preview-checkin').querySelector('iframe').contentDocument.querySelector('.self_check_in_container'));
 await verify('The self-check-in thumbnail uses the existing dark page with large ready and waiting name buttons', () => {
  const frame=__previewRow('preview-checkin').querySelector('iframe'), doc=frame.contentDocument, style=node=>frame.contentWindow.getComputedStyle(node);
  window.__previewCheckInColors={background:style(doc.querySelector('.main_self_check_in')).backgroundColor,
   ready:style(doc.querySelector('.self_check_in_chip_ready')).backgroundColor,waiting:style(doc.querySelector('.self_check_in_chip_waiting')).backgroundColor};
  return doc.querySelectorAll('.self_check_in_match').length===3&&__previewCheckInColors.background==='rgb(0, 0, 0)'&&
   __previewCheckInColors.ready==='rgb(165, 214, 167)'&&__previewCheckInColors.waiting==='rgb(255, 138, 128)'&&
   [...doc.querySelectorAll('.self_check_in_chip_name')].every(node=>parseFloat(style(node).fontSize)>20)&&
   doc.body.textContent.includes('Bereit zum Aufruf')&&doc.body.textContent.includes('Warten auf Check-In');
 });
 await capture('einstellungen-profilvorschau-bedienung',true);
 await run(() => __previewRow('preview-checkin').querySelector('.settings-display-actions button').click());
 await wait(() => document.querySelector('.self-check-in-preview-frame')?.contentDocument?.querySelectorAll('.self_check_in_match').length===3);
 await verify('The profile dialog uses the same self-check-in cards and the shared blurred backdrop', () => {
  const dialog=document.querySelector('.display_setting_edit_dialog'), frame=dialog.querySelector('.self-check-in-preview-frame'), doc=frame.contentDocument;
  return getComputedStyle(dialog,'::backdrop').backdropFilter==='blur(2px)'&&
   frame.contentWindow.getComputedStyle(doc.querySelector('.main_self_check_in')).backgroundColor===__previewCheckInColors.background&&
   frame.contentWindow.getComputedStyle(doc.querySelector('.self_check_in_chip_ready')).backgroundColor===__previewCheckInColors.ready&&
   !!doc.querySelector('.self_check_in_match_waiting')&&!doc.querySelector('script');
 });
 await run(() => {
  window.__previewWritesBefore=__writes.length;
  document.querySelector('.self-check-in-preview-frame').contentDocument.querySelector('.self_check_in_chip').click();
 });
 await verify('Clicking a sample name cannot change a real check-in', () => __writes.length===__previewWritesBefore);
 await capture('einstellungen-self-check-in-profil-dialog');
 await run(() => document.querySelector('.display_setting_edit_dialog .ls-dialog-close').click());
 await wait(() => !document.querySelector('.display_setting_edit_dialog'));
 for (const width of [1920,950,390,320]) {
  await metrics(width,1000);
  await verify('Profile screenshots fit the page at '+width+' px', () => document.documentElement.scrollWidth<=innerWidth+1&&
   [...document.querySelectorAll('.settings-display-mark')].filter(node=>node.getClientRects().length).every(node=>node.getBoundingClientRect().right<=innerWidth));
  if(width===390)await capture('einstellungen-profilvorschau-mobil');
 }
 await run(async () => {window.__previewFrozen=__previewRow('preview-input').querySelector('iframe').srcdoc;await new Promise(resolve=>setTimeout(resolve,1200));});
 await verify('Thumbnails stay static and release the temporary renderer', () =>
  !document.querySelector('.settings-profile-renderer')&&__previewRow('preview-input').querySelector('iframe').srcdoc===__previewFrozen&&
  localStorage.getItem('bup_settings')===__previewStorage&&__previewErrors.length===0);
 await run(() => document.querySelector('.leitstand-nav a[href$="/devices"]').click());
 await verify('Navigation disposes previews while retaining the document and speech service', () =>
  !document.querySelector('.settings-profile-renderer,.settings-profile-snapshot')&&document===__previewDocument&&btsSpeechService===__previewSpeech);
 await metrics(1440,1000);
 await run(() => crouting.navigate_to('t/preview/self_check_in'));
 await wait(() => !!document.querySelector('.main_self_check_in .self_check_in_chip_ready'));
 await verify('The actual self-check-in page retains its dark full-screen layout and status colors', () =>
  getComputedStyle(document.querySelector('.main_self_check_in')).backgroundColor===__previewCheckInColors.background&&
  getComputedStyle(document.querySelector('.self_check_in_chip_ready')).backgroundColor===__previewCheckInColors.ready&&
  getComputedStyle(document.querySelector('.self_check_in_chip_waiting')).backgroundColor===__previewCheckInColors.waiting&&
  document.querySelector('.main_self_check_in').getBoundingClientRect().height===innerHeight);
 await run(() => {
  const chip=document.querySelector('.main_self_check_in .self_check_in_chip[data-role=player]:not(:disabled)');
  window.__previewCheckInExpected={match:chip.dataset.match_id,player:chip.dataset.participant_id,checked:!chip.classList.contains('self_check_in_chip_ready')};chip.click();
 });
 await verify('The existing page still sends normal player check-ins', () =>
  __writes.at(-1).type==='match_player_check_in'&&__writes.at(-1).match_id===__previewCheckInExpected.match&&
  String(__writes.at(-1).player_id)===__previewCheckInExpected.player&&__writes.at(-1).checked_in===__previewCheckInExpected.checked);
 assert.deepStrictEqual(c.events.filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text),[], 'Preview frames have no browser exceptions');
};
