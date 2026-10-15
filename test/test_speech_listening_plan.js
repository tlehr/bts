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
});
