'use strict';
/* eslint-disable no-console -- Isolated browser regression and benchmark. */
const assert = require('assert'), fs = require('fs'), path = require('path');

module.exports = async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53')),now=Date.now();
  curt.courts=Array.from({length:15},(_,i)=>({_id:'C'+i,num:String(i+1),location_id:i<13?'CH':'SN',is_active:true,match_id:'refresh-'+i}));
  curt.matches=Array.from({length:584},(_,i)=>{
   const match=structuredClone(template);match._id='refresh-'+i;match.btp_match_ids=[{id:i,draw:1}];
   Object.assign(match.setup,{match_num:i+1,event_name:'JE U17',state:'scheduled',now_on_court:false,highlight:0,scheduled_date:'2026-11-11',scheduled_time_str:'12:00'});
   for(const key of ['court_id','location_id','preparation_call_timestamp','umpire','service_judge','tabletoperators'])delete match.setup[key];
   match.setup.teams.forEach((team,j)=>team.players.forEach((player,k)=>{player.btp_id=20000+i*10+j*2+k;player.name='Alexandra-Johanna Testperson '+player.btp_id;player.firstname='Alexandra-Johanna';player.lastname='Testperson '+player.btp_id;delete player.last_time_on_court_ts;delete player.now_playing_on_court;}));
   if(i<15){Object.assign(match.setup,{state:'oncourt',now_on_court:true,court_id:'C'+i,location_id:i<13?'CH':'SN'});match.network_score=[[5,5]];}
   else if(i<26){match.setup.state='finished';match.team1_won=true;match.network_score=[[21,15],[21,17]];match.end_ts=now-i*60000;}
   return match;
  });
  // Include special results without making any of the ordinary candidates
  // unavailable. Later checks change these relationships in place.
  curt.matches[15].score_status='walkover';curt.matches[16].score_status='no_match';curt.matches[16].no_match_losing_team=0;
  window.__preparationRefresh={};const qa=__preparationRefresh;
  qa.settle=()=>new Promise((resolve,reject)=>{let stable=0;const end=performance.now()+15000;const frame=()=>{if(performance.now()>end)return reject(new Error('Preparation refresh did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.refresh=()=>{const before=performance.now();cmatch.refresh_unassigned_preparation_context(true);return performance.now()-before;};
  qa.row=id=>document.querySelector('.unassigned_container tr[data-match_id="refresh-'+id+'"]');
  qa.buttons=id=>[...qa.row(id).querySelectorAll('.match_preparation_call_button')].map(node=>node.dataset.location_id).sort();
  ctournament.ui_show();
 })()`);
 await c.evaluate('__preparationRefresh.settle()');
 await c.evaluate(`(()=>{
  const diagnostics={};for(let i=26;i<584;i+=4)diagnostics['refresh-'+i]={eligible:true,manual_eligible:true,within_call_window:true,criteria_eligible:true,rules:[]};
  curt.location_preparation_selection_by_location_id={CH:{diagnostics_by_match_id:diagnostics,call_on_court_diagnostics_by_match_id:{}},SN:{diagnostics_by_match_id:{},call_on_court_diagnostics_by_match_id:{}}};
  __preparationRefresh.refresh();
 })()`);
 await c.evaluate('__preparationRefresh.settle()');
 const initial = await c.evaluate('({total:curt.matches.length,open:document.querySelectorAll(".unassigned_container tr[data-match_id]").length,dom:document.querySelectorAll("*").length})');
 assert.strictEqual(initial.total,584);assert.strictEqual(initial.open,558);
 const cases = await c.evaluate(`(async()=>{
  const qa=__preparationRefresh,result={},match=curt.matches[30],special=curt.matches[15],loser=special.setup.teams[1].players[0];
  const refresh=()=>{qa.refresh();return qa.buttons(30).join(',');};
  result.initial=refresh()==='CH,SN';
  match.setup.location_id='CH';result.hall=refresh()==='CH';delete match.setup.location_id;
  match.setup.court_id='C14';result.court=refresh()==='SN';delete match.setup.court_id;
  localStorage.setItem('show_location_courts_SN','false');result.hiddenHall=refresh()==='CH';localStorage.removeItem('show_location_courts_SN');
  match.setup.teams[0].players[0].entries={1:108};result.withdrawal=refresh()==='';delete match.setup.teams[0].players[0].entries;
  delete curt.location_preparation_selection_by_location_id.CH.diagnostics_by_match_id['refresh-30'];
  special.setup.teams[1].players[0]=structuredClone(match.setup.teams[0].players[0]);result.special=refresh()==='';
  special.setup.event_name='JE U19';result.otherDiscipline=refresh()==='CH,SN';special.setup.event_name='JE U17';
  special.setup.teams[1].players[0]=loser;result.specialRemoved=refresh()==='CH,SN';
  const scoreStatus=curt.matches[16],person=scoreStatus.setup.teams[0].players[0];
  scoreStatus.setup.teams[0].players[0]=structuredClone(match.setup.teams[1].players[0]);result.noMatch=refresh()==='';scoreStatus.setup.teams[0].players[0]=person;
  match.setup.teams[0].players[0].now_playing_on_court='C0';result.playing=refresh()==='';delete match.setup.teams[0].players[0].now_playing_on_court;
  const players=match.setup.teams[1].players;match.setup.teams[1].players=[];result.unknown=refresh()==='';match.setup.teams[1].players=players;
  curt.location_preparation_selection_by_location_id.CH.diagnostics_by_match_id['refresh-30']={manual_eligible:false,within_call_window:true,criteria_eligible:false,rules:[]};
  result.denied=refresh()==='SN'&&qa.row(30).classList.contains('preparation_debug_window_blocked');
  curt.location_preparation_selection_by_location_id.CH.diagnostics_by_match_id['refresh-30'].criteria_eligible=true;qa.refresh();result.windowChanged=qa.row(30).classList.contains('preparation_debug_window_ok');
  curt.preparation_call_debug_icons_enabled=true;qa.refresh();const icon=qa.row(30).querySelector('.preparation_debug_icon');qa.refresh();
  result.debugRetained=!!icon&&icon===qa.row(30).querySelector('.preparation_debug_icon');
  curt.preparation_call_debug_icons_enabled=false;qa.refresh();result.debugRemoved=!qa.row(30).querySelector('.preparation_debug_icon');
  delete curt.location_preparation_selection_by_location_id.CH.diagnostics_by_match_id['refresh-30'];qa.refresh();await qa.settle();
  return result;
 })()`);
 assert(Object.values(cases).every(Boolean),'Current halls, withdrawals, special results, players and diagnosis must be respected: '+JSON.stringify(cases));
 const scenarios = [];
 if(process.env.BTS_PREPARATION_PROFILE) {await c.call('Profiler.enable');await c.call('Profiler.setSamplingInterval',{interval:500});await c.call('Profiler.start');}
 for (const incomplete of [false,true]) {
  await c.evaluate(`(()=>{if(${incomplete})for(let i=100;i<530;i++){curt.matches[i].setup.teams[1].players=[];curt.matches[i].setup.incomplete=true;}__preparationRefresh.refresh();})()`);
  await c.evaluate('__preparationRefresh.settle()');
  const times = [];
  for(let round=0;round<12;round++) {
   times.push(await c.evaluate('__preparationRefresh.refresh()'));
   await c.evaluate('__preparationRefresh.settle()');
  }
  scenarios.push({incomplete,times_ms:times,mean_ms:times.reduce((a,b)=>a+b,0)/times.length,max_ms:Math.max(...times)});
 }
 if(process.env.BTS_PREPARATION_PROFILE) fs.writeFileSync(process.env.BTS_PREPARATION_PROFILE,JSON.stringify((await c.call('Profiler.stop')).profile));
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'The browser must not throw');
 const result = {scope:'Isolated native browser, 584 games, 11 finished, 15 active and 558 upcoming. Two scenarios: complete teams and 430 games with an unknown opponent. No live services.',initial,cases,scenarios};
 fs.writeFileSync(process.env.BTS_PREPARATION_REPORT || path.join(previews,'preparation-refresh-verification.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
};
