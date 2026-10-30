'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
module.exports=async function({c,open,previews,matchCount=128,finishedCount=59,clockLimit=null,reportFile='mixed-update-verification.json',containmentOnly=false,paintScopeOnly=false,structuralChanges=false}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
 const matchCount=${matchCount},finishedEnd=15+${finishedCount},clockLimit=${clockLimit ?? 'Infinity'};
 const template=structuredClone(curt.matches.find(m=>m._id==='match-53'));
 curt.courts=Array.from({length:15},(_,i)=>({_id:'C'+i,num:String(i+1),location_id:i<13?'CH':'SN',is_active:true,match_id:'load-'+i}));
 curt.matches=Array.from({length:matchCount},(_,i)=>{
  const m=structuredClone(template);m._id='load-'+i;m.setup.match_num=i+1;m.setup.teams.forEach((t,j)=>t.players.forEach((p,k)=>{p.btp_id=10000+i*10+j*2+k;p.name='Testperson '+p.btp_id;p.firstname='Testperson';p.lastname=String(p.btp_id);if(i*4+j*2+k<clockLimit)p.last_time_on_court_ts=Date.now()-30000}));
  if(i<15){m.setup.now_on_court=true;m.setup.state='oncourt';m.setup.court_id='C'+i;m.setup.location_id=i<13?'CH':'SN';m.setup.called_timestamp=Date.now()-90000;m.network_score=[[5,5]];}
  else if(i<finishedEnd){m.setup.state='finished';m.team1_won=true;m.network_score=[[21,15],[21,17]];m.end_ts=Date.now()-i*60000;}
  else if(i<finishedEnd+6){m.setup.state='preparation';m.setup.preparation_call_timestamp=Date.now()-60000;m.setup.location_id=i%2?'CH':'SN';m.setup.highlight=i%2?6:4;}
  if(i===finishedEnd+6)m.setup.umpire={btp_id:99001,firstname:'Alexander Maximilian',surname:'Keo Boun Khoune',name:'Alexander Maximilian Keo Boun Khoune',checked_in:true};
  return m;
 });
 curt.displays=Array.from({length:30},(_,i)=>({client_id:'device-'+i,hostname:'Test '+i,online:true,displaysetting_id:i<15?'tablet-profile':'display-profile',panel_devicemode:i<15?'umpire':'display',court_id:'C'+(i%15),battery:i<15?{level:.76,charging:false}:undefined}));
 // Initial data must have the same JSON shape as the later wire snapshots.
 // Explicit undefined keys otherwise fabricate a structural change per field.
 curt.matches=JSON.parse(JSON.stringify(curt.matches));
 ctournament.ui_show();window.__mixEvents=[];window.__mixPoints=[];window.__mixOutcomes={};window.__mixPerfTypes={};window.__mixSequence=0;
 window.__mixObserver=btsAdminUpdates.subscribe(receipt=>{__mixOutcomes[receipt.status]=(__mixOutcomes[receipt.status]||0)+1;if(receipt.message.__mixPoint){const point=__mixPoints.find(p=>p.id===receipt.message.__mixPoint);point.receipt=receipt;}if(receipt.message.type==='change'){const bucket=__mixPerfTypes[receipt.message.ctype]||(__mixPerfTypes[receipt.message.ctype]=[]);bucket.push(receipt.timings)}});
 window.__mixRoute=message=>{const result=crouting.on_change(message);if(message.__mixPoint){const point=__mixPoints.find(p=>p.id===message.__mixPoint);point.applied=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{point.independent=performance.now();point.seen=document.querySelector('tr[data-match_id="'+message.val.match_id+'"] .match_score').textContent===message.val.network_score.map(s=>s.join(':')).join(' ')}))}return result};
 window.__mixConn=conn(()=>{},__mixRoute);window.__mixReceive=(ctype,val,point)=>__mixConn._test_handle_message({data:JSON.stringify({type:'change',tournament_key:'preview',ctype,val,__mixPoint:point})});
 })()`);
 await c.evaluate(`new Promise(resolve=>{const wait=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(wait):requestAnimationFrame(()=>requestAnimationFrame(resolve));wait()})`);
 const timerCount=await c.evaluate(`document.querySelectorAll('.player .timer').length`);assert(timerCount>=180,'The stress case must include at least 180 active player clocks');
 const regressions=await c.evaluate(`(async()=>{
  const clock=document.querySelector('.player .timer');cleitstand.timerDisplay(clock,'1:12');
  const time=clock.querySelector('.timer-value'),digits=clock.querySelector('.timer-digits'),nodes=[...digits.childNodes],text=nodes.map(node=>node.firstChild||node);
  const mutations=new MutationObserver(()=>{});mutations.observe(clock,{subtree:true,childList:true,characterData:true});
  cleitstand.timerDisplay(clock,'1:13');const records=mutations.takeRecords();mutations.disconnect();
  const clockStable=nodes.every((node,index)=>digits.childNodes[index]===node&&(node.firstChild||node)===text[index])&&records.some(record=>record.type==='characterData')&&records.every(record=>record.type!=='childList');
  const official=document.querySelector('.unassigned_container .umpire_and_tablet .name'),shortened=official.textContent.replaceAll(String.fromCharCode(160),' ')!==official.dataset.lsFullName,nameChanges=[];
  const names=new MutationObserver(records=>nameChanges.push(...records));names.observe(official,{subtree:true,childList:true,characterData:true});
  cmatch.refresh_unassigned_preparation_context();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const officialStable=nameChanges.length+names.takeRecords().length===0;names.disconnect();
  return{clockStable,officialStable,shortened};
 })()`);
 assert(regressions.clockStable,'A clock tick must preserve its existing digit and text nodes');
 assert(regressions.shortened&&regressions.officialStable,'Refreshing preparation must preserve an abbreviated official name without re-measuring it');
 if(containmentOnly)return require('./timer-containment-check')({c,previews,matchCount,timerCount});
 if(paintScopeOnly)return require('./paint-scope-check')({c,previews,matchCount,timerCount});
 const result=await c.evaluate(`new Promise(resolve=>{
  const start=performance.now();let index=0,point=0,structuralCount=0;
  const structural=${structuralChanges}?setInterval(()=>{
   const match=curt.matches.find(m=>m._id==='load-0'),original=structuredClone(match);structuralCount++;
   __mixReceive('score',{match_id:match._id,network_score:[[21,15],[21,17]],presses:[],team1_won:true,now_on_court:false,court_id:match.setup.court_id,end_ts:Date.now()});
   const official=structuredClone(curt.matches.find(m=>m._id==='load-'+(15+${finishedCount}+6)));
   if(structuralCount%2)delete official.setup.umpire;else official.setup.umpire={btp_id:99001,firstname:'Alexander Maximilian',surname:'Keo Boun Khoune',name:'Alexander Maximilian Keo Boun Khoune',checked_in:true};
   __mixReceive('match_edit',{match__id:official._id,match:official});
   setTimeout(()=>__mixReceive('match_edit',{match__id:original._id,match:original}),300);
  },2600):null;
  const ack=setInterval(()=>{for(let n=0;n<2;n++){const id='device-'+(15+index++%15),message_id=String(index);__mixReceive('display_wait_for_done',{client_id:id,ctype:'display_timer_update',message_id});__mixReceive('display_is_done',{client_id:id,ctype:'display_timer_update',message_id})}},62);
  const metadata=setInterval(()=>{const id='device-'+(index%15);__mixReceive('display_status_changed',{display_court_displaysetting:{client_id:id,battery:{level:.76-(index%40)/10000,charging:false}}});__mixReceive('display_render_stats',{client_id:'device-'+(15+index%15),display_render_stats:{last_render_ms:index%15,ack_count:index}})},250);
  const points=setInterval(()=>{const id=++point,match_id='load-'+(point%15),m=curt.matches.find(m=>m._id===match_id),network_score=[[point%20,8]];__mixPoints.push({id,sent:performance.now()});__mixReceive('score',{match_id,network_score,presses:[],court_id:m.setup.court_id,now_on_court:true},id);const snapshot=structuredClone(m);snapshot.network_score=network_score;__mixReceive('court_current_match',{match__id:match_id,match:snapshot})},380);
  setTimeout(()=>{clearInterval(ack);clearInterval(metadata);clearInterval(points);clearInterval(structural);setTimeout(()=>resolve({elapsed:performance.now()-start,structuralCount,probes:document.querySelectorAll('.ls-layout-probe').length,points:__mixPoints.map(p=>({id:p.id,applied:p.applied-p.sent,independent:p.independent-p.sent,seen:p.seen,status:p.receipt?.status,ack:p.receipt?.timings})),outcomes:__mixOutcomes,types:Object.fromEntries(Object.entries(__mixPerfTypes).map(([k,v])=>[k,{count:v.length,handler:v.reduce((s,t)=>s+t.handler_ms,0),total:v.reduce((s,t)=>s+t.total_ms,0)/v.length}])),queue:__mixConn._test_change_queue_length(),pending:btsAdminUpdates.stats()}),5500)},20000);
 })`);
 const stats=key=>{const a=result.points.map(p=>key==='ack'?p.ack?.total_ms:p[key]).filter(Number.isFinite).sort((a,b)=>a-b);return{count:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}};
 const report={date:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'}),scope:'Isolierter Dauerlasttest mit nativer Empfangswarteschlange, laufenden Spielerpausen, Punkten und Gerätemeldungen. Synthetische Daten, keine Live-Dienste oder Netzwerk-Latenzmessung.',matchCount,finishedCount,courtCount:15,deviceCount:30,timerCount,structuralChanges:result.structuralCount,regressions,stats:Object.fromEntries(['applied','independent','ack'].map(k=>[k,stats(k)])),types:result.types,outcomes:result.outcomes,pending:result.pending,limits:{point_median_ms:100,point_p95_ms:500,point_max_ms:structuralChanges?350:1000},measurements:result.points};
 fs.writeFileSync(path.join(previews,reportFile),JSON.stringify(report,null,2)+'\n');
 assert(result.points.length>=25,'The sustained load must contain at least 25 real point updates');
 assert(result.points.every(p=>p.seen&&p.status==='presented'),'Each point must update the real DOM and receive a presentation receipt');
 assert.strictEqual(result.pending.pending,0,'No stale receipts may remain after the incoming stream drains');
 assert(Object.keys(result.outcomes).every(key=>key==='presented'),'No capacity/timeouts or dropped acknowledgements under sustained load');
 assert(report.stats.ack.p50<100&&report.stats.ack.p95<500&&report.stats.ack.max<1000,'Sustained point updates must meet their documented latency limits');
 if(structuralChanges) {
  assert(result.structuralCount>=5&&result.probes===0,'Finishing games and changing column widths must leave no measurement copies');
  // Full-column resizes every 2.6 seconds are an additional synthetic stress
  // case. The 120 ms percentile is accepted only over the full server sequence;
  // here retain the structural-update percentile budget and enforce max 350.
  assert(report.stats.ack.max<=350,'Point presentation must stay responsive during game finishes and column width changes');
 }
 console.log(JSON.stringify({checks:8,matchCount,timerCount,regressions,stats:report.stats,outcomes:result.outcomes,pending:result.pending},null,2));
};
