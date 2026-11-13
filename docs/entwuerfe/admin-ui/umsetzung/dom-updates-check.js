'use strict';
/* eslint-disable no-console -- Isolated DOM attribution and timing measurements. */
const assert=require('assert'),fs=require('fs');
module.exports=async function({c,open}) {
 const audit=process.env.BTS_DOM_AUDIT==='1';
 await require('./call-status-benchmark')({c,open,afterSetup:async({initial})=>{
  await c.evaluate(`(()=>{
   const qa=window.__domQA={audit:${audit},phase:'warmup',scope:'background',groups:{},samples:[],sequence:0,receipts:[]};
   qa.rowNodes=[...document.querySelectorAll('tr[data-match_id]')];
   qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__domId)qa.receipts.push({id:receipt.message.__domId,status:receipt.status,timings:receipt.timings,ui_jobs:receipt.ui_jobs})});
   qa.describe=node=>{
    const element=node.nodeType===1?node:node.parentElement;if(!element)return '#detached-text';
    const card=element.closest('[data-board-card]'),row=element.closest('tr[data-match_id]');
    return (row?(row.closest('.unassigned_container')?'upcoming/':'court/'):(card?'card:'+card.dataset.boardCard+'/':''))+element.localName+(element.classList.length?'.'+[...element.classList].join('.'):'');
   };
   qa.records=records=>{
    const next=new WeakMap();
    for(let i=records.length-1;i>=0;i--){
     const record=records[i],name=record.attributeName||record.type,values=next.get(record.target)||new Map();
     const value=values.has(name)?values.get(name):record.type==='attributes'?record.target.getAttribute(name):record.target.nodeValue;
     values.set(name,record.oldValue);next.set(record.target,values);
     const key=qa.scope+' | '+qa.describe(record.target)+' | '+name,group=qa.groups[key]||={scope:qa.scope,target:qa.describe(record.target),kind:name,count:0,noops:0,added:0,removed:0,examples:[]};
     group.count++;if(record.type!=='childList'&&record.oldValue===value)group.noops++;
     group.added+=record.addedNodes.length;group.removed+=record.removedNodes.length;
     if(group.examples.length<2)group.examples.push({before:record.oldValue,after:record.type==='childList'?{added:[...record.addedNodes].slice(0,3).map(qa.describe),removed:[...record.removedNodes].slice(0,3).map(qa.describe)}:value});
    }
   };
   if(qa.audit){qa.observer=new MutationObserver(qa.records);qa.observer.observe(document.body,{subtree:true,childList:true,characterData:true,characterDataOldValue:true,attributes:true,attributeOldValue:true})}
   qa.drain=()=>{if(qa.audit)qa.records(qa.observer.takeRecords())};
   qa.run=(scope,callback)=>{qa.drain();const previous=qa.scope;qa.scope=scope;try{return callback()}finally{qa.drain();qa.scope=previous}};
   qa.restores=[];
   if(qa.audit){
    const native=btsAdminUpdates.createJob;btsAdminUpdates.createJob=function(name){const job=native.call(this,name),run=job.run;job.run=callback=>run(()=>qa.run('job:'+name,callback));return job};qa.restores.push(()=>btsAdminUpdates.createJob=native);
    for(const [object,key]of [[cmatch,'update_match_score'],[cleitstand,'updateScore'],[cleitstand,'score'],[cleitstand,'timerDisplay'],[cleitstand,'refreshUnassigned'],[cleitstand,'refreshTablets'],[cleitstand,'rotationIcons'],[cleitstand,'operatorQueue']]){
     const native=object[key];object[key]=function(...args){return qa.run(key,()=>native.apply(this,args))};qa.restores.push(()=>object[key]=native);
    }
   }
   qa.connection=conn(()=>{},message=>qa.audit?qa.run('handler:'+message.ctype,()=>crouting.on_change(message)):crouting.on_change(message));
   qa.receive=(ctype,val)=>{const id=++qa.sequence;qa.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:'preview',ctype,val,__domId:id})});return id};
   qa.status=ids=>{
    const snapshot=__statusBench.snapshot=structuredClone(__statusBench.snapshot),selection=snapshot.selections[0],allowed=new Set(selection.manual_callable_match_ids);
    for(const id of ids){if(allowed.has(id))allowed.delete(id);else allowed.add(id);selection.diagnostics_by_match_id[id].manual_eligible=allowed.has(id)}
    selection.manual_callable_match_ids=[...allowed];snapshot.call_status.revision++;snapshot.call_status.evaluated_at++;snapshot.call_status.valid_until++;
    return qa.receive('call_status_changed',snapshot);
   };
   qa.step=async(mode,index)=>{
    const start=qa.receipts.length,match=curt.matches[index%15],ids=[];
    if(mode==='point'||mode==='duplicate_point'||mode==='point_snapshot'){
     qa.scoreCounter=(qa.scoreCounter||0)+1;const network_score=mode==='duplicate_point'?match.network_score:[[6+qa.scoreCounter%10,5]];
     ids.push(qa.receive('score',{match_id:match._id,court_id:match.setup.court_id,network_score,presses:[],now_on_court:true}));
     if(mode==='point_snapshot'){const snapshot=structuredClone(match);snapshot.network_score=network_score;snapshot.presses=[];ids.push(qa.receive('court_current_match',{match__id:match._id,match:snapshot}));}
    } else if(mode==='status_same')ids.push(qa.status([]));
    else if(mode==='status_one')ids.push(qa.status(['status-'+(26+index%64)]));
    else if(mode==='status_burst')for(let n=0;n<8;n++)ids.push(qa.status(['status-'+(26+(index*8+n)%64)]));
    else if(mode==='check_in'){
     const target=curt.matches[30],setup=structuredClone(target.setup);setup.teams[0].players[0].checked_in=!setup.teams[0].players[0].checked_in;
     ids.push(qa.receive('update_player_status',{match__id:target._id,setup}));
    } else if(mode==='counts')btsAdminUpdates.dispatch({type:'change',ctype:'qa_counts',__domId:++qa.sequence},()=>cleitstand.refreshCounts());
    else if(mode==='battery'){
     curt.displays[0].battery={level:(50+index%10)/100,charging:true};cleitstand.refreshTablets();
    } else if(mode==='battery_same')cleitstand.refreshTablets();
    await btsAdminUpdates.whenSettled();await __statusBench.settle();qa.drain();
    if(mode.startsWith('status_')){
     const allowed=new Set(__statusBench.snapshot.selections[0].manual_callable_match_ids);
     for(let i=26;i<90;i++){const row=document.querySelector('.unassigned_container tr[data-match_id="status-'+i+'"]');if(!!row.querySelector('.match_preparation_call_button[data-location_id="CH"]')!==allowed.has('status-'+i))throw Error('Wrong call controls')}
    }
    if(mode==='point'||mode==='point_snapshot'||mode==='duplicate_point'){
     const expected=match.network_score.map(set=>set.join(':')).join(' '),node=document.querySelector('tr[data-match_id="'+match._id+'"] .match_score');
     if([...node.querySelectorAll('.ls-set-score')].map(set=>set.textContent).join(' ')!==expected)throw Error('Score is not visible');
    }
    const receipts=qa.receipts.slice(start);if(ids.length&&receipts.length!==ids.length)throw Error('Missing receipts');
    return receipts;
   };
  })()`);
  await c.call('Performance.enable');
  const phases=[],rounds=Number(process.env.BTS_DOM_SAMPLES||(audit?5:30));
  for(const mode of ['point','duplicate_point','point_snapshot','status_same','status_one','status_burst','check_in','counts','battery','battery_same']) {
   for(let i=0;i<3;i++)await c.evaluate('__domQA.step('+JSON.stringify(mode)+','+i+')');
   await c.evaluate('__domQA.drain();__domQA.groups={};');
   const before=(await c.call('Performance.getMetrics')).metrics,measurements=[];
   for(let i=0;i<rounds;i++)measurements.push(await c.evaluate('__domQA.step('+JSON.stringify(mode)+','+i+')'));
   const after=(await c.call('Performance.getMetrics')).metrics;
   const groups=await c.evaluate('(__domQA.drain(),Object.values(__domQA.groups).sort((a,b)=>b.count-a.count))');
   assert(measurements.flat().every(receipt=>receipt.status==='presented'&&receipt.ui_jobs.every(job=>job.status==='complete')),'Every own UI task and receipt completes');
   phases.push({mode,rounds,mutations:groups.reduce((sum,g)=>sum+g.count,0),noops:groups.reduce((sum,g)=>sum+g.noops,0),groups,cpu_ms:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,1000*(after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value)])),measurements});
  }
  const final=await c.evaluate('({rows_retained:__domQA.rowNodes.every(row=>row.isConnected),pending:btsAdminUpdates.stats(),errors:__statusErrors})');
  assert(final.rows_retained&&final.pending.pending===0&&final.pending.callbackErrors===0&&!final.errors.length&&!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No errors and rows retained');
  const report={audit,initial,scope:'Isolated 584-game board, real native receive queue and unchanged two-frame receipt endpoint. DOM audit instrumentation is for attribution only; timing comparisons must use BTS_DOM_AUDIT=0. Five audit or thirty timing samples per phase after three warmups; no live BTS/BTP writes.',phases,...final};
  if(process.env.BTS_DOM_REPORT)fs.writeFileSync(process.env.BTS_DOM_REPORT,JSON.stringify(report,null,2)+'\n');
  await c.evaluate('__domQA.observer?.disconnect();__domQA.unsubscribe();__domQA.restores.forEach(restore=>restore())');
  console.log(JSON.stringify({audit,initial,phases:phases.map(({mode,mutations,noops,cpu_ms,groups})=>({mode,mutations,noops,cpu_ms,top:groups.slice(0,5)})),...final},null,2));
 }});
};
