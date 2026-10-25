'use strict';

const assert = require('assert');
const { fixture } = require('./tournament_model_fixture');
const barrier = require('../bts/database_read_barrier');
const turn = () => new Promise(resolve => setImmediate(resolve));
const read = (db, part = 'match', id = 'one') => new Promise((resolve, reject) =>
	db.model.read_score_context_part(part, 'test', id, (error, value, timing) =>
		error ? reject(error) : resolve({ value, timing })));

function hold(store, kind = 'certified', direct = false) {
	let start, release;
	const started = new Promise(resolve => { start = resolve; });
	const finished = new Promise(resolve => {
		const task = { this: store, diagnostic_name: 'sync_snapshot_matches',
			fn(done) { release = () => done(); start(); }, arguments: [resolve] };
		const job = kind === 'certified' ? barrier.certify_read(task) : task;
		if (direct) store.executor.queue.push(job); else store.executor.push(job);
	});
	return { started, finished, release: () => release() };
}

describe('score reads with earlier read-only work', function() {
	let previous;
	beforeEach(function() {
		const keys = ['BTS_SCORE_MODEL_READONLY_READS', 'BTS_SCORE_MODEL_IDLE_READS', 'BTS_COMPACTION_MODEL_READS'];
		previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
		process.env.BTS_SCORE_MODEL_READONLY_READS = '1';
		process.env.BTS_SCORE_MODEL_IDLE_READS = '1';
		process.env.BTS_COMPACTION_MODEL_READS = '1';
	});
	afterEach(function() {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	});

	it('captures each score context part across earlier pure reads and before a later write', async function() {
		for (const [part, name, id] of [['match', 'matches', 'one'], ['tournament', 'tournaments', null], ['court', 'courts', 'court']]) {
			const { db } = await fixture(), store = db[name], held = hold(store);
			await held.started;
			const earlier = [db.model.snapshot('test', [name]), store.findOne_async({ _id: id || 'tournament' })];
			let delivered = false;
			const captured = read(db, part, id).then(value => { delivered = true; return value; });
			const later = store.update_async({ _id: id || 'tournament' }, { $set: { marker: 'later' } }, {});
			try {
				await turn(); assert(delivered, part + ' must not wait for pure readers');
				const result = await captured;
				assert.strictEqual(result.timing.model_read_decision, 'read_only_store');
				assert.strictEqual(result.timing.compaction_read_bypassed, false);
				assert.strictEqual(result.value.marker, undefined);
				assert.strictEqual(result.value._id, id || 'tournament');
			} finally { held.release(); await held.finished; }
			await Promise.all([...earlier, later]);
			assert.strictEqual((await store.findOne_async({ _id: id || 'tournament' })).marker, 'later');
			assert.strictEqual((await captured).value.marker, undefined);
		}
	});

	it('recognizes a native read until its deferred queue release, even inside its callback', async function() {
		const { db } = await fixture();
		const result = await new Promise((resolve, reject) => {
			db.matches.findOne({ _id: 'one' }, error => {
				if (error) return reject(error);
				assert.strictEqual(db.matches.executor.queue.running(), 1);
				db.model.read_score_context_part('match', 'test', 'one', (error, value, timing) =>
					error ? reject(error) : resolve({ value, timing }));
			});
		});
		assert.strictEqual(result.timing.model_read_decision, 'read_only_store');
		result.value.network_score[0][0] = 99;
		assert.deepStrictEqual(db.model.tournament('test').matches.get('one').data.network_score, [[0, 0]]);
	});

	it('waits for an earlier queued write and preserves the read position before a later write', async function() {
		const { db } = await fixture(), held = hold(db.matches); await held.started;
		const first = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 2]] } }, {});
		let delivered = false;
		const captured = read(db).then(value => { delivered = true; return value; });
		const later = db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[9, 8]] } }, {});
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { held.release(); await held.finished; }
		await Promise.all([first, later]);
		assert.deepStrictEqual((await captured).value.network_score, [[3, 2]]);
		assert.strictEqual((await captured).timing.model_read_bypassed, false);
	});

	it('waits for active write persistence although the model has already changed', async function() {
		const { db, tournament } = await fixture(), store = db.matches, persist = store.persistence.persistNewState;
		let reached, release;
		const started = new Promise(resolve => { reached = resolve; });
		store.persistence.persistNewState = function(documents, done) {
			release = () => persist.call(this, documents, done); reached();
		};
		const write = store.update_async({ _id: 'one' }, { $set: { network_score: [[6, 4]] } }, {});
		await started;
		assert.deepStrictEqual(tournament.matches.get('one').data.network_score, [[6, 4]]);
		const earlier = db.model.snapshot('test', ['matches']);
		let delivered = false;
		const captured = read(db).then(value => { delivered = true; return value; });
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { store.persistence.persistNewState = persist; release(); }
		await Promise.all([write, earlier]);
		assert.deepStrictEqual((await captured).value.network_score, [[6, 4]]);
		assert.strictEqual((await captured).timing.model_read_bypassed, false);
	});

	for (const direct of [false, true]) it(`blocks an ${direct ? 'unobserved' : 'unknown named'} running task after a completed native read`, async function() {
		const { db } = await fixture();
		const earlier = db.matches.findOne_async({ _id: 'one' });
		const held = hold(db.matches, 'unknown', direct);
		await earlier; await held.started;
		let delivered = false;
		const captured = read(db).then(value => { delivered = true; return value; });
		try {
			assert.strictEqual(barrier.inspect_readonly(db.matches).allowed, false);
			await turn(); assert.strictEqual(delivered, false);
		} finally { held.release(); await held.finished; }
		assert.strictEqual((await captured).timing.model_read_bypassed, false);
	});

	it('blocks unobserved queued work behind a certified reader', async function() {
		const { db } = await fixture(), held = hold(db.matches); await held.started;
		const unknown = new Promise(resolve => db.matches.executor.queue.push({ this: db.matches, fn: done => done(), arguments: [resolve] }));
		let delivered = false;
		const captured = read(db).then(value => { delivered = true; return value; });
		try {
			assert.strictEqual(barrier.inspect_readonly(db.matches).reason, 'untracked_tasks');
			await turn(); assert.strictEqual(delivered, false);
		} finally { held.release(); await held.finished; }
		await unknown;
		assert.strictEqual((await captured).timing.model_read_bypassed, false);
	});

	it('retains the TTL barrier when an index is added after a reader started', async function() {
		const { db } = await fixture(), held = hold(db.matches); await held.started;
		db.matches.ttlIndexes.expiry = 1;
		let delivered = false;
		const captured = read(db).then(value => { delivered = true; return value; });
		try {
			assert.strictEqual(barrier.inspect_readonly(db.matches).reason, 'ttl_index');
			await turn(); assert.strictEqual(delivered, false);
		} finally { delete db.matches.ttlIndexes.expiry; held.release(); await held.finished; }
		assert.strictEqual((await captured).timing.model_read_bypassed, false);
	});

	it('does not pass an expiry-capable read even if its TTL index is subsequently removed', async function() {
		const { db } = await fixture();
		db.matches.ttlIndexes.expiry = 1;
		const held = hold(db.matches); await held.started;
		delete db.matches.ttlIndexes.expiry;
		let delivered = false;
		const captured = read(db).then(value => { delivered = true; return value; });
		try {
			assert.strictEqual(barrier.inspect_readonly(db.matches).allowed, false);
			await turn(); assert.strictEqual(delivered, false);
		} finally { held.release(); await held.finished; }
		assert.strictEqual((await captured).timing.model_read_bypassed, false);
	});

	it('keeps the ordered executor path when disabled', async function() {
		const { db } = await fixture(), held = hold(db.matches); await held.started;
		process.env.BTS_SCORE_MODEL_READONLY_READS = '0';
		let delivered = false;
		const captured = read(db).then(value => { delivered = true; return value; });
		try { await turn(); assert.strictEqual(delivered, false); }
		finally { held.release(); await held.finished; }
		assert.strictEqual((await captured).timing.model_read_bypassed, false);
	});
});
