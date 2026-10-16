/* exported createContextSpeechPlan */
'use strict';

function createContextSpeechPlan(texts, tournament, name, setup = {}, args = [], browserParts = []) {
    const PREFIX = '~bts-context-v1~';
    const example1 = 'Nina Keo Boun Khoune', example2 = 'LeandraGalowicz';
    const reference = `Spiel 189.  Mädcheneinzel U19.  Achtelfinale! ${example1} gegen ${example2}.`;
    const field = texts.createFieldAnnouncement(setup);
    const fieldReference = texts.createFieldAnnouncement({ court_id: 'default_8' });
    const normal = texts.createSecondCallAnnouncement();
    const prep = texts.createSecondPreparationCallAnnouncement();
    const instruction = 'Bitte mit dem Spielen beginnen!';
    const end = value => String(value || '').replace(/[\s.!?]+$/, '');
    const encoded = (before, text, after, kind = 'generic') => PREFIX + JSON.stringify({ before, text, after, kind });
    const piece = (source, text, kind = 'generic', last = false) => {
        if (!text) return null;
        const index = last ? source.lastIndexOf(text) : source.indexOf(text);
        if (index < 0) throw new Error('context_piece_missing');
        return encoded(source.slice(0, index), text, source.slice(index + text.length), kind);
    };
    const whole = (text, kind = 'game') => encoded('', text, '', kind);
    const fieldPiece = closing => {
        if (!field) return null;
        const source = `${field} ${reference} ${field}`;
        return piece(source, field, closing ? 'field_end' : 'field_start', closing);
    };
    let game, team1, team2, header;
    const gamePieces = () => {
        if (!game) {
            team1 = texts.createSingleTeam(setup.teams[0].players);
            team2 = texts.createSingleTeam(setup.teams[1].players);
            header = [texts.createMatchNumberAnnouncement(setup), texts.createEventAnnouncement(setup),
                texts.createRoundAnnouncement(setup)].filter(Boolean).map((text, index) => end(text) + (index === 2 ? '!' : '.')).join(' ');
            game = [header, `${team1} gegen ${team2}.`].filter(Boolean).join(' ');
        }
        return whole(game);
    };
    const teamPiece = index => {
        gamePieces();
        return index === 0 ? encoded(header ? header + ' ' : '', team1, ` gegen ${team2}.`, 'team') :
            encoded(`${header ? header + ' ' : ''}${team1} gegen `, team2, '.', 'team');
    };
    const official = role => {
        const value = role === 'umpire' ? texts.createUmpire(setup) : role === 'judge' ? texts.createServiceJudge(setup) : texts.createTabletOperator(setup);
        if (!value) return null;
        const full = `${fieldReference} ${normal}${value}`;
        const names = role === 'umpire' ? texts.normalizeNames(setup.umpire.name) : role === 'judge' ?
            texts.normalizeNames(setup.service_judge.name) : texts.createSingleTeam(setup.tabletoperators);
        return { role: piece(full, value), long: piece(full, normal + value,
            value.startsWith('Klapptafelbedienung:') ? 'board_long' : 'generic'),
        names: piece(full, names, 'generic', true) };
    };
    const location = (tournament.locations || []).find(hall => hall._id === setup.location_id);
    const hall = plural => texts.resolveSingularPluralAnnouncement(location?.preparation_addition || '', plural);
    const meeting = plural => texts.createMeetingPointAnnouncement(setup, plural);
    const preparation = texts.createPreparationAnnouncement(setup, true);
    const hallSource = `${preparation} Für Spielfeld 8! ${reference} ${meeting(true)}`;
    const hallEndSource = `${preparation} Für Spielfeld 8! ${reference} ${preparation}`;
    const secondHall = plural => {
        const example = plural ? `${example1} und ${example2}` : example1;
        const source = `${prep}${example}${hall(plural) ? ' ' + hall(plural) : ''}! ${example} ${meeting(plural)}`;
        return { prefix: piece(source, prep, 'prep_prefix'),
            hall: hall(plural) ? piece(source, hall(plural) + '!', 'hall') : null,
            meeting: piece(source, meeting(plural), 'generic', true) };
    };
    // Always the same reference supplies the shared prefix, independent of the
    // current opponent or the number of people addressed by the hall addition.
    const commonPrefix = () => piece(`${prep}${example1} in Halle 2! ${example1} Bitte melde dich bei der Turnierleitung!`, prep, 'prep_prefix');
    const normalSource = `${fieldReference} ${normal}Schiedsrichter:Alexandra Becker`;
    const result = (parts, pauses = []) => ({ parts: parts.filter(Boolean), pauses: parts.filter(Boolean).map((_, index, all) =>
        index === all.length - 1 ? 0 : pauses[index] ?? 250) });
    const officials = () => ['umpire', 'judge', 'tablet'].map(role => official(role)?.role).filter(Boolean);
    const teamIndex = name.includes('TeamTwo') ? 1 : 0;
    if (name === 'prepareFields') return result([fieldPiece(false), fieldPiece(true)]);
    if (name === 'prepareGame') return result([gamePieces(), teamPiece(0), teamPiece(1)]);
    if (name === 'prepareInstruction') return result([piece(`${fieldReference} ${instruction}`, instruction)]);
    if (name === 'prepareCommon') {
        const clause = 'Das Spiel geht kampflos an';
        return result([piece(normalSource, normal), commonPrefix(), piece(`${reference} ${clause}: ${example1}!`, clause)]);
    }
    if (name === 'announceNewMatch') return result([fieldPiece(false), gamePieces(), ...officials(), fieldPiece(true)]);
    if (name === 'announcePreparationMatch') {
        const opening = field ? `${preparation} ${texts.createFieldPreparationAnnouncement(setup)}` : preparation;
        const source = `${opening}${field ? '' : ' Für Spielfeld 8!'} ${reference} ${meeting(true)}`;
        return result([piece(source, opening), gamePieces(), ...officials(), tournament.preparation_meetingpoint_enabled ?
            piece(hallSource, meeting(true), 'generic', true) : piece(hallEndSource, preparation, 'generic', true)]);
    }
    if (name === 'announceBeginnToPlay') return result([fieldPiece(false), piece(`${fieldReference} ${instruction}`, instruction)]);
    if (name === 'announceSecondCallTeamOne' || name === 'announceSecondCallTeamTwo') {
        return result([piece(normalSource, normal), teamPiece(teamIndex), fieldPiece(true)], [60, 250]);
    }
    if (name === 'announceSecondPreparationCallTeamOne' || name === 'announceSecondPreparationCallTeamTwo') {
        const values = secondHall(setup.teams[teamIndex].players.length !== 1);
        const parts = [commonPrefix(), teamPiece(teamIndex), values.hall, teamPiece(teamIndex),
            tournament.preparation_meetingpoint_enabled ? values.meeting : null].filter(Boolean);
        const pauses = values.hall ? [140, 120, 320, 160] : [140, 320, 160];
        return result(parts, pauses);
    }
    if (name === 'announceNoMatchWin') {
        const clause = 'Das Spiel geht kampflos an';
        return result([gamePieces(), piece(`${reference} ${clause}: ${example1}!`, clause), teamPiece(args[0])], [250, 140]);
    }
    const roles = { Umpire: 'umpire', ServiceJudge: 'judge', Tabletoperator: 'tablet' };
    const suffix = Object.keys(roles).find(value => name.endsWith(value));
    if (suffix) {
        const value = official(roles[suffix]);
        if (!value) return result([]);
        if (!name.startsWith('announceSecondPreparation')) return result([fieldPiece(false), value.long]);
        let request;
        if (roles[suffix] === 'tablet') {
            const names = texts.createSingleTeam(setup.tabletoperators);
            request = String(browserParts[1] || '').slice(names.length).replace(/^[,\s]+/, '');
            const example = 'Lena Fischer und Tom Schneider';
            const source = `${prep}Tabletbedienung:${example}! ${example}, ${request}`;
            return result([commonPrefix(), value.role, value.names, piece(source, request, 'generic', true)], [60, 250, 120]);
        }
        request = tournament.preparation_meetingpoint_enabled ? meeting(false) : 'In Vorbereitung!';
        const source = `${prep}Schiedsrichter:Alexandra Becker! Alexandra Becker ${request}`;
        return result([commonPrefix(), value.role, value.names, tournament.preparation_meetingpoint_enabled ?
            secondHall(false).meeting : piece(source, request, 'generic', true)], [60, 250, 60]);
    }
    return null;
}

if (typeof module !== 'undefined' && module.exports) module.exports = createContextSpeechPlan;
