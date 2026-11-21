'use strict';
/* eslint no-undef: off */
module.exports = async function({c,open,metrics,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const verify = (name,fn) => check(name,'(' + fn.toString() + ')()');
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error("Random results did not settle");})()');
 await open(1440,1000);
 await run(() => {
  window.__randomRequests=[];window.__randomErrors=[];window.__randomDocument=document;
  window.addEventListener('error',event => __randomErrors.push(event.message));
  const original=send;window.send=(message,callback) => {
   if(message.type==='debug_random_results'){__randomRequests.push({message:structuredClone(message),callback});return;}
   if(message.type==='service_status')return setTimeout(()=>callback(null,{services:{btp:structuredClone(curt.btp_status),ticker:structuredClone(curt.ticker_status),speech:{enabled:true},speech_health:{state:'ok',issues:[]}}}),0);
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   return original(message,callback);
  };
  window.__randomField=name => document.querySelector('.settings-random-results [name=random_results_'+name+']');
  window.__randomSet=(name,value) => {const input=__randomField(name);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
  window.__randomReply=(error,response) => __randomRequests.shift().callback(error,response);
  window.__randomPlan={token:'preview-token',count:2,skipped:3,waiting:1,matches:[{number:41,event:'U15 <script>',teams:'Alex / Kim – Robin / Sam',waiting:false},{number:42,event:'U15',teams:'',waiting:true}]};
  window.__randomProps=values => change.default_handler(() => {})({ctype:'props',val:values});
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(() => !!document.querySelector('.settings-area-link[href$="/edit/debug"]'));
 await run(() => document.querySelector('.settings-area-link[href$="/edit/debug"]').click());
 await verify('Random results are under Debug only and make no request when opened',()=>
  !!document.querySelector('.settings-debug .settings-random-results') && !document.querySelector('.settings-maintenance .settings-random-results') && __randomRequests.length===0);
 await verify('Disconnected BTP is explained and blocks preview',()=>__randomField('preview').disabled && document.querySelector('.settings-random-connection').textContent.includes('ausgeschaltet'));
 await run(()=>{__randomProps({btp_enabled:true,btp_readonly:true});ctournament.btp_status_changed({val:{status:'connected'}});});
 await verify('Read-only BTP blocks writing',()=>__randomField('preview').disabled && document.querySelector('.settings-random-connection').textContent.includes('Nur-Lesen'));
 await run(()=>{__randomProps({btp_readonly:false});__randomField('preview').click();});
 await verify('An empty match number is rejected without a server request',()=>__randomRequests.length===0 && document.querySelector('.settings-random-status').dataset.state==='error');
 await run(()=>{__randomSet('number','42');__randomField('preview').click();});
 await verify('Preview sends the inclusive cutoff without writing and locks controls while loading',()=>
  __randomRequests.length===1 && __randomRequests[0].message.action==='preview' && __randomRequests[0].message.limit.number===42 && __randomRequests[0].message.tournament_key==='preview' && __randomField('number').disabled);
 await run(()=>__randomReply(null,__randomPlan));
 await verify('Preview reports counts and unresolved rounds using text, with an explicit BTS/BTP action',()=>
  document.querySelector('.settings-random-summary').textContent.includes('2 Spiele') && document.querySelector('.settings-random-summary').textContent.includes('3 Spiele') &&
  document.querySelectorAll('.settings-random-list li').length===2 && !document.querySelector('.settings-random-list script') &&
  document.querySelector('.settings-random-list').textContent.includes('Teilnehmer noch offen') && !__randomField('apply').disabled);
 await run(()=>__randomField('apply').click());await wait(()=>!!document.querySelector('.bts-confirm-dialog'));
 await verify('Confirmation explains the effects on BTP and subsequent rounds before writing',()=>
  __randomRequests.length===0 && document.querySelector('.bts-confirm-dialog').textContent.includes('BTS und BTP') &&
  document.querySelector('.bts-confirm-dialog').textContent.includes('Platzierungen'));
 await run(()=>document.querySelector('.bts-confirm-cancel').click());await wait(()=>!document.querySelector('.bts-confirm-dialog'));
 await verify('Cancel leaves the preview usable without a mutation',()=>__randomRequests.length===0 && !__randomField('apply').disabled);
 await run(()=>__randomSet('number','43'));
 await verify('Editing the cutoff invalidates the old preview',()=>document.querySelector('.settings-random-selection').hidden && __randomField('apply').disabled);
 await run(()=>{__randomSet('mode','time');__randomSet('time','2026-11-21T12:30');__randomField('preview').click();});
 await verify('The time cutoff includes its date and is sent in the schedule timezone without conversion',()=>
  __randomField('number').closest('.settings-row').hidden && !__randomField('time').closest('.settings-row').hidden &&
  __randomRequests[0].message.limit.time==='2026-11-21T12:30');
 await run(()=>{__randomReply(null,__randomPlan);__randomField('apply').click();});await wait(()=>!!document.querySelector('.bts-confirm-dialog'));
 await run(()=>{ctournament.btp_status_changed({val:{status:'error'}});document.querySelector('.bts-confirm-accept').click();});
 await wait(()=>!document.querySelector('.bts-confirm-dialog'));
 await verify('A disconnect during confirmation prevents execution',()=>__randomRequests.length===0 && document.querySelector('.settings-random-status').textContent.includes('nicht gestartet'));
 await run(()=>{ctournament.btp_status_changed({val:{status:'connected'}});__randomField('apply').click();});await wait(()=>!!document.querySelector('.bts-confirm-dialog'));
 await run(()=>document.querySelector('.bts-confirm-accept').click());await wait(()=>__randomRequests.length===1);
 await verify('Execution uses only the reviewed token and prevents duplicate actions',()=>
  __randomRequests[0].message.action==='execute' && __randomRequests[0].message.token==='preview-token' &&
  !__randomRequests[0].message.limit && __randomField('apply').disabled && __randomField('preview').disabled);
 await run(()=>__randomReply(null,{changed:1,skipped:1}));
 await verify('Completion reports confirmed results and skips, and consumes the preview',()=>
  document.querySelector('.settings-random-selection').hidden && document.querySelector('.settings-random-status').textContent.includes('1 Zufallsergebnisse in BTS und BTP') &&
  document.querySelector('.settings-random-status').textContent.includes('1 ausgewählte Spiele übersprungen') && !__randomField('preview').disabled);
 await run(()=>{__randomField('preview').click();__randomReply(null,__randomPlan);__randomField('apply').click();});await wait(()=>!!document.querySelector('.bts-confirm-dialog'));
 await run(()=>document.querySelector('.bts-confirm-accept').click());await wait(()=>__randomRequests.length===1);
 await run(()=>__randomReply({message:'Zufallslauf abgebrochen. 1 Ergebnisse in BTP bestätigt.'}));
 await verify('A partial failure is visible and requires a fresh preview',()=>
  document.querySelector('.settings-random-status').dataset.state==='error' && document.querySelector('.settings-random-status').textContent.includes('1 Ergebnisse in BTP bestätigt') && __randomField('apply').disabled);
 await run(()=>{__randomField('preview').click();__randomReply(null,__randomPlan);__randomField('apply').click();});await wait(()=>!!document.querySelector('.bts-confirm-dialog'));
 await run(()=>document.querySelector('.settings-area-link[href$="/edit/maintenance"]').click());await wait(()=>!document.querySelector('.bts-confirm-dialog'));
 await verify('Changing sections dismisses confirmation without running the test',()=>__randomRequests.length===0 && document===__randomDocument);
 await run(()=>document.querySelector('.settings-area-link[href$="/edit/debug"]').click());
 for(const [width,height] of [[1440,1000],[390,844],[320,568]]) {
  await metrics(width,height);
  await verify('Random-result inputs and preview fit at '+width+' px',()=>document.documentElement.scrollWidth<=innerWidth+1 &&
   [...document.querySelectorAll('.settings-random-results input,.settings-random-results select,.settings-random-results button')].every(node=>{
    const rect=node.getBoundingClientRect();return !rect.height || rect.left>=0 && rect.right<=innerWidth+1;
   }));
  if(width!==320) {
   await run(()=>document.querySelector('.settings-random-results').scrollIntoView({block:'start'}));
   await capture('einstellungen-zufallsergebnisse-'+width,false,{preserveScroll:true});
  }
 }
 await verify('No browser exception occurred',()=>__randomErrors.length===0);
};
