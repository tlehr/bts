'use strict';
const assert=require('assert'),create=require('../static/js/timer_updates');
function fixture() {
	let time=0,id=0;const timers=new Map();
	const queue=create({Date:{now:()=>time},setTimeout:(fn,delay)=>{timers.set(++id,{fn,due:time+delay});return id;},clearTimeout:id=>timers.delete(id)});
	return {queue,timers,setTime(value){time=value;},run(timeNow){time=timeNow;const due=[...timers].filter(([,task])=>task.due<=time);for(const [id,task] of due){if(!timers.delete(id))continue;task.fn();}}};
}
describe('Shared local clock updates',function(){
	it('coalesces 200 clock wakeups into one browser task without changing their callbacks',function(){
		const h=fixture(),seen=[];
		for(let n=0;n<200;n++){h.setTime(n%70);h.queue.schedule(()=>seen.push(n),1000);}
		assert.strictEqual(h.timers.size,1);h.run(1000);assert.deepStrictEqual(seen,[0,70,140]);h.run(1100);
		assert.strictEqual(seen.length,200);assert.strictEqual(new Set(seen).size,200);assert.strictEqual(h.timers.size,0);assert.strictEqual(h.queue.stats().batches,2);
	});
	it('never runs a clock early and limits additional scheduling delay to less than 100 ms',function(){
		for(let offset=0;offset<100;offset++){
			const h=fixture();h.setTime(offset);let calls=0;h.queue.schedule(()=>calls++,750);
			const task=[...h.timers.values()][0];assert(task.due>=offset+750&&task.due<offset+850);
			h.run(offset+749);assert.strictEqual(calls,0);h.run(task.due);assert.strictEqual(calls,1);
		}
	});
	it('cancels stopped and replaced clocks without cancelling another pending callback',function(){
		const h=fixture(),seen=[];const stop=h.queue.schedule(()=>seen.push('old'),500);
		h.queue.schedule(()=>seen.push('other'),500);stop();const next=h.queue.schedule(()=>seen.push('new'),600);stop();
		h.run(500);assert.deepStrictEqual(seen,['other']);h.run(600);assert.deepStrictEqual(seen,['other','new']);next();assert.strictEqual(h.queue.stats().pending,0);
	});
	it('runs rescheduled clocks in later tasks and allows callbacks to cancel each other',function(){
		const h=fixture(),seen=[];let cancel;
		h.queue.schedule(()=>{seen.push(1);cancel();h.queue.schedule(()=>seen.push(3),500);},500);
		cancel=h.queue.schedule(()=>seen.push(2),500);h.run(500);assert.deepStrictEqual(seen,[1]);assert.strictEqual(h.timers.size,1);h.run(1000);assert.deepStrictEqual(seen,[1,3]);
	});
	it('catches up after a suspended tab and derives the next deadline from the current time',function(){
		const h=fixture();let calls=0;const update=()=>{calls++;h.queue.schedule(update,1000);};h.queue.schedule(update,1000);h.run(15000);
		assert.strictEqual(calls,1);assert.strictEqual([...h.timers.values()][0].due,16000);
	});
	it('continues the other clock callbacks and rearms after one callback fails',function(){
		const h=fixture();let changed=false;h.queue.schedule(()=>{throw new Error('clock');},500);h.queue.schedule(()=>{changed=true;h.queue.schedule(()=>{},1000);},500);
		assert.throws(()=>h.run(500),/clock/);assert(changed);assert.strictEqual(h.timers.size,1);
	});
});
