'use strict';

const assert = require('assert');
const { fixture } = require('./tournament_model_fixture');
const barrier = require('../bts/database_read_barrier');
const turn = () => new Promise(resolve => setImmediate(resolve));
const read = (db, id) => new Promise((resolve, reject) => db.model.read_score_context_part('match', 'test', id,
	(error, value, timing) => error ? reject(error) : resolve({value,timing})));

function hold_write(store) {
	const persist = store.persistence.persistNewState;
	let reached, release;
	const started = new Promise(resolve => { reached = resolve; });
	store.persistence.persistNewState = function(documents, done) {
		release = () => persist.call(this, documents, done);reached();
	};
	return {started,release() {store.persistence.persistNewState = persist;release();}};
}
function hold_reader(store) {
	let reached, release;
	const started = new Promise(resolve => { reached = resolve; });
	const finished = new Promise(resolve => store.executor.push(barrier.certify_read({this:store,
		fn(done) {release = done;reached();},arguments:[resolve]})));
	return {started,finished,release:() => release()};
}

describe('score snapshots beside ordinary writes to other records', function() {
	let previous;
	beforeEach(function() {previous = process.env.BTS_SCORE_MODEL_READONLY_READS;process.env.BTS_SCORE_MODEL_READONLY_READS = '1';});
	afterEach(function() {
		if (previous === undefined) delete process.env.BTS_SCORE_MODEL_READONLY_READS;
		else process.env.BTS_SCORE_MODEL_READONLY_READS = previous;
	});
	it('captures another game during persistence, while retaining the same-game barrier', async function() {
		const {db} = await fixture(), held = hold_write(db.matches);
		const write = db.matches.update_async({_id:'one'},{$set:{network_score:[[5,3]]}},{});
		await held.started;
		let otherDone = false, sameDone = false;
		const other = read(db,'two').then(value => {otherDone = true;return value;});
		const same = read(db,'one').then(value => {sameDone = true;return value;});
		try {await turn();assert(otherDone,'unrelated game must not wait for this write');assert.strictEqual(sameDone,false);}
		finally {held.release();}
		await write;
		assert.strictEqual((await other).timing.model_read_decision,'disjoint_records');
		assert.deepStrictEqual((await same).value.network_score,[[5,3]]);
	});
	it('captures before later writes while an unrelated single-record update is queued', async function() {
		const {db} = await fixture(), held = hold_reader(db.matches);await held.started;
		const earlier = db.matches.update_async({_id:'one',tournament_key:'test'},{$set:{marker:1}},{});
		let delivered = false;
		const captured = read(db,'two').then(value => {delivered = true;return value;});
		const later = db.matches.update_async({_id:'two'},{$set:{marker:2}},{});
		try {await turn();assert(delivered);}
		finally {held.release();await held.finished;}
		await Promise.all([earlier,later]);
		assert.strictEqual((await captured).value.marker,undefined);
		assert.strictEqual((await db.matches.findOne_async({_id:'two'})).marker,2);
	});
	for (const mode of ['broad','upsert','custom-writer','ttl']) it('retains the conservative barrier for ' + mode, async function() {
		const {db} = await fixture(), store = db.matches, held = hold_write(store), original = store._update;
		if (mode === 'custom-writer') store._update = function(...args) {return original.apply(this,args);};
		if (mode === 'ttl') store.ttlIndexes.expiry = 1;
		const write = mode === 'upsert' ? store.update_async({_id:'missing'},{$set:{marker:1}},{upsert:true})
			: store.update_async(mode === 'broad' ? {tournament_key:'test'} : {_id:'one'},{$set:{marker:1}},{multi:true});
		await held.started;
		delete store.ttlIndexes.expiry;
		let delivered = false;
		const captured = read(db,'two').then(value => {delivered = true;return value;});
		try {await turn();assert.strictEqual(delivered,false);}
		finally {store._update = original;held.release();}
		await Promise.all([write,captured]);
	});
	for (const mode of ['query','index-hook','upsert-option']) it('rejects a queued scope changed through its ' + mode, async function() {
		const {db} = await fixture(), store = db.matches, held = hold_reader(store);await held.started;
		const query = {_id:'one'}, indexes = store.updateIndexes, options = {};
		const write = store.update_async(query,{$set:{marker:1}},options);
		if (mode === 'query') query._id = 'two';
		else if (mode === 'index-hook') store.updateIndexes = function(...args) {return indexes.apply(this,args);};
		else options.upsert = true;
		let delivered = false;
		const captured = read(db,'two').then(value => {delivered = true;return value;});
		try {await turn();assert.strictEqual(delivered,false);}
		finally {store.updateIndexes = indexes;held.release();await held.finished;}
		await Promise.all([write,captured]);
	});
	it('does not execute a query getter while trying to establish a record scope', async function() {
		const {db} = await fixture(), held = hold_reader(db.matches);await held.started;
		let accesses = 0;
		const query = {tournament_key:'test'};
		Object.defineProperty(query,'_id',{enumerable:true,get() {accesses++;return 'one';}});
		const write = db.matches.update_async(query,{$set:{marker:1}},{});
		assert.strictEqual(accesses,0);
		let delivered = false;
		const captured = read(db,'two').then(value => {delivered = true;return value;});
		try {await turn();assert.strictEqual(delivered,false);assert.strictEqual(accesses,0);}
		finally {held.release();await held.finished;}
		await Promise.all([write,captured]);
	});
	it('rejects an executor task whose writer was replaced after enqueueing', async function() {
		const {db} = await fixture(), store = db.matches, held = hold_reader(store);await held.started;
		const original = store._update;
		let task;
		const write = new Promise((resolve, reject) => {
			task = {this:store,fn:original,arguments:[{_id:'one'},{$set:{marker:1}},{},error => error ? reject(error) : resolve()]};
			store.executor.push(task);
		});
		task.fn = function(_query, values, options, done) {return original.call(this,{_id:'two'},values,options,done);};
		let delivered = false;
		const captured = read(db,'two').then(value => {delivered = true;return value;});
		try {await turn();assert.strictEqual(delivered,false);}
		finally {held.release();await held.finished;}
		await write;
		assert.strictEqual((await captured).value.marker,1);
	});
});
