'use strict';

// BTP owns entry status. Editing/calling a match from an older browser
// snapshot must not reset it. Only copy these small fields into owned drafts.
function preserve(current, draft) {
	if (!current?.setup || !draft?.setup) return;
	const players = new Map();
	const teams = new Map();
	const ids = team => (team?.players || []).map(p => p?.btp_id).filter(id => id != null).map(String).sort();
	for (const team of current.setup.teams || []) {
		const key = ids(team);
		if (key.length) teams.set(JSON.stringify(key), team);
		for (const player of team?.players || []) {
			if (player?.btp_id != null) players.set(String(player.btp_id), player);
		}
	}
	for (const team of draft.setup.teams || []) {
		const original = teams.get(JSON.stringify(ids(team)));
		if (original) {
			if (original.entry_status !== undefined) team.entry_status = original.entry_status;
			else delete team.entry_status;
		}
		for (const player of team?.players || []) {
			const original = player?.btp_id != null && players.get(String(player.btp_id));
			if (!original) continue;
			if (original.entries) player.entries = { ...original.entries };
			else delete player.entries;
		}
	}
}

module.exports = { preserve };
