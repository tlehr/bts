'use strict';

const assert = require('assert');
const plan = require('../scripts/tts-listening-plan');
const { spellNumbers } = require('../bts/speech/numbers');

describe('Local TTS listening comparison', function() {
    it('keeps the requested text and both names exact while spelling numbers only for synthesis', function() {
        const value = plan();
        assert.strictEqual(value.source,
            'Auf Spielfeld 8! Spiel 189.  Mädcheneinzel U19.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz. Auf Spielfeld 8!');
        assert.strictEqual(value.spoken, spellNumbers(value.source));
        for (const item of value.cases) {
            const joined = item.parts.map(part => part.text).join(' ');
            const words = text => text.replace(/[^\p{L}]/gu, '');
            assert.strictEqual(words(joined), words(value.spoken));
            assert(!/\d/.test(joined));
            assert(joined.includes('LeandraGalowicz'));
        }
    });

    it('reuses the repeated court recording and compares neutral name punctuation with a complete names phrase', function() {
        const [, current, punctuation, grouped] = plan().cases;
        for (const item of [current, punctuation, grouped]) assert.strictEqual(item.parts[0].text, item.parts.at(-1).text);
        assert.strictEqual(current.parts[4].text, 'Nina Keo Boun Khoune');
        assert.strictEqual(punctuation.parts[4].text, 'Nina Keo Boun Khoune,');
        assert.strictEqual(punctuation.parts[6].text, 'LeandraGalowicz,');
        assert(grouped.parts.some(part => part.text === 'Nina Keo Boun Khoune gegen LeandraGalowicz.'));
    });

    it('adds only one court-independent game recording and preserves its full inner sentence melody', function() {
        const value = plan();
        const existing = new Set(value.cases.slice(0, 4).flatMap(item => item.parts.map(part => part.text)));
        const hybrid = value.cases[4];
        assert.strictEqual(hybrid.parts.length, 3);
        assert.strictEqual(hybrid.parts[0].text, hybrid.parts[2].text);
        assert(existing.has(hybrid.parts[0].text));
        assert.deepStrictEqual(hybrid.parts.filter(part => !existing.has(part.text)).map(part => part.text), [
            'Spiel einhundertneunundachtzig.  Mädcheneinzel U neunzehn.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz.',
        ]);
        assert(!hybrid.parts[1].text.includes('Spielfeld'));
        assert.strictEqual(hybrid.parts[1].preserve_inner_pauses, true);
        assert.strictEqual(value.cases[0].parts[0].preserve_inner_pauses, true);
    });

    it('uses separate court excerpts from the chosen full reference without requesting new speech', function() {
        const value = plan();
        const contextual = value.cases[5];
        assert.strictEqual(contextual.parts[1].text, value.cases[4].parts[1].text);
        for (const index of [0, 2]) {
            const { excerpt, preserve_inner_pauses } = contextual.parts[index];
            assert.strictEqual(excerpt.source_case, value.cases[0].id);
            assert.strictEqual(excerpt.source_sha256, value.context_reference.source_sha256);
            assert.strictEqual(preserve_inner_pauses, true);
            assert(excerpt.end_frame > excerpt.start_frame);
        }
        assert.notStrictEqual(contextual.parts[0].excerpt.id, contextual.parts[2].excerpt.id);
    });
});
