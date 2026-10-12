'use strict';

// References belong to one synchronous selection, never to a persistent cache.
// Only team players participate here; officials and tablet operators follow
// their own availability rules. Dependency IDs retain their original types.
class ParticipantLookup {
	constructor(matches, rules) {
		this.rules = rules;
		this.players = new WeakMap();
		this.open_matches = new Map();
		this.inactive_by_discipline = new Map();
		for (const match of matches) {
			if (!match) continue;
			if (!rules.is_finished(match) && rules.counts_as_open?.(match) !== false) {
				for (const id of new Set(this.player_ids(match))) {
					if (!this.open_matches.has(id)) this.open_matches.set(id, []);
					this.open_matches.get(id).push(match);
				}
			}
			if (!match.score_status || match.score_status === 'normal') continue;
			const discipline = rules.discipline(match);
			if (!discipline) continue;
			if (!this.inactive_by_discipline.has(discipline)) this.inactive_by_discipline.set(discipline, new Set());
			const inactive = this.inactive_by_discipline.get(discipline);
			for (const id of rules.inactive_ids(match)) inactive.add(id);
		}
	}

	player_ids(match) {
		if (!match || typeof match !== 'object') return this.rules.player_ids(match);
		if (!this.players.has(match)) this.players.set(match, this.rules.player_ids(match));
		return this.players.get(match);
	}

	has_earlier_open_match(match) {
		return this.player_ids(match).some(id => (this.open_matches.get(id) || []).some(other =>
			other._id !== match._id && this.rules.compare(other, match) < 0));
	}

	passes_special_result_rule(match) {
		const inactive = this.inactive_by_discipline.get(this.rules.discipline(match));
		return !inactive || this.player_ids(match).every(id => !inactive.has(String(id)));
	}

	inactive_players(match, players) {
		const inactive = this.inactive_by_discipline.get(this.rules.discipline(match));
		return inactive ? players.filter(player => player?.btp_id != null && inactive.has(String(player.btp_id))) : [];
	}
}

module.exports = ParticipantLookup;
