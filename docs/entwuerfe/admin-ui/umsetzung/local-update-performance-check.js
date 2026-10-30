'use strict';
const {assess}=require('./update-performance-budget');

// Exercise the native scheduled timer callback as well as incoming messages.
// Three consecutive ticks must update the same clock, including its fitted text.
module.exports=async function({c,check,initialize,report,onlyTypes}) {
 const variants={timer_count_up:{upwards:true,duration:0,elapsed:2000},timer_count_down:{upwards:false,duration:120000,elapsed:2000},timer_overdue:{upwards:false,duration:1000,elapsed:2000}};
 for(const [type,variant] of Object.entries(variants)) {
  if(onlyTypes&&!onlyTypes.includes(type))continue;
  const samples=[];
  try {
   await initialize();await c.evaluate(`__perfReset()`);
   const measurements=await c.evaluate(`new Promise((resolve,reject)=>{
    const samples=[],parent=document.createElement('div');parent.className=${JSON.stringify(type)};document.querySelector('[data-board-card="automation"]').append(parent);
    let handle,clock;const values=new Set();const cleanup=()=>{clearTimeout(timeout);unsubscribe();handle?.stop();parent.remove()};
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Missing native timer ticks'))},7000);
    const unsubscribe=btsAdminUpdates.subscribe(receipt=>{
     if(receipt.message.ctype!=='timer_tick'||receipt.message.val.parent_class!==parent.className)return;
     const node=parent.querySelector('.timer'),text=node?.getAttribute('aria-label');
     if(!node||!node.querySelector('.timer-value')||clock&&clock!==node){cleanup();reject(new Error('Native timer failed to update its existing DOM'));return}
     clock=node;values.add(text);samples.push({status:receipt.status,presented_at:receipt.presented_at,timings:receipt.timings});
     if(samples.length===3){cleanup();if(values.size<2)reject(new Error('Native clock text did not advance'));else resolve(samples)}
    },{includeLocal:true});
    handle=cmatch.create_timer({settings:{negative_timers:true},timer:{start:Date.now()-${variant.elapsed},duration:${variant.duration},upwards:${variant.upwards}}},parent,'#ccc','#f00');
   })`);
   samples.push(...measurements);const result=assess(samples,'small');report.paths.push({type,kind:'small',...result,measurements:samples});await check('Laufzeit und UI-Quittierung: '+type,'true');
  }catch(error){report.failures.push({type,message:error.message,samples});console.log('FAIL performance '+type+': '+error.message)}
 }
};
