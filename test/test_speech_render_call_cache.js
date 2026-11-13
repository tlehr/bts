'use strict';
const assert=require('assert'),{tournament,setup}=require('./test_speech_text');
const {plan}=require('../bts/speech/coverage'),Cache=require('../bts/speech/render_call_cache');
const snapshot=targets=>JSON.stringify({parts:[...targets].map(([key,value])=>[key,{...value,groups:[...value.groups]}]),calls:targets.announcements,fields:targets.fields,games:targets.games});
describe('cached speech wording retains current coverage',function(){
 for(const version of ['bts-context-v1','bts-context-v2'])it('matches a fresh plan after every text and live status input changes ('+version+')',async function(){
  const context=tournament(),match={_id:'one',setup:setup()},matches=[match],cache=new Cache();context.speech={context_version:version};
  const check=async()=>assert.strictEqual(snapshot(await plan(context,matches,[],[],cache)),snapshot(await plan(context,matches)));
  await check();await check();
  for(const change of [
   ()=>{match.network_score=[[14,9]];},()=>{match.setup.state='finished';match.team1_won=true;},
   ()=>{match.setup.teams[0].players[0].name='Nguyen Neu';},
   ()=>{context.normalizations.push({origin:'Nguyen',replace:'Win',language:'de-DE'});},
   ()=>{context.normalizations[0].replace='N';},()=>{context.normalizations[0].language='en-GB';},
   ()=>{context.locations[0].preparation_addition='Halle Zwei!';},
   ()=>{context.locations[0].meetingpoint_announcement='Zur Anmeldung!';},
   ()=>{match.setup.location_id=null;context.courts[0].location_id='missing';},
   ()=>{match.setup.court_id='default_9';},()=>{match.setup.match_num=99;},
   ()=>{match.setup.match_name='Finale';},()=>{match.setup.event_name='MX U19';},
   ()=>{match.setup.umpire.name='Neue Leitung';},()=>{match.setup.service_judge.name='Neue Linie';},
   ()=>{match.setup.tabletoperators=[{name:'Neue Bedienung'}];},
   ()=>{context.tabletoperator_use_manual_counting_boards_enabled=true;},
   ()=>{context.annoncement_include_event=false;},()=>{context.annoncement_include_round=false;},
   ()=>{context.annoncement_include_matchnumber=false;},()=>{context.preparation_meetingpoint_enabled=false;},
   ()=>{match.setup.teams[1].players.push({name:'Doppelpartner'});},
   ()=>{context.locations.reverse();context.courts.reverse();},
  ]){change();await check();}
 });
 it('keeps the cache bounded while retaining exact text across eviction',async function(){
  const context=tournament(),cache=new Cache(4096);context.speech={context_version:'bts-context-v2'};
  for(let i=0;i<12;i++){
   const matches=[{_id:'one',setup:setup({match_num:i})}];
   assert.strictEqual(snapshot(await plan(context,matches,[],[],cache)),snapshot(await plan(context,matches)));
   assert(cache.bytes<=4096);
  }
 });
});
