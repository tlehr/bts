'use strict';
/* eslint-disable no-console -- Browser verification CLI. */

const assert=require('assert'),fs=require('fs'),path=require('path');

module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53')),now=Date.now();
  curt.courts=Array.from({length:15},(_,i)=>({_id:'C'+i,num:String(i+1),location_id:i<13?'CH':'SN',is_active:true,match_id:'burst-'+i}));
  curt.matches=Array.from({length:373},(_,i)=>{
   const match=structuredClone(template);match._id='burst-'+i;match.setup.match_num=i+1;match.setup.state='scheduled';match.setup.now_on_court=false;
   delete match.setup.court_id;delete match.setup.location_id;delete match.setup.preparation_call_timestamp;
   match.setup.teams.forEach((team,j)=>team.players.forEach((player,k)=>{player.btp_id=10000+i*10+j*2+k;player.name='Testperson '+player.btp_id;player.firstname='Testperson';player.lastname=String(player.btp_id)}));
   if(i<15){match.setup.state='oncourt';match.setup.now_on_court=true;match.setup.court_id='C'+i;match.setup.location_id=i<13?'CH':'SN';match.network_score=[[5,5]];}
   else if(i<343){match.setup.state='finished';match.team1_won=true;match.btp_winner=1;match.network_score=[[21,15],[21,17]];match.end_ts=now-i*60000;match.shuttle_count=i%3?2:0;}
   return match;
  });
  curt.matches=JSON.parse(JSON.stringify(curt.matches));ctournament.ui_show();
  const connection=conn(()=>{},crouting.on_change);
  window.__burst={connection,receive:(ctype,val,marker)=>connection._test_handle_message({data:JSON.stringify({type:'change',ctype,tournament_key:curt.key,val,__syncBurst:marker})})};
  const sendBefore=window.send;__burst.requests=0;
  window.send=(message,callback)=>{if(message.type==='preparation_selection_get')__burst.requests++;return sendBefore(message,callback)};
  __burst.settle=()=>new Promise((resolve,reject)=>{const start=performance.now();let stable=0;const frame=()=>{if(performance.now()-start>10000)return reject(new Error('Sync burst did not settle'));stable=connection._test_change_queue_length()||cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame)});
  __burst.run=(kind,round)=>new Promise((resolve,reject)=>{
   const receipts=[],rows=new Map([...document.querySelectorAll('.finished_container tr[data-match_id]')].map(row=>[row.dataset.match_id,row])),start=performance.now(),requests=__burst.requests;
   const timer=setTimeout(()=>{unsubscribe();reject(new Error('Missing burst receipts: '+kind+' '+receipts.length));},20000);
   const unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(!receipt.message.__syncBurst)return;receipts.push(receipt);if(receipts.length!==81)return;unsubscribe();clearTimeout(timer);__burst.settle().then(()=>{
    const finished=[...document.querySelectorAll('.finished_container tr[data-match_id]')];
    const ids=finished.map(row=>row.dataset.match_id),expected=cleitstand.sortFinishedMatches(curt.matches.filter(match=>cmatch.calc_section(match)==='finished'),'end',-1).map(match=>match._id);
    resolve({kind,round,elapsed_ms:performance.now()-start,preparation_requests:__burst.requests-requests,rows_retained:finished.every(row=>rows.get(row.dataset.match_id)===row),sorted:JSON.stringify(ids)===JSON.stringify(expected),finished_count:finished.length,score:document.querySelector('tr[data-match_id="burst-0"] .match_score').textContent,receipts:receipts.map(receipt=>({type:receipt.message.ctype,status:receipt.status,timings:receipt.timings}))});
   },reject)});
   for(let i=15;i<95;i++){
    const match=structuredClone(curt.matches.find(match=>match._id==='burst-'+i));
    if(kind==='results'){match.end_ts+=round*60000+300000;match.network_score=[[21,10+round],[21,17]];match.shuttle_count=(i+round)%4;}
    else {match.setup.teams[0].players[0].name='Korrigierter Name '+round+' '+i;}
    __burst.receive('match_edit',{match__id:match._id,match},kind+'-'+round+'-'+i);
   }
   __burst.receive('score',{match_id:'burst-0',network_score:[[10+round,8]],presses:[],court_id:'C0',now_on_court:true},kind+'-point-'+round);
  });
 })()`);
 await c.evaluate('__burst.settle()');
 await c.call('Performance.enable');
 const phases=[];
 for(const kind of ['results','names'])for(let round=0;round<3;round++) {
  const before=(await c.call('Performance.getMetrics')).metrics;
  const phase=await c.evaluate(`__burst.run(${JSON.stringify(kind)},${round})`);
  const after=(await c.call('Performance.getMetrics')).metrics;
  phase.cpu_ms=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,1000*(after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value)]));
  phases.push(phase);
 }
 const percentile=(values,p)=>values.sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
 const regressions=await c.evaluate(`(async()=>{
  const first=()=>document.querySelector('.finished_container tr[data-match_id]')?.dataset.match_id;
  const change=async edit=>{const match=structuredClone(curt.matches.find(match=>match._id==='burst-340'));edit(match);__burst.receive('match_edit',{match__id:match._id,match});await __burst.settle()};
  document.querySelector('.ls-time-sort[data-sort-key="number"]').click();
  await change(match=>match.setup.match_num=0);const number=first()==='burst-340';
  await change(match=>match.setup.teams[0].players[0].name='Neue Spielerin');const keepNumber=first()==='burst-340';
  const namedRow=document.querySelector('tr[data-match_id="burst-350"]'),namedPlayer=namedRow.querySelector('.player'),classes=namedPlayer.className,button=namedRow.querySelector('.match_preparation_call_button'),requests=__burst.requests;
  const rename=structuredClone(curt.matches.find(match=>match._id==='burst-350'));
  rename.setup.teams[0].players[0].name='Alexandra-Johanna Neue Spielerin';
  __burst.receive('match_edit',{match__id:rename._id,match:rename});await __burst.settle();
  const namesPreserved=namedRow.querySelector('.player')===namedPlayer&&namedPlayer.className===classes&&namedPlayer.dataset.lsFullName===rename.setup.teams[0].players[0].name&&namedRow.querySelector('.match_preparation_call_button')===button;
  const nameQueryFree=__burst.requests===requests;
  const writes=__writes.length;namedPlayer.click();
  const nameCheckIn=__writes.slice(writes).some(message=>message.type==='match_player_check_in'&&String(message.player_id)===String(rename.setup.teams[0].players[0].btp_id));
  const replacement=structuredClone(rename);replacement.setup.teams[0].players[0].btp_id=999999;replacement.setup.teams[0].players[0].name='Andere Spielerin';
  __burst.receive('match_edit',{match__id:replacement._id,match:replacement});await __burst.settle();
  const identityReplaced=!namedPlayer.isConnected&&namedRow.querySelector('.player').dataset.btp_id==='999999';
  document.querySelector('.ls-time-sort[data-sort-key="plan"]').click();
  await change(match=>{match.setup.scheduled_date='2000-01-01';match.setup.scheduled_time_str='00:01'});const plan=first()==='burst-340';
  await change(match=>{delete match.team1_won;delete match.btp_winner;delete match.end_ts;delete match.network_score;match.setup.state='scheduled'});
  const reopened=document.querySelectorAll('.finished_container tr[data-match_id]').length===327&&!!document.querySelector('.unassigned_container tr[data-match_id="burst-340"]');
  cleitstand.refreshFinished();ctournament.ui_show();await __burst.settle();
  return{number,keepNumber,namesPreserved,nameQueryFree,nameCheckIn,identityReplaced,plan,reopened,remounted:!cleitstand.isUpdating()&&!ctournament.isUpdating()&&!!document.querySelector('.finished_container .ls-match')};
 })()`);
 const report={date:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'}),scope:'Isolierter Browser mit 373 Spielen, 328 abgeschlossenen Spielen und 15 belegten Feldern. Je Burst 80 Spielkorrekturen und ein nachfolgender Punkt über die echte Empfangswarteschlange; keine Live-Dienste.',phases,regressions,summary:['results','names'].map(kind=>{
  const samples=phases.filter(phase=>phase.kind===kind),receipts=samples.flatMap(phase=>phase.receipts);
  return{kind,point_max_ms:Math.max(...receipts.filter(receipt=>receipt.type==='score').map(receipt=>receipt.timings.total_ms)),updates_p95_ms:percentile(receipts.map(receipt=>receipt.timings.total_ms),.95),cpu_mean_ms:samples.reduce((sum,phase)=>sum+phase.cpu_ms.TaskDuration,0)/samples.length};
 })};
 fs.writeFileSync(path.join(previews,process.env.BTS_SYNC_BURST_REPORT||'sync-burst-verification.json'),JSON.stringify(report,null,2)+'\n');
 assert(phases.every(phase=>phase.rows_retained&&phase.sorted&&phase.finished_count===328),'Burst updates must preserve rows and the selected result order');
 assert(phases.every(phase=>phase.receipts.length===81&&phase.receipts.every(receipt=>receipt.status==='presented')),'Every correction and point must be presented');
 assert(phases.every(phase=>phase.score===(10+phase.round)+':8'),'The current game must show the point received after the corrections');
 assert.strictEqual(await c.evaluate('btsAdminUpdates.stats().pending'),0,'Burst presentation must drain completely');
 assert(Object.values(regressions).every(Boolean),'Changed sort keys, selected order, reopened games and remounting must remain correct');
 assert(report.summary.every(summary=>summary.point_max_ms<250),'A point behind 80 corrections must be presented within 250 ms');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Sync bursts must not throw browser exceptions');
 console.log(JSON.stringify({phases:phases.length,summary:report.summary,regressions},null,2));
};
