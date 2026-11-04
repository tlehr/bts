'use strict';
/* eslint no-undef: off */

module.exports = async function({c,open,metrics,key,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error("Maintenance settings did not settle");})()');
 const verify = (name,fn) => check(name,'(' + fn.toString() + ')()');
 await open(1440,1000);
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await run(() => {
  window.__maintenanceDocument=document;window.__maintenanceSpeech=btsSpeechService;window.__maintenanceRequests=[];window.__maintenanceExceptions=[];window.__maintenanceNativePrompts=0;
  window.addEventListener('error',event => __maintenanceExceptions.push(event.message));
  window.confirm=() => {__maintenanceNativePrompts++;return true;};window.prompt=() => {__maintenanceNativePrompts++;return 'preview';};
  const original=send;window.send=(message,callback) => {
   if (message.type==='service_status') return setTimeout(() => callback(null,{services:{btp:structuredClone(curt.btp_status),ticker:structuredClone(curt.ticker_status),speech:{enabled:true},speech_health:{state:'ok',issues:[]}}}),0);
   if (message.type==='tournament_get') return setTimeout(() => callback(null,{tournament:structuredClone(curt)}),0);
   if (['court_assignments_reset','player_pause_reset','tournament_reset'].includes(message.type)) {__maintenanceRequests.push({message:structuredClone(message),callback});return;}
   return original(message,callback);
  };
  window.__maintenanceField=name => document.querySelector('.settings-maintenance [name="'+name+'"]');
  window.__maintenanceReply=(error,response={}) => __maintenanceRequests.shift().callback(error,response);
  window.__maintenanceProps=values => change.default_handler(() => {})({ctype:'props',val:values});
  window.__maintenanceBtp=status => ctournament.btp_status_changed({val:{status,message:''}});
  window.__maintenanceAccept=() => document.querySelector('.bts-confirm-accept').click();
  window.__maintenanceOpenFull=() => {
   __maintenanceField('tournament_reset').click();document.querySelector('.settings-reset-dialog [name=reset_action][value=tournament]').click();
   document.querySelector('.settings-reset-dialog [name=reset_review]').click();
  };
  window.__maintenanceKey=value => {const input=document.querySelector('.bts-confirm-verification');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(() => !!document.querySelector('.settings-area-link[href$="/edit/maintenance"]'));
 await run(() => document.querySelector('.settings-area-link[href$="/edit/maintenance"]').click());
 await verify('Maintenance uses shared action cards and a separate local tournament-reset card',() =>
  [...document.querySelectorAll('.settings-maintenance .settings-card-heading h2')].map(node => node.textContent).join('|')==='Wartungsaktionen|Turnier zurücksetzen' &&
  document.querySelectorAll('.settings-maintenance-action').length===3 && document.querySelector('.settings-maintenance-reset [name=tournament_reset]') &&
  document.querySelectorAll('.live_settings_status').length===1 && document.querySelector('.settings-footer .settings-back-button'));
 await verify('BTP-dependent actions explain their disabled state while local reset stays available',() =>
  __maintenanceField('court_assignments_reset').disabled && __maintenanceField('player_pause_reset').disabled && !__maintenanceField('tournament_reset').disabled &&
  document.querySelector('.settings-maintenance-connection').textContent.includes('ausgeschaltet') &&
  [...document.querySelectorAll('.settings-maintenance-action')].every(node => node.querySelector('svg') && node.getAttribute('aria-describedby')));
 await run(() => {window.__maintenanceFields=[...document.querySelectorAll('.settings-content input')];document.querySelector('.settings-maintenance-connection a').click();});
 await verify('The BTP settings link uses the existing workspace without replacing controls',() =>
  location.pathname.endsWith('/edit/btp') && __maintenanceFields.every(node => node.isConnected));
 await run(() => {document.querySelector('.settings-area-link[href$="/edit/maintenance"]').click();__maintenanceProps({btp_enabled:true,btp_readonly:true});__maintenanceBtp('connected');});
 await verify('Read-only BTP keeps both remote maintenance actions unavailable',() =>
  __maintenanceField('court_assignments_reset').disabled && __maintenanceField('player_pause_reset').disabled &&
  document.querySelector('.settings-maintenance-connection').textContent.includes('Nur-Lesen'));
 await run(() => {__maintenanceProps({btp_readonly:false});__maintenanceBtp('error');});
 await verify('An actual lost BTP connection also blocks remote actions and keeps the local reset available',() =>
  __maintenanceField('court_assignments_reset').disabled && __maintenanceField('player_pause_reset').disabled && !__maintenanceField('tournament_reset').disabled &&
  document.querySelector('.settings-maintenance-connection').textContent.includes('nicht verbunden'));
 await run(() => {__maintenanceBtp('connected');document.querySelector('[name=name]').value='Unfertiger Titel';window.__maintenanceTitle=document.querySelector('[name=name]');__maintenanceField('court_assignments_reset').focus();__maintenanceField('court_assignments_reset').click();});
 await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await verify('Field reset opens a styled destructive confirmation with safe focus and blurred background',() =>
  document.querySelector('.bts-confirm-dialog.is-danger').open && document.querySelector('.bts-confirm-dialog').getAttribute('role')==='alertdialog' &&
  getComputedStyle(document.querySelector('.bts-confirm-dialog'),'::backdrop').backdropFilter.includes('blur') &&
  document.activeElement.matches('.bts-confirm-cancel') && document.querySelector('.bts-confirm-content').textContent.includes('Laufende und beendete Spiele') && __maintenanceRequests.length===0);
 await key('Enter','Enter',13,'\r');
 await verify('Enter on the initial safe action cancels and restores the triggering button',() =>
  !document.querySelector('.bts-confirm-dialog') && document.activeElement===__maintenanceField('court_assignments_reset') && __maintenanceRequests.length===0);
 await run(() => {__maintenanceField('court_assignments_reset').click();__maintenanceField('court_assignments_reset').click();});
 await verify('Repeated clicks create one confirmation before any maintenance command is sent',() => document.querySelectorAll('.bts-confirm-dialog').length===1 && __maintenanceRequests.length===0);
 await run(() => __maintenanceAccept());
 await wait(() => __maintenanceRequests.length===1);
 await verify('Confirmed field reset uses the existing command and locks all maintenance actions while pending',() =>
  __maintenanceRequests[0].message.type==='court_assignments_reset' && __maintenanceRequests[0].message.tournament_key==='preview' &&
  [...document.querySelectorAll('.settings-maintenance-action')].every(node => node.disabled) &&
  __maintenanceField('court_assignments_reset').getAttribute('aria-busy')==='true' && document.querySelector('.live_settings_status_saving'));
 await run(() => {__maintenanceBtp('connected');__maintenanceField('player_pause_reset').click();});
 await verify('Live connection updates cannot unlock an outstanding maintenance command',() =>
  __maintenanceRequests.length===1 && [...document.querySelectorAll('.settings-maintenance-action')].every(node => node.disabled));
 await run(() => __maintenanceReply(null,{changed_matches:7,btp_changed_matches:8,skipped_matches:1}));
 await verify('Successful field reset reports the actual BTS, BTP and skipped counts without replacing drafts',() =>
  __maintenanceField('court_assignments_reset').closest('.settings-row').textContent.includes('BTS: 7, BTP: 8') &&
  __maintenanceField('court_assignments_reset').closest('.settings-row').textContent.includes('übersprungen: 1') &&
  !__maintenanceField('court_assignments_reset').disabled && document.querySelector('[name=name]')===__maintenanceTitle && __maintenanceTitle.value==='Unfertiger Titel');
 await run(() => {__maintenanceField('player_pause_reset').click();});
 await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await run(() => __maintenanceAccept());await wait(() => __maintenanceRequests.length===1);
 await run(() => __maintenanceReply({message:'BTP hat die Änderung abgelehnt.'}));
 await verify('A failed maintenance command shows its specific error and remains retryable',() =>
  __maintenanceField('player_pause_reset').closest('.settings-row').querySelector('.settings-maintenance-result').dataset.state==='error' &&
  __maintenanceField('player_pause_reset').closest('.settings-row').textContent.includes('BTP hat die Änderung abgelehnt.') &&
  !__maintenanceField('player_pause_reset').disabled && document.querySelector('.live_settings_status_error'));
 await run(() => __maintenanceField('player_pause_reset').click());
 await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await verify('Retrying a failed reset requires a new explicit confirmation',() => __maintenanceRequests.length===0);
 await run(() => __maintenanceAccept());await wait(() => __maintenanceRequests.length===1);
 await run(() => {
  const player=curt.matches[0].setup.teams[0].players[0];player.last_time_on_court_ts=123;player.tablet_break_active=true;
  change.default_handler(() => {})({ctype:'player_pause_reset',val:{player_count:12,changed_matches:8}});
  __maintenanceReply(null,{player_count:12,changed_matches:8});
 });
 await verify('Successful pause reset keeps its native live-data update and reports player and match counts',() =>
  __maintenanceField('player_pause_reset').closest('.settings-row').textContent.includes('12 Spieler in 8 Spielen') &&
  curt.matches[0].setup.teams[0].players[0].last_time_on_court_ts===undefined && !curt.matches[0].setup.teams[0].players[0].tablet_break_active &&
  document.querySelector('[name=name]')===__maintenanceTitle && __maintenanceTitle.value==='Unfertiger Titel');
 await run(() => __maintenanceField('court_assignments_reset').click());await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await run(() => {__maintenanceProps({btp_readonly:true});__maintenanceAccept();});
 await wait(() => !document.querySelector('.bts-confirm-dialog'));
 await verify('BTP availability is rechecked after approval and prevents execution if it changed during confirmation',() =>
  __maintenanceRequests.length===0 && __maintenanceField('court_assignments_reset').disabled &&
  __maintenanceField('court_assignments_reset').closest('.settings-row').textContent.includes('nicht ausgeführt'));
 await run(() => {__maintenanceProps({btp_readonly:false});__maintenanceBtp('connected');});
 await verify('Restoring writable BTP removes the outdated availability error and re-enables the actions',() =>
  __maintenanceField('court_assignments_reset').closest('.settings-row').querySelector('.settings-maintenance-result').hidden &&
  !__maintenanceField('court_assignments_reset').disabled && document.querySelector('.settings-maintenance-connection').dataset.state==='ready');
 await capture('einstellungen-wartung',true);
 for (const width of [1920,950,390,320]) {
  await metrics(width,1000);
  await verify('Maintenance cards and actions fit at '+width+' px',() =>
   document.documentElement.scrollWidth<=innerWidth+1 && [...document.querySelectorAll('.settings-maintenance .settings-card,.settings-maintenance-action')]
    .every(node => {const box=node.getBoundingClientRect();return box.left>=0 && box.right<=innerWidth+1;}));
  if (width===390) await capture('einstellungen-wartung-mobil',true);
 }
 await metrics(1440,1000);
 await run(() => __maintenanceOpenFull());await wait(() => !!document.querySelector('.bts-confirm-verification'));
 await verify('Tournament reset keeps the full explanation and requires typing the exact tournament ID',() =>
  document.querySelector('.bts-confirm-verification').labels.length===1 && document.querySelector('.bts-confirm-verification').labels[0].textContent.includes('preview') &&
  document.querySelector('.bts-confirm-verification').value==='' && document.querySelector('.bts-confirm-accept').disabled &&
  ['Tabletbediener','Displayeinstellungen','Gerätezuordnungen'].every(word => document.querySelector('.bts-confirm-content').textContent.includes(word)));
 await key('Tab','Tab',9);await key('Tab','Tab',9);
 await verify('The confirmation keyboard trap includes the new verification field',() => document.activeElement.matches('.bts-confirm-verification'));
 await run(() => {__maintenanceKey('wrong');__maintenanceAccept();});
 await key('Enter','Enter',13,'\r');
 await verify('A wrong ID cannot trigger reset by click or Enter',() => !!document.querySelector('.bts-confirm-dialog') && document.querySelector('.bts-confirm-accept').disabled && __maintenanceRequests.length===0);
 await run(() => __maintenanceKey('preview'));
 await verify('Only the exact ID enables the destructive action',() => !document.querySelector('.bts-confirm-accept').disabled);
 await run(() => __maintenanceKey('preview '));
 await verify('Changing the verified ID disables reset again instead of retaining stale approval',() => document.querySelector('.bts-confirm-accept').disabled);
 await run(() => __maintenanceKey('preview'));
 await capture('einstellungen-wartung-bestaetigung',true);
 for (const [width,height] of [[390,844],[320,568],[568,320]]) {
  await metrics(width,height);
  await verify('The reset confirmation scrolls its explanation while its actions fit at '+width+' × '+height,() => {
   const dialog=document.querySelector('.bts-confirm-dialog'),box=dialog.getBoundingClientRect();
   return box.left>=15 && box.right<=innerWidth-15 && box.top>=15 && box.bottom<=innerHeight-15 && dialog.scrollWidth<=dialog.clientWidth+1 &&
    [...dialog.querySelectorAll('.bts-confirm-actions button')].every(node => {const r=node.getBoundingClientRect();return r.top>=box.top && r.bottom<=box.bottom && r.right<=box.right;});
  });
 }
 await key('Escape','Escape',27);
 await verify('Escape cancels the typed-ID confirmation without sending any reset',() => !document.querySelector('.bts-confirm-dialog') && __maintenanceRequests.length===0);
 await metrics(1440,1000);
 await run(() => __maintenanceOpenFull());await wait(() => !!document.querySelector('.bts-confirm-verification'));
 await run(() => {__maintenanceKey('preview');document.querySelector('.bts-confirm-verification').focus();});
 await key('Enter','Enter',13,'\r');await wait(() => __maintenanceRequests.length===1);
 await verify('Correct typed-ID approval sends one existing local reset command and locks duplicate requests',() =>
  __maintenanceRequests[0].message.type==='tournament_reset' && __maintenanceRequests[0].message.tournament_key==='preview' &&
  __maintenanceField('tournament_reset').disabled && !document.querySelector('.bts-confirm-dialog') && __maintenanceNativePrompts===0);
 await run(() => __maintenanceReply({message:'Das Turnier konnte nicht zurückgesetzt werden.'}));
 await verify('Failed tournament reset keeps the page and reports the server reason',() =>
  __maintenanceField('tournament_reset').closest('.settings-row').textContent.includes('konnte nicht zurückgesetzt') &&
  !__maintenanceField('tournament_reset').disabled && curt.matches.length>0);
 await run(() => __maintenanceOpenFull());await wait(() => !!document.querySelector('.bts-confirm-verification'));
 await verify('A retry never reuses a previously verified tournament ID',() => document.querySelector('.bts-confirm-verification').value==='' && document.querySelector('.bts-confirm-accept').disabled);
 await run(() => {__maintenanceKey('preview');__maintenanceAccept();});await wait(() => __maintenanceRequests.length===1);
 await run(() => {
  change.default_handler(() => {})({ctype:'tournament_reset',val:{tournament:{key:'preview',name:'Default',btp_enabled:false,btp_autofetch_enabled:false,events:{events:[]}},reset_ts:Date.now()}});
  __maintenanceReply(null,{});
 });
 await verify('The native tournament-reset broadcast refreshes the cleared data and retains the selected settings area',() =>
  document.querySelector('.page-settings').dataset.settingsSection==='maintenance' && curt.matches.length===0 && curt.locations.length===0 && curt.name==='Default' &&
  document.querySelectorAll('.settings-maintenance .settings-card').length===2 && document.querySelector('.live_settings_status_saved') &&
  document===__maintenanceDocument && btsSpeechService===__maintenanceSpeech);
 await run(() => __maintenanceOpenFull());await wait(() => !!document.querySelector('.bts-confirm-verification'));
 await run(() => document.querySelector('.settings-area-link[href$="/edit/ticker"]').click());
 await wait(() => !document.querySelector('.bts-confirm-dialog'));
 await verify('Changing settings sections dismisses an outstanding maintenance confirmation',() =>
  document.querySelector('.page-settings').dataset.settingsSection==='ticker' && __maintenanceRequests.length===0);
 await run(() => {document.querySelector('.settings-area-link[href$="/edit/maintenance"]').click();__maintenanceProps({btp_enabled:true,btp_readonly:false});__maintenanceBtp('connected');__maintenanceField('player_pause_reset').click();});
 await wait(() => !!document.querySelector('.bts-confirm-dialog'));await run(() => __maintenanceAccept());await wait(() => __maintenanceRequests.length===1);
 await run(() => document.querySelector('.leitstand-nav a[href$="/devices"]').click());await wait(() => !document.querySelector('.page-settings'));
 await run(() => __maintenanceReply({message:'Late maintenance failure'}));
 await verify('Late replies after navigation do not recreate maintenance controls or interrupt shared services',() =>
  !document.querySelector('.settings-maintenance') && document===__maintenanceDocument && btsSpeechService===__maintenanceSpeech && __maintenanceExceptions.length===0);
};
