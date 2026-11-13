'use strict';
const assert=require('assert'),{ResourceLockQueue}=require('../bts/resource_lock_queue'),foreground=require('../bts/foreground_work');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const point=fn=>Object.assign(fn,{_queue_name:'handle_score_update_v2'});
describe('available point scheduling',function(){
 it('claims a free resource before the next I/O turn while preserving asynchronous execution',async function(){
  const queue=new ResourceLockQueue();let ran=false,release;const held=new Promise(resolve=>{release=resolve;});
  const operation=queue.execute(point(async()=>{ran=true;await held;}),{locks:['match:test:one']});
  assert.strictEqual(ran,false);assert(foreground.busy());await Promise.resolve();assert.strictEqual(ran,true);release();await operation;assert(!foreground.busy());
 });
 it('does not overtake an earlier pending conflicting writer',async function(){
  const queue=new ResourceLockQueue(),order=[];let release;const gate=new Promise(resolve=>{release=resolve;});
  const writer=queue.execute(async()=>{order.push('writer');await gate;},{locks:['match:test:one']});
  const score=queue.execute(point(()=>{order.push('point');}),{locks:['match:test:one']});
  await Promise.resolve();assert.deepStrictEqual(order,[]);await turn();assert.deepStrictEqual(order,['writer']);release();await Promise.all([writer,score]);assert.deepStrictEqual(order,['writer','point']);
 });
 it('can start beside an unrelated active court while retaining conflicting active barriers',async function(){
  const queue=new ResourceLockQueue();let release;const held=new Promise(resolve=>{release=resolve;});
  const first=queue.execute(async()=>held,{locks:['match:test:one']});await turn();let unrelated=false,conflicting=false;
  const other=queue.execute(point(()=>{unrelated=true;}),{locks:['match:test:two']});await Promise.resolve();assert(unrelated);
  const same=queue.execute(point(()=>{conflicting=true;}),{locks:['match:test:one']});await turn();assert(!conflicting);release();await Promise.all([first,other,same]);assert(conflicting);
 });
});
