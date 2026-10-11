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
	if (at[0] === 'matches' && bt[0] === 'match' && at[1] === bt[1]) {
		return true;
	}
	if (bt[0] === 'matches' && at[0] === 'match' && bt[1] === at[1]) {
		return true;
	}
	if (at[0] === 'courts' && bt[0] === 'court' && at[1] === bt[1]) {
		return true;
	}
	if (bt[0] === 'courts' && at[0] === 'court' && bt[1] === at[1]) {
		return true;
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
	for (const lock_a of a) {
		for (const lock_b of b) {
			if (lock_conflicts(lock_a, lock_b)) return true;
		}
	}
	return false;
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
		locks.push(match(tournament_key, match_id));
	}
	if (court_id) {
		locks.push(court(tournament_key, court_id));
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
	preparation,
	selection,
	score_update,
	sync,
	tabletoperators,
	tournament,
	umpires,
};
