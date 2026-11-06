'use strict';
/* eslint-disable no-console -- Isolated browser verification CLI. */
const assert=require('assert'),fs=require('fs'),path=require('path');

module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53')),now=Date.now();
  curt.courts=Array.from({length:15},(_,i)=>({_id:'C'+i,num:String(i+1),location_id:i<13?'CH':'SN',is_active:true,match_id:'planned-burst-'+i}));
  curt.matches=Array.from({length:512},(_,i)=>{
   const match=structuredClone(template);match._id='planned-burst-'+i;
   Object.assign(match.setup,{match_num:i+1,state:'scheduled',now_on_court:false,highlight:0,scheduled_date:'2026-11-06',scheduled_time_str:'12:00'});
   for(const key of ['court_id','location_id','preparation_call_timestamp','umpire','service_judge','tabletoperators'])delete match.setup[key];
   match.setup.teams.forEach((team,j)=>team.players.forEach((player,k)=>{player.btp_id=20000+i*10+j*2+k;player.name='Alexandra-Johanna Testperson '+player.btp_id;player.firstname='Alexandra-Johanna';player.lastname='Testperson '+player.btp_id;delete player.last_time_on_court_ts;}));
   if(i<15){Object.assign(match.setup,{state:'oncourt',now_on_court:true,court_id:'C'+i,location_id:i<13?'CH':'SN'});match.network_score=[[5,5]];}
   else if(i<382){match.setup.state='finished';match.team1_won=true;match.btp_winner=1;match.network_score=[[21,15],[21,17]];match.end_ts=now-i*60000;}
   if(i%8===0)match.setup.umpire={btp_id:99001,name:'Alexander Maximilian Keo Boun Khoune',firstname:'Alexander Maximilian',surname:'Keo Boun Khoune',checked_in:true};
   return match;
  });
  curt.matches=JSON.parse(JSON.stringify(curt.matches));ctournament.ui_show();
  const connection=conn(()=>{},message=>{const value=crouting.on_change(message);if(message.__plannedBurst?.endsWith('-point')){const sent=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{__plannedBurst.pointFrame={elapsed_ms:performance.now()-sent,score:document.querySelector('tr[data-match_id="planned-burst-0"] .match_score').textContent}}));}return value;});
  window.__plannedBurst={connection,queries:{},receive:(ctype,val,marker)=>connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:curt.key,ctype,val,__plannedBurst:marker})})};
  const selectAll=Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll=function(selector){if(this.classList.contains('unassigned_container')&&['tbody > tr[data-match_id]','.manual_btp_stage_status_warning'].includes(selector))__plannedBurst.queries[selector]=(__plannedBurst.queries[selector]||0)+1;return selectAll.call(this,selector)};
  __plannedBurst.settle=()=>new Promise((resolve,reject)=>{const deadline=performance.now()+15000;let stable=0;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Planned burst did not settle'));stable=connection._test_change_queue_length()||cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame)});
  __plannedBurst.run=round=>new Promise((resolve,reject)=>{
   const receipts=[],start=performance.now(),queries={...__plannedBurst.queries},rows=new Map([...document.querySelectorAll('tr[data-match_id]')].map(row=>[row.dataset.match_id,row]));
   __plannedBurst.pointFrame=null;
   const timeout=setTimeout(()=>{unsubscribe();reject(new Error('Missing planned receipts: '+receipts.length));},20000);
   const unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(!receipt.message.__plannedBurst)return;receipts.push(receipt);if(receipts.length!==81)return;unsubscribe();clearTimeout(timeout);__plannedBurst.settle().then(()=>{
    const upcoming=[...document.querySelectorAll('.unassigned_container tr[data-match_id]')],expected=curt.matches.filter(match=>cmatch.calc_section(match)==='unassigned').sort(cmatch.cmp_match_order);
    resolve({round,elapsed_ms:performance.now()-start,queries:Object.fromEntries(Object.entries(__plannedBurst.queries).map(([key,value])=>[key,value-(queries[key]||0)])),rows_retained:upcoming.every(row=>rows.get(row.dataset.match_id)===row),sorted:JSON.stringify(upcoming.map(row=>row.dataset.match_id))===JSON.stringify(expected.map(match=>match._id)),planned_count:upcoming.length,pointFrame:__plannedBurst.pointFrame,receipts:receipts.map(receipt=>({type:receipt.message.ctype,status:receipt.status,timings:receipt.timings,jobs:receipt.ui_jobs}))});
   },reject)});
   for(let i=0;i<80;i++){
    const match=structuredClone(curt.matches.find(match=>match._id==='planned-burst-'+(382+i)));
    match.setup.teams[0].players[0].last_time_on_court_ts=Date.now()-60000-round*1000;
    match.setup.teams[0].players[0].checked_in=round%2===0;
    match.setup.preparation_call_deferred=round%2===0;
    __plannedBurst.receive('match_edit',{match__id:match._id,match},round+'-'+i);
   }
   __plannedBurst.receive('score',{match_id:'planned-burst-0',network_score:[[10+round,8]],presses:[],court_id:'C0',now_on_court:true},round+'-point');
  });
 })()`);
 await c.evaluate('__plannedBurst.settle()');
 await c.call('Performance.enable');await c.call('Profiler.enable');await c.call('Profiler.setSamplingInterval',{interval:1000});await c.call('Profiler.start');
 const phases=[];
 for(let round=0;round<3;round++) {
  const before=(await c.call('Performance.getMetrics')).metrics,phase=await c.evaluate(`__plannedBurst.run(${round})`),after=(await c.call('Performance.getMetrics')).metrics;
  phase.cpu_ms=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,1000*(after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value)]));phases.push(phase);
 }
 const profile=await c.call('Profiler.stop');
 if(process.env.BTS_PLANNED_PROFILE)fs.writeFileSync(process.env.BTS_PLANNED_PROFILE,JSON.stringify(profile.profile));
 const regressions=await c.evaluate(`(async()=>{
  const edit=async(id,change)=>{const match=structuredClone(curt.matches.find(match=>match._id===id));change(match);__plannedBurst.receive('match_edit',{match__id:id,match});await __plannedBurst.settle();return match};
  const id='planned-burst-460',selector='tr[data-match_id="'+id+'"]';
  const row=document.querySelector(selector),player=row.querySelector('.player'),button=row.querySelector('.no_umpire');
  const changed=await edit(id,match=>{match.setup.scheduled_time_str='09:00';match.setup.match_num=999;match.setup.teams[0].players[0].checked_in=true;match.setup.preparation_call_deferred=false;});
  const sorted=document.querySelector('.unassigned_container tr[data-match_id]')===row,checked=player.classList.contains('checked_in'),nodes=row.querySelector('.player')===player&&row.querySelector('.no_umpire')===button;
  const calls=!!row.querySelector('.match_preparation_call_button');
  const writes=__writes.length;player.click();const checkOut=__writes.slice(writes).some(message=>message.type==='match_player_check_in'&&String(message.player_id)===String(changed.setup.teams[0].players[0].btp_id));
  await edit(id,match=>{match.setup.scheduled_date='2026-11-07';});
  const date=row.classList.contains('ls-date-collapsed')&&!!document.querySelector('.unassigned_container .ls-date-row[data-date="2026-11-07"]');
  await edit(id,match=>{match.setup.teams[0].players=[];});
  const incomplete=!row.draggable&&!row.querySelector('.match_preparation_call_button');
  cmatch.refresh_unassigned_preparation_context();cleitstand.refreshFinished();ctournament.ui_show();await __plannedBurst.settle();
  const remounted=!cleitstand.isUpdating()&&!ctournament.isUpdating(),timeouts=window.setTimeout,errors=[];let siblingRan=false;
  // Handle only the deliberately injected error; unexpected errors still fail.
  window.setTimeout=(callback,ms,...args)=>timeouts(()=>{try{callback(...args)}catch(error){if(error.message==='planned-refresh-probe')errors.push(error);else throw error}},ms);
  try{
   cleitstand.deferUpdate('qa.failed-list',()=>{throw new Error('planned-refresh-probe')});
   cleitstand.deferUpdate('qa.independent-list',()=>{siblingRan=true});
   await __plannedBurst.settle();await new Promise(resolve=>timeouts(resolve,0));
  }finally{window.setTimeout=timeouts;}
  return{sorted,checked,nodes,calls,checkOut,date,incomplete,remounted,failureIsolated:siblingRan&&errors.length===1};
 })()`);
 const values=phases.flatMap(phase=>phase.receipts.map(receipt=>receipt.timings.total_ms)).sort((a,b)=>a-b);
 const report={date:new Date().toISOString(),scope:'Isolierter Browser, 512 Spiele (367 beendet), 15 Felder, 64 Offiziellenzuordnungen. Pro Durchlauf 80 strukturelle Änderungen kommender Spiele und ein Punkt über die echte Empfangswarteschlange; keine Live-Dienste.',phases,regressions,summary:{point_max_ms:Math.max(...phases.flatMap(phase=>phase.receipts.filter(receipt=>receipt.type==='score').map(receipt=>receipt.timings.total_ms))),all_updates_p95_ms:values[Math.ceil(values.length*.95)-1],all_updates_max_ms:values.at(-1),cpu_mean_ms:phases.reduce((sum,phase)=>sum+phase.cpu_ms.TaskDuration,0)/phases.length}};
 fs.writeFileSync(path.join(previews,process.env.BTS_PLANNED_REPORT||'planned-burst-verification.json'),JSON.stringify(report,null,2)+'\n');
 assert(phases.every(phase=>phase.rows_retained&&phase.sorted&&phase.planned_count===130),'Upcoming rows and their scheduled order must survive the burst');
 assert(phases.every(phase=>phase.receipts.length===81&&phase.receipts.every(receipt=>receipt.status==='presented')),'Every structural update and point must be presented');
 assert(phases.every(phase=>phase.pointFrame?.score===(10+phase.round)+':8'),'An independent render-frame check must see the point');
 assert(Object.values(regressions).every(Boolean),'Order, dates, check-in, buttons, incomplete games and remounting must remain correct');
 assert.strictEqual(await c.evaluate('btsAdminUpdates.stats().pending'),0,'All presentation jobs must settle');
 assert(phases.every(phase=>(phase.queries['tbody > tr[data-match_id]']||0)<=3),'A burst must refresh the complete preparation controls at most three times, including diagnostics responses');
 assert(phases.every(phase=>(phase.queries['.manual_btp_stage_status_warning']||0)<=2),'A burst must share the registration warning refresh');
 assert(report.summary.point_max_ms<250,'The unrelated point must be presented within 250 ms');
 assert(report.summary.all_updates_max_ms<3000,'All 80 structural updates must settle within three seconds');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Planned bursts must not throw browser exceptions');
 console.log(JSON.stringify({summary:report.summary,regressions},null,2));
};
