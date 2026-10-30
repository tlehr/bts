'use strict';

const assert=require('assert'),fs=require('fs'),path=require('path');
const {assess}=require('./update-performance-budget');

module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=curt.matches.find(match=>match._id==='match-53');
  for(let i=curt.matches.length;i<128;i++){const match=structuredClone(template);match._id='patch-performance-'+i;match.setup.match_num=1000+i;for(const [teamIndex,team]of match.setup.teams.entries())for(const [index,player]of team.players.entries()){player.btp_id=100000+i*10+teamIndex*2+index;player.name='Testperson '+player.btp_id;}curt.matches.push(match);}
  curt.matches=JSON.parse(JSON.stringify(curt.matches));ctournament.ui_show();
  window.__patchPerf={connection:conn(()=>{},crouting.on_change)};
  __patchPerf.settle=()=>new Promise((resolve,reject)=>{let clear=0;const start=performance.now();const frame=()=>{if(performance.now()-start>4000)return reject(new Error('Patch layout did not settle'));clear=cleitstand.isUpdating()||ctournament.isUpdating()?0:clear+1;if(clear===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  __patchPerf.sample=(kind,index)=>new Promise((resolve,reject)=>{
   const id=kind==='preparation-clock'?'match-45':'match-44',match=structuredClone(curt.matches.find(match=>match._id===id));
   const row=document.querySelector('tr[data-match_id="'+id+'"]'),players=[...row.querySelectorAll('.player')],names=players.map(player=>player.firstChild),score=row.querySelector('.match_score'),clock=row.querySelector('.match_timer .timer');
   if(kind==='preparation-clock')match.setup.preparation_call_timestamp-=60000;
   else{match.setup.match_name='Runde '+index;if(kind==='metadata-and-score')match.network_score=[[index+8,9]];}
   const marker=kind+':'+index,timeout=setTimeout(()=>{unsubscribe();reject(new Error('Patch receipt missing: '+marker));},7000);
   const unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__patch_perf!==marker)return;unsubscribe();clearTimeout(timeout);
    try{if(receipt.status!=='presented'||!row.isConnected||players.some((player,index)=>!player.isConnected||player.firstChild!==names[index]))throw new Error('Patch replaced a row or player: '+marker);
     if(kind==='preparation-clock'&&row.querySelector('.match_timer .timer')!==clock)throw new Error('Patch replaced the clock');
     if(kind!=='preparation-clock'&&row.querySelector('.match_round').textContent!==match.setup.match_name)throw new Error('Round patch missing');
     if(kind==='metadata-and-score'&&(row.querySelector('.match_score')!==score||score.textContent!==(index+8)+':9'))throw new Error('Score patch missing or replaced');
     resolve({status:receipt.status,presented_at:receipt.presented_at,timings:receipt.timings});
    }catch(error){reject(error);}
   });
   __patchPerf.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'match_edit',tournament_key:curt.key,val:{match__id:id,match},__patch_perf:marker})});
  });
 })()`);
 await c.evaluate('__patchPerf.settle()');
 const report={date:'2026-10-30',scope:'128 synthetische Spiele im isolierten Browser; echte Empfangswarteschlange, Darstellungsquittierung nach UI-Arbeit und zwei Browserframes. Keine Live-Dienste.',paths:[]};
 for(const kind of ['metadata','preparation-clock','metadata-and-score']) {
  const samples=[];
  for(let index=0;index<3;index++)samples.push(await c.evaluate(`__patchPerf.sample(${JSON.stringify(kind)},${index})`));
  report.paths.push({kind,...assess(samples,'structural'),measurements:samples});
 }
 assert.strictEqual(report.paths.length,3);
 fs.writeFileSync(path.join(previews,'match-patch-performance-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
};
