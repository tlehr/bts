'use strict';

function players(setup) {
	return (setup?.teams || []).slice(0, 2).flatMap((team, ti) => (team?.players || [])
		.map((player, pi) => ({ player, path: `setup.teams.${ti}.players.${pi}` })));
}

function expected(matches) {
	const playing = new Map(), tablets = new Map();
	for (const match of matches) {
		if (typeof match.team1_won === 'boolean' || !match.setup?.court_id || match.setup.now_on_court !== true) continue;
		for (const [entries, map] of [[players(match.setup).map(slot => slot.player), playing], [match.setup.tabletoperators || [], tablets]]) {
			for (const player of entries) {
				const id = Number(player?.btp_id);
				if (Number.isFinite(id) && id !== -1) map.set(id, match.setup.court_id);
			}
		}
	}
	return { playing, tablets };
}

// Read shared records without touching presses or mutating their setups. Own
// only repaired flags; a concurrent point may change other setup fields.
function repair(match, flags) {
	const set = {}, changed_players = [];
	let still_playing = false;
	for (const { player, path } of players(match.setup)) {
		if (!player) continue;
		const id = Number(player.btp_id);
		const playing = flags.playing.get(id), tablet = flags.tablets.get(id);
		const wrong_playing = !!player.now_playing_on_court && player.now_playing_on_court !== playing;
		const wrong_tablet = !!player.now_tablet_on_court && player.now_tablet_on_court !== tablet;
		if (player.now_playing_on_court && !wrong_playing) still_playing = true;
		if (!wrong_playing && !wrong_tablet) continue;
		const changed = { ...player, tablet_break_active: false };
		set[path + '.tablet_break_active'] = false;
		if (wrong_playing) {
			changed.now_playing_on_court = false; changed.checked_in = false;
			set[path + '.now_playing_on_court'] = false; set[path + '.checked_in'] = false;
		}
		if (wrong_tablet) { changed.now_tablet_on_court = false; set[path + '.now_tablet_on_court'] = false; }
		changed_players.push(changed);
	}
	if (match.setup?.state === 'blocked' && match.setup.now_on_court !== true && !still_playing) set['setup.state'] = 'scheduled';
	return { set, changed_players };
}

module.exports = { players, expected, repair };
