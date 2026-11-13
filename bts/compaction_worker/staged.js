'use strict';

const path = require('path');
const { promisify } = require('util');
const storage = require('nedb/lib/storage');
const model = require('nedb/lib/model');
const profile = require('../offload/profile');
const timing = require('../offload/timing');
const append_worker = require('../append_worker');
const providers = new WeakMap();
const call = (method, ...args) => promisify(storage[method])(...args);
const milliseconds = start => Number(process.hrtime.bigint() - start) / 1e6;

function register(store, provider) {
	if (providers.has(store)) return;
	const state = { provider, active: null, in_flight: 0, running: false };
	providers.set(store, state);
	const persist = store.persistence.persistNewState;
	store.persistence.persistNewState = function(documents, callback = () => {}) {
		if (state.active?.swapping) {
			// ensureIndex/removeIndex can write outside NeDB's executor. Their
			// append must also wait for the rename; ordinary writes already wait.
			store.executor.push({ this: this, fn: function(done) { this.persistNewState(documents, done); }, arguments: [callback],
				diagnostic_name: 'compaction_deferred_append' });
			return;
		}
		state.in_flight++;
		let completed = false;
		const done = error => {
			if (completed) return;
			completed = true; state.in_flight--;
			const active = state.active;
			if (active) {
				if (error) active.error = error;
				else for (const doc of documents) {
					// Index definitions originate in caller-owned option objects.
					active.journal.push(doc._id == null ? model.deepCopy(doc) : doc);
				}
				if (active.journal.length > 1024) active.error = new Error('Compaction journal limit exceeded');
			}
			if (typeof callback === 'function') callback(error);
		};
		try { return persist.call(this, documents, done); }
		catch (error) { if (completed) throw error; done(error); }
	};
}

function invalidate(store) {
	const active = providers.get(store)?.active;
	if (active && !active.swapping) active.error = new Error('Compaction source reloaded or rewritten');
}

function supported(store) {
	return !append_worker.failure(store) && profile.enabled('compaction_staged') && profile.enabled('compaction') && providers.has(store) &&
		!store.persistence.inMemoryOnly && store.executor.ready && !Object.keys(store.ttlIndexes || {}).length;
}

function queued(store, name, work) {
	// Both stages snapshot or replace persisted bytes; live records and indexes
	// remain unchanged. Certified score reads may pass them, never prior writes.
	return new Promise((resolve, reject) => store.executor.push(require('../database_read_barrier').certify_compaction({ this: store, diagnostic_name: name,
		fn: function(done) { Promise.resolve().then(work).then(value => done(null, value), done); },
		arguments: [(error, value) => error ? reject(error) : resolve(value)],
	})));
}

// Automatic maintenance only. Startup/manual compaction retain NeDB's path.
// The live file remains authoritative until an fsynced snapshot + successful
// intervening appends replace it atomically under a short executor barrier.
async function run(store, collection) {
	if (append_worker.failure(store)) throw append_worker.failure(store);
	const state = providers.get(store);
	if (state.running) throw new Error('Compaction already running');
	const revisions = require('./revisions'), captured_revision = revisions.revision(store);
	state.running = true;
	const trace = timing.start('compaction_staged', 'worker', { collection });
	const stage = store.filename + '.bts-compacting';
	const active = { journal: [], swapping: false, error: null };
	const details = { catchup_documents: 0, commit_documents: 0 };
	let error;
	try {
		const snapshot = await queued(store, 'compaction_snapshot', () => {
			if (state.in_flight) throw new Error('Compaction snapshot has an external append in flight');
			state.active = active;
			return state.provider.input(store);
		});
		details.input_documents = snapshot.documents.length;
		let began = process.hrtime.bigint();
		const bytes = await state.provider.encode(store, collection, snapshot);
		details.snapshot_encode_ms = milliseconds(began);
		if (active.error) throw active.error;
		began = process.hrtime.bigint();
		await call('crashSafeWriteFile', stage, bytes);
		details.stage_write_ms = milliseconds(began);
		// Catch up large journals outside the executor too. Bound the final
		// serialization and decline a swap if the writer keeps outrunning us.
		for (let round = 0; round < 3 && active.journal.length > 8; round++) {
			if (active.error) throw active.error;
			const docs = active.journal.splice(0);
			const delta = await state.provider.encode_records(docs, collection);
			await call('appendFile', stage, delta);
			details.catchup_documents += docs.length;
		}
		let swapped = false;
		for (let attempt = 0; attempt < 4 && !swapped; attempt++) {
			if (active.error) throw active.error;
			// Even a small final journal can spend tens of milliseconds in fsync.
			// Flush it while live appends still proceed, then prove under the
			// executor barrier that no completed or in-flight write is missing.
			const docs = active.journal.splice(0);
			if (docs.length) {
				const delta = await state.provider.encode_records(docs, collection);
				await call('appendFile', stage, delta);
				details.catchup_documents += docs.length;
			}
			const flushing = process.hrtime.bigint();
			await call('flushToStorage', stage);
			details.stage_flush_ms = (details.stage_flush_ms || 0) + milliseconds(flushing);
			details.swap_attempts = attempt + 1;
			const enqueued = process.hrtime.bigint();
			swapped = await queued(store, 'compaction_swap', async () => {
				details.commit_queue_wait_ms = milliseconds(enqueued);
				if (active.error) throw active.error;
				if (state.in_flight || active.journal.length) return false;
				active.swapping = true;
				details.commit_start_ts = Date.now();
				const locked = process.hrtime.bigint();
				try {
					await call('rename', stage, store.filename);
					await call('flushToStorage', { filename: path.dirname(store.filename), isDir: true });
					store.emit('compaction.done');
					return true;
				} finally {
					details.commit_locked_ms = milliseconds(locked); details.commit_end_ts = Date.now(); active.swapping = false;
				}
			});
		}
		if (!swapped) throw new Error('Compaction swap postponed by concurrent writes');
		revisions.compacted(store, captured_revision);
	} catch (err) { error = err; throw err; }
	finally {
		if (state.active === active) state.active = null;
		// A crash may leave a staging file; it is never an input to DB loading.
		// NeDB still owns its filename~ recovery file throughout.
		for (const file of [stage, stage + '~']) {
			try { await call('ensureFileDoesntExist', file); }
			catch (_) { /* A stale staging file is safely overwritten next round. */ }
		}
		trace?.finish(error, details);
		state.running = false;
	}
}

module.exports = { register, invalidate, supported, run };
