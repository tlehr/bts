'use strict';
/* eslint-disable no-console -- Isolated browser regression checks. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 const setup=`(()=>{
  const template=structuredClone(curt.matches.find(match=>match._id==='match-53'));
  curt.matches=Array.from({length:150},(_,i)=>{
   const match=structuredClone(template);match._id='history-'+i;match.setup.match_num=i+1;
   Object.assign(match.setup,{state:'finished',now_on_court:false,scheduled_date:'2026-11-06',scheduled_time_str:'12:00'});
   delete match.setup.umpire;delete match.setup.service_judge;delete match.setup.tabletoperators;
   match.setup.teams.forEach((team,j)=>team.players.forEach((player,k)=>{player.btp_id=10000+i*10+j*2+k;player.name='Spielerin '+i+' '+j+' '+k;player.firstname='Spielerin';player.lastname=String(i)+' '+j+' '+k;delete player.last_time_on_court_ts;}));
   match.team1_won=true;match.btp_winner=1;match.network_score=[[21,15],[21,17]];match.end_ts=Date.parse(i<100?'2026-11-06T12:00:00Z':'2026-11-05T12:00:00Z')-i*1000;
   return match;
  });
  ctournament.ui_show();
  const qa=window.__historyPages={};
  qa.settle=()=>new Promise((resolve,reject)=>{let stable=0;const end=performance.now()+8000;const frame=()=>{if(performance.now()>end)return reject(new Error('History pagination did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  qa.rows=()=>[...document.querySelectorAll('.finished_container tr[data-match_id]')];
  qa.visible=()=>qa.rows().filter(row=>!row.hidden&&!row.classList.contains('ls-date-collapsed')&&!row.classList.contains('ls-history-overflow'));
  qa.click=async(label)=>{[...document.querySelectorAll('.ls-history-pages button')].find(button=>button.textContent===label).click();await qa.settle();};
 })()`;
 await open(1920,1080);await c.evaluate(setup);await c.evaluate('__historyPages.settle()');
 const checks=[],check=(name,value)=>{assert(value,name);checks.push(name);console.log('OK '+name);};
 check('The initial history retains all 150 results and displays 50 of the current day',await c.evaluate('__historyPages.rows().length===150&&curt.matches.length===150&&__historyPages.visible().length===50'));
 const nodes=await c.evaluate('__historyPages.original=__historyPages.rows();true');assert(nodes);
 await c.evaluate('__historyPages.click("Weitere 50 anzeigen")');
 check('More results reveal the remaining current-day games on the same rows',await c.evaluate('__historyPages.visible().length===100&&__historyPages.rows().every((row,index)=>row===__historyPages.original[index])'));
 await c.evaluate('__historyPages.click("Nur 50 anzeigen")');
 check('The reduced view can be restored',await c.evaluate('__historyPages.visible().length===50'));
 await c.evaluate('(()=>{const input=document.querySelector("[data-board-search]");input.value="Spielerin 125";input.dispatchEvent(new Event("input",{bubbles:true}));})()');await c.evaluate('__historyPages.settle()');
 check('Search finds a result beyond the initial page and from a collapsed day',await c.evaluate('__historyPages.visible().length===1&&__historyPages.visible()[0].dataset.match_id==="history-125"'));
 await c.evaluate('(()=>{const input=document.querySelector("[data-board-search]");input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));})()');await c.evaluate('__historyPages.settle()');
 check('Clearing search restores the reduced view',await c.evaluate('__historyPages.visible().length===50'));
 await c.evaluate('document.querySelector(\'.finished_container .ls-date-row[data-date="2026-11-05"] button\').click();__historyPages.settle()');
 check('Opening another day reveals its first results instead of an empty group',await c.evaluate('__historyPages.visible().some(row=>row.dataset.match_id==="history-100")'));
 await c.evaluate('__historyPages.click("Nur 50 anzeigen")');
 await c.evaluate('crouting.on_change({ctype:"score",tournament_key:curt.key,val:{match_id:"history-149",network_score:[[21,10],[21,12]],team1_won:true,now_on_court:false}});__historyPages.settle()');
 await c.evaluate('__historyPages.click("Alle anzeigen")');
 check('A result updated outside the visible page retains its current score when shown',await c.evaluate('[...document.querySelectorAll(\'tr[data-match_id="history-149"] .ls-set-score\')].map(node=>node.textContent).join(" ")==="21:10 21:12"&&__historyPages.visible().length===150'));
 await c.evaluate('document.querySelector(\'.ls-finished-table [data-sort-key="number"]\').click();__historyPages.settle()');
 check('Sorting still includes all results',await c.evaluate('JSON.stringify(__historyPages.rows().map(row=>row.dataset.match_id))===JSON.stringify(Array.from({length:150},(_,i)=>"history-"+i))'));
 // A real page navigation recreates the modules and must retain the user's choice.
 await open(1920,1080);await c.evaluate(setup);await c.evaluate('__historyPages.settle()');
 check('The all-results preference survives a page reload',await c.evaluate('__historyPages.visible().length===100'));
 check('History pages leave no incomplete work or browser exceptions',await c.evaluate('!cleitstand.isUpdating()&&document.querySelectorAll(".ls-layout-probe").length===0')&&!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
 fs.writeFileSync(path.join(previews,'history-pages-verification.json'),JSON.stringify({scope:'Isolated browser with 150 synthetic results on two dates; pagination, search, updates, sorting, date expansion, row identity and reload persistence.',checks},null,2)+'\n');
};
