'use strict';

const {isDeepStrictEqual} = require('util');
const {finished, setupFields} = require('../static/js/match_edit_rules');

// Validate before assignments, court releases or any other edit side effects.
module.exports = async function validate_match_edit_place(app, tournament_key, previous, next, assignment = {}) {
	const setup = next.setup;
	if (finished(previous)) {
		const changed_setup = setupFields.some(key => !isDeepStrictEqual(previous.setup?.[key] ?? null, setup[key] ?? null));
		const changed_result = ['score_status', 'team1_won', 'btp_winner', 'end_ts'].some(key =>
			!isDeepStrictEqual(previous[key] ?? null, next[key] ?? null));
		const assigned = ['tabletoperator_assignment_id', 'tabletoperator_replacement_name', 'tabletoperator_replacement_btp_id'].some(key => !!assignment[key]);
		if (changed_setup || changed_result || assigned) throw new Error('Beendetes Spiel: Status, Ort/Feld, Offizielle und Tabletbedienung sind gesperrt. Bitte zuerst den Abschluss zurücknehmen.');
		return;
	}
	const special_result = ['no_match', 'walkover', 'retired', 'disqualified'].includes(next.score_status);
	if (setup.state === 'finished' && !finished(previous) && !special_result) {
		throw new Error('Bitte das Spiel über „Spielende bestätigen“ oder am Tablet abschließen.');
	}
	// Special results have their own completion path, independent of the
	// previous preparation assignment (including legacy location-less data).
	if (special_result && !setup.now_on_court) return;
	if (!setup.now_on_court && setup.state !== 'preparation') return;
	if (setup.now_on_court && !setup.court_id) {
		throw new Error('Für „Auf dem Feld“ muss ein Feld ausgewählt werden.');
	}
	if (setup.court_id) {
		const court = await app.db.courts.findOne_async({_id: setup.court_id, tournament_key});
		if (!court) throw new Error('Das ausgewählte Feld gehört nicht zu diesem Turnier.');
		if (court.location_id) setup.location_id = court.location_id;
	}
	if (!setup.now_on_court && setup.state === 'preparation') {
		const locations = await app.db.locations.find_async({tournament_key});
		if (!setup.location_id && locations.length === 1) setup.location_id = locations[0]._id;
		if (!locations.some(location => location._id === setup.location_id)) {
			throw new Error('Für „In Vorbereitung“ muss ein Ort oder ein Feld ausgewählt werden.');
		}
	}
};
