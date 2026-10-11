'use strict';

function equal(a, b) {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let index = 0; index < a.length; index++) if (!equal(a[index], b[index])) return false;
		return true;
	}
	if (Array.isArray(b)) return false;
	const fields = Object.keys(a);
	if (fields.length !== Object.keys(b).length) return false;
	for (const field of fields) if (!equal(a[field], b[field])) return false;
	return true;
}

function value_for(input, field, profile) {
	if (profile && field === 'entries' && input[field] instanceof Map) return Array.from(input[field]);
	if (!profile && field === 'bts_players') return (input[field] || []).map(team => (team || []).map(player => player.ID));
	if (!profile && field === 'bts_winners') return input[field]?.map(player => player.ID);
	return input[field];
}

// Retain an immutable input revision when its fields are equal. Most BTP fields
// are short arrays of primitives, so comparing them avoids copying and JSON
// serialization for unchanged records. The snapshot also supports callers that
// modify their next response in place, rather than supplying new objects.
function input_revision(input, previous, profile = false) {
	const fields = Object.keys(input).filter(field => input[field] !== undefined);
	if (previous && fields.length === previous.field_count && fields.every(field =>
		equal(value_for(input, field, profile), previous.data[field]))) {
		return previous;
	}
	const projection = {};
	for (const field of fields) projection[field] = value_for(input, field, profile);
	const signature = JSON.stringify(projection);
	const data = JSON.parse(signature);
	return { signature, data, field_count: Object.keys(data).length };
}

module.exports = input_revision;
