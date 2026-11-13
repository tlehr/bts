'use strict';

const assert=require('assert');
const create=require('../static/js/ui_blocking_diagnostics');
const createUpdates=require('../static/js/admin_update_observer');
function fixture() {
	let time=0,id=0;const timers=new Map(),frames=new Map();
	const env={performance:{now:()=>time,timeOrigin:1000},Date:{now:()=>time+1000},
		setTimeout:callback=>{timers.set(++id,callback);return id;},clearTimeout:key=>timers.delete(key),
		requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:key=>frames.delete(key)};
	const recorder=create(env);env.btsUiBlocking=recorder;
	return {env,recorder,timers,advance:ms=>{time+=ms;},frame:()=>{time+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback());}};
}
describe('bounded UI blocking diagnosis',function() {
	it('is inactive on ordinary pages and installs no timers or observers',function() {
		const f=fixture();assert.strictEqual(f.recorder.begin('ordinary'),null);assert.strictEqual(f.timers.size,0);
		assert.strictEqual(f.recorder.snapshot().enabled,false);assert.deepStrictEqual(f.recorder.snapshot().segments,[]);
	});
	it('retains foreign background work before a later point, with exact synchronous slices and owner identity',function() {
		const f=fixture();f.recorder.start();const observer=createUpdates(f.env),receipts=[];observer.subscribe(row=>receipts.push(row));
		const foreign=observer.createJob('names.layout');foreign.run(()=>f.advance(90));foreign.complete();
		const message={type:'change',ctype:'score',tournament_key:'test',val:{match_id:'game',debug_trace_id:'point-1',private:'do not copy'}};
		observer.dispatch(message,()=>f.advance(2));f.frame();f.frame();
		const data=f.recorder.snapshot(1000,1200);assert.strictEqual(receipts.length,1);
		assert.strictEqual(data.segments[0].name,'job:names.layout');assert.strictEqual(data.segments[0].duration_ms,90);
		assert.deepStrictEqual(data.segments[0].updates,[]);assert.strictEqual(data.segments[1].duration_ms,2);
		assert.strictEqual(data.segments[1].updates[0].match_id,'game');assert.strictEqual(data.segments[1].updates[0].trace_id,'point-1');
		assert(!JSON.stringify(data).includes('do not copy'));assert.deepStrictEqual(receipts[0].ui_jobs,[]);f.recorder.stop();
	});
	it('gives shared jobs one identifier while recording each real execution slice once',function() {
		const f=fixture();f.recorder.start();const observer=createUpdates(f.env),receipts=[];observer.subscribe(row=>receipts.push(row));let job;
		observer.dispatch({type:'change',ctype:'match_edit',val:{match__id:'one'}},()=>{job=observer.createJob('shared');});
		observer.dispatch({type:'change',ctype:'match_edit',val:{match__id:'two'}},()=>job.claim());
		job.run(()=>f.advance(40));job.run(()=>f.advance(10));job.complete();
		const slices=f.recorder.snapshot().segments.filter(row=>row.name==='job:shared');
		assert.strictEqual(slices.length,2);assert.strictEqual(slices[0].job_id,slices[1].job_id);
		assert.deepStrictEqual(slices[0].updates.map(row=>row.match_id),['one','two']);assert.deepStrictEqual(slices.map(row=>row.duration_ms),[40,10]);
		f.recorder.stop();
	});
	it('caps history, preserves chronological order and reports overwritten records',function() {
		const f=fixture();f.recorder.start();
		for(let i=0;i<4200;i++){const token=f.recorder.begin('slice-'+i);f.advance(1);f.recorder.end(token);}
		const snapshot=f.recorder.snapshot(1000,10000);assert.strictEqual(snapshot.segments.length,4096);
		assert.strictEqual(snapshot.segments[0].name,'slice-104');assert.strictEqual(snapshot.segments.at(-1).name,'slice-4199');
		assert.strictEqual(snapshot.overwritten.segments,104);assert.strictEqual(f.recorder.snapshot(5190,5200).segments.length,11);
		f.recorder.stop();assert.strictEqual(f.timers.size,0);
	});
	it('collects delayed native long-frame records with source attribution and forced-layout duration',function() {
		const f=fixture(),observers=[];
		f.env.PerformanceObserver=class {
			static supportedEntryTypes=['longtask','long-animation-frame'];
			constructor(callback){this.callback=callback;this.entries=[];observers.push(this);}
			observe({type}){this.type=type;}takeRecords(){return this.entries.splice(0);}disconnect(){this.disconnected=true;}
		};
		f.recorder.start();observers.find(row=>row.type==='long-animation-frame').entries.push({startTime:1,duration:90,blockingDuration:40,
			scripts:[...Array.from({length:16},()=>({startTime:1,duration:1})),{startTime:2,duration:80,forcedStyleAndLayoutDuration:44,sourceFunctionName:'refreshNames',sourceURL:'/static/js/cleitstand.js',sourceCharPosition:123}]});
		const frame=f.recorder.snapshot(1000,1200).frames[0];assert.strictEqual(frame.blocking_ms,40);
		assert.strictEqual(frame.scripts[0].function,'refreshNames');assert.strictEqual(frame.scripts[0].forced_style_layout_ms,44);
		assert.strictEqual(frame.script_count,17);assert.strictEqual(frame.omitted_scripts,1);
		f.recorder.stop();assert(observers.every(observer=>observer.disconnected));
	});
	it('records event-loop lateness without a continuous animation loop',function() {
		const f=fixture();f.recorder.start();const [key,callback]=[...f.timers][0];f.timers.delete(key);f.advance(185);callback();
		assert.strictEqual(f.recorder.snapshot().lag[0].duration_ms,85);assert.strictEqual(f.timers.size,1);f.recorder.stop();
	});
	it('projects non-score metadata without removing full scores or changing ordinary subscribers',function() {
		const f=fixture(),observer=createUpdates(f.env),projected=[],full=[];
		observer.subscribe(row=>projected.push(row),{metadataOnly:true});observer.subscribe(row=>full.push(row));
		const status={type:'change',ctype:'call_status_changed',val:{match__id:'one',private:{payload:'large'}}};
		observer.dispatch(status,()=>{});f.frame();f.frame();assert.strictEqual(full[0].message,status);
		assert.deepStrictEqual(projected[0].message.val,{match_id:'one'});
		const score={type:'change',ctype:'score',val:{match_id:'one',presses:[{type:'score'}]}};
		observer.dispatch(score,()=>{});f.frame();f.frame();assert.strictEqual(projected[1].message,score);
	});
	it('retains reconnect epochs so an old slow point is tied to its original socket',function() {
		const f=fixture();f.recorder.start();f.recorder.connection({connection_id:'first'});f.advance(100);
		f.recorder.connection({connection_id:null});f.advance(10);f.recorder.connection({connection_id:'second'});
		f.recorder.connection({connection_id:'second'});
		const history=f.recorder.snapshot().connections;assert.strictEqual(history.length,3);
		assert.strictEqual(history.filter(row=>row.start_ms<=50).at(-1).connection_id,'first');
		assert.strictEqual(f.recorder.connection().connection_id,'second');f.recorder.stop();
	});
});
