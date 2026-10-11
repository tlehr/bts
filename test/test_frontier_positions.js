'use strict';

const assert = require('assert');
const { _describe, _it } = require('./tutils');
const FrontierPositions = require('../bts/match_automation/frontier_positions');

const match = (_id, block) => ({ _id, block });
const positions = () => new FrontierPositions(m => m?.block);

_describe('Frontier block positions', () => {
	_it('counts concrete block transitions, including repeated block names', () => {
		const matches = [match('a', 'A'), match('b', 'A'), match('c', 'B'), match('d', 'A')];
		const index = positions();
		assert.strictEqual(index.distance(matches[1], matches[0], matches), 0);
		assert.strictEqual(index.distance(matches[2], matches[0], matches), 1);
		assert.strictEqual(index.distance(matches[3], matches[0], matches), 2);
		assert.strictEqual(index.distance(matches[0], matches[3], matches), -2);
	});

	_it('prefers identity and otherwise finds the first strictly matching ID', () => {
		const first = match('duplicate', 'A'), second = match('duplicate', 'B');
		const no_id = match(undefined, 'C'), numeric = match(7, 'D'), string = match('7', 'E');
		const nan = match(NaN, 'F');
		const matches = [first, second, no_id, numeric, string, nan, first];
		const index = positions();
		assert.strictEqual(index.distance(second, first, matches), 1);
		assert.strictEqual(index.distance({ _id: 'duplicate' }, first, matches), 0);
		assert.strictEqual(index.distance(no_id, first, matches), 2);
		assert.strictEqual(index.distance({ _id: 7 }, first, matches), 3);
		assert.strictEqual(index.distance({ _id: '7' }, first, matches), 4);
		assert.strictEqual(index.distance(nan, first, matches), 5);
		assert.strictEqual(index.distance(first, second, matches), -1);
		for (const absent of [null, undefined, {}, { _id: null }, { _id: NaN }, { _id: 'absent' }]) {
			assert.strictEqual(index.distance(absent, first, matches), Infinity);
			assert.strictEqual(index.distance(first, absent, matches), Infinity);
		}
	});

	_it('keeps separate positions for differently ordered and filtered lists', () => {
		const a = match('a', 'A'), b = match('b', 'B'), c = match('c', 'C');
		const forward = [a, b, c], backward = [c, b, a], filtered = [a, c];
		const index = positions();
		assert.strictEqual(index.distance(c, a, forward), 2);
		assert.strictEqual(index.distance(c, a, backward), -2);
		assert.strictEqual(index.distance(c, a, filtered), 1);
		assert.strictEqual(index.distance(b, a, filtered), Infinity);
		assert.strictEqual(index.distance(c, a, forward), 2);
	});

	_it('builds each list once across many lookups within one calculation', () => {
		const matches = Object.freeze([match('a', 'A'), match('b', 'B'), match('c', 'C')]);
		let visits = 0;
		const index = new FrontierPositions(m => { visits++; return m.block; });
		for (let i = 0; i < 1000; i++) {
			assert.strictEqual(index.distance({ _id: 'c' }, matches[0], matches), 2);
		}
		assert.strictEqual(visits, matches.length);
		index.distance(matches[2], matches[0], [matches[0], matches[2]]);
		assert.strictEqual(visits, matches.length + 2);
	});

	_it('rebuilds in a new calculation after keys and ordering change', () => {
		const a = match('a', 'A'), b = match('b', 'B'), c = match('c', 'C');
		const matches = [a, b, c];
		assert.strictEqual(positions().distance(c, a, matches), 2);
		b.block = 'A';
		assert.strictEqual(positions().distance(c, a, matches), 1);
		matches.reverse();
		assert.strictEqual(positions().distance(c, a, matches), -1);
	});

	_it('skips array holes and returns infinity for an empty list', () => {
		const a = match('a', 'A'), b = match('b', 'B');
		const matches = [a, , b];
		assert.strictEqual(positions().distance(b, a, matches), 1);
		assert.strictEqual(positions().distance(b, a, []), Infinity);
	});
});
