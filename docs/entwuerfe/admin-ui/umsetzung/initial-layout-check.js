'use strict';
/* eslint-disable no-console -- Isolated startup concurrency regressions. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,previews}) {
 const checks=[],check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('OK '+name);};
 const instrument=require('./startup-check').instrumentation;
 await open(1366,900,{startup:true,beforeFixture:()=>c.evaluate(`(${instrument.toString()})();(()=>{
  const qa=window.__initial={pending:new Map(),receipts:[],nativeSet:window.setTimeout.bind(window),nativeClear:window.clearTimeout.bind(window)};
  window.setTimeout=(callback,delay,...args)=>{if(callback.name!=='fillNextSection')return qa.nativeSet(callback,delay,...args);const id=qa.nativeSet(()=>{},60000);qa.pending.set(id,()=>callback(...args));return id;};
  window.clearTimeout=id=>{qa.pending.delete(id);qa.nativeClear(id);};
  qa.release=()=>{for(const [id,callback]of qa.pending){qa.pending.delete(id);qa.nativeClear(id);callback();return;}};
  qa.wait=test=>new Promise((resolve,reject)=>{const deadline=performance.now()+6000;const frame=()=>{if(test())return resolve();if(performance.now()>deadline)return reject(new Error('Initial phase did not reach expected state'));requestAnimationFrame(frame);};frame();});
  qa.connection=conn(()=>{},message=>crouting.on_change(message));
  qa.receive=(ctype,val)=>qa.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:curt.key,ctype,val})});
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>qa.receipts.push(receipt));
 })()`),transformFixture:source=>source.replace('tournament:structuredClone(fixture)','tournament:__startup.make(fixture)')});
 await c.evaluate('__initial.wait(()=>__initial.pending.size>0)');
 const visible=await c.evaluate(`(()=>{
  const qa=__initial,container=document.querySelector('.unassigned_container');qa.row=container.querySelector('.ls-match');qa.control=qa.row.querySelector('.ls-match-open');qa.control.focus({preventScroll:true});
  return{mark:performance.getEntriesByName('bts-board-visible').length,main:getComputedStyle(document.querySelector('.main')).display,partial:container.querySelectorAll('[data-ls-startup-deferred]').length,last:container.getBoundingClientRect().bottom,busy:cleitstand.isUpdating(),readyRows:container.querySelectorAll('.ls-match').length};
 })()`);
 check('The visible viewport paints while distant rows remain explicitly pending',visible.mark===1&&visible.main!=='none'&&visible.partial>0&&visible.busy&&visible.readyRows>0&&visible.last>=900);
 const reference=await c.evaluate('('+require('./name-measurement-batch-check').nativeReference.toString()+')()');
 check('Initial names and stacking already match independent native geometry',reference.length>5&&reference.every(item=>item.stacked===item.shouldStack&&JSON.stringify(item.actual)===JSON.stringify(item.expected)));
 const early=await c.evaluate(`(async()=>{
  const qa=__initial,partial=document.querySelector('[data-ls-startup-deferred]');qa.changed=partial.dataset.match_id;
  const edit=structuredClone(curt.matches.find(match=>match._id===qa.changed));Object.assign(edit.setup.teams[0].players[0],{name:'Johanna Anfangsphase',firstname:'Johanna',lastname:'Anfangsphase'});
  qa.receive('match_edit',{match__id:edit._id,match:edit});
  const finished=structuredClone(curt.matches.find(match=>match.setup.state==='finished'));qa.finished=finished._id;Object.assign(finished.setup.teams[0].players[0],{name:'Frieda Hintergrund',firstname:'Frieda',lastname:'Hintergrund'});qa.receive('match_edit',{match__id:finished._id,match:finished});
  const added=structuredClone(edit);added._id='initial-new-match';added.setup.match_num=9999;qa.receive('match_edit',{match__id:added._id,match:added});
  const point=curt.matches.find(match=>match.setup.now_on_court);qa.point=point._id;
  qa.receive('score',{match_id:point._id,network_score:[[9,8]],presses:[],court_id:point.setup.court_id,now_on_court:true});
  await qa.wait(()=>qa.receipts.some(receipt=>receipt.message.ctype==='score'));
  const finish=curt.matches.find(match=>match.setup.now_on_court&&match._id!==qa.point);qa.finish=finish._id;qa.receive('score',{match_id:finish._id,network_score:[[21,15],[21,17]],presses:[],team1_won:true,court_id:finish.setup.court_id,now_on_court:false,end_ts:Math.max(...curt.matches.map(match=>Number(match.end_ts)||0))+60000});
  return{pending:qa.pending.size,receipts:qa.receipts.map(receipt=>({type:receipt.message.ctype,status:receipt.status,jobs:receipt.ui_jobs.map(job=>job.name)})),score:document.querySelector('.courts_container tr[data-match_id="'+point._id+'"] .match_score').textContent};
 })()`);
 check('A court point remains independent of pending startup lists',early.pending>0&&early.receipts.length===1&&early.receipts[0].status==='presented'&&!early.receipts[0].jobs.includes('board.initial-lists')&&early.score==='9:8');
 await c.evaluate('(async()=>{const qa=__initial;for(let n=0;n<10&&cleitstand.isUpdating();n++){await qa.wait(()=>qa.pending.size>0||!cleitstand.isUpdating());qa.release();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}await __startup.ready;await btsAdminUpdates.whenSettled();})()');
 const filled=await c.evaluate(`(()=>{
  const qa=__initial,ids=[...document.querySelectorAll('.ls-match')].map(row=>row.dataset.match_id);
  return{receipts:qa.receipts.map(receipt=>({type:receipt.message.ctype,status:receipt.status,jobs:receipt.ui_jobs.map(job=>job.name)})),pending:btsAdminUpdates.stats().pending,finishedEarly:!!document.querySelector('.finished_container tr[data-match_id="'+qa.finish+'"]')&&!document.querySelector('.courts_container tr[data-match_id="'+qa.finish+'"]'),partial:document.querySelectorAll('[data-ls-startup-deferred]').length,retained:qa.row.isConnected&&qa.row.querySelector('.ls-match-open')===qa.control&&document.activeElement===qa.control,changed:document.querySelector('tr[data-match_id="'+qa.changed+'"] [data-ls-full-name]').dataset.lsFullName,finished:document.querySelector('tr[data-match_id="'+qa.finished+'"] [data-ls-full-name]').dataset.lsFullName,added:ids.filter(id=>id==='initial-new-match').length,unique:new Set(ids).size===ids.length,models:curt.matches.length,rows:ids.length};
 })()`);
 check('Early edits and an added game appear once with current model values',filled.changed==='Johanna Anfangsphase'&&filled.finished==='Frieda Hintergrund'&&filled.added===1&&filled.unique&&filled.models===513&&filled.rows===513);
 check('Every list update waits for its completed initial rendering',filled.receipts.length===5&&filled.receipts.every(receipt=>receipt.status==='presented')&&filled.receipts.filter(receipt=>receipt.type==='match_edit').every(receipt=>receipt.jobs.includes('board.initial-lists'))&&filled.pending===0&&filled.partial===0);
 check('A game completed during startup moves from its court into the results',filled.finishedEarly);
 check('Filling distant rows retains the visible row, control and keyboard focus',filled.retained);
 // The second mount exercises cancellation before either distant list is built.
 await c.evaluate('(async()=>{ctournament.ui_show();await __initial.wait(()=>__initial.pending.size>0);__initial.oldRoot=document.querySelector(\'.leitstand\');cleitstand.unmount();document.querySelector(\'.main\').replaceChildren();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()');
 check('Leaving the board cancels all delayed rendering without recreating it',await c.evaluate('__initial.pending.size===0&&!document.querySelector(".leitstand")&&!cleitstand.isUpdating()'));
 // A hidden hall cannot consume the initial visible-row budget; a larger
 // viewport must also be completely filled before its first ready marker.
 await c.evaluate('localStorage.setItem(\'show_location_courts_CH\',\'false\');window.setTimeout=__initial.nativeSet;window.clearTimeout=__initial.nativeClear;');
 await metrics(1920,1400);await c.evaluate('ctournament.ui_show();__startup.settle()');
 check('Larger viewports and hidden halls complete without partial rows',await c.evaluate('!document.querySelector("[data-ls-startup-deferred]")&&document.querySelectorAll(".ls-match").length===513&&!cleitstand.isUpdating()'));
 check('No uncaught browser exceptions',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
 await c.evaluate('__initial.unsubscribe();localStorage.removeItem("show_location_courts_CH")');
 const report={scope:'Isolated synthetic startup, 512 games. Background tasks held deliberately; all writes simulated.',checks,visible,reference,early,filled};fs.writeFileSync(path.join(previews,'initial-layout-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
};
