'use strict';

const assert = require('assert');
const { gameblocks } = require('../scripts/tts-gameblock-context-plan');
const { fields, REFERENCE } = require('../scripts/tts-field-context-plan');

function baseline(normalizations = []) {
    const teams = [{ players: [{ name: 'Nina Keo Boun Khoune' }] }, { players: [{ name: 'LeandraGalowicz' }] }];
    return gameblocks({ normalizations }, [{ id: 'test', label: 'Test', origin: 'fixture',
        setup: { match_num: 189, event_name: 'ME U19', match_name: 'R16', teams } }]);
}

describe('B01 field-context hearing plan', function() {
    it('gets both field positions from one full source and wraps the unchanged cached game blocks', function() {
        const existing = baseline(), snapshot = JSON.stringify(existing);
        const plan = fields(existing);
        assert.strictEqual(JSON.stringify(existing), snapshot);
        assert.strictEqual(plan.sources.length, existing.sources.length + 1);
        assert.strictEqual(plan.pieces.length, existing.pieces.length + 3);
        assert.strictEqual(plan.cases.length, existing.cases.length + 3);
        assert.deepStrictEqual(plan.sources.slice(0, existing.sources.length), existing.sources);
        assert.deepStrictEqual(plan.pieces.slice(0, existing.pieces.length), existing.pieces);
        assert.deepStrictEqual(plan.pronunciation, existing.pronunciation);
        const source = plan.sources.find(item => item.profile === 'lab-v2/field-reference');
        assert.strictEqual(source.text, 'Auf Spielfeld acht! ' + REFERENCE.replace('Mädcheneinzel', 'Mädchen Einzel') + ' Auf Spielfeld acht!');
        const start = plan.pieces.find(item => item.kind === 'field_start');
        const end = plan.pieces.find(item => item.kind === 'field_end');
        assert.strictEqual(start.source, end.source);
        assert.notStrictEqual(start.id, end.id);
        assert.strictEqual(start.text, end.text);
        assert.strictEqual(start.before, '');
        assert.strictEqual(end.after, '');
        assert.strictEqual(start.display, 'Auf Spielfeld 8!');
        for (const piece of [start, end]) assert.strictEqual(piece.before + piece.text + piece.after, source.text);
        const montages = plan.cases.filter(item => ['two', 'three'].includes(item.experiment));
        montages.forEach((item, index) => {
            assert.deepStrictEqual(item.pieces.slice(1, -1).map(entry => entry.piece), existing.cases[index].pieces.map(entry => entry.piece));
            assert.strictEqual(item.pieces[0].piece, start.id);
            assert.strictEqual(item.pieces.at(-1).piece, end.id);
            assert.strictEqual(item.pieces[0].pause_ms, 250);
            assert.strictEqual(item.pieces.at(-2).pause_ms, 250);
        });
        assert(plan.sources.every(item => !/\d/.test(item.text)));
    });

    it('deduplicates courts, applies existing name rules and rejects invalid requests', function() {
        const existing = baseline([{ language: 'de-DE', origin: 'Nina', replace: 'Niena' }]);
        const plan = fields(existing, [8, 8, 9]);
        assert.strictEqual(plan.sources.length, existing.sources.length + 2);
        const sources = plan.sources.filter(item => item.profile === 'lab-v2/field-reference');
        assert(sources.every(item => item.text.includes('Niena Keo Boun Khoune')));
        assert(sources[1].text.startsWith('Auf Spielfeld neun!'));
        assert(sources[1].text.endsWith('Auf Spielfeld neun!'));
        for (const courts of [[], [0], [-1], [1.5], ['8']]) assert.throws(() => fields(existing, courts), /court numbers/);
        assert.throws(() => fields({ strategy: 'v1', cases: [] }), /existing v2/);
    });
});
