'use strict';
const assert=require('assert'),database=require('../bts/database'),read=require('../bts/admin_response/tournament_read'),encode=require('../bts/admin_response/cooperative'),cache=require('../bts/admin_response/match_cache');
const snapshot=(db,immutable=true)=>new Promise((resolve,reject)=>read(db,'test',immutable,(error,value)=>error?reject(error):resolve(value)));
describe('immutable catalog encoding reuse',function(){
 it('preserves native dates and missing values, captured versions and later registration edits',async function(){
  const db=await database.init_test();await new Promise((resolve,reject)=>db.tournaments.insert({key:'test',events:{events:[{id:1,name:'Player Ä',time:new Date(0),missing:undefined}]}},error=>error?reject(error):resolve()));
  const first=await snapshot(db),message={type:'answer',tournament:first},expected=JSON.stringify(message);
  assert.strictEqual(await encode(message),expected);const before=cache.stats();assert.strictEqual(await encode({type:'answer',tournament:await snapshot(db)}),expected);assert(cache.stats().cache_hits>before.cache_hits);
  await db.tournaments.update_async({key:'test'},{$set:{'events.events':[ {id:1,name:'Changed'} ]}},{});
  assert.strictEqual(await encode(message),expected);
  const next={type:'answer',tournament:await snapshot(db)};assert.strictEqual(await encode(next),JSON.stringify(next));assert.strictEqual(JSON.parse(await encode(next)).tournament.events.events[0].name,'Changed');
  const mutable=await snapshot(db,false);mutable.events.events[0].name='Callback edit';assert.strictEqual(await encode({tournament:mutable}),JSON.stringify({tournament:mutable}));
 });
});
