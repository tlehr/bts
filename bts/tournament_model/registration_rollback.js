'use strict';

const models = new WeakMap();
const events = payload => payload?.events || (Array.isArray(payload) ? payload : undefined);

function capture(store, before, after) {
	const model = models.get(store);
	if (!model || events(before?.events) === events(after?.events)) return null;
	const tournament = model.tournament((after || before).key);
	const profiles = new Map([...tournament.players.values()].map(player => {
		const profile = player._profiles.get(tournament);
		return [player, profile && { source: profile.source, fields: new Map(profile.fields) }];
	}));
	return () => {
		// Restore only this registration owner and its original field revisions.
		// Newer match-owned profiles, including concurrent writes, keep priority.
		for (const player of tournament.players.values()) {
			const profile = profiles.get(player);
			if (profile) player._profiles.set(tournament, profile); else player._profiles.delete(tournament);
			player._refresh_profile();
		}
	};
}

module.exports = { attach: (store, model) => models.set(store, model), capture };
