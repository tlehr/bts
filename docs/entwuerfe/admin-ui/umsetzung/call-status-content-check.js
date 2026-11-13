'use strict';
/* eslint-disable no-console -- Isolated native browser regression. */
const assert = require('assert'), fs = require('fs');
module.exports = async function({c,open}) {
 await open(1920,1080);
 const result = await c.evaluate(`(async()=>{
  const settle=()=>new Promise((resolve,reject)=>{let stable=0;const end=performance.now()+10000;const frame=()=>{if(performance.now()>end)return reject(Error('Status update did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  await settle();
  const row=id=>document.querySelector('.unassigned_container tr[data-match_id="'+id+'"]');
  const buttons=id=>[...row(id).querySelectorAll('.match_preparation_call_button')].map(node=>node.dataset.location_id).sort().join(',');
  const makeRule=()=>({key:'player_pause',passed:false,enabled:true,detail:'Pause bis 12:01'});
  let snapshot={call_status:{epoch:'content-check',revision:1,evaluated_at:1,valid_until:100},selections:curt.locations.map(location=>({
   location_id:location._id,manual_callable_match_ids:['match-48','match-53'],demand_court_ids:[],
   diagnostics_by_match_id:location._id==='CH'?{'match-48':{eligible:false,manual_eligible:true,criteria_eligible:false,within_call_window:true,rules:[{key:'participants_complete',passed:true},makeRule()]}}:{},
   call_on_court_diagnostics_by_match_id:{},
  }))};
  const originalSend=send;window.send=(message,callback)=>message.type==='preparation_selection_get'?setTimeout(()=>callback?.(null,structuredClone(snapshot)),0):originalSend(message,callback);
  const publish=(mutate=()=>{})=>{
   snapshot=structuredClone(snapshot);snapshot.call_status.revision++;snapshot.call_status.evaluated_at++;snapshot.call_status.valid_until++;
   mutate(snapshot.selections);change.default_handler(()=>{throw Error('Status update rebuilt the board')})({ctype:'call_status_changed',tournament_key:'preview',val:structuredClone(snapshot)});
  };
  ctournament.apply_call_status(structuredClone(snapshot),'preview');await settle();
  row('match-48').querySelector('.preparation_debug_icon').click();await settle();
  const dialog=document.querySelector('.ls-call-status-dialog'),details=dialog.querySelector('[data-location-id="CH"] [data-group="automatic"] .ls-call-checks');
  details.open=true;details.querySelector('summary').focus();const focus=document.activeElement;
  const rows=[...document.querySelectorAll('.unassigned_container tr[data-match_id]')];
  const stats={refreshes:0,dialogReads:0,courtUpdates:0,visits:new Set(),mutations:[]};
  const observe=new MutationObserver(records=>stats.mutations.push(...records));
  for(const node of rows){observe.observe(node,{attributes:true,attributeOldValue:true,attributeFilter:['class','data-preparation-callable']});observe.observe(node.querySelector('td.call_td'),{subtree:true,attributes:true,attributeOldValue:true,childList:true,characterData:true,characterDataOldValue:true})}
  observe.observe(dialog,{subtree:true,attributes:true,attributeOldValue:true,childList:true,characterData:true,characterDataOldValue:true});
  const oldRefresh=cmatch.refresh_unassigned_preparation_context,oldStatus=cmatch.get_call_status,oldCourt=cmatch.update_preparation_demand_court_markers,query=Element.prototype.querySelector;
  cmatch.refresh_unassigned_preparation_context=function(...args){stats.refreshes++;return oldRefresh.apply(this,args)};
  cmatch.get_call_status=function(...args){stats.dialogReads++;return oldStatus.apply(this,args)};
  cmatch.update_preparation_demand_court_markers=function(...args){stats.courtUpdates++;return oldCourt.apply(this,args)};
  Element.prototype.querySelector=function(selector){if(this.matches('.unassigned_container tr[data-match_id]'))stats.visits.add(this.dataset.match_id);return query.call(this,selector)};
  const reset=()=>{observe.takeRecords();stats.refreshes=stats.dialogReads=stats.courtUpdates=0;stats.visits.clear();stats.mutations=[]};
  const capture=()=>{
   const records=[...stats.mutations,...observe.takeRecords()],next=new WeakMap();let noops=0;
   for(const record of records.reverse()){
    if(record.type==='childList')continue;
    const key=record.attributeName||record.type,values=next.get(record.target)||new Map(),after=values.has(key)?values.get(key):record.type==='attributes'?record.target.getAttribute(key):record.target.nodeValue;
    if(after===record.oldValue)noops++;values.set(key,record.oldValue);next.set(record.target,values);
   }
   return{refreshes:stats.refreshes,dialog_reads:stats.dialogReads,court_updates:stats.courtUpdates,visited:[...stats.visits].sort(),mutations:records.length,noops};
  };
  const checks={},evidence={};
  try{
   reset();publish();await settle();evidence.equal=capture();checks.equalNoUiWork=stats.refreshes===0&&stats.dialogReads===0&&stats.courtUpdates===0&&evidence.equal.mutations===0;
   checks.metadataAdvanced=curt.call_status.revision===snapshot.call_status.revision&&curt.call_status.valid_until===snapshot.call_status.valid_until;
   reset();publish(selections=>selections[0].manual_callable_match_ids=selections[0].manual_callable_match_ids.filter(id=>id!=='match-53'));await settle();evidence.single=capture();
   checks.singleRowOnly=evidence.single.visited.join(',')==='match-53'&&buttons('match-53')==='SN';checks.foreignDialogSkipped=evidence.single.dialog_reads===0;
   reset();publish(selections=>selections[0].manual_callable_match_ids.push('match-53'));
   publish(selections=>{const diagnosis=selections[0].diagnostics_by_match_id['match-48'];diagnosis.eligible=true;diagnosis.criteria_eligible=true;diagnosis.rules[1].passed=true;diagnosis.rules[1].detail='Pause ist beendet'});
   await settle();evidence.burst=capture();checks.burstKeepsBothGames=evidence.burst.visited.join(',')==='match-48,match-53'&&buttons('match-53')==='CH,SN';
   checks.dialogUpdated=dialog.querySelector('[data-location-id="CH"] [data-group="automatic"] .ls-call-state').dataset.state==='ready'&&dialog.textContent.includes('Pause ist beendet');
   checks.focusAndDetailsRetained=details===dialog.querySelector('[data-location-id="CH"] [data-group="automatic"] .ls-call-checks')&&details.open&&document.activeElement===focus;
   reset();publish(selections=>selections[0].display_cutoff_match_id='match-48');await settle();
   publish(selections=>selections[0].display_cutoff_match_id='match-53');await settle();evidence.boundary=capture();
   checks.boundaryMoved=!!document.querySelector('.ls-call-boundary[data-match-id="match-53"]')&&!document.querySelector('.ls-call-boundary[data-match-id="match-48"]');
   reset();publish(selections=>selections.forEach(selection=>selection.manual_callable_match_ids.reverse()));await settle();evidence.reordered=capture();checks.reorderedSetsNoUiWork=evidence.reordered.refreshes===0&&evidence.reordered.dialog_reads===0&&evidence.reordered.mutations===0;
   reset();publish(selections=>selections[0].demand_court_ids=['CH_1']);await settle();evidence.demand=capture();checks.demandDoesNotVisitGames=evidence.demand.refreshes===0&&evidence.demand.dialog_reads===0&&evidence.demand.court_updates===1;
   checks.rowsRetained=rows.every(node=>node.isConnected);
   checks.noRedundantWrites=Object.values(evidence).every(value=>value.noops===0);
   return {checks,evidence};
  }finally{
   observe.disconnect();cmatch.refresh_unassigned_preparation_context=oldRefresh;cmatch.get_call_status=oldStatus;cmatch.update_preparation_demand_court_markers=oldCourt;Element.prototype.querySelector=query;window.send=originalSend;dialog.close();
  }
 })()`);
 for(const [name,passed] of Object.entries(result.checks))assert.strictEqual(passed,true,name+' '+JSON.stringify(result.evidence));
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Browser must not throw');
 if(process.env.BTS_CALL_STATUS_CONTENT_REPORT)fs.writeFileSync(process.env.BTS_CALL_STATUS_CONTENT_REPORT,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
};
