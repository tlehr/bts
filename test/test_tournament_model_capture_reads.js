
'use strict';
const assert=require('assert'),{fixture}=require('./tournament_model_fixture');
const wait=()=>new Promise(r=>setImmediate(r));
describe('read-only model capture fast path',function(){
 it('captures before later writes without inserting an idle executor task',async function(){
  const {db}=await fixture();await wait();await wait();const push=db.matches.executor.push;let enqueued=0;
  db.matches.executor.push=function(...args){enqueued++;return push.apply(this,args);};
  const captured=db.model.snapshot('test',['matches']);assert.strictEqual(enqueued,0);
  const updated=db.matches.update_async({_id:'one'},{$set:{network_score:[[7,3]]}},{});
  const before=await captured;await updated;assert.deepStrictEqual(before.matches.find(m=>m._id==='one').network_score,[[0,0]]);
  assert.deepStrictEqual(db.model.tournament('test').matches.get('one').data.network_score,[[7,3]]);
 });
 it('delivers an idle validation result asynchronously with its captured revision',async function(){
  const {db}=await fixture();await wait();await wait();let called=false,score;
  const inspected=new Promise((r,j)=>db.model.inspect_sync_records('matches','test',doc=>{if(doc._id==='one')score=doc.network_score;return false;},(e,v)=>{called=true;e?j(e):r(v);}));
  assert.strictEqual(called,false);const updated=db.matches.update_async({_id:'one'},{$set:{network_score:[[8,4]]}},{});
  assert.strictEqual(await inspected,true);await updated;assert.deepStrictEqual(score,[[0,0]]);
 });
});
