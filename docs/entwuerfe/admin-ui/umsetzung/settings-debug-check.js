'use strict';
/* eslint no-undef: off */

module.exports = async function({c,open,metrics,key,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error("Debug settings did not settle");})()');
 const verify = (name,fn) => check(name,'(' + fn.toString() + ')()');
 await open(1440,1000);
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await run(() => {
  window.__debugDocument=document;window.__debugSpeech=btsSpeechService;window.__debugRequests=[];window.__debugErrors=[];
  window.addEventListener('error',event => __debugErrors.push(event.message));
  const original=send;window.send=(message,callback) => {
   if (message.type==='service_status') return setTimeout(() => callback(null,{services:{btp:structuredClone(curt.btp_status),ticker:structuredClone(curt.ticker_status),speech:{enabled:true},speech_health:{state:'ok',issues:[]}}}),0);
   if (message.type==='tournament_get') return setTimeout(() => callback(null,{tournament:structuredClone(curt)}),0);
   if (['tournament_edit_prop','clock_set'].includes(message.type)) {__debugRequests.push({message:structuredClone(message),callback});return;}
   return original(message,callback);
  };
  window.__debugField=name => document.querySelector('.settings-debug [name="'+name+'"]');
  window.__debugReply=(failure,response={}) => __debugRequests.shift().callback(failure || null,response);
  window.__debugClockCard=() => __debugField('test_clock_mode').closest('.settings-card');
  window.__debugClockAction=text => [...__debugClockCard().querySelectorAll('button')].find(node => node.textContent===text).click();
  window.__debugMode=mode => {const node=__debugField('test_clock_mode');node.value=mode;node.dispatchEvent(new Event('change',{bubbles:true}));};
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(() => !!document.querySelector('.settings-area-link[href$="/edit/debug"]'));
 await run(() => document.querySelector('.settings-area-link[href$="/edit/debug"]').click());
 await verify('Debug settings use four shared cards with logging, automation, connections and clock simulation',() =>
  location.pathname.endsWith('/edit/debug') && document.querySelector('.page-settings').dataset.settingsSection==='debug' &&
  [...document.querySelectorAll('.settings-debug .settings-card-heading h2')].map(node => node.textContent).join('|')===
   'Protokollierung & Messungen|Automatik prüfen|Anzeigen und Tablet-Verbindung|Zeitsimulation' && !document.querySelector('.settings-debug>.settings'));
 await verify('All eight debug toggles use labelled switches with their own linked explanations',() => {
  const controls=[...document.querySelectorAll('.settings-debug input[type=checkbox]')];
  return controls.length===8 && controls.every(node => node.getAttribute('role')==='switch' && node.labels.length===1 &&
   node.getAttribute('aria-describedby')?.split(' ').every(id => document.getElementById(id)?.textContent.length>0));
 });
 await verify('Protocol selection is absent and update acknowledgements are explained without protocol terminology',() =>
  !document.querySelector('[name=bupws_v2_enabled]') && !/V2|Protokoll/.test(__debugField('bup_v2_admin_wait_for_score_updates').closest('.settings-card').textContent) &&
  __debugField('bup_v2_admin_wait_for_score_updates').labels[0].textContent==='Rückmeldungen zu Spielstandsänderungen anzeigen' &&
  __debugField('bup_v2_admin_wait_for_score_updates').closest('.settings-row').textContent.includes('bereits dargestellt haben'));
 await verify('Diagnostic messages have a direct link to the existing logs page',() => {
  const link=document.querySelector('.settings-debug .settings-related-link');
  return link.getAttribute('href')==='/admin/diagnostics/' && link.target==='_blank' && link.rel.includes('noopener');
 });
 await run(() => {window.__debugNodes=[...document.querySelectorAll('.settings-debug input,.settings-debug select')];});
 for (const field of ['bts_debug_output_enabled','bts_server_diagnostics_enabled','bts_client_performance_debug_enabled',
  'bts_score_press_timing_enabled','bts_auto_call_trace_enabled','preparation_call_debug_output_enabled',
  'preparation_call_debug_icons_enabled','bup_v2_admin_wait_for_score_updates']) {
  await c.evaluate('(()=>{const input=__debugField('+JSON.stringify(field)+');window.__debugValue=!input.checked;input.click();})()');
  await verify('The '+field+' switch retains its boolean property and existing save path',() =>
   __debugRequests.length===1 && __debugRequests[0].message.type==='tournament_edit_prop' &&
   __debugRequests[0].message.key==='preview' && __debugRequests[0].message.value===__debugValue &&
   __debugField(__debugRequests[0].message.field).checked===__debugValue && !!document.querySelector('.live_settings_status_saving'));
  await c.evaluate('if(__debugRequests[0].message.field!=='+JSON.stringify(field)+')throw new Error("Wrong debug property");__debugReply()');
 }
 await run(() => {window.__debugPrevious=__debugField('bts_debug_output_enabled').checked;__debugField('bts_debug_output_enabled').click();__debugReply({message:'Synthetic debug save failure'});});
 await verify('A failed debug save restores the previous switch and reports failure without replacing controls',() =>
  __debugField('bts_debug_output_enabled').checked===__debugPrevious && curt.bts_debug_output_enabled===__debugPrevious &&
  !!document.querySelector('.live_settings_status_error') && __debugNodes.every(node => node.isConnected));
 await run(() => __debugField('bts_debug_output_enabled').focus());await key(' ','Space',32,' ');
 await verify('The new debug switches remain operable by keyboard',() => __debugRequests.length===1 && __debugRequests[0].message.field==='bts_debug_output_enabled');
 await run(() => __debugReply());
 await verify('Clock simulation remains in Debug and clearly marks its server-wide scope',() =>
  __debugClockCard().querySelector('.settings-card-badge').textContent==='Serverweit' &&
  __debugClockCard().textContent.includes('alle Turniere auf diesem BTS-Server') &&
  !document.querySelector('.settings-general [name=test_clock_mode]') && __debugRequests.length===0);
 await run(() => {
  __debugMode('fixed');__debugField('test_clock_fixed').value='2026-11-04T14:30';window.__debugFixed=Date.parse(__debugField('test_clock_fixed').value);
 });
 await verify('Choosing a fixed clock reveals its input without applying the draft',() =>
  __debugField('test_clock_fixed').getBoundingClientRect().height>0 && __debugField('test_clock_offset_minutes').getBoundingClientRect().height===0 && __debugRequests.length===0);
 await run(() => {
  ctournament.btp_status_changed({val:{status:'connected',message:'Synthetic live update'}});
  document.querySelector('.settings-area-link[href$="/edit/ticker"]').click();document.querySelector('.settings-area-link[href$="/edit/debug"]').click();
 });
 await verify('Live status and settings navigation preserve clock drafts and all debug controls',() =>
  __debugField('test_clock_fixed').value==='2026-11-04T14:30' && __debugField('test_clock_mode').value==='fixed' &&
  __debugNodes.every(node => node.isConnected) && __debugRequests.length===0 && document===__debugDocument && btsSpeechService===__debugSpeech);
 await run(() => __debugClockAction('Übernehmen'));
 await verify('Applying a fixed time still uses the existing clock command',() =>
  __debugRequests.length===1 && __debugRequests[0].message.type==='clock_set' &&
  __debugRequests[0].message.mode==='fixed' && __debugRequests[0].message.fixed_ts===__debugFixed);
 await run(() => __debugReply(null,{clock:{mode:'fixed',fixed_ts:__debugFixed,offset_ms:0}}));
 await verify('The acknowledged clock updates the active status and existing test-mode indicator',() =>
  document.body.classList.contains('bts_clock_debug_mode_fixed') && document.querySelector('.settings-clock-status').textContent.includes('Fixe Zeit'));
 await run(() => {__debugMode('offset');__debugField('test_clock_offset_minutes').value='-1:30';__debugField('test_clock_offset_target').value='';__debugClockAction('Übernehmen');});
 await verify('Signed minute-second offsets continue to save milliseconds',() =>
  __debugRequests.length===1 && __debugRequests[0].message.mode==='offset' && __debugRequests[0].message.offset_ms===-90000 &&
  __debugField('test_clock_offset_minutes').btsDuration && __debugField('test_clock_offset_minutes').closest('.settings-row').textContent.includes('Minuten'));
 await run(() => __debugReply(null,{clock:{mode:'offset',offset_ms:-90000}}));
 await run(() => {__debugField('test_clock_reset').click();});
 await verify('Returning to real server time retains its direct action',() => __debugRequests.length===1 && __debugRequests[0].message.mode==='real');
 await run(() => __debugReply(null,{clock:{mode:'real',offset_ms:0}}));
 await verify('The acknowledged real-time mode clears simulation indicators and hides test fields',() =>
  !document.body.classList.contains('bts_clock_debug_mode') && __debugField('test_clock_mode').value==='real' &&
  __debugField('test_clock_fixed').getBoundingClientRect().height===0 && __debugField('test_clock_offset_minutes').getBoundingClientRect().height===0);
 await capture('einstellungen-debug',true);
 for (const [width,height] of [[1920,1080],[950,1000],[390,844],[320,568]]) {
  await metrics(width,height);await run(() => __debugMode('offset'));
  await verify('Debug cards, labels and editable clock controls fit at '+width+' px',() =>
   document.documentElement.scrollWidth<=innerWidth+1 && [...document.querySelectorAll('.settings-debug .settings-row')].every(row => {
    const box=row.getBoundingClientRect();if (!box.height) return true;
    const card=row.closest('.settings-card').getBoundingClientRect();
    return box.left>=card.left && box.right<=card.right+1 && [...row.querySelectorAll('input,select,button,.settings-field-label')].every(node => {
     const bounds=node.getBoundingClientRect();return !bounds.height || bounds.left>=box.left && bounds.right<=box.right+1;
    });
   }));
  if (width===390) await capture('einstellungen-debug-mobil',true);
 }
 await run(() => {__debugMode('real');document.querySelector('.settings-area-link[href$="/edit"]').click();});
 await verify('Leaving Debug keeps shared services and other settings intact without sending extra changes',() =>
  document===__debugDocument && btsSpeechService===__debugSpeech && __debugNodes.every(node => node.isConnected) &&
  __debugRequests.length===0 && __debugErrors.length===0);
 // Check the actual board as well as the saved setting: it used to force the
 // diagnostic icons on even when the toggle had explicitly saved false.
 await run(() => {
  if (curt.preparation_call_debug_icons_enabled!==false) throw new Error('The icon preference must have been saved as false');
  document.querySelector('.settings-back-button').click();
 });
 await wait(() => !!document.querySelector('.leitstand .unassigned_container tr[data-match_id]'));
 await verify('Saving the icon switch as off actually hides every diagnostic icon on the board',() =>
  curt.preparation_call_debug_icons_enabled===false && !document.querySelector('.preparation_debug_icon') &&
  document.querySelectorAll('.match_preparation_call_button').length>0);
 await run(() => {
  window.__debugSelections=structuredClone(Object.values(curt.location_preparation_selection_by_location_id));
  __debugSelections.find(selection => selection.location_id==='CH').diagnostics_by_match_id['match-48']={
   manual_eligible:true,eligible:true,within_call_window:true,criteria_eligible:true,rules:[],
  };
  const original=send;window.send=(message,callback) => {
   if (message.type==='preparation_selection_get') return setTimeout(() => callback(null,{selections:structuredClone(__debugSelections)}),0);
   return original(message,callback);
  };
  ctournament.request_location_preparation_selections();
  window.__debugBoardRow=document.querySelector('tr[data-match_id="match-48"]');
  window.__debugBoardPlayer=__debugBoardRow.querySelector('.player');
  window.__debugBoardButton=__debugBoardRow.querySelector('.match_preparation_call_button');
  window.__debugIconProp=value => crouting.on_change({ctype:'prop_changed',tournament_key:curt.key,
   val:{field:'preparation_call_debug_icons_enabled',value}});
  __debugIconProp(true);
 });
 await verify('Enabling icons through a live setting update adds them without replacing players or call buttons',() =>
  document.querySelectorAll('.preparation_debug_icon').length>0 && __debugBoardRow===document.querySelector('tr[data-match_id="match-48"]') &&
  __debugBoardPlayer===__debugBoardRow.querySelector('.player') && __debugBoardButton===__debugBoardRow.querySelector('.match_preparation_call_button'));
 await run(() => {
  window.__debugCallMarkers=[...document.querySelectorAll('.unassigned_container tr[data-match_id]')].map(row =>
   [row.dataset.match_id,[...row.classList].filter(name => /^(preparation_(callable|frontier|call_cutoff|debug_window)|call_on_court_debug)/.test(name)).sort().join(' ')]);
  __debugIconProp(false);
 });
 await verify('Disabling icons through a live update removes existing icons while retaining board rows and call status',() =>
  !document.querySelector('.preparation_debug_icon') && __debugBoardRow===document.querySelector('tr[data-match_id="match-48"]') &&
  __debugBoardPlayer===__debugBoardRow.querySelector('.player') && __debugBoardButton===__debugBoardRow.querySelector('.match_preparation_call_button') &&
  __debugCallMarkers.some(([,classes]) => classes.includes('preparation_debug_window_ok')) &&
  JSON.stringify(__debugCallMarkers)===JSON.stringify([...document.querySelectorAll('.unassigned_container tr[data-match_id]')].map(row =>
   [row.dataset.match_id,[...row.classList].filter(name => /^(preparation_(callable|frontier|call_cutoff|debug_window)|call_on_court_debug)/.test(name)).sort().join(' ')])));
 await run(() => {
  cmatch.refresh_unassigned_preparation_context();
  const match=structuredClone(curt.matches.find(match => match._id==='match-48'));match.setup.match_name='Nach Live-Aktualisierung';
  crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
  ctournament.request_location_preparation_selections();
 });
 await verify('Match patches and fresh diagnostic responses never recreate disabled icons',() =>
  !document.querySelector('.preparation_debug_icon') && __debugBoardRow===document.querySelector('tr[data-match_id="match-48"]') &&
  curt.matches.find(match => match._id==='match-48').setup.match_name==='Nach Live-Aktualisierung');
 await run(() => {delete curt.preparation_call_debug_icons_enabled;ctournament.refresh_current_view();});
 await wait(() => !!document.querySelector('.leitstand .unassigned_container tr[data-match_id]'));
 await verify('An absent legacy preference also defaults to hidden icons in a newly rendered board',() =>
  !document.querySelector('.preparation_debug_icon') && document.querySelectorAll('.match_preparation_call_button').length>0);
 await run(() => document.querySelector('.leitstand-nav a[href$="/edit"]').click());
 await wait(() => !!document.querySelector('.settings-debug'));
 await run(() => {document.querySelector('.settings-area-link[href$="/edit/debug"]').click();__debugField('preparation_call_debug_icons_enabled').click();});
 await verify('Turning icons on in settings still submits the actual boolean preference',() =>
  __debugRequests.length===1 && __debugRequests[0].message.field==='preparation_call_debug_icons_enabled' && __debugRequests[0].message.value===true);
 await run(() => {__debugReply();document.querySelector('.settings-back-button').click();});
 await wait(() => !!document.querySelector('.leitstand .unassigned_container tr[data-match_id]'));
 await verify('Returning from settings with icons enabled renders the accessible information controls',() =>
  [...document.querySelectorAll('.preparation_debug_icon')].length>0 && [...document.querySelectorAll('.preparation_debug_icon')]
   .every(node => node.getAttribute('role')==='button' && node.getAttribute('tabindex')==='0' && node.querySelector('svg')));
 await run(() => document.querySelector('.leitstand-nav a[href$="/edit"]').click());
 await wait(() => !!document.querySelector('.settings-debug'));
 await run(() => {document.querySelector('.settings-area-link[href$="/edit/debug"]').click();__debugField('preparation_call_debug_icons_enabled').click();__debugReply();document.querySelector('.settings-back-button').click();});
 await wait(() => !!document.querySelector('.leitstand .unassigned_container tr[data-match_id]'));
 await verify('Turning the same switch off again hides icons on the next board visit without restarting shared services',() =>
  curt.preparation_call_debug_icons_enabled===false && !document.querySelector('.preparation_debug_icon') &&
  document===__debugDocument && btsSpeechService===__debugSpeech && __debugRequests.length===0 && __debugErrors.length===0);
};
