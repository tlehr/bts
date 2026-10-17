'use strict';

// Explicit listening experiment; no production announcement imports this plan.
const fs = require('fs');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');
const { Plan, digest } = require('./tts-context-benchmark-plan');

// Speech-only spelling: apply to an event label, never to player names or UI text.
function spokenDiscipline(text) {
    return text.replace(/^(Jungen|Mädchen|Herren|Damen)(einzel|doppel)\b/i,
        (_full, first, second) => first + ' ' + second[0].toUpperCase() + second.slice(1));
}

function excerpt(plan, source, text, profile, { last = false, kind = 'team', display = text } = {}) {
    const full = plan.sources.get(source).text;
    const start = last ? full.lastIndexOf(text) : full.indexOf(text);
    if (start < 0) throw new Error('Missing exact context substring');
    const item = { source, before: full.slice(0, start), text, after: full.slice(start + text.length), kind, profile, display };
    const id = 'p-' + digest(item).slice(0, 20);
    plan.pieces.set(id, { id, ...item });
    return id;
}

function gameblocks(tournament, samples) {
    const plan = new Plan(tournament.normalizations || []);
    const texts = create({ tournament: { ...tournament, annoncement_include_event: true, annoncement_include_round: true },
        translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
    const teams = new Map();
    const dual = players => {
        if (!players?.length || players.length > 2 || players.some(player => !player.name?.trim())) {
            throw new Error('Only complete actual teams can be synthesized');
        }
        const name = spellNumbers(texts.createSingleTeam(players));
        if (!teams.has(name)) {
            const display = players.map(player => player.name).join(' und ');
            const source = plan.source(`${name} spielt jetzt gegen ${name}!`,
                'lab-v2/team-repeat-plays-now', `${display} spielt jetzt gegen ${display}!`);
            teams.set(name, {
                first: excerpt(plan, source, name, 'lab-v2/team-before-plays', { display }),
                connector: excerpt(plan, source, 'gegen', 'lab-v2/team-connector', { kind: 'generic' }),
                second_with_against: excerpt(plan, source, `gegen ${name}`, 'lab-v2/team-after-with-gegen', { display: `gegen ${display}` }),
                second: excerpt(plan, source, name, 'lab-v2/team-after-gegen', { last: true, display }),
            });
        }
        return teams.get(name);
    };
    for (const sample of samples) {
        const setup = sample.setup;
        if (!Number.isSafeInteger(Number(setup.match_num)) || Number(setup.match_num) <= 0 || setup.teams?.length !== 2) {
            throw new Error('A sample needs a positive match number and two known teams');
        }
        const numberDisplay = `Spielnummer ${setup.match_num}`;
        const numberText = spellNumbers(numberDisplay);
        const numberSource = plan.source(`${numberText} ist als nächstes an der Reihe.`,
            'lab-v2/number-turn-context', `${numberDisplay} ist als nächstes an der Reihe.`);
        const number = excerpt(plan, numberSource, numberText, 'lab-v2/B03', { kind: 'generic', display: numberDisplay });
        // German display labels use umlauts; old tournament translations may use ASCII transliteration.
        const eventDisplay = texts.createEventAnnouncement(setup).replaceAll('Maedchen', 'Mädchen');
        const eventText = spellNumbers(spokenDiscipline(texts.normalizeNames(eventDisplay)));
        const eventSource = plan.source(`Im ${eventText} erwarten wir spannende Spiele!`,
            'lab-v2/event-expectation-context', `Im ${eventDisplay} erwarten wir spannende Spiele!`);
        const event = excerpt(plan, eventSource, eventText, 'lab-v2/B04', { kind: 'generic', display: eventDisplay });
        const roundText = texts.createRoundAnnouncement(setup);
        if (!roundText) throw new Error('This listening sample requires a known round');
        const round = plan.whole(roundText + '!', 'lab-v2/B05');
        const [left, right] = setup.teams.map(team => dual(team.players));
        for (const [suffix, label, encounter, pauses] of [
            ['two', 'Team 1 + „gegen“ mit Team 2', [left.first, right.second_with_against], [250, 250, 250, 60, 0]],
            ['three', 'Team 1 + „gegen“ + Team 2', [left.first, left.connector, right.second], [250, 250, 250, 60, 60, 0]],
        ]) {
            const pieces = [number, event, round, ...encounter];
            plan.cases.push({ id: `${sample.id}-${suffix}`, experiment: 'Spielblöcke',
                label: `${sample.label} · ${label}`, sample_origin: sample.origin,
                display: [`Spielnummer ${setup.match_num}.`, eventDisplay + '!', roundText + '!',
                    setup.teams.map(team => team.players.map(player => player.name).join(' und ')).join(' gegen ')].join(' '),
                pieces: pieces.map((piece, index) => ({ piece, pause_ms: pauses[index] })),
                subjective_quality: 'not-rated' });
        }
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.generator_sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    result.scope = { purpose: 'Requested game-block listening samples, not production activation',
        team_source: '[Team] spielt jetzt gegen [Team]!',
        team_context_discarded: 'spielt jetzt; final exclamation mark guides the second position',
        number_source: 'Spielnummer [number] ist als nächstes an der Reihe.',
        number_excerpt: 'Spielnummer [number]', event_source: 'Im [discipline] [age] erwarten wir spannende Spiele!',
        event_excerpt: '[discipline] [age]',
        discipline_spelling: 'Space between Jungen/Mädchen/Herren/Damen and Einzel/Doppel; display unchanged',
        round_source: '[round]!', pauses_are_listening_settings: true,
        samples: samples.map(({ id, origin, setup }) => ({ id, origin, match_number: setup.match_num, event: setup.event_name, round: setup.match_name })) };
    return result;
}

function examples(tournament) {
    const names = name => ({ players: [{ name }] });
    const samples = [{ id: 'beispiel-189', label: 'Beispielspiel 189 · Mädcheneinzel U19', origin: 'Established hearing fixture, not current tournament match 189',
        setup: { match_num: 189, event_name: 'ME U19', match_name: 'R16', teams: [names('Nina Keo Boun Khoune'), names('LeandraGalowicz')] } }];
    for (const [number, event] of [[161, 'JE U17'], [381, 'JD U13']]) {
        const match = (tournament.matches || []).find(item => Number(item.setup?.match_num) === number && item.setup.event_name === event);
        if (!match) throw new Error(`Saved sample ${number} (${event}) not found`);
        samples.push({ id: 'spiel-' + number, label: `Spiel ${number} · ${event}`, origin: `Saved tournament match ${match._id}`, setup: match.setup });
    }
    return samples;
}

function disciplinePronunciationTrials(existing, display = 'Jungendoppel U13') {
    const original = existing.pieces.find(piece => piece.profile === 'lab-v2/B04' && piece.display === display);
    if (!original) throw new Error('No matching discipline excerpt in the recorded plan');
    const source = existing.sources.find(item => item.id === original.source);
    const compound = /^(Jungen|Mädchen|Herren|Damen)[ -]?(einzel|doppel)\b/i;
    if (!compound.test(original.text)) throw new Error('No supported discipline compound');
    const separate = (text, separator) => text.replace(compound,
        (_full, first, second) => first + separator + (separator ? second[0].toUpperCase() : second[0].toLowerCase()) + second.slice(1));
    const plan = new Plan(existing.pronunciation.normalizations || []);
    for (const [id, label, text, shown] of [
        ['original', 'Zusammengeschrieben', separate(original.text, ''), display],
        ['hyphen', 'Mit Bindestrich', separate(original.text, '-'), separate(display, '-')],
        ['space', 'Mit Leerzeichen', separate(original.text, ' '), separate(display, ' ')],
    ]) {
        const full = original.before + text + original.after;
        const fullDisplay = original.before + shown + original.after;
        const recording = plan.source(full, source.profile, fullDisplay);
        const piece = excerpt(plan, recording, text, original.profile, { kind: original.kind, display });
        plan.cases.push({ id: 'discipline-' + id, experiment: 'Aussprache', label: label + ' · ' + shown,
            display, pieces: [{ piece, pause_ms: 0 }], subjective_quality: 'not-rated' });
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.generator_sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    result.scope = { purpose: 'Pronunciation comparison only; tournament display and default plan unchanged',
        display, source_plan_sha256: digest(existing), variants: ['original', 'hyphen', 'space'],
        no_internal_audio_splices: true, boundaries_belong_to_each_actual_source: true };
    return result;
}

if (require.main === module) {
    if (process.argv[2] === '--pronunciation') {
        const existing = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
        process.stdout.write(JSON.stringify(disciplinePronunciationTrials(existing, process.argv[4]), null, 2) + '\n');
    } else {
        const tournament = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
        process.stdout.write(JSON.stringify(gameblocks(tournament, examples(tournament)), null, 2) + '\n');
    }
}

module.exports = { gameblocks, examples, disciplinePronunciationTrials, spokenDiscipline };
