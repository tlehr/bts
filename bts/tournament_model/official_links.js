'use strict';

const OfficialAssignment = require('./official_assignment');

module.exports = function update_official_links(match, document) {
	for (const role of ['umpire', 'service_judge']) {
		const id = document?.setup?.[role]?._id;
		const official = id != null ? match.model.entity('umpires', id, match.tournament) : null;
		const previous = match.official_assignments.get(role);
		if (previous?.official === official) continue;
		if (previous) previous._detach();
		match.official_assignments.delete(role);
		if (official) match.official_assignments.set(role, new OfficialAssignment(match, role, official));
	}
};
