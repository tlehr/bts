'use strict';

// Compare imported entry status with the first actual match in a discipline.
// This is read-only: resolving a mismatch remains an explicit Admin action.
var btp_dns_todos = (function() {
	const is_dns = status => status === 'DNS' || status === 108 || status === '108';
	const discipline = match => String(match.setup?.event_name || '')
		.replace(/\s*-\s*(?:Gruppe|Position)\s+.+$/i, '').trim();
	const draws = match => (match.btp_match_ids || []).filter(id => id?.draw != null).map(id => String(id.draw));
	const player_id = player => player.btp_id != null ? 'btp:' + String(player.btp_id)
		: player.member_id != null ? 'member:' + String(player.member_id) : 'name:' + player.name;
	const key = (match, player) => JSON.stringify([discipline(match), player_id(player)]);

	function has_dns(match, team, player) {
		const entries = player.entries || {};
		const ids = draws(match).filter(id => Object.prototype.hasOwnProperty.call(entries, id));
		return ids.length ? ids.some(id => is_dns(entries[id])) : is_dns(team.entry_status);
	}

	function actual_match(match) {
		if (!match?.setup || match.setup.is_match === false || match.setup.is_bye ||
			match._btp_auto_bye_winner_sync === true) return false;
		const teams = match.setup.teams || [];
		// Completed one-sided branches are byes, even after sync clears its marker.
		return !((match.setup.state === 'finished' || match.btp_winner === 1 || match.btp_winner === 2) &&
			typeof match.team1_won === 'boolean' && (!teams[0]?.players?.length || !teams[1]?.players?.length));
	}

	function before(a, b) {
		for (const field of ['scheduled_date', 'scheduled_time_str']) {
			const left = a.setup[field], right = b.setup[field];
			if (left && right && left !== right) return left < right ? -1 : 1;
		}
		const number = match => match.setup.match_num == null ? Infinity : Number(match.setup.match_num);
		const left = number(a), right = number(b);
		if (!Number.isNaN(left) && !Number.isNaN(right) && left !== right) return left < right ? -1 : 1;
		return String(a._id || '').localeCompare(String(b._id || ''));
	}

	function first_match(appearances) {
		const planning = new Set();
		for (const { match } of appearances) {
			for (const id of match.btp_match_ids || []) {
				if (id?.draw != null && id.planning != null) planning.add(JSON.stringify([String(id.draw), String(id.planning)]));
			}
		}
		// A known preceding match takes priority over mutable display numbers.
		const roots = appearances.filter(({ match, team_index }) => {
			const source = match.setup.links?.['from' + (team_index + 1)];
			return source == null || !draws(match).some(draw => planning.has(JSON.stringify([draw, String(source)])));
		});
		return (roots.length ? roots : appearances).slice().sort((a, b) => before(a.match, b.match))[0];
	}

	function lost_without_playing(match, team_index) {
		if (!['walkover', 'no_match'].includes(match.score_status)) return false;
		const loser = match.no_match_losing_team === 0 || match.no_match_losing_team === 1
			? match.no_match_losing_team : typeof match.team1_won === 'boolean' ? (match.team1_won ? 1 : 0) : null;
		return loser === team_index;
	}

	function collect(matches) {
		const groups = new Map();
		// Only collect match references for participants who actually have DNS.
		for (const match of matches || []) {
			if (!actual_match(match)) continue;
			for (const team of match.setup.teams || []) {
				for (const player of team?.players || []) {
					if (player && has_dns(match, team, player)) groups.set(key(match, player), []);
				}
			}
		}
		if (!groups.size) return [];
		for (const match of matches || []) {
			if (!actual_match(match)) continue;
			(match.setup.teams || []).forEach((team, team_index) => {
				for (const player of team?.players || []) {
					if (!player) continue;
					const group = groups.get(key(match, player));
					if (group) group.push({ match, team_index, player });
				}
			});
		}
		const warnings = [], by_match = new Map();
		for (const appearances of groups.values()) {
			const first = first_match(appearances);
			if (lost_without_playing(first.match, first.team_index)) continue;
			if (!by_match.has(first.match)) by_match.set(first.match, new Map());
			const teams = by_match.get(first.match);
			let warning = teams.get(first.team_index);
			if (!warning) {
				warning = { names: [], event_name: discipline(first.match), match_num: first.match.setup.match_num,
					match_id: first.match._id, team_index: first.team_index };
				teams.set(first.team_index, warning); warnings.push(warning);
			}
			warning.names.push(first.player.name || [first.player.firstname, first.player.lastname].filter(Boolean).join(' '));
		}
		return warnings.map(({ names, ...warning }) => ({ ...warning, name: names.join(' / ') }));
	}
	return { collect };
})();

/*@DEV*/
if (typeof module !== 'undefined') module.exports = btp_dns_todos;
/*/@DEV*/
