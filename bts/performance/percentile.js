'use strict';

// The trace window needs one order statistic, not a sorted history. Work on a
// private copy so chronological eviction keeps exactly the same sample window.
module.exports = function percentile95(samples) {
	const values = samples.slice(), target = Math.ceil(values.length * .95) - 1;
	let left = 0, right = values.length - 1;
	while (left < right) {
		const a = values[left], b = values[(left + right) >>> 1], c = values[right];
		const pivot = a < b ? (b < c ? b : Math.max(a, c)) : (a < c ? a : Math.max(b, c));
		let lower = left, index = left, upper = right;
		while (index <= upper) {
			if (values[index] < pivot) {
				const value = values[index]; values[index++] = values[lower]; values[lower++] = value;
			} else if (values[index] > pivot) {
				const value = values[index]; values[index] = values[upper]; values[upper--] = value;
			} else index++;
		}
		if (target < lower) right = lower - 1;
		else if (target > upper) left = upper + 1;
		else return pivot;
	}
	return values[target];
};
