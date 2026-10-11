'use strict';

const { Worker } = require('worker_threads');
const timing = require('./timing');

// Separate persistent workers per operation keep their queues measurable and
// prevent an XLSX upload from holding up a sync or a database compaction.
class WorkerClient {
	constructor(operation, filename, options = {}) {
		this.operation = operation;
		this.create_worker = options.create_worker || (() => new Worker(filename));
		this.max_pending = options.max_pending || 64;
		this.timeout_ms = options.timeout_ms || 30000;
		this.pending = [];
		this.worker = null;
		this.active = null;
		this.generation = 0;
		this.next_id = 0;
		this.health = new (require('../performance/queue_stats'))('worker');
		this.unregister_health = require('../performance/registry').register(this, operation, owner => owner.health.snapshot());
	}
	run(payload, context = {}, transfers = []) {
		if (!this.unregister_health) {
			this.health = new (require('../performance/queue_stats'))('worker');
			this.unregister_health = require('../performance/registry').register(this, this.operation, owner => owner.health.snapshot());
		}
		if (this.pending.length >= this.max_pending) { this.health.rejected++; return Promise.reject(new Error(this.operation + ' worker queue full')); }
		return new Promise((resolve, reject) => {
			const job = { id: ++this.next_id, payload, context, transfers, resolve, reject,
				queued: process.hrtime.bigint(), timing: timing.start(this.operation, 'worker', context) };
			job.timer = setTimeout(() => {
				if (this.active === job) {
					this.active = null; this.retire();
				} else this.pending = this.pending.filter(other => other !== job);
				this.finish(job, new Error(this.operation + ' worker timed out'));
				this.dispatch();
			}, this.timeout_ms);
			job.health = this.health.enqueue(this.operation);
			this.pending.push(job); this.dispatch();
		});
	}
	get_worker() {
		if (this.worker) return this.worker;
		const worker = this.create_worker();
		this.worker = worker;
		worker.on('message', message => {
			if (this.worker !== worker || this.active?.id !== message.id) return;
			const received = process.hrtime.bigint(), job = this.active;
			this.active = null; worker.unref();
			const error = message.error ? Object.assign(new Error(message.error.message), message.error) : null;
			this.finish(job, error, message.value, { worker_ms: timing.ms(message.returning - message.started),
				worker_start_ts: message.worker_start_ts, worker_end_ts: message.worker_end_ts,
				input_wait_ms: Math.max(0, timing.ms(message.started - job.dispatched)),
				return_delivery_ms: timing.ms(received - message.returning) });
			this.dispatch();
		});
		const failed = error => {
			if (this.worker !== worker) return;
			const job = this.active; this.active = null; this.retire();
			if (job) this.finish(job, error);
			this.dispatch();
		};
		worker.on('error', failed);
		worker.on('exit', code => failed(new Error(this.operation + ' worker exited (' + code + ')')));
		return worker;
	}
	dispatch() {
		if (this.active || !this.pending.length) return;
		const job = this.pending.shift();
		this.active = job; job.dispatching = process.hrtime.bigint();
		this.health.start(job.health);
		job.dispatch_start_ts = Date.now();
		try {
			const worker = this.get_worker(); worker.ref();
			worker.postMessage({ id: job.id, payload: job.payload }, job.transfers);
			job.dispatched = process.hrtime.bigint();
			job.payload = job.transfers = null;
		} catch (error) {
			this.active = null; this.retire(); this.finish(job, error);
			queueMicrotask(() => this.dispatch());
		}
	}
	finish(job, error, value, details = {}) {
		require('../performance/traces').import_phases(job.health.run_span, value?.diagnostic_phases);
		require('../performance/traces').end(job.health.run_span, error, details);
		this.health.finish(job.health, error);
		clearTimeout(job.timer);
		job.payload = job.transfers = null;
		if (job.timing) job.timing.finish(error, { request_id: job.id,
			dispatch_start_ts: job.dispatch_start_ts,
			queue_wait_ms: job.dispatching ? timing.ms(job.dispatching - job.queued) : null,
			dispatch_ms: job.dispatched ? timing.ms(job.dispatched - job.dispatching) : null, ...details });
		if (error) job.reject(error); else job.resolve(value);
	}
	retire() {
		const worker = this.worker;
		this.worker = null; this.generation++;
		if (worker) { worker.unref(); worker.terminate().catch(() => {}); }
	}
	close() {
		if (this.unregister_health) this.unregister_health();
		this.unregister_health = null;
		const jobs = [this.active, ...this.pending].filter(Boolean);
		this.active = null; this.pending = []; this.retire();
		for (const job of jobs) this.finish(job, new Error(this.operation + ' worker closed'));
	}
}

module.exports = WorkerClient;
