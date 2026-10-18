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
    const normalizations = tournament.normalizations || existing.pronunciation.normalizations || [];
    const texts = create({ tournament: { ...tournament, normalizations }, translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
    const locations = tournament.locations?.length ? tournament.locations : [{ _id: null, name: 'Ohne Location' }];
    if (new Set(locations.map(location => location._id)).size !== locations.length ||
            locations.some(location => location._id !== null && typeof location._id !== 'string')) {
        throw new Error('Unique location IDs are required');
    }
    const direct = display => {
        // Use the browser's complete wording and punctuation. Only the already
        // agreed speech-only number expansion is applied, without extra context.
        const text = spellNumbers(display);
        const source = plan.source(text, 'lab-v2/location-direct', display);
        const item = { source, before: '', text, after: '', kind: 'generic', profile: 'lab-v2/location-sentence', display };
        const id = 'p-' + digest(item).slice(0, 20);
        plan.pieces.set(id, { id, ...item });
        return id;
    };
    const summaries = [];
    for (const location of locations) {
        const setup = { location_id: location._id };
        const opening = texts.createPreparationAnnouncement(setup, true).trim();
        const ending = texts.createPreparationClosingAnnouncement(setup, true).trim();
        const hasMeeting = tournament.preparation_meetingpoint_enabled && !!texts.createMeetingPointAnnouncement(setup, true).trim();
        const b09 = direct(opening);
        const b10 = ending ? direct(ending) : null;
        const locationId = 'loc-' + digest(location._id).slice(0, 12);
        const label = location.name || 'Unbenannte Location';
        const entries = game.pieces.map(row => ({ ...row }));
        entries[entries.length - 1].pause_ms = b10 ? 250 : 0;
        for (const [group, description, rows, display] of [
            ['assembled', 'D02 · zusammengesetzter Vorbereitungsaufruf',
                [{ piece: b09, pause_ms: 250 }, ...entries, ...(b10 ? [{ piece: b10, pause_ms: 0 }] : [])],
                [opening, game.display, ending].filter(Boolean).join(' ')],
            ['sentences', b09 === b10 ? 'B09 · Vorbereitungsanfang und Abschluss · dieselbe Aufnahme' : 'B09 · Vorbereitungsanfang',
                [{ piece: b09, pause_ms: 0 }], opening],
            ...(b10 && b10 !== b09 ? [['sentences', hasMeeting ? 'B10 · Treffpunkt' : 'Vorbereitungsabschluss', [{ piece: b10, pause_ms: 0 }], ending]] : []),
        ]) {
            plan.cases.push({ id: `${locationId}-${group}${group === 'sentences' ? '-' + rows[0].piece : ''}`, experiment: group, label: label + ' · ' + description,
                location_id: location._id, display, pieces: rows, subjective_quality: 'not-rated' });
        }
        summaries.push({ location_id: location._id, name: label, preparation_addition: location.preparation_addition || '',
            meetingpoint_announcement: location.meetingpoint_announcement || '', opening, ending,
            ending_kind: hasMeeting ? 'meeting' : 'preparation',
            opening_source: plan.pieces.get(b09).source, closing_source: b10 ? plan.pieces.get(b10).source : null,
            opening_piece: b09, closing_piece: b10 });
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.generator_sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    result.scope = { purpose: 'Location-aware D02 hearing trial only; no production activation', without_court: true,
        source_gameblock_plan_sha256: digest(existing), game_case_id: game.id, game_pieces: game.pieces.map(p => p.piece),
        location_strategy: 'direct-browser-text-v1', browser_texts_unchanged: true,
        preparation_meetingpoint_enabled: !!tournament.preparation_meetingpoint_enabled,
        locations: summaries, distinct_location_sources_per_voice: new Set(summaries.flatMap(l =>
            [l.opening_source, l.closing_source].filter(Boolean))).size,
        existing_gameblocks_unchanged: true, boundary_pause_target_ms: 250 };
    return result;
}

if (require.main === module) {
    const existing = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const tournament = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    process.stdout.write(JSON.stringify(preparation(existing, tournament, process.argv[4]), null, 2) + '\n');
}

module.exports = { preparation };
