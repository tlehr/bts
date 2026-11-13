'use strict';
/* eslint-disable no-console, quotes -- Native browser checks embed JavaScript scripts. */
const assert=require('assert'),fs=require('fs');
module.exports=async function({c,open}) {
 await require('./call-status-benchmark')({c,open,afterSetup:async()=>{
  await c.evaluate(`(()=>{
   const qa=window.__gameScope={records:[],phases:[],sequence:0};
   qa.inventoryScans=0;qa.restoreInventory=[];
   for(const object of [btp_dns_todos,btp_dsq_todos]){const original=object.collect;object.collect=function(...args){qa.inventoryScans++;return original.apply(this,args)};qa.restoreInventory.push(()=>object.collect=original)}
   qa.settle=__statusBench.settle;
   qa.observe=new MutationObserver(records=>qa.records.push(...records));
   qa.observe.observe(document.querySelector('.leitstand'),{subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true,characterDataOldValue:true});
   qa.connection=conn(()=>{},message=>crouting.on_change(message));
   qa.send=(ctype,val)=>qa.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:'preview',ctype,val})});
   qa.edit=(match,change)=>{const incoming=structuredClone(match);change(incoming);qa.send('match_edit',{match__id:match._id,match:incoming})};
   qa.run=async(name,match,update,{unchanged=false,unchangedBanner=false,structure=false,check=()=>true}={})=>{
    await qa.settle();qa.records.length=0;qa.observe.takeRecords();
    const source=match._id,rows=[...document.querySelectorAll('tr[data-match_id]')],nodes=rows.map(row=>[row,row.dataset.match_id]),beforeInventory=qa.inventoryScans;
    await update();await btsAdminUpdates.whenSettled();await qa.settle();qa.records.push(...qa.observe.takeRecords());
    const nextValues=new WeakMap(),noopRecords=new WeakSet();for(const record of [...qa.records].reverse()){if(record.type==='childList')continue;const name=record.attributeName||record.type,values=nextValues.get(record.target)||new Map(),after=values.has(name)?values.get(name):record.type==='attributes'?record.target.getAttribute(name):record.target.nodeValue;if(after===record.oldValue)noopRecords.add(record);values.set(name,record.oldValue);nextValues.set(record.target,values)}
    const records=qa.records.map(record=>{const element=record.target.nodeType===1?record.target:record.target.parentElement;const row=element?.closest('tr[data-match_id]');return{match:row?.dataset.match_id,type:record.type,attribute:record.attributeName,target:element?.className,old:record.oldValue,warning:!!element?.closest('.manual_btp_stage_status_warning'),noop:noopRecords.has(record)}});
    const foreign=records.filter(record=>record.match&&record.match!==source);
    const foreignMoves=qa.records.filter(record=>record.type==='childList').flatMap(record=>[...record.addedNodes,...record.removedNodes]).filter(node=>node.matches?.('tr[data-match_id]')&&node.dataset.match_id!==source).map(node=>node.dataset.match_id);
    const own=records.filter(record=>record.match===source),noops=own.filter(record=>record.noop),warningMutations=records.filter(record=>record.warning);
    const retained=nodes.every(([row,id])=>(structure&&id===source)||(row.isConnected&&row.dataset.match_id===id));
    const custom=check();
    const inventoryScans=qa.inventoryScans-beforeInventory;
    const inventoryUnchanged=['shuttle count','one location','one preparation deferral','player attendance retains clock and names','official attendance retains role and name','pause deadline retains resource hint and clock','one paired operator attendance leaves aggregate unchanged','paired operator attendance changes aggregate','one paired operator name retains the other member'].includes(name);
    qa.phases.push({name,match:source,own:own.length,warningMutations:warningMutations.length,inventoryScans,noops:noops.length,foreign:foreign.length,foreignMoves,retained,custom,records:own.slice(0,30),noopExamples:noops.slice(0,20),foreignExamples:foreign.slice(0,5)});
    if(inventoryUnchanged&&inventoryScans)throw Error('Unrelated tournament-wide todo scan: '+name+' ('+inventoryScans+')');
    if((unchangedBanner&&warningMutations.length)||noops.length||foreign.length||foreignMoves.length||!retained||!custom||(unchanged&&own.length))throw Error('DOM scope: '+JSON.stringify(qa.phases.at(-1)));
   };
   qa.point=curt.matches[0];qa.target=curt.matches[30];qa.row=()=>document.querySelector('.unassigned_container tr[data-match_id="'+qa.target._id+'"]');
  })()`);
  const phases=[
   `qa.run('point score only',qa.point,()=>qa.send('score',{match_id:qa.point._id,court_id:qa.point.setup.court_id,network_score:[[8,5]],presses:[],now_on_court:true}))`,
   `qa.run('identical point',qa.point,()=>qa.send('score',{match_id:qa.point._id,court_id:qa.point.setup.court_id,network_score:qa.point.network_score,presses:[],now_on_court:true}),{unchanged:true})`,
   `qa.run('unchanged court snapshot',qa.point,()=>qa.send('court_current_match',{match__id:qa.point._id,match:structuredClone(qa.point)}),{unchanged:true})`,
   `qa.run('unchanged court metadata',qa.point,()=>{const court=curt.courts.find(c=>c._id===qa.point.setup.court_id);qa.send('court_changed',{court_id:court._id,is_active:court.is_active,has_umpire:court.has_umpire,has_service_judge:court.has_service_judge,match_id:court.match_id})},{unchanged:true})`,
   `qa.run('unchanged list regrouping',qa.target,()=>{cleitstand.refreshDates(document.querySelector('.unassigned_container'));cleitstand.refreshFinished();cleitstand.refreshCounts()},{unchanged:true})`,
   `qa.run('one player name',qa.target,()=>{qa.opposite=qa.row().querySelector('.team-two');qa.oppositeHTML=qa.opposite.innerHTML;qa.edit(qa.target,m=>Object.assign(m.setup.teams[0].players[0],{name:'Max Changed',firstname:'Max',lastname:'Changed'}))},{check:()=>qa.opposite.isConnected&&qa.opposite.innerHTML===qa.oppositeHTML})`,
   `qa.run('one team participant',qa.target,()=>{qa.opposite=qa.row().querySelector('.team-two');qa.oppositeHTML=qa.opposite.innerHTML;qa.edit(qa.target,m=>Object.assign(m.setup.teams[0].players[0],{btp_id:999001,name:'New Player',firstname:'New',lastname:'Player'}))},{check:()=>qa.opposite.isConnected&&qa.opposite.innerHTML===qa.oppositeHTML})`,
   `qa.run('shuttle count',qa.target,()=>qa.edit(qa.target,m=>m.shuttle_count=3))`,
   `qa.run('server acknowledgement only',qa.target,()=>qa.edit(qa.target,m=>m.btp_needsync=!m.btp_needsync),{unchanged:true})`,
   `qa.run('one game number',qa.target,()=>qa.edit(qa.target,m=>m.setup.match_num=9001))`,
   `qa.run('one event label',qa.target,()=>qa.edit(qa.target,m=>m.setup.event_name='Mixed U21'))`,
   `qa.run('one round label',qa.target,()=>qa.edit(qa.target,m=>m.setup.match_name='Halbfinale'))`,
   `qa.run('one schedule time',qa.target,()=>qa.edit(qa.target,m=>m.setup.scheduled_time_str='18:27'))`,
   `qa.run('one location',qa.target,()=>qa.edit(qa.target,m=>m.setup.location_id='SN'))`,
   `qa.run('one preparation deferral',qa.target,()=>qa.edit(qa.target,m=>m.setup.preparation_call_deferred=true))`,
   `qa.run('identical metadata snapshot',qa.target,()=>qa.edit(qa.target,()=>{}),{unchanged:true})`,
   `qa.run('move one game to the end of the list',qa.target,()=>{qa.oldOrder=qa.target.match_order;qa.edit(qa.target,m=>m.match_order=9999)})`,
   `qa.run('restore one game to its original list position',qa.target,()=>qa.edit(qa.target,m=>m.match_order=qa.oldOrder))`,
  ];
  for(const phase of phases)await c.evaluate('(async()=>{const qa=__gameScope;await '+phase+'})()');
  await c.evaluate(`(async()=>{const qa=__gameScope;qa.edit(qa.target,m=>{Object.assign(m.setup.teams[0].players[0],{check_in_per_match:true,checked_in:false,last_time_on_court_ts:Date.now()-1000});m.setup.umpire={btp_id:999100,name:'Umpire One',checked_in:false}});await btsAdminUpdates.whenSettled();await qa.settle();qa.player=qa.row().querySelector('.team-one .player');qa.timer=qa.player.querySelector('.timer');if(!qa.timer)throw Error('A live player pause clock is required for the retention check');qa.official=qa.row().querySelector('.umpire_and_tablet .person');qa.officialName=qa.official.querySelector('.name');qa.officialIcon=qa.official.querySelector('.umpire')})()`);
  await c.evaluate(`(async()=>{const qa=__gameScope;await qa.run('player attendance retains clock and names',qa.target,()=>qa.edit(qa.target,m=>m.setup.teams[0].players[0].checked_in=true),{check:()=>qa.player.isConnected&&qa.timer===qa.player.querySelector('.timer')&&qa.official.isConnected&&qa.officialName.isConnected&&qa.officialIcon.isConnected});await qa.run('official attendance retains role and name',qa.target,()=>qa.edit(qa.target,m=>m.setup.umpire.checked_in=true),{check:()=>qa.official.isConnected&&qa.officialName===qa.official.querySelector('.name')&&qa.officialIcon===qa.official.querySelector('.umpire')})})()`);
  await c.evaluate(`(async()=>{const qa=__gameScope;qa.edit(qa.target,m=>m.setup.teams[0].players[0].now_playing_on_court='default_9');await btsAdminUpdates.whenSettled();await qa.settle();qa.hint=qa.player.querySelector('.court');qa.timer=qa.player.querySelector('.timer');await qa.run('pause deadline retains resource hint and clock',qa.target,()=>qa.edit(qa.target,m=>m.setup.teams[0].players[0].last_time_on_court_ts+=5000),{check:()=>!!qa.hint&&qa.hint===qa.player.querySelector('.court')&&qa.timer===qa.player.querySelector('.timer')})})()`);
  await c.evaluate(`(async()=>{const qa=__gameScope;qa.edit(qa.target,m=>{delete m.setup.umpire;m.setup.tabletoperators=[{btp_id:99801,name:'Max Alpha',firstname:'Max',lastname:'Alpha',checked_in:false},{btp_id:99802,name:'Sue Bravo',firstname:'Sue',lastname:'Bravo',checked_in:false}]});await btsAdminUpdates.whenSettled();await qa.settle();qa.pair=qa.row().querySelector('.operator-pair');if(!qa.pair)throw Error('Paired tablet operators must be rendered');qa.members=[...qa.pair.querySelectorAll('.pair-member')];await qa.run('one paired operator attendance leaves aggregate unchanged',qa.target,()=>qa.edit(qa.target,m=>m.setup.tabletoperators[0].checked_in=true),{unchanged:true,check:()=>qa.pair.isConnected&&qa.members.every(node=>node.isConnected)});await qa.run('paired operator attendance changes aggregate',qa.target,()=>qa.edit(qa.target,m=>m.setup.tabletoperators[1].checked_in=true),{check:()=>qa.pair.isConnected&&qa.members.every(node=>node.isConnected)});qa.otherMember=qa.members[1].innerHTML;await qa.run('one paired operator name retains the other member',qa.target,()=>qa.edit(qa.target,m=>Object.assign(m.setup.tabletoperators[0],{name:'Tom Alpha',firstname:'Tom'})),{check:()=>qa.pair.isConnected&&qa.members.every(node=>node.isConnected)&&qa.members[1].innerHTML===qa.otherMember})})()`);
  await c.evaluate(`(async()=>{const qa=__gameScope;qa.todos=['Todo A','Todo B'];qa.oldTodos=ctournament.get_registration_main_todos;ctournament.get_registration_main_todos=()=>qa.todos;cmatch.refresh_unassigned_status_context();await qa.settle();qa.warning=document.querySelector('.manual_btp_stage_status_warning');qa.warningEntries=[...qa.warning.querySelectorAll('.manual_btp_stage_status_warning_entry')];await qa.run('unchanged todos retain the entire banner',qa.target,()=>cmatch.refresh_unassigned_status_context(),{unchanged:true,unchangedBanner:true,check:()=>qa.warning.isConnected&&qa.warningEntries.every(node=>node.isConnected)});await qa.run('one todo updates only its text',qa.target,()=>{qa.todos[1]='Todo C';cmatch.refresh_unassigned_status_context()},{check:()=>qa.warning.isConnected&&qa.warningEntries.every(node=>node.isConnected)&&qa.warningEntries[0].textContent==='Todo A'&&qa.warningEntries[1].textContent==='Todo C'});ctournament.get_registration_main_todos=qa.oldTodos})()`);
  await c.evaluate(`(async()=>{const qa=__gameScope;qa.countNodes=[...document.querySelector('[data-field-counts]').children];qa.plannedDateReads=0;for(const row of document.querySelectorAll('.unassigned_container tr[data-match_id]')){const setup=curt.matches.find(match=>match._id===row.dataset.match_id).setup,value=setup.scheduled_date;Object.defineProperty(setup,'scheduled_date',{configurable:true,get(){qa.plannedDateReads++;return value},set(next){Object.defineProperty(setup,'scheduled_date',{value:next,writable:true,configurable:true,enumerable:true})}})}await qa.run('finish retains foreign rows and count badges',qa.point,()=>qa.send('score',{match_id:qa.point._id,court_id:qa.point.setup.court_id,network_score:[[21,5],[21,8]],presses:[],now_on_court:false,state:'finished',team1_won:true,btp_winner:1,end_ts:Date.now()}),{structure:true,check:()=>qa.plannedDateReads===0&&qa.countNodes.every(node=>node.isConnected)&&!document.querySelector('.courts_container tr[data-match_id="'+qa.point._id+'"]')&&!!document.querySelector('.finished_container tr[data-match_id="'+qa.point._id+'"]')})})()`);
  const result=await c.evaluate('(__gameScope.observe.disconnect(),__gameScope.restoreInventory.forEach(restore=>restore()),{phases:__gameScope.phases,errors:__statusErrors,pending:btsAdminUpdates.stats()})');
  assert(!result.errors.length&&!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
  assert(result.phases.length===27&&result.phases.every(phase=>!phase.foreign&&phase.retained&&phase.custom),'Every update is confined to its game and retains unrelated row nodes');
  if(process.env.BTS_DOM_SCOPE_REPORT)fs.writeFileSync(process.env.BTS_DOM_SCOPE_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
 }});
};
