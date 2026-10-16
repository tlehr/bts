'use strict';

// Fixed listening fixture for the composition agreed in the working document.
// This does not change the production announcement builders.
const { spellNumbers } = require('../bts/speech/numbers');
const game = 'Spiel 189.  Mädcheneinzel U19.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz.';
const team1 = 'Nina Keo Boun Khoune';
const team2 = 'LeandraGalowicz';
const operators = 'Lena Fischer und Tom Schneider';
const meeting = 'Bitte meldet euch bei der Turnierleitung!';
const singleMeeting = 'Bitte melde dich bei der Turnierleitung!';
const normal = 'Zweiter Aufruf für:';
const prep = 'Zweiter Aufruf In Vorbereitung für:';
const hall = 'in Halle 2';
const sources = [
    ['field', `Auf Spielfeld 8! ${game} Auf Spielfeld 8!`],
    ['begin', 'Auf Spielfeld 8! Bitte mit dem Spielen beginnen!'],
    ['game', game],
    ['preparation', `In Vorbereitung ${hall} Für Spielfeld 8! ${game} ${meeting}`],
    ['umpire', `Auf Spielfeld 8! ${normal}Schiedsrichter:Alexandra Becker`],
    ['judge', `Auf Spielfeld 8! ${normal}Aufschlagrichter:Martin Hoffmann`],
    ['tablet', `Auf Spielfeld 8! ${normal}Tabletbedienung:${operators}`],
    ['board', `Auf Spielfeld 8! ${normal}Klapptafelbedienung:${operators}`],
    ['prep_team', `${prep}${team1} ${hall}! ${team1} ${singleMeeting}`],
    ['prep_operator', `${prep}Tabletbedienung:${operators}! ${operators}, bitte als Tabletbedienung bei der Turnierleitungmelden!`],
    ['prep_operator_no_meeting', `${prep}Tabletbedienung:${operators}! ${operators}, bitte als Tabletbedienung`],
    ['prep_umpire_no_meeting', `${prep}Schiedsrichter:Alexandra Becker! Alexandra Becker In Vorbereitung!`],
    ['preparation_no_meeting', `In Vorbereitung ${hall} Für Spielfeld 8! ${game} In Vorbereitung ${hall}`],
    ['walkover', `Spiel 189, Mädcheneinzel U19, Achtelfinale! ${team1} gegen ${team2}. Das Spiel geht kampflos an: ${team1}!`],
];

const pieces = {};
function piece(id, source, text, whole = false) {
    pieces[id] = { source, display: text, text: spellNumbers(text), whole };
}
piece('field_start', 'field', 'Auf Spielfeld 8!');
piece('field_end', 'field', 'Auf Spielfeld 8!');
piece('game', 'game', game, true);
piece('team1', 'game', team1);
piece('team2', 'game', team2);
piece('game_header', 'game', 'Spiel 189. Mädcheneinzel U19. Achtelfinale!');
piece('encounter', 'game', `${team1} gegen ${team2}`);
piece('begin', 'begin', 'Bitte mit dem Spielen beginnen!');
piece('prep_start', 'preparation', `In Vorbereitung ${hall} Für Spielfeld 8!`);
piece('prep_open', 'preparation', `In Vorbereitung ${hall}`);
piece('meeting_plural', 'preparation', meeting);
piece('prep_close', 'preparation_no_meeting', `In Vorbereitung ${hall}`);
piece('hall', 'prep_team', `${hall}!`);
piece('meeting_single', 'prep_team', singleMeeting);
piece('prep_prefix', 'prep_team', prep);
piece('normal_prefix', 'umpire', normal);
for (const [id, source, role, names] of [
    ['umpire', 'umpire', 'Schiedsrichter', 'Alexandra Becker'],
    ['judge', 'judge', 'Aufschlagrichter', 'Martin Hoffmann'],
    ['tablet', 'tablet', 'Tabletbedienung', operators],
    ['board', 'board', 'Klapptafelbedienung', operators],
]) {
    piece(`${id}_role`, source, `${role}:${names}`);
    piece(`${id}_long`, source, `${normal}${role}:${names}`);
    if (id !== 'board') piece(`${id}_name`, source, names);
}
piece('operator_request', 'prep_operator', 'bitte als Tabletbedienung bei der Turnierleitungmelden!');
piece('operator_request_no_meeting', 'prep_operator_no_meeting', 'bitte als Tabletbedienung');
piece('prep_fallback', 'prep_umpire_no_meeting', 'In Vorbereitung!');
piece('walkover', 'walkover', 'Das Spiel geht kampflos an');

const cases = [];
function call(id, label, ids, boundaries = {}, note = '') {
    cases.push({ id, label, note, parts: ids.map((piece, index) => ({ piece,
        pause_ms: index === ids.length - 1 ? 0 : (boundaries[index] ?? 250) })) });
}
call('d01', 'D01 · Spielaufruf mit allen Offiziellen',
    ['field_start', 'game', 'umpire_role', 'judge_role', 'tablet_role', 'field_end']);
call('d01-ohne-offizielle', 'D01 · Spielaufruf ohne Offizielle', ['field_start', 'game', 'field_end']);
for (const [suffix, start] of [['', 'prep_start'], ['-ohne-feld', 'prep_open']]) {
    for (const noMeeting of [false, true]) call('d02' + suffix + (noMeeting ? '-ohne-treffpunkt' : ''),
        `D02 · Vorbereitung${suffix ? ' ohne Feld' : ' mit Feld'}${noMeeting ? ' · ohne Treffpunkt' : ''}`,
        [start, 'game', 'umpire_role', 'judge_role', 'tablet_role', noMeeting ? 'prep_close' : 'meeting_plural']);
}
call('d03', 'D03 · Bitte mit dem Spielen beginnen', ['field_start', 'begin']);
call('d03-ohne-feld', 'D03 · Startanweisung ohne Feld', ['begin']);
for (let team = 1; team <= 2; team++) {
    call(`d04-team-${team}`, `D04 · Zweiter Feldaufruf für Team ${team}`, ['normal_prefix', `team${team}`, 'field_end'], { 0: 60 });
    for (const noMeeting of [false, true]) call(`d05-team-${team}${noMeeting ? '-ohne-treffpunkt' : ''}`,
        `D05 · Zweiter Vorbereitungsaufruf für Team ${team}${noMeeting ? ' · ohne Treffpunkt' : ''}`,
        ['prep_prefix', `team${team}`, 'hall', `team${team}`, ...(!noMeeting ? ['meeting_single'] : [])], { 0: 60, 1: 60, 3: 60 });
}
for (const [id, role, label] of [['d06', 'umpire', 'Schiedsrichterin'], ['d07', 'judge', 'Aufschlagrichter'],
    ['d08-tablet', 'tablet', 'Tabletbedienung'], ['d08-klapptafel', 'board', 'Klapptafelbedienung']]) {
    call(id, `${id.slice(0, 3).toUpperCase()} · Zweiter Feldaufruf · ${label}`, ['field_start', `${role}_long`]);
    call(id + '-ohne-feld', `${id.slice(0, 3).toUpperCase()} · Zweiter Aufruf ohne Feld · ${label}`, [`${role}_long`]);
}
for (const [id, role, label] of [['d09', 'umpire', 'Schiedsrichterin'], ['d10', 'judge', 'Aufschlagrichter']]) {
    for (const noMeeting of [false, true]) call(id + (noMeeting ? '-ohne-treffpunkt' : ''),
        `${id.toUpperCase()} · Zweiter Vorbereitungsaufruf · ${label}${noMeeting ? ' · ohne Treffpunkt' : ''}`,
        ['prep_prefix', `${role}_role`, `${role}_name`, noMeeting ? 'prep_fallback' : 'meeting_single'], { 0: 60, 2: 60 });
}
for (const board of [false, true]) {
    for (const noMeeting of [false, true]) call(`d11-${board ? 'klapptafel' : 'tablet'}${noMeeting ? '-ohne-treffpunkt' : ''}`,
        `D11 · Zweiter Vorbereitungsaufruf · ${board ? 'Klapptafel' : 'Tablet'}${noMeeting ? ' · ohne Treffpunkt' : ''}`,
        ['prep_prefix', board ? 'board_role' : 'tablet_role', 'tablet_name',
            noMeeting ? 'operator_request_no_meeting' : 'operator_request'], { 0: 60, 2: 120 },
        'Heutiger Wortlaut: Auch bei Klapptafeln steht im zweiten Satz „Tabletbedienung“.' +
        (noMeeting ? '' : ' Der bekannte Vorlagenfehler „Turnierleitungmelden!“ bleibt hier hörbar und sichtbar.'));
}
for (let team = 1; team <= 2; team++) call(`d12-sieger-${team}`, `D12 · Kampflos an Team ${team}`,
    ['game_header', 'encounter', 'walkover', `team${team}`], { 1: 60, 2: 60 },
    'Spielkopf und Begegnung stammen aus dem Spielblock; die weiterführende Satzmelodie ist der wichtige Hörprüfpunkt.');

function plan() {
    return { title: 'Spiel 189 · Alle spielbezogenen Durchsagen',
        fixture: { court: 8, hall: 2, game: 189, team1, team2, operators,
            umpire: 'Alexandra Becker', service_judge: 'Martin Hoffmann' },
        parameters: { voice: 'hallensprecher', speed: 1.155, temperature: 0.8, top_k: 50, top_p: 0.8, seed: 42 },
        note: 'Fester Hörtext wie im bisherigen Vergleich: „Spiel 189“, Mädcheneinzel U19, Achtelfinale. ' +
            'Alle 14 spielbezogenen Auslöser, beide Sieger und beschriftete Einstellungsvarianten. ' +
            'Anwesenheitskontrolle, freie Ansage, Sprachtest und Evakuierung gehören nicht zu diesem Spiel.',
        sources: sources.map(([id, display]) => ({ id, display, text: spellNumbers(display) })), pieces, cases };
}

if (require.main === module) process.stdout.write(JSON.stringify(plan()));
module.exports = plan;
