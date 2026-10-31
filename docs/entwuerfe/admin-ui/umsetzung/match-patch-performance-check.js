'use strict';

const assert=require('assert'),fs=require('fs'),path=require('path');
const {assess}=require('./update-performance-budget');

module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=curt.matches.find(match=>match._id==='match-53');
  for(let i=curt.matches.length;i<128;i++){const match=structuredClone(template);match._id='patch-performance-'+i;match.setup.match_num=1000+i;for(const [teamIndex,team]of match.setup.teams.entries())for(const [index,player]of team.players.entries()){player.btp_id=100000+i*10+teamIndex*2+index;player.name='Testperson '+player.btp_id;}curt.matches.push(match);}
  const finished=curt.matches.find(match=>match._id==='match-53');Object.assign(finished,{team1_won:true,btp_winner:1,end_ts:Date.now(),network_score:[[21,15],[21,18]]});Object.assign(finished.setup,{state:'finished',now_on_court:false,court_id:'CH_3'});
  curt.matches=JSON.parse(JSON.stringify(curt.matches));ctournament.ui_show();
  window.__patchPerf={connection:conn(()=>{},crouting.on_change)};
  __patchPerf.settle=()=>new Promise((resolve,reject)=>{let clear=0;const start=performance.now();const frame=()=>{if(performance.now()-start>4000)return reject(new Error('Patch layout did not settle'));clear=cleitstand.isUpdating()||ctournament.isUpdating()?0:clear+1;if(clear===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  __patchPerf.sample=(kind,index)=>new Promise((resolve,reject)=>{
   const id=kind==='finished-result'?'match-53':['preparation-clock','player-check-in','player-name','official-name','location','status'].includes(kind)?'match-45':'match-44',match=structuredClone(curt.matches.find(match=>match._id===id));
   const row=document.querySelector('tr[data-match_id="'+id+'"]'),players=[...row.querySelectorAll('.player')],names=players.map(player=>player.firstChild),score=row.querySelector('.match_score'),clock=row.querySelector('.match_timer .timer'),actions=row.querySelector('.call_td'),call=row.querySelector('.match_preparation_call_button');
   if(kind==='preparation-clock')match.setup.preparation_call_timestamp-=60000;
   else if(kind==='player-check-in')match.setup.teams[0].players[1].checked_in=!match.setup.teams[0].players[1].checked_in;
   else if(kind==='player-name')match.setup.teams[0].players[1].name='Lara Test '+index;
   else if(kind==='official-name')match.setup.umpire.name='Sven Test '+index;
   else if(kind==='location')match.setup.location_id=index%2?'CH':'SN';
   else if(kind==='status'){match.setup.state=index%2?'preparation':'scheduled';match.setup.highlight=index%2?6:0;}
   else if(kind==='finished-result'){match.network_score=[[21,10+index],[21,15]];match.end_ts+=60000;}
   else{match.setup.match_name='Runde '+index;if(kind==='metadata-and-score')match.network_score=[[index+8,9]];}
   const marker=kind+':'+index,timeout=setTimeout(()=>{unsubscribe();reject(new Error('Patch receipt missing: '+marker));},7000);
   const unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__patch_perf!==marker)return;unsubscribe();clearTimeout(timeout);
    try{if(receipt.status!=='presented'||!row.isConnected||players.some((player,index)=>!player.isConnected||player.firstChild!==names[index]))throw new Error('Patch replaced a row or player: '+marker);
     if(kind==='preparation-clock'&&row.querySelector('.match_timer .timer')!==clock)throw new Error('Patch replaced the clock');
     if(['metadata','metadata-and-score'].includes(kind)&&row.querySelector('.match_round').textContent!==match.setup.match_name)throw new Error('Round patch missing');
     if(kind==='player-check-in'&&(row.querySelector('.call_td')!==actions||row.querySelector('.match_preparation_call_button')!==call||players[1].classList.contains('checked_in')!==match.setup.teams[0].players[1].checked_in))throw new Error('Check-in replaced actions or did not update the player');
     if(kind==='metadata-and-score'&&(row.querySelector('.match_score')!==score||score.textContent!==(index+8)+':9'))throw new Error('Score patch missing or replaced');
     if(kind==='player-name'&&players[1].dataset.lsFullName!==match.setup.teams[0].players[1].name)throw new Error('Player name patch missing');
     if(kind==='official-name'&&row.querySelector('.umpire_and_tablet .person:has(.umpire) .name').dataset.lsFullName!==match.setup.umpire.name)throw new Error('Official name patch missing');
     if(kind==='location'&&row.dataset.location_id!==match.setup.location_id)throw new Error('Location patch missing');
     if(kind==='status'&&row.dataset.state!==match.setup.state)throw new Error('Status patch missing');
     if(kind==='finished-result'&&(row.querySelector('.match_score')!==score||!score.textContent.includes('21:'+(10+index))))throw new Error('Finished result correction missing');
     resolve({status:receipt.status,presented_at:receipt.presented_at,timings:receipt.timings});
    }catch(error){reject(error);}
   });
   __patchPerf.connection._test_handle_message({data:JSON.stringify({type:'change',ctype:'match_edit',tournament_key:curt.key,val:{match__id:id,match},__patch_perf:marker})});
  });
 })()`);
 await c.evaluate('__patchPerf.settle()');
 const report={date:'2026-10-31',scope:'128 synthetische Spiele im isolierten Browser; echte Empfangswarteschlange, Darstellungsquittierung nach UI-Arbeit und zwei Browserframes. Keine Live-Dienste.',paths:[]};
 for(const kind of ['metadata','preparation-clock','metadata-and-score','player-check-in','player-name','official-name','location','status','finished-result']) {
  const samples=[];
  for(let index=0;index<3;index++)samples.push(await c.evaluate(`__patchPerf.sample(${JSON.stringify(kind)},${index})`));
  report.paths.push({kind,...assess(samples,'structural'),measurements:samples});
 }
 assert.strictEqual(report.paths.length,9);
 assert(report.paths.every(path=>path.max_ms<500),'Every isolated row-update presentation must finish within 500 ms');
 fs.writeFileSync(path.join(previews,'match-patch-performance-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
};
