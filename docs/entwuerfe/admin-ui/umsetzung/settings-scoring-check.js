'use strict';
/* eslint no-console: off */
const fs = require('fs'), path = require('path');

module.exports = async function({c, open, metrics, key, capture, check, previews}) {
 const checks = [];
 const verify = async(name, expression) => {
  try {await check(name, expression);checks.push(name);}
  catch(error) {console.error(JSON.stringify(await c.evaluate('({section:document.querySelector(".page-settings")?.dataset.settingsSection,body:document.querySelector(".settings-panel[data-settings-section=scoring]")?.textContent,saves:window.__scoringSaves})')));throw error;}
 };
 await open(1920,1080);
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await c.evaluate(String.raw`(()=>{
  window.__scoringDocument=document;window.__scoringService=btsSpeechService;window.__scoringCancels=0;window.__scoringUnloads=0;
  btsSpeechService.cancel=()=>__scoringCancels++;window.addEventListener('beforeunload',()=>__scoringUnloads++);
  window.__scoringSaves=[];window.__scoringReplies=[];const original=send;
  window.send=(message,callback)=>{
   if(message.type==='tournament_edit_scoring_format'){__scoringSaves.push(structuredClone(message));__scoringReplies.push(callback);return;}
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   original(message,callback);
  };
  window.__scoringEmit=(ctype,val)=>crouting.on_change({tournament_key:curt.key,ctype,val});
  window.__scoringPanel=()=>document.querySelector('.settings-panel[data-settings-section="scoring"]');
  window.__scoringEntry=id=>__scoringPanel().querySelector('[data-scoring-format="'+id+'"]');
 })()`);
 await c.evaluate(String.raw`document.querySelector('.leitstand-nav a[href$="/edit"]').click()`);
 await verify('The scoring page mounts two separate shared settings cards with helpful empty states', String.raw`(()=>{document.querySelector('.settings-area-link[href$="/edit/scoring"]').click();const cards=[...__scoringPanel().querySelectorAll('.settings-card')];return cards.length===2&&cards[0].getBoundingClientRect().bottom<cards[1].getBoundingClientRect().top&&!__scoringPanel().querySelector('.settings-scoring-formats .settings-scoring-empty').hidden&&!__scoringPanel().querySelector('.settings-scoring-assignments .settings-scoring-empty').hidden&&__scoringPanel().textContent.includes('Noch keine Punktsysteme vorhanden')&&__scoringPanel().textContent.includes('Es ist noch kein Turnierstandard hinterlegt');})()`);
 await c.evaluate(String.raw`(()=>{
  const regular={end_points:21,max_points:30,end_points_editable:false,max_points_editable:false,interval_enabled:true,interval_at:11,interval_duration_ms:60000,break_before_set_duration_ms:120000};
  window.__scoringSource={default_id:1,formats:[
   {id:1,name:'3 × 21 Punkte',numSets:3,set_points:{...regular},last_set_points:{...regular,interval_duration_ms:90000}},
   {id:2,name:'1 × 30 Punkte',numSets:1,set_points:{...regular,end_points:30,interval_enabled:false,break_before_set_duration_ms:0},last_set_points:{...regular,end_points:30,interval_at:15,interval_duration_ms:75000,break_before_set_duration_ms:null}},
  ]};
  window.__scoringEvents={events:[
   {id:10,name:'ME U17',stages:[{id:100,name:'Hauptfeld',scoring_format:null},{id:101,name:'Qualifikation',scoring_format:'2'}]},
   {id:20,name:'JE U15',stages:[{id:200,name:'Hauptfeld',scoring_format:'1'},{id:201,name:'Qualifikation',scoring_format:2}]},
  ]};
  __scoringEmit('update_btp_scoring_formats',{scoring_formats:structuredClone(__scoringSource)});
  __scoringEmit('update_btp_events',{events:structuredClone(__scoringEvents)});
 })()`);
 await verify('Available formats show their names, set counts and exactly one labelled tournament default', String.raw`__scoringPanel().querySelectorAll('.settings-scoring-format').length===2&&__scoringEntry(1).querySelector('h3').textContent==='3 × 21 Punkte'&&__scoringEntry(1).textContent.includes('3 Sätze')&&__scoringEntry(2).textContent.includes('1 Satz')&&[...__scoringPanel().querySelectorAll('.settings-scoring-default')].filter(node=>!node.hidden).length===1&&!__scoringEntry(1).querySelector('.settings-scoring-default').hidden&&__scoringPanel().querySelector('.settings-scoring-standard strong').textContent==='3 × 21 Punkte'`);
 await verify('Regular and last-set summaries preserve points, break thresholds and both pause durations', String.raw`(()=>{const rows=[...__scoringEntry(1).querySelectorAll('.settings-scoring-rules')];return rows.length===2&&rows[0].querySelector('h4').textContent==='Normale Sätze'&&rows[1].querySelector('h4').textContent==='Letzter Satz'&&[...rows[0].querySelectorAll('dd')].map(node=>node.textContent).join('|')==='21 / 30|Bei 11 Punkten · 1:00 Minuten|2:00 Minuten'&&[...rows[1].querySelectorAll('dd')].map(node=>node.textContent).join('|')==='21 / 30|Bei 11 Punkten · 1:30 Minuten|2:00 Minuten';})()`);
 await verify('Disabled intervals, explicit zero pauses and unset pauses remain distinguishable', String.raw`(()=>{const values=[...__scoringEntry(2).querySelectorAll('dd')].map(node=>node.textContent);return values[1]==='Keine Pause'&&values[2]==='0:00 Minuten'&&values[4]==='Bei 15 Punkten · 1:15 Minuten'&&values[5]==='—';})()`);
 await verify('Only deviations are listed, sorted by discipline and stage, with numeric and string IDs resolving equally', String.raw`(()=>{const rows=[...__scoringPanel().querySelectorAll('.settings-scoring-assignments-table tbody tr')];return rows.length===2&&rows.map(row=>[...row.querySelectorAll('.settings-scoring-assignment-value')].map(node=>node.textContent).join('|')).join(';')==='JE U15|Qualifikation|1 × 30 Punkte;ME U17|Qualifikation|1 × 30 Punkte'&&__scoringPanel().querySelector('.settings-scoring-assignments .settings-card-badge').textContent==='2 abweichend';})()`);
 await c.evaluate(String.raw`window.__scoringNodes=[...__scoringPanel().querySelectorAll('*')];window.__scoringMutations=[];window.__scoringObserver=new MutationObserver(records=>__scoringMutations.push(...records));__scoringObserver.observe(__scoringPanel(),{subtree:true,childList:true,attributes:true,characterData:true});__scoringEntry(1).querySelector('button').focus();`);
 await c.evaluate(String.raw`__scoringEmit('update_btp_scoring_formats',{scoring_formats:structuredClone(__scoringSource)});__scoringEmit('update_btp_events',{events:structuredClone(__scoringEvents)});`);
 await verify('Identical live snapshots cause zero scoring DOM mutations and preserve keyboard focus', String.raw`__scoringMutations.length===0&&__scoringNodes.every(node=>node.isConnected)&&document.activeElement===__scoringEntry(1).querySelector('button')`);
 await c.evaluate(String.raw`window.__scoringFormatNodes=[...__scoringPanel().querySelector('.settings-scoring-formats').querySelectorAll('*')];__scoringEvents.events[1].stages[1].name='Vorrunde';__scoringEmit('update_btp_events',{events:structuredClone(__scoringEvents)});`);
 await verify('An assignment-only update keeps both format summaries and existing assignment rows mounted', String.raw`__scoringFormatNodes.every(node=>node.isConnected)&&__scoringNodes.filter(node=>node.classList.contains('settings-scoring-assignment-value')).every(node=>node.isConnected)&&__scoringPanel().querySelector('.settings-scoring-assignments-table').textContent.includes('Vorrunde')&&document.activeElement===__scoringEntry(1).querySelector('button')`);
 await key('Enter','Enter',13,'\r');
 await verify('The existing editor opens by keyboard with imported names, set counts and locked point values intact', String.raw`document.querySelector('.scoring_format_edit_dialog')?.dataset.scoringFormatId==='1'&&['name','numSets','set_points_end_points','set_points_max_points','last_set_points_end_points','last_set_points_max_points'].every(name=>document.querySelector('.scoring_format_edit_dialog [name="'+name+'"]').disabled)&&document.querySelector('.scoring_format_edit_dialog [name="set_points_interval_duration_s"]').value==='1:00'`);
 await c.evaluate(String.raw`(()=>{const form=document.querySelector('.scoring_format_edit_dialog form');form.querySelector('[name="set_points_interval_duration_s"]').value='1:05';form.requestSubmit();form.requestSubmit();})()`);
 await verify('Saving a pause retains the existing command and imported rules while converting minutes:seconds to milliseconds', String.raw`__scoringSaves.length===1&&__scoringSaves[0].type==='tournament_edit_scoring_format'&&__scoringSaves[0].key==='preview'&&__scoringSaves[0].scoring_format.id===1&&__scoringSaves[0].scoring_format.set_points.interval_duration_ms===65000&&__scoringSaves[0].scoring_format.set_points.end_points===21&&__scoringSaves[0].scoring_format.last_set_points.interval_duration_ms===90000`);
 await c.evaluate(String.raw`__scoringReplies.shift()({message:'Synthetic scoring save error'})`);
 await verify('A failed save keeps the editor and the edited pause available for retry', String.raw`document.querySelector('.scoring_format_edit_dialog [name="set_points_interval_duration_s"]').value==='1:05'&&__scoringPanel().querySelector('.settings-scoring-formats').textContent.includes('Bei 11 Punkten · 1:00 Minuten')&&document.querySelector('.live_settings_status_error')`);
 await c.evaluate(String.raw`document.querySelector('.scoring_format_edit_dialog form').requestSubmit();__scoringEmit('scoring_format_changed',{scoring_format:__scoringSaves.at(-1).scoring_format});`);
 await verify('The server broadcast preceding a local save response does not claim that another window changed the format', String.raw`!document.querySelector('.scoring_format_edit_dialog')&&!!document.querySelector('.live_settings_status_saving')&&!document.querySelector('.live_settings_status_error')`);
 await c.evaluate(String.raw`__scoringReplies.shift()(null,{})`);
 await verify('Confirmed pause changes update the existing summary without rebuilding other formats or assignments', String.raw`!document.querySelector('.scoring_format_edit_dialog')&&__scoringEntry(1).textContent.includes('Bei 11 Punkten · 1:05 Minuten')&&__scoringFormatNodes.every(node=>node.isConnected)&&__scoringNodes.filter(node=>node.classList.contains('settings-scoring-assignment-value')).every(node=>node.isConnected)`);
 await c.evaluate(String.raw`__scoringEntry(1).querySelector('button .ico').dispatchEvent(new MouseEvent('click',{bubbles:true}));__scoringEmit('scoring_format_changed',{scoring_format:structuredClone(curt.scoring_formats.formats[1])});`);
 await verify('The edit icon opens the correct format and another format change preserves its editor', String.raw`document.querySelector('.scoring_format_edit_dialog')?.dataset.scoringFormatId==='1'`);
 await c.evaluate(String.raw`__scoringEmit('scoring_format_changed',{scoring_format:structuredClone(curt.scoring_formats.formats[0])});`);
 await verify('An external change to the currently edited format closes the matching stale editor with an explanation', String.raw`!document.querySelector('.scoring_format_edit_dialog')&&document.querySelector('.live_settings_status_error').textContent.includes('in einem anderen Fenster geändert')`);
 await c.evaluate(String.raw`(()=>{const changed=structuredClone(curt.scoring_formats);changed.default_id=2;__scoringEmit('update_btp_scoring_formats',{scoring_formats:changed});})()`);
 await verify('A changed BTP default updates the badge and resolves formerly inherited assignments without stale exceptions', String.raw`__scoringEntry(1).querySelector('.settings-scoring-default').hidden&&!__scoringEntry(2).querySelector('.settings-scoring-default').hidden&&__scoringPanel().querySelector('.settings-scoring-standard strong').textContent==='1 × 30 Punkte'&&__scoringPanel().querySelectorAll('.settings-scoring-assignments-table tbody tr').length===1&&__scoringPanel().querySelector('.settings-scoring-assignments-table').textContent.includes('3 × 21 Punkte')`);
 await c.evaluate(String.raw`(()=>{const changed=structuredClone(curt.scoring_formats);changed.formats.reverse();__scoringEmit('update_btp_scoring_formats',{scoring_formats:changed});})()`);
 await verify('Reordering formats moves the existing nodes instead of replacing them', String.raw`__scoringPanel().querySelector('.settings-scoring-format-list').firstElementChild===__scoringEntry(2)&&__scoringFormatNodes.every(node=>node.isConnected)`);
 await c.evaluate(String.raw`(()=>{const events=structuredClone(__scoringEvents);events.events[0].stages[0].scoring_format=999;__scoringEmit('update_btp_events',{events});})()`);
 await verify('An unavailable explicitly assigned format is shown as unavailable rather than silently as the default', String.raw`__scoringPanel().querySelectorAll('.settings-scoring-assignments-table tbody tr').length===2&&__scoringPanel().querySelector('.settings-scoring-assignments-table').textContent.includes('Punktsystem nicht verfügbar')`);
 await c.evaluate(String.raw`__scoringEmit('update_btp_scoring_formats',{scoring_formats:{default_id:null,formats:[]}});__scoringEmit('update_btp_events',{events:{events:[]}});`);
 await verify('Removing imported data returns both cards to honest empty states and removes obsolete nodes', String.raw`!__scoringEntry(1)&&!__scoringEntry(2)&&__scoringPanel().textContent.includes('Noch keine Punktsysteme vorhanden')&&__scoringPanel().querySelector('.settings-scoring-standard strong').textContent==='Nicht festgelegt'&&__scoringPanel().querySelector('.settings-scoring-assignments-table').hidden&&__scoringPanel().querySelectorAll('.settings-card').length===2`);
 await c.evaluate(String.raw`__scoringEmit('update_btp_scoring_formats',{scoring_formats:structuredClone(__scoringSource)});__scoringEmit('update_btp_events',{events:{events:[]}});`);
 await verify('A tournament without explicit deviations states that all stages use its known default', String.raw`__scoringPanel().textContent.includes('Alle Turnierabschnitte verwenden den Turnierstandard.')&&__scoringPanel().querySelector('.settings-scoring-assignments-table').hidden`);
 await c.evaluate(String.raw`__scoringEmit('update_btp_events',{events:structuredClone(__scoringEvents)});__scoringEntry(1).querySelector('button').click();document.querySelector('.scoring_format_edit_dialog [name="set_points_interval_duration_s"]').value='1:01';document.querySelector('.scoring_format_edit_dialog form').requestSubmit();__scoringReplies.shift()(null,{});__scoringEmit('scoring_format_changed',{scoring_format:__scoringSaves.at(-1).scoring_format});document.activeElement.blur();`);
 await verify('A subsequent successful edit clears the earlier external-change notice', String.raw`!document.querySelector('.scoring_format_edit_dialog')&&!!document.querySelector('.live_settings_status_saved')`);
 for (const width of [1920,1280,950,390,320]) {
  await metrics(width,1000);
  await verify('Scoring cards, all rules and assignment rows fit without horizontal scrolling at '+width, String.raw`(()=>{const panel=__scoringPanel();return document.documentElement.scrollWidth<=innerWidth+1&&panel.scrollWidth<=panel.clientWidth+1&&[...panel.querySelectorAll('.settings-card,.settings-scoring-format-heading,.settings-scoring-rules,dt,dd,.settings-scoring-assignment-value')].every(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=-.5&&bounds.right<=document.documentElement.clientWidth+.5;});})()`);
  if (width===1920) await capture('einstellungen-punktsysteme',true);
  if (width===390) await capture('einstellungen-punktsysteme-mobil');
 }
 await metrics(1920,1080);
 await c.evaluate(String.raw`window.__scoringRetained=[...__scoringPanel().querySelectorAll('*')];document.querySelector('.settings-area-link[href$="/edit/officials"]').click();document.querySelector('.settings-area-link[href$="/edit/scoring"]').click();`);
 await verify('Switching specialist pages preserves the scoring nodes and the shared announcement service', String.raw`document===__scoringDocument&&btsSpeechService===__scoringService&&__scoringCancels===0&&__scoringUnloads===0&&__scoringRetained.every(node=>node.isConnected)&&document.querySelector('.page-settings').dataset.settingsSection==='scoring'`);
 await require('./settings-scoring-dialog-check.js')({c,verify,key,metrics,capture});
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('The scoring settings and live updates produce no browser exceptions', String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'settings-scoring-verification.json'),JSON.stringify({date:new Date().toISOString().slice(0,10),checks,exceptions:exceptions.length},null,2)+'\n');
};
