'use strict';

// The role belongs to the match; the current official profile belongs to the
// canonical official, never to the embedded copy in a historical match.
class OfficialAssignment {
	constructor(match, role, official) {
		this.match = match;
		this.role = role;
		this.official = official;
		official.assignments.add(this);
		official.matches.add(match);
	}
	_detach() {
		const official = this.official;
		official.assignments.delete(this);
		if (![...official.assignments].some(assignment => assignment.match === this.match)) official.matches.delete(this.match);
	}
	toJSON() { return this.official.data; }
}

module.exports = OfficialAssignment;
