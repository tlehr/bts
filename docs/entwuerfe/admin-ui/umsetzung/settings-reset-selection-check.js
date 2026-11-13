'use strict';
/* eslint no-undef: off */
module.exports = async function({c,open,metrics,key,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error("Reset selection did not settle");})()');
 const checks = [], verify = async (name,fn) => {await check(name,'(' + fn.toString() + ')()');checks.push(name);};
 await open(1440,1000);
 await run(() => {
  window.__resetDocument=document;window.__resetSpeech=btsSpeechService;window.__resetRequests=[];window.__resetErrors=[];
  window.addEventListener('error',event => __resetErrors.push(event.message));
  const source=curt.matches[0];window.__resetSample=structuredClone(source);curt.matches=[1,2,3].map(index => {
   const match=structuredClone(source);match._id='reset-'+index;match.team1_won=index===1;match.network_score=[[21,10]];
   Object.assign(match.setup,{match_num:100+index,state:index===3?'oncourt':'finished',now_on_court:index===3});return match;
  });
  Object.assign(curt,{btp_enabled:true,btp_readonly:false,btp_status:{status:'connected',message:''}});
  const original=send;window.send=(message,callback) => {
   if (message.type==='service_status') return setTimeout(() => callback(null,{services:{btp:structuredClone(curt.btp_status),ticker:structuredClone(curt.ticker_status),speech:{enabled:true},speech_health:{state:'ok',issues:[]}}}),0);
   if (message.type==='tournament_get') return setTimeout(() => callback(null,{tournament:structuredClone(curt)}),0);
   if (['maintenance_reset','tournament_reset'].includes(message.type)) {__resetRequests.push({message:structuredClone(message),callback});return;}
   return original(message,callback);
  };
  window.__resetOpen=() => document.querySelector('.settings-maintenance [name=tournament_reset]').click();
  window.__resetArea=name => document.querySelector('.settings-reset-dialog [name=reset_action][value="'+name+'"]');
  window.__resetTarget=value => {const node=document.querySelector('[name=reset_target]');node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
  window.__resetReview=() => document.querySelector('[name=reset_review]').click();
  window.__resetReply=error => __resetRequests.shift().callback(error || null,{completed:[]});
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(() => !!document.querySelector('.settings-area-link[href$="/edit/maintenance"]'));
 await run(() => {document.querySelector('.settings-area-link[href$="/edit/maintenance"]').click();__resetOpen();});
 await verify('Reset starts with a styled scope-and-area selector and no implicit deletion',() =>
  document.querySelector('.settings-reset-dialog').open && document.querySelector('[name=reset_target]').value==='bts' &&
  document.querySelectorAll('.settings-reset-option').length===5 && document.querySelector('[name=reset_review]').disabled &&
  getComputedStyle(document.querySelector('.settings-reset-dialog'),'::backdrop').backdropFilter.includes('blur') && __resetRequests.length===0);
 await run(() => {__resetArea('court_assignments').click();__resetArea('player_pauses').click();__resetReview();});
 await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await verify('Review shows the exact local reset areas and warns that a later sync can restore BTP values',() =>
  ['Nur BTS','Feldzuweisungen','Spielerpausen','späterer Abgleich'].every(text => document.querySelector('.bts-confirm-content').textContent.includes(text)) &&
  !document.querySelector('.bts-confirm-verification') && __resetRequests.length===0);
 await run(() => document.querySelector('.bts-confirm-accept').click());await wait(() => __resetRequests.length===1);
 await verify('Combining areas sends one explicit local maintenance plan and blocks duplicate actions',() =>
  __resetRequests[0].message.type==='maintenance_reset' && __resetRequests[0].message.target==='bts' &&
  __resetRequests[0].message.actions.join('|')==='court_assignments|player_pauses' &&
  [...document.querySelectorAll('.settings-maintenance-action')].every(node => node.disabled));
 await run(() => {__resetReply();__resetOpen();__resetTarget('both');});
 await verify('BTS and BTP supports field and pause resets but clearly excludes a full BTP wipe',() =>
  __resetArea('tournament').disabled && !__resetArea('court_assignments').disabled && !__resetArea('player_pauses').disabled &&
  document.querySelector('.settings-reset-body').textContent.includes('nur in BTS verfügbar'));
 await run(() => {__resetArea('match_results').click();const scope=document.querySelector('[name=reset_result_scope]');scope.value='selected';scope.dispatchEvent(new Event('change'));});
 await verify('Result selection excludes the running game and waits for a specific eligible match',() =>
  document.querySelectorAll('[name=reset_match_id]').length===2 && document.querySelector('[name=reset_review]').disabled &&
  !document.querySelector('[name=reset_match_id][value=reset-3]'));
 await run(() => document.querySelector('[name=reset_match_id][value=reset-1]').click());
 await capture('einstellungen-zuruecksetzen-auswahl',true);
 for (const [width,height] of [[1920,1000],[950,1000],[390,844],[320,568],[568,320]]) {
  await metrics(width,height);
  await verify('The reset selector and its fixed actions fit at '+width+' × '+height,() => {
   const dialog=document.querySelector('.settings-reset-dialog'),box=dialog.getBoundingClientRect();
   return box.left>=15 && box.right<=innerWidth-15 && box.top>=15 && box.bottom<=innerHeight-15 && dialog.scrollWidth<=dialog.clientWidth+1 &&
    [...document.querySelectorAll('.settings-reset-footer button')].every(node => {const b=node.getBoundingClientRect();return b.left>=box.left && b.right<=box.right && b.top>=box.top && b.bottom<=box.bottom;});
  });
  if (width===390) await capture('einstellungen-zuruecksetzen-auswahl-mobil',true);
 }
 await metrics(1440,1000);
 await run(() => {ctournament.btp_status_changed({val:{status:'error',message:'Offline'}});});
 await verify('A lost BTP connection blocks review without losing selected matches',() =>
  document.querySelector('[name=reset_review]').disabled && document.querySelector('[name=reset_match_id][value=reset-1]').checked);
 await run(() => {ctournament.btp_status_changed({val:{status:'connected',message:''}});__resetReview();});await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await verify('The final result confirmation identifies the selected game and its possible follow-up effect',() =>
  ['BTS und BTP','#101','nachfolgender Spiele'].every(text => document.querySelector('.bts-confirm-content').textContent.includes(text)) &&
  !document.querySelector('.bts-confirm-content').textContent.includes('#102'));
 await run(() => document.querySelector('.bts-confirm-accept').click());await wait(() => __resetRequests.length===1);
 await verify('A selected winner reset addresses only the reviewed game and includes BTP explicitly',() =>
  __resetRequests[0].message.target==='both' && __resetRequests[0].message.actions.join()==='match_results' && __resetRequests[0].message.match_ids.join()==='reset-1');
 await run(() => __resetReply({message:'BTP hat Sieger oder Ergebnis nicht vollständig zurückgesetzt.'}));
 await verify('A failed BTP verification is shown without claiming that the result reset succeeded',() =>
  document.querySelector('.tournament_reset_button').closest('.settings-row').textContent.includes('nicht vollständig zurückgesetzt') &&
  document.querySelector('.tournament_reset_button').closest('.settings-row').querySelector('.settings-maintenance-result').dataset.state==='error');
 await run(() => {
  ctournament.btp_status_changed({val:{status:'error',message:'Offline'}});
  __resetOpen();__resetArea('player_checkins').click();
 });
 await verify('Every-game player check-in reset is available locally even while BTP is offline',() =>
  !document.querySelector('[name=reset_review]').disabled && __resetArea('player_checkins').checked &&
  ['jedem Spiel','laufenden','beendeten','Offizielle'].every(text => __resetArea('player_checkins').closest('label').textContent.includes(text)));
 await run(() => __resetReview());await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await verify('The check-in confirmation names all games and preserves official attendance',() =>
  ['Nur BTS','Alle Spieler in jedem Spiel','nicht eingecheckt','Offizielle bleiben unverändert'].every(text => document.querySelector('.bts-confirm-content').textContent.includes(text)));
 await run(() => document.querySelector('.bts-confirm-cancel').click());
 await verify('Cancelling the check-in reset does not send a maintenance action',() => __resetRequests.length===0);
 await run(() => {__resetOpen();__resetArea('player_checkins').click();__resetReview();});await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await run(() => document.querySelector('.bts-confirm-accept').click());await wait(() => __resetRequests.length===1);
 await verify('Confirming player check-ins sends exactly the selected bulk action without a match-result filter',() =>
  __resetRequests[0].message.target==='bts' && __resetRequests[0].message.actions.join()==='player_checkins' &&
  !Object.hasOwn(__resetRequests[0].message,'match_ids'));
 await run(() => {
  window.__checkinResetDraft=document.querySelector('[name=name]');__checkinResetDraft.value='Titel bleibt erhalten';
  const handler=change.default_handler(() => {});
  for (const match of curt.matches) {
   const setup=structuredClone(match.setup);for(const team of setup.teams)for(const player of team.players)player.checked_in=false;
   handler({ctype:'update_player_status',val:{match__id:match._id,setup,btp_winner:match.btp_winner}});
  }
  handler({ctype:'player_checkin_reset',val:{changed_matches:curt.matches.length}});__resetReply();
 });
 await verify('Reset notifications update every game and retain the settings draft and success feedback',() =>
  curt.matches.every(match=>match.setup.teams.every(team=>team.players.every(player=>player.checked_in===false))) &&
  document.querySelector('[name=name]')===__checkinResetDraft && __checkinResetDraft.value==='Titel bleibt erhalten' &&
  document.querySelector('.tournament_reset_button').closest('.settings-row').textContent.includes('Zurückgesetzt: Spieler-Check-ins'));
 await run(() => ctournament.btp_status_changed({val:{status:'connected',message:''}}));
 await run(() => {__resetOpen();__resetArea('match_results').click();__resetArea('player_pauses').click();__resetArea('player_checkins').click();__resetArea('tournament').click();});
 await verify('Full local reset is mutually exclusive with partial areas',() =>
  __resetArea('tournament').checked && !__resetArea('match_results').checked && !__resetArea('player_pauses').checked && !__resetArea('player_checkins').checked);
 await run(() => __resetArea('court_assignments').click());
 await verify('Selecting a partial area removes the full-wipe selection',() => __resetArea('court_assignments').checked && !__resetArea('tournament').checked);
 await run(() => {__resetArea('tournament').click();__resetTarget('both');});
 await verify('Changing to BTP removes an unsupported full-wipe selection instead of silently changing its scope',() =>
  !__resetArea('tournament').checked && __resetArea('tournament').disabled && document.querySelector('[name=reset_review]').disabled);
 await key('Escape','Escape',27);
 await verify('Escape dismisses selection without sending an operation',() => !document.querySelector('.settings-reset-dialog') && __resetRequests.length===0);
 await run(() => {
  curt.matches=curt.matches.slice(0,2).map((match,index) => ({_id:match._id,
   setup:{...match.setup,state:'incomplete',now_on_court:false,teams:[{players:index ? match.setup.teams[0].players : []},{players:[]}]}}));
  __resetOpen();__resetArea('court_assignments').click();__resetTarget('both');
 });
 await verify('Field removal remains available when all games have one or two unknown opponents and no results',() =>
  !document.querySelector('[name=reset_review]').disabled && __resetArea('court_assignments').checked &&
  __resetArea('court_assignments').closest('label').textContent.includes('noch nicht feststehen') &&
  document.querySelectorAll('[name=reset_match_id]').length===0);
 await run(() => __resetReview());await wait(() => !!document.querySelector('.bts-confirm-dialog'));
 await run(() => document.querySelector('.bts-confirm-accept').click());await wait(() => __resetRequests.length===1);
 await verify('Unresolved opponents do not introduce a result or participant filter into the field reset command',() =>
  __resetRequests[0].message.target==='both' && __resetRequests[0].message.actions.join()==='court_assignments' &&
  !Object.hasOwn(__resetRequests[0].message,'match_ids'));
 await run(() => __resetReply());
 await run(() => {__resetOpen();document.querySelector('.settings-area-link[href$="/edit/ticker"]').click();});
 await wait(() => !document.querySelector('.settings-reset-dialog'));
 await verify('Changing area disposes the selector without interrupting shared services',() =>
  document===__resetDocument && btsSpeechService===__resetSpeech && __resetRequests.length===0 && __resetErrors.length===0);
 await run(() => {
  const match=structuredClone(__resetSample);match._id='checkin-reset-card';
  Object.assign(match.setup,{state:'preparation',now_on_court:false,court_id:null,location_id:curt.locations[0]._id,highlight:0,
   teams:[{players:[{btp_id:901,name:'Player A',checked_in:true}]},{players:[{btp_id:902,name:'Player B',checked_in:true}]}],
   umpire:{btp_id:903,name:'Umpire',checked_in:true},tabletoperators:[]});
  delete match.team1_won;delete match.btp_winner;curt.matches=[match];
  crouting.navigate_to('t/preview/self_check_in');
 });
 await wait(() => !!document.querySelector('.self_check_in_match'));
 await verify('The self-check-in starts with both players present',() =>
  document.querySelectorAll('.self_check_in_chip[data-role=player].self_check_in_chip_ready').length===2);
 await run(() => {
  const match=curt.matches[0],setup=structuredClone(match.setup);
  for(const team of setup.teams)for(const player of team.players)player.checked_in=false;
  crouting.on_change({ctype:'update_player_status',tournament_key:'preview',val:{match__id:match._id,setup,btp_winner:match.btp_winner}});
  crouting.on_change({ctype:'player_checkin_reset',tournament_key:'preview',val:{changed_matches:1}});
 });
 await verify('Bulk reset immediately updates self-check-in cards while keeping the umpire present',() =>
  document.querySelectorAll('.self_check_in_chip[data-role=player].self_check_in_chip_waiting').length===2 &&
  document.querySelectorAll('.self_check_in_chip[data-role=umpire].self_check_in_chip_ready').length===1 &&
  __resetErrors.length===0);
 const fs=require('fs'),path=require('path');
 fs.writeFileSync(path.join(__dirname,'settings-reset-selection-verification.json'),JSON.stringify({
  date:new Date().toISOString(),scope:'Isolierter Browser mit simulierten Serverantworten. Kein Zugriff auf laufende BTS-/BTP-Turniere.',checks,errors:await run(() => __resetErrors),
 },null,2)+'\n');
};
