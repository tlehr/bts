'use strict';

// Isolated D03 trial: reuse accepted B01 starts, synthesize B12 once per voice.
const fs = require('fs');
const { Plan, digest } = require('./tts-context-benchmark-plan');

const INSTRUCTION = 'Bitte mit dem Spielen beginnen!';
const CONTEXT = 'Auf Spielfeld acht! ' + INSTRUCTION;

function startInstructions(existing) {
    if (existing.strategy !== 'bts-context-v2-lab-only') {
        throw new Error('An existing v2 field plan is required');
    }
    const starts = existing.pieces.filter(piece => piece.kind === 'field_start');
    if (!starts.length) throw new Error('At least one existing field start is required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    for (const piece of starts) {
        const source = existing.sources.find(source => source.id === piece.source);
        if (!source || piece.before + piece.text + piece.after !== source.text) {
            throw new Error('The existing field start must match its actual source');
        }
        plan.sources.set(source.id, { ...source });
        plan.pieces.set(piece.id, { ...piece });
    }
    const source = plan.source(CONTEXT, 'lab-v2/start-reference', 'Auf Spielfeld 8! ' + INSTRUCTION);
    const addPiece = (before, text, after, kind, profile, display) => {
        const item = { source, before, text, after, kind, profile, display };
        const id = 'p-' + digest(item).slice(0, 20);
        plan.pieces.set(id, { id, ...item });
        return id;
    };
    const instruction = addPiece('Auf Spielfeld acht! ', INSTRUCTION, '', 'generic', 'lab-v2/B12', INSTRUCTION);
    const reference = addPiece('', CONTEXT, '', 'game', 'lab-v2/start-full-reference', 'Auf Spielfeld 8! ' + INSTRUCTION);
    for (const field of starts) {
        plan.cases.push({ id: 'start-assembled-' + field.id, experiment: 'assembled',
            label: 'D03 · ' + field.display + ' ' + INSTRUCTION, display: field.display + ' ' + INSTRUCTION,
            pieces: [{ piece: field.id, pause_ms: 250 }, { piece: instruction, pause_ms: 0 }],
            subjective_quality: 'not-rated' });
    }
    plan.cases.push({ id: 'start-piece', experiment: 'piece', label: 'B12 · Startanweisung als Ausschnitt',
        display: INSTRUCTION, pieces: [{ piece: instruction, pause_ms: 0 }], subjective_quality: 'not-rated' });
    plan.cases.push({ id: 'start-reference', experiment: 'reference', label: 'Vollständige D03-Kontextaufnahme',
        display: 'Auf Spielfeld 8! ' + INSTRUCTION, pieces: [{ piece: reference, pause_ms: 0 }], subjective_quality: 'not-rated' });
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.generator_sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    result.scope = { purpose: 'B12 context hearing trial only; no production activation',
        source_field_plan_sha256: digest(existing), source_text: CONTEXT, excerpt: INSTRUCTION,
        new_sources_per_voice: 1, field_starts_unchanged: true, shared_across_all_courts: true,
        boundary_pause_target_ms: 250 };
    return result;
}

if (require.main === module) {
    const existing = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(startInstructions(existing), null, 2) + '\n');
}

module.exports = { startInstructions, INSTRUCTION, CONTEXT };
