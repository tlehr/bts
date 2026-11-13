'use strict';
/* global window, btsAdminUpdates */

// Diagnostic instrumentation of the existing test client; product handlers,
// point pacing and the presentation receipt endpoint remain unchanged.
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const WebSocket = require('ws');
const bridge = require('./testclient_bridge');
const {BrowserAdminSocket, CDP} = bridge.load('reception/browser_admin');

function instrumentation() {
	const qa = window.__backgroundProbe = {origin:performance.timeOrigin, start:Date.now(), jobs:[], handlers:[], longtasks:[], frames:[], sequence:0};
	function run(label, callback, table) {
		const id = ++qa.sequence, start = performance.now(), mark = 'bts-probe/' + label + '/' + id;
		performance.mark(mark);
		try {return callback();}
		finally {
			const end = performance.now(); table.push({label, start, end, duration:end - start});
			performance.measure(mark, {start:mark, end}); performance.clearMarks(mark); performance.clearMeasures(mark);
		}
	}
	const create = btsAdminUpdates.createJob;
	btsAdminUpdates.createJob = function(name) {
		const job = create.call(this, name), execute = job.run;
		job.run = callback => execute(() => run('job:' + name, callback, qa.jobs));
		return job;
	};
	const dispatch = btsAdminUpdates.dispatch;
	btsAdminUpdates.dispatch = function(message, callback) {
		return run('handler:' + message.ctype, () => dispatch.call(this, message, callback), qa.handlers);
	};
	for (const [type, target] of [['longtask', qa.longtasks], ['long-animation-frame', qa.frames]]) {
		if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
		new PerformanceObserver(list => {for (const entry of list.getEntries()) target.push(entry.toJSON());}).observe({type, buffered:false});
	}
	performance.mark('bts-probe/clock/' + Date.now());
}

async function main() {
	// This standalone probe owns its profiler and must not race the automatic one.
	process.env.BTS_BROWSER_DIAGNOSTICS = '0';
	const args = process.argv.slice(2), directory = path.resolve(args.shift()), inspector = args.shift();
	if (!fs.statSync(directory).isDirectory()) throw new Error('Diagnostic output directory missing');
	fs.writeFileSync(path.join(directory,'instrumentation.json'),JSON.stringify({mode:'full-cpu-timeline-network',
		warning:'Network payload capture, native measurement bindings and timeline marks can amplify delays. Compare with background_latency_control.js; these are diagnostic profiles, not uninstrumented performance results.'}));
	process.env.BTS_TESTCLIENT_REPORT_DIR ||= path.join(directory,'archive');
	const browserStart = BrowserAdminSocket.prototype.start, browserEvent = BrowserAdminSocket.prototype.event, browserDispose = BrowserAdminSocket.prototype.dispose;
	const probes = [];
	BrowserAdminSocket.prototype.event = function(event) {
		const probe = this.backgroundProbe;
		if (probe) {
			if (event.method === 'Tracing.tracingComplete') probe.completeTrace?.(event.params.stream);
			if (event.method === 'Network.requestWillBeSent' && event.params.request.url.includes('probe-clock=')) {
				probe.networkClock = {timestamp:event.params.timestamp, wallTime:event.params.wallTime};
			}
			if (event.method === 'Network.webSocketFrameReceived') {
				const data = event.params.response.payloadData;
				if (typeof data === 'string' && data.includes('"ctype":"score"')) {
					const message = JSON.parse(data); probe.network.push({timestamp:event.params.timestamp, trace_id:message.val?.debug_trace_id || message.val?.trace_id,
					match_id:message.val?.match_id, score:message.val?.network_score});
				}
			}
		}
		return browserEvent.call(this, event);
	};
	BrowserAdminSocket.prototype.start = async function(timeout, launch = spawn) {
		const index = probes.length, prefix = path.join(directory, 'browser-' + index);
		const probe = this.backgroundProbe = {prefix, network:[], receipts:[], started:false, closed:false}; probes.push(probe);
		await browserStart.call(this, timeout, (exe, argv, options) => launch(exe, [...argv, '--log-net-log=' + prefix + '-netlog.json'], options));
		if (this.closed) return;
		const receipt = this.onReceipt;
		this.onReceipt = value => {
			receipt?.(value); probe.receipts.push({type:value.message.ctype, match_id:value.message.val?.match_id || value.message.val?.match__id,
				trace_id:value.message.val?.debug_trace_id || value.message.val?.trace_id,
				received:value.received_at, applied:value.applied_at, presented:value.presented_at, status:value.status, timings:value.timings, jobs:value.ui_jobs});
		};
		await this.cdp.call('Network.enable');
		await this.cdp.evaluate('fetch("/static/icons/check_in.svg?probe-clock="+Date.now()).then(response=>response.text()).then(()=>true)');
		await this.cdp.call('Profiler.enable'); await this.cdp.call('Profiler.setSamplingInterval', {interval:1000});
		await this.cdp.call('Tracing.start', {categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,toplevel', transferMode:'ReturnAsStream'});
		await this.cdp.call('Profiler.start');
		await this.cdp.evaluate('(' + instrumentation.toString() + ')()'); probe.started = true;
		let window = 0;
		probe.timer = setInterval(() => {
			if (probe.windowWork || probe.closed) return;
			probe.windowWork = (async () => {
				const cpu = await this.cdp.call('Profiler.stop'); await this.cdp.call('Profiler.start');
				const part = probe.prefix + '-window-' + window++;
				fs.writeFileSync(part + '.cpuprofile', JSON.stringify(cpu.profile));
				fs.writeFileSync(part + '-jobs.json', JSON.stringify(await this.cdp.evaluate('window.__backgroundProbe')));
				fs.writeFileSync(part + '-receipts.json', JSON.stringify({receipts:probe.receipts, network:probe.network, networkClock:probe.networkClock}));
				console.log('background-probe:window', part);
			})().catch(error => console.error('background-probe:window-error', error.message)).finally(() => {probe.windowWork = null;});
		}, 120000);
		console.log('background-probe:browser-ready', prefix);
	};
	BrowserAdminSocket.prototype.dispose = function() {
		if (this.backgroundDisposing) return this.backgroundDisposing;
		this.backgroundDisposing = (async () => {
			const probe = this.backgroundProbe;
			try {
				if (probe?.started && !probe.closed) {
					probe.closed = true; clearInterval(probe.timer); await probe.windowWork;
					const cpu = await this.cdp.call('Profiler.stop'); fs.writeFileSync(probe.prefix + '.cpuprofile', JSON.stringify(cpu.profile));
					const jobs = await this.cdp.evaluate('window.__backgroundProbe'); fs.writeFileSync(probe.prefix + '-jobs.json', JSON.stringify(jobs));
					const complete = new Promise(resolve => {probe.completeTrace = resolve;}); await this.cdp.call('Tracing.end');
					const handle = await complete, stream = fs.createWriteStream(probe.prefix + '-trace.json');
					let part;
					do {part = await this.cdp.call('IO.read', {handle, size:1048576}); if (!stream.write(part.data)) await new Promise(resolve => stream.once('drain', resolve));} while (!part.eof);
					await this.cdp.call('IO.close', {handle}); await new Promise(resolve => stream.end(resolve));
					fs.writeFileSync(probe.prefix + '-receipts.json', JSON.stringify({receipts:probe.receipts, network:probe.network, networkClock:probe.networkClock}));
				}
			} catch (error) {console.error('background-probe:capture-error', error.stack); process.exitCode = 1;}
			finally {await browserDispose.call(this);}
		})(); return this.backgroundDisposing;
	};
	let nodeSocket, node;
	if (inspector !== '-') {
		nodeSocket = new WebSocket(inspector); await new Promise((resolve, reject) => {nodeSocket.once('open', resolve); nodeSocket.once('error', reject);});
		node = new CDP(nodeSocket, () => {}); await node.call('Profiler.enable'); await node.call('Profiler.setSamplingInterval', {interval:1000}); await node.call('Profiler.start');
	}
	const system = fs.createWriteStream(path.join(directory, 'system.jsonl'));
	const sampler = setInterval(() => system.write(JSON.stringify({wall:Date.now(), cpu:fs.readFileSync('/proc/pressure/cpu', 'utf8'), memory:fs.readFileSync('/proc/pressure/memory', 'utf8'), load:fs.readFileSync('/proc/loadavg', 'utf8')}) + '\n'), 1000);
	try {
		process.env.BTS_BROWSER_NO_SANDBOX = '1';
		const driver = bridge.load('live_tournament_drill'), options = driver.parse_args(args);
		await driver.run(options);
	} finally {
		clearInterval(sampler); await new Promise(resolve => system.end(resolve));
		if (node) {const cpu = await node.call('Profiler.stop'); fs.writeFileSync(path.join(directory, 'server.cpuprofile'), JSON.stringify(cpu.profile)); nodeSocket.close();}
	}
}
if (require.main === module) main().catch(error => {console.error(error.stack); process.exitCode = 1;});
module.exports = {instrumentation};
