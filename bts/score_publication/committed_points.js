'use strict';

// Called synchronously from a successful score persistence callback while the
// validated match/court locks are still held. This only advances the score of
// an already displayed match; the normal fanout still refreshes presentation,
// changed assignments and full views. Never send a new game's points into an
// old game's view, and retain ordinary reads when TTL can remove a court.
module.exports = function publish({ app, key, court, match, panels, build, send, visible, full_state_fallback, lock_scope_active }) {
	if (lock_scope_active === false || full_state_fallback || !court || !match || court.match_id !== match._id || !visible(app, match) ||
		Object.keys(app.db.courts.ttlIndexes || {}).length || Object.keys(app.db.matches.ttlIndexes || {}).length) return 0;
	const id = match.setup?.match_id || match._id;
	const recipients = panels.filter(ws => ws.readyState === 1 && ws.last_tournament_key === key && ws.panel_devicemode === 'display' &&
		(ws.v2_multi_court_display === true ? ws.last_v2_match_ids_by_court instanceof Map && ws.last_v2_match_ids_by_court.get(court._id) === id
			: ws.court_id === court._id && ws.last_v2_match_id === id));
	if (!recipients.length) return 0;
	const updates = build(app, { court, match });
	let sent = 0;
	for (const ws of recipients) {
		try { if (send(ws, updates, app, key)) sent++; }
		catch (error) { console.warn('[bts] committed score display failed:', error.message || String(error)); } // eslint-disable-line no-console
	}
	return sent;
};
