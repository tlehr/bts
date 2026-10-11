'use strict';

// Automatic calls need the real eligibility selection, not all UI diagnostics.
// The empty-selection repair still uses exactly the UI frontier diagnostics.
module.exports = function automatic_selection(location_id, status, tournament, frontier, relevant_matches, candidates, diagnose_frontier) {
	const required = tournament.call_preparation_matches_automatically_enabled ? status.required_preparation_count : 0;
	const missing = Math.max(0, required - status.current_preparation_count);
	const auto_selected_matches = candidates.slice(0, missing);
	const repair = missing > 0 && !auto_selected_matches.length ? diagnose_frontier() : {};
	return {
		location_id, ...status, effective_required_preparation_count: required,
		effective_missing_preparation_count: missing, frontier, relevant_matches,
		candidates, selected_matches: candidates.slice(0, status.missing_preparation_count), auto_selected_matches,
		display_candidates: [], diagnostics_by_match_id: {}, ...repair,
	};
};
