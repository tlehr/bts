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
 check('Only the first 50 results have names, controls and cells at startup',await c.evaluate('__historyPages.rows().filter(row=>row.hasAttribute("data-ls-deferred")).length===100&&__historyPages.rows().filter(row=>row.hasAttribute("data-ls-deferred")).every(row=>row.children.length===0)&&document.querySelectorAll(".finished_container .ls-match-open").length===50'));
 await c.evaluate(`(()=>{
  __historyPages.unseen=document.querySelector('tr[data-match_id="history-149"]');
  const match=structuredClone(curt.matches.find(match=>match._id==='history-149'));
  match.setup.teams[0].players[0].name='Erste unsichtbare Korrektur';match.shuttle_count=4;
  crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
  crouting.on_change({ctype:'score',tournament_key:curt.key,val:{match_id:match._id,network_score:[[21,10],[21,12]],team1_won:true,now_on_court:false,shuttle_count:4}});
  const current=curt.matches.find(match=>match._id==='history-149');current.setup.match_name='Besonderes Finale';cmatch.update_match_metadata(current,['match_name']);
  current.setup.teams[0].players[0].name='Name nach Korrektur';cmatch.update_match_player_names(current);
 })();__historyPages.settle()`);
 check('Score, full-match, metadata and name updates retain an unrendered result without building cells',await c.evaluate('__historyPages.unseen.isConnected&&__historyPages.unseen.hasAttribute("data-ls-deferred")&&__historyPages.unseen.children.length===0&&curt.matches.find(match=>match._id==="history-149").setup.teams[0].players[0].name==="Name nach Korrektur"'));
 await c.evaluate('(()=>{const input=document.querySelector("[data-board-search]");input.value="Name nach Korrektur";input.dispatchEvent(new Event("input",{bubbles:true}));})();__historyPages.settle()');
 check('Searching a corrected hidden name builds only that result with its current score and metadata on the same row',await c.evaluate('__historyPages.visible().length===1&&__historyPages.visible()[0]===__historyPages.unseen&&!__historyPages.unseen.hasAttribute("data-ls-deferred")&&__historyPages.unseen.textContent.includes("Besonderes Finale")&&__historyPages.unseen.querySelector(".match_shuttle_count_number").textContent==="4"&&[...__historyPages.unseen.querySelectorAll(".ls-set-score")].map(node=>node.textContent).join(" ")==="21:10 21:12"&&document.querySelectorAll(".finished_container .ls-match-open").length===51'));
 await c.evaluate('(()=>{const input=document.querySelector("[data-board-search]");input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));})();__historyPages.settle()');
 check('Clearing search retains existing row and player nodes and leaves the other results unrendered',await c.evaluate('__historyPages.visible().length===50&&__historyPages.unseen.isConnected&&document.querySelectorAll(".finished_container [data-ls-deferred]").length===99'));
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
 await c.evaluate(`(()=>{
  const match=structuredClone(curt.matches.find(match=>match._id==='history-148'));
  match.team1_won=null;match.btp_winner=null;match.end_ts=null;match.network_score=[];match.setup.state='scheduled';
  crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
 })();__historyPages.settle()`);
 check('Reopening an unrendered result removes its placeholder and creates one complete scheduled row',await c.evaluate('document.querySelectorAll("tr[data-match_id=history-148]").length===1&&!!document.querySelector(".unassigned_container tr[data-match_id=history-148] .player")&&!document.querySelector("tr[data-match_id=history-148]").hasAttribute("data-ls-deferred")'));
 await c.evaluate(`(()=>{
  const match=structuredClone(curt.matches.find(match=>match._id==='history-148'));
  match.team1_won=true;match.btp_winner=1;match.end_ts=Date.parse('2026-11-06T12:00:00Z');match.network_score=[[21,8],[21,9]];match.setup.state='finished';
  crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
 })();__historyPages.settle()`);
 check('Finishing the reopened game shows the current result once without a stale placeholder',await c.evaluate('document.querySelectorAll("tr[data-match_id=history-148]").length===1&&[...document.querySelectorAll(".finished_container tr[data-match_id=history-148] .ls-set-score")].map(node=>node.textContent).join(" ")==="21:8 21:9"'));
 await c.evaluate('(()=>{const match=curt.matches.find(match=>match._id===\'history-149\');cmatch.remove_match_from_gui(match,\'finished\');})();__historyPages.settle()');
 check('Removing an unrendered result removes its indexed placeholder',await c.evaluate('!document.querySelector("tr[data-match_id=history-149]")'));
 // Ordinary result arrivals may replace the visible page repeatedly. Release
 // only off-page contents, while retaining every indexed row and current model.
 await c.evaluate('__historyPages.click("Nur 50 anzeigen")');
 await c.evaluate(`(()=>{
  const button=document.querySelector('.ls-finished-table [data-sort-key="end"]');button.click();button.click();
 })();__historyPages.settle()`);
 await c.evaluate(`(async()=>{
  const qa=__historyPages;qa.retainedRows=qa.rows();
  const template=structuredClone(curt.matches.find(match=>match._id==='history-0'));
  const last=Math.max(...curt.matches.map(match=>Number(match.end_ts)||0));
  qa.materialized=[];
  for(let i=0;i<20;i++) {
   const match=structuredClone(template);match._id='new-result-'+i;match.setup.match_num=1000+i;match.end_ts=last+(i+1)*1000;
   crouting.on_change({ctype:'match_add',tournament_key:curt.key,val:{match}});
   await qa.settle();
   qa.materialized.push(qa.rows().filter(row=>!row.hasAttribute('data-ls-deferred')).length);
  }
 })()`);
 check('Twenty further results keep exactly 50 complete history rows and retain every older indexed row',await c.evaluate('__historyPages.materialized.every(count=>count===50)&&__historyPages.retainedRows.every(row=>row.isConnected)'));
 await c.evaluate(`(()=>{
  const qa=__historyPages;qa.released=qa.rows().find(row=>row.hasAttribute('data-ls-deferred'));
  const match=structuredClone(curt.matches.find(match=>match._id===qa.released.dataset.match_id));
  match.setup.teams[0].players[0].name='KorrigiertesArchivErgebnis';match.network_score=[[21,6],[21,7]];
  crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});
 })();__historyPages.settle()`);
 check('A released result still accepts full score and name corrections without creating hidden controls',await c.evaluate('__historyPages.released.isConnected&&__historyPages.released.children.length===0&&__historyPages.released.hasAttribute("data-ls-deferred")'));
 await c.evaluate('(()=>{const input=document.querySelector(\'[data-board-search]\');input.value=\'KorrigiertesArchivErgebnis\';input.dispatchEvent(new Event(\'input\',{bubbles:true}));})();__historyPages.settle()');
 check('Revealing a released result reconstructs the corrected data on its original row',await c.evaluate('__historyPages.visible().length===1&&__historyPages.visible()[0]===__historyPages.released&&__historyPages.released.textContent.includes("KorrigiertesArchivErgebnis")&&[...__historyPages.released.querySelectorAll(".ls-set-score")].map(node=>node.textContent).join(" ")==="21:6 21:7"'));
 check('History pages leave no incomplete work or browser exceptions',await c.evaluate('!cleitstand.isUpdating()&&document.querySelectorAll(".ls-layout-probe").length===0')&&!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
 fs.writeFileSync(path.join(previews,'history-pages-verification.json'),JSON.stringify({scope:'Isolated browser with 150 synthetic results on two dates; pagination, search, updates, sorting, date expansion, row identity, unrendered score/name/metadata corrections, section changes, removal and reload persistence.',checks},null,2)+'\n');
};
