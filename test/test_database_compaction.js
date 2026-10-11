'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const Datastore = require('nedb');
const schedule = require('../bts/database_compaction');

function clock() {
	let now = 0, id = 0;
	const timers = new Map();
	return {
		set_timer(fn, delay) { const token = ++id; timers.set(token, { fn, at: now + delay }); return token; },
		clear_timer(token) { timers.delete(token); },
		tick(duration) {
			const end = now + duration;
			while (true) {
				const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > end) break;
				now = next[1].at; timers.delete(next[0]); next[1].fn();
			}
			now = end;
		},
	};
}

function store(compact) {
	return { persistence: { stopAutocompaction() {}, persistCachedDatabase: compact },
		executor: { push(task) { task.fn.apply(task.this, task.arguments); } } };
}

describe('spread database compactions', function() {
	it('compacts every collection within the first interval and spreads successive rounds', function() {
		const time = clock(), calls = [];
		const db = Object.fromEntries(['a', 'b', 'c'].map(name => [name, store(done => { calls.push(name); done(); })]));
		const control = schedule(db, ['a', 'b', 'c'], { ...time, interval_ms: 90 });
		time.tick(29); assert.deepStrictEqual(calls, []);
		time.tick(1); assert.deepStrictEqual(calls, ['a']);
		time.tick(60); assert.deepStrictEqual(calls, ['a', 'b', 'c']);
		time.tick(90); assert.deepStrictEqual(calls, ['a', 'b', 'c', 'a', 'b', 'c']);
		control.stop();
	});
	it('waits for a queued or running rewrite and does not accumulate overdue jobs', function() {
		const time = clock(), calls = [];
		let finish;
		const db = { a: store(done => { calls.push('a'); finish = done; }),
			b: store(done => { calls.push('b'); done(); }) };
		const control = schedule(db, ['a', 'b'], { ...time, interval_ms: 100 });
		time.tick(1000);
		assert.deepStrictEqual(calls, ['a']);
		assert.strictEqual(control.active_collection, 'a');
		finish();
		assert.strictEqual(control.active_collection, null);
		time.tick(49); assert.deepStrictEqual(calls, ['a']);
		time.tick(1); assert.deepStrictEqual(calls, ['a', 'b']);
		control.stop();
	});
	it('reports rewrite errors and continues with the next collection', function() {
		const time = clock(), errors = [], calls = [];
		const error = new Error('write failed');
		const db = { a: store(done => done(error)), b: store(done => { calls.push('b'); done(); }) };
		const control = schedule(db, ['a', 'b'], { ...time, interval_ms: 100,
			on_error(name, err) { errors.push([name, err]); } });
		time.tick(100);
		assert.deepStrictEqual(errors, [['a', error]]);
		assert.deepStrictEqual(calls, ['b']);
		control.stop();
	});
	it('stops pending timers and lets an active crash-safe rewrite finish', function() {
		const time = clock(), calls = [];
		let finish;
		const db = { a: store(done => { calls.push('a'); finish = done; }) };
		const pending = schedule(db, ['a'], { ...time, interval_ms: 100 });
		pending.stop(); time.tick(1000); assert.deepStrictEqual(calls, []);
		const active = schedule(db, ['a'], { ...time, interval_ms: 100 });
		time.tick(100); active.stop();
		assert.strictEqual(active.active_collection, 'a');
		finish(); time.tick(1000);
		assert.deepStrictEqual(calls, ['a']);
		assert.strictEqual(active.active_collection, null);
	});
	it('rewrites a real datafile in datastore order and retains subsequent writes on reload', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-compaction-'));
		const time = clock();
		let control;
		try {
			const db = { matches: new Datastore({ filename: path.join(directory, 'matches') }) };
			const table = db.matches;
			await promisify(table.loadDatabase.bind(table))();
			await promisify(table.insert.bind(table))({ _id: 'game', score: 0 });
			const update = promisify(table.update.bind(table));
			const before = update({ _id: 'game' }, { $set: { score: 1 } }, {});
			control = schedule(db, ['matches'], { ...time, interval_ms: 100 });
			time.tick(100);
			const after = update({ _id: 'game' }, { $set: { score: 2 } }, {});
			await Promise.all([before, after]);
			assert.strictEqual(control.active_collection, null);
			const reloaded = new Datastore({ filename: table.filename });
			await promisify(reloaded.loadDatabase.bind(reloaded))();
			assert.deepStrictEqual(await promisify(reloaded.findOne.bind(reloaded))({ _id: 'game' }), { _id: 'game', score: 2 });
		} finally { control?.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
	});
});
