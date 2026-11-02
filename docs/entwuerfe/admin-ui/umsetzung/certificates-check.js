'use strict';
/* eslint no-console: off */
const fs = require('fs'), path = require('path');

module.exports = async function({c, check, click, open, metrics, previews, key}) {
 const checks = [], verify = async (name, expression) => {
  try {await check(name, expression);checks.push(name);}
  catch (error) {
   console.error(JSON.stringify(await c.evaluate(String.raw`({focus:document.activeElement?.outerHTML,rows:[...document.querySelectorAll('.certificate-event-row')].map(row=>({key:row.dataset.eventKey,hidden:row.hidden,expanded:row.querySelector('.certificate-event-name').getAttribute('aria-expanded'),detail:row.nextElementSibling.textContent,checked:row.querySelector('input').checked})),exceptions:window.__certificateNative})`)));
   throw error;
  }
 };
 const eventually = expression => c.evaluate('(async()=>{for(let i=0;i<100;i++){if(' + expression + ')return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error("Certificate export did not settle");})()');
 await open(1920,1080);
 await c.evaluate(String.raw`(()=>{
  window.__certificatePage=()=>document.querySelector('.page-certificates');
  window.__certificateTrigger=()=>document.querySelector('.leitstand-nav a[href="/admin/t/preview/certificates"]');
  window.__certificateCommands=[];window.__certificatePending=[];window.__certificateFiles=[];window.__certificateNative=0;
  window.__certificateReply=(type,error=null,data={})=>{const index=__certificatePending.findIndex(item=>item.message.type===type);if(index<0)throw new Error('No pending '+type);__certificatePending.splice(index,1)[0].callback(error,data);};
  window.__certificateInput=(name,value,event='input')=>{const node=__certificatePage().querySelector('[name="'+name+'"]');node.value=value;node.dispatchEvent(new Event(event,{bubbles:true}));};
  window.__certificateAction=text=>{const button=[...__certificatePage().querySelectorAll('button')].find(node=>node.textContent===text);const menu=button.closest('.certificate-actions-menu');if(menu)menu.open=true;button.click();};
  window.__certificateFilter=(name,value)=>{const node=__certificatePage().querySelector('[name="'+name+'"]');node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
  window.alert=window.confirm=window.prompt=()=>{__certificateNative++;throw new Error('Native dialog must not be used');};
  window.save_file=(blob,name)=>__certificateFiles.push({blob,name});
  const original=send;window.send=(message,callback)=>{
   if(!['tournament_edit_props','certificate_export_mark','certificate_export_reset'].includes(message.type))return original(message,callback);
   __certificateCommands.push(structuredClone(message));__certificatePending.push({message:structuredClone(message),callback});
  };
  window.__certificateLeave=()=>document.querySelector('.leitstand-nav a[href="/admin/t/preview/"]').click();
  window.__certificateHeaderLayout=()=>({children:[...document.querySelector('.leitstand-header').children].map(node=>node.className),services:[...document.querySelector('.toprow_right').children].map(node=>node.dataset.service),navigation:[...document.querySelectorAll('.leitstand-nav a')].map(node=>({href:node.getAttribute('href'),label:node.textContent}))});
  window.__certificateBoardHeader=JSON.stringify(__certificateHeaderLayout());
  window.__certificateDocument=document;window.__certificateService=btsSpeechService;window.__certificateUnloads=0;window.__certificateCancels=0;
  window.addEventListener('beforeunload',()=>__certificateUnloads++);
  btsSpeechService.cancel=()=>__certificateCancels++;
  window.__speechPlaybackGate=true;
  const text=document.querySelector('#custom_announcement');text.value='Laufende Ansage beim Reiterwechsel';text.dispatchEvent(new Event('input'));
  document.querySelector('#local_announce_btn').dataset.speechState='ready';document.querySelector('#local_announce_btn').click();
 })()`);
 await eventually('typeof __releaseSpeechPlayback==="function"');
 await c.evaluate('__certificateTrigger().click()');
 await verify('Urkunden is an active main-navigation page with its own URL and heading',String.raw`location.pathname==='/admin/t/preview/certificates'&&current_view==='certificates'&&document.querySelector('.leitstand-nav [aria-current="page"]').textContent==='Urkunden'&&document.querySelector('.leitstand-header .board-page-title').textContent==='BTS – Urkunden'&&document.querySelector('.leitstand-header .ct_name').textContent===(curt.name||curt.key)&&!__certificatePage().querySelector('h1,.certificates-heading')`);
 await verify('The header contains the accessible page heading and the certificate icon in its green brand mark, matching the navigation icon',String.raw`(()=>{const title=document.getElementById('leitstand-page-title'),mark=document.querySelector('.leitstand-header .board-brand-mark svg'),nav=document.querySelector('.leitstand-nav [aria-current="page"] svg'),court=document.querySelector('.leitstand-nav a[href="/admin/t/preview/"] svg');return title.getAttribute('role')==='heading'&&title.getAttribute('aria-level')==='1'&&__certificatePage().getAttribute('aria-labelledby')===title.id&&mark.outerHTML===nav.outerHTML&&mark.outerHTML!==court.outerHTML;})()`);
 await verify('Certificates share the complete board navigation without Testlabor, with four service indicators and no hamburger menu',String.raw`JSON.stringify(__certificateHeaderLayout())===__certificateBoardHeader&&__certificateHeaderLayout().navigation.map(link=>link.label).join('|')==='Turnierleitung|Anmeldung|Urkunden|Sprachsystem|Geräte & Logs|Einstellungen'&&__certificateHeaderLayout().services.join('|')==='bts|btp|ticker|speech'&&!document.querySelector('.leitstand-header .toprow_menu')`);
 await verify('A running announcement survives navigation without cancelling, replaying or reloading',String.raw`document===__certificateDocument&&btsSpeechService===__certificateService&&__certificateUnloads===0&&__certificateCancels===0&&__localAnnouncements.length===1&&announcementPlaybackActive`);
 await verify('The workspace has no modal, close button, scroll lock or focus trap',String.raw`!document.querySelector('dialog[open]')&&!__certificatePage().querySelector('.ls-dialog-close')&&getComputedStyle(document.body).overflowY!=='hidden'&&document.activeElement===document.getElementById('leitstand-page-title')`);
 await c.evaluate('__certificateLeave()');
 await verify('Returning to the board preserves the running playback and active navigation',String.raw`!!document.querySelector('.page-leitstand')&&document===__certificateDocument&&__certificateCancels===0&&__localAnnouncements.length===1&&announcementPlaybackActive&&document.querySelector('.leitstand-nav [aria-current="page"]').textContent==='Turnierleitung'&&document.querySelector('.leitstand-header .board-page-title').textContent==='BTS – Turnierleitung'&&document.querySelector('.leitstand-header .board-brand-mark svg').outerHTML===document.querySelector('.leitstand-nav [aria-current="page"] svg').outerHTML`);
 await verify('Returning restores the same header and retains the board tools in the workspace',String.raw`JSON.stringify(__certificateHeaderLayout())===__certificateBoardHeader&&!document.querySelector('.leitstand-header .toprow_menu')&&!!document.querySelector('.board-toolbar-actions .board-menu-content a[href^="/bup/#btsh_e="]')`);
 await c.evaluate(String.raw`window.__speechPlaybackGate=false;__releaseSpeechPlayback();curt.matches=[];__certificateTrigger().click()`);
 await verify('An empty tournament explains missing disciplines and hides file actions without writes',String.raw`__certificatePage().textContent.includes('Keine Disziplinen mit Platzierungsspielen')&&__certificatePage().querySelector('.certificate-export-csv').hidden&&__certificatePage().querySelector('.certificate-export-xlsx').hidden&&__certificateCommands.length===0`);
 await c.evaluate(String.raw`__certificateInput('veranstaltung_1','Gespeicherter Titel')`);await eventually('__certificatePending.some(item=>item.message.type==="tournament_edit_props")');
 await verify('Settings also save in an empty export and pin the original tournament key',String.raw`__certificateCommands.length===1&&__certificateCommands[0].key==='preview'&&__certificateCommands[0].props.certificate_title_line_1==='Gespeicherter Titel'&&__certificatePage().querySelector('form').getAttribute('aria-busy')==='true'`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props')`);await c.evaluate('__certificateLeave()');
 await verify('Leaving saved settings returns to the board',String.raw`!__certificatePage()&&!!document.querySelector('.page-leitstand')&&curt.certificate_title_line_1==='Gespeicherter Titel'`);
 await c.evaluate(String.raw`(()=>{
  const date=new Date(),day=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  const previous=new Date(date);previous.setDate(previous.getDate()-1);window.__certificatePreviousDay=previous.getFullYear()+'-'+String(previous.getMonth()+1).padStart(2,'0')+'-'+String(previous.getDate()).padStart(2,'0');
  const team=(names,start)=>({players:names.map((name,index)=>({name,btp_id:start+index}))});
  const final=(id,event,doubles)=>({_id:id,tournament_key:'preview',team1_won:true,network_score:[[21,12],[21,10]],presses:[],setup:{state:'finished',is_match:true,is_doubles:doubles,match_num:doubles?902:901,match_name:'Finale',event_name:event,scheduled_date:doubles?__certificatePreviousDay:day,scheduled_time_str:'18:00',teams:[team(doubles?['Anton Sieger','Berta Siegerin']:['Carl Gewinner'],1000),team(doubles?['Dora Zweite','Emil Zweiter']:['Frieda Zweite'],2000)]}});
  curt.matches=[final('certificate-single','JE U17',false),final('certificate-double','JD U17',true)];curt.certificate_export_max_place=2;curt.certificate_exports={};
  __certificateCommands.length=0;__certificateTrigger().click();
 })()`);
 await verify('Completed singles and doubles are selected and both file formats are available',String.raw`__certificatePage().querySelectorAll('input[data-certificate-key]:checked').length===2&&!__certificatePage().querySelector('.certificate-export-csv').disabled&&!__certificatePage().querySelector('.certificate-export-xlsx').disabled`);
 await verify('All four output actions use the same neutral button style and distinct decorative icons',String.raw`(()=>{const buttons=[...__certificatePage().querySelectorAll('.certificate-export-pdf,.certificate-export-print,.certificate-export-csv,.certificate-export-xlsx')],styles=buttons.map(node=>{const style=getComputedStyle(node);return [style.backgroundColor,style.color,style.borderTopColor,style.fontWeight].join('|');}),icons=buttons.map(node=>getComputedStyle(node,'::before').maskImage);return buttons.length===4&&buttons.every(node=>!node.disabled&&!node.classList.contains('primary'))&&new Set(styles).size===1&&icons.every(icon=>icon!=='none')&&new Set(icons).size===4;})()`);
 await verify('Discipline selection is a full-width table with permanently visible general settings',String.raw`__certificatePage().querySelector('.certificate-settings').tagName==='SECTION'&&!__certificatePage().querySelector('.certificate-settings summary')&&['veranstaltung_1','veranstaltung_2','ort','max_place'].every(name=>__certificatePage().querySelector('[name="'+name+'"]').getClientRects().length>0)&&__certificatePage().querySelectorAll('.certificate-event-table th').length===7&&__certificatePage().querySelectorAll('.certificate-event-row').length===2&&__certificatePage().querySelector('.certificate-selection').getBoundingClientRect().width>1200`);
 await verify('Date filtering starts disabled and shows selected disciplines from different days',String.raw`!__certificatePage().querySelector('[name="certificate_date_filter_enabled"]').checked&&__certificatePage().querySelector('[name="certificate_date_filter"]').disabled&&[...__certificatePage().querySelectorAll('.certificate-event-row')].every(row=>!row.hidden)&&__certificatePage().querySelectorAll('[data-certificate-key]:checked').length===2&&curt.matches[0].setup.scheduled_date!==curt.matches[1].setup.scheduled_date`);
 await c.evaluate(String.raw`__certificatePage().querySelector('[name="certificate_date_filter_enabled"]').click()`);
 await verify('Opting into the date filter restricts visible dates without dropping selected disciplines',String.raw`!__certificatePage().querySelector('[name="certificate_date_filter"]').disabled&&__certificatePage().querySelector('[data-event-key="JD U17"]').hidden&&!__certificatePage().querySelector('[data-event-key="JE U17"]').hidden&&__certificatePage().querySelectorAll('[data-certificate-key]:checked').length===2&&__certificatePage().querySelector('.certificate-export-selection').textContent.includes('1 ausgeblendet')`);
 await c.evaluate(String.raw`__certificateFilter('certificate_date_filter',__certificatePreviousDay)`);
 await verify('The chosen date shows its own disciplines while preserving the full export selection',String.raw`!__certificatePage().querySelector('[data-event-key="JD U17"]').hidden&&__certificatePage().querySelector('[data-event-key="JE U17"]').hidden&&__certificatePage().querySelectorAll('[data-certificate-key]:checked').length===2`);
 await c.evaluate(String.raw`__certificatePage().querySelector('[name="certificate_date_filter_enabled"]').click()`);
 await verify('Disabling the date filter restores all dates and remembers the chosen date',String.raw`__certificatePage().querySelector('[name="certificate_date_filter"]').disabled&&__certificatePage().querySelector('[name="certificate_date_filter"]').value===__certificatePreviousDay&&[...__certificatePage().querySelectorAll('.certificate-event-row')].every(row=>!row.hidden)&&__certificatePage().querySelectorAll('[data-certificate-key]:checked').length===2`);
 await c.evaluate(String.raw`__certificatePage().querySelector('[name="certificate_date_filter_enabled"]').click();__certificateAction('Filter zurücksetzen')`);
 await verify('Resetting filters also turns off the optional date filter',String.raw`!__certificatePage().querySelector('[name="certificate_date_filter_enabled"]').checked&&__certificatePage().querySelector('[name="certificate_date_filter"]').disabled&&[...__certificatePage().querySelectorAll('.certificate-event-row')].every(row=>!row.hidden)`);
 await c.evaluate(String.raw`__certificatePage().querySelector('.certificate-selection-heading summary').focus()`);await key(' ','Space',32,' ');
 await verify('The global action menu opens with the keyboard and explains unavailable reset actions',String.raw`__certificatePage().querySelector('.certificate-selection-heading details').open&&__certificatePage().querySelector('.certificate-selection-heading .certificate-export-reset').disabled&&!!__certificatePage().querySelector('.certificate-selection-heading .certificate-export-reset').title`);
 await key('Escape','Escape',27);
 await verify('Escape closes the action menu and returns focus to its trigger',String.raw`!__certificatePage().querySelector('.certificate-selection-heading details').open&&document.activeElement===__certificatePage().querySelector('.certificate-selection-heading summary')`);
 await c.evaluate(String.raw`__certificatePage().querySelector('[data-event-key="JD U17"] .certificate-event-name').focus()`);await key('Enter','Enter',13,'\r');
 await verify('Keyboard activation opens doubles placements without changing selection',String.raw`__certificatePage().querySelector('[data-event-key="JD U17"] .certificate-event-name').getAttribute('aria-expanded')==='true'&&__certificatePage().querySelector('[data-event-key="JD U17"]').nextElementSibling.textContent.includes('Anton Sieger / Berta Siegerin')&&!__certificatePage().querySelector('[data-event-key="JD U17"]').nextElementSibling.hidden&&__certificatePage().querySelectorAll('[data-certificate-key]:checked').length===2`);
 await c.evaluate(String.raw`__certificateFilter('certificate_kind_filter','single')`);
 await verify('Filtering hides rows while preserving selection, details and the hidden-selection count',String.raw`__certificatePage().querySelector('[data-event-key="JD U17"]').hidden&&__certificatePage().querySelector('[data-event-key="JD U17"]').nextElementSibling.hidden&&__certificatePage().querySelector('[data-certificate-key="JD U17"]').checked&&__certificatePage().querySelector('.certificate-export-selection').textContent.includes('1 ausgeblendet')&&!__certificatePage().querySelector('.certificate-export-csv').disabled`);
 await c.evaluate(String.raw`__certificateAction('Auswahl aufheben');__certificateAction('Sichtbare auswählen')`);
 await verify('Selecting visible rows does not select filtered disciplines',String.raw`__certificatePage().querySelector('[data-certificate-key="JE U17"]').checked&&!__certificatePage().querySelector('[data-certificate-key="JD U17"]').checked`);
 await c.evaluate(String.raw`__certificatePage().querySelector('[name="certificate_date_filter_enabled"]').click();__certificateFilter('certificate_date_filter','2000-01-01')`);
 await verify('An empty filter result explains that the hidden export selection remains intact',String.raw`__certificatePage().querySelector('.certificate-event-table').hidden&&__certificatePage().querySelector('.certificate-empty').textContent.includes('Auswahl bleibt erhalten')&&__certificatePage().querySelector('.certificate-export-selection').textContent.includes('1 ausgeblendet')&&!__certificatePage().querySelector('.certificate-export-csv').disabled`);
 await c.evaluate(String.raw`__certificateAction('Filter zurücksetzen');__certificateAction('Sichtbare auswählen')`);
 await verify('Clearing filters restores expanded details and retains all selection state',String.raw`!__certificatePage().querySelector('[data-event-key="JD U17"]').nextElementSibling.hidden&&__certificatePage().querySelectorAll('[data-certificate-key]:checked').length===2&&!__certificatePage().querySelector('.certificate-export-selection').textContent.includes('ausgeblendet')`);
 await c.evaluate(String.raw`__certificatePage().querySelector('[data-event-key="JD U17"] .certificate-event-name').click()`);
 await c.evaluate(String.raw`(()=>{
  window.__certificateTitle=__certificatePage().querySelector('[name="veranstaltung_2"]');__certificateTitle.value='Bleibender Entwurf';__certificateTitle.focus();
  window.__certificateChoice=__certificatePage().querySelector('[data-certificate-key="JD U17"]');__certificateChoice.checked=false;
  const match=curt.matches[0];crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:match._id,network_score:[[12,21],[10,21]],presses:[],team1_won:false}});
 })()`);
 await verify('Live results update placements without replacing focused inputs or selected discipline rows',String.raw`document.activeElement===__certificateTitle&&__certificateTitle.value==='Bleibender Entwurf'&&__certificatePage().querySelector('[data-certificate-key="JD U17"]')===__certificateChoice&&!__certificateChoice.checked&&__certificatePage().querySelector('[data-certificate-key="JE U17"]').title.includes('Frieda Zweite')&&__certificateCommands.length===0`);
 await c.evaluate(String.raw`(()=>{
  crouting.on_change({ctype:'prop_changed',tournament_key:'preview',val:{field:'certificate_exports',value:{'JE U17':Date.now()}}});
 })()`);
 await verify('Export status from another page updates the table without overwriting drafts or selections',String.raw`__certificatePage().querySelector('[data-certificate-key="JE U17"]').dataset.exported==='true'&&document.activeElement===__certificateTitle&&__certificateTitle.value==='Bleibender Entwurf'&&!__certificateChoice.checked`);
 await c.evaluate(String.raw`(()=>{
  window.__certificateLiveMatch=structuredClone(curt.matches[0]);__certificateLiveMatch._id='live-certificate';__certificateLiveMatch.setup.event_name='ME U19';delete __certificateLiveMatch.team1_won;__certificateLiveMatch.network_score=[];
  crouting.on_change({ctype:'match_add',tournament_key:'preview',val:{match__id:__certificateLiveMatch._id,match:__certificateLiveMatch}});
 })()`);
 await verify('New placement disciplines appear through live updates without replacing existing selections',String.raw`!!__certificatePage().querySelector('[data-certificate-key="ME U19"]')&&__certificatePage().querySelector('[data-certificate-key="JD U17"]')===__certificateChoice&&!__certificateChoice.checked&&document.activeElement===__certificateTitle`);
 await c.evaluate(String.raw`(()=>{
  crouting.on_change({ctype:'match_delete',tournament_key:'preview',val:{match__id:__certificateLiveMatch._id}});
  crouting.on_change({ctype:'prop_changed',tournament_key:'preview',val:{field:'certificate_exports',value:{}}});
  const match=curt.matches[0];crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:match._id,network_score:[[21,12],[21,10]],presses:[],team1_won:true}});
  __certificateTitle.value='';__certificateChoice.checked=true;
 })()`);
 await verify('Removed disciplines disappear while focused inputs and existing rows stay mounted',String.raw`!__certificatePage().querySelector('[data-certificate-key="ME U19"]')&&__certificatePage().querySelector('[data-certificate-key="JD U17"]')===__certificateChoice&&document.activeElement===__certificateTitle&&__certificateCommands.length===0`);
 await verify('An empty discipline replacement disables adding with an explicit reason',String.raw`[...__certificatePage().querySelectorAll('button')].find(node=>node.textContent==='Hinzufügen').disabled&&[...__certificatePage().querySelectorAll('button')].find(node=>node.textContent==='Hinzufügen').title.includes('Disziplintext')`);
 await c.evaluate(String.raw`(()=>{const input=__certificatePage().querySelector('input[placeholder="Ersetzung"]');input.value='Doppelwertung';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await verify('Entering a discipline replacement enables its contextual action without saving prematurely',String.raw`![...__certificatePage().querySelectorAll('button')].find(node=>node.textContent==='Hinzufügen').disabled&&__certificatePending.length===0`);
 await c.evaluate(String.raw`(()=>{const input=__certificatePage().querySelector('input[placeholder="Ersetzung"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await c.evaluate(String.raw`__certificateAction('Auswahl aufheben')`);
 await verify('No selection disables both exports and explains the reason in the footer and tooltip',String.raw`[...__certificatePage().querySelectorAll('.certificate-export-csv,.certificate-export-xlsx')].every(node=>node.disabled&&node.title.includes('mindestens eine Disziplin')&&node.getAttribute('aria-describedby')===__certificatePage().querySelector('[role="status"]').id)&&__certificatePage().querySelector('[role="status"]').textContent.includes('mindestens eine Disziplin')`);
 await c.evaluate(String.raw`__certificateAction('Sichtbare auswählen');__certificateInput('max_place','0')`);
 await verify('An invalid certificate count blocks export with an actionable reason',String.raw`__certificatePage().querySelector('.certificate-export-csv').disabled&&__certificatePage().querySelector('.certificate-export-csv').title.includes('ab 1')`);
 await c.evaluate(String.raw`__certificateInput('max_place','2');__certificatePage().querySelector('form').requestSubmit()`);
 await verify('Enter or a form submit cannot accidentally export a file',String.raw`__certificateFiles.length===0&&__certificateCommands.length===0`);
 await c.evaluate(String.raw`__certificatePage().querySelector('.certificate-export-xlsx').focus()`);await key('Tab','Tab',9);
 await verify('Tab leaves the last export action without wrapping inside the workspace',String.raw`document.activeElement!==__certificatePage().querySelector('h1')`);
 await c.evaluate(String.raw`window.__certificateOriginalResults=curt.matches.map(match=>({score:match.network_score,winner:match.team1_won}));curt.matches.forEach(match=>{match.network_score=[];delete match.team1_won;});__certificatePage().querySelector('input[data-certificate-key]').dispatchEvent(new Event('change',{bubbles:true}))`);
 await verify('An existing selection without known placements is visibly disabled',String.raw`__certificatePage().querySelector('.certificate-export-csv').disabled&&__certificatePage().querySelector('.certificate-export-csv').title.includes('keine eindeutigen Platzierungen')`);
 await c.evaluate(String.raw`curt.matches.forEach((match,index)=>{match.network_score=__certificateOriginalResults[index].score;match.team1_won=__certificateOriginalResults[index].winner;});__certificatePage().querySelector('input[data-certificate-key]').dispatchEvent(new Event('change',{bubbles:true}))`);
 for(const [width,height] of [[1920,1080],[390,844],[320,568],[844,390]]) {
  await metrics(width,height);await c.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');
  await verify('The workspace has no horizontal overflow at '+width+'x'+height,String.raw`document.documentElement.scrollWidth<=innerWidth&&__certificatePage().scrollWidth<=__certificatePage().clientWidth`);
  await verify('Footer actions fit and stay reachable at '+width+'x'+height,String.raw`(()=>{const f=__certificatePage().querySelector('.certificate-export-footer').getBoundingClientRect();return f.top>=0&&f.bottom<=innerHeight+1&&[...__certificatePage().querySelectorAll('.certificate-export-footer button:not([hidden])')].every(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight+1;});})()`);
  await c.evaluate(String.raw`__certificatePage().querySelector('input[data-certificate-key="JE U17"]').scrollIntoView({block:'center'})`);
  await verify('The final discipline is reachable through normal page scrolling at '+width+'x'+height,String.raw`(()=>{const r=__certificatePage().querySelector('input[data-certificate-key="JE U17"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`);
 }
 await metrics(1920,1080);
 await c.evaluate(String.raw`__certificateFilter('certificate_kind_filter','single')`);
 await c.evaluate(String.raw`window.__certificateOriginalExport=ccsvexport.export_certificate_file;ccsvexport.export_certificate_file=()=>{throw new Error('Synthetic file generation failure');}`);
 await click('.page-certificates .certificate-export-csv');
 await verify('File generation failure sends no export mark and leaves the draft available for retry',String.raw`__certificateFiles.length===0&&__certificatePending.length===0&&!__certificatePage().querySelector('.certificate-export-csv').disabled&&__certificatePage().querySelector('[role="status"]').textContent.includes('nicht erstellt')`);
 await c.evaluate(String.raw`ccsvexport.export_certificate_file=__certificateOriginalExport`);await click('.page-certificates .certificate-export-csv');
 await verify('CSV includes both visible and hidden selected disciplines and marks exactly those keys',String.raw`__certificateFiles.length===1&&__certificateFiles[0].name==='urkunden.csv'&&__certificateFiles[0].blob.size>0&&__certificatePending[0].message.type==='certificate_export_mark'&&__certificatePending[0].message.tournament_key==='preview'&&__certificatePending[0].message.event_names.sort().join('|')==='JD U17|JE U17'`);
 await verify('CSV contents include both doubles partners and the custom title',String.raw`(await __certificateFiles[0].blob.text()).includes('Anton Sieger')&&(await __certificateFiles[0].blob.text()).includes('Berta Siegerin')&&(await __certificateFiles[0].blob.text()).includes('Gespeicherter Titel')`);
 await c.evaluate(String.raw`__certificatePage().querySelector('.certificate-export-csv').click();__certificateLeave()`);await key('Escape','Escape',27);
 await c.evaluate('new Promise(resolve=>setTimeout(resolve,5100))');
 await verify('A pending export blocks duplicate exports and tab navigation and locks its inputs',String.raw`__certificateFiles.length===1&&!!__certificatePage()&&__certificatePage().querySelector('fieldset').disabled&&__certificatePage().querySelector('form').getAttribute('aria-busy')==='true'&&__certificatePage().querySelector('.certificate-export-csv').textContent==='CSV wird exportiert…'`);
 await c.evaluate(String.raw`__certificateReply('certificate_export_mark',null,{certificate_exports:{'JE U17':Date.now(),'JD U17':Date.now()}})`);
 await verify('Acknowledged export updates the existing table statuses and releases the footer',String.raw`!__certificatePage().querySelector('form').hasAttribute('aria-busy')&&__certificatePage().querySelectorAll('input[data-certificate-key][data-exported="true"]').length===2&&__certificatePage().querySelector('[role="status"]').textContent.includes('CSV-Datei wurde erstellt')`);
 await click('.page-certificates .certificate-export-xlsx');
 await verify('XLSX creates a real workbook rather than a second CSV',String.raw`__certificateFiles.length===2&&__certificateFiles[1].name==='urkunden.xlsx'&&__certificateFiles[1].blob.type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'&&__certificateFiles[1].blob.size>0`);
 await c.evaluate(String.raw`__certificateReply('certificate_export_mark',{message:'Mark failed'})`);
 await verify('Mark failure distinguishes the existing download from missing export status and permits retry',String.raw`__certificatePage().querySelector('[role="status"]').textContent.includes('Datei wurde erstellt, aber der Exportstatus')&&!__certificatePage().querySelector('.certificate-export-xlsx').disabled`);
 await c.evaluate(String.raw`__certificateAction('Filter zurücksetzen');const row=__certificatePage().querySelector('input[data-certificate-key="JD U17"]').closest('tr');row.querySelector('.certificate-actions-menu').open=true;row.querySelector('.certificate-export-reset').click()`);await click('.bts-confirm-accept');
 await verify('Resetting one discipline sends only that discipline key',String.raw`__certificatePending.length===1&&__certificatePending[0].message.event_name==='JD U17'&&!__certificatePending[0].message.all`);
 await c.evaluate(String.raw`__certificateReply('certificate_export_reset',null,{certificate_exports:{'JE U17':Date.now()}})`);
 await verify('A single reset preserves other disciplines export markers',String.raw`!!curt.certificate_exports['JE U17']&&!curt.certificate_exports['JD U17']&&__certificatePage().querySelector('input[data-certificate-key="JD U17"]').dataset.exported==='false'`);
 await c.evaluate(String.raw`__certificateAction('Exportstatus aller Disziplinen zurücksetzen')`);
 await verify('Reset uses a yellow warning explaining that files and results remain',String.raw`document.querySelector('.bts-confirm-dialog.is-warning')?.open&&document.querySelector('.bts-confirm-content').textContent.includes('Dateien und Spielergebnisse bleiben erhalten')&&__certificatePending.length===0`);
 await click('.bts-confirm-cancel');await verify('Cancelling reset has no server side effects',String.raw`__certificatePending.length===0&&Object.keys(curt.certificate_exports).length===1`);
 await c.evaluate(String.raw`__certificateAction('Exportstatus aller Disziplinen zurücksetzen')`);await click('.bts-confirm-accept');
 await verify('Explicit reset sends one guarded request and keeps the workspace busy',String.raw`__certificatePending.length===1&&__certificatePending[0].message.type==='certificate_export_reset'&&__certificatePending[0].message.all===true&&__certificatePage().querySelector('form').getAttribute('aria-busy')==='true'`);
 await c.evaluate(String.raw`__certificateReply('certificate_export_reset',null,{certificate_exports:{}})`);
 await verify('Reset updates table statuses and disables reset actions that now have no function',String.raw`__certificatePage().querySelectorAll('input[data-certificate-key][data-exported="false"]').length===2&&[...__certificatePage().querySelectorAll('.certificate-export-reset')].every(node=>node.disabled&&node.title)&&[...__certificatePage().querySelectorAll('.certificate-event-row .certificate-export-reset')].every(node=>node.getAttribute('aria-label').includes('Exportstatus für')&&!!node.querySelector('.ico'))`);
 await c.evaluate(String.raw`__certificateInput('veranstaltung_2','Erster Wert')`);await eventually('__certificatePending.length===1');
 await c.evaluate(String.raw`__certificateInput('veranstaltung_2','Neuster Wert')`);await c.evaluate('new Promise(resolve=>setTimeout(resolve,300))');
 await verify('Overlapping automatic saves are serialized while newer input stays editable',String.raw`__certificatePending.length===1&&!__certificatePage().querySelector('[name="veranstaltung_2"]').matches(':disabled')&&__certificatePage().querySelector('[name="veranstaltung_2"]').value==='Neuster Wert'`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props')`);
 await verify('The newest queued value follows the acknowledged save',String.raw`__certificatePending.length===1&&__certificatePending[0].message.props.certificate_title_line_2==='Neuster Wert'`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props',{message:'Save failed'})`);
 await verify('Failed autosave displays the server error, preserves input and offers retry with disabled exports',String.raw`__certificatePage().querySelector('[name="veranstaltung_2"]').value==='Neuster Wert'&&!__certificatePage().querySelector('.certificate-export-retry').hidden&&__certificatePage().querySelector('.certificate-export-csv').disabled&&__certificatePage().querySelector('[role="status"]').textContent.includes('nicht gespeichert')&&__certificatePage().querySelector('[role="status"]').textContent.includes('Save failed')`);
 for(const [width,height] of [[320,568],[844,390]]) {
  await metrics(width,height);await c.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');
  await verify('The retry action fits the viewport at '+width+'x'+height,String.raw`(()=>{const r=__certificatePage().querySelector('.certificate-export-retry').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight+1;})()`);
 }
 await metrics(1920,1080);
 await c.evaluate('__certificateLeave()');await verify('Leaving failed settings asks before discarding them',String.raw`document.querySelector('.bts-confirm-dialog.is-warning')?.open&&document.querySelector('.bts-confirm-content').textContent.includes('Änderungen verloren')`);
 await click('.bts-confirm-cancel');await verify('Keeping failed settings retains the workspace and restores navigation focus',String.raw`!!__certificatePage()&&document.activeElement===document.querySelector('.leitstand-nav a[href="/admin/t/preview/"]')`);
 await click('.page-certificates .certificate-export-retry');
 await verify('Retry resends the latest failed values without another file download',String.raw`__certificatePending.length===1&&__certificatePending[0].message.props.certificate_title_line_2==='Neuster Wert'&&__certificateFiles.length===2`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props');__certificateInput('ort','Letzte Eingabe');__certificateLeave()`);
 await verify('Switching tabs flushes the last debounced edit and waits for its acknowledgement',String.raw`!!__certificatePage()&&__certificatePending.length===1&&__certificatePending[0].message.props.certificate_export_location==='Letzte Eingabe'`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props')`);
 await verify('Successful final save switches tabs without losing settings',String.raw`!__certificatePage()&&curt.certificate_export_location==='Letzte Eingabe'&&!!document.querySelector('.page-leitstand')`);
 await c.evaluate(String.raw`__certificateTrigger().click();__certificateInput('veranstaltung_2','Verworfener Wert')`);await eventually('__certificatePending.length===1');
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props',{message:'Discard failure'})`);await c.evaluate('__certificateLeave()');await click('.bts-confirm-accept');
 await verify('Explicitly discarding failed settings leaves without changing saved values',String.raw`!__certificatePage()&&curt.certificate_title_line_2==='Neuster Wert'&&__certificatePending.length===0`);
 await c.evaluate(String.raw`__certificateTrigger().click();__certificateInput('veranstaltung_1','Veraltete Antwort')`);await eventually('__certificatePending.length===1');
 await c.evaluate(String.raw`window.__certificateOldTournament=curt;curt={...curt,key:'other-tournament',certificate_title_line_1:'Anderes Turnier'};document.querySelector('.main').append(document.createElement('span'))`);
 await verify('Changing tournament disposes the old workspace',String.raw`!__certificatePage()`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props');window.__certificateOtherTitle=curt.certificate_title_line_1;curt=__certificateOldTournament;__certificateTrigger().click()`);
 await verify('A late response cannot change another tournament or close a newer workspace',String.raw`!!__certificatePage()&&__certificateOtherTitle==='Anderes Turnier'&&__certificatePending.length===0`);
 await key('Escape','Escape',27);await verify('Escape keeps the workspace open without native dialogs',String.raw`!!__certificatePage()&&__certificateNative===0`);
 await c.evaluate(String.raw`__certificateTrigger().click();__certificateInput('veranstaltung_1','Veralteter Schlüssel');window.__certificateBeforeKeyChange=__certificateCommands.length;curt.key='other-tournament';document.querySelector('.main').append(document.createElement('span'))`);
 await c.evaluate('new Promise(resolve=>setTimeout(resolve,300))');
 await verify('An in-place tournament-key change cancels deferred requests instead of sending them to the new key',String.raw`!__certificatePage()&&__certificateCommands.length===__certificateBeforeKeyChange`);
 await c.evaluate(String.raw`curt.key='preview'`);
 await c.evaluate(String.raw`history.pushState(null,'','/admin/t/preview/certificate_export');crouting.rerender()`);await eventually('!!__certificatePage()');
 await verify('The legacy export URL redirects to the Urkunden page',String.raw`location.pathname==='/admin/t/preview/certificates'&&document.querySelector('.leitstand-header .board-page-title').textContent==='BTS – Urkunden'&&document.querySelector('.leitstand-header .ct_name').textContent===(curt.name||curt.key)&&!__certificatePage().querySelector('h1,.certificates-heading')&&JSON.stringify(__certificateHeaderLayout())===__certificateBoardHeader&&!document.querySelector('.leitstand-header .toprow_menu')`);
 await c.evaluate('__certificateLeave()');await eventually('!__certificatePage()&&location.pathname==="/admin/t/preview/"&&!!document.querySelector(".leitstand")');
 await verify('Main navigation returns from the legacy link to the tournament board',String.raw`!__certificatePage()&&!!document.querySelector('.leitstand')&&location.pathname==='/admin/t/preview/'`);
 await c.evaluate('__certificateTrigger().click();history.back()');await eventually('!!document.querySelector(".page-leitstand")');
 await verify('Browser Back returns to the board without reloading the document',String.raw`document===__certificateDocument&&!__certificatePage()&&__certificateUnloads===0&&__certificateCancels===0`);
 await c.evaluate('history.forward()');await eventually('!!__certificatePage()');
 await verify('Browser Forward restores the Urkunden tab without reloading or restarting announcements',String.raw`current_view==='certificates'&&document===__certificateDocument&&__certificateUnloads===0&&__certificateCancels===0&&__localAnnouncements.length===1`);
 await c.evaluate(String.raw`(()=>{
  const base=structuredClone(curt.matches[0]);
  window.__certificateMixedIds=[];
  for(const [index,matchName,birthYears,names] of [[0,'Finale',[2014,2016],['Aeltere Siegerin','Juengere Siegerin']],[1,'3/4',[2014,2015],['Dritte Spielerin','Vierte Spielerin']]]) {
   const match=structuredClone(base);match._id='certificate-mixed-'+index;match.setup.event_name='ME U13';match.setup.match_name=matchName;match.setup.draw_id=6;match.team1_won=true;match.network_score=[[21,12],[21,10]];if(index===1){delete match.team1_won;match.network_score=[];}
   match.setup.teams=birthYears.map((birth_year,i)=>({players:[{btp_id:10000+index*2+i,name:names[i],birth_year,entries:{6:'<none>'}}]}));
   __certificateMixedIds.push(match._id);crouting.on_change({ctype:'match_add',tournament_key:'preview',val:{match__id:match._id,match}});
  }
  __certificateAction('Filter zurücksetzen');
  __certificatePage().querySelector('[data-event-key="ME U13"] .certificate-event-name').click();
 })()`);
 await verify('Combined disciplines retain their placement names and separate age-class controls in details',String.raw`__certificatePage().querySelector('[data-event-key="ME U13"]').nextElementSibling.textContent.includes('Aeltere Siegerin')&&!!__certificatePage().querySelector('[data-event-key="ME U13"]').nextElementSibling.querySelector('[data-age-group="U11"]')`);
 await verify('Readiness covers the requested places even while later placement games are unresolved',String.raw`__certificatePage().querySelector('[data-event-key="ME U13"] .certificate-places').textContent.includes('bereit')&&__certificatePage().querySelector('.certificate-selection-note').textContent.includes('gewünschten Urkundenplätze')`);
 await c.evaluate(String.raw`__certificateInput('max_place','4')`);
 await verify('Requesting further places exposes missing ranks in the row and expanded details',String.raw`__certificatePage().querySelector('[data-event-key="ME U13"] .certificate-places').textContent.includes('3–4 offen')&&__certificatePage().querySelector('[data-event-key="ME U13"]').nextElementSibling.textContent.includes('Ausstehende Plätze: 3–4')&&__certificatePage().querySelector('[data-event-key="ME U13"]').nextElementSibling.textContent.includes('3/4')`);
 await c.evaluate(String.raw`__certificateInput('max_place','2')`);
 await c.evaluate(String.raw`window.__certificateMixedRow=__certificatePage().querySelector('[data-event-key="ME U13"]');window.__certificateAgeControl=__certificateMixedRow.nextElementSibling.querySelector('[data-age-group="U11"]');__certificateAgeControl.focus();__certificateAgeControl.click()`);
 await verify('Enabling a separate valuation preserves its parent row, expanded details and keyboard focus',String.raw`__certificatePending.length===1&&__certificatePending[0].message.props.certificate_age_class_splits['ME U13'].includes('U11')&&__certificatePage().querySelector('[data-event-key="ME U13"]')===__certificateMixedRow&&document.activeElement===__certificateAgeControl&&!!__certificatePage().querySelector('[data-certificate-key="ME U13::age:U11"]')&&!__certificatePage().querySelector('[data-certificate-key="ME U13::age:U11"]').checked`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props');__certificatePage().querySelector('[data-event-key="ME U13::age:U11"] .certificate-event-name').click()`);
 await verify('Separate valuation details show the correct younger participant and their source discipline',String.raw`__certificatePage().querySelector('[data-event-key="ME U13::age:U11"]').nextElementSibling.textContent.includes('Juengere Siegerin')&&!__certificatePage().querySelector('[data-event-key="ME U13::age:U11"]').nextElementSibling.querySelector('.certificate-placement-list').textContent.includes('Aeltere Siegerin')&&__certificatePage().querySelector('[data-event-key="ME U13::age:U11"] .certificate-event-source').textContent.includes('ME U13')`);
 for(const [width,height] of [[390,844],[320,568],[844,390]]) {
  await metrics(width,height);await c.evaluate(String.raw`__certificatePage().querySelector('[data-event-key="ME U13::age:U11"]').scrollIntoView({block:'center'})`);
  await verify('Expanded details and all discipline information fit without horizontal scrolling at '+width+'x'+height,String.raw`document.documentElement.scrollWidth<=innerWidth&&!__certificatePage().querySelector('[data-event-key="ME U13::age:U11"]').nextElementSibling.hidden&&[...__certificatePage().querySelector('[data-event-key="ME U13::age:U11"]').cells].every(cell=>cell.getBoundingClientRect().right<=innerWidth)`);
 }
 await metrics(1920,1080);
 await c.evaluate(String.raw`__certificateAction('Auswahl aufheben');__certificatePage().querySelector('[data-certificate-key="ME U13::age:U11"]').click();__certificatePage().querySelector('.certificate-export-csv').click()`);
 await verify('The actual CSV for a separate valuation contains only its ranked participants',String.raw`__certificatePending.length===1&&__certificatePending[0].message.event_names.join('|')==='ME U13::age:U11'&&(await __certificateFiles.at(-1).blob.text()).includes('Juengere Siegerin')&&!(await __certificateFiles.at(-1).blob.text()).includes('Aeltere Siegerin')`);
 await c.evaluate(String.raw`__certificateReply('certificate_export_mark',null,{certificate_exports:{'ME U13::age:U11':Date.now()}});__certificateAgeControl.focus();__certificateAgeControl.click()`);
 await verify('Removing a separate valuation preserves the parent controls and removes only its child row',String.raw`!__certificatePage().querySelector('[data-certificate-key="ME U13::age:U11"]')&&document.activeElement===__certificateAgeControl&&__certificatePending.length===1&&__certificatePending[0].message.props.certificate_age_class_splits['ME U13']===undefined&&__certificatePage().querySelector('.certificate-selection-heading .certificate-export-reset').disabled&&__certificatePage().querySelector('.certificate-selection-heading .certificate-export-reset').title.includes('gespeichert')`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props');for(const id of __certificateMixedIds)crouting.on_change({ctype:'match_delete',tournament_key:'preview',val:{match__id:id}})`);
 await c.evaluate(String.raw`__certificateTrigger().click();__certificateInput('veranstaltung_1','Verlassener Entwurf');window.__certificateFinalCommandCount=__certificateCommands.length;document.querySelector('.leitstand').remove()`);
 await c.evaluate('new Promise(resolve=>setTimeout(resolve,300))');
 await verify('Removing the workspace disposes listeners and deferred unsent requests',String.raw`!__certificatePage()&&__certificateCommands.length===__certificateFinalCommandCount`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');await verify('The export workflow produces no browser exceptions',String(!exceptions.length));
 fs.writeFileSync(path.join(previews,'certificates-verification.json'),JSON.stringify({date:'2026-11-02',scope:'Isolated fixtures, simulated server replies, real CSV/XLSX blobs captured without downloads.',checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
