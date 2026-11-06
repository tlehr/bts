'use strict';
/* eslint-disable no-console -- Isolated browser performance check. */
const fs=require('fs'),path=require('path'),assert=require('assert');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53')),now=Date.now();
  curt.courts=Array.from({length:15},(_,i)=>({_id:'C'+i,num:String(i+1),location_id:i<13?'CH':'SN',is_active:true,match_id:'completion-'+i}));
  curt.matches=Array.from({length:512},(_,i)=>{
   const match=structuredClone(template);match._id='completion-'+i;
   Object.assign(match.setup,{match_num:i+1,state:'scheduled',now_on_court:false,highlight:0,scheduled_date:'2026-11-06',scheduled_time_str:'12:00'});
   for(const key of ['court_id','location_id','preparation_call_timestamp','umpire','service_judge','tabletoperators'])delete match.setup[key];
   match.setup.teams.forEach((team,j)=>team.players.forEach((player,k)=>{player.btp_id=20000+i*10+j*2+k;player.name='Alexandra-Johanna Testperson '+player.btp_id;player.firstname='Alexandra-Johanna';player.lastname='Testperson '+player.btp_id;delete player.last_time_on_court_ts;if(i>=407)player.last_time_on_court_ts=now-30000;}));
   if(i<15){Object.assign(match.setup,{state:'oncourt',now_on_court:true,court_id:'C'+i,location_id:i<13?'CH':'SN'});match.network_score=[[5,5]];}
   else if(i<407){match.setup.state='finished';match.team1_won=true;match.btp_winner=1;match.network_score=[[21,15],[21,17]];match.end_ts=now-i*60000;}
   if(i%8===0)match.setup.umpire={btp_id:99001,name:'Alexander Maximilian Keo Boun Khoune',firstname:'Alexander Maximilian',surname:'Keo Boun Khoune',checked_in:true};
   return match;
  });
  curt.matches=JSON.parse(JSON.stringify(curt.matches));ctournament.ui_show();
  const connection=conn(()=>{},message=>{const result=crouting.on_change(message);if(message.__completion?.endsWith('point'))requestAnimationFrame(()=>requestAnimationFrame(()=>__completion.frames.push({marker:message.__completion,score:document.querySelector('tr[data-match_id="completion-1"] .match_score').textContent})));return result;});
  window.__completion={connection,frames:[],receive:(ctype,val,marker)=>connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:curt.key,ctype,val,__completion:marker})})};
  __completion.settle=()=>new Promise((resolve,reject)=>{let stable=0;const deadline=performance.now()+15000;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Completion layout did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()||connection._test_change_queue_length()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  __completion.run=async(round,burst)=>{
   const original=structuredClone(curt.matches.find(match=>match._id==='completion-'+(round+2))),receipts=[],rows=new Map([...document.querySelectorAll('tr[data-match_id]')].map(row=>[row.dataset.match_id,row]));
   const unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__completion)receipts.push(receipt);});
   try{
    __completion.receive('score',{match_id:original._id,network_score:[[21,15],[21,17]],presses:[],team1_won:true,court_id:original.setup.court_id,now_on_court:false,end_ts:Date.now()},round+'-finish');
    for(let i=0;i<burst;i++){
     const match=structuredClone(curt.matches.find(match=>match._id==='completion-'+(407+i)));
     match.setup.teams[0].players[0].last_time_on_court_ts=Date.now()-30000-round*1000;
     match.setup.teams[0].players[0].checked_in=round%2===0;
     __completion.receive('match_edit',{match__id:match._id,match},round+'-edit-'+i);
    }
    __completion.receive('score',{match_id:'completion-1',network_score:[[10+round,8]],presses:[],court_id:'C1',now_on_court:true},round+'-point');
    await __completion.settle();await btsAdminUpdates.whenSettled();
    const finishedRow=document.querySelector('.finished_container tr[data-match_id="'+original._id+'"]');
    const finished=!!finishedRow&&!finishedRow.hidden&&!finishedRow.classList.contains('ls-history-overflow')&&!finishedRow.classList.contains('ls-date-collapsed')&&!document.querySelector('.courts_container tr[data-match_id="'+original._id+'"]');
    const retained=[...rows].every(([id,row])=>id===original._id||document.querySelector('tr[data-match_id="'+id+'"]')===row);
    __completion.receive('match_edit',{match__id:original._id,match:original},round+'-reopen');
    await __completion.settle();await btsAdminUpdates.whenSettled();
    const reopened=!!document.querySelector('.courts_container tr[data-match_id="'+original._id+'"]')&&!document.querySelector('.finished_container tr[data-match_id="'+original._id+'"]');
    return{round,burst,finished,reopened,retained,receipts:receipts.map(receipt=>({marker:receipt.message.__completion,status:receipt.status,timings:receipt.timings,jobs:receipt.ui_jobs}))};
   }finally{unsubscribe();}
  };
 })()`);
 await c.evaluate('__completion.settle()');
 const tracing=process.env.BTS_COMPLETION_TRACE==='1';
 await c.call('Performance.enable');
 const start=c.events.length;
 if(tracing){await c.call('Profiler.enable');await c.call('Profiler.setSamplingInterval',{interval:1000});await c.call('Profiler.start');await c.call('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});}
 const phases=[];
 for(let round=0;round<10;round++){
  const before=(await c.call('Performance.getMetrics')).metrics,phase=await c.evaluate(`__completion.run(${round},${round%2?16:0})`),after=(await c.call('Performance.getMetrics')).metrics;
  phase.cpu_ms=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,1000*(after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value)]));phases.push(phase);
 }
 const prefix=process.env.BTS_COMPLETION_PREFIX||'completion';
 if(tracing){
  await c.call('Tracing.end');
  for(let n=0;!c.events.slice(start).some(event=>event.method==='Tracing.tracingComplete');n++){assert(n<100);await new Promise(resolve=>setTimeout(resolve,20));}
  fs.writeFileSync(path.join(previews,prefix+'-trace.json'),JSON.stringify(c.events.slice(start).filter(event=>event.method==='Tracing.dataCollected').flatMap(event=>event.params.value)));
  const profile=await c.call('Profiler.stop');fs.writeFileSync(path.join(previews,prefix+'-profile.json'),JSON.stringify(profile.profile));
 }
 const stats=values=>{const sorted=values.sort((a,b)=>a-b);return{count:sorted.length,mean_ms:values.reduce((a,b)=>a+b,0)/values.length,p50_ms:sorted[Math.floor(sorted.length*.5)],p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_ms:sorted.at(-1)};};
 const summary={cpu:stats(phases.map(phase=>phase.cpu_ms.TaskDuration)),...Object.fromEntries(['finish','point','reopen'].map(kind=>[kind,stats(phases.flatMap(phase=>phase.receipts.filter(receipt=>receipt.marker.endsWith('-'+kind)).map(receipt=>receipt.timings.total_ms)))]))};
 const frames=await c.evaluate('__completion.frames');
 const report={tracing,scope:'Isolated browser: 512 matches, 392 finished, 15 courts, 64 officials. Ten finishes and reopens, alternating with 16 concurrent upcoming match edits, plus an unrelated point. No live writes; optional profiler and timeline enabled only with BTS_COMPLETION_TRACE=1.',summary,phases,frames};
 fs.writeFileSync(path.join(previews,prefix+'-verification.json'),JSON.stringify(report,null,2)+'\n');
 assert(phases.every(phase=>phase.finished&&phase.reopened&&phase.retained),'Finish, reopen and unrelated row identity must remain correct');
 assert(phases.every(phase=>phase.receipts.length===phase.burst+3&&phase.receipts.every(receipt=>receipt.status==='presented')),'Every finish, edit, reopen and point must receive a presentation receipt');
 assert(frames.length===10&&frames.every((frame,index)=>frame.score===(10+index)+':8'),'Two independent render frames must see every unrelated point');
 assert.strictEqual(await c.evaluate('btsAdminUpdates.stats().pending'),0,'No unfinished receipts');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
 console.log(JSON.stringify({summary,checks:5},null,2));
};
