'use strict';
/* eslint-disable no-console -- Native browser timer lifecycle regression. */
const assert = require('assert');

module.exports = async function({c, open}) {
 const transformFixture = source => source.replace('fixture.preparation_call_debug_icons_enabled=true;', `
  fixture.preparation_call_debug_icons_enabled=true;fixture.test_clock={mode:'fixed',fixed_ts:now};
  const countdownMatch=fixture.matches.find(match=>match._id==='match-36');
  countdownMatch.network_score=[];
  Object.assign(countdownMatch.setup,{warmup:'call-down',warmup_start:180,warmup_ready:120,called_timestamp:now-10000});
  const intervalMatch=fixture.matches.find(match=>match._id==='match-44');
  intervalMatch.presses=[{type:'pick_side',team1_left:true},{type:'pick_server',team_id:0,player_id:0},
   {type:'pick_receiver',team_id:1,player_id:0},{type:'love-all'},...Array.from({length:11},()=>({type:'score',side:'left'}))]
   .map(press=>({...press,timestamp:now-10000}));
  fixture.matches.find(match=>match._id==='match-48').setup.teams[0].players[0]={btp_id:99001,
   name:'Timer Pause',firstname:'Timer',lastname:'Pause',checked_in:true,check_in_per_match:true,last_time_on_court_ts:now-30000};
 `);
 for (const reload of [false, true]) {
  await open(1920, 1080, {reload, transformFixture});
  await c.evaluate(`(async()=>{
   await new Promise(resolve=>{const frame=()=>cleitstand.isUpdating()||ctournament.isUpdating()?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame)});
   const qa=window.__timerReload={clocks:[],start:curt.test_clock.fixed_ts};
   for(const [id,kind]of [['match-41','call-up'],['match-36','call-down'],['match-44','interval'],['match-45','preparation'],['match-46','preparation']]) {
    const match=curt.matches.find(match=>match._id===id),row=document.querySelector('tr[data-match_id="'+id+'"]');
    const element=row?.querySelector('.match_timer .timer');
    const state=kind==='preparation'?{settings:{negative_timers:false},timer:{start:match.setup.preparation_call_timestamp,upwards:true}}:cmatch._extract_match_timer_state(match);
    if(!element||!state)throw Error('Missing '+kind+' clock for '+id);
    qa.clocks.push({id,kind,element,state,before:element.getAttribute('aria-label')||element.textContent});
   }
   const player=curt.matches.find(match=>match._id==='match-48').setup.teams[0].players[0];
   const element=document.querySelector('tr[data-match_id="match-48"] .player[data-btp_id="99001"] .timer');
   if(!element)throw Error('Missing player pause clock');
   qa.clocks.push({id:'99001',kind:'player pause',element,before:element.getAttribute('aria-label')||element.textContent,
    state:{settings:{negative_timers:false},timer:{start:player.last_time_on_court_ts,duration:curt.btp_settings.pause_duration_ms}}});
   qa.sample=()=>qa.clocks.map(({id,kind,element,state,before})=>{
    const value=timer.calc(state,curt.test_clock.fixed_ts),str=String(value.str);
    return{id,kind,before,connected:element.isConnected,visible:element.style.display!=='none',expectedVisible:value.visible,
     actual:element.getAttribute('aria-label')||element.textContent,
     expected:/^\\d+$/.test(str)?Math.floor(Number(str)/60)+':'+String(Number(str)%60).padStart(2,'0'):str};
   });
   await new Promise(resolve=>setTimeout(resolve,1200));
   curt.test_clock.fixed_ts+=5000;
   await new Promise(resolve=>setTimeout(resolve,1300));
  })()`);
  const samples = await c.evaluate('__timerReload.sample()');
  assert(samples.every(sample => sample.connected && sample.before !== sample.expected), 'All clocks must survive rendering and have elapsed time');
  assert(samples.every(sample => sample.actual === sample.expected && sample.visible === sample.expectedVisible),
   'Initial and reloaded clocks keep ticking without incoming messages: ' + JSON.stringify({reload, samples}));
  await c.evaluate('curt.test_clock.fixed_ts+=120000;new Promise(resolve=>setTimeout(resolve,1300))');
  const expired = await c.evaluate('__timerReload.sample()');
  assert(expired.every(sample => sample.actual === sample.expected && sample.visible === sample.expectedVisible),
   'Countdown expiry and overdue clocks remain correct: ' + JSON.stringify({reload, expired}));
  console.log('OK timer '+(reload ? 'reload' : 'initial load')+': call-up, call-down, interval, preparation and player pause clocks tick, expire and show overdue time without incoming messages');
 }
 await c.evaluate(`(async()=>{
  const qa=__timerReload;qa.board=document.querySelector('.leitstand');qa.otherRow=document.querySelector('tr[data-match_id="match-44"]');
  qa.connection=conn(()=>{},crouting.on_change);
  qa.settle=()=>new Promise((resolve,reject)=>{const deadline=performance.now()+5000;const frame=()=>{
   if(performance.now()>deadline)return reject(Error('Live countdown update did not settle'));
   if(qa.connection._test_change_queue_length()||cleitstand.isUpdating()||ctournament.isUpdating())requestAnimationFrame(frame);
   else resolve();
  };requestAnimationFrame(frame)});
  qa.receive=(type,match)=>qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:type,
   tournament_key:curt.key,val:{match__id:match._id,match}})});
  const called=structuredClone(curt.matches.find(match=>match._id==='match-48'));
  called.presses=[];called.network_score=[];
  Object.assign(called.setup,{state:'oncourt',now_on_court:true,court_id:'CH_4',location_id:'CH',highlight:0,
   warmup:'call-down',warmup_start:180,warmup_ready:120,called_timestamp:curt.test_clock.fixed_ts});
  qa.receive('court_current_match',called);await qa.settle();await btsAdminUpdates.whenSettled();
  const element=document.querySelector('.courts_container tr[data-match_id="match-48"] .match_timer .timer');
  if(!element)throw Error('Missing countdown immediately after calling a game');
  qa.live={element,state:cmatch._extract_match_timer_state(called),before:element.getAttribute('aria-label')};
  await new Promise(resolve=>setTimeout(resolve,1200));
  curt.test_clock.fixed_ts+=5000;await new Promise(resolve=>setTimeout(resolve,1300));
 })()`);
 const live = await c.evaluate(`(()=>{const qa=__timerReload;return{
  initial:qa.live.before,actual:qa.live.element.getAttribute('aria-label'),sameClock:qa.live.element===document.querySelector('.courts_container tr[data-match_id="match-48"] .timer'),
  sameBoard:qa.board===document.querySelector('.leitstand'),otherRowRetained:qa.otherRow===document.querySelector('tr[data-match_id="match-44"]')
 }})()`);
 assert(live.initial === '3:00' && live.actual === '2:55' && live.sameClock && live.sameBoard && live.otherRowRetained,
  'A newly called countdown starts ticking immediately without a page reload or row rebuild: ' + JSON.stringify(live));
 await c.evaluate(`(async()=>{
  const qa=__timerReload,match=structuredClone(curt.matches.find(match=>match._id==='match-48'));
  qa.receive('match_edit',match);await qa.settle();await btsAdminUpdates.whenSettled();
  curt.test_clock.fixed_ts+=116000;await new Promise(resolve=>setTimeout(resolve,1300));
 })()`);
 assert(await c.evaluate('__timerReload.live.element.getAttribute("aria-label")==="0:59"&&__timerReload.live.element.classList.contains("timer_exigent")'),
  'A following server update preserves the countdown and its configured warning threshold');
 console.log('OK live court call: countdown ticks from 3:00 to 2:55 without a reload, retains its element and enters warning at 0:59');
 assert(!c.events.some(event => event.method === 'Runtime.exceptionThrown'), 'No browser exceptions');
};
