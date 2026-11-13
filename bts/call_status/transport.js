'use strict';

const v8 = require('v8');
const {isDeepStrictEqual} = require('util');
const { performance } = require('perf_hooks');
const foreground = require('../foreground_work');
const collections = ['matches', 'courts', 'locations', 'umpires', 'tabletoperators'];
const diagnostic_bytes = new WeakMap();

async function cooperate(cursor) {
	if (performance.now() - cursor.at < 2 && !foreground.background_busy()) return;
	await new Promise(resolve => setImmediate(resolve));
	await foreground.background_idle();cursor.at = performance.now();
}

// Serialize immutable records individually. Serializing or decoding the whole
// tournament/diagnostic graph in one step can itself block a point for 50 ms.
async function encode_input(value) {
	await foreground.background_idle();
	const cursor = {at:performance.now()}, parts = [];
	for (const [key, item] of Object.entries(value)) {
		if (collections.includes(key)) {
			for (const [index, document] of (item || []).entries()) {
				parts.push([key, index, v8.serialize(document)]);await cooperate(cursor);
			}
			parts.push([key, -1, item?.length || 0]);
		} else { parts.push([key, null, v8.serialize(item)]);await cooperate(cursor); }
	}
	return parts;
}

function decode_input(parts) {
	const value = {};
	for (const [key, index, bytes] of parts) {
		if (index === null) value[key] = v8.deserialize(bytes);
		else if (index === -1) { value[key] ||= [];value[key].length = bytes; }
		else { value[key] ||= [];value[key][index] = v8.deserialize(bytes); }
	}
	return value;
}

function encode_output(input, rows) {
	const documents = new WeakMap(), parts = [];
	for (const key of collections) for (const [index, document] of (input[key] || []).entries()) documents.set(document, [key,index]);
	function encode(value) {
		const references = [];
		function visit(item, path) {
			if (!item || typeof item !== 'object') return item;
			if (documents.has(item)) { references.push([path,documents.get(item)]);return null; }
			if (Array.isArray(item)) {
				const array = [];
				for (let index = 0;index < item.length;index++) if (index in item) array[index] = visit(item[index],path.concat(index));
				array.length = item.length;return array;
			}
			if (item instanceof Date) return item;
			return Object.fromEntries(Object.entries(item).map(([key,child]) => [key,visit(child,path.concat(key))]));
		}
		return v8.serialize({value:visit(value,[]),references});
	}
	for (const [index,row] of rows.entries()) for (const [key,value] of Object.entries(row)) {
		if (['diagnostics_by_match_id','call_on_court_diagnostics_by_match_id'].includes(key)) {
			parts.push([index,key,null,null]);
			for (const [id,document] of Object.entries(value)) parts.push([index,key,id,encode(document)]);
		} else parts.push([index,key,null,encode(value)]);
	}
	return parts;
}

async function decode_output(input, parts, previous = []) {
	await foreground.background_idle();
	const cursor = {at:performance.now()}, rows = [], old = new Map(previous.map(row => [row.location_id,row]));
	for (const [index,key,id,bytes] of parts) {
		rows[index] ||= {};
		if (bytes === null) { rows[index][key] = {};continue; }
		const before = id === null ? null : old.get(rows[index].location_id)?.[key]?.[id];
		const buffer = Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
		// Compare the small encoded diagnosis before allocating its entire rule
		// tree again. Only reference-free packets are reusable: every source
		// document must still resolve against this calculation's current input.
		if (before && diagnostic_bytes.get(before)?.equals(buffer)) {
			rows[index][key][id] = before;await cooperate(cursor);continue;
		}
		const packet = v8.deserialize(bytes);
		for (const [path,[collection,position]] of packet.references) {
			const document = input[collection][position];
			if (!path.length) { packet.value = document;continue; }
			let parent = packet.value;
			for (const field of path.slice(0,-1)) parent = parent[field];
			parent[path.at(-1)] = document;
		}
		// V8 can encode equal arrays differently after optimizing their element
		// representation. A byte mismatch is not a semantic change.
		if (id !== null && !packet.references.length && before && isDeepStrictEqual(before,packet.value)) packet.value = before;
		if (id === null) rows[index][key] = packet.value;else rows[index][key][id] = packet.value;
		if (id !== null && packet.value && typeof packet.value === 'object' && !packet.references.length) diagnostic_bytes.set(packet.value,buffer);
		await cooperate(cursor);
	}
	return rows;
}
function transfers(parts, position) { return parts.filter(part => part[position]?.buffer).map(part => part[position].buffer); }
module.exports = {encode_input,decode_input,encode_output,decode_output,transfers};
