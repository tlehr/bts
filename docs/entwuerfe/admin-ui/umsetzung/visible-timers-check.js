'use strict';
/* eslint-disable no-console -- Native browser regression check. */
const assert=require('assert');

module.exports=async function({c,open}) {
 await require('./call-status-benchmark')({c,open,afterSetup:async()=>{
  await c.evaluate(`(()=>{
   const qa=window.__visibleTimers={start:Date.now(),handles:[],baseObserved:btsTimerUpdates.stats().observed};
   curt.test_clock={mode:'fixed',fixed_ts:qa.start};
   const parents=[...document.querySelectorAll('.unassigned_container .player')].slice(0,600);
   for(const parent of parents){const state={settings:{negative_timers:false},timer:{start:qa.start,duration:180000}};
    qa.handles.push(cmatch.create_timer(state,parent,'#fff','#fff'));cleitstand.player(parent,{layoutChanged:true});}
   qa.visible=qa.handles[0];qa.hidden=qa.handles.at(-1);
   qa.wait=()=>new Promise(resolve=>setTimeout(resolve,1200));
  })()`);
  await c.evaluate('__statusBench.settle()');await c.evaluate('__visibleTimers.wait()');
  const initial=await c.evaluate('(()=>{const qa=__visibleTimers;qa.before=qa.hidden.element.textContent;return{pending:btsTimerUpdates.stats().pending,observed:btsTimerUpdates.stats().observed,hiddenTop:qa.hidden.element.parentElement.getBoundingClientRect().top,height:innerHeight}})()');
  assert(initial.hiddenTop>initial.height+600,'The test includes clocks outside the preload margin');
  assert(initial.observed>=600&&initial.pending<initial.observed/2,'Unseen clocks stop recurring wakeups: '+JSON.stringify(initial));
  await c.evaluate('curt.test_clock.fixed_ts=__visibleTimers.start+5500;__visibleTimers.wait()');
  assert(await c.evaluate('__visibleTimers.hidden.element.textContent===__visibleTimers.before'),'Unseen clock digits do not mutate');
  assert(await c.evaluate('__visibleTimers.visible.element.textContent.includes("2:55")'),'Visible clocks still follow the current time');
  await c.evaluate('__visibleTimers.pending=btsTimerUpdates.stats().pending;__visibleTimers.hidden.setState({settings:{negative_timers:false},timer:{start:__visibleTimers.start,duration:240000}})');
  assert(await c.evaluate('__visibleTimers.hidden.element.textContent.includes("3:55")&&btsTimerUpdates.stats().pending===__visibleTimers.pending'),'An offscreen game change updates once without starting recurring wakeups');
  await c.evaluate('__visibleTimers.hidden.setState({settings:{negative_timers:false},timer:{start:__visibleTimers.start,duration:180000}})');
  await c.evaluate('__visibleTimers.hidden.element.parentElement.scrollIntoView({block:"center"});__statusBench.settle()');
  assert(await c.evaluate('__visibleTimers.hidden.element.textContent.includes("2:55")'),'Scrolling catches up before the clock is shown');
  await c.evaluate('window.scrollTo(0,0);__statusBench.settle()');
  await c.evaluate('curt.test_clock.fixed_ts=__visibleTimers.start+190000;__visibleTimers.wait()');
  await c.evaluate('__visibleTimers.hidden.element.parentElement.scrollIntoView({block:"center"});__statusBench.settle()');
  assert(await c.evaluate('__visibleTimers.hidden.element.style.display==="none"'),'A clock expired offscreen hides on reentry');
  await c.evaluate('__visibleTimers.hidden.setState({settings:{negative_timers:false},timer:{start:__visibleTimers.start,duration:240000}});__statusBench.settle()');
  assert(await c.evaluate('__visibleTimers.hidden.element.style.display!=="none"&&__visibleTimers.hidden.element.textContent.includes("50")'),'Extending a hidden clock resumes it in the same visible parent');
  await c.evaluate('__visibleTimers.beforeRemoval=btsTimerUpdates.stats().observed;__visibleTimers.hidden.element.remove();__visibleTimers.wait()');
  assert(await c.evaluate('btsTimerUpdates.stats().observed<__visibleTimers.beforeRemoval'),'Detached clock owners are unobserved');
  await c.evaluate('__visibleTimers.handles.forEach(handle=>handle.stop());__statusBench.settle()');
  assert(await c.evaluate('btsTimerUpdates.stats().observed<=__visibleTimers.baseObserved'),'Stopped clocks release every viewport watch');
  assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
  console.log('OK visible timers: offscreen suspension, current visible time, scroll, expiry, extension and cleanup');
 }});
};
