'use strict';

// Shared by the server and Admin UI. Entry status belongs to a BTP draw,
// not to the player's participation in every discipline.
var btp_entry_status = (function() {
	const is_dns = status => status === 'DNS' || status === 108 || status === '108';

	function player_has_dns(match, player, team) {
		if (!match || !player) return false;
		const entries = player.entries || {};
		let explicit_status = false;
		for (const id of match.btp_match_ids || []) {
			if (id?.draw == null || !Object.prototype.hasOwnProperty.call(entries, id.draw)) continue;
			explicit_status = true;
			if (is_dns(entries[id.draw])) return true;
		}
		if (explicit_status) return false;
		team = team || (match.setup?.teams || []).find(candidate => (candidate?.players || []).some(p =>
			p === player || (p?.btp_id != null && player.btp_id != null && String(p.btp_id) === String(player.btp_id))));
		return is_dns(team?.entry_status);
	}

	function dns_players(match) {
		return (match?.setup?.teams || []).flatMap(team => (team?.players || [])
			.filter(player => player_has_dns(match, player, team)));
	}

	function call_error(match) {
		const players = dns_players(match);
		if (!players.length) return null;
		const names = players.map(p => p.name || [p.firstname, p.lastname].filter(Boolean).join(' ') || p.btp_id).join(' / ');
		return new Error('Match cannot be called: ' + names + ' is marked DNS in BTP for ' + (match.setup.event_name || 'this discipline') + '.');
	}
	return { is_dns, player_has_dns, dns_players, call_error };
})();

/*@DEV*/
if (typeof module !== 'undefined') module.exports = btp_entry_status;
/*/@DEV*/
