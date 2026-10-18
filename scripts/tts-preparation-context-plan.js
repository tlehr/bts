'use strict';

// Location-aware D02 hearing trial. No production announcement imports this file.
const fs = require('fs');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');
const { Plan, digest } = require('./tts-context-benchmark-plan');

function preparation(existing, tournament, sampleId = 'beispiel-189-two') {
    if (existing.strategy !== 'bts-context-v2-lab-only') throw new Error('An existing v2 game-block plan is required');
    const game = existing.cases.find(item => item.id === sampleId);
    if (!game || game.pieces.length !== 5) throw new Error('An existing five-piece game-block sample is required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    const parts = game.pieces.map(row => {
        const part = existing.pieces.find(piece => piece.id === row.piece);
        const source = existing.sources.find(source => source.id === part?.source);
        if (!source || part.before + part.text + part.after !== source.text) throw new Error('The existing game must match its sources');
        plan.sources.set(source.id, { ...source });
        plan.pieces.set(part.id, { ...part });
        return part;
    });
    if (!['B03', 'B04', 'B05'].every((profile, index) => parts[index].profile === 'lab-v2/' + profile)) {
        throw new Error('The existing sample must start with number, discipline and round');
    }
    const sentence = text => /[.!?]$/.test(text) ? text : text + '.';
    const middle = parts.slice(0, 3).map(p => sentence(p.text)).join(' ') + ' ' +
        sentence(parts.slice(3).map(p => p.text).join(' '));
    const middleDisplay = sentence(game.display);
    const normalizations = tournament.normalizations || existing.pronunciation.normalizations || [];
    const texts = create({ tournament: { ...tournament, normalizations }, translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
    const locations = tournament.locations?.length ? tournament.locations : [{ _id: null, name: 'Ohne Location' }];
    if (new Set(locations.map(location => location._id)).size !== locations.length ||
            locations.some(location => location._id !== null && typeof location._id !== 'string')) {
        throw new Error('Unique location IDs are required');
    }
    const addPiece = (source, before, text, after, profile, display) => {
        const item = { source, before, text, after, kind: 'generic', profile: 'lab-v2/' + profile, display };
        const id = 'p-' + digest(item).slice(0, 20);
        plan.pieces.set(id, { id, ...item });
        return id;
    };
    const summaries = [];
    for (const location of locations) {
        const setup = { location_id: location._id };
        const opening = texts.createPreparationAnnouncement(setup, true).trim();
        const ending = (tournament.preparation_meetingpoint_enabled ?
            texts.createMeetingPointAnnouncement(setup, true) : opening).trim();
        const spoken = text => spellNumbers(texts.normalizeNames(text));
        const start = spoken(opening), end = spoken(ending);
        const separator = /[.!?:;]$/.test(start) ? ' ' : ': ';
        const closingMark = end && !/[.!?]$/.test(end) ? '!' : '';
        const full = start + separator + middle + (end ? ' ' + end + closingMark : '');
        const shown = opening + separator + middleDisplay + (ending ? ' ' + ending + closingMark : '');
        const source = plan.source(full, 'lab-v2/preparation-location-reference', shown);
        const b09 = addPiece(source, '', start, full.slice(start.length), 'B09-opening', opening);
        const b10 = end ? addPiece(source, start + separator + middle + ' ', end, closingMark,
            tournament.preparation_meetingpoint_enabled ? 'B10-meeting' : 'B09-closing', ending) : null;
        const reference = addPiece(source, '', full, '', 'preparation-full-reference', shown);
        const locationId = 'loc-' + digest(location._id).slice(0, 12);
        const label = location.name || 'Unbenannte Location';
        const entries = game.pieces.map(row => ({ ...row }));
        entries[entries.length - 1].pause_ms = b10 ? 250 : 0;
        for (const [group, description, rows, display] of [
            ['assembled', 'D02 · zusammengesetzter Vorbereitungsaufruf',
                [{ piece: b09, pause_ms: 250 }, ...entries, ...(b10 ? [{ piece: b10, pause_ms: 0 }] : [])],
                [opening, game.display, ending].filter(Boolean).join(' ')],
            ['opening', 'B09 · Vorbereitungsanfang', [{ piece: b09, pause_ms: 0 }], opening],
            ...(b10 ? [['closing', tournament.preparation_meetingpoint_enabled ? 'B10 · Treffpunkt' : 'B09 · Vorbereitungsabschluss',
                [{ piece: b10, pause_ms: 0 }], ending]] : []),
            ['reference', 'Vollständige D02-Kontextaufnahme', [{ piece: reference, pause_ms: 0 }], shown],
        ]) {
            plan.cases.push({ id: `${locationId}-${group}`, experiment: group, label: label + ' · ' + description,
                location_id: location._id, display, pieces: rows, subjective_quality: 'not-rated' });
        }
        summaries.push({ location_id: location._id, name: label, preparation_addition: location.preparation_addition || '',
            meetingpoint_announcement: location.meetingpoint_announcement || '', opening, ending,
            ending_kind: tournament.preparation_meetingpoint_enabled ? (end ? 'meeting' : 'empty') : 'preparation',
            source, opening_piece: b09, closing_piece: b10, reference_piece: reference });
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.generator_sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    result.scope = { purpose: 'Location-aware D02 hearing trial only; no production activation', without_court: true,
        source_gameblock_plan_sha256: digest(existing), game_case_id: game.id, game_pieces: game.pieces.map(p => p.piece),
        location_normalizations_sha256: digest(normalizations),
        preparation_meetingpoint_enabled: !!tournament.preparation_meetingpoint_enabled,
        locations: summaries, distinct_location_sources_per_voice: new Set(summaries.map(l => l.source)).size,
        existing_gameblocks_unchanged: true, boundary_pause_target_ms: 250 };
    return result;
}

if (require.main === module) {
    const existing = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const tournament = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    process.stdout.write(JSON.stringify(preparation(existing, tournament, process.argv[4]), null, 2) + '\n');
}

module.exports = { preparation };
