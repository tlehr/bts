'use strict';

// A disqualification can happen after any round; it need not concern the first match.
// Only report inconsistencies. Resolving them remains an explicit Admin action.
var btp_dsq_todos = (function() {
	const discipline = match => String(match.setup?.event_name || '')
		.replace(/\s*-\s*(?:Gruppe|Position)\s+.+$/i, '').trim();
	const key = (match, player) => JSON.stringify([discipline(match),
		player.btp_id != null ? 'btp:' + String(player.btp_id) :
			player.member_id != null ? 'member:' + String(player.member_id) : 'name:' + player.name]);
	const actual_match = match => match?.setup && match.setup.is_match !== false &&
		!match.setup.is_bye && match._btp_auto_bye_winner_sync !== true;

	function collect(matches) {
		const affected = new Map(), recorded = new Set();
		for (const match of matches || []) {
			if (!actual_match(match)) continue;
			const loser = match.no_match_losing_team === 0 || match.no_match_losing_team === 1
				? match.no_match_losing_team : typeof match.team1_won === 'boolean'
					? (match.team1_won ? 1 : 0) : [1, 2].includes(match.btp_winner) ? (match.btp_winner === 1 ? 1 : 0) : null;
			(match.setup.teams || []).forEach((team, team_index) => {
				for (const player of team?.players || []) {
					if (!player) continue;
					const id = key(match, player);
					if (match.score_status === 'disqualified' && loser === team_index) recorded.add(id);
					if (btp_entry_status.player_blocking_status(match, player, team) === 'DSQ') {
						affected.set(id, { name: player.name || [player.firstname, player.lastname].filter(Boolean).join(' '),
							event_name: discipline(match) });
					}
				}
			});
		}
		return Array.from(affected).filter(([id]) => !recorded.has(id)).map(([, todo]) => todo);
	}
	return { collect };
})();

/*@DEV*/
if (typeof module !== 'undefined') {
	var btp_entry_status = require('./btp_entry_status');
	module.exports = btp_dsq_todos;
}
/*/@DEV*/
