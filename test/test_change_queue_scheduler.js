
'use strict';
const assert=require('assert'),vm=require('vm'),fs=require('fs');
describe('prioritized browser queue scheduling',function(){
 it('promotes pending work, ignores cancelled tickets and retains urgency on wake',function(){
  const tasks=[],events=new Map(),window={AbortController,scheduler:{postTask(callback,options){tasks.push({callback,...options});return Promise.resolve();}},addEventListener(name,fn){events.set(name,fn);}};
  const context=vm.createContext({window,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync(require.resolve('../static/js/change_queue_scheduler'),'utf8'),context);
  let count=0;const scheduler=context.change_queue_scheduler(()=>count++);scheduler.schedule();scheduler.schedule();assert.strictEqual(tasks.length,1);assert.strictEqual(tasks[0].priority,'user-visible');scheduler.schedule(true);assert.strictEqual(tasks.length,2);assert(tasks[0].signal.aborted);assert.strictEqual(tasks[1].priority,'user-blocking');scheduler.schedule(true);assert.strictEqual(tasks.length,2);tasks[0].callback();assert.strictEqual(count,0);events.get('pageshow')();assert(tasks[1].signal.aborted);assert.strictEqual(tasks[2].priority,'user-blocking');tasks[1].callback();tasks[2].callback();assert.strictEqual(count,1);scheduler.schedule();scheduler.cancel();tasks[3].callback();assert.strictEqual(count,1);
 });
});
