'use strict';

// One instance belongs to one synchronous calculation. Match lists and their
// block keys must remain unchanged until that calculation finishes.
class FrontierPositions {
	constructor(block_key) {
		this.block_key = block_key;
		this.lists = new WeakMap();
	}

	index(matches) {
		let index = this.lists.get(matches);
		if (index) return index;
		const by_object = new Map(), by_id = new Map();
		let last_key = null, block = -1;
		matches.forEach(match => {
			const key = this.block_key(match);
			if (key !== last_key) { block++; last_key = key; }
			// Identity takes precedence over ID; repeated objects and IDs retain
			// their first position, as in the original Array.find lookups.
			if (!by_object.has(match)) by_object.set(match, block);
			const id = match?._id;
			// Map treats NaN keys as equal, while the original strict comparison
			// never matched a NaN ID. Null IDs only support identity lookup.
			if (id != null && id === id && !by_id.has(id)) by_id.set(id, block);
		});
		index = { by_object, by_id };
		this.lists.set(matches, index);
		return index;
	}

	position(match, index) {
		if (!match) return undefined;
		if (index.by_object.has(match)) return index.by_object.get(match);
		if (match._id == null) return undefined;
		return index.by_id.get(match._id);
	}

	distance(match, frontier, matches) {
		const index = this.index(matches);
		const position = this.position(match, index);
		const frontier_position = this.position(frontier, index);
		return position === undefined || frontier_position === undefined
			? Number.POSITIVE_INFINITY : position - frontier_position;
	}
}

module.exports = FrontierPositions;
