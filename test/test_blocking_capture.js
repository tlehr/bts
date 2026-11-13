'use strict';
const assert=require('assert');
const {BlockingCapture,cpuSummary}=require('../debug/testclient_bridge').load('reception/blocking_capture');
const {EventEmitter}=require('events');
const outbox=require('../bts/admin_response/outbox');
const traces=require('../bts/performance/traces');
describe('blocking evidence and report correlation',function() {
	function cpuFixture() {
		let now=1000,paused=false;
		const calls=[];
		const cdp={call:async(method)=>{
			calls.push(method);
			if(method==='Performance.getMetrics')return{metrics:[{name:'Timestamp',value:1}]};
			if(method==='Profiler.stop')return{profile:{startTime:1000000,endTime:now*1000,nodes:[],samples:[],timeDeltas:[]}};
			return{};
		},evaluate:async()=>({enabled:true,time_origin:0,segments:[],connections:[]})};
		const capture=new BlockingCapture(cdp,{wall:()=>now,rotationAllowed:()=>paused,
			setInterval:()=>({unref(){}}),clearInterval:()=>{},setTimeout:callback=>{callback();return 1;}});
		return{capture,calls,advance:ms=>{now+=ms;},pause:()=>{paused=true;},now:()=>now};
	}
	it('keeps CPU sampling continuous under load and rotates only after paused score traffic drains',async function() {
		const f=cpuFixture();await f.capture.start();
		for(let n=0;n<12;n++){f.advance(15000);await f.capture.pollRotation();}
		assert.strictEqual(f.calls.filter(name=>name==='Profiler.start').length,1);
		assert.strictEqual(f.calls.filter(name=>name==='Profiler.stop').length,0);
		f.pause();f.capture.controlMessage({type:'change',ctype:'score',val:{debug_trace_id:'last'}},f.now());
		await f.capture.pollRotation();assert.strictEqual(f.calls.filter(name=>name==='Profiler.stop').length,0);
		f.advance(2001);await f.capture.pollRotation();
		assert.strictEqual(f.calls.filter(name=>name==='Profiler.stop').length,1);
		assert.strictEqual(f.calls.filter(name=>name==='Profiler.start').length,2);
		await f.capture.close();
	});
	it('finishes the continuous profile at report flush without another blocking restart and retains its outlier window',async function() {
		const f=cpuFixture();await f.capture.start();f.advance(1000);
		f.capture.receipt({message:{ctype:'score',val:{debug_trace_id:'slow'}},received_at:f.now()-100,presented_at:f.now(),status:'presented',timings:{total_ms:100}});
		await f.capture.flush();const result=f.capture.snapshot();
		assert.strictEqual(result.windows[0].capture_status,'complete');assert.strictEqual(result.windows[0].cpu_chunks.length,1);
		assert.strictEqual(f.calls.filter(name=>name==='Profiler.start').length,1);
		assert.strictEqual(f.capture.profiling,false);await f.capture.close();
	});
	it('bounds CPU capture duration in an unpaused interactive session',async function() {
		const f=cpuFixture();await f.capture.start();f.advance(f.capture.snapshot().limits.cpu_profile_ms);
		await f.capture.pollRotation();await f.capture.pollRotation();
		assert.strictEqual(f.capture.snapshot().stats.cpu_limit_reached,true);
		assert.strictEqual(f.calls.filter(name=>name==='Profiler.stop').length,1);
		assert.strictEqual(f.calls.filter(name=>name==='Profiler.start').length,1);await f.capture.close();
	});
	it('attributes sampled foreground and background stack time to their source functions within the requested interval',function() {
		const profile={startTime:1000000,endTime:1010000,nodes:[{id:1,callFrame:{functionName:'root'},children:[2]},
			{id:2,callFrame:{functionName:'blockingPreparation',url:'cleitstand.js',lineNumber:1700,columnNumber:3},children:[3]},
			{id:3,callFrame:{functionName:'forcedLayout',url:'cleitstand.js',lineNumber:320,columnNumber:4}}],
			samples:[2,3,3,2,1],timeDeltas:[2000,2000,2000,2000,2000]};
		const summary=cpuSummary(profile,10000,11002,11008);
		assert.strictEqual(summary.samples,3);assert.strictEqual(summary.sampled_ms,6);
		assert.strictEqual(summary.self[0].function,'forcedLayout');assert.strictEqual(summary.self[0].sampled_ms,4);
		assert.strictEqual(summary.inclusive.find(row=>row.function==='blockingPreparation').sampled_ms,6);
		assert.strictEqual(summary.self[0].line,320);
	});
	it('links a delayed browser score to the independent receiver and preserves early capture windows',async function() {
		const cdp={evaluate:async()=>({enabled:true,segments:[{name:'foreign background',duration_ms:90}]})};
		const capture=new BlockingCapture(cdp,{cpu:false,setTimeout:callback=>{callback();return 1;}});
		const message={type:'change',ctype:'score',val:{match_id:'game',debug_trace_id:'point'}};
		capture.controlMessage(message,1000);
		capture.controlMessage(message,1050);
		const result=capture.receipt({message,sequence:1,status:'presented',received_at:1150,presented_at:1180,timings:{total_ms:30}});
		assert.strictEqual(result.control_received_at,1000);assert.strictEqual(result.blocking_window_id,1);
		await capture.flush();const report=JSON.parse(JSON.stringify(capture.snapshot()));
		assert.strictEqual(report.windows[0].capture_status,'complete');assert.strictEqual(report.windows[0].trace_id,'point');
		assert.strictEqual(report.windows[0].browser.segments[0].name,'foreign background');assert.strictEqual(report.windows[0].from,250);
		assert(!('key'in report.windows[0]));await capture.close();
	});
	it('records a late control callback without acknowledging it as a browser presentation',async function() {
		const capture=new BlockingCapture({evaluate:async()=>({enabled:true})},{cpu:false,setTimeout:callback=>{callback();}});
		const message={type:'change',ctype:'score',val:{match_id:'one',debug_trace_id:'late'}};
		capture.receipt({message,received_at:100,presented_at:200,status:'presented',timings:{total_ms:100}});
		capture.controlMessage(message,250);await capture.flush();assert.strictEqual(capture.snapshot().windows[0].control_received_at,250);
	});
	it('bounds an entire run without silently replacing the first outliers by its last 40',async function() {
		const capture=new BlockingCapture({evaluate:async()=>({enabled:true})},{cpu:false,setTimeout:callback=>callback()});
		for(let i=0;i<125;i++)capture.receipt({message:{ctype:'score',val:{match_id:String(i)}},received_at:1000+i,presented_at:1200+i,timings:{total_ms:200},status:'presented'});
		await capture.flush();const report=capture.snapshot();assert.strictEqual(report.windows.length,120);
		assert.strictEqual(report.windows[0].match_id,'0');assert.strictEqual(report.stats.over_capacity,5);
		assert.strictEqual(report.stats.triggers,125);
	});
	it('reports unsupported profiling and page capture failures without breaking score recording',async function() {
		const capture=new BlockingCapture({call:async()=>{throw new Error('CDP unavailable');},evaluate:async()=>{throw new Error('closed page');}},
			{setTimeout:callback=>callback()});
		await capture.start();capture.receipt({message:{ctype:'score'},received_at:100,presented_at:300,status:'presented',timings:{total_ms:200}});
		await capture.flush();const data=capture.snapshot();assert.strictEqual(data.profile_available,false);
		assert.strictEqual(data.errors.length,2);assert.strictEqual(data.windows[0].capture_status,'error');await capture.close();
	});
	it('identifies each output socket and traces completion of a score write after the handler has returned',async function() {
		traces.disable();traces.enable();
		const first=new EventEmitter(),second=new EventEmitter();let flushed;
		first.readyState=1;first.send=(_bytes,_options,callback)=>{flushed=callback;};const queue=outbox(first);
		try {
			assert.notStrictEqual(outbox.connection_id(first),outbox.connection_id(second));
			await traces.operation('diagnostic-point',{trace_id:'point'},async()=>queue.send({type:'change',ctype:'score',val:{match_id:'one'}}));
			let row=traces.snapshot(0).completed.find(value=>value.name==='diagnostic-point');
			assert.strictEqual(row.pending_spans,1);assert.strictEqual(row.spans.find(span=>span.kind==='send_enqueue').connection_id,outbox.connection_id(first));
			flushed();row=traces.snapshot(0).completed.find(value=>value.name==='diagnostic-point');assert.strictEqual(row.pending_spans,0);
			assert.strictEqual(row.spans.find(span=>span.kind==='send_flush').status,'ok');
		} finally {first.emit('close');traces.disable();}
	});
	it('keeps ordinary score sends free of diagnostic write callbacks when traces are disabled',function() {
		traces.disable();const ws=new EventEmitter();let arity;ws.send=function(){arity=arguments.length;};
		outbox(ws).send({type:'change',ctype:'score'});assert.strictEqual(arity,2);ws.emit('close');
	});
	it('forwards diagnostic links into the actual dashboard score export and counts shared jobs once',function() {
		const {Dashboard}=require('../debug/testclient_bridge').load('live_tournament_drill');
		const {BrowserAdminSocket}=require('../debug/testclient_bridge').load('reception/browser_admin');
		const dashboard=new Dashboard({tournament_key:'test',quiet:true});
		const value={match_id:'one',court_id:'court',network_score:[[1,0]],presses:[],debug_trace_id:'export-point'};
		dashboard.record_score_sent(value);const sent=dashboard.receipt_traces.get(value.debug_trace_id).sent_ts;
		const socket=new EventEmitter();Object.assign(socket,{receipts:0,outcomes:{},blocking:{receipt:()=>({blocking_window_id:7,control_received_at:sent+4})}});
		socket.on('message',(message,_binary,timing)=>dashboard.record_admin_payload(JSON.parse(message),timing.received_at,timing));
		const receipt={message:{type:'change',ctype:'score',tournament_key:'test',val:value},status:'presented',received_at:sent+100,
			applied_at:sent+101,presented_at:sent+133,ui_jobs:[{job_id:99,name:'shared',work_ms:3}],timings:{total_ms:33}};
		BrowserAdminSocket.prototype.event.call(socket,{method:'Runtime.bindingCalled',params:{name:'__btsAdminMeasurement',payload:JSON.stringify({kind:'receipt',receipt:{...receipt,message:{type:'change',ctype:'match_edit'},status:'superseded',ui_jobs:[{job_id:99,name:'shared',work_ms:0,status:'pending'}]}})}});
		const deliver=()=>BrowserAdminSocket.prototype.event.call(socket,{method:'Runtime.bindingCalled',params:{name:'__btsAdminMeasurement',payload:JSON.stringify({kind:'receipt',receipt})}});
		deliver();deliver();const result=dashboard.receipt_traces.get(value.debug_trace_id);
		assert.strictEqual(result.admin_blocking_window_id,7);assert.strictEqual(result.admin_control_received_ts,sent+4);
		assert.strictEqual(result.admin_presentation_status,'presented');assert.strictEqual(socket.uiJobs.shared.count,3);
		assert.strictEqual(socket.uniqueUiJobs.shared.count,1);assert.strictEqual(socket.uniqueUiJobs.shared.work_ms.sum,3);dashboard.archive.close();
	});
});
