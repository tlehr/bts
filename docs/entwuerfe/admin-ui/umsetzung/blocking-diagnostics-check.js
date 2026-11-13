'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {BlockingCapture}=require('../../../../debug/testclient_bridge').load('reception/blocking_capture');
module.exports=async function({c,open,previews}) {
	const capture=new BlockingCapture(c),checks=[];
	const check=(name,value)=>{assert(value,name);checks.push(name);};
	await capture.start();
	await c.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.__btsUiBlockingEnabled=true;'});
	try {
		await open(1920,1080);
		await c.evaluate(`window.__oldDiagnosticConnection=conn_ui;window.conn_ui={...conn_ui,send:(message,callback)=>message.type==='debug_queue_stats'?callback(null,{connection_id:'isolated-browser',server_time:Date.now()}):__oldDiagnosticConnection.send(message,callback)};`);
		await capture.pageReady();
		check('The real page enables the flight recorder and exposes versioned asset paths',capture.page.enabled&&capture.page.assets.some(url=>url.includes('ui_blocking_diagnostics.js')));
		check('The measured page has its own server connection identity',capture.page.connection.connection_id==='isolated-browser');
		await capture.rotate();
		const message={type:'change',ctype:'score',tournament_key:'preview',val:{match_id:'match-44',debug_trace_id:'isolated-blocking-point',network_score:[[6,5]],presses:[]}};
		capture.controlMessage(message,Date.now());
		await c.evaluate(`(()=>{
			window.__blockingReceipt=null;window.__blockingRows=[...document.querySelectorAll('tr[data-match_id]')];
			btsAdminUpdates.subscribe(receipt=>{if(receipt.message.val?.debug_trace_id==='isolated-blocking-point')window.__blockingReceipt=receipt;},{metadataOnly:true});
			window.blockingFixtureWork=function blockingFixtureWork(){const until=performance.now()+110;while(performance.now()<until){};};
			setTimeout(()=>{const job=btsAdminUpdates.createJob('fixture.foreign.layout');job.run(()=>blockingFixtureWork());job.complete();btsAdminUpdates.dispatch(${JSON.stringify(message)},message=>crouting.on_change(message));},0);
		})()\n//# sourceURL=bts-blocking-fixture.js`);
		const receipt=await c.evaluate(`(async()=>{const until=performance.now()+4000;while(!window.__blockingReceipt&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,20));return window.__blockingReceipt;})()`);
		check('The native point still completes its normal two-frame presentation receipt',receipt?.status==='presented');
		const link=capture.receipt(receipt);check('Independent receipt timing triggers a named outlier window',link.blocking_window_id===1);
		await capture.flush();const report=capture.snapshot(),window=report.windows[0];
		check('The complete outlier window survives JSON export',JSON.parse(JSON.stringify(report)).windows[0].trace_id==='isolated-blocking-point');
		check('The earlier unrelated task is present even though it is not the point’s dependency',window.browser.segments.some(row=>row.name==='job:fixture.foreign.layout'&&row.duration_ms>=100&&row.updates.length===0));
		check('The point handler is tied to the exact game and trace identifier',window.browser.segments.some(row=>row.name==='handler:score'&&row.updates.some(update=>update.trace_id==='isolated-blocking-point'&&update.match_id==='match-44')));
		check('The CPU samples identify the deliberately blocking function and its source',window.cpu.some(chunk=>chunk.self.some(row=>row.function==='blockingFixtureWork'&&row.source.includes('bts-blocking-fixture.js')&&row.sampled_ms>=20)));
		check('Rotating the profiler retains the outlier across recording chunks',report.stats.rotations>=2&&window.cpu_chunks.length>=1);
		check('The report summary names the overlapping background job and sampled function',window.summary.recorded_work.some(row=>row.name==='job:fixture.foreign.layout'&&row.overlap_ms>=100)&&window.summary.cpu_functions.some(row=>row.function==='blockingFixtureWork'));
		check('Native long tasks or long animation frames identify the actual stall',window.browser.longtasks.some(row=>row.duration_ms>=100)||window.browser.frames.some(row=>row.duration_ms>=100));
		check('The diagnostic run retains existing game rows',await c.evaluate('__blockingRows.every(row=>row.isConnected)'));
		check('No full WebSocket payload tracing is enabled',!c.events.some(event=>event.method==='Network.webSocketFrameReceived'));
		check('Diagnostic capture introduces no browser exceptions',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
		fs.writeFileSync(path.join(previews,'blocking-diagnostics-verification.json'),JSON.stringify({checks,report},null,2)+'\n');
		process.stdout.write(JSON.stringify({checks:checks.length,windows:report.windows.length,errors:report.errors,cpu:window.cpu.map(row=>row.self.slice(0,5))})+'\n');
	} finally {await capture.close();}
};
