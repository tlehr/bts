'use strict';

// Encode an owned tournament response in short turns. NeDB gives us plain
// document snapshots. Each field/item still uses native JSON semantics,
// including dates, omitted properties and nulls in arrays.
module.exports = async function encode(message) {
	let turn = process.hrtime.bigint();
	const foreground = require('../foreground_work');
	const cache = require('./match_cache');
	const yield_if_due = async () => {
		if (foreground.busy()) { await foreground.idle(); turn = process.hrtime.bigint(); }
		if (process.hrtime.bigint() - turn < 2000000n) return;
		await new Promise(resolve => setImmediate(resolve));
		if (foreground.busy()) await foreground.idle();
		turn = process.hrtime.bigint();
	};
	const parts = [];
	const array_item = (value, index) => {
		const wrapper = JSON.stringify({ [String(index)]: value });
		return wrapper === '{}' ? 'null' : wrapper.slice(String(index).length + 4, -1);
	};
	async function object(value, kind) {
		parts.push('{'); let first = true;
		for (const key of Object.keys(value)) {
			await yield_if_due();
			const child = value[key];
			if (((kind === 'response' && key === 'performance') || (kind === 'performance' && key === 'processing')) &&
				child && Object.getPrototypeOf(child) === Object.prototype && !child.toJSON) {
				if (!first) parts.push(','); first = false;
				parts.push(JSON.stringify(key) + ':'); await object(child, key);
			} else if (['performance', 'processing'].includes(kind) && Array.isArray(child) && !child.toJSON) {
				if (!first) parts.push(','); first = false;
				parts.push(JSON.stringify(key) + ':[');
				for (let i = 0; i < child.length; i++) {
					await yield_if_due();
					if (i) parts.push(',');
					parts.push(array_item(child[i], i));
				}
				parts.push(']');
			} else if (kind === 'response' && key === 'tournament' && child && Object.getPrototypeOf(child) === Object.prototype && !child.toJSON) {
				if (!first) parts.push(','); first = false;
				parts.push(JSON.stringify(key) + ':'); await object(child, 'tournament');
			} else if (kind === 'response' && key === 'selections' && Array.isArray(child) && !child.toJSON) {
				if (!first) parts.push(','); first = false;
				parts.push(JSON.stringify(key) + ':');
				const encoded = await require('./selection_cache').encode(child, async () => {
					const start = parts.length;
					parts.push('[');
					for (let i = 0; i < child.length; i++) {
						if (i) parts.push(',');
						if (child[i] && Object.getPrototypeOf(child[i]) === Object.prototype && !child[i].toJSON) await object(child[i], 'selection');
						else parts.push(array_item(child[i], i));
					}
					parts.push(']');
					return parts.splice(start).join('');
				});
				parts.push(encoded);
			} else if (kind === 'selection' && ['diagnostics_by_match_id', 'call_on_court_diagnostics_by_match_id'].includes(key) &&
				child && Object.getPrototypeOf(child) === Object.prototype && !child.toJSON) {
				if (!first) parts.push(','); first = false;
				parts.push(JSON.stringify(key) + ':'); await object(child, 'diagnostics');
			} else if (kind === 'tournament' && key === 'matches' && Array.isArray(child) && !child.toJSON) {
				if (!first) parts.push(','); first = false;
				parts.push(JSON.stringify(key) + ':[');
				for (let i = 0; i < child.length; i++) {
					await yield_if_due();
					if (i) parts.push(',');
					const cached = cache.encode(child[i]);
					if (cached !== undefined) parts.push(cached);
					else parts.push(array_item(child[i], i));
					await yield_if_due();
				}
				parts.push(']');
			} else {
				// Wrapping preserves the original property's key for toJSON.
				const field = JSON.stringify({ [key]: child }).slice(1, -1);
				if (field) { if (!first) parts.push(','); first = false; parts.push(field); }
			}
			await yield_if_due();
		}
		parts.push('}');
	}
	if (!message || Object.getPrototypeOf(message) !== Object.prototype || message.toJSON) return JSON.stringify(message);
	await object(message, 'response');
	return parts.join('');
};
