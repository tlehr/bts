'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const ms = ns => Math.round(Number(ns) / 1e5) / 10;

// One persistent worker serializes bulk decoding across connections. Live
// tournament objects and database handles never leave the main thread.
class DecodePool {
	constructor(options = {}) {
		this.create_worker = options.create_worker || (() => new Worker(path.join(__dirname, 'worker.js')));
		this.max_pending = options.max_pending || 64;
		this.pending = [];
		this.next_id = 0;
		this.worker = null;
		this.active = null;
		this.closed = false;
		this.health = new (require('../performance/queue_stats'))('worker');
		this.unregister_health = require('../performance/registry').register(this, 'btp_decode', owner => owner.health.snapshot());
	}
	decode(packet, context = {}, callback) {
		const job = { id: ++this.next_id, packet, context, callback, queued: process.hrtime.bigint() };
		if (this.closed || this.pending.length >= this.max_pending) {
			this.health.rejected++;
			queueMicrotask(() => { if (!job.cancelled) callback(new Error(this.closed ? 'BTP decoder closed' : 'BTP decoder queue full')); });
		} else {
			job.health = this.health.enqueue('decode');
			this.pending.push(job);
			this.dispatch();
		}
		return () => this.cancel(job);
	}
	get_worker() {
		if (this.worker) return this.worker;
		const worker = this.create_worker();
		this.worker = worker;
		worker.on('message', result => {
			if (this.worker !== worker || this.active?.id !== result.id) return;
			const received = process.hrtime.bigint();
			const job = this.active;
			this.active = null;
			worker.unref();
			if (result.record && require('../server_diagnostics').sync_timing_enabled(job.context.tournament_key)) {
				const record = { ...result.record, execution: 'worker', request_id: job.id,
					queue_wait_ms: ms(job.dispatching - job.queued),
					dispatch_ms: ms(job.dispatched - job.dispatching),
					input_wait_ms: Math.max(0, ms(result.started - job.dispatched)),
					return_delivery_ms: ms(received - result.returning),
					decode_roundtrip_ms: ms(received - job.dispatching) };
				try { console.warn('[bts] btp_fetch:response_decode ' + JSON.stringify(record)); } // eslint-disable-line no-console
				catch (_) { /* Diagnostics cannot fail a response. */ }
			}
			this.dispatch();
			let error = null;
			if (result.error) {
				error = Object.assign(new Error(result.error.message), result.error);
			}
			this.health.finish(job.health, error);
			if (!error) require('./response_hashes').remember(result.response, result.hashes);
			require('../performance/traces').import_phases(job.health.run_span, result.record?.phases.map(row => ({ ...row, name: 'btp_decode_' + row.phase })));
			require('../performance/traces').with_context(job.health.context, () => job.callback(error, result.response));
		});
		const failed = error => {
			if (this.worker !== worker) return;
			const job = this.active;
			this.active = null;
			this.retire_worker();
			this.dispatch();
			if (job) { this.health.finish(job.health, error); require('../performance/traces').with_context(job.health.context, () => job.callback(error)); }
		};
		worker.on('error', failed);
		worker.on('exit', code => failed(new Error('BTP decoder exited (' + code + ')')));
		return worker;
	}
	dispatch() {
		if (this.active || this.closed || !this.pending.length) return;
		const job = this.pending.shift();
		this.active = job;
		this.health.start(job.health);
		job.dispatching = process.hrtime.bigint();
		let failure;
		try {
			const worker = this.get_worker();
			worker.ref();
			// Buffer slices often share a pooled ArrayBuffer. Transfer an owned copy
			// so other socket chunks and the caller's buffer remain intact.
			const packet = new Uint8Array(job.packet.length);
			packet.set(job.packet);
			worker.postMessage({ id: job.id, packet: packet.buffer,
				timing_enabled: require('../server_diagnostics').sync_timing_enabled(job.context.tournament_key) || !!job.health.run_span,
				context: { tournament_key: job.context.tournament_key, action: job.context.action } }, [packet.buffer]);
			job.dispatched = process.hrtime.bigint();
			job.packet = null;
		} catch (error) { failure = error; }
		if (failure) {
			this.health.finish(job.health, failure);
			job.packet = null;
			this.active = null;
			this.retire_worker();
			queueMicrotask(() => { this.dispatch(); if (!job.cancelled) job.callback(failure); });
		}
	}
	cancel(job) {
		if (job.health) this.health.finish(job.health, new Error('cancelled'));
		job.cancelled = true;
		job.packet = null;
		if (this.active === job) {
			this.active = null;
			// A running XML parser cannot process cancellation messages. Terminate
			// only the current worker; other connections' queued requests survive.
			this.retire_worker();
			this.dispatch();
		} else {
			const index = this.pending.indexOf(job);
			if (index !== -1) this.pending.splice(index, 1);
		}
	}
	retire_worker() {
		const worker = this.worker;
		this.worker = null;
		if (worker) {
			worker.unref();
			worker.terminate().catch(() => {});
		}
	}
	close() {
		this.unregister_health();
		this.closed = true;
		const jobs = [this.active, ...this.pending].filter(Boolean);
		this.active = null;
		this.pending = [];
		this.retire_worker();
		for (const job of jobs) {
			const error = new Error('BTP decoder closed'); this.health.finish(job.health, error); job.callback(error);
		}
	}
}

module.exports = DecodePool;
