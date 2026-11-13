'use strict';

const assert = require('assert');
const keys = require('../bts/queue_lock_keys');

describe('normalized resource conflict comparisons', function() {
	it('retains every primitive wildcard and namespace rule in large normalized lists', function() {
		const families = ['all', 'legacy:global', 'tournament', 'matches', 'courts', 'match', 'point-match', 'dependency-match', 'court', 'point-court', 'dependency-court', 'events', 'sync', 'btp', 'keyed', 'other'];
		const examples = [...families, ...families.flatMap(family => ['default', 'second', ''].map(namespace => family + ':' + namespace)),
			...families.map(family => family + ':default:item')];
		for (const left of examples) for (const right of examples) {
			const a = keys.normalize_list([left, 'keyed:left-1', 'keyed:left-2', 'keyed:left-3', 'keyed:left-4']);
			const b = keys.normalize_list([right, 'keyed:right-1', 'keyed:right-2', 'keyed:right-3', 'keyed:right-4']);
			const expected = keys.lock_conflicts(left, right);
			assert.strictEqual(keys.normalized_lists_conflict(a, b), expected, left + ' / ' + right);
			assert.strictEqual(keys.normalized_lists_conflict(b, a), expected, right + ' / ' + left);
		}
	});
	it('matches the primitive comparison for mixed scopes and leaves queued lists unchanged', function() {
		let seed = 711;
		const rand = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
		const families = ['tournament', 'matches', 'courts', 'match', 'point-match', 'dependency-match', 'court', 'point-court', 'dependency-court', 'events', 'sync', 'btp', 'keyed', 'other'];
		const key = () => families[rand(families.length)] + ':' + ['default', 'second', ''][rand(3)] + ':' + rand(16);
		for (let i = 0; i < 2000; i++) {
			const a = keys.normalize_list(Array.from({length:rand(40)}, key)), b = keys.normalize_list(Array.from({length:rand(40)}, key));
			const before = JSON.stringify([a, b]);
			const expected = a.some(left => b.some(right => keys.lock_conflicts(left, right)));
			assert.strictEqual(keys.normalized_lists_conflict(a, b), expected);
			assert.strictEqual(JSON.stringify([a, b]), before);
		}
		assert.strictEqual(keys.normalized_lists_conflict([], ['all']), false);
		assert.strictEqual(keys.normalized_lists_conflict(['legacy:global'], []), false);
	});
});
