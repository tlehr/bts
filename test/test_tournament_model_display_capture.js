'use strict';
const assert=require('assert'),{fixture}=require('./tournament_model_fixture');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
describe('direct display read ordering',function(){
 it('captures another game while an ordinary native write persists, but waits for the written game',async function(){
  const {db}=await fixture();const store=db.matches,persist=store.persistence.persistNewState;
  let release,reached;const started=new Promise(resolve=>{reached=resolve;});
  store.persistence.persistNewState=function(docs,done){release=()=>persist.call(this,docs,done);reached();};
  const writing=store.update_async({_id:'two'},{$set:{network_score:[[9,4]]}},{});await started;
  let independentDone=false,targetDone=false;
  const read=id=>new Promise((resolve,reject)=>db.model.read_display_context_part('match','test',id,(error,value)=>error?reject(error):resolve(value)));
  const independent=read('one').then(value=>{independentDone=true;return value;});
  const target=read('two').then(value=>{targetDone=true;return value;});
  try {await turn();assert(independentDone,'another court must not wait for this append');assert.strictEqual(targetDone,false);}
  finally {store.persistence.persistNewState=persist;release();await writing;}
  assert.deepStrictEqual((await independent).network_score,[[0,0]]);assert.deepStrictEqual((await target).network_score,[[9,4]]);
 });
 it('captures the current detached score before a later writer and calls back asynchronously',async function(){
  const {db}=await fixture();await turn();await turn();let enqueued=0,called=false;const push=db.matches.executor.push;
  db.matches.executor.push=function(...args){enqueued++;return push.apply(this,args);};
  const result=new Promise((resolve,reject)=>db.model.read_display_context_part('match','test','one',(error,value)=>{called=true;error?reject(error):resolve(value);}));
  assert.strictEqual(called,false);assert.strictEqual(enqueued,0);
  const write=db.matches.update_async({_id:'one'},{$set:{network_score:[[9,4]]}},{});const value=await result;await write;
  assert.deepStrictEqual(value.network_score,[[0,0]]);value.network_score[0][0]=99;
  assert.deepStrictEqual(db.model.tournament('test').matches.get('one').data.network_score,[[9,4]]);
 });
 it('does not let a certified earlier read delay a current independent capture',async function(){
  const {db}=await fixture();await turn();await turn();let release,started;const held=new Promise(resolve=>{started=resolve;});
  const barrier=require('../bts/database_read_barrier');
  db.matches.executor.push(barrier.certify_read({this:db.matches,fn:done=>{release=done;started();},arguments:[()=>{}]}));
  await held;let value;
  try {value=await new Promise((resolve,reject)=>db.model.read_display_context_part('match','test','one',(error,value)=>error?reject(error):resolve(value)));}
  finally{release();}
  assert.deepStrictEqual(value.network_score,[[0,0]]);
 });
});
