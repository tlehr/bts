'use strict';

const { player_ids } = require('./player_ids');

// Copy-on-write revisions keep captured lock dependencies stable during
// lock-free sync planning. Ordinary score changes reuse the same revision.
class Relations {
	constructor(players = new Map(), courts = new Map(), releasable = new Set()) {
		this._players = players;
		this._courts = courts;
		this._releasable = releasable;
	}
	for_player(id) { return (this._players.get(String(id)) || new Set()).values(); }
	for_court(id) { return (this._courts.get(String(id)) || new Set()).values(); }
	releasable_blocked_matches() { return this._releasable.values(); }
	with_match(id, before, after) {
		let players = this._players;
		let courts = this._courts;
		const revise = (index, old_keys, new_keys) => {
			let result = index;
			for (const key of new Set([...old_keys, ...new_keys])) {
				if (old_keys.has(key) === new_keys.has(key)) continue;
				if (result === index) result = new Map(index);
				const matches = new Set(index.get(key));
				if (new_keys.has(key)) matches.add(id);
				else matches.delete(id);
				if (matches.size) result.set(key, matches);
				else result.delete(key);
			}
			return result;
		};
		players = revise(players, new Set(player_ids(before)), new Set(player_ids(after)));
		const court_keys = doc => new Set(doc?.setup?.court_id != null ? [String(doc.setup.court_id)] : []);
		courts = revise(courts, court_keys(before), court_keys(after));
		const releasable = doc => doc?.setup?.state === 'blocked' && doc.setup.now_on_court !== true &&
			!(doc.setup.teams || []).slice(0, 2).some(team => (team.players || []).some(player => player.now_playing_on_court));
		let blocked = this._releasable;
		if (releasable(before) !== releasable(after)) {
			blocked = new Set(blocked);
			if (releasable(after)) blocked.add(id);
			else blocked.delete(id);
		}
		return players === this._players && courts === this._courts && blocked === this._releasable
			? this : new Relations(players, courts, blocked);
	}
}

module.exports = Relations;
