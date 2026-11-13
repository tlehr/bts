'use strict';

// Bounded, opt-in flight recorder. No DOM observation, layout reads, network
// payload copies or per-frame polling. The test browser enables it before load.
// eslint-disable-next-line no-unused-vars -- Used by the update observer and diagnostic client.
var btsUiBlocking = (function createUiBlocking(env) {
	const limits = {segments:4096, longtasks:256, frames:256, lag:256}, buffers = {}, dropped = {};
	let enabled = false, sequence = 0, timer = null, startedAt = null;
	const observers = [], active = new Map(), connections = [];
	let overwrittenConnections=0;
	const mono = () => env.performance.now();
	const origin = () => env.performance.timeOrigin || (env.Date || Date).now() - mono();
	const round = value => Math.round(value * 100) / 100;
	const text = value => typeof value === 'string' ? value.slice(0, 240) : '';
	for (const key of Object.keys(limits)) {buffers[key] = {items:[], next:0};dropped[key] = 0;}
	function retain(key, value) {
		const buffer = buffers[key];
		if (buffer.items.length < limits[key]) buffer.items.push(value);
		else {buffer.items[buffer.next] = value;buffer.next = (buffer.next + 1) % limits[key];dropped[key]++;}
	}
	function rows(key) {
		const {items,next} = buffers[key];return next ? [...items.slice(next), ...items.slice(0,next)] : [...items];
	}
	function entry(key, value) {
		const start = value.startTime, end = start + value.duration;
		const row = {id:++sequence, start_ms:round(start), end_ms:round(end), duration_ms:round(value.duration)};
		if (key === 'frames') {
			Object.assign(row, {blocking_ms:round(value.blockingDuration || 0), render_start_ms:value.renderStart || 0,
				style_layout_start_ms:value.styleAndLayoutStart || 0, first_ui_event_ms:value.firstUIEventTimestamp || 0,
				script_count:(value.scripts || []).length,omitted_scripts:Math.max(0,(value.scripts || []).length-16),
				scripts:[...(value.scripts || [])].sort((a,b)=>b.duration-a.duration).slice(0,16).map(script => ({
					start_ms:script.startTime, duration_ms:script.duration, execution_start_ms:script.executionStart,
					forced_style_layout_ms:script.forcedStyleAndLayoutDuration || 0, pause_ms:script.pauseDuration || 0,
					invoker:text(script.invoker), invoker_type:text(script.invokerType), function:text(script.sourceFunctionName),
					source:text(script.sourceURL), char_position:script.sourceCharPosition,
				}))});
		}
		retain(key,row);
	}
	function drain() {
		for (const {observer,key} of observers) for (const value of observer.takeRecords()) entry(key,value);
	}
	function start() {
		if (enabled) return;
		enabled = true;startedAt = mono();
		const supported = env.PerformanceObserver?.supportedEntryTypes || [];
		for (const [type,key] of [['longtask','longtasks'],['long-animation-frame','frames']]) if (supported.includes(type)) {
			try {
				const observer = new env.PerformanceObserver(list => {for (const value of list.getEntries()) entry(key,value);});
				observer.observe({type,buffered:true});observers.push({observer,key});
			} catch { /* Expose unavailable observers in metadata, keep the recorder usable. */ }
		}
		const heartbeat = () => {
			const expected = mono() + 100;
			timer = env.setTimeout(() => {
				if (!enabled) return;
				const end = mono();
				if (end - expected >= 20) retain('lag',{id:++sequence,start_ms:round(expected),end_ms:round(end),duration_ms:round(end-expected)});
				heartbeat();
			},100);
		};
		heartbeat();
	}
	function stop() {
		if (!enabled) return;
		drain();enabled = false;env.clearTimeout(timer);timer = null;
		for (const {observer} of observers) observer.disconnect();observers.length = 0;active.clear();
	}
	function begin(name, context = {}) {
		if (!enabled) return null;
		const token = {id:++sequence,name:text(name),start_ms:mono(),...context};active.set(token.id,token);return token;
	}
	function end(token) {
		if (!token) return;
		active.delete(token.id);
		if (!enabled) return;
		const end = mono();retain('segments',{...token,start_ms:round(token.start_ms),end_ms:round(end),duration_ms:round(end-token.start_ms)});
	}
	function snapshot(from = (env.Date || Date).now() - 5000, to = (env.Date || Date).now()) {
		drain();const offset = origin(), lower = from - offset, upper = to - offset;
		const result = {version:1,enabled,time_origin:offset,started_ms:startedAt,from,to,limits:{...limits},overwritten:{...dropped,connections:overwrittenConnections},retained_ranges:{},
			connections:connections.map(row=>({...row})),
			observers:observers.map(value=>value.key),active:[...active.values()].slice(0,32).map(value=>({...value}))};
		for (const key of Object.keys(limits)) {
			const all=rows(key);result[key]=all.filter(row=>row.end_ms>=lower && row.start_ms<=upper);
			result.retained_ranges[key]=all.length?{from_ms:Math.min(...all.map(row=>row.start_ms)),to_ms:Math.max(...all.map(row=>row.end_ms))}:null;
		}
		return result;
	}
	function connection(value) {
		if (value===undefined) return connections.at(-1);
		if (!enabled||connections.at(-1)?.connection_id===value.connection_id) return;
		connections.push({connection_id:value.connection_id,server_time:value.server_time,start_ms:round(mono())});
		if(connections.length>32){connections.shift();overwrittenConnections++;}
	}
	const api = {start,stop,begin,end,snapshot,connection,enabled:()=>enabled};
	if (typeof module !== 'undefined' && module.exports) module.exports = createUiBlocking;
	if (env.__btsUiBlockingEnabled === true) start();
	return api;
})(typeof window === 'undefined' ? {performance:{now:()=>Date.now()},Date,setTimeout,clearTimeout} : window);
