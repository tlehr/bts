'use strict';
/* eslint-disable no-console -- Isolated ordinary-point performance and correctness check. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 const instrument=require('./startup-check').instrumentation;
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.__pointErrors=[];window.addEventListener(\'error\',event=>{if(event instanceof ErrorEvent)__pointErrors.push(event.message);});'});
 await open(1920,1080,{startup:true,beforeFixture:async()=>{await c.evaluate('('+instrument.toString()+')()');await c.evaluate('(()=>{const make=__startup.make;__startup.make=template=>{const data=make(template);for(const match of data.matches)match.setup.scoring_format=calc.scoring_format_from_counting(match.setup.counting);return data;};})()');},transformFixture:source=>source.replace('tournament:structuredClone(fixture)','tournament:__startup.make(fixture)')});
 await c.evaluate('__startup.ready');
 await c.evaluate(`(()=>{
  const qa=window.__pointQA={samples:[],receipts:[],calls:{},rowNodes:[...document.querySelectorAll('tr[data-match_id]')]};
  qa.wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  qa.unwrap=[];
  for(const [object,key,label]of [[cmatch,'update_match_score','score'],[calc,'remote_state','timerReplay'],[cleitstand,'refreshScoreLayout','scoreLayout'],[cleitstand,'refreshUnassigned','unassigned'],[cleitstand,'refreshFinished','finished']]){
   const fn=object[key];object[key]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{const entry=qa.calls[label]||={count:0,ms:0};entry.count++;entry.ms+=performance.now()-start;}};qa.unwrap.push(()=>object[key]=fn);
  }
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__pointId)qa.receipts.push(receipt);});
  qa.connection=conn(()=>{},message=>{
   const result=crouting.on_change(message),sample=qa.samples.find(sample=>sample.id===message.__pointId);
   if(sample&&message.ctype==='score'){
    sample.applied=performance.now()-sample.sent;
    requestAnimationFrame(()=>{sample.firstFrame=performance.now()-sample.sent;sample.clockVisible=!!sample.node.closest('tr').querySelector('.match_timer .timer:not([style*="display: none"])');sample.firstSeen=[...sample.node.querySelectorAll('.ls-set-score')].map(set=>set.textContent).join(' ')===sample.expected;requestAnimationFrame(()=>{sample.secondFrame=performance.now()-sample.sent;sample.secondSeen=[...sample.node.querySelectorAll('.ls-set-score')].map(set=>set.textContent).join(' ')===sample.expected;sample.resolve();});});
   }
   return result;
  });
  qa.receive=(ctype,val,id)=>qa.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:curt.key,ctype,val,__pointId:id})});
  qa.history=(sets,confirmInterval=true)=>{
   const presses=[{type:'pick_side',team1_left:true},{type:'pick_server',team_id:0,player_id:0},{type:'pick_receiver',team_id:1,player_id:0}];let timestamp=Date.now()-(confirmInterval?200000:20000);
   for(const [index,score]of sets.entries()){
    presses.push({type:'love-all',timestamp:timestamp+=1000});const counts=index%2?[score[1],score[0]]:[...score];let interval=false,left=0,right=0;
    while(left<counts[0]||right<counts[1]){
     for(const side of ['left','right']){
      if(side==='left'?left>=counts[0]:right>=counts[1])continue;
      presses.push({type:'score',side,timestamp:timestamp+=1000});if(side==='left')left++;else right++;
      if(confirmInterval&&!interval&&Math.max(left,right)===11){presses.push({type:'postinterval-confirm',timestamp:timestamp+=1000});interval=true;}
     }
    }
    if(index<sets.length-1)presses.push({type:'postgame-confirm',timestamp:timestamp+=1000});
   }
   return presses;
  };
  qa.run=async(mode)=>{
   const samples=[];
   for(let i=0;i<40;i++){
    await qa.wait(51+(i*37)%67);
    const match=curt.matches.filter(match=>match.setup.now_on_court)[i%curt.courts.length],node=document.querySelector('tr[data-match_id="'+match._id+'"] .match_score'),network_score=mode==='history'?[[21,19],[19,21],[6+(i%14),4+(i%5)]]:mode==='interval'?[[10+i%2,3]]:[[6+(i%14),4+(i%5)]];
    const presses=mode==='history'||mode==='interval'?qa.history(network_score,mode!=='interval'):[];
    const snapshot=structuredClone(match);Object.assign(snapshot,{network_score,presses});delete snapshot.team1_won;delete snapshot.shuttle_count;
    const sample={id:qa.samples.length+1,mode,sent:performance.now(),expected:network_score.map(set=>set.join(':')).join(' '),node};qa.samples.push(sample);samples.push(sample);
    const painted=new Promise(resolve=>sample.resolve=resolve);
    qa.receive('score',{match_id:match._id,network_score,presses,court_id:match.setup.court_id,now_on_court:true},sample.id);
    if(mode==='snapshot')qa.receive('court_current_match',{match__id:match._id,match:snapshot},sample.id);
    await painted;await btsAdminUpdates.whenSettled();
   }
   return samples.map(sample=>({id:sample.id,mode,applied_ms:sample.applied,first_frame_ms:sample.firstFrame,second_frame_ms:sample.secondFrame,first_seen:sample.firstSeen,second_seen:sample.secondSeen,clock_visible:sample.clockVisible,receipts:qa.receipts.filter(receipt=>receipt.message.__pointId===sample.id).map(({status,timings,ui_jobs,message})=>({type:message.ctype,status,timings,ui_jobs}))}));
  };
 })()`);
 const tracing=process.env.BTS_POINT_TRACE==='1',prefix=process.env.BTS_POINT_PREFIX||'point-updates',start=c.events.length;
 await c.call('Performance.enable');
 if(tracing){await c.call('Profiler.enable');await c.call('Profiler.setSamplingInterval',{interval:1000});await c.call('Profiler.start');await c.call('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});}
 const phases=[];
 for(const mode of ['score','snapshot','history',...(process.env.BTS_POINT_INTERVALS==='1'?['interval']:[])]){
  const before=(await c.call('Performance.getMetrics')).metrics,measurements=await c.evaluate('__pointQA.run('+JSON.stringify(mode)+')'),after=(await c.call('Performance.getMetrics')).metrics;
  phases.push({mode,measurements,cpu_ms:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,1000*(after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value)])),layout_count:after.find(metric=>metric.name==='LayoutCount').value-before.find(metric=>metric.name==='LayoutCount').value});
 }
 if(tracing){await c.call('Tracing.end');for(let i=0;!c.events.slice(start).some(event=>event.method==='Tracing.tracingComplete');i++){assert(i<100);await new Promise(resolve=>setTimeout(resolve,20));}fs.writeFileSync(path.join(previews,prefix+'-trace.json'),JSON.stringify(c.events.slice(start).filter(event=>event.method==='Tracing.dataCollected').flatMap(event=>event.params.value)));const profile=await c.call('Profiler.stop');fs.writeFileSync(path.join(previews,prefix+'-profile.json'),JSON.stringify(profile.profile));}
 const final=await c.evaluate('({calls:__pointQA.calls,rows:document.querySelectorAll(".ls-match").length,retained:__pointQA.rowNodes.every(node=>node.isConnected),pending:btsAdminUpdates.stats(),errors:__pointErrors})');
 const stats=values=>{values.sort((a,b)=>a-b);return{count:values.length,mean_ms:values.reduce((a,b)=>a+b,0)/values.length,p50_ms:values[Math.floor(values.length*.5)],p95_ms:values[Math.ceil(values.length*.95)-1],max_ms:values.at(-1)};};
 const summary=Object.fromEntries(phases.map(phase=>[phase.mode,Object.fromEntries(['applied_ms','first_frame_ms','second_frame_ms','receipt_ms'].map(key=>[key,stats(phase.measurements.map(value=>key==='receipt_ms'?value.receipts.find(receipt=>receipt.type==='score').timings.total_ms:value[key]))]))]));
 const report={intervals:process.env.BTS_POINT_INTERVALS==='1',scope:'512 synthetic games, 423 results, native receive queue, 40 isolated points and 40 points with a following court snapshot and 40 points with a complete third-set history and explicit scoring rules. No live writes. Independent first/second animation-frame DOM checks; receipts retain their existing two-frame method.',tracing,summary,phases,...final};
 fs.writeFileSync(path.join(previews,prefix+'-verification.json'),JSON.stringify(report,null,2)+'\n');
 assert(phases.every(phase=>phase.measurements.every(sample=>sample.first_seen&&sample.second_seen&&sample.receipts.length===(phase.mode==='snapshot'?2:1)&&sample.receipts.every(receipt=>receipt.status==='presented'))),'Every point and snapshot is presented, independently visible and acknowledged');
 assert(phases.filter(phase=>phase.mode==='interval').every(phase=>phase.measurements.every((sample,index)=>sample.clock_visible===!!(index%2))),'Interval clocks appear at 11 points and disappear before the interval in the first independent frame');
 assert(final.rows===512&&final.retained&&final.pending.pending===0&&final.pending.callbackErrors===0,'All rows retained and all work drains');
 assert(final.errors.length===0&&!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No native window errors or browser exceptions');
 await c.evaluate('__pointQA.unsubscribe();__pointQA.unwrap.forEach(restore=>restore())');
 console.log(JSON.stringify({summary,cpu:phases.map(({mode,cpu_ms,layout_count})=>({mode,cpu_ms,layout_count})),...final},null,2));
};
