'use strict';

const queue = require('./update_queue');
const manager = require('./btp_manager');

async function reset(app, key, {target = 'bts'} = {}, notify = () => {}) {
	if (typeof key !== 'string' || !key) throw new Error('Ungültiges Turnier.');
	if (!['bts', 'both'].includes(target)) throw new Error('Ungültiges Ziel für das Zurücksetzen.');
	return queue.execute_locked([queue.lock_keys.tournament(key)], queue.named('player_checkin_reset_' + key, async () => {
		const tournament = await app.db.tournaments.findOne_async({key});
		if (!tournament) throw new Error('Turnier nicht gefunden.');
		if (target === 'both' && (!tournament.btp_enabled || tournament.btp_readonly || manager.get_status(key)?.status !== 'connected')) {
			throw new Error('Zum Zurücksetzen in BTS und BTP muss BTP schreibend verbunden sein.');
		}
		const matches = await new Promise((resolve, reject) => app.db.matches.find({tournament_key:key},
			{tournament_key:1, setup:1, btp_match_ids:1, btp_winner:1}, (error, values) => error ? reject(error) : resolve(values)));
		const edits = [], players = new Map();
		let player_count = 0, changed_matches = 0;
		for (const match of matches) {
			const patch = {};
			const teams = Array.isArray(match.setup?.teams) ? match.setup.teams : [];
			for (const [team_index, team] of teams.entries()) {
				const participants = Array.isArray(team?.players) ? team.players : [];
				for (const [player_index, player] of participants.entries()) {
					if (!player || typeof player !== 'object') continue;
					if (player.btp_id != null) players.set(String(player.btp_id), {btp_id:player.btp_id, checked_in:false});
					if (player.checked_in === false) continue;
					patch['setup.teams.' + team_index + '.players.' + player_index + '.checked_in'] = false;
					player_count++;
				}
			}
			if (!Object.keys(patch).length) continue;
			if (target === 'both' && tournament.btp_settings?.check_in_per_match === true && match.btp_match_ids?.length) patch.btp_needsync = true;
			edits.push({match, patch});
		}
		// With global BTP check-in, its player records own attendance instead of
		// the match status bits. Reuse the normal player-update queue in that mode.
		if (target === 'both' && tournament.btp_settings?.check_in_per_match !== true && players.size &&
			!manager.update_players(app, key, [...players.values()])) {
			throw new Error('BTP-Verbindung ist nicht bereit. Es wurde nichts zurückgesetzt.');
		}
		try {
			await require('./match_cleanup/participant_writes')(app, edits, records => {
				for (const match of records) {
					changed_matches++;
					notify('update_player_status', {match__id:match._id, setup:match.setup, btp_winner:match.btp_winner});
					if (target === 'both' && tournament.btp_settings?.check_in_per_match === true && match.btp_match_ids?.length) {
						manager.update_highlight(app, match);
					}
				}
			});
		} finally {
			// One refresh for the bulk action, including successfully saved groups
			// if a later group fails. Never send one full refresh per player/game.
			if (changed_matches) {
				notify('player_checkin_reset', {changed_matches});
				require('./bupws').handle_score_change(app, key);
			}
		}
		return {target, changed_matches, player_count};
	}));
}

module.exports = {reset};
