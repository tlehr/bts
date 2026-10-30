'use strict';

const assert=require('assert'),fs=require('fs'),path=require('path');

module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  window.__demandQA={samples:[],receipts:[],blocked:[],serial:0};const qa=__demandQA;
  qa.settle=()=>new Promise((resolve,reject)=>{let clear=0;const start=performance.now();const frame=()=>{if(performance.now()-start>4000)return reject(new Error('Demand UI did not settle'));clear=cleitstand.isUpdating()||ctournament.isUpdating()?0:clear+1;if(clear===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  const match=structuredClone(curt.matches.find(match=>match._id==='match-44'));match.network_score=[[21,18],[9,7]];match.setup.needs_preparation_successor=false;match.setup.needs_preparation_successor_ts=null;
  crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
 })()`);
 await c.evaluate('__demandQA.settle()');
 await c.evaluate(`(()=>{
  const qa=__demandQA;qa.row=document.querySelector('tr[data-match_id="match-44"]');qa.score=qa.row.querySelector('.match_score');qa.name=qa.row.querySelector('.player');qa.nameText=qa.name.firstChild;qa.neighbor=document.querySelector('tr[data-match_id="match-43"]');qa.neighborClass=qa.neighbor.className;
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>qa.receipts.push(receipt));
  qa.nativeSend=window.send;window.send=(message,callback)=>{if(message.type==='preparation_selection_get'){qa.blocked.push(callback);return;}return qa.nativeSend(message,callback);};
  qa.connection=conn(()=>{},message=>{const start=performance.now();crouting.on_change(message);if(!message.__demand_check)return;const sample={id:message.__demand_check,ctype:message.ctype,handler_ms:performance.now()-start,green:qa.row.classList.contains('preparation_demand_court'),score:[...qa.score.querySelectorAll('.ls-set-score')].map(set=>set.textContent).join(' '),same:qa.row.isConnected&&qa.row.querySelector('.match_score')===qa.score&&qa.name.isConnected&&qa.name.firstChild===qa.nameText,neighbor:qa.neighbor.className===qa.neighborClass};qa.samples.push(sample);qa.resolve(sample);});
  qa.receive=(ctype,val)=>new Promise(resolve=>{qa.resolve=resolve;qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype,tournament_key:curt.key,val,__demand_check:++qa.serial})});});
  qa.point=(needed,points)=>qa.receive('score',{match_id:'match-44',network_score:[[21,18],points],presses:[],now_on_court:true,court_id:'CH_1',needs_preparation_successor:needed,needs_preparation_successor_ts:needed?12345:null});
  qa.release=courts=>{let count=0;while(qa.blocked.length){if(++count>20)throw new Error('Unexpected preparation request loop');qa.blocked.shift()(null,{selections:[{location_id:'CH',demand_court_ids:courts,diagnostics_by_match_id:{},call_on_court_diagnostics_by_match_id:{}}]});}};
 })()`);
 const checks=[],check=(name,value)=>{assert(value,name);checks.push(name);console.log('OK '+name);};
 try {
  await c.evaluate('ctournament.request_location_preparation_selections()');
  const enabled=await c.evaluate('__demandQA.point(true,[10,7])');
  check('The successor marker and point change in the same native score handler',enabled.green&&enabled.score==='21:18 10:7'&&enabled.same&&enabled.neighbor);
  const visible=await c.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const qa=__demandQA;resolve({blocked:qa.blocked.length,green:qa.row.classList.contains('preparation_demand_court'),paint:getComputedStyle(qa.row.querySelector('.call_td')).backgroundImage.includes('linear-gradient')});})))`);
  check('The green field is rendered while the separate server diagnosis is still unanswered',visible.blocked>0&&visible.green&&visible.paint);
  await c.evaluate('__demandQA.release([]);__demandQA.settle()');
  check('A delayed negative diagnosis cannot remove the current positive point flag',await c.evaluate('__demandQA.row.classList.contains("preparation_demand_court")'));
  await c.evaluate('ctournament.request_location_preparation_selections()');
  const corrected=await c.evaluate('__demandQA.point(false,[9,7])');
  check('Correcting the threshold point clears green in the same handler',!corrected.green&&corrected.score==='21:18 9:7'&&corrected.same&&corrected.neighbor);
  await c.evaluate('__demandQA.release(["CH_1"]);__demandQA.settle()');
  check('A delayed positive diagnosis cannot re-enable the corrected field',await c.evaluate('!__demandQA.row.classList.contains("preparation_demand_court")'));
  const repeated=await c.evaluate(`(async()=>{const qa=__demandQA,records=[],observer=new MutationObserver(changes=>records.push(...changes));observer.observe(qa.row,{attributes:true,subtree:true});const sample=await qa.point(false,[9,8]);observer.disconnect();return{...sample,markerWrites:records.filter(record=>record.target===qa.row&&(record.attributeName==='class'||record.attributeName==='data-preparation-demand-court')).length};})()`);
  check('A point with unchanged successor state makes no marker attribute changes',!repeated.green&&repeated.markerWrites===0&&repeated.same);
  const snapshot=await c.evaluate(`(async()=>{const qa=__demandQA,m=structuredClone(curt.matches.find(match=>match._id==='match-44'));m.setup.needs_preparation_successor=true;m.setup.needs_preparation_successor_ts=12345;return qa.receive('court_current_match',{match__id:m._id,match:m});})()`);
  check('A successor-only snapshot patches the marker without rebuilding names or scores',snapshot.green&&snapshot.same&&snapshot.score==='21:18 9:8');
  await c.evaluate('__demandQA.release(["CH_1"]);__demandQA.settle()');
  const legacy=await c.evaluate(`(async()=>{const qa=__demandQA;const sample=await qa.receive('score',{match_id:'match-44',network_score:[[21,18],[8,7]],presses:[],now_on_court:true,court_id:'CH_1'});return{...sample,omitted:!('needs_preparation_successor'in curt.matches.find(match=>match._id==='match-44').setup)};})()`);
  check('Older score messages clear stale flags and retain diagnostic compatibility',legacy.omitted&&legacy.same&&legacy.score==='21:18 8:7');
  await c.evaluate('__demandQA.release([]);__demandQA.settle()');
  await c.evaluate('btsAdminUpdates.whenSettled()');
  const receipts=await c.evaluate('__demandQA.receipts.map(({message,status,timings})=>({type:message.ctype,status,timings}))');
  check('All native messages receive successful presentation receipts after their UI work',receipts.length>=5&&receipts.every(receipt=>receipt.status==='presented'));
  const samples=await c.evaluate('__demandQA.samples'),times=samples.map(sample=>sample.handler_ms).sort((a,b)=>a-b);
  check('Point and marker handlers meet the small-update processing budget',times[Math.floor(times.length/2)]<=16&&times.at(-1)<=100);
  const report={date:'2026-10-30',scope:'Isolierter Browser mit nativer Empfangswarteschlange. Vorbereitungsdiagnosen werden bewusst zurückgehalten und mit veraltetem Bedarf beantwortet. Punktmeldungen enthalten den auf dem Server berechneten Zustand; keine Live-Dienste.',checks,samples,receipts};
  fs.writeFileSync(path.join(previews,'successor-marker-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 } catch(error) {
  console.log(JSON.stringify(await c.evaluate('({samples:__demandQA.samples,blocked:__demandQA.blocked.length})'),null,2));throw error;
 } finally {
  await c.evaluate('window.send=__demandQA.nativeSend;__demandQA.release([]);__demandQA.unsubscribe()');
 }
};
