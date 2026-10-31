'use strict';
const fs = require('fs'), path = require('path');

module.exports = async function({c, check, click, open, metrics, previews}) {
 const checks = [], observations = [];
 const verify = async (name, expression) => {await check(name, expression);checks.push(name);};
 const selector = '.unassigned_container tr[data-match_id="match-45"]';
 await open(1920,1080);
 await c.evaluate(`(()=>{
  window.__locationSend=send;window.__locationRequests=[];window.__locationPending=[];
  window.__locationButtons=()=>[...document.querySelector('${selector}').querySelectorAll('.match_preparation_call_button')].map(button=>button.dataset.location_id).sort();
  window.__locationGradient=()=>{const style=getComputedStyle(document.querySelector('${selector} .call_td'));return [style.backgroundImage,style.boxShadow,style.getPropertyValue('--status-rgb')];};
  window.send=(message,callback)=>{
   if(message.type==='preparation_selection_get'&&window.__locationHold){__locationPending.push(callback);return;}
   if(message.type==='match_player_check_in'){
    __locationRequests.push(structuredClone(message));
    const match=structuredClone(curt.matches.find(match=>match._id===message.match_id));
    match.setup.teams.flatMap(team=>team.players).find(player=>String(player.btp_id)===String(message.player_id)).checked_in=message.checked_in;
    crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});callback?.(null,{});return;
   }
   return __locationSend(message,callback);
  };
 })()`);
 const cases = [
  {name:'prepared game check-in',state:'preparation',location:'CH',allowed:['CH']},
  {name:'prepared game check-out',state:'preparation',location:'CH',allowed:['CH']},
  {name:'scheduled game with a location',state:'scheduled',location:'CH',allowed:['CH']},
  {name:'scheduled game with a court only',state:'scheduled',court:'CH_1',allowed:['CH']},
  {name:'game moved to another location',state:'preparation',location:'SN',allowed:['SN']},
  {name:'game without a location or court',state:'scheduled',allowed:['CH','SN']},
 ];
 for (const [index,entry] of cases.entries()) {
  if(index===2)await metrics(390,844);
  await c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-45'));match.setup.state=${JSON.stringify(entry.state)};delete match.setup.location_id;delete match.setup.court_id;${entry.location?'match.setup.location_id='+JSON.stringify(entry.location)+';':''}${entry.court?'match.setup.court_id='+JSON.stringify(entry.court)+';':''}crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});})()`);
  await verify('Correct initial call locations for '+entry.name, `JSON.stringify(__locationButtons())===${JSON.stringify(JSON.stringify(entry.allowed))}`);
  await c.evaluate(`(()=>{
   window.__locationAllowed=${JSON.stringify(entry.allowed)};window.__locationFrames=[];window.__locationWrong=[];
   window.__locationGradients=[];window.__locationEligible=${index%2===0};
   window.__locationResponse=(cached=false)=>({selections:curt.locations.map(location=>{
    const allowed=__locationAllowed.includes(location._id),prepared=curt.matches.find(match=>match._id==='match-45').setup.state==='preparation';
    return {location_id:location._id,diagnostics_by_match_id:{'match-45':{manual_eligible:cached||allowed,within_call_window:allowed,criteria_eligible:__locationEligible,eligible:allowed&&__locationEligible,rules:[]}},call_on_court_diagnostics_by_match_id:allowed&&prepared?{'match-45':{eligible:__locationEligible,court_diagnostics:[]}}:{}};
   })});
   window.__locationHold=true;
   // Simulate a cached permission from before the game received its location.
   curt.location_preparation_selection_by_location_id=Object.fromEntries(__locationResponse(true).selections.map(selection=>[selection.location_id,selection]));
   cmatch.refresh_unassigned_preparation_context();
   window.__locationBeforeGradient=__locationGradient();
   const row=document.querySelector('${selector}');
   window.__locationCell=row.querySelector('.call_td');window.__locationButton=row.querySelector('.match_preparation_call_button');
   window.__locationPlayer=row.querySelector('.team-one .player:is(.can_check_in,.can_check_out)');
   window.__locationObserver=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
     const buttons=[...(node.matches?.('.match_preparation_call_button')?[node]:[]),...(node.querySelectorAll?.('.match_preparation_call_button')||[])];
     for(const button of buttons)if(!__locationAllowed.includes(button.dataset.location_id))__locationWrong.push(button.dataset.location_id);
    }
   });
   __locationObserver.observe(document.querySelector('${selector}'),{childList:true,subtree:true});
  })()`);
  await click(selector+' .team-one .player:is(.can_check_in,.can_check_out)');
  const observation = await c.evaluate(`(async()=>{
   const started=performance.now();
   __locationGradients.push(__locationGradient());
   for(let frame=0;frame<4;frame++){await new Promise(requestAnimationFrame);__locationFrames.push(__locationButtons());__locationGradients.push(__locationGradient());}
   const held=__locationPending.length;
   // Exercise both the full-row and incremental preparation refresh paths
   // while the authoritative diagnosis is still delayed.
   cmatch.refresh_unassigned_preparation_context();await new Promise(requestAnimationFrame);
   __locationFrames.push(__locationButtons());__locationGradients.push(__locationGradient());
   const response=__locationResponse();
   __locationHold=false;
   while(__locationPending.length)__locationPending.shift()(null,response);
   await new Promise(requestAnimationFrame);__locationFrames.push(__locationButtons());__locationGradients.push(__locationGradient());
   __locationObserver.disconnect();
   const row=document.querySelector('${selector}');
   window.__locationObservation={held,frames:__locationFrames,wrongAdditions:__locationWrong,gradientBefore:__locationBeforeGradient,gradientFrames:__locationGradients,sameCell:row.querySelector('.call_td')===__locationCell,sameButton:row.querySelector('.match_preparation_call_button')===__locationButton,samePlayer:row.querySelector('.team-one .player:is(.can_check_in,.can_check_out)')===__locationPlayer,presentationMs:performance.now()-started,request:__locationRequests.at(-1)};
   return __locationObservation;
  })()`);
  observations.push({name:entry.name,...observation});
  console.log(entry.name+' '+JSON.stringify(observation));
  await verify('No transient buttons from another location during '+entry.name, `__locationObservation.held>0&&__locationObservation.frames.length===6&&__locationObservation.frames.every(ids=>JSON.stringify(ids)===${JSON.stringify(JSON.stringify(entry.allowed))})&&__locationObservation.wrongAdditions.length===0`);
  await verify('The cached gradient never disappears or changes while diagnostics are delayed for '+entry.name, `__locationObservation.gradientBefore[0]!=='none'&&__locationObservation.gradientFrames.every(gradient=>JSON.stringify(gradient)===JSON.stringify(__locationObservation.gradientBefore))`);
  await verify('Check-in updates keep the action cell, call button and player node for '+entry.name, '__locationObservation.sameCell&&__locationObservation.sameButton&&__locationObservation.samePlayer');
  await verify('The check-in action updates the player and preserves the assigned call locations for '+entry.name, `(()=>{const request=__locationObservation.request,match=curt.matches.find(match=>match._id==='match-45'),player=match.setup.teams.flatMap(team=>team.players).find(player=>String(player.btp_id)===String(request.player_id));return request.type==='match_player_check_in'&&player.checked_in===request.checked_in&&JSON.stringify(__locationButtons())===${JSON.stringify(JSON.stringify(entry.allowed))};})()`);
 }
 await c.evaluate(`(async()=>{
  window.__gradientChangedBefore=__locationGradient();window.__gradientChangedCell=document.querySelector('${selector} .call_td');
  __locationHold=true;ctournament.request_location_preparation_selections();__locationEligible=!__locationEligible;
  const response=__locationResponse();__locationHold=false;while(__locationPending.length)__locationPending.shift()(null,response);
 })()`);
 await verify('A genuinely changed diagnosis updates the gradient immediately on the same action cell', `JSON.stringify(__locationGradient())!==JSON.stringify(__gradientChangedBefore)&&__locationGradient()[0]!=='none'&&document.querySelector('${selector} .call_td')===__gradientChangedCell`);
 const structural = await c.evaluate(`(async()=>{
  const before=__locationGradient(),cell=document.querySelector('${selector} .call_td'),match=structuredClone(curt.matches.find(match=>match._id==='match-45'));
  __locationHold=true;match.setup.umpire.checked_in=!match.setup.umpire.checked_in;
  crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});
  const frames=[__locationGradient()];for(let frame=0;frame<4;frame++){await new Promise(requestAnimationFrame);frames.push(__locationGradient());}
  const held=__locationPending.length,response=__locationResponse();__locationHold=false;while(__locationPending.length)__locationPending.shift()(null,response);
  window.__gradientStructural={held,replaced:document.querySelector('${selector} .call_td')!==cell,stable:frames.every(gradient=>JSON.stringify(gradient)===JSON.stringify(before))};return __gradientStructural;
 })()`);
 await verify('Official check-in retains the action cell and cached gradient before a delayed diagnosis returns', '__gradientStructural.held>0&&!__gradientStructural.replaced&&__gradientStructural.stable');
 await c.evaluate('window.send=__locationSend');
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Delayed preparation responses and check-in changes produce no browser exceptions', String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'preparation-location-verification.json'),JSON.stringify({date:'2026-10-31',scope:'Isolated frontend with synthetic check-in updates, cached gradients and delayed preparation diagnostics; no live services.',checks,observations,structural,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
