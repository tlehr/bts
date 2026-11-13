'use strict';
/* eslint-disable no-console -- Isolated browser regression check. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}){
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=structuredClone(curt.matches.find(m=>m._id==='match-53')),now=Date.now();
  curt.matches=curt.matches.filter(m=>m.setup.state!=='finished').concat(Array.from({length:120},(_,i)=>{
   const m=structuredClone(template);m._id='header-history-'+i;m.setup.match_num=1000+i;
   Object.assign(m.setup,{state:'finished',now_on_court:false,highlight:0,scheduled_date:new Date().toISOString().slice(0,10),scheduled_time_str:'09:00'});
   m.network_score=[[21,10],[21,12]];m.team1_won=true;m.btp_winner=1;m.end_ts=now-1000-i*1000;m.duration_ms=1000;
   return m;
  }));ctournament.ui_show();
  window.__headerQA={receipts:[]};
  __headerQA.settle=()=>new Promise((resolve,reject)=>{let stable=0;const end=performance.now()+7000;function frame(){if(performance.now()>end)return reject(Error('Header UI did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};frame()});
 })();__headerQA.settle()`);
 await c.evaluate('__headerQA.header=document.querySelector(\'.finished_container .ls-date-row\');__headerQA.button=__headerQA.header.querySelector(\'button\');__headerQA.day=__headerQA.header.dataset.date;__headerQA.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__headerQA)__headerQA.receipts.push(receipt)});__headerQA.connection=conn(()=>{},crouting.on_change);');
 const samples=[];
 for(let i=0;i<3;i++){
  const r=await c.evaluate(`(async()=>{
   const qa=__headerQA,match=curt.matches.find(m=>m.setup.now_on_court),id=${i+1};
   qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'score',tournament_key:curt.key,__headerQA:id,val:{match_id:match._id,court_id:match.setup.court_id,network_score:[[21,9],[21,12]],state:'finished',now_on_court:false,team1_won:true,btp_winner:1,end_ts:Date.now(),duration_ms:1000,presses:[]}})});
   await qa.settle();await btsAdminUpdates.whenSettled();
   const current=document.querySelector('.finished_container .ls-date-row');
   return{headerRetained:current===qa.header,buttonRetained:current.querySelector('button')===qa.button,day:current.dataset.date,expectedDay:qa.day,receipts:qa.receipts.length,status:qa.receipts.at(-1)?.status,jobs:qa.receipts.at(-1)?.ui_jobs,firstResult:current.nextElementSibling.dataset.match_id,expectedFirst:match._id};
  })()`);
  samples.push(r);assert(r.headerRetained&&r.buttonRetained,'A new first result on the same day retains its date header and control');
  assert.strictEqual(r.day,r.expectedDay);assert.strictEqual(r.status,'presented');assert.strictEqual(r.firstResult,r.expectedFirst);assert(r.jobs.some(j=>j.name==='finished.sort'&&j.status==='complete'));
 }
 await c.evaluate('__headerQA.unsubscribe()');assert(!c.events.some(e=>e.method==='Runtime.exceptionThrown'));
 fs.writeFileSync(path.join(previews,'date-header-retention-verification.json'),JSON.stringify({samples},null,2));console.log(JSON.stringify({samples}));
};
