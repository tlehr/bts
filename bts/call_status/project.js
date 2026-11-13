'use strict';

const {isDeepStrictEqual} = require('util');
const foreground = require('../foreground_work');
const {performance} = require('perf_hooks');

module.exports = async function project(selections, previous = []) {
	const old = new Map(previous.map(row => [String(row.location_id),row])), result = [];
	let turn = performance.now();
	for (const selection of selections) {
		const before = old.get(String(selection.location_id));
		const row = {};
		for (const key of ['location_id', 'required_preparation_count', 'current_preparation_count', 'missing_preparation_count',
			'effective_required_preparation_count', 'effective_missing_preparation_count']) row[key] = selection[key];
		for (const [prefix, field] of [['candidate', 'candidates'], ['selected', 'selected_matches'], ['auto_selected', 'auto_selected_matches'], ['display_candidate', 'display_candidates']]) {
			row[prefix + '_match_ids'] = (selection[field] || []).map(match => match?._id).filter(id => id != null);
			row[prefix + '_match_nums'] = (selection[field] || []).map(match => match?.setup?.match_num).filter(num => num != null);
		}
		for (const name of ['display_frontier', 'display_cutoff']) {
			row[name + '_match_id'] = selection[name]?._id || null;row[name + '_match_num'] = selection[name]?.setup?.match_num ?? null;
		}
		for (const key of ['diagnostics_by_match_id', 'call_on_court_diagnostics_by_match_id', 'field_selection_debug']) row[key] = selection[key] || {};
		for (const key of ['successor_court_ids', 'successor_match_ids', 'free_court_ids', 'demand_court_ids', 'manual_callable_match_ids']) row[key] = selection[key] || [];
		// Most diagnoses survive a new decision unchanged. Reuse their frozen
		// identities so delivery and the browser can compare only changed games.
		for (const key of ['diagnostics_by_match_id', 'call_on_court_diagnostics_by_match_id']) {
			const records = before?.[key], current = row[key];
			if (!records) continue;
			let same = Object.keys(records).length === Object.keys(current).length;
			const shared = {};
			for (const [id,value] of Object.entries(current)) {
				shared[id] = isDeepStrictEqual(records[id],value) ? records[id] : value;
				if (shared[id] !== records[id]) same = false;
				if (performance.now() - turn >= 2 || foreground.background_busy()) {
					await new Promise(resolve => setImmediate(resolve));await foreground.background_idle();turn = performance.now();
				}
			}
			row[key] = same ? records : shared;
		}
		if (before) for (const key of Object.keys(row)) if (row[key] !== before[key] && !['diagnostics_by_match_id','call_on_court_diagnostics_by_match_id'].includes(key) && isDeepStrictEqual(row[key],before[key])) row[key] = before[key];
		result.push(before && Object.keys(row).length === Object.keys(before).length && Object.keys(row).every(key => row[key] === before[key]) ? before : row);
	}
	return result;
};
