'use strict';

const assert = require('assert');
const { baseline } = require('../scripts/tts-context-benchmark-plan');

describe('Isolated context v1 benchmark plan', function() {
    it('uses the unchanged actual v1 renderer for D01, D05, D08 and D12, with full references', function() {
        const plan = baseline();
        assert.strictEqual(plan.production_strategy, 'bts-context-v1');
        assert.strictEqual(plan.cases.length, 8);
        const pieces = new Map(plan.pieces.map(item => [item.id, item]));
        const sources = new Map(plan.sources.map(item => [item.id, item]));
        for (const item of pieces.values()) {
            assert.strictEqual(item.before + item.text + item.after, sources.get(item.source).text);
            assert(!/\d/.test(item.text + item.before + item.after));
        }
        const by_id = id => plan.cases.find(item => item.id === id);
        const spoken = id => by_id(id).pieces.map(item => pieces.get(item.piece).text);
        assert(spoken('D12-v1').includes('Das Spiel geht kampflos an'));
        assert(spoken('D08-v1').some(text => text.includes('Klapptafelbedienung:Erika Musterfrau und Otto Normalverbraucher')));
        assert.deepStrictEqual(by_id('D05-v1').pieces.slice(0, -1).map(item => item.pause_ms), [140, 120, 320, 160]);
        assert.strictEqual(spoken('D01-v1')[0], spoken('D01-v1').at(-1));
        assert.notStrictEqual(by_id('D01-v1').pieces[0].piece, by_id('D01-v1').pieces.at(-1).piece);
    });

    it('applies the real pronunciation substitutions without guessing name pronunciation', function() {
        const plan = baseline([{ origin: 'Hans Dampf', replace: 'Hanns Dampf', language: 'de-DE' }]);
        assert(plan.sources.some(source => source.text.includes('Hanns Dampf')));
        assert(plan.pronunciation.normalizations_sha256);
    });
});
