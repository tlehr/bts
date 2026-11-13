'use strict';
/* eslint-disable no-console -- Native shared-column geometry regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,previews}) {
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  const Native=ResizeObserver,qa=window.__pairSize={held:[],receipts:[],hold:false};
  window.ResizeObserver=class extends Native {constructor(callback){super((entries,observer)=>{
   const held=entries.filter(entry=>qa.hold&&entry.target.matches('.operator-pair>.name')&&entry.target.closest('tr')?.dataset.match_id===qa.id);
   const ready=entries.filter(entry=>!held.includes(entry));if(ready.length)callback(ready,observer);if(held.length)qa.held.push(()=>callback(held,observer));
  });}};
 })()`});
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=__pairSize,template=structuredClone(curt.matches.find(match=>match._id==='match-53'));
  qa.make=(id,number)=>{const match=structuredClone(template);match._id=id;match.team1_won=true;match.btp_winner=1;match.end_ts=Date.now()+number;match.duration_ms=600000;match.network_score=[[21,12],[21,13]];match.presses=[];
   Object.assign(match.setup,{is_match:true,state:'finished',now_on_court:false,match_num:number,tabletoperators:[{btp_id:99001,name:'Alexandra Beispielname',firstname:'Alexandra',lastname:'Beispielname'},{btp_id:99002,name:'Maximilian Testperson',firstname:'Maximilian',lastname:'Testperson'}]});
   for(const key of ['court_id','location_id','umpire','service_judge'])delete match.setup[key];return match;};
  curt.tabletoperator_enabled=true;curt.tabletoperator_split_doubles=false;curt.matches=[qa.make('pair-warm',500)];curt.courts.forEach(court=>{delete court.match_id});ctournament.ui_show();
  qa.settle=()=>new Promise((resolve,reject)=>{const deadline=performance.now()+6000;let stable=0;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Pair geometry did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.val?.match__id===qa.id)qa.receipts.push(receipt)});
  qa.connection=conn(()=>{},message=>crouting.on_change(message));qa.receive=message=>qa.connection._test_handle_message({data:JSON.stringify(message)});
 })()`);
 const samples=[];
 for(const width of [1920,1536,390]) {
  await metrics(width,width===390?844:1080);await c.evaluate('__pairSize.settle()');
  // A resized column must acquire a fresh native measurement before another
  // row can reuse it. Do not rely on the previous viewport's cached width.
  await c.evaluate(`(()=>{const qa=__pairSize;qa.hold=false;const match=qa.make('pair-native-${width}',${width+1});qa.receive({type:'change',ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}})})()`);
  await c.evaluate('__pairSize.settle();btsAdminUpdates.whenSettled()');
  await c.evaluate(`(()=>{const qa=__pairSize;qa.id='pair-new-${width}';qa.hold=true;qa.receipts=[];const match=qa.make(qa.id,${width});qa.receive({type:'change',ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}})})()`);
  let sample;
  try {
   await c.evaluate('__pairSize.settle();btsAdminUpdates.whenSettled()');
   sample=await c.evaluate('(()=>{const qa=__pairSize,node=document.querySelector(\'tr[data-match_id="\'+qa.id+\'"] .operator-pair>.name\');qa.before={text:node.textContent,width:node.getBoundingClientRect().width};return{held:qa.held.length,receipts:qa.receipts.map(receipt=>({status:receipt.status,jobs:receipt.ui_jobs})),before:qa.before}})()');
  } finally {await c.evaluate('__pairSize.hold=false;__pairSize.held.splice(0).forEach(release=>release());__pairSize.settle()');}
  const after=await c.evaluate('(()=>{const node=document.querySelector(\'tr[data-match_id="\'+__pairSize.id+\'"] .operator-pair>.name\');return{text:node.textContent,width:node.getBoundingClientRect().width}})()');
  console.log(JSON.stringify({width,...sample,after}));
  assert(sample.held>0,'The native first size really was withheld');
  assert(sample.receipts.length&&sample.receipts.every(receipt=>receipt.status==='presented'),'Known result-column geometry must fit the new pair without waiting for a redundant first observation');
  assert.strictEqual(sample.before.text,after.text,'Actual observation must retain the already fitted labels');assert(Math.abs(sample.before.width-after.width)<.25,'Reused and actual available widths must agree');
  samples.push({width,...sample,after});
 }
 await c.evaluate('__pairSize.unsubscribe()');assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Geometry reuse must not throw');
 fs.writeFileSync(path.join(previews,'finished-pair-size-verification.json'),JSON.stringify({scope:'Native browser: new paired tablet operators reuse an already observed result-column width at desktop, narrower and mobile widths. Their own first observation is withheld, then released to verify unchanged labels and geometry.',samples},null,2)+'\n');console.log(JSON.stringify({checks:samples.length*5,samples},null,2));
};
