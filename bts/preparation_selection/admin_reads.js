'use strict';

const reads = require('./model_reads');
const rules = require('../match_automation');
const foreground = require('../foreground_work');
const collections = ['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators'];
const caches = new WeakMap();
const MAX_AGE_MS = 250;

function project(selections) {
	return selections.map(selection => {
		const row = {};
		for (const key of ['location_id', 'required_preparation_count', 'current_preparation_count', 'missing_preparation_count',
			'effective_required_preparation_count', 'effective_missing_preparation_count']) row[key] = selection[key];
		for (const [prefix, field] of [['candidate', 'candidates'], ['selected', 'selected_matches'], ['auto_selected', 'auto_selected_matches'],
			['display_candidate', 'display_candidates']]) {
			row[prefix + '_match_ids'] = selection[field].map(match => match?._id).filter(id => id != null);
			row[prefix + '_match_nums'] = selection[field].map(match => match?.setup?.match_num).filter(num => num != null);
		}
		for (const name of ['display_frontier', 'display_cutoff']) {
			row[name + '_match_id'] = selection[name]?._id || null;
			row[name + '_match_num'] = selection[name]?.setup?.match_num ?? null;
		}
		for (const key of ['diagnostics_by_match_id', 'call_on_court_diagnostics_by_match_id', 'field_selection_debug']) row[key] = selection[key] || {};
		for (const key of ['successor_court_ids', 'successor_match_ids', 'free_court_ids', 'demand_court_ids']) {
			row[key] = Array.isArray(selection[key]) ? selection[key] : [];
		}
		return row;
	});
}

async function read(app, key, options = {}) {
	// Do not fill the datastore queues with six UI reads while a point or
	// locked sync is waiting for persistence. These are still ordered reads.
	await foreground.background_idle();
	const now_ts = options.now_ts ?? app.clock?.now_ms() ?? Date.now();
	// Every request still crosses the existing datastore read barriers. A
	// queued check-in, result or sync cannot be bypassed by a cached response.
	const values = await require('./selection_reads')(app, key, null, null, true);
	// A score may have started while the read barriers were being crossed.
	await foreground.background_idle();
	const references = collections.flatMap(name => name === 'tournaments' ? [values[name]] : [name, ...values[name]]);
	const cacheable = options.cache !== false && collections.every(name => reads.supported(app, name, true) &&
		!Object.keys(app.db[name].ttlIndexes || {}).length);
	let cache = caches.get(app);
	if (!cache) caches.set(app, cache = new Map());
	const bucket = Math.floor(now_ts / MAX_AGE_MS), previous = cache.get(key);
	if (cacheable && previous?.bucket === bucket && previous.references.length === references.length &&
		previous.references.every((document, index) => document === references[index])) return previous.promise;
	const entry = { bucket, references };
	const traces = require('../performance/traces'), initial = traces.begin('preparation_selection_dispatch', 'phase');
	let calculation;
	try {
		// Candidate discovery and diagnostics both yield. The cooperative runner
		// measures their CPU turns; this span only measures dispatch overhead.
		calculation = rules.calculate_all_location_preparation_selections({ ...(values.tournaments || {}),
			locations: values.locations, courts: values.courts, matches: values.matches, umpires: values.umpires, tabletoperators: values.tabletoperators,
		}, { now_ts, app, cooperative: true });
		traces.end(initial, null, { input_documents: values.matches.length });
	} catch (error) { traces.end(initial, error); throw error; }
	entry.promise = calculation.then(project).then(rows =>
		cacheable ? require('../admin_response/selection_cache').certify(rows) : rows);
	if (cacheable) {
		if (cache.size >= 32 && !cache.has(key)) cache.delete(cache.keys().next().value);
		cache.set(key, entry);
		const expire = () => { if (cache.get(key) === entry) cache.delete(key); };
		setTimeout(expire, MAX_AGE_MS).unref();
		void entry.promise.catch(expire);
	}
	return entry.promise;
}

module.exports = { read };
