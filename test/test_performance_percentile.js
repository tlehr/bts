'use strict';

const assert = require('assert');
const percentile95 = require('../bts/performance/percentile');

describe('trace sample percentile', function() {
	it('preserves the exact previous order statistic and chronological samples', function() {
		let seed = 519;
		const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
		const cases = [[], [0], Array(256).fill(7), [10000, ...Array(255).fill(0)]];
		for (let length = 2; length <= 256; length++) {
			cases.push(Array.from({length}, (_, i) => i), Array.from({length}, (_, i) => length - i),
				Array.from({length}, () => Math.round(random() * 1000) / 10));
		}
		for (const values of cases) {
			const before = values.slice(), sorted = values.slice().sort((a, b) => a - b);
			assert.strictEqual(percentile95(values), sorted[Math.ceil(values.length * .95) - 1]);
			assert.deepStrictEqual(values, before);
		}
	});
});
