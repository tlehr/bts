'use strict';

const path = require('path');
const { promisify } = require('util');
const storage = require('nedb/lib/storage');
const model = require('nedb/lib/model');
const profile = require('../offload/profile');
const timing = require('../offload/timing');
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
	return profile.enabled('compaction_staged') && profile.enabled('compaction') && providers.has(store) &&
		!store.persistence.inMemoryOnly && store.executor.ready && !Object.keys(store.ttlIndexes || {}).length;
}

function queued(store, name, work) {
	return new Promise((resolve, reject) => store.executor.push({ this: store, diagnostic_name: name,
		fn: function(done) { Promise.resolve().then(work).then(value => done(null, value), done); },
		arguments: [(error, value) => error ? reject(error) : resolve(value)],
	}));
}

// Automatic maintenance only. Startup/manual compaction retain NeDB's path.
// The live file remains authoritative until an fsynced snapshot + successful
// intervening appends replace it atomically under a short executor barrier.
async function run(store, collection) {
	const state = providers.get(store);
	if (state.running) throw new Error('Compaction already running');
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
		const enqueued = process.hrtime.bigint();
		await queued(store, 'compaction_swap', async () => {
			details.commit_queue_wait_ms = milliseconds(enqueued);
			if (active.error) throw active.error;
			if (state.in_flight || active.journal.length > 8) throw new Error('Compaction swap postponed by concurrent writes');
			active.swapping = true;
			details.commit_start_ts = Date.now();
			const locked = process.hrtime.bigint();
			try {
				const delta = active.journal.map(doc => model.serialize(doc) + '\n').join('');
				details.commit_documents = active.journal.length;
				if (delta) await call('appendFile', stage, delta, 'utf8');
				await call('flushToStorage', stage);
				await call('rename', stage, store.filename);
				await call('flushToStorage', { filename: path.dirname(store.filename), isDir: true });
				store.emit('compaction.done');
			} finally {
				details.commit_locked_ms = milliseconds(locked); details.commit_end_ts = Date.now(); active.swapping = false;
			}
		});
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
