'use strict';

// Explicit B01 hearing trial. The accepted game-block plan stays unchanged.
const fs = require('fs');
const crypto = require('crypto');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');
const { Plan, digest } = require('./tts-context-benchmark-plan');

const REFERENCE = 'Spiel einhundertneunundachtzig.  Mädcheneinzel U neunzehn.  Achtelfinale! Max Mustermann gegen Hans Dampf.';

function fields(existing, courtNumbers = [8]) {
    if (existing.strategy !== 'bts-context-v2-lab-only' || !existing.cases?.length) {
        throw new Error('An existing v2 game-block hearing plan is required');
    }
    const courts = [...new Set(courtNumbers)];
    if (!courts.length || courts.some(number => !Number.isSafeInteger(number) || number < 1)) {
        throw new Error('Positive whole court numbers are required');
    }
    const plan = new Plan(existing.pronunciation.normalizations || []);
    for (const item of existing.sources) plan.sources.set(item.id, { ...item });
    for (const item of existing.pieces) plan.pieces.set(item.id, { ...item });
    const texts = create({ tournament: { normalizations: existing.pronunciation.normalizations || [] },
        translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
    for (const court of courts) {
        const display = `Auf Spielfeld ${court}!`;
        const phrase = spellNumbers(display);
        // Keep the fixed reference's number, punctuation and double spaces.
        // The spoken discipline uses the already chosen space spelling.
        const middle = spellNumbers(texts.normalizeNames(REFERENCE.replace('Mädcheneinzel', 'Mädchen Einzel')));
        const full = `${phrase} ${middle} ${phrase}`;
        const source = plan.source(full, 'lab-v2/field-reference', `${display} ${REFERENCE} ${display}`);
        const piece = (kind, before, text, after, shown) => {
            const item = { source, before, text, after, kind, profile: 'lab-v2/' + kind, display: shown };
            const id = 'p-' + digest(item).slice(0, 20);
            plan.pieces.set(id, { id, ...item });
            return id;
        };
        const start = piece('field_start', '', phrase, ` ${middle} ${phrase}`, display);
        const end = piece('field_end', `${phrase} ${middle} `, phrase, '', display);
        const reference = piece('game', '', full, '', `${display} ${REFERENCE} ${display}`);
        for (const [suffix, label, group, id, shown] of [
            ['start', 'B01 · Feldanfang', 'pieces', start, display],
            ['end', 'B01 · Feldende', 'pieces', end, display],
            ['reference', 'Vollständige Kontextaufnahme · nur zum Vergleich', 'reference', reference, `${display} ${REFERENCE} ${display}`],
        ]) {
            plan.cases.push({ id: `feld-${court}-${suffix}`, experiment: group, label,
                display: shown, pieces: [{ piece: id, pause_ms: 0 }], subjective_quality: 'not-rated' });
        }
        for (const original of existing.cases) {
            const entries = original.pieces.map(entry => ({ ...entry }));
            entries[entries.length - 1].pause_ms = 250;
            plan.cases.push({ ...original, id: `feld-${court}-` + original.id,
                experiment: original.id.endsWith('-three') ? 'three' : 'two',
                label: `Auf Spielfeld ${court} · ` + original.label,
                display: `${display} ${original.display}${/[.!?]$/.test(original.display) ? '' : '.'} ${display}`,
                pieces: [{ piece: start, pause_ms: 250 }, ...entries, { piece: end, pause_ms: 0 }],
                subjective_quality: 'not-rated' });
        }
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.generator_sha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    result.scope = { purpose: 'B01 context cuts and existing game-block assembly, lab only',
        source_gameblock_plan_sha256: digest(existing), courts, voices: ['hallensprecher', 'hallensprecherin'],
        field_reference: REFERENCE, spoken_discipline: 'Mädchen Einzel',
        new_sources_per_court_and_voice: 1, position_specific_field_cuts: 2,
        existing_gameblocks_unchanged: true, boundary_pause_target_ms: 250 };
    return result;
}

if (require.main === module) {
    const existing = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const courts = process.argv.slice(3).map(Number);
    process.stdout.write(JSON.stringify(fields(existing, courts.length ? courts : undefined), null, 2) + '\n');
}

module.exports = { fields, REFERENCE };
