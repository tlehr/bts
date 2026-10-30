'use strict';

// Opt-in presentation receipts. A received/queued/failed/superseded message is
// never acknowledged as displayed. Two visible animation frames allow the
// browser to perform layout/paint; this does not confirm physical screen output.
// eslint-disable-next-line no-unused-vars -- Shared with the connection and browser measurement client.
var btsAdminUpdates = (function createAdminUpdateObserver(env) {
	const listeners = new Map(), tasks = new WeakMap(), pending = new Set(), latest = new Map();
	let owners = [], sequence = 0, callbackErrors = 0;
	const now = () => env.performance.now();
	const wall = () => (env.Date || Date).now();
	const path = () => env.location?.pathname || '';
	const visible = () => !env.document?.hidden;
	const round = value => Math.round(value * 100) / 100;
	function finish(task, status) {
		if (task.done) return;
		task.done = true;pending.delete(task);env.clearTimeout(task.timeout);
		if (task.frame != null) env.cancelAnimationFrame(task.frame);
		if (latest.get(task.key) === task) latest.delete(task.key);
		const end = now(), presented = status === 'presented';
		const receipt = { type: 'bts-admin-update', sequence: task.id, status,
			measurement_method: 'dom-and-render-opportunity', message: task.message,
			received_at: task.receivedWall, applied_at: task.appliedWall || null, presented_at: presented ? wall() : null,
			visible: visible(), path: task.path,
			timings: { queue_ms: round((task.started ?? end) - task.received), handler_ms: round(task.handlerMs),
				ui_wait_ms: round(Math.max(0, (task.applied ?? end) - (task.started ?? end) - task.handlerMs)),
				render_ms: task.applied == null ? null : round(end - task.applied), total_ms: round(end - task.received) },
			ui_jobs: task.jobs.map(record => ({...record})),
			error: task.error || null };
		for (const [listener,options] of listeners) if(task.message.type!=='local-update'||options.includeLocal) try { listener(receipt); } catch { callbackErrors++; }
		for(const resolve of task.settlers || [])resolve();
	}
	function received(message, timing = {}) {
		if (!listeners.size || message.type==='local-update' && ![...listeners.values()].some(options=>options.includeLocal)) return null;
		if (tasks.has(message)) return tasks.get(message);
		const task = { id: ++sequence, message, received: timing.monotonic ?? now(), receivedWall: timing.wall ?? wall(),
			path: path(), dependencies: 0, promises:new WeakSet(), jobs: [], handlerMs: 0, done: false, frames: 0 };
		tasks.set(message, task);pending.add(task);
		const id = message.val?.match_id ?? message.val?.match__id;
		if (id != null && ['score', 'update_player_status'].includes(message.ctype)) {
			task.key = [message.tournament_key, message.ctype, id].join(':');
			const old = latest.get(task.key);if (old) finish(old, 'superseded');latest.set(task.key, task);
		}
		task.timeout = env.setTimeout(() => finish(task, visible() ? 'timeout' : 'hidden'), 5000);
		if (pending.size > 512) finish(pending.values().next().value, 'capacity');
		return task;
	}
	function settle(task) {
		if (task.done || task.dependencies || task.frame != null || task.applied == null) return;
		if (!visible()) {finish(task, 'hidden');return;}
		task.frame = env.requestAnimationFrame(() => {
			task.frame = null;
			if (task.done) return;
			if (!visible()) {finish(task, 'hidden');return;}
			if (task.path !== path()) {finish(task, 'view_changed');return;}
			if (task.dependencies) task.frames = 0;
			else task.frames++;
			if (task.frames >= 2) finish(task, 'presented');else settle(task);
		});
	}
	function waitFor(promise, task) {
		for (const owner of task ? [task] : owners) {
			if (owner.done || !promise?.then || owner.promises.has(promise)) continue;
			owner.promises.add(promise);owner.dependencies++;
			Promise.resolve(promise).then(() => {
				if (owner.done) return;
				owner.dependencies--;owner.applied=now();owner.appliedWall=wall();owner.frames=0;settle(owner);
			}, error => {owner.dependencies--;owner.error = String(error?.message || error);finish(owner, 'failed');});
		}
		return promise;
	}
	function createJob(name) {
		let resolve, reject, done = false;
		const promise = new Promise((ok, fail) => {resolve=ok;reject=fail;}), requests = new Map();
		promise.catch(()=>{}); // Jobs outside a measured update still rethrow run errors.
		function claim() {
			if (done) return;
			for (const task of owners) {
				if (task.done || requests.has(task)) continue;
				const record = {name, requested_ms:round(now()-task.received), queue_ms:null, work_ms:0, elapsed_ms:null, status:'pending'};
				requests.set(task, {record, start:now()});task.jobs.push(record);waitFor(promise, task);
			}
		}
		function complete(error) {
			if (done) return;
			done=true;
			for (const {record,start} of requests.values()) {record.elapsed_ms=round(now()-start);record.status=error?'failed':'complete';}
			requests.clear();if (error) reject(error);else resolve();
		}
		function run(callback) {
			const previous=owners, start=now(), running=[...requests.values()];owners=[...requests.keys()].filter(task=>!task.done);
			for (const {record,start:requested} of requests.values()) if(record.queue_ms==null)record.queue_ms=round(start-requested);
			try {return callback();}
			catch(error) {complete(error);throw error;}
			finally {
				for (const {record} of running) record.work_ms=round(record.work_ms+now()-start);
				owners=previous;
			}
		}
		// Register when the work is requested. Reusing a scheduled batch claims
		// that same job explicitly; other pending jobs never become dependencies.
		claim();return {promise,claim,run,complete};
	}

	function invoke(tasks, callback, args) {
		const previous = owners;owners = tasks.filter(task=>!task.done);
		const start = now();
		try {return callback(...args);}
		catch (error) {for(const task of owners) {task.error = String(error?.message || error);finish(task, 'failed');}throw error;}
		finally {for(const task of owners)task.handlerMs += now() - start;owners = previous;}
	}
	function dispatch(message, callback) {
		if (owners.some(task=>task.message === message)) return callback(message);
		const task = tasks.get(message) || received(message);
		if (!task || task.done) return callback(message);
		task.started = now();
		const result = invoke([task], callback, [message]);
		if (result === false) {finish(task, 'ignored');return result;}
		task.applied = now();task.appliedWall = wall();waitFor(result, task);settle(task);return result;
	}
	function wrapCallback(callback) {
		const tasks = owners.filter(task=>!task.done);
		if (!tasks.length) return callback;
		for(const task of tasks)task.dependencies++;let complete = false;
		return function(...args) {
			let result;
			try {
				result = invoke(tasks, callback, args);
				for(const task of tasks) {
					if(task.done)continue;
					if(args[0]) {task.error=String(args[0].message || args[0]);finish(task,'failed');continue;}
					task.applied=now();task.appliedWall=wall();task.frames=0;waitFor(result, task);
				}
				return result;
			}
			finally {
				if (!complete && result !== 'keep') {complete = true;for(const task of tasks) {task.dependencies--;settle(task);}}
			}
		};
	}
	const api = { received, dispatch, waitFor, wrapCallback, createJob,
		subscribe(listener,options = {}) {listeners.set(listener,options);return () => {listeners.delete(listener);if (!listeners.size) for (const task of [...pending]) finish(task, 'cancelled');};},
		isActive: message => owners.some(task=>task.message === message),
		isDispatching: () => owners.some(task=>!task.done),
		hasSubscribers: () => listeners.size > 0,
		hasLocalSubscribers: () => [...listeners.values()].some(options=>options.includeLocal),
		whenSettled: () => Promise.all([...pending].filter(task=>task.message.type!=='local-update').map(task=>new Promise(resolve=>{(task.settlers ||= []).push(resolve);}))),
		drop(message, reason) {const task = tasks.get(message);if (task) finish(task, reason);},
		reset() {for (const task of [...pending]) finish(task, 'connection_lost');},
		stats: () => ({ pending: pending.size, subscribers: listeners.size, callbackErrors }) };
	if (typeof module !== 'undefined' && module.exports) module.exports = createAdminUpdateObserver;
	if (typeof env.__btsAdminObserverReady === 'function') env.__btsAdminObserverReady(api);
	return api;
})(typeof window === 'undefined' ? { performance: { now: () => Date.now() }, Date, setTimeout, clearTimeout } : window);
