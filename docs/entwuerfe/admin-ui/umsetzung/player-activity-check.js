'use strict';

module.exports = async function({c, open, check, metrics, previews}) {
 await open(1424,940);
 await c.evaluate(`(()=>{
  const person=(id,name,extra={})=>({btp_id:id,name,firstname:name.split(' ')[0],lastname:name.split(' ').slice(1).join(' '),checked_in:false,check_in_per_match:true,...extra});
  const match=structuredClone(curt.matches.find(m=>m._id==='match-45'));
  match.setup.teams=[{players:[person(99001,'Aktuell Spielend',{now_playing_on_court:'CH_10'}),person(99002,'Aktuell Tablet',{now_tablet_on_court:'CH_10'})]},
   {players:[person(99003,'Wartet Tablet'),person(99004,'Freier Spieler')]}];
  crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});
  const active=structuredClone(curt.matches.find(m=>m._id==='match-44'));
  active.setup.court_id='CH_10';
  active.setup.tabletoperators=[person(99002,'Aktuell Tablet')];
  crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:active._id,match:active}});
  crouting.on_change({ctype:'tabletoperator_add',tournament_key:'preview',val:{tabletoperator:{_id:'activity-waiting',court:null,played_on_court:'CH_10',tabletoperator:[person(99003,'Wartet Tablet')]}}});
  window.__activityQA={row:document.querySelector('tr[data-match_id="match-45"]')};
  __activityQA.player=id=>__activityQA.row.querySelector('.player[data-btp_id="'+id+'"]');
 })()`);
 await check('Yellow players use the same court graphic, font and separation as red tablet operators',`(()=>{
  const a=__activityQA.player(99001),b=__activityQA.player(99002),court=a.querySelector('.ls-resource-court'),tablet=b.querySelector('.ls-resource-court');
  if(!a.classList.contains('now_playing')||!b.classList.contains('not_checked_in')||!court||!tablet)return false;
  const x=getComputedStyle(court),y=getComputedStyle(tablet),parent=getComputedStyle(court.parentElement),other=getComputedStyle(tablet.parentElement);
  return court.textContent==='10'&&tablet.textContent==='10'&&['fontSize','fontWeight','width','height','backgroundImage','color','textShadow'].every(key=>x[key]===y[key])&&parent.borderLeftWidth===other.borderLeftWidth&&parent.paddingLeft===other.paddingLeft&&a.querySelector('.court').title==='Spielt auf Feld 10';
 })()`);
 await check('Waiting shows tablet and clock icons without the source court number',`(()=>{
  const player=__activityQA.player(99003),hint=player.querySelector('.tabletoperator_waiting_inline');
  return hint&&hint.querySelectorAll('svg').length===2&&!player.querySelector('.court,.tablet_inline,.ls-resource-court')&&hint.textContent===''&&hint.title==='Wartet auf Tabletbedienung';
 })()`);
 await check('Playing, operating, waiting and free players each have exactly their own activity indicator',`[99001,99002,99003,99004].every((id,index)=>__activityQA.player(id).querySelectorAll('.ls-resource-hint').length===(index===3?0:1))`);
 await c.evaluate(`(()=>{
  const qa=__activityQA;qa.name=qa.player(99001).firstChild;qa.original=qa.player(99001);qa.other=qa.player(99004);
  const match=curt.matches.find(m=>m._id==='match-45'),setup=structuredClone(match.setup);
  setup.teams[0].players[0].now_playing_on_court=false;
  crouting.on_change({ctype:'update_player_status',tournament_key:'preview',val:{match__id:match._id,setup}});
  crouting.on_change({ctype:'tabletoperator_add',tournament_key:'preview',val:{tabletoperator:{_id:'activity-finished',court:null,played_on_court:'CH_10',tabletoperator:[{btp_id:99001}]}}});
 })()`);
 await check('Finishing changes an existing yellow player to waiting without keeping a court badge or replacing the row or name',`(()=>{
  const qa=__activityQA,player=qa.player(99001);
  return player===qa.original&&player.firstChild===qa.name&&qa.row===document.querySelector('tr[data-match_id="match-45"]')&&qa.other===qa.player(99004)&&!player.classList.contains('now_playing')&&!!player.querySelector('.tabletoperator_waiting_inline')&&!player.querySelector('.ls-resource-court,.court,.tablet_inline');
 })()`);
 await c.evaluate(`(()=>{
  const operator={btp_id:99001,name:'Aktuell Spielend'},active=structuredClone(curt.matches.find(m=>m._id==='match-44'));
  crouting.on_change({ctype:'tabletoperator_removed',tournament_key:'preview',val:{tabletoperator:{_id:'activity-finished',court:'CH_10',tabletoperator:[operator]}}});
  active.setup.tabletoperators.push(operator);
  crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:active._id,match:active}});
 })()`);
 await check('Assigning a waiting operator replaces the wait hint with tablet and court only',`(()=>{
  const player=__activityQA.player(99001);
  return player===__activityQA.original&&player.querySelectorAll('.ls-resource-hint').length===1&&player.querySelector('.tablet_inline .ls-resource-court')?.textContent==='10'&&!player.querySelector('.tabletoperator_waiting_inline,.court');
 })()`);
 await metrics(1050,940);
 await check('Court badges remain legible and identically sized after resizing',`(()=>{
  const hints=[...__activityQA.row.querySelectorAll('.ls-resource-court')];
  return hints.length===2&&hints.every(hint=>{const rect=hint.getBoundingClientRect();return rect.width>=20&&rect.height>=17&&getComputedStyle(hint).fontSize==='12px';});
 })()`);
 console.log(JSON.stringify({checks:6,kind:'player-activity',previews}));
};
