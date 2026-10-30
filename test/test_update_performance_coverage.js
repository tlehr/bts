'use strict';
const assert=require('assert');
const cases=require('../docs/entwuerfe/admin-ui/umsetzung/update-performance-cases');
const {inventory}=require('../docs/entwuerfe/admin-ui/umsetzung/update-performance-check');
const {assess}=require('../docs/entwuerfe/admin-ui/umsetzung/update-performance-budget');
describe('Update performance coverage and budgets',function(){
 it('requires a performance fixture for every main-page update type',function(){assert.deepStrictEqual(inventory().filter(type=>!cases[type]),[]);assert(inventory().length>70);});
 it('rejects slow handlers, delayed rendering, outliers and invalid acknowledgements',function(){
  const sample=(handler=2,total=40,status='presented')=>({status,presented_at:1000,timings:{handler_ms:handler,total_ms:total}});
  assert.strictEqual(assess([sample(),sample(),sample()]).total_ms,40);
  assert.throws(()=>assess([sample(40),sample(40),sample(40)]),/exceeds/);
  assert.throws(()=>assess([sample(2,300),sample(2,300),sample(2,300)]),/exceeds/);
  assert.throws(()=>assess([sample(),sample(),sample(2,250)]),/exceeds/);
  assert.throws(()=>assess([sample(),sample(),sample(NaN,40)]),/completed/);
  for(const status of ['superseded','hidden','failed','ignored'])assert.throws(()=>assess([sample(),sample(),sample(2,40,status)]),/completed/);
 });
});
