'use strict';

const assert = require('assert');
const { encode, decode } = require('../bts/btp_planner/changes');
const { patch } = require('../bts/btp_planner/staging');

describe('sync planner return patches', function() {
	it('reconstructs nested updates, removed fields, dates, arrays and property presence without copying unchanged histories', function() {
		const before = { _id: 'm', presses: [{ score: 1 }], date: new Date(123),
			setup: { teams: [{ players: [{ lastname: 'Old' }] }], empty: { removed: true } },
			deleted: 'old', missing: undefined };
		const after = { _id: 'm', presses: [{ score: 1 }], date: new Date(456),
			setup: { teams: [{ players: [{ lastname: 'New' }] }], empty: {} }, added: undefined };
		const update = patch(before, after);
		const changes = [{ collection: 'matches', id: 'm', before, after, update }];
		const encoded = encode(changes);
		assert(!Object.hasOwn(encoded[0], 'after'));
		assert(!Object.hasOwn(encoded[0].after_delta.set, 'presses'));
		const restored = decode(structuredClone(encoded), { matches: [before] })[0];
		assert.deepStrictEqual(restored.after, after);
		assert.deepStrictEqual(restored.update, update);
		assert.strictEqual(restored.after.presses, before.presses);
		assert.notStrictEqual(restored.after, before);
		assert.strictEqual(before.setup.empty.removed, true);
		assert.strictEqual(before.deleted, 'old');
		assert.strictEqual(before.date.getTime(), 123);
	});
	it('preserves inserts and deletions and refuses an update without its exact snapshot baseline', function() {
		const changes = [{ collection: 'courts', id: 'new', after: { _id: 'new', num: 1 }, update: undefined },
			{ collection: 'matches', id: 'old', before: { _id: 'old' }, after: undefined, update: undefined }];
		const actual = decode(structuredClone(encode(changes)), { courts: [], matches: [] });
		assert.deepStrictEqual(actual, changes.map(({ collection, id, after, update }) => ({ collection, id, after, update })));
		assert.throws(() => decode([{ collection: 'matches', id: 'lost', after_delta: { set: {}, unset: [] } }], { matches: [] }), /Missing.*baseline/);
	});
});
