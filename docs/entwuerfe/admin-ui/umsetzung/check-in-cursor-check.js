'use strict';
const fs=require('fs'),path=require('path');

module.exports=async function({c,check,click,open,metrics,previews}) {
 const checks=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=window.__checkCursor={};qa.row=document.querySelector('tr[data-match_id="match-45"]');
  qa.player=qa.row.querySelector('.player[data-btp_id="35"]');qa.name=qa.player.firstChild;
  qa.umpire=qa.row.querySelector('.person:has(>.umpire) .name');qa.judge=qa.row.querySelector('.person:has(>.service_judge) .name');
  qa.update=code=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-45'));new Function('match',code)(match);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});};
  qa.action=(node,text)=>getComputedStyle(node).cursor==='pointer'&&node.dataset.checkInAction===text&&node.title.endsWith(text)&&node.getAttribute('role')==='button';
  qa.locked=node=>getComputedStyle(node).cursor==='default'&&!node.hasAttribute('data-check-in-action')&&!node.hasAttribute('role')&&!/(Einchecken|Auschecken)/.test(node.title);
 })()`);
 await verify('Players, umpires and service judges use the same hand and describe the next action','__checkCursor.action(__checkCursor.player,"Einchecken")&&__checkCursor.action(__checkCursor.umpire,"Auschecken")&&__checkCursor.action(__checkCursor.judge,"Einchecken")');
 for(const [role,code,target,type] of [
  ['Player','match.setup.teams[0].players[1].checked_in=', '__checkCursor.player','match_player_check_in'],
  ['Umpire','match.setup.umpire.checked_in=', '__checkCursor.umpire','match_participant_check_in'],
  ['Service judge','match.setup.service_judge.checked_in=', '__checkCursor.judge','match_participant_check_in'],
 ]) {
  for(const checked of [true,false]) {
   await c.evaluate(`__checkCursor.update(${JSON.stringify(code+checked)})`);
   await verify(role+' changes the tooltip immediately after '+(checked?'check-in':'check-out'),`__checkCursor.action(${target},${JSON.stringify(checked?'Auschecken':'Einchecken')})&&__checkCursor.row.isConnected&&__checkCursor.player.firstChild===__checkCursor.name`);
   await c.evaluate(`${target}.click()`);
   await verify(role+' sends the action described by its tooltip',`__writes.at(-1).type===${JSON.stringify(type)}&&__writes.at(-1).checked_in===${!checked}&&__writes.at(-1).match_id==='match-45'`);
  }
 }
 await c.evaluate(`__checkCursor.update('match.setup.teams[0].players[1].name="Lara Maximiliane Alexandra Seidel";match.setup.teams[0].players[1].firstname="Lara Maximiliane Alexandra"')`);
 await metrics(390,844);
 await verify('Shortened names retain the full name and action together in their tooltip',`__checkCursor.player.title.includes('Lara Maximiliane Alexandra Seidel')&&__checkCursor.player.title.endsWith('Einchecken')&&__checkCursor.player.title.match(/Einchecken/g).length===1`);
 await c.evaluate(`__checkCursor.update('match.setup.teams[0].players[1].checked_in=true')`);
 await verify('A changed action replaces its old tooltip without duplication',`__checkCursor.player.title.includes('Lara Maximiliane Alexandra Seidel')&&__checkCursor.player.title.endsWith('Auschecken')&&!__checkCursor.player.title.includes('Einchecken')`);
 await metrics(1920,1080);
 await c.evaluate(`crouting.on_change({ctype:'update_btp_settings',tournament_key:'preview',val:{btp_settings:{check_in_per_match:false}}})`);
 await verify('Disabling check-in removes the hand, action tooltip and keyboard target for players and officials','[__checkCursor.player,__checkCursor.umpire,__checkCursor.judge].every(__checkCursor.locked)');
 await c.evaluate('(()=>{__checkCursor.writes=__writes.length;__checkCursor.player.click();__checkCursor.umpire.click();__checkCursor.judge.click();})()');
 await verify('Disabled check-in targets send no request','__writes.length===__checkCursor.writes');
 await c.evaluate(`crouting.on_change({ctype:'update_btp_settings',tournament_key:'preview',val:{btp_settings:{check_in_per_match:true}}})`);
 await verify('Re-enabling check-in restores the current actions on the same nodes','__checkCursor.action(__checkCursor.player,"Auschecken")&&__checkCursor.action(__checkCursor.umpire,"Einchecken")&&__checkCursor.action(__checkCursor.judge,"Einchecken")');
 await c.evaluate(`__checkCursor.update('match.setup.teams[0].entry_status="DNS"')`);
 await verify('An entry-blocked player uses the arrow and retains the blocking explanation','__checkCursor.locked(__checkCursor.player)&&__checkCursor.player.title.includes("DNS")&&getComputedStyle(__checkCursor.player.querySelector(".btp_entry_status_badge")).cursor==="default"');
 await c.evaluate('(()=>{__checkCursor.writes=__writes.length;__checkCursor.player.click();})()');
 await verify('An entry-blocked player remains noninteractive','__writes.length===__checkCursor.writes');
 await c.evaluate(`__checkCursor.update('delete match.setup.teams[0].entry_status')`);
 await verify('Clearing a block restores the action without stale warning text','__checkCursor.action(__checkCursor.player,"Auschecken")&&!__checkCursor.player.title.includes("DNS")');
 await c.evaluate(`(()=>{const row=document.querySelector('tr[data-match_id="match-46"]');__checkCursor.pair=row.querySelector('.operator-pair .name');__checkCursor.operator=document.querySelector('tr[data-match_id="match-49"] .tablet_operator .name');})()`);
 await verify('Single tablet operators and paired operators share the hand and tooltip','__checkCursor.action(__checkCursor.operator,"Einchecken")&&__checkCursor.action(__checkCursor.pair,"Einchecken")&&[...__checkCursor.pair.querySelectorAll(".pair-member")].every(node=>getComputedStyle(node).cursor==="pointer"&&node.title.endsWith("Einchecken"))');
 await c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-46'));match.setup.tabletoperators.forEach(person=>person.checked_in=true);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});})()`);
 await verify('Paired operator check-in updates every name tooltip on the existing target','__checkCursor.action(__checkCursor.pair,"Auschecken")&&[...__checkCursor.pair.querySelectorAll(".pair-member")].every(node=>node.title.endsWith("Auschecken")&&!node.title.includes("Einchecken"))');
 await c.evaluate('(()=>{__checkCursor.writes=__writes.length;__checkCursor.oncourt=document.querySelector(".courts_container .player");__checkCursor.oncourt.click();})()');
 await verify('An on-court player offers no check-in action','__checkCursor.locked(__checkCursor.oncourt)&&__writes.length===__checkCursor.writes');
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');await verify('Cursor and tooltip updates produce no browser exceptions',String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'check-in-cursor-verification.json'),JSON.stringify({date:'2026-10-31',checks,exceptions:exceptions.length,scope:'Isolated frontend: computed cursors, native tooltips, check-in requests, live changes and locked states.'},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
