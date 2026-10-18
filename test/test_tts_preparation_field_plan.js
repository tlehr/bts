'use strict';
const assert = require('assert');
const { fieldSentences, withPreparation } = require('../scripts/tts-preparation-field-plan');
const { Plan, digest } = require('../scripts/tts-context-benchmark-plan');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');

const tournament = () => ({ courts: [13, 1, 8].map(n => ({ _id: 'default_' + n, location_id: 'campus' })),
    locations: [{ _id: 'campus', preparation_addition: '', meetingpoint_announcement: '' }], preparation_meetingpoint_enabled: false });
function catalogue(tabletColon = true) {
    const plan = new Plan();
    for (const [profile, text, display = text] of [
        ['B09-opening', 'In Vorbereitung!'], ['B09-closing', 'Das Spiel ist in Vorbereitung!'],
        ['B03', 'Spielnummer einhunderteinundsechzig', 'Spielnummer 161'], ['B04', 'Jungen Einzel U siebzehn', 'Jungeneinzel U17'],
        ['B05', 'Achtelfinale!'], ['team-before-plays', 'Muhammad Sytsh Abdulquddus'], ['team-after-with-gegen', 'gegen Max Hahn'],
        ['B08-role-umpire', 'Schiedsrichter'], ['team-after-gegen', 'Tim Lehr'], ['B08-role-service', 'Aufschlagrichter'],
        ['team-after-gegen', 'Max Hahn'], ['B08-role', 'Tabletbedienung' + (tabletColon ? ':' : '')], ['team-after-gegen', 'Emil Hermann und Konrad Wendt'],
    ]) {
        const source = plan.source(text, 'fixture', display);
        const part = { source, before: '', text, after: '', kind: 'generic', profile: 'lab-v2/' + profile, display };
        const id = 'p-' + digest(part).slice(0, 20); plan.pieces.set(id, { id, ...part });
    }
    const result = plan.export(); result.strategy = 'bts-context-v2-lab-only';
    result.origins = Object.fromEntries(result.pieces.map(p => [p.id, { run: '/approved', sha256: 'a'.repeat(64) }]));
    return result;
}

describe('complete B02 field sentences', function() {
    it('uses actual courts and exact complete browser sentences, spelling numbers only for synthesis', function() {
        const input = tournament(), plan = fieldSentences(input);
        const texts = create({ tournament: input, translate: (k, d, f) => translate('de', k, d, f),
            window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
        assert.deepStrictEqual(plan.scope.fields.map(f => f.number), [1, 8, 13]);
        assert.strictEqual(plan.sources.length, 3); assert.strictEqual(plan.pieces.length, 3);
        for (const field of plan.scope.fields) {
            const part = plan.pieces.find(p => p.id === field.piece), source = plan.sources.find(s => s.id === part.source);
            assert.strictEqual(part.display, texts.createFieldPreparationAnnouncement({ court_id: field.court_id }));
            assert.strictEqual(part.text, spellNumbers(part.display));
            assert.strictEqual(source.text, part.text); assert.strictEqual(part.before + part.after, '');
            assert(part.text.endsWith('!')); assert(!/\d/.test(part.text));
        }
        assert(plan.sources.some(s => s.text === 'Für Spielfeld dreizehn!'));
        assert.deepStrictEqual(plan.pause_quality_voices, ['hallensprecher', 'hallensprecherin']);
    });
    it('is independent of games, locations, officials and court display names; adds only a missing field', function() {
        const a = tournament(), first = fieldSentences(a);
        a.locations[0].name = 'New location'; a.courts.forEach(c => { c.name = 'Changed'; c.location_id = 'new'; });
        a.matches = [{ setup: { match_num: 999, umpire: { name: 'Other' } } }];
        assert.deepStrictEqual(fieldSentences(a).pieces, first.pieces);
        a.courts.push({ _id: 'default_4' });
        const updated = fieldSentences(a);
        assert.strictEqual(updated.sources.length, first.sources.length + 1);
        for (const p of first.pieces) assert.deepStrictEqual(updated.pieces.find(q => q.id === p.id), p);
        a.courts.push({ _id: 'second_4' });
        assert.strictEqual(fieldSentences(a).sources.length, updated.sources.length, 'equal spoken numbers share recordings across locations');
    });
    it('rejects missing, duplicate and invalid actual court IDs', function() {
        for (const input of [{}, { courts: [] }, { courts: [{ _id: 'default_1' }, { _id: 'default_1' }] },
            { courts: [{ _id: 'default_0' }] }, { courts: [{ _id: 'default_-1' }] }, { courts: [{ _id: 'default_1.5' }] },
            { courts: [{ _id: 'unknown' }] }]) assert.throws(() => fieldSentences(input), /courts|court IDs|court numbers/);
    });
    it('assembles every field from the same thirteen cached preparation, game and official pieces', function() {
        const input = tournament(), native = fieldSentences(input), old = catalogue();
        const snapshot = JSON.stringify([native, old]), plan = withPreparation(native, old, input);
        assert.strictEqual(JSON.stringify([native, old]), snapshot);
        assert.strictEqual(plan.scope.new_pieces.length, 3);
        assert.strictEqual(Object.keys(plan.scope.reused_piece_origins).length, 13);
        for (const p of old.pieces) assert.deepStrictEqual(plan.pieces.find(q => q.id === p.id), p);
        assert.strictEqual(plan.cases.length, 6);
        for (const call of plan.cases.filter(c => c.experiment === 'assembled')) {
            assert.strictEqual(call.pieces.length, 14);
            assert.deepStrictEqual(call.pieces.map(e => e.pause_ms), [250, 250, 250, 250, 250, 60, 250, 80, 250, 80, 250, 80, 250, 0]);
            const field = plan.scope.fields.find(f => f.court_id === call.court_id);
            assert.strictEqual(call.pieces[1].piece, field.piece);
            assert(call.display.includes('Jungen Einzel U17.'));
            assert(call.display.includes('Tabletbedienung: Emil Hermann und Konrad Wendt.'));
        }
        const repeatedNumbers = { ...input, courts: [...input.courts, { _id: 'second_8' }] };
        const duplicates = withPreparation(fieldSentences(repeatedNumbers), old, repeatedNumbers);
        assert.strictEqual(new Set(duplicates.cases.map(c => c.id)).size, duplicates.cases.length);
    });
    it('preserves voice-specific role sources while giving both voices identical displayed wording', function() {
        const input = tournament(), native = fieldSentences(input);
        assert.deepStrictEqual(withPreparation(native, catalogue(true), input).cases.map(c => c.display),
            withPreparation(native, catalogue(false), input).cases.map(c => c.display));
    });
    it('rejects incompatible pronunciation, missing provenance and unsupported location text rather than dropping words', function() {
        const input = tournament(), native = fieldSentences(input), missing = catalogue();
        delete missing.origins[missing.pieces[0].id];
        assert.throws(() => withPreparation(native, missing, input), /provenance/);
        const different = catalogue(); different.pronunciation.numbers = 'old';
        assert.throws(() => withPreparation(native, different, input), /Matching/);
        input.locations[0].preparation_addition = 'für Halle 2!';
        assert.throws(() => withPreparation(native, catalogue(), input), /location/);
        input.locations[0].preparation_addition = ''; input.preparation_meetingpoint_enabled = true;
        input.locations[0].meetingpoint_announcement = 'Bitte hier melden!';
        assert.throws(() => withPreparation(native, catalogue(), input), /meeting point/);
    });
});
