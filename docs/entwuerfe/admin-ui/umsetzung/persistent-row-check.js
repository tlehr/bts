'use strict';
const fs=require('fs'),path=require('path');

module.exports=async function({c,check,open,previews}) {
 const checks=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=window.__persistentRows={measurements:[]};qa.row=document.querySelector('.unassigned_container tr[data-match_id="match-45"]');qa.cells=[...qa.row.cells];qa.score=qa.row.querySelector('.match_score');qa.calls=qa.row.querySelector('.call_td');qa.open=qa.row.querySelector('.ls-match-open');
  qa.players=[...qa.row.querySelectorAll('.player')];qa.names=qa.players.map(node=>node.firstChild);qa.umpire=qa.row.querySelector('.umpire_and_tablet .person:has(.umpire)');qa.judge=qa.row.querySelector('.umpire_and_tablet .person:has(.service_judge)');
  qa.connection=conn(()=>{},crouting.on_change);
  qa.send=(ctype,val)=>new Promise((resolve,reject)=>{const marker='persistent:'+performance.now();const timeout=setTimeout(()=>{unsubscribe();reject(new Error('Missing presentation receipt'));},7000);const unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__persistent!==marker)return;unsubscribe();clearTimeout(timeout);if(receipt.status!=='presented')return reject(new Error(receipt.error||receipt.status));qa.measurements.push({ctype,timings:receipt.timings});resolve(receipt);});qa.connection._test_handle_message({data:JSON.stringify({type:'change',ctype,tournament_key:'preview',val,__persistent:marker})});});
  qa.update=(code,id='match-45')=>{const match=structuredClone(curt.matches.find(match=>match._id===id));new Function('match',code)(match);return qa.send('match_edit',{match__id:match._id,match});};
  qa.guard=id=>{const row=document.querySelector('tr[data-match_id="'+id+'"]'),cells=[...row.cells],players=[...row.querySelectorAll('.player')],texts=players.map(player=>player.firstChild),score=row.querySelector('.match_score');Object.defineProperty(row,'innerHTML',{get(){return ''},set(){throw new Error('Existing game row was rebuilt: '+id)}});return{row,cells,players,same:()=>row.isConnected&&row.cells.length>=cells.length&&cells.every((cell,index)=>row.cells[index]===cell)&&row.querySelector('.match_score')===score,people:()=>players.every((player,index)=>player.isConnected&&player.firstChild===texts[index])};};
  qa.same=()=>qa.row.isConnected&&qa.cells.length===qa.row.cells.length&&qa.cells.every((cell,index)=>qa.row.cells[index]===cell)&&qa.row.querySelector('.match_score')===qa.score&&qa.row.querySelector('.call_td')===qa.calls&&qa.row.querySelector('.ls-match-open')===qa.open;
  Object.defineProperty(qa.row,'innerHTML',{get(){return ''},set(){throw new Error('Existing row was rebuilt')}});
 })()`);
 const steps=[
  ['Unknown bookkeeping','match.setup.extra_dependency="kept"'],
  ['Round and discipline','match.setup.match_name="Finale";match.setup.event_name="JE U19"'],
  ['Player rename','match.setup.teams[0].players[1].name="Lara Neuername";match.setup.teams[0].players[1].lastname="Neuername"'],
  ['Player entry status','match.setup.teams[0].entry_status="DNS"'],
  ['Cleared player entry status','delete match.setup.teams[0].entry_status'],
  ['Umpire check-out','match.setup.umpire.checked_in=false'],
  ['Umpire rename','match.setup.umpire.name="Sven Neuername"'],
  ['Umpire replacement','match.setup.umpire={btp_id:9010,name:"Neue Schiedsrichterin",checked_in:true}'],
  ['Judge removal','delete match.setup.service_judge'],
  ['Judge addition','match.setup.service_judge={btp_id:9011,name:"Neue Aufschlagrichterin",checked_in:false}'],
  ['Tablet pairing addition','match.setup.tabletoperators=[{btp_id:9012,name:"Tablet Eins",checked_in:true},{btp_id:9013,name:"Tablet Zwei",checked_in:false}]'],
  ['Tablet pairing check-in','match.setup.tabletoperators.forEach(person=>person.checked_in=true)'],
  ['Tablet pairing replacement','match.setup.tabletoperators=[{btp_id:9014,name:"Tablet Ersatz",checked_in:false}]'],
  ['Tablet removal','match.setup.tabletoperators=[]'],
  ['Location change','match.setup.location_id="SN"'],
  ['Court change','match.setup.court_id="CH_12";match.setup.location_id="CH"'],
  ['Deferred status','match.setup.state="scheduled";match.setup.preparation_call_deferred=true;match.setup.highlight=0'],
  ['Preparation restored','match.setup.state="preparation";delete match.setup.preparation_call_deferred;match.setup.highlight=6'],
  ['Appearance override','match.setup.override_colors={bg1:"#fff000",fg1:"#000000",bg2:"#00ff00",fg2:"#000000"}'],
  ['Score and timer change','match.network_score=[[5,4]];match.setup.preparation_call_timestamp=Date.now()-60000'],
 ];
 for(const [name,code]of steps){
  await c.evaluate(`__persistentRows.update(${JSON.stringify(code)})`);await verify(name+' preserves the row and every existing cell','__persistentRows.same()');
  if(name==='Player entry status')await verify('DNS blocks the existing participants and call controls','__persistentRows.row.querySelectorAll(".team-one .entry_blocked .btp_entry_status_badge").length===2&&!__persistentRows.row.querySelector(".match_preparation_call_button")');
  if(name==='Cleared player entry status')await verify('Clearing DNS restores the existing participants without stale badges','!__persistentRows.row.querySelector(".team-one .entry_blocked,.team-one .btp_entry_status_badge")');
 }
 await verify('Renames, participant status and role updates retain all original player and name objects','__persistentRows.players.every((node,index)=>node.isConnected&&node.firstChild===__persistentRows.names[index])');
 await verify('The renamed player and replaced officials show the current values',`__persistentRows.row.querySelector('.player[data-btp_id="35"]').dataset.lsFullName==='Lara Neuername'&&__persistentRows.row.querySelector('.person[data-btp_id="9010"] .name').dataset.lsFullName==='Neue Schiedsrichterin'&&__persistentRows.row.querySelector('.person[data-btp_id="9011"] .name').dataset.lsFullName==='Neue Aufschlagrichterin'`);
 await c.evaluate(`__persistentRows.update(${JSON.stringify('match.setup.teams[0].players[0]={btp_id:9020,name:"Neue Spielerin",firstname:"Neue",lastname:"Spielerin",check_in_per_match:true,checked_in:false}')})`);
 await verify('Replacing one participant preserves the partner, opposing players and every cell', '__persistentRows.same()&&__persistentRows.players.slice(1).every(node=>node.isConnected)&&!!__persistentRows.row.querySelector(\'.player[data-btp_id="9020"]\')');
 await c.evaluate(`(()=>{const node=__persistentRows.row.querySelector('.player[data-btp_id="9020"]');node.click();})()`);
 await verify('A newly inserted participant has a working check-in handler for the current game', `__writes.at(-1).type==='match_player_check_in'&&__writes.at(-1).player_id===9020&&__writes.at(-1).match_id==='match-45'`);
 await c.evaluate('__persistentRows.current=__persistentRows.guard("match-44")');
 for(const [name,code] of [
  ['Current game metadata','match.setup.match_name="Finale";match.setup.event_name="MX U19"'],
  ['Current game player rename','match.setup.teams[0].players[0].name="Mia Neuername"'],
  ['Current game officials','match.setup.umpire={btp_id:9030,name:"Feld Schiedsrichter",checked_in:true}'],
  ['Current game tablet assignment','match.setup.tabletoperators=[{btp_id:9031,name:"Feld Tablet",checked_in:true}]'],
  ['Current game score and shuttle count','match.network_score=[[7,8]];match.shuttle_count=6'],
  ['Longer scoring format','match.setup.counting="5x11_15";match.setup.scoring_format=calc.scoring_format_from_counting("5x11_15")'],
  ['Restored scoring format','match.setup.counting="3x21";match.setup.scoring_format=calc.scoring_format_from_counting("3x21")'],
 ]) {
  await c.evaluate(`__persistentRows.update(${JSON.stringify(code)},'match-44')`);
  await verify(name+' retains all cells, players and name objects','__persistentRows.current.same()&&__persistentRows.current.people()');
  if(name==='Longer scoring format')await verify('A longer format grows the shared score reservation','document.querySelector(".leitstand").style.getPropertyValue("--score-set-count")==="5"');
  if(name==='Restored scoring format')await verify('A shorter format releases the shared score reservation','document.querySelector(".leitstand").style.getPropertyValue("--score-set-count")==="3"');
 }
 await verify('Current game retains recall controls after participant changes','__persistentRows.current.row.querySelectorAll(".ls-teams .match_second_call_button").length===2');
 await c.evaluate('__persistentRows.send("court_changed",{court_id:"CH_1",is_active:false,has_umpire:true,has_service_judge:false})');
 await verify('A field update preserves the occupied row, its contents and field graphic','__persistentRows.current.same()&&__persistentRows.current.people()&&!!__persistentRows.current.row.querySelector(".court_inactive")');
 await c.evaluate('__persistentRows.send("court_changed",{court_id:"CH_1",is_active:true,has_umpire:true,has_service_judge:false})');
 await verify('Reactivating the field restores its number on the existing row','__persistentRows.current.same()&&__persistentRows.current.row.querySelector(".court_num").textContent==="1"');
 await c.evaluate(`__persistentRows.update(${JSON.stringify('match.setup.state="finished";match.setup.now_on_court=false;match.setup.court_id="CH_3";match.team1_won=true;match.btp_winner=1;match.end_ts=Date.now();match.network_score=[[21,15],[21,18]]')},'match-53')`);
 await c.evaluate('__persistentRows.finished=__persistentRows.guard("match-53")');
 for(const [name,code] of [
  ['Finished game metadata','match.setup.match_name="Finale";match.setup.match_num=153'],
  ['Finished game player rename','match.setup.teams[0].players[0].name="Ergebnis Neuername"'],
  ['Finished game officials','match.setup.umpire={btp_id:9040,name:"Ergebnis Schiedsrichter"}'],
  ['Finished game court history','match.setup.court_id="CH_12"'],
  ['Finished game winner and result correction','match.team1_won=false;match.btp_winner=2;match.network_score=[[15,21],[18,21]];match.end_ts+=60000;match.shuttle_count=4'],
 ]) {
  await c.evaluate(`__persistentRows.update(${JSON.stringify(code)},'match-53')`);
  await verify(name+' retains all cells, players and name objects','__persistentRows.finished.same()&&__persistentRows.finished.people()');
 }
 await verify('A corrected result marks the current winner and court history on the same cells','__persistentRows.finished.row.querySelector(".team-two").classList.contains("match_team_won")&&!__persistentRows.finished.row.querySelector(".team-one").classList.contains("match_team_won")&&__persistentRows.finished.row.querySelector(".court_history").textContent==="12"');
 await c.evaluate(`__persistentRows.update(${JSON.stringify('match.setup.teams[0].players=[]')})`);
 await verify('An unresolved pairing updates only its own contents and disables dragging','__persistentRows.same()&&!__persistentRows.row.draggable&&__persistentRows.row.querySelector(".team-one .ls-participant-dependency").textContent==="???"&&__persistentRows.players.slice(2).every(node=>node.isConnected)');
 await c.evaluate(`__persistentRows.update(${JSON.stringify('match.setup.teams[0].entry_status="DNS";match.setup.teams[0].players=[{btp_id:9050,name:"Neue Paarung",check_in_per_match:true,checked_in:false}]')})`);
 await verify('A newly assigned blocked participant keeps its status badge and existing cells','__persistentRows.same()&&!!__persistentRows.row.querySelector(".player.entry_blocked .btp_entry_status_badge")');
 await verify('An unchanged scoring format does not invalidate the whole board',`(()=>{const observer=new MutationObserver(()=>{});observer.observe(document.querySelector('.leitstand'),{attributes:true});for(let i=0;i<10;i++)cleitstand.refreshScoreLayout();const mutations=observer.takeRecords();observer.disconnect();return mutations.length===0;})()`);
 const boundaryReads=await c.evaluate(`(async()=>{const board=document.querySelector('.leitstand'),native=window.getComputedStyle;let reads=0;window.getComputedStyle=function(node,...args){if(node===board)reads++;return native.call(this,node,...args);};try{cleitstand.refreshCounts();await new Promise(resolve=>{let stable=0;const frame=()=>{stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});return{reads,boundaries:board.querySelectorAll('.ls-call-boundary').length};}finally{window.getComputedStyle=native;}})()`);
 await verify('Absent preparation boundaries need no global style measurement',String(boundaryReads.boundaries===0&&boundaryReads.reads===0));
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');await verify('Targeted row updates produce no browser exceptions',String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'persistent-row-verification.json'),JSON.stringify({date:'2026-10-31',scope:'Isolated real frontend; existing row and cells must survive every update.',checks,exceptions:exceptions.length,measurements:await c.evaluate('__persistentRows.measurements')},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
