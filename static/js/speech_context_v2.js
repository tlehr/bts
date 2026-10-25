/* exported createV2SpeechPlan */
'use strict';

// Shared context recipes use fictional filler names. Raw sources are cached by text.
const speechV2Fixed = {
    'lab-v2/B08-role': {
        'before': 'Die ',
        'text': 'Tabletbedienung',
        'after': ' übernimmt Hans Dampf.',
        'kind': 'generic',
    },
    'lab-v2/B08-role-umpire': {
        'before': 'Der ',
        'text': 'Schiedsrichter',
        'after': ' ist Hans Dampf.',
        'kind': 'generic',
    },
    'lab-v2/B08-role-service': {
        'before': 'Der ',
        'text': 'Aufschlagrichter',
        'after': ' ist Hans Dampf.',
        'kind': 'generic',
    },
    'lab-v2/B08-role-board': {
        'before': 'Die ',
        'text': 'Klapptafelbedienung',
        'after': ' übernimmt Hans Dampf.',
        'kind': 'generic',
    },
    'lab-v2/B11-normal': {
        'before': '',
        'text': 'Zweiter Aufruf für:',
        'after': 'Hans Dampf. Auf Spielfeld acht!',
        'kind': 'generic',
    },
    'lab-v2/B11-preparation': {
        'before': '',
        'text': 'Zweiter Aufruf In Vorbereitung für:',
        'after': 'Tabletbedienung:Hans Dampf! Hans Dampf, bitte als Tabletbedienung.',
        'kind': 'generic',
    },
    'lab-v2/D11-request': {
        'before': 'Zweiter Aufruf In Vorbereitung für:Tabletbedienung:Hans Dampf! Hans Dampf, ',
        'text': 'bitte als Tabletbedienung',
        'after': '.',
        'kind': 'generic',
    },
    'lab-v2/B09-opening': {
        'before': '',
        'text': 'In Vorbereitung!',
        'after': ' Spielnummer einhunderteinundsechzig. Jungen Einzel U siebzehn. Achtelfinale! Max Mustermann gegen Hans Dampf. Das Spiel ist in Vorbereitung!',
        'kind': 'generic',
    },
    'lab-v2/B09-closing': {
        'before': 'In Vorbereitung! Spielnummer einhunderteinundsechzig. Jungen Einzel U siebzehn. Achtelfinale! Max Mustermann gegen Hans Dampf. ',
        'text': 'Das Spiel ist in Vorbereitung!',
        'after': '',
        'kind': 'generic',
    },
    'lab-v2/D12-clause': {
        'before': 'Spielnummer einhunderteinundsechzig. Jungen Einzel U siebzehn. Achtelfinale! Max Mustermann gegen Hans Dampf. ',
        'text': 'Das Spiel geht kampflos an',
        'after': ' Hans Dampf!',
        'kind': 'generic',
    },
    'lab-v2/registration-target-Anmeldung': {
        'before': 'Max Mustermann ',
        'text': 'bitte zur Anmeldung.',
        'after': ' Max Mustermann bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-bare-target-Anmeldung': {
        'before': 'Max Mustermann bitte ',
        'text': 'zur Anmeldung.',
        'after': ' Max Mustermann bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-closing': {
        'before': 'Max Mustermann bitte zur Anmeldung. Max Mustermann ',
        'text': 'bitte!',
        'after': '',
        'kind': 'generic',
    },
    'lab-v2/registration-target-Turnierleitung': {
        'before': 'Die Paarung Max Mustermann und Hans Dampf ',
        'text': 'bitte zur Turnierleitung.',
        'after': ' Max Mustermann und Hans Dampf bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-bare-target-Turnierleitung': {
        'before': 'Die Paarung Max Mustermann und Hans Dampf bitte ',
        'text': 'zur Turnierleitung.',
        'after': ' Max Mustermann und Hans Dampf bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-pair-prefix': {
        'before': '',
        'text': 'Die Paarung',
        'after': ' Max Mustermann und Hans Dampf bitte zur Turnierleitung. Max Mustermann und Hans Dampf bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-club-opening': {
        'before': '',
        'text': 'Bitte ein Vertreter vom Verein',
        'after': ' PSV Bremen zur Anmeldung. Ein Vertreter vom Verein PSV Bremen bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-club-repeat': {
        'before': 'Bitte ein Vertreter vom Verein PSV Bremen zur Anmeldung. ',
        'text': 'Ein Vertreter vom Verein',
        'after': ' PSV Bremen bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-state-opening': {
        'before': '',
        'text': 'Bitte ein Vertreter aus',
        'after': ' Bremen zur Turnierleitung. Ein Vertreter aus Bremen bitte!',
        'kind': 'generic',
    },
    'lab-v2/registration-state-repeat': {
        'before': 'Bitte ein Vertreter aus Bremen zur Turnierleitung. ',
        'text': 'Ein Vertreter aus',
        'after': ' Bremen bitte!',
        'kind': 'generic',
    },
};

function createV2SpeechPlan(texts, tournament, name, setup = {}, args = [], browserParts = []) {
    const encode = recipe => '~bts-context-v2~' + JSON.stringify(recipe);
    const piece = (source, text, kind = 'generic', last = false) => {
        if (!text?.trim()) return null;
        const at = last ? source.lastIndexOf(text) : source.indexOf(text);
        if (at < 0) throw new Error('context_piece_missing');
        return encode({ before: source.slice(0, at), text, after: source.slice(at + text.length), kind });
    };
    const fixed = profile => speechV2Fixed['lab-v2/' + profile] ? encode(speechV2Fixed['lab-v2/' + profile]) : null;
    const end = text => String(text || '').replace(/[\s.!?:]+$/, '');
    const result = (parts, gaps = []) => {
        // Attach gaps before filtering absent officials/fields.
        const entries = parts.map((part, i) => ({ part, gap: gaps[i] ?? 250 })).filter(row => row.part);
        return { parts: entries.map(row => row.part), pauses: entries.map((row, i) => i + 1 === entries.length ? 0 : row.gap) };
    };
    const example = 'Hans Dampf';
    const reference = 'Spielnummer 161. Jungen Einzel U17. Achtelfinale! Max Mustermann gegen Hans Dampf.';
    const roundPiece = text => {
        if (!text) return null;
        const spoken = end(text) + '!';
        return piece(`Spielnummer 161. Jungen Einzel U17. ${spoken} Max Mustermann gegen Hans Dampf.`, spoken);
    };
    const preparationField = () => {
        const text = texts.createFieldPreparationAnnouncement(setup);
        return text ? piece(`In Vorbereitung! ${text} ${reference} Das Spiel ist in Vorbereitung!`, text) : null;
    };
    const meetingPiece = (text, plural = false) => {
        if (!text?.trim()) return null;
        const audience = plural ? 'Max Mustermann und Hans Dampf' : example;
        return piece(`Zweiter Aufruf In Vorbereitung für:${audience}! ${audience}, ${text}`, text, 'generic', true);
    };
    const field = texts.createFieldAnnouncement(setup);
    const fieldPiece = closing => {
        if (!field) return null;
        const middle = 'Spiel einhundertneunundachtzig.  Mädchen Einzel U neunzehn.  Achtelfinale! Max Mustermann gegen Hans Dampf.';
        return piece(`${field} ${middle} ${field}`, field, closing ? 'field_end' : 'field_start', closing);
    };
    const team = (players, position = 'second') => {
        if (!players?.length || players.some(player => !player?.name?.trim())) return null;
        const text = texts.createSingleTeam(players);
        const full = `${text} spielt jetzt gegen ${text}!`;
        return position === 'first' ? piece(full, text, 'team') : position === 'against' ?
            piece(full, 'gegen ' + text, 'team', true) : piece(full, text, 'team', true);
    };
    const matchNumber = () => {
        const number = tournament.annoncement_include_matchnumber && setup.match_num != null ? `Spielnummer ${setup.match_num}` : '';
        return number ? piece(`${number} ist als nächstes an der Reihe.`, number) : null;
    };
    const game = () => {
        const event = String(texts.createEventAnnouncement(setup) || '').replaceAll('Maedchen', 'Mädchen')
            .replace(/^(Jungen|Mädchen|Herren|Damen)(einzel|doppel)\b/i,
                (_all, first, second) => first + ' ' + second[0].toUpperCase() + second.slice(1));
        const round = setup.match_name ? texts.createRoundAnnouncement(setup) : null;
        return [matchNumber(),
            event ? piece(`Im ${event} erwarten wir spannende Spiele!`, event) : null,
            roundPiece(round),
            team(setup.teams?.[0]?.players, 'first'), team(setup.teams?.[1]?.players, 'against')];
    };
    const roleName = role => role === 'umpire' ? 'Schiedsrichter' : role === 'service' ? 'Aufschlagrichter' :
        tournament.tabletoperator_use_manual_counting_boards_enabled ? 'Klapptafelbedienung' : 'Tabletbedienung';
    const rolePiece = role => fixed(role === 'tablet' ? tournament.tabletoperator_use_manual_counting_boards_enabled ?
        'B08-role-board' : 'B08-role' : 'B08-role-' + role);
    const officialPlayers = role => role === 'tablet' ? setup.tabletoperators :
        (role === 'umpire' ? setup.umpire?.name : setup.service_judge?.name) ?
            [{ name: role === 'umpire' ? setup.umpire.name : setup.service_judge.name }] : [];
    const official = role => team(officialPlayers(role)) ? [rolePiece(role), team(officialPlayers(role))] : [];
    const officials = () => ['umpire', 'service', 'tablet'].flatMap(official);
    const officialsGaps = () => ['umpire', 'service', 'tablet'].flatMap(role => official(role).length ?
        [roleName(role) === 'Klapptafelbedienung' ? 180 : 80, 250] : []);
    const location = (tournament.locations || []).find(value => value._id === texts.getLocationID(setup));
    const hall = plural => texts.resolveSingularPluralAnnouncement(location?.preparation_addition || '', plural).trim();
    const meeting = plural => texts.createMeetingPointAnnouncement(setup, plural).trim();
    const preparation = plural => {
        const opening = texts.createPreparationAnnouncement(setup, plural).trim();
        const ending = texts.createPreparationClosingAnnouncement(setup, plural).trim();
        const source = [opening, reference, ending].filter(Boolean).join(' ');
        return [piece(source, opening), piece(source, ending, 'generic', true)];
    };
    const prepPrefix = () => fixed('B11-preparation');
    const normal = () => fixed('B11-normal');
    if (name === 'prepareFields') return result([fieldPiece(false), fieldPiece(true), preparationField()]);
    if (name === 'prepareInstruction') return result([piece('Auf Spielfeld acht! Bitte mit dem Spielen beginnen!', 'Bitte mit dem Spielen beginnen!')]);
    if (name === 'prepareCommon') return result([normal(), prepPrefix(), fixed('D12-clause')]);
    if (name === 'prepareLocation') return result([...preparation(false), ...preparation(true)]);
    if (name === 'prepareName') return result([team(setup.players, 'first'), team(setup.players), team(setup.players, 'against')]);
    if (name === 'prepareMatchNumber') return result([matchNumber()]);
    if (name === 'prepareGame') return result(game(), [250, 250, 250, 60]);
    if (name === 'announceNewMatch') return result([fieldPiece(false), ...game(), ...officials(), fieldPiece(true)],
        [250, 250, 250, 250, 60, 250, ...officialsGaps(), 0]);
    if (name === 'announcePreparationMatch') {
        const [opening, ending] = preparation(true);
        const court = preparationField();
        return result([opening, court, ...game(), ...officials(), ending],
            [250, 250, 250, 250, 250, 60, 250, ...officialsGaps(), 0]);
    }
    if (name === 'announceBeginnToPlay') return result([fieldPiece(false),
        piece('Auf Spielfeld acht! Bitte mit dem Spielen beginnen!', 'Bitte mit dem Spielen beginnen!')]);
    const side = name.includes('TeamTwo') ? 1 : 0;
    const players = setup.teams?.[side]?.players;
    if (name === 'announceSecondCallTeamOne' || name === 'announceSecondCallTeamTwo') {
        return result([normal(), team(players), fieldPiece(true)], [140, 250]);
    }
    if (name === 'announceSecondPreparationCallTeamOne' || name === 'announceSecondPreparationCallTeamTwo') {
        const plural = players?.length !== 1, addition = hall(plural), request = meeting(plural);
        const prefix = texts.createSecondPreparationCallAnnouncement();
        const full = `${prefix}${example}${addition ? ' ' + addition : ''}! ${example} ${request}`;
        return result([prepPrefix(), team(players), addition ? piece(full, addition, 'hall') : null,
            team(players), tournament.preparation_meetingpoint_enabled ? meetingPiece(request, plural) : null], [140, 120, 320, 160]);
    }
    if (name === 'announceNoMatchWin') return result([...game(), fixed('D12-clause'), team(setup.teams?.[args[0]]?.players)],
        [250, 250, 250, 60, 300, 100]);
    const role = name.endsWith('Umpire') ? 'umpire' : name.endsWith('ServiceJudge') ? 'service' :
        name.endsWith('Tabletoperator') ? 'tablet' : null;
    if (role) {
        const people = officialPlayers(role), names = team(people);
        if (!names) return result([]);
        const roleGap = roleName(role) === 'Klapptafelbedienung' ? 180 : 80;
        if (!name.startsWith('announceSecondPreparation')) return result([fieldPiece(false), normal(), rolePiece(role), names], [250, 140, roleGap]);
        let request;
        if (role === 'tablet') {
            const label = texts.createSingleTeam(people);
            const target = String(browserParts[1] || '').slice(label.length).replace(/^[,\s]+/, '').replace(/[.!?]+$/, '');
            const prefix = texts.createSecondPreparationCallAnnouncement();
            const donor = people.length > 1 ? 'Max Mustermann und Hans Dampf' : example;
            const full = `${prefix}${roleName(role)}:${donor}! ${donor}, ${target}.`;
            request = piece(full, target, 'generic', true);
        } else request = meetingPiece(tournament.preparation_meetingpoint_enabled ? meeting(false) : 'In Vorbereitung!');
        return result([prepPrefix(), rolePiece(role), names, names, request], [140, roleGap, 320, 160]);
    }
    return null;
}

// Registration keeps the browser's exact words, while sharing first-position
// names, clubs and federations with the team sources.
createV2SpeechPlan.registration = function(text) {
    const pair = /^(Die Paarung )?(.+) bitte zur (Anmeldung|Turnierleitung)\. \2 bitte!$/.exec(text);
    const club = /^Bitte ein Vertreter (vom Verein|aus) (.+) zur (Anmeldung|Turnierleitung)\. Ein Vertreter \1 \2 bitte!$/.exec(text);
    if (!pair && !club) return null;
    const fixed = key => '~bts-context-v2~' + JSON.stringify(speechV2Fixed['lab-v2/registration-' + key]);
    const name = (pair || club)[2], target = (pair || club)[3];
    const team = '~bts-context-v2~' + JSON.stringify({ before: '', text: name, after: ` spielt jetzt gegen ${name}!`, kind: 'team' });
    const keys = pair ? [...(pair[1] ? [fixed('pair-prefix')] : []), team, fixed('target-' + target), team, fixed('closing')] :
        [fixed(club[1] === 'aus' ? 'state-opening' : 'club-opening'), team, fixed('bare-target-' + target),
            fixed(club[1] === 'aus' ? 'state-repeat' : 'club-repeat'), team, fixed('closing')];
    return { parts: keys, pauses: keys.map((key, i) => i + 1 === keys.length ? 0 : JSON.parse(key.slice(16)).text.endsWith('.') ? 320 : 80) };
};
createV2SpeechPlan.fixed = speechV2Fixed;
if (typeof module !== 'undefined' && module.exports) module.exports = createV2SpeechPlan;
