'use strict';

function part(value) {
	return String(value == null ? '' : value).trim().replace(/[:\s]+/g, '_') || '_';
}

function all() {
	return 'all';
}

function legacy_global() {
	return 'legacy:global';
}

function keyed(key) {
	return 'keyed:' + part(key);
}

function tournament(tournament_key) {
	return 'tournament:' + part(tournament_key);
}

function match(tournament_key, match_id) {
	return 'match:' + part(tournament_key) + ':' + part(match_id).replace(/^bts_/, '');
}

function point_match(tkey, id) { return match(tkey, id).replace(/^match:/, 'point-match:'); }
function dependency_match(tkey, id) { return match(tkey, id).replace(/^match:/, 'dependency-match:'); }
function point_court(tkey, id) { return court(tkey, id).replace(/^court:/, 'point-court:'); }
function dependency_court(tkey, id) { return court(tkey, id).replace(/^court:/, 'dependency-court:'); }
const match_families = new Set(['match', 'point-match', 'dependency-match']);
const court_families = new Set(['court', 'point-court', 'dependency-court']);

function matches(tournament_key) {
	return 'matches:' + part(tournament_key);
}

function court(tournament_key, court_id) {
	return 'court:' + part(tournament_key) + ':' + part(court_id);
}

function courts(tournament_key) {
	return 'courts:' + part(tournament_key);
}

function tabletoperators(tournament_key) {
	return 'tabletoperators:' + part(tournament_key);
}

function umpires(tournament_key) {
	return 'umpires:' + part(tournament_key);
}

function sync(tournament_key) {
	return 'sync:' + part(tournament_key);
}

function events(tournament_key) {
	return 'events:' + part(tournament_key);
}

function locations(tournament_key) {
	return 'locations:' + part(tournament_key);
}

function btp(tournament_key) {
	return 'btp:' + part(tournament_key);
}

function auto_call(tournament_key) {
	return 'auto-call:' + part(tournament_key);
}

function preparation(tournament_key) {
	return 'preparation:' + part(tournament_key);
}

function selection(tournament_key) {
	return 'selection:' + part(tournament_key);
}

function tournament_key_from_lock(lock) {
	const pieces = String(lock || '').split(':');
	if (pieces.length < 2) {
		return null;
	}
	if (pieces[0] === 'keyed' || pieces[0] === 'legacy' || pieces[0] === 'btp') {
		return null;
	}
	return pieces[1] || null;
}

function lock_conflicts(a, b) {
	a = String(a || '');
	b = String(b || '');
	if (!a || !b) {
		return false;
	}
	if (a === b) {
		return true;
	}
	if (a === all() || b === all() || a === legacy_global() || b === legacy_global()) {
		return true;
	}
	const at = a.split(':');
	const bt = b.split(':');
	if (at[0] === 'tournament' && tournament_key_from_lock(b) === at[1]) {
		return true;
	}
	if (bt[0] === 'tournament' && tournament_key_from_lock(a) === bt[1]) {
		return true;
	}
	if (at[0] === 'matches' && match_families.has(bt[0]) && at[1] === bt[1]) {
		return true;
	}
	if (bt[0] === 'matches' && match_families.has(at[0]) && bt[1] === at[1]) {
		return true;
	}
	if (at[0] === 'courts' && court_families.has(bt[0]) && at[1] === bt[1]) {
		return true;
	}
	if (bt[0] === 'courts' && court_families.has(at[0]) && bt[1] === at[1]) {
		return true;
	}
	// A point cannot change allocation dependencies. Real document/court
	// writers still exclude both point writers and dependency readers.
	if (a.includes(':') && b.includes(':') && a.slice(a.indexOf(':')) === b.slice(b.indexOf(':'))) {
		if (at[0] === 'match' && match_families.has(bt[0]) || bt[0] === 'match' && match_families.has(at[0])) return true;
		if (at[0] === 'court' && court_families.has(bt[0]) || bt[0] === 'court' && court_families.has(at[0])) return true;
	}
	return false;
}

function any_conflict(left, right) {
	const a = normalize_list(left);
	const b = normalize_list(right);
	return normalized_lists_conflict(a, b);
}

// Queue entries are normalized once when enqueued, not on every comparison.
function normalized_lists_conflict(a, b) {
	if (!a.length || !b.length) return false;
	if (a.length * b.length <= 16) {
		for (const left of a) for (const right of b) if (lock_conflicts(left, right)) return true;
		return false;
	}
	// Lists are sorted once when queued. Exact resource keys need a linear
	// merge instead of comparing every pair of a large allocation scope.
	let left = 0, right = 0;
	while (left < a.length && right < b.length) {
		if (a[left] === b[right]) return true;
		if (a[left] < b[right]) left++; else right++;
	}
	function scoped(source, other) {
		const scopes = {}, items = new Set();
		for (const key of source) {
			if (key === all() || key === legacy_global()) return true;
			const [family, namespace] = key.split(':', 2);
			if (family === 'match' || family === 'court') items.add(key);
			if (['tournament', 'matches', 'courts'].includes(family)) (scopes[family] ||= new Set()).add(namespace);
		}
		if (!Object.keys(scopes).length && !items.size) return false;
		for (const key of other) {
			if (items.size && key.includes(':') && (key.startsWith('point-') || key.startsWith('dependency-')) && items.has(key.replace(/^(point|dependency)-/, ''))) return true;
			if (scopes.tournament?.has(tournament_key_from_lock(key))) return true;
			if (scopes.matches || scopes.courts) {
				const [family, namespace] = key.split(':', 2);
				if (match_families.has(family) && scopes.matches?.has(namespace) || court_families.has(family) && scopes.courts?.has(namespace)) return true;
			}
		}
		return false;
	}
	return scoped(a, b) || scoped(b, a);
}

function normalize_list(locks) {
	return [...new Set((Array.isArray(locks) ? locks : [locks])
		.map((lock) => String(lock || '').trim())
		.filter(Boolean))].sort();
}

function score_update(tournament_key, score_data, options = {}) {
	const locks = [];
	const match_id = score_data?.match_id;
	const court_id = score_data?.court_id;
	if (match_id) {
		locks.push(options.point === true && !options.finish ? point_match(tournament_key, match_id) : match(tournament_key, match_id));
	}
	if (court_id) {
		locks.push(options.point === true && !options.finish ? point_court(tournament_key, court_id) : court(tournament_key, court_id));
	}
	if (!match_id && !court_id) {
		locks.push(tournament(tournament_key));
	}
	if (options.finish === true) {
		// Cleanup releases participants and this court. Allocation of free courts
		// runs later under its own locks; points on other courts can continue.
		if (!court_id) locks.push(courts(tournament_key));
		locks.push(tabletoperators(tournament_key));
		locks.push(umpires(tournament_key));
		locks.push(auto_call(tournament_key));
		locks.push(preparation(tournament_key));
	}
	return normalize_list(locks);
}

module.exports = {
	all,
	auto_call,
	any_conflict,
	btp,
	court,
	courts,
	events,
	keyed,
	legacy_global,
	locations,
	lock_conflicts,
	match,
	matches,
	normalize_list,
	normalized_lists_conflict,
	part,
	point_match,
	point_court,
	dependency_match,
	dependency_court,
	preparation,
	selection,
	score_update,
	sync,
	tabletoperators,
	tournament,
	umpires,
};
