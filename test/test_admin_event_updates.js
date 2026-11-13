'use strict';
const assert=require('assert'),server=require('../bts/admin_response/event_updates'),client=require('../static/js/event_updates');
const copy=value=>JSON.parse(JSON.stringify(value));
const catalog=()=>({other:'metadata',events:Array.from({length:24},(_,id)=>({id,name:'Event '+id,stages:[{entries:Array.from({length:50},(_,id)=>({id,name:'Player '+id,checked_in:false}))}]}))});
describe('negotiated live event catalog updates',function(){
 it('delivers a small delta, additions/deletions/reorders and unchanged catalogs exactly like a fresh full payload',function(){
  const ws={},snapshot={events:catalog()},ticket=server.begin(ws,'test',true);server.finish(ticket,snapshot);const tournament=copy(snapshot);
  let data=copy(snapshot.events),previousBytes;
  for(const change of [()=>{data.events[4].stages[0].entries[2].checked_in=true;},()=>{data.events.reverse();},()=>{data.events.splice(3,1);},()=>{data.events.push({id:99,name:'New',stages:[]});},()=>{delete data.other;},()=>{}]){
   change();const value=server.prepare({events:data})(ws,'test'),before=copy(tournament);
   assert(value.events_delta);assert(JSON.stringify(value).length<JSON.stringify({events:data}).length*.85);
   assert.deepStrictEqual(client.apply(tournament,copy(value)),data);tournament.events=copy(data);
   previousBytes=JSON.stringify(value).length;assert.strictEqual(before.events_revision,value.events_delta.base);
  }
  assert(previousBytes<1000);
 });
 it('preserves full messages for old clients, missing baselines, invalid IDs and broad edits',function(){
  const value={events:catalog()},delivery=server.prepare(value),old={};assert.strictEqual(delivery(old,'test'),value);
  const ws={};server.begin(ws,'test',true);const first=delivery(ws,'test');assert(first.events&&!first.events_delta);
  const snapshot={events:catalog()};server.finish({ws,key:'test',state:ws.events_delta_states.get('test')},snapshot);
  const all=copy(value);all.events.events.forEach(e=>e.name='X'.repeat(2000));assert(server.prepare(all)(ws,'test').events);
  const broken={events:{events:[{id:1},{id:1}]}};assert.strictEqual(server.prepare(broken)(ws,'test'),broken);
 });
 it('rejects a stale or malformed patch atomically without changing the baseline or catalog',function(){
  const ws={},snapshot={events:catalog()};server.finish(server.begin(ws,'test',true),snapshot);const data=copy(snapshot.events);data.events[1].name='Changed';
  const value=copy(server.prepare({events:data})(ws,'test')),tournament=copy(snapshot),before=copy(tournament);
  for(const mutate of [v=>{v.events_delta.base='wrong';},v=>{v.events_delta.order.push(4444);},v=>{v.events_delta.order.push(v.events_delta.order[0]);},v=>{v.events_delta.changed.push(v.events_delta.changed[0]);}]){
   const invalid=copy(value);mutate(invalid);assert.strictEqual(client.apply(tournament,invalid),null);assert.deepStrictEqual(tournament,before);
  }
  assert.deepStrictEqual(client.apply(tournament,value),data);
 });
 it('keeps notification order around a reserved snapshot, with no baseline overwritten by a later read',function(){
  const ws={},initial=catalog(),ticket=server.begin(ws,'test',true),first=copy(initial);first.events[1].name='First';
  const queued=copy(server.prepare({events:first})(ws,'test'));
  const newer=copy(first);newer.events[2].name='Second';const snapshot={events:newer};server.finish(ticket,snapshot);
  const later=copy(newer);later.events[3].name='Third';const delta=copy(server.prepare({events:later})(ws,'test'));
  const tournament=copy(snapshot);tournament.events=client.apply(tournament,queued);assert.deepStrictEqual(tournament.events,first);
  assert.deepStrictEqual(client.apply(tournament,delta),later);
 });
 it('does not change immutable queued revisions when a sender reuses its mutable input object',function(){
  const ws={},snapshot={events:catalog()};server.finish(server.begin(ws,'test',true),snapshot);const data=copy(snapshot.events);
  data.events[0].name='One';const one=copy(server.prepare({events:data})(ws,'test'));data.events[0].name='Two';const two=copy(server.prepare({events:data})(ws,'test'));
  const tournament=copy(snapshot);tournament.events=client.apply(tournament,one);assert.strictEqual(tournament.events.events[0].name,'One');tournament.events=client.apply(tournament,two);assert.strictEqual(tournament.events.events[0].name,'Two');
 });
});
