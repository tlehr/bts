'use strict';

const crypto = require('crypto');
const { cleanString } = require('./diagnostics/sanitize');
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const scalar = value => Array.isArray(value) ? value[0] : value;

function context(connection, request = {}, details = {}) {
	const tournament = request.Update?.Tournament || {};
	const matches = array(tournament.Matches).flatMap(row => array(row.Match));
	const players = array(tournament.Players).flatMap(row => array(row.Player));
	const courts = array(tournament.Courts).flatMap(row => array(row.Court));
	const action = scalar(request.Action?.ID);
	const operation = action === 'LOGIN' ? 'login' : action === 'SENDTOURNAMENTINFO' ? 'fetch'
		: matches.length ? (matches.some(match => match.Winner != null || match.ScoreStatus != null) ? 'result_update' : 'match_update')
			: players.length ? 'players_update' : courts.length ? 'courts_update' : 'update';
	return {
		request_id: crypto.randomUUID(), started_at: Date.now(), tournament_key: connection.tkey,
		target: connection.ip, port: connection.is_team ? 9911 : 9901, action, operation,
		match_ids: matches.slice(0, 20).map(match => scalar(match.ID)),
		player_ids: players.slice(0, 20).map(player => scalar(player.ID)),
		court_ids: courts.slice(0, 20).map(court => scalar(court.ID)),
		...Object.fromEntries(['match_id', 'match_number', 'match_ids', 'operation'].filter(key => details[key] !== undefined).map(key => [key, details[key]])),
	};
}

function redact(connection, value, limit = 1400) {
	let text = String(value ?? '');
	for (const secret of [connection.password, connection.key_unicode]) {
		if (secret) text = text.split(String(secret)).join('[entfernt]');
	}
	// Error messages from an XML parser may quote part of a reply.
	text = text.replace(/(<(?:Password|Unicode)\b[^>]*>)[\s\S]*?(<\/[^>]+>)/gi, '$1[entfernt]$2')
		.replace(/(<ITEM\b[^>]*\bID=["'](?:Password|Unicode)["'][^>]*>)[\s\S]*?(<\/ITEM>)/gi, '$1[entfernt]$2');
	return cleanString(text, limit);
}

function response_error(request, response) {
	const action = scalar(request.Action?.ID), reply = response?.Action?.[0];
	const result = reply?.Result?.[0];
	const details = ['Message', 'ErrorMessage', 'Description', 'Error'].map(key => scalar(reply?.[key]))
		.filter(value => typeof value === 'string').map(value => value.slice(0, 400)).join(' · ');
	let message, code;
	if (response == null) { code = 'BTP_EMPTY_REPLY'; message = 'BTP hat keine Antwort geliefert.'; }
	else if (result != null && result !== 1) { code = 'BTP_REJECTED'; message = 'BTP hat den Auftrag abgelehnt (Antwortcode ' + result + ').'; }
	else if (action === 'SENDTOURNAMENTINFO' && !response.Result?.[0]?.Tournament?.[0]) {
		code = 'BTP_INVALID_REPLY'; message = 'Die BTP-Antwort enthält keine Turnierdaten.';
	} else if (action !== 'SENDTOURNAMENTINFO' && result == null) {
		code = 'BTP_INVALID_REPLY'; message = 'Der BTP-Antwort fehlt die Auftragsbestätigung.';
	} else if (action === 'LOGIN' && reply?.ID?.[0] !== 'REPLY') {
		code = 'BTP_INVALID_REPLY'; message = 'BTP hat keine gültige Anmeldebestätigung geliefert.';
	} else if (action === 'LOGIN' && !reply?.Unicode?.[0]) {
		code = 'BTP_INVALID_REPLY'; message = 'Der BTP-Anmeldeantwort fehlt die Sitzungskennung.';
	}
	if (!message) return null;
	if (details) message += ' ' + details;
	else if (code === 'BTP_REJECTED') message += ' BTP hat keine weitere Ursache mitgeteilt.';
	return Object.assign(new Error(message), { code, btp_phase: 'reply', btp_result_code: result });
}

function failure(connection, request_context, error) {
	if (error?.btp_logged) return;
	const { started_at, ...details } = request_context;
	const describe = (value, depth = 0) => ({
		name: String(value?.name || 'Error').slice(0, 80),
		message: String(value?.message || value || 'Ursache nicht mitgeteilt'),
		...(value?.code ? { code: String(value.code).slice(0, 100) } : {}),
		...(value?.syscall ? { syscall: String(value.syscall).slice(0, 100) } : {}),
		...(value?.timeout_ms ? { timeout_ms: value.timeout_ms } : {}),
		...(value?.cause && depth < 2 ? { cause: describe(value.cause, depth + 1) } : {}),
	});
	const record = { ...details, ts: Date.now(), duration_ms: Math.max(0, Date.now() - started_at),
		phase: error?.btp_phase || 'local',
		...(error?.btp_result_code != null ? { result_code: error.btp_result_code } : {}), error: describe(error) };
	const clean = value => typeof value === 'string' ? redact(connection, value)
		: Array.isArray(value) ? value.map(clean) : value && typeof value === 'object'
			? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value;
	const safe = clean(record);
	const operations = { result_update: 'Ergebnisübertragung', match_update: 'Spieländerung', players_update: 'Spielerübertragung',
		courts_update: 'Feldübertragung', login: 'Anmeldung', fetch: 'Turnierabgleich', participant_sync: 'Teilnehmerabgleich' };
	const game = safe.match_number == null ? '' : ' · Spiel ' + safe.match_number;
	const message = 'BTP: ' + (operations[safe.operation] || 'Auftrag') + ' fehlgeschlagen' + game + ' · ' + safe.error.message
		+ (safe.error.code ? ' (' + safe.error.code + ')' : '') + '\n[bts] btp_request:failed ' + JSON.stringify(safe);
	try {
		if (connection.app?.diagnostics?.record) {
			connection.app.diagnostics.record({ level: 'error', source: 'server', tournament_key: connection.tkey,
				match_id: details.match_id, trace_id: details.request_id, message });
			// Also retain the ordinary console destination without capturing twice.
			(console.error.btsOriginal || console.error).call(console, message); // eslint-disable-line no-console
		} else console.error(message); // eslint-disable-line no-console
		if (error && typeof error === 'object') error.btp_logged = true;
	} catch (_) { /* Logging must never interrupt result delivery. */ }
}

function local_failure(connection, match, error, operation) {
	operation ||= typeof match?.team1_won === 'boolean' || match?.score_status === 'no_match' ? 'result_update' : 'match_update';
	failure(connection, context(connection, {}, {
		operation, match_id: match?._id, match_number: match?.setup?.match_num,
		match_ids: (match?.btp_match_ids || []).slice(0, 20).map(id => id.id),
	}), error);
}

function safe_message(connection, error) { return redact(connection, error?.message || error); }

module.exports = { context, failure, local_failure, response_error, safe_message };
