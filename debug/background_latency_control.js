'use strict';
/* global window, btsAdminUpdates */
// Control run: same product UI and two-frame score receipt, without copying
// multi-megabyte non-score receipts into DevTools or enabling Network payloads.
const fs = require('fs'), path = require('path');
const bridge = require('./testclient_bridge');
const {BrowserAdminSocket, CDP} = bridge.load('reception/browser_admin');
function observe() {
	const state = window.__backgroundControl = {origin:performance.timeOrigin, frames:[], jobs:[]};
	const Native = window.WebSocket;
	window.WebSocket = class extends Native {
		constructor(...args) {
			super(...args);
			this.addEventListener('message', event => {
				if(typeof event.data!=='string')return;
				const header=event.data.slice(0,350)+' '+event.data.slice(-350);
				state.frames.push({wall:Date.now(), start:performance.now(), bytes:event.data.length,
					type:/"ctype":"([^"]+)"/.exec(header)?.[1] || /"type":"([^"]+)"/.exec(header)?.[1]});
			});
		}
	};
	window.__backgroundControlReady = () => {
		const create = btsAdminUpdates.createJob;
		btsAdminUpdates.createJob = function(name) {
			const job=create.call(this,name),run=job.run;
			job.run=callback=>run(()=>{const start=performance.now();try{return callback();}finally{const end=performance.now();state.jobs.push({name,start,end,duration:end-start});}});
			return job;
		};
	};
}
async function main() {
	// The control probe below owns its own CPU recording.
	process.env.BTS_BROWSER_DIAGNOSTICS='0';
	const directory=path.resolve(process.argv[2]);fs.mkdirSync(directory,{recursive:true});
	process.env.BTS_BROWSER_NO_SANDBOX='1';process.env.BTS_TESTCLIENT_REPORT_DIR=path.join(directory,'archive');
	const call=CDP.prototype.call;
	CDP.prototype.call=function(method,params) {
		if(method==='Page.addScriptToEvaluateOnNewDocument')params={...params,source:'('+observe.toString()+')();'+params.source.replace(
			'receipt=>window.__btsAdminMeasurement(JSON.stringify({kind:\'receipt\',receipt}))',
			'receipt=>{if(receipt.message.ctype===\'score\')window.__btsAdminMeasurement(JSON.stringify({kind:\'receipt\',receipt}));}')};
		return call.call(this,method,params);
	};
	const receipts=fs.createWriteStream(path.join(directory,'receipts.jsonl'));
	const browser=new BrowserAdminSocket('wss://localhost:4433/ws/admin',{tournamentKey:'default',onReceipt:receipt=>receipts.write(JSON.stringify(receipt)+'\n')});
	browser.on('error',error=>console.error('control-browser',error.message));
	let traceComplete;
	const event=browser.event;
	browser.event=function(message){if(message.method==='Tracing.tracingComplete')traceComplete?.(message.params.stream);return event.call(this,message);};
	try {
		await browser.started;
		await browser.cdp.evaluate('window.__backgroundControlReady()');
		await browser.cdp.call('Performance.enable');
		const wallBefore=Date.now(), metrics=await browser.cdp.call('Performance.getMetrics'), wallAfter=Date.now();
		const timestamp=metrics.metrics.find(metric=>metric.name==='Timestamp').value;
		fs.writeFileSync(path.join(directory,'clock.json'),JSON.stringify({wallBefore,wallAfter,timestamp,offset:(wallBefore+wallAfter)/2-timestamp*1000,uncertainty_ms:wallAfter-wallBefore}));
		await browser.cdp.call('Profiler.enable');await browser.cdp.call('Profiler.start');
		await browser.cdp.call('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
		console.log('control-started',Date.now());
		const driver=bridge.load('live_tournament_drill');
		const options=driver.parse_args(['--max-runtime-ms','120000','--expected-matches','584','--seed','519','--score-one-active',
			'--point-min-ms','3200','--point-max-ms','6400','--admin-reception-only','--plain-log','--report',path.join(directory,'report.json')]);
		await driver.run(options);
		const cpu=await browser.cdp.call('Profiler.stop');fs.writeFileSync(path.join(directory,'browser.cpuprofile'),JSON.stringify(cpu.profile));
		fs.writeFileSync(path.join(directory,'background.json'),JSON.stringify(await browser.cdp.evaluate('window.__backgroundControl')));
		const complete=new Promise(resolve=>traceComplete=resolve);await browser.cdp.call('Tracing.end');
		const handle=await complete,stream=fs.createWriteStream(path.join(directory,'trace.json'));let part;
		do {part=await browser.cdp.call('IO.read',{handle,size:1048576});if(!stream.write(part.data))await new Promise(resolve=>stream.once('drain',resolve));}while(!part.eof);
		await browser.cdp.call('IO.close',{handle});await new Promise(resolve=>stream.end(resolve));
		console.log('control-complete',Date.now());
	} finally {await browser.dispose();await new Promise(resolve=>receipts.end(resolve));CDP.prototype.call=call;}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
