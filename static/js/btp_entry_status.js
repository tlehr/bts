'use strict';

// Shared by the server and Admin UI. Entry status belongs to a BTP draw,
// not to the player's participation in every discipline.
var btp_entry_status = (function() {
	const is_dns = status => status === 'DNS' || status === 108 || status === '108';
	const blocking_status = status => is_dns(status) ? 'DNS' :
		(status === 'WDN' || status === 109 || status === '109' ? 'WDN' : null);

	function player_status(match, player, team, normalize) {
		if (!match || !player) return null;
		const entries = player.entries || {};
		let explicit_status = false;
		for (const id of match.btp_match_ids || []) {
			if (id?.draw == null || !Object.prototype.hasOwnProperty.call(entries, id.draw)) continue;
			explicit_status = true;
			const status = normalize(entries[id.draw]);
			if (status) return status;
		}
		if (explicit_status) return null;
		team = team || (match.setup?.teams || []).find(candidate => (candidate?.players || []).some(p =>
			p === player || (p?.btp_id != null && player.btp_id != null && String(p.btp_id) === String(player.btp_id))));
		return normalize(team?.entry_status);
	}

	// The first-match DNS todo must not treat a later withdrawal as a no-show.
	const player_has_dns = (match, player, team) => !!player_status(match, player, team, is_dns);
	const player_blocking_status = (match, player, team) => player_status(match, player, team, blocking_status);
	const player_is_blocked = (match, player, team) => !!player_blocking_status(match, player, team);

	function dns_players(match) {
		return (match?.setup?.teams || []).flatMap(team => (team?.players || [])
			.filter(player => player_has_dns(match, player, team)));
	}
	function blocked_players(match) {
		return (match?.setup?.teams || []).flatMap(team => (team?.players || [])
			.filter(player => player_is_blocked(match, player, team)));
	}

	function blocking_reason(match) {
		return blocked_players(match).map(p =>
			(p.name || [p.firstname, p.lastname].filter(Boolean).join(' ') || p.btp_id) +
			' (' + player_blocking_status(match, p) + ')').join(' / ');
	}

	function call_error(match) {
		const reason = blocking_reason(match);
		if (!reason) return null;
		return new Error('Match cannot be called: ' + reason + ' is blocked in BTP for ' + (match.setup.event_name || 'this discipline') + '.');
	}
	return { is_dns, player_has_dns, dns_players, player_blocking_status, player_is_blocked,
		blocked_players, blocking_reason, call_error };
})();

/*@DEV*/
if (typeof module !== 'undefined') module.exports = btp_entry_status;
/*/@DEV*/
