'use strict';
const assert=require('assert');
const selection=require('../static/js/court_assignment');
const compare=(a,b)=>(a.match_order??0)-(b.match_order??0)||a.setup.match_num-b.setup.match_num;
const player=(id,extra={})=>({btp_id:id,name:'Player '+id,checked_in:true,...extra});
function game(id,state='scheduled',time=undefined,extra={}) {
 return {_id:String(id),match_order:id,setup:{is_match:true,is_doubles:false,state,now_on_court:false,
  match_num:id,preparation_call_timestamp:time,teams:[{players:[player(id*10)]},{players:[player(id*10+1)]}],...extra}};
}
const tournament=(matches,tabletoperators=[])=>({matches,tabletoperators});
const groups=t=>selection.groups(t,compare);
const ids=t=>groups(t).map(group=>group.matches.map(match=>match._id));

describe('Manual court assignment candidates',function() {
 it('prioritizes checked-in preparation, then other preparation, then planned order',function() {
  const readyOld=game(8,'preparation',100),readyNew=game(2,'preparation',300);
  const otherOld=game(9,'preparation',50),otherNew=game(3,'preparation',200);
  otherOld.setup.teams[1].players[0].checked_in=false;otherNew.setup.teams[0].players[0].checked_in=false;
  const t=tournament([game(5),otherNew,readyNew,game(1),readyOld,otherOld]);
  assert.deepStrictEqual(ids(t),[['8','2'],['9','3'],['1','5']]);
 });
 for(const role of ['umpire','service_judge','tabletoperators'])it('includes the assigned '+role+' in readiness',function() {
  const match=game(1,'preparation',100),person=player(999,{checked_in:false});
  match.setup[role]=role==='tabletoperators'?[person]:person;
  assert.deepStrictEqual(ids(tournament([match])),[[],['1'],[]]);person.checked_in=true;
  assert.deepStrictEqual(ids(tournament([match])),[['1'],[],[]]);
 });
 it('does not require officials or tablet operators that have not been assigned',function() {
  assert.deepStrictEqual(ids(tournament([game(1,'preparation',100)])),[['1'],[],[]]);
 });
 it('places missing preparation times last and resolves ties by match order',function() {
  const matches=[game(6,'preparation',null),game(4,'preparation','bad'),game(3,'preparation','100'),game(2,'preparation',100),game(5,'preparation',0)];
  assert.deepStrictEqual(ids(tournament(matches)),[['2','3','4','5','6'],[],[]]);
 });
 it('gives deferred games no preparation priority',function() {
  const deferred=game(1,'preparation',1,{preparation_call_deferred:true});
  assert.deepStrictEqual(ids(tournament([deferred,game(5,'preparation',50),game(3)])),[['5'],[],['1','3']]);
 });
 for(const tablet of [false,true])it('excludes players currently '+(tablet?'operating a tablet':'playing')+' on a court, including a doubles partner',function() {
  const match=game(1,'preparation',100,{is_doubles:true});
  match.setup.teams[0].players.push(player(12));match.setup.teams[1].players.push(player(13));
  const busy=game(2,'oncourt',undefined,{now_on_court:true,court_id:'court-2'});
  if(tablet)busy.setup.tabletoperators=[player('13')];else busy.setup.teams[0].players=[player('13')];
  assert.deepStrictEqual(ids(tournament([match,busy])),[[],[],[]]);
 });
 it('matches queued players by ID including zero, and free-text names without blocking registered namesakes',function() {
  const first=game(1),second=game(2),third=game(3);
  first.setup.teams[0].players=[player(0,{name:'Zero'})];
  second.setup.teams[0].players=[player(88,{name:'Same Name'})];third.setup.teams[0].players=[player(89,{name:'Same Name'})];
  const t=tournament([first,second,third],[{court:null,tabletoperator:[player('0'),player('88',{name:'Same Name'})]}]);
  assert.deepStrictEqual(ids(t),[[],[],['3']]);
  t.tabletoperators.push({court:null,tabletoperator:[player(-1,{name:' same  name '})]});
  assert.deepStrictEqual(ids(t),[[],[],[]]);
 });
 it('ignores old assigned/deleted waiting entries and stale personal activity flags',function() {
  const match=game(1);Object.assign(match.setup.teams[0].players[0],{now_playing_on_court:'old',now_tablet_on_court:'old'});
  const t=tournament([match],[{court:-1,tabletoperator:[player(10)]},{court:'old',tabletoperator:[player(11)]}]);
  assert.deepStrictEqual(ids(t),[[],[],['1']]);
 });
 for(const ended of [{team1_won:false},{btp_winner:2},{end_ts:123}])it('releases people after completion despite old court flags: '+JSON.stringify(ended),function() {
  const match=game(1),old=game(2,'oncourt',undefined,{now_on_court:true,court_id:'old',tabletoperators:[player(10)]});
  Object.assign(old,ended);old.setup.teams[0].players=[player(11)];
  assert.deepStrictEqual(ids(tournament([old,match])),[[],[],['1']]);
 });
 it('requires both complete known teams, preserving named manual participants without registered IDs',function() {
  const partial=game(1,'scheduled',undefined,{is_doubles:true});
  const unknown=game(2);unknown.setup.teams[1].players=[{}];
  const missing=game(3);missing.setup.teams[1].players=[];
  const incomplete=game(4,'scheduled',undefined,{incomplete:true});
  const guest=game(5);guest.setup.teams[0].players=[{name:'Known guest',btp_id:-1}];
  assert.deepStrictEqual(ids(tournament([partial,unknown,missing,incomplete,guest])),[[],[],['5']]);
 });
 it('retains existing exclusions for completed, non-match and BTP-blocked games',function() {
  const ended=game(1,'finished'),nonMatch=game(2,'scheduled',undefined,{is_match:false}),blocked=game(3);
  blocked.setup.teams[1].entry_status='DSQ';
  assert.deepStrictEqual(ids(tournament([ended,nonMatch,blocked])),[[],[],[]]);
 });
 it('does not mutate input order, players, timestamps or match history',function() {
  const t=tournament([game(3),game(1,'preparation',1),game(2)]),before=structuredClone(t),matches=[...t.matches];
  groups(t);assert.deepStrictEqual(t,before);assert(t.matches.every((match,index)=>match===matches[index]));
 });
});
