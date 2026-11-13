'use strict';
const assert=require('assert'),server=require('../bts/admin_response/event_updates'),client=require('../static/js/event_updates');
const copy=value=>JSON.parse(JSON.stringify(value));
const catalog=()=>({meta:'root',events:Array.from({length:4},(_,id)=>({id,name:'Event '+id,stages:[{id:12,entries:Array.from({length:80},(_,id)=>({id,name:'Person '+id,checked_in:false,team:{players:[{name:'Player '+id,pause_ts:100}]}}))}]}))});
function setup(format=2){const ws={},snapshot={events:catalog()};server.finish(server.begin(ws,'test',format),snapshot);return {ws,snapshot,tournament:copy(snapshot),data:copy(snapshot.events)};}
describe('individual live catalog entry updates',function(){
 it('transfers one changed entry without resending its discipline, preserving exact full JSON',function(){
  const {ws,tournament,data}=setup();data.events[1].stages[0].entries[45].checked_in=true;
  const delta=copy(server.prepare({events:data})(ws,'test'));assert.strictEqual(delta.events_delta.patched.length,1);assert.strictEqual(delta.events_delta.changed.length,0);assert(JSON.stringify(delta).length<JSON.stringify(data.events[1]).length/10);
  assert.strictEqual(JSON.stringify(client.apply(tournament,delta)),JSON.stringify(data));
 });
 it('keeps older negotiated clients on whole-discipline updates and legacy clients on full catalogs',function(){
  const old=setup(true),modern=setup();old.data.events[0].name='Updated';modern.data=copy(old.data);
  const delivery=server.prepare({events:modern.data}),one=copy(delivery(old.ws,'test')),two=copy(delivery(modern.ws,'test')),legacy=delivery({},'test');
  assert(!one.events_delta.patched);assert.strictEqual(one.events_delta.changed.length,1);assert(two.events_delta.patched);assert.deepStrictEqual(legacy,{events:modern.data});
  assert.deepStrictEqual(client.apply(old.tournament,one),modern.data);assert.deepStrictEqual(client.apply(modern.tournament,two),modern.data);
 });
 it('retains additions, deletions, nulls, resized arrays, key order and sequence baselines',function(){
  const {ws,tournament,data}=setup();
  const changes=[d=>{d.events[1].stages[0].entries[2].team.players[0].pause_ts=999;},d=>{delete d.events[1].stages[0].entries[2].name;},d=>{d.events[1].stages[0].entries[2].extra=null;},d=>{d.events[1].stages[0].entries.push({id:99,name:'New'});},d=>{d.events[2]={name:'Reordered keys',...d.events[2]};},d=>{d.events[2].stages.reverse();},d=>{d.events.splice(0,1);},d=>{d.events.push({id:111,name:'Added',stages:[]});}];
  for(let i=0;i<70;i++)changes.push(d=>{const e=d.events[0].stages[0].entries[i%80];e.checked_in=!e.checked_in;e.team.players[0].pause_ts=i*37;});
  for(const change of changes){change(data);const value=copy(server.prepare({events:data})(ws,'test'));const applied=client.apply(tournament,value);assert.strictEqual(JSON.stringify(applied),JSON.stringify(data));tournament.events=applied;}
 });
 it('rejects invalid paths, duplicate records and identity changes atomically',function(){
  const {ws,tournament,data}=setup();data.events[0].name='Changed';const value=copy(server.prepare({events:data})(ws,'test')),before=copy(tournament);
  for(const change of [d=>{d.patched[0].changes[0].path=['__proto__','polluted'];},d=>{d.patched[0].changes[0].path=['stages',999,'entries'];},d=>{d.patched.push(copy(d.patched[0]));},d=>{d.patched[0].changes=[{path:['id'],value:999}];},d=>{d.patched[0].changes=[{path:['stages',0,'entries',0],remove:true}];},d=>{d.patched[0].changes=[{path:['missing','name'],value:'X'}];}]){
   const broken=copy(value);change(broken.events_delta);assert.strictEqual(client.apply(tournament,broken),null);assert.deepStrictEqual(tournament,before);assert.strictEqual({}.polluted,undefined);
  }
 });
});
