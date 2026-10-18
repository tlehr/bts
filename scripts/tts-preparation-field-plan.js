'use strict';

// B02 hearing trial. Each actual field is one complete, reusable sentence.
const fs = require('fs');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');
const { Plan, digest } = require('./tts-context-benchmark-plan');
const { lexemes } = require('./tts-second-call-plan');
const { spokenDiscipline } = require('./tts-gameblock-context-plan');

function fieldSentences(tournament) {
    if (!Array.isArray(tournament.courts) || !tournament.courts.length) throw new Error('Actual tournament courts are required');
    const plan = new Plan(tournament.normalizations || []), fields = [], ids = new Set();
    const texts = create({ tournament, translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
    for (const court of tournament.courts) {
        if (typeof court._id !== 'string' || ids.has(court._id)) throw new Error('Unique actual court IDs are required');
        ids.add(court._id);
        const raw = court._id.split('_')[1], number = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < 1) throw new Error('Positive whole court numbers are required');
        const display = texts.createFieldPreparationAnnouncement({ court_id: court._id }), text = spellNumbers(display);
        const source = plan.source(text, 'lab-v2/preparation-field-direct', display);
        const value = { source, before: '', text, after: '', kind: 'generic', profile: 'lab-v2/B02', display };
        const piece = 'p-' + digest(value).slice(0, 20);
        plan.pieces.set(piece, { id: piece, ...value });
        fields.push({ court_id: court._id, number, location_id: court.location_id || null, piece });
    }
    fields.sort((a, b) => a.number - b.number || a.court_id.localeCompare(b.court_id));
    for (const piece of new Set(fields.map(f => f.piece))) {
        const p = plan.pieces.get(piece);
        plan.cases.push({ id: 'field-' + fields.find(f => f.piece === piece).number, experiment: 'piece', label: 'B02 · ' + p.display,
            display: p.display, pieces: [{ piece, pause_ms: 0 }], subjective_quality: 'not-rated' });
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only'; result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.scope = { purpose: 'Direct B02 field sentences only; no production switch', fields, direct_sentences_only: true,
        new_pieces: [...plan.pieces.keys()], reused_piece_origins: {}, new_sources_per_voice: plan.sources.size,
        field_sentences_independent_of_games_and_locations: true, browser_wording_unchanged: true };
    return result;
}

function withPreparation(plan, existing, tournament) {
    if (plan.strategy !== 'bts-context-v2-lab-only' || !plan.scope?.direct_sentences_only || !existing.origins ||
            digest(plan.pronunciation) !== digest(existing.pronunciation)) throw new Error('Matching direct field plan and prepared v2 catalogue are required');
    const result = JSON.parse(JSON.stringify(plan));
    const take = (profile, text) => {
        const part = existing.pieces.find(p => p.profile === profile && (text === undefined || p.text === text));
        const source = part && existing.sources.find(s => s.id === part.source);
        if (!source || !existing.origins[part.id] || part.before + part.text + part.after !== source.text) {
            throw new Error('Complete prepared sample pieces with provenance are required: ' + profile);
        }
        if (!result.pieces.some(p => p.id === part.id)) result.pieces.push({ ...part });
        if (!result.sources.some(s => s.id === source.id)) result.sources.push({ ...source });
        result.scope.reused_piece_origins[part.id] = existing.origins[part.id];
        return part.id;
    };
    const opening = take('lab-v2/B09-opening', 'In Vorbereitung!'), closing = take('lab-v2/B09-closing', 'Das Spiel ist in Vorbereitung!');
    const game = [['lab-v2/B03', 'Spielnummer einhunderteinundsechzig'], ['lab-v2/B04', 'Jungen Einzel U siebzehn'],
        ['lab-v2/B05', 'Achtelfinale!'], ['lab-v2/team-before-plays', 'Muhammad Sytsh Abdulquddus'],
        ['lab-v2/team-after-with-gegen', 'gegen Max Hahn']].map(([profile, text]) => take(profile, text));
    const officials = [['lab-v2/B08-role-umpire', 'Schiedsrichter'], ['lab-v2/team-after-gegen', 'Tim Lehr'],
        ['lab-v2/B08-role-service', 'Aufschlagrichter'], ['lab-v2/team-after-gegen', 'Max Hahn'],
        ['lab-v2/B08-role'], ['lab-v2/team-after-gegen', 'Emil Hermann und Konrad Wendt']]
        .map(([profile, text]) => take(profile, text));
    const get = key => result.pieces.find(p => p.id === key);
    const texts = create({ tournament: { ...tournament, normalizations: plan.pronunciation.normalizations,
        annoncement_include_event: true, annoncement_include_round: true },
    translate: (key, data, fallback) => translate('de', key, data, fallback), window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
    const assemblies = [];
    for (const field of plan.scope.fields) {
        const location = tournament.locations?.find(l => l._id === field.location_id);
        const setup = { location_id: field.location_id, court_id: field.court_id };
        if (texts.createPreparationAnnouncement(setup, true).trim() !== 'In Vorbereitung' ||
                texts.createPreparationClosingAnnouncement(setup, true).trim() !== get(closing).display || location?.preparation_addition?.trim()) {
            throw new Error('These hearing examples require the saved empty location addition and no meeting point');
        }
        const body = [opening, field.piece, ...game, ...officials, closing];
        const pauses = [250, 250, 250, 250, 250, 60, 250, 80, 250, 80, 250, 80, 250, 0];
        const display = [get(opening).display, get(field.piece).display,
            get(game[0]).display + '.', spokenDiscipline(get(game[1]).display) + '.', get(game[2]).display,
            get(game[3]).display + ' ' + get(game[4]).display + '.',
            get(officials[0]).display + ': ' + get(officials[1]).display + '.',
            get(officials[2]).display + ': ' + get(officials[3]).display + '.',
            get(officials[4]).display.replace(/:$/, '') + ': ' + get(officials[5]).display + '.', get(closing).display].join(' ');
        if (lexemes(body.map(k => get(k).text).join(' ')) !== lexemes(display)) throw new Error('Incomplete preparation montage');
        assemblies.push({ id: 'preparation-field-' + field.number + '-' + digest(field.court_id).slice(0, 10), experiment: 'assembled',
            label: 'D02 · Vorbereitung für Spielfeld ' + field.number, field_number: field.number,
            display, court_id: field.court_id, pieces: body.map((piece, i) => ({ piece, pause_ms: pauses[i] })), subjective_quality: 'not-rated' });
    }
    result.cases = [...assemblies, ...result.cases.map(c => ({ ...c, field_number: plan.scope.fields.find(f => f.piece === c.pieces[0].piece).number }))];
    result.scope = { ...result.scope, sample_game: 161, game_pieces: game, official_pieces: officials,
        opening_piece: opening, closing_piece: closing, demonstration_only_no_tournament_assignments: true };
    return result;
}

if (require.main === module) {
    const tournament = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const plan = fieldSentences(tournament);
    const result = process.argv[3] ? withPreparation(plan, JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), tournament) : plan;
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
module.exports = { fieldSentences, withPreparation };
