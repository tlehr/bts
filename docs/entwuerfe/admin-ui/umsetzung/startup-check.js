'use strict';
/* global window, cmatch, ctabletoperator, cumpires, cleitstand, document, ctournament, requestAnimationFrame */
/* eslint-disable no-console -- Isolated startup measurement and regressions. */
const fs=require('fs'),path=require('path'),assert=require('assert');
function startupInstrumentation() {
 window.__startupNetwork=window.location.search.includes('network-start')||document.currentScript?.src.includes('__startup-fixture');
 const qa=window.__startup={started:null,phases:{}};
 qa.wrap=(object,name,label)=>{const original=object?.[name];if(typeof original!=='function')return;object[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{if(qa.started!=null){const entry=qa.phases[label]||={count:0,ms:0,max_ms:0},ms=performance.now()-start;entry.count++;entry.ms+=ms;entry.max_ms=Math.max(entry.max_ms,ms);}}};};
 for(const name of ['prepare_render','render_courts','render_unassigned','render_finished'])qa.wrap(cmatch,name,'matches.'+name);
 qa.wrap(ctabletoperator,'render_unassigned','operators');qa.wrap(cumpires,'ui_status','officials');qa.wrap(cleitstand,'mount','board.mount');
 qa.settle=()=>new Promise((resolve,reject)=>{let stable=0;const deadline=performance.now()+30000;const frame=()=>{if(performance.now()>deadline)return reject(new Error('Startup did not settle'));stable=document.querySelector('.leitstand')&&!cleitstand.isUpdating()&&!ctournament.isUpdating()?stable+1:0;if(stable===1)qa.firstStable=performance.now()-qa.started;if(stable===2)qa.secondStable=performance.now()-qa.started;if(stable===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
 qa.make=template=>{
  const data=window.__startupNetwork?template:window.__startupSnapshot?structuredClone(window.__startupSnapshot):structuredClone(template);
  if(!window.__startupSnapshot&&!window.__startupNetwork){
   // Keep all synthetic results on one date, including when run near midnight.
   const matchTemplate=structuredClone(template.matches.find(match=>match._id==='match-53')),now=Date.UTC(2026,10,9,12),onCourt=data.courts.length,finishedEnd=onCourt+423;
   data.matches=Array.from({length:512},(_,i)=>{
    const match=structuredClone(matchTemplate);match._id='startup-'+i;
    Object.assign(match.setup,{match_num:i+1,state:i<onCourt?'oncourt':i<finishedEnd?'finished':'scheduled',now_on_court:i<onCourt,scheduled_date:'2026-11-09',scheduled_time_str:'12:00'});
    for(const key of ['court_id','location_id','preparation_call_timestamp','umpire','service_judge','tabletoperators'])delete match.setup[key];
    match.setup.teams.forEach((team,j)=>team.players.forEach((player,k)=>Object.assign(player,{btp_id:40000+i*4+j*2+k,name:'Alexandra-Johanna Testperson '+i,firstname:'Alexandra-Johanna',lastname:'Testperson '+i})));
    if(i<onCourt){const court=data.courts[i%data.courts.length];match.setup.court_id=court._id;match.setup.location_id=court.location_id;court.match_id=match._id;match.network_score=[[5,5]];}
    else if(i<finishedEnd){match.team1_won=true;match.btp_winner=1;match.network_score=[[21,15],[21,17]];match.end_ts=now-i*60000;}
    else {delete match.network_score;delete match.team1_won;delete match.end_ts;}
    return match;
   });
   data.btp_enabled=true;data.btp_autofetch_enabled=true;data.btp_autofetch_timeout_intervall=30;
  }
  qa.started=performance.now();qa.ready=qa.settle().then(()=>{qa.total_ms=performance.now()-qa.started;});return data;
 };
}
module.exports=async function({c,open,previews}) {
 const snapshot=process.env.BTS_STARTUP_SNAPSHOT,profiling=process.env.BTS_STARTUP_PROFILE==='1',width=Number(process.env.BTS_STARTUP_WIDTH)||1366;
 if(process.env.BTS_STARTUP_NETWORK==='1'&&!snapshot)throw new Error('BTS_STARTUP_NETWORK requires a local BTS_STARTUP_SNAPSHOT');
 if(process.env.BTS_STARTUP_TRACE)await c.call('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing',options:'sampling-frequency=10000',transferMode:'ReturnAsStream'});
 if(profiling){await c.call('Profiler.enable');await c.call('Profiler.setSamplingInterval',{interval:1000});await c.call('Profiler.start');}
 await open(width,900,{startup:true,
  beforeFixture:async()=>{await c.evaluate('('+startupInstrumentation.toString()+')()');if(snapshot)await c.evaluate('window.__startupSnapshot='+fs.readFileSync(snapshot,'utf8'));},
  transformFixture:source=>source.replace('tournament:structuredClone(fixture)','tournament:__startup.make(fixture)'),
 });
 await c.evaluate('__startup.ready');
 const result=await c.evaluate('(()=>{const q=__startup,nav=performance.getEntriesByType(\'navigation\')[0];return{visible_ms:performance.getEntriesByName("bts-board-visible").at(-1)?.startTime??(__startup.started+__startup.secondStable),total_ms:q.total_ms,navigation_to_ready_ms:q.started+q.total_ms,phases:q.phases,matches:curt.matches.length,courts:curt.courts.length,dom_nodes:document.querySelectorAll(\'*\').length,rendered_results:document.querySelectorAll(\'.ls-finished-table tr[data-match_id]:not([data-ls-deferred])\').length,deferred_results:document.querySelectorAll(\'.ls-finished-table [data-ls-deferred]\').length,game_rows:document.querySelectorAll(\'.ls-match\').length,finished_visible:[...document.querySelectorAll(\'.ls-finished-table .ls-match\')].filter(row=>!row.hidden&&!row.classList.contains(\'ls-date-collapsed\')&&!row.classList.contains(\'ls-history-overflow\')&&!row.classList.contains(\'do_not_show\')).length,main_visible:getComputedStyle(document.querySelector(\'.main\')).display!==\'none\',pending:cleitstand.isUpdating()||ctournament.isUpdating(),navigation:{dom_content_loaded_ms:nav.domContentLoadedEventEnd,load_ms:nav.loadEventEnd,assets:performance.getEntriesByType(\'resource\').length,export_library_requests:performance.getEntriesByType(\'resource\').filter(entry=>entry.name.includes(\'/static/vendor/pdf-lib.min.js\')||entry.name.includes(\'/static/vendor/xlsx.full.min.js\')).length,asset_bytes:performance.getEntriesByType(\'resource\').reduce((sum,r)=>sum+r.transferSize,0)}}})()');
 if(profiling){const profile=await c.call('Profiler.stop');fs.writeFileSync(process.env.BTS_STARTUP_PROFILE_PATH||'/tmp/bts-startup-profile.json',JSON.stringify(profile.profile));}
 if(process.env.BTS_STARTUP_TRACE){await c.call('Tracing.end');let event;while(!(event=c.events.find(event=>event.method==='Tracing.tracingComplete')))await new Promise(resolve=>setTimeout(resolve,20));let out='',part;do{part=await c.call('IO.read',{handle:event.params.stream});out+=part.data;}while(!part.eof);await c.call('IO.close',{handle:event.params.stream});fs.writeFileSync(process.env.BTS_STARTUP_TRACE,out);}
 if(process.env.BTS_STARTUP_RELOADS){const runs=[result];for(let i=0;i<Number(process.env.BTS_STARTUP_RELOADS);i++){if(process.env.BTS_STARTUP_WARM_PROFILE){await c.call('Profiler.enable');await c.call('Profiler.setSamplingInterval',{interval:1000});await c.call('Profiler.start');}await open(width,900,{startup:true,reload:true});if(process.env.BTS_STARTUP_WARM_PROFILE){const profile=await c.call('Profiler.stop');fs.writeFileSync(process.env.BTS_STARTUP_WARM_PROFILE,JSON.stringify(profile.profile));}runs.push(await c.evaluate('({visible_ms:performance.getEntriesByName("bts-board-visible").at(-1)?.startTime??(__startup.started+__startup.secondStable),total_ms:__startup.total_ms,navigation_to_ready_ms:__startup.started+__startup.total_ms,phases:__startup.phases,first_stable_ms:__startup.firstStable,navigation:{load_ms:performance.getEntriesByType("navigation")[0].loadEventEnd,type:performance.getEntriesByType("navigation")[0].type}})'));}fs.writeFileSync(process.env.BTS_STARTUP_RELOADS_PATH||'/tmp/reloads.json',JSON.stringify(runs,null,2));}
 const checks=[],check=(name,ok)=>{assert(ok,name+'\n'+JSON.stringify(result));checks.push(name);};
 check('All 512 games and 50 visible results survive the initial build',result.matches===512&&result.game_rows===512&&result.finished_visible===50);
 check('The main view is visible after all startup work',result.main_visible&&!result.pending);
 const recovery=await c.evaluate('(async()=>{const main=document.querySelector(\'.main\'),display=main.style.getPropertyValue(\'display\'),priority=main.style.getPropertyPriority(\'display\'),mount=cleitstand.mount;main.style.setProperty(\'display\',\'block\',\'important\');let caught=false,restored=false;try{cleitstand.mount=()=>{throw new Error(\'intentional startup failure\');};try{ctournament.ui_show();}catch(error){caught=error.message===\'intentional startup failure\';}restored=main.style.getPropertyValue(\'display\')===\'block\'&&main.style.getPropertyPriority(\'display\')===\'important\';}finally{cleitstand.mount=mount;if(display)main.style.setProperty(\'display\',display,priority);else main.style.removeProperty(\'display\');}ctournament.ui_show();await __startup.settle();return{caught,restored,visible:getComputedStyle(main).display!==\'none\',rows:document.querySelectorAll(\'.ls-match\').length};})()');
 check('A failed build restores prior inline display and priority',recovery.caught&&recovery.restored);
 check('A complete rebuild recovers after failure with every game',recovery.visible&&recovery.rows===512);
 check('No unexpected browser exceptions',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
 const report={scope:snapshot?'Frozen tournament capture; all server calls simulated. No player names or contents are recorded here.':'Synthetic isolated startup with 512 games and 423 finished.',checks,...result};
 const prefix=process.env.BTS_STARTUP_PREFIX||'startup';fs.writeFileSync(path.join(previews,prefix+'-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
};

module.exports.instrumentation=startupInstrumentation;
