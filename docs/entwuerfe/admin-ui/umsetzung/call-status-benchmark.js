'use strict';
/* eslint-disable no-console -- Isolated before/after browser measurement. */
const assert=require('assert'),fs=require('fs'),crypto=require('crypto');
const stats=values=>{
 const sorted=[...values].sort((a,b)=>a-b);
 return {count:sorted.length,mean_ms:sorted.reduce((sum,value)=>sum+value,0)/sorted.length,
  p50_ms:sorted[Math.floor(sorted.length*.5)],p95_ms:sorted[Math.ceil(sorted.length*.95)-1],max_ms:sorted.at(-1)};
};

// Serve the old unconditional application path without reverting repository
// files. Keep revision guards and every other optimization identical in A/B.
function baselineSource(source) {
 const start=source.indexOf('\t\tconst previous_selections = curt.location_preparation_selection_by_location_id;');
 const end=source.indexOf('\n\t\treturn true;\n\t}\n\n\tfunction request_location_preparation_selections(',start);
 assert(start>=0&&end>start,'Expected the current content-comparison block');
 return source.slice(0,start)+[
  '\t\tcurt.location_preparation_selection_by_location_id = selection_by_location_id;',
  '\t\tif (document.querySelector(\'[data-location-need-label]\')) update_location_preparation_need_labels(false);',
  '\t\tcmatch.refresh_unassigned_preparation_context();',
  '\t\tcmatch.update_preparation_demand_court_markers?.();',
 ].join('\n')+source.slice(end);
}

async function benchmark({c,open,afterSetup}) {
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.__statusErrors=[];window.addEventListener(\'error\',event=>{if(event instanceof ErrorEvent)__statusErrors.push(event.message)});'});
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53')),now=Date.now();
  curt.courts=Array.from({length:15},(_,i)=>({_id:'C'+i,num:String(i+1),location_id:i<13?'CH':'SN',is_active:true,match_id:'status-'+i}));
  curt.matches=Array.from({length:584},(_,i)=>{
   const match=structuredClone(template);match._id='status-'+i;match.btp_match_ids=[{id:i,draw:1}];
   Object.assign(match.setup,{match_num:i+1,event_name:'JE U17',state:'scheduled',now_on_court:false,highlight:0,scheduled_date:'2026-11-11',scheduled_time_str:'12:00',scoring_format:calc.scoring_format_from_counting('3x21')});
   for(const key of ['court_id','location_id','preparation_call_timestamp','umpire','service_judge','tabletoperators'])delete match.setup[key];
   match.setup.teams.forEach((team,j)=>team.players.forEach((player,k)=>{
    player.btp_id=20000+i*10+j*2+k;player.name='Alexandra-Johanna Testperson '+player.btp_id;
    player.firstname='Alexandra-Johanna';player.lastname='Testperson '+player.btp_id;
    delete player.last_time_on_court_ts;delete player.now_playing_on_court;
   }));
   if(i<15){Object.assign(match.setup,{state:'oncourt',now_on_court:true,court_id:'C'+i,location_id:i<13?'CH':'SN'});match.network_score=[[5,5]];}
   else if(i<26){match.setup.state='finished';match.team1_won=true;match.network_score=[[21,15],[21,17]];match.end_ts=now-i*60000;}
   return match;
  });
  const qa=window.__statusBench={sequence:0,receipts:[],work:[],refreshes:0,courtPasses:0};
  qa.settle=()=>new Promise((resolve,reject)=>{let stable=0;const end=performance.now()+15000;const frame=()=>{if(performance.now()>end)return reject(Error('Status benchmark did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  const ids=curt.matches.slice(26).map(match=>match._id);
  qa.snapshot={call_status:{epoch:'status-benchmark',revision:1,evaluated_at:now,valid_until:now+60000},selections:curt.locations.map(location=>({
   location_id:location._id,manual_callable_match_ids:[...ids],demand_court_ids:[],
   current_preparation_count:0,required_preparation_count:2,missing_preparation_count:2,
   effective_required_preparation_count:2,effective_missing_preparation_count:2,
   display_frontier_match_id:'status-26',display_cutoff_match_id:null,
   diagnostics_by_match_id:Object.fromEntries(ids.slice(0,64).map(id=>[id,{match_id:id,eligible:true,manual_eligible:true,criteria_eligible:true,within_call_window:true,rules:[
    {key:'participants_complete',enabled:true,passed:true,detail:'Spieler stehen fest'},
    {key:'player_pause',enabled:true,passed:true,detail:'Spieler sind bereit'},
   ]}])),call_on_court_diagnostics_by_match_id:{},
  }))};
  const originalSend=send;
  window.send=(message,callback)=>message.type==='preparation_selection_get'?setTimeout(()=>callback?.(null,structuredClone(qa.snapshot)),0):originalSend(message,callback);
  ctournament.ui_show();
 })()`);
 await c.evaluate('(async()=>{await __statusBench.settle();ctournament.apply_call_status(structuredClone(__statusBench.snapshot),\'preview\');await __statusBench.settle()})()');
 const initial=await c.evaluate('({games:curt.matches.length,upcoming:document.querySelectorAll(\'.unassigned_container tr[data-match_id]\').length,dom_nodes:document.querySelectorAll(\'*\').length,status_bytes:new TextEncoder().encode(JSON.stringify(__statusBench.snapshot)).length})');
 assert.strictEqual(initial.games,584);assert.strictEqual(initial.upcoming,558);
 if(afterSetup)return afterSetup({c,initial});
 await c.evaluate(`(()=>{
  const qa=__statusBench;qa.rows=[...document.querySelectorAll('.unassigned_container tr[data-match_id]')];
  qa.handler=change.default_handler(()=>{throw Error('Unexpected full board rebuild')});
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__statusSample)qa.receipts.push({id:receipt.message.__statusSample,status:receipt.status,timings:receipt.timings,ui_jobs:receipt.ui_jobs})});
  const defer=cleitstand.deferUpdate,courts=cmatch.update_preparation_demand_court_markers;
  cleitstand.deferUpdate=function(name,callback){return defer.call(this,name,name!=='preparation.controls'?callback:()=>{const start=performance.now();try{qa.refreshes++;return callback()}finally{qa.work.push(performance.now()-start)}})};
  cmatch.update_preparation_demand_court_markers=function(...args){if(args[1])qa.courtPasses++;return courts.apply(this,args)};
  qa.restore=()=>{qa.unsubscribe();cleitstand.deferUpdate=defer;cmatch.update_preparation_demand_court_markers=courts};
  qa.buttons=id=>[...document.querySelector('.unassigned_container tr[data-match_id="'+id+'"] td.call_td').querySelectorAll('.match_preparation_call_button')].map(node=>node.dataset.location_id).sort().join(',');
  qa.check=()=>{
   const ch=new Set(qa.snapshot.selections[0].manual_callable_match_ids);
   for(let i=26;i<90;i++){const id='status-'+i,expected=ch.has(id)?'CH,SN':'SN';if(qa.buttons(id)!==expected)throw Error('Incorrect final controls for '+id)}
   if(curt.call_status.revision!==qa.snapshot.call_status.revision)throw Error('Revision was lost');
  };
  qa.publish=changed=>{
   qa.snapshot=structuredClone(qa.snapshot);const selection=qa.snapshot.selections[0],allowed=new Set(selection.manual_callable_match_ids);
   for(const id of changed){if(allowed.has(id))allowed.delete(id);else allowed.add(id);const diagnosis=selection.diagnostics_by_match_id[id];diagnosis.manual_eligible=diagnosis.eligible=diagnosis.criteria_eligible=allowed.has(id);diagnosis.rules[1].passed=allowed.has(id);diagnosis.rules[1].detail=allowed.has(id)?'Spieler sind bereit':'Spieler sind noch beschäftigt'}
   selection.manual_callable_match_ids=[...allowed];qa.snapshot.call_status.revision++;qa.snapshot.call_status.evaluated_at++;qa.snapshot.call_status.valid_until++;
   const message={type:'change',ctype:'call_status_changed',tournament_key:'preview',val:structuredClone(qa.snapshot),__statusSample:++qa.sequence};
   btsAdminUpdates.dispatch(message,qa.handler);
   return message.__statusSample;
  };
  qa.sample=async(mode,index)=>{
   const startWork=qa.work.length,startRefresh=qa.refreshes,startCourts=qa.courtPasses,ids=[];
   if(mode==='unchanged')ids.push(qa.publish([]));
   else for(let n=0;n<(mode==='burst'?8:1);n++)ids.push(qa.publish(['status-'+(26+(index*8+n)%64)]));
   await btsAdminUpdates.whenSettled();
   // The existing receipt endpoint includes all owned UI jobs plus two
   // animation frames. These independent assertions do not shorten it.
   qa.check();
   const receipts=qa.receipts.filter(receipt=>ids.includes(receipt.id)),jobs=new Map();
   // Eight owners can claim one coalesced job. Count its CPU only once.
   for(const receipt of receipts)for(const job of receipt.ui_jobs)jobs.set(job.name,Math.max(jobs.get(job.name)||0,job.work_ms));
   return {receipts,refreshes:qa.refreshes-startRefresh,court_passes:qa.courtPasses-startCourts+Number(jobs.has('preparation.courts')),refresh_work_ms:qa.work.slice(startWork).reduce((a,b)=>a+b,0),owned_job_work_ms:[...jobs.values()].reduce((a,b)=>a+b,0)};
  };
 })()`);
 await c.call('Performance.enable');
 const rounds=Number(process.env.BTS_CALL_STATUS_SAMPLES||40),phases=[];
 for(const mode of ['unchanged','single','burst']) {
  for(let i=0;i<5;i++)await c.evaluate('__statusBench.sample('+JSON.stringify(mode)+','+i+')');
  const before=(await c.call('Performance.getMetrics')).metrics,measurements=[];
  for(let i=0;i<rounds;i++)measurements.push(await c.evaluate('__statusBench.sample('+JSON.stringify(mode)+','+i+')'));
  const after=(await c.call('Performance.getMetrics')).metrics;
  const cpu_ms=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,1000*(after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value)]));
  const receipts=measurements.flatMap(sample=>sample.receipts);
  assert.strictEqual(receipts.length,rounds*(mode==='burst'?8:1),'Every status has its receipt');
  assert(receipts.every(receipt=>receipt.status==='presented'&&receipt.ui_jobs.every(job=>job.status==='complete')),'Every owned job and presentation must complete');
  phases.push({mode,summary:{refresh_work:stats(measurements.map(sample=>sample.refresh_work_ms)),owned_job_work:stats(measurements.map(sample=>sample.owned_job_work_ms)),handler:stats(receipts.map(receipt=>receipt.timings.handler_ms)),presentation:stats(receipts.map(receipt=>receipt.timings.total_ms))},cpu_ms,measurements});
 }
 const final=await c.evaluate('({rows_retained:__statusBench.rows.every(row=>row.isConnected),pending:btsAdminUpdates.stats(),errors:__statusErrors})');
 assert(final.rows_retained&&final.pending.pending===0&&final.pending.callbackErrors===0,'Rows retained and every task drained');
 assert(final.errors.length===0&&!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No native errors');
 const source=fs.readFileSync(require.resolve('../../../../static/js/ctournament.js'),'utf8');
 const baseline=process.env.BTS_CALL_STATUS_BASELINE==='1';
 const report={baseline,scope:'Isolated headless Chrome at 1920x1080, 584 games / 558 upcoming / 15 active courts / two locations. Authoritative synthetic snapshots: 558 manual IDs and 64 diagnoses per location. Sequential fresh browsers; five warmup samples per phase. No BTS/BTP/remote device requests or writes. Unchanged means newer revision, identical selections. Single changes one game; burst sends eight different game changes in one task. Standard owned-work plus two-frame presentation receipt is unchanged. Browser CPU includes fixture cloning and independent correctness checks in both variants; refresh_work is the actual synchronous preparation-controls work.',rounds,initial,source_sha256:crypto.createHash('sha256').update(baseline?baselineSource(source):source).digest('hex'),phases,...final};
 if(process.env.BTS_CALL_STATUS_BENCHMARK_REPORT)fs.writeFileSync(process.env.BTS_CALL_STATUS_BENCHMARK_REPORT,JSON.stringify(report,null,2)+'\n');
 await c.evaluate('__statusBench.restore()');
 console.log(JSON.stringify({baseline,initial,phases:phases.map(({mode,summary,cpu_ms})=>({mode,summary,cpu_ms})),...final},null,2));
}
module.exports=benchmark;module.exports.baselineSource=baselineSource;
