'use strict';

// Isolated hearing trial. Read the actual browser builder without changing its runtime.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Plan, digest } = require('./tts-context-benchmark-plan');
const { excerpt, repeatedTeam } = require('./tts-gameblock-context-plan');
const { spellNumbers } = require('../bts/speech/numbers');
const { lexemes } = require('./tts-second-call-plan');

function browserBuilder(normalizations = []) {
    const source = fs.readFileSync(path.join(__dirname, '../static/js/ctournament.js'), 'utf8');
    const start = source.indexOf('\tfunction normalize_registration_announcement_text(');
    const end = source.indexOf('\n\tfunction trigger_registration_announcement(', start);
    if (start < 0 || end <= start) throw new Error('Registration browser builder boundaries changed');
    const context = vm.createContext({ curt: { normalizations }, ci18n: () => 'de-DE' });
    vm.runInContext(source.slice(start, end), context, { timeout: 1000 });
    const build = context.registration_control_announcement_text;
    build.normalize = context.normalize_registration_announcement_text;
    return build;
}

function registration(existing) {
    if (existing.strategy !== 'bts-context-v2-lab-only' || !existing.origins) throw new Error('A prepared v2 catalogue is required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    if (digest(plan.export().pronunciation) !== digest(existing.pronunciation)) throw new Error('Pronunciation identities must match');
    const build = browserBuilder(plan.normalizations), origins = {}, fixed = {}, labels = {}, references = [];
    const take = text => {
        const part = existing.pieces.find(p => p.text === text && p.profile === 'lab-v2/team-before-plays' && p.kind === 'team');
        const source = part && existing.sources.find(s => s.id === part.source);
        if (!source || source.text !== text + ' spielt jetzt gegen ' + text + '!' || !existing.origins[part.id]) {
            throw new Error('Complete prepared first-position names with provenance are required');
        }
        plan.sources.set(source.id, { ...source }); plan.pieces.set(part.id, { ...part }); origins[part.id] = existing.origins[part.id];
        return part.id;
    };
    const samples = [
        { kind: 'player', title: 'Person', text: 'Max Mustermann', destination: 'check' },
        { kind: 'pair', title: 'Paarung', text: 'Max Mustermann und Hans Dampf', destination: 'control' },
        { kind: 'club', title: 'Verein', text: 'PSV Bremen', destination: 'check', example: true },
        { kind: 'state', title: 'Bundesland', text: 'Bremen', destination: 'control', example: true },
    ];
    for (const sample of samples) {
        const display = build(sample.kind, null, sample.text, sample.destination), full = spellNumbers(display);
        const source = plan.source(full, 'lab-v2/registration-' + sample.kind + '-context', display);
        const add = (key, text, last = false, kind = 'generic') => {
            const id = excerpt(plan, source, text, 'lab-v2/registration-' + key, { last, kind });
            fixed[key] = id; return id;
        };
        const target = sample.destination === 'control' ? 'Turnierleitung' : 'Anmeldung';
        if (['player', 'pair'].includes(sample.kind)) {
            labels[sample.kind] = [take(sample.text), take(sample.text)];
            add('target-' + target, 'bitte zur ' + target + '.');
            add('bare-target-' + target, 'zur ' + target + '.');
            if (sample.kind === 'player') add('closing', 'bitte!', true);
            else add('pair-prefix', 'Die Paarung');
        } else {
            const prefix = sample.kind === 'club' ? 'ein Vertreter vom Verein' : 'ein Vertreter aus';
            add(sample.kind + '-opening', 'Bitte ' + prefix);
            add(sample.kind + '-repeat', 'Ein ' + prefix.slice(4), true);
            const spoken = spellNumbers(build.normalize(sample.text));
            const label = repeatedTeam(plan, spoken, sample.text, ['first']).first;
            labels[sample.kind] = [label, label];
            const labelSource = plan.pieces.get(label).source;
            const fullLabel = plan.sources.get(labelSource);
            const reference = excerpt(plan, labelSource, fullLabel.text, 'lab-v2/registration-label-reference',
                { kind: 'game', display: fullLabel.display });
            references.push({ id: 'reference-' + sample.kind + '-label', experiment: 'reference',
                label: sample.title + ' · Bezeichnung im Namenskontext', display: fullLabel.display,
                pieces: [{ piece: reference, pause_ms: 0 }], subjective_quality: 'not-rated' });
        }
        const piece = excerpt(plan, source, full, 'lab-v2/registration-full-reference', { kind: 'game', display });
        references.push({ id: 'reference-' + sample.kind, experiment: 'reference', label: sample.title + ' · Kontext der festen Aufruftexte',
            display, pieces: [{ piece, pause_ms: 0 }], subjective_quality: 'not-rated' });
    }
    for (const sample of samples) for (const destination of ['check', 'control']) {
        const target = destination === 'control' ? 'Turnierleitung' : 'Anmeldung', [first, second] = labels[sample.kind];
        const keys = sample.kind === 'player' ? [first, fixed['target-' + target], second, fixed.closing] :
            sample.kind === 'pair' ? [fixed['pair-prefix'], first, fixed['target-' + target], second, fixed.closing] :
                [fixed[sample.kind + '-opening'], first, fixed['bare-target-' + target], fixed[sample.kind + '-repeat'], second, fixed.closing];
        const display = build(sample.kind, null, sample.text, destination);
        const words = keys.map(k => plan.pieces.get(k).text).join(' ');
        if (lexemes(words) !== lexemes(display)) throw new Error('Montage differs from the actual browser announcement');
        plan.cases.push({ id: sample.kind + '-' + destination, experiment: sample.kind, label: sample.title + ' · zur ' + target,
            display, browser_text: display, example_label: !!sample.example, destination, pieces: keys.map((piece, i) => ({ piece,
                pause_ms: i === keys.length - 1 ? 0 : plan.pieces.get(piece).text.endsWith('.') ? 320 : 80 })), subjective_quality: 'not-rated' });
    }
    // Reuse the approved fixed excerpts and their complete context references.
    // Only missing label sources enter the native runner on this revision.
    for (const [key, part] of plan.pieces) {
        const cached = existing.pieces.find(p => p.id === key);
        if (!cached || !existing.origins[key]) continue;
        const source = existing.sources.find(s => s.id === part.source), expected = plan.sources.get(part.source);
        if (['id', 'source', 'before', 'text', 'after', 'kind', 'profile', 'display'].some(f => cached[f] !== part[f]) ||
                !source || ['text', 'profile', 'display'].some(f => source[f] !== expected[f])) {
            throw new Error('Cached registration pieces must preserve exact geometry and source identity');
        }
        origins[key] = existing.origins[key];
    }
    const newKeys = [...plan.pieces.keys()].filter(k => !origins[k]);
    const nameKeys = new Set([...labels.player, ...labels.pair]);
    for (const key of plan.pieces.keys()) {
        if (nameKeys.has(key)) continue;
        if (references.some(c => c.pieces[0].piece === key)) continue;
        const p = plan.pieces.get(key);
        plan.cases.push({ id: 'piece-' + key, experiment: 'piece', label: p.display, display: p.display,
            pieces: [{ piece: key, pause_ms: 0 }], subjective_quality: 'not-rated' });
    }
    plan.cases.push(...references);
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only'; result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.scope = { purpose: 'Registration hearing samples only; no production switch or roster generation',
        new_pieces: newKeys, reused_piece_origins: origins, fixed_pieces: fixed, label_pieces: labels,
        new_sources_per_voice: new Set(newKeys.map(k => plan.pieces.get(k).source)).size,
        no_new_name_sources: true, name_position: 'first occurrence before spielt; reused before bitte',
        label_context: '[Bezeichnung] spielt jetzt gegen [Bezeichnung]!', label_position: 'first occurrence before spielt; reused before zur and bitte',
        example_labels: { club: 'PSV Bremen', state: 'Bremen' }, browser_words_match: true,
        within_sentence_pause_ms: 80, between_sentences_pause_ms: 320 };
    return result;
}
if (require.main === module) process.stdout.write(JSON.stringify(registration(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2) + '\n');
module.exports = { browserBuilder, registration };
