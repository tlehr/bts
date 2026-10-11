'use strict';
const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const { read_matches } = require('../bts/admin_match_data');
const encode = require('../bts/admin_response/cooperative');
const cache = require('../bts/admin_response/match_cache');

const read = (db, defer = false, immutable = true) => new Promise((resolve, reject) => read_matches(db, 'default', defer,
	(error, matches) => error ? reject(error) : resolve(matches), { immutable }));
const message = matches => ({ type: 'answer', tournament: { matches } });

describe('immutable admin match encoding cache', function() {
	it('keeps captured histories stable during later writes and reuses only unchanged revisions', async function() {
		const db = await database.init_test();
		await promisify(db.matches.insert.bind(db.matches))([{ _id: 'one', tournament_key: 'default', setup: { state: 'oncourt' }, presses: [{ type: 'point', timestamp: 1 }], network_score: [[1, 0]] },
			{ _id: 'two', tournament_key: 'default', setup: { state: 'finished' }, presses: [{ type: 'point', timestamp: 2 }] }]);
		const first = await read(db), expected = JSON.stringify(message(first));
		assert.strictEqual(await encode(message(first)), expected);
		const before = cache.stats(); assert.strictEqual(await encode(message(await read(db))), expected);
		assert.strictEqual(cache.stats().cache_hits - before.cache_hits, 2);
		await db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[2, 0]], presses: [{ type: 'point', timestamp: 3 }] } }, {});
		assert.strictEqual(await encode(message(first)), expected, 'captured snapshot changed after a committed write');
		const after = await read(db), counts = cache.stats(), bytes = await encode(message(after));
		assert.strictEqual(bytes, JSON.stringify(message(after))); assert.strictEqual(cache.stats().cache_misses - counts.cache_misses, 1);
		assert.deepStrictEqual(JSON.parse(bytes).tournament.matches.find(row => row._id === 'one').network_score, [[2, 0]]);
		await db.matches.remove_async({ _id: 'two' }, {}); assert.strictEqual((await read(db)).length, 1);
	});
	it('keeps full/deferred histories separate and leaves ordinary detached results freely mutable', async function() {
		const db = await database.init_test();
		await promisify(db.matches.insert.bind(db.matches))({ _id: 'done', tournament_key: 'default', setup: { state: 'finished' }, presses: [{ type: 'point' }] });
		const light = await read(db, true), full = await read(db);
		assert.strictEqual(JSON.parse(await encode(message(light))).tournament.matches[0].presses, undefined);
		assert.deepStrictEqual(JSON.parse(await encode(message(full))).tournament.matches[0].presses, [{ type: 'point' }]);
		const detached = await read(db, false, false); detached[0].presses[0].type = 'edited';
		assert.strictEqual(await encode(message(detached)), JSON.stringify(message(detached)));
		assert.strictEqual(full[0].presses[0].type, 'point');
	});
});
