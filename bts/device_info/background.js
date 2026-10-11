'use strict';

const timing = require('../offload/timing');
const queues = new WeakMap();

function state_for(db, key) {
	let map = queues.get(db);
	if (!map) { map = new Map(); queues.set(db, map); }
	let state = map.get(key);
	if (!state) { state = { pending: [], active: false, idle: [] }; map.set(key, state); }
	return { state, map };
}

function enqueue(db, key, work, context = {}, coalesce = false) {
	const { state, map } = state_for(db, key);
	if (state.pending.length >= 64) return Promise.reject(new Error('Device info queue full'));
	return new Promise((resolve, reject) => {
		const job = { work, resolve, reject, context, coalesce, queued: process.hrtime.bigint(),
			timing: timing.start('device_info', 'background', context) };
		const previous = state.pending.at(-1);
		if (coalesce && previous?.coalesce) {
			state.pending.pop();
			if (previous.timing) previous.timing.finish(null, { superseded: true });
			previous.resolve({ superseded: true });
		}
		state.pending.push(job);
		if (!state.active) {
			state.active = true;
			setImmediate(async () => {
				while (state.pending.length) {
					const current = state.pending.shift(), started = process.hrtime.bigint();
					let error;
					try { current.resolve(await current.work()); }
					catch (err) { error = err; current.reject(err); }
					finally {
						if (current.timing) current.timing.finish(error, {
							queue_wait_ms: timing.ms(started - current.queued),
							work_ms: timing.ms(process.hrtime.bigint() - started),
						});
					}
				}
				state.active = false; map.delete(key);
				for (const idle of state.idle) idle();
			});
		}
	});
}

function idle(db, key) {
	const state = queues.get(db)?.get(key);
	return !state ? Promise.resolve() : new Promise(resolve => state.idle.push(resolve));
}

module.exports = { enqueue, idle };
