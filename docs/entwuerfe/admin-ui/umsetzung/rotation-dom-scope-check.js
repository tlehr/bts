'use strict';
/* eslint-disable no-console -- Native rotation DOM retention regression. */
const assert = require('assert'), fs = require('fs');
module.exports = async function({c,open}) {
 await open(1920,1080);
 const result = await c.evaluate(`(async()=>{
  const settle=async()=>{await btsAdminUpdates.whenSettled();for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)};
  const host=document.querySelector('.umpire_container');
  curt.official_rotation_mode='umpire_and_service_judge';
  const person=(id,order)=>({_id:id,name:id,is_umpire:true,is_service_judge:true,umpire_wait:order});
  curt.umpires=[person('dom-official-a',1),person('dom-official-b',2),person('dom-official-c',3)];
  ctournament.render_official_rotation(host);await settle();
  const root=host.firstElementChild,phases=[],card=id=>host.querySelector('.official_card_skin[data-official-id="'+id+'"]');
  const audit=async(name,id,mutate)=>{
   const cards=[...host.querySelectorAll('.official_card_skin')],records=[];
   const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(host,{subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true,characterDataOldValue:true});
   mutate();ctournament.render_official_rotation(host);await settle();records.push(...observer.takeRecords());observer.disconnect();
   let noops=0;const next=new WeakMap();
   for(const record of [...records].reverse()){
    if(record.type==='childList')continue;
    const key=record.attributeName||record.type,values=next.get(record.target)||new Map(),after=values.has(key)?values.get(key):record.type==='attributes'?record.target.getAttribute(key):record.target.nodeValue;
    if(after===record.oldValue)noops++;values.set(key,record.oldValue);next.set(record.target,values);
   }
   const foreign=records.filter(record=>{
    const owner=(record.target.nodeType===1?record.target:record.target.parentElement)?.closest('.official_card_skin');
    return(owner&&owner.dataset.officialId!==id)||[...record.addedNodes,...record.removedNodes].some(node=>node.matches?.('.official_card_skin')&&node.dataset.officialId!==id);
   });
   const phase={name,mutations:records.length,noops,foreign:foreign.length,rootRetained:root===host.firstElementChild,otherCardsRetained:cards.filter(node=>node.dataset.officialId!==id).every(node=>node.isConnected)};
   phases.push(phase);if(noops||foreign.length||!phase.rootRetained||!phase.otherCardsRetained)throw Error(JSON.stringify(phase));
  };
  await audit('identical rotation',null,()=>{});
  await audit('one name','dom-official-a',()=>curt.umpires[0].name='New Name');
  await audit('fresh equal server records',null,()=>curt.umpires=structuredClone(curt.umpires));
  await audit('add one official','dom-official-d',()=>curt.umpires.push(person('dom-official-d',1.5)));
  await audit('move one official to end','dom-official-a',()=>curt.umpires.find(person=>person._id==='dom-official-a').umpire_wait=9);
  await audit('make one official unavailable','dom-official-b',()=>curt.umpires.find(person=>person._id==='dom-official-b').umpire_manual_pause=1);
  const unavailable=card('dom-official-b');
  await audit('remove one official','dom-official-c',()=>curt.umpires=curt.umpires.filter(person=>person._id!=='dom-official-c'));
  const original=send;let message;window.send=(value,callback)=>{message=value;callback?.(null,{})};
  try{card('dom-official-a').querySelector('.official_card_trail').click()}finally{window.send=original}
  const latestRecord=curt.umpires.find(person=>person._id==='dom-official-a');
  const handlersUseLatestRecord=message?.type==='official_roles_edit'&&message.official_id===latestRecord._id&&latestRecord.is_umpire===true&&latestRecord.is_service_judge===false;
  return{phases,unavailableRetained:unavailable.isConnected,handlersUseLatestRecord,pending:btsAdminUpdates.stats()};
 })()`);
 assert(result.phases.filter(phase=>['identical rotation','fresh equal server records'].includes(phase.name)).every(phase=>phase.mutations===0),'Equal records cause no DOM writes');
 assert(result.unavailableRetained&&result.handlersUseLatestRecord,'Retained cards and handlers use current server records');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
 if(process.env.BTS_ROTATION_SCOPE_REPORT)fs.writeFileSync(process.env.BTS_ROTATION_SCOPE_REPORT,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
};
