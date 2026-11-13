'use strict';
/* eslint-disable no-console -- Isolated queue publication and browser regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,previews}) {
 const {messages}=await require('../../../../test/test_tablet_queue_publication').assignmentMessages();
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.__queueErrors=[];window.addEventListener("error",event=>{if(event instanceof ErrorEvent)__queueErrors.push(event.message);});'});
 await open(1920,1080);
 await c.evaluate(`(()=>{
  window.__queueQA={rows:[...document.querySelectorAll('.courts_container tr[data-match_id]')]};
  curt.tabletoperators=[{_id:'queue-one',court:null,start_ts:1,tabletoperator:[{btp_id:990001,name:'Wartetest 0'}]},{_id:'queue-two',court:null,start_ts:2,tabletoperator:[{btp_id:990002,name:'Wartetest 1'}]}];
  ctabletoperator.render_unassigned(document.querySelector('.unassigned_tableoperators_container'));
  const matches=curt.matches.filter(match=>match.setup.now_on_court).slice(0,2);
  matches.forEach((match,index)=>{const incoming=structuredClone(match);incoming.setup.tabletoperators=[{btp_id:990001+index,name:'Wartetest '+index,firstname:'Wartetest',lastname:String(index)}];crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match:incoming}});});
  __queueQA.connection=conn(()=>{},message=>crouting.on_change(message));
  __queueQA.settle=()=>new Promise((resolve,reject)=>{let stable=0;const deadline=performance.now()+8000;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Queue browser did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()||__queueQA.connection._test_change_queue_length()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
 })()`);
 const retention=await c.evaluate(`(async()=>{
  const container=document.querySelector('.unassigned_tableoperators_container'),form=container.querySelector('form'),input=form.querySelector('.tabletoperator_add_custom_input'),rows=[...container.querySelectorAll('tbody>tr')],other=rows[1],firstName=rows[0].querySelector('.operators .person>span');
  input.value='Unfinished input';input.focus();input.setSelectionRange(3,7);await __queueQA.settle();cmatch.hide_tabletoperator_pickers(container);
  const audit=async(change)=>{
   const records=[],observer=new MutationObserver(batch=>records.push(...batch));observer.observe(container,{subtree:true,childList:true,attributes:true,characterData:true});
   change();ctabletoperator.render_unassigned(container);await __queueQA.settle();records.push(...observer.takeRecords());observer.disconnect();
   return{mutations:records.length,foreign:records.filter(record=>(record.target.nodeType===1?record.target:record.target.parentElement)?.closest('tr')===other).length,retained:rows.every(row=>row.isConnected)&&firstName.isConnected&&form.isConnected&&document.activeElement===input&&input.value==='Unfinished input'&&input.selectionStart===3&&input.selectionEnd===7};
  };
  // First validate the retained input; observe only the following equal render.
  ctabletoperator.render_unassigned(container);await __queueQA.settle();
  const same=await audit(()=>{}),name=await audit(()=>curt.tabletoperators[0].tabletoperator[0].name='Renamed Operator');
  const pair=await audit(()=>curt.tabletoperators[0].tabletoperator.push({btp_id:990003,name:'Partner'}));
  const single=await audit(()=>curt.tabletoperators[0].tabletoperator.pop());
  input.value='';input.blur();return{same,name,pair,single};
 })()`);
 assert(retention.same.mutations===0&&Object.values(retention).every(phase=>phase.foreign===0&&phase.retained),'Queue updates retain other entries, names, form, focus and input: '+JSON.stringify(retention));
 await c.evaluate(`(()=>{for(const message of ${JSON.stringify(messages)})__queueQA.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:curt.key,...message})});return __queueQA.settle();})()`);
 const queue=await c.evaluate('({waiting:document.querySelectorAll(\'.tabletoperators_table tbody>tr\').length,count:document.querySelector(\'.operator-count\').textContent,active:[...document.querySelectorAll(\'.courts_container .tablet_operator\')].filter(node=>node.textContent.includes(\'Wartetest\')).length,retained:__queueQA.rows.every(row=>row.isConnected),modelWaiting:curt.tabletoperators.filter(entry=>entry.court==null).length})');
 assert(queue.waiting===0&&queue.count==='0'&&queue.modelWaiting===0&&queue.active===2&&queue.retained,'Assigned operators appear on their courts and leave the waiting list: '+JSON.stringify(queue));
 // Exercise the sidebar arrangement from the report as well as width/density changes.
 await c.evaluate('(()=>{document.querySelector(\'[data-action="layout-edit"]\').click();for(const id of [\'automation\',\'rotation\',\'logs\',\'tablets\'])document.querySelector(\'[data-board-card="\'+id+\'"] [data-action="layout-card-zone"]\').click();document.querySelector(\'[data-board-card="device"] [data-action="layout-card-hide"]\').click();document.querySelector(\'[data-layout-editor] [data-action="layout-edit"]\').click();return __queueQA.settle();})()');
 for(const [width,height]of [[1366,768],[1920,1080],[3840,2160],[900,700]]){
  await metrics(width,height);await c.evaluate('__queueQA.settle()');
  for(let i=0;i<3;i++)await c.evaluate('document.querySelector("[data-action=density]").click();__queueQA.settle()');
 }
 const errors=await c.evaluate('__queueErrors');
 const report={scope:'Real staged in-memory queue publications applied through the native browser receive queue. Synthetic participants, no live writes.',messages:messages.map(message=>({type:message.ctype,id:message.val.tabletoperator._id,court:message.val.tabletoperator.court})),retention,queue,errors};
 fs.writeFileSync(path.join(previews,'tablet-queue-live-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));assert(errors.length===0,'No native window errors during queue, sidebar, viewport and density updates');
};
