'use strict';

// References belong to one synchronous selection, never to a persistent cache.
// Dependencies use team players; field calls additionally reserve tablet
// operators. Dependency IDs retain their original types.
class ParticipantLookup {
	constructor(matches, rules) {
		this.rules = rules;
		this.players = new WeakMap();
		this.open_matches = new Map();
		this.inactive_by_discipline = new Map();
		this.busy = require('../match_reconciliation/tablet_queue').busy_ids(matches);
		this.activities = new WeakMap();
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

	activity_conflicts(match) {
		if (this.activities.has(match)) return this.activities.get(match);
		const queue = require('../match_reconciliation/tablet_queue');
		const players = (match.setup?.teams || []).flatMap(team => team.players || []);
		const playing = queue.player_ids(players);
		const tablets = match.setup?.tabletoperators || [];
		const duplicate_roles = new Set([...queue.player_ids(tablets)].filter(id => playing.has(id)));
		const conflicts = [...players, ...tablets].filter(player => {
			const id = String(player?.btp_id);
			return this.busy.has(id) || duplicate_roles.has(id);
		});
		this.activities.set(match, conflicts);
		return conflicts;
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
