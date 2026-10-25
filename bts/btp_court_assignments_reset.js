'use strict';

const proto = require('./btp_proto');

function request(connection, value) {
	return new Promise((resolve, reject) => {
		let cancel;
		const timer = setTimeout(() => {
			if (typeof cancel === 'function') cancel();
			reject(new Error('BTP antwortet nicht. Feldzuweisungen wurden nicht bestätigt.'));
		}, 15000);
		try {
			cancel = connection.send(value, response => {
				clearTimeout(timer);
				if (response?.Action?.[0]?.Result?.[0] !== 1) {
					return reject(new Error('BTP hat die Anfrage nicht bestätigt.'));
				}
				resolve(response);
			});
		} catch (error) {
			clearTimeout(timer);
			reject(error);
		}
	});
}

async function read(connection) {
	const response = await request(connection, proto.get_info_request(connection.password));
	const tournament = response.Result?.[0]?.Tournament?.[0];
	if (!tournament) throw new Error('BTP hat keine Turnierdaten geliefert.');
	return tournament;
}

async function reset(connection, matches, options = {}) {
	if (!connection || connection.terminated || !connection.key_unicode) throw new Error('BTP-Verbindung ist nicht bereit.');
	if (connection.readonly) throw new Error('BTP ist im Nur-Lesen-Modus.');
	const before = await read(connection);
	const nodes = new Map((before.Matches?.[0]?.Match || []).map(node => [String(node.ID[0]), node]));
	const active = new Set((before.Courts?.[0]?.Court || []).map(court => String(court.MatchID?.[0])));
	const updates = new Map();
	const allowed_match_ids = [];
	let btp_changed_matches = 0;
	for (const match of matches) {
		const remote = (match.btp_match_ids || []).map(id => nodes.get(String(id.id)));
		if (remote.some(node => !node)) throw new Error('Spiel ' + match.setup?.match_num + ' wurde in BTP nicht gefunden. Bitte zuerst abgleichen.');
		// BTP may already have started/finished a game since the last local sync.
		if (remote.some(node => active.has(String(node.ID[0])) || node.Winner?.[0] || node.ScoreStatus?.[0])) continue;
		allowed_match_ids.push(match._id);
		let changed = false;
		for (const node of remote) {
			if (!node.CourtID?.[0]) continue;
			changed = true;
			updates.set(String(node.ID[0]), {
				id: node.ID[0], draw: node.DrawID[0], planning: node.PlanningID[0],
				status: node.Status?.[0] ?? 0, highlight: node.Highlight?.[0] ?? 0,
				match_order: node.DisplayOrder?.[0] ?? 0,
			});
		}
		if (changed) btp_changed_matches++;
	}
	if (updates.size) {
		await request(connection, proto.reset_court_assignments_request([...updates.values()], connection.key_unicode, connection.password));
		// BTP acknowledges the batch before all its rows are applied. Poll the
		// readback briefly so a partially applied batch is not reported as failed.
		const deadline = Date.now() + (options.verify_timeout_ms ?? 5000);
		for (;;) {
			const after = await read(connection);
			const verified = new Map((after.Matches?.[0]?.Match || []).map(node => [String(node.ID[0]), node]));
			let failure;
			for (const [id, update] of updates) {
				const node = verified.get(id);
				if (!node || node.CourtID?.[0]) {
					failure = 'BTP hat die Feldzuweisung für Spiel-ID ' + id + ' nicht entfernt. Bitte den BTP-Stand prüfen und erneut abgleichen.';
					break;
				}
				if ((node.DisplayOrder?.[0] ?? 0) !== update.match_order) {
					failure = 'BTP hat die Spielreihenfolge für Spiel-ID ' + id + ' verändert. Bitte den BTP-Stand prüfen.';
					break;
				}
			}
			if (!failure) break;
			if (Date.now() >= deadline) throw new Error(failure);
			await new Promise(resolve => setTimeout(resolve, options.verify_interval_ms ?? 100));
		}
	}
	return { allowed_match_ids, btp_changed_matches, skipped_matches: matches.length - allowed_match_ids.length };
}

module.exports = { reset };
