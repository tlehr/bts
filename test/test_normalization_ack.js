'use strict';
const assert=require('assert');
const admin=require('../bts/admin');
const database=require('../bts/database');

describe('pronunciation normalization acknowledgements',function(){
 let app,changes;
 beforeEach(async function(){changes=[];app={db:await database.init_test(),speech:{changed:(key,type,value)=>changes.push({key,type,value})}};});
 const invoke=(handler,app,message)=>new Promise(resolve=>handler(app,{respond:(request,error,value)=>resolve({request,error,value})},message));
 it('acknowledges the saved rule after its live notification',async function(){
  const message={tournament_key:'test',normalization:{origin:'Name',replace:'Nah-me',language:'de-DE'}};
  const reply=await invoke(admin.handle_normalization_add,app,message);
  assert.ifError(reply.error);assert.strictEqual(reply.request,message);assert(reply.value.normalization._id);
  assert.strictEqual((await app.db.normalizations.find_async({})).length,1);
  assert.strictEqual(changes[0].type,'normalization_add');assert.deepStrictEqual(changes[0].value.normalization,reply.value.normalization);
 });
 it('returns add failures without a false live notification',async function(){
  const error=new Error('insert failed');app.db.normalizations.insert=(_rule,callback)=>callback(error);
  const reply=await invoke(admin.handle_normalization_add,app,{tournament_key:'test',normalization:{origin:'A',replace:'B'}});
  assert.strictEqual(reply.error,error);assert.strictEqual(changes.length,0);
 });
 it('acknowledges deletion only after the rule has been removed',async function(){
  await new Promise((resolve,reject)=>app.db.normalizations.insert({_id:'rule',origin:'A',replace:'B'},error=>error?reject(error):resolve()));
  const reply=await invoke(admin.handle_normalization_remove,app,{tournament_key:'test',normalization_id:'rule'});
  assert.ifError(reply.error);assert.deepStrictEqual(await app.db.normalizations.find_async({}),[]);
  assert.strictEqual(changes[0].type,'normalization_removed');assert.strictEqual(changes[0].value.normalization_id,'rule');
 });
 it('returns remove failures without announcing a deletion',async function(){
  const error=new Error('remove failed');app.db.normalizations.remove=(_query,_options,callback)=>callback(error);
  const reply=await invoke(admin.handle_normalization_remove,app,{tournament_key:'test',normalization_id:'rule'});
  assert.strictEqual(reply.error,error);assert.strictEqual(changes.length,0);
 });
 it('rejects a missing tournament on add',async function(){assert((await invoke(admin.handle_normalization_add,app,{normalization:{}})).error);});
 it('rejects a missing rule identifier on remove',async function(){assert((await invoke(admin.handle_normalization_remove,app,{tournament_key:'test'})).error);});
});
