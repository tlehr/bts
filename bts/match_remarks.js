'use strict';

const queue = require('./update_queue');
const report = require('../static/js/scoresheet_remarks');
const MAX_LENGTH = 4000;

function normalize(value) {
	if (typeof value !== 'string' || value.length > MAX_LENGTH) throw new Error('Bemerkungen dürfen höchstens 4000 Zeichen enthalten.');
	const text = value.replace(/\r\n?/g, '\n').trim();
	if (!text) throw new Error('Bitte eine Bemerkung eingeben.');
	return text;
}

async function check(app, key, id, remark, remark_id, target, previous, options = {}) {
	const deleted = options.deleted === undefined ? false : options.deleted;
	if (typeof deleted !== 'boolean') throw new Error('Die Löschangabe der Bemerkung ist ungültig.');
	if (typeof remark_id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(remark_id)) throw new Error('Die Kennung der Bemerkung fehlt. Bitte den Dialog erneut öffnen.');
	if (options.role !== undefined && (typeof options.role !== 'string' || !Object.hasOwn(report.ROLES,options.role))) {
		throw new Error('Bitte Schiedsrichter, Turnierleitung oder Referee als Rolle auswählen.');
	}
	if (target !== undefined && (typeof target !== 'string' || typeof previous !== 'string')) throw new Error('Die zu ändernde Bemerkung oder Version fehlt.');
	if (target === undefined && (deleted || previous !== undefined)) throw new Error('Bitte eine bestehende Bemerkung auswählen.');
	const match = await app.db.matches.findOne_async({ tournament_key: key, _id: id });
	if (!match) throw new Error('Spiel nicht gefunden.');
	const existing = match.presses?.find(press => press.type === 'note' && press.note_id === remark_id);
	const entry = target === undefined ? null : report.entries(match,{includeDeleted:true}).find(note => note.key === target);
	const text = deleted ? (existing?.val ?? entry?.val ?? '') : normalize(remark);
	const role = deleted ? (entry?.role ?? existing?.note_role ?? 'umpire') : (options.role ?? existing?.note_role ?? entry?.role ?? 'umpire');
	if (existing && (existing.val !== text || (existing.note_role || 'umpire') !== role || !!existing.note_deleted !== deleted ||
		(existing.edit_target || '') !== (target || '') || (existing.edit_previous || '') !== (previous || ''))) {
		throw new Error('Unter dieser Kennung wurde bereits eine andere Bemerkung gespeichert. Bitte den Dialog erneut öffnen.');
	}
	if (!existing && target !== undefined) {
		if (entry?.deleted) throw new Error('Diese Bemerkung wurde inzwischen gelöscht.');
		if (!entry || entry.latest_key !== previous) throw new Error('Diese Bemerkung wurde inzwischen geändert. Bitte die aktuelle Version erneut auswählen; dein Entwurf bleibt erhalten.');
		if (!deleted && entry.val === text && entry.role === role) throw new Error('Text und Rolle der Bemerkung sind unverändert.');
	}
	return { match, text, role, deleted, entry, existing };
}

async function save(app, key, id, remark, remark_id, target, previous, options = {}) {
	const { match, text, role, deleted, entry, existing } = await check(app, key, id, remark, remark_id, target, previous, options);
	if (existing) return { match_id: id, presses: match.presses };
	const timestamp = app.clock?.now_ms() ?? Date.now();
	const note = {type: 'note', val: text, timestamp, note_id: remark_id, source: 'tournament-control', note_role: role,
		score: structuredClone(match.network_score || match.score_status_network_score || [])};
	if (deleted) note.note_deleted = true;
	const additions = [];
	// Preserve remarks entered with the first dialog version when this game is next saved.
	if (match.scoresheet_notes) additions.push({type: 'note', val: match.scoresheet_notes, timestamp,
		note_id: remark_id + '-previous', source: 'tournament-control'});
	if (target !== undefined) {
		note.note_target = target === 'legacy' ? 'id:' + remark_id + '-previous' : target;
		note.edit_target = target;note.edit_previous = previous;
		const origin=entry.versions[0];
		if (origin.source !== 'tournament-control') note.note_origin={key:target,val:origin.val,timestamp:origin.timestamp,score:origin.score,role:origin.role};
	}
	additions.push(note);
	const [, updated] = await app.db.matches.update_async({ tournament_key: key, _id: id }, {
		$push: {presses: {$each: additions}}, $unset: {scoresheet_notes: true},
	}, {returnUpdatedDocs: true});
	if (!updated) throw new Error('Spiel nicht gefunden.');
	const response = { match_id: id, presses: updated.presses };
	require('./admin').notify_change(app, key, 'match_remarks', response);
	return response;
}

async function handle_save(app, ws, msg) {
	if (typeof msg.tournament_key !== 'string' || !msg.tournament_key || typeof msg.match_id !== 'string' || !msg.match_id) return ws.respond(msg, new Error('Turnier oder Spiel fehlt.'));
	try {
		const response = await queue.execute_locked([queue.lock_keys.match(msg.tournament_key, msg.match_id)],
			() => save(app, msg.tournament_key, msg.match_id, msg.remark, msg.remark_id, msg.remark_target, msg.remark_previous, {role:msg.remark_role,deleted:msg.remark_delete}));
		ws.respond(msg, null, response);
	} catch (error) { ws.respond(msg, error); }
}

// The tablet owns rally history; control remarks are preserved independently
// when it submits a newer snapshot, reconnects, undoes a point or finishes.
function merge(match, incoming) {
	const managed = press => press.type === 'note' && press.source === 'tournament-control';
	const saved = (match.presses || []).filter(managed);
	if (!saved.length && !(incoming || []).some(managed)) return incoming;
	return [...(incoming || []).filter(press => !managed(press)), ...saved];
}

module.exports = { MAX_LENGTH, normalize, check, save, handle_save, merge };
