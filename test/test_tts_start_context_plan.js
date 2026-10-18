'use strict';

const assert = require('assert');
const { gameblocks } = require('../scripts/tts-gameblock-context-plan');
const { fields } = require('../scripts/tts-field-context-plan');
const { startInstructions, INSTRUCTION, CONTEXT } = require('../scripts/tts-start-context-plan');

describe('B12 start instruction hearing plan', function() {
    it('shares one context recording across courts and retains exact accepted field-start identities', function() {
        const teams = ['Team Eins', 'Team Zwei'].map(name => ({ players: [{ name }] }));
        const games = gameblocks({}, [{ id: 'test', label: 'Test', setup: {
            match_num: 189, event_name: 'ME U19', match_name: 'R16', teams,
        } }]);
        const existing = fields(games, [8, 9]), snapshot = JSON.stringify(existing);
        const plan = startInstructions(existing);
        assert.strictEqual(JSON.stringify(existing), snapshot);
        assert.deepStrictEqual(plan.pronunciation, existing.pronunciation);
        assert.strictEqual(plan.sources.length, 3, 'two existing field sources and one new start reference');
        assert.strictEqual(plan.sources.filter(s => s.profile === 'lab-v2/start-reference').length, 1);
        assert.strictEqual(plan.sources.find(s => s.profile === 'lab-v2/start-reference').text, CONTEXT);
        const b12 = plan.pieces.filter(p => p.profile === 'lab-v2/B12');
        assert.strictEqual(b12.length, 1);
        assert.strictEqual(b12[0].before, 'Auf Spielfeld acht! ');
        assert.strictEqual(b12[0].text, INSTRUCTION);
        assert.strictEqual(b12[0].after, '');
        const assembled = plan.cases.filter(c => c.experiment === 'assembled');
        assert.strictEqual(assembled.length, 2);
        for (const call of assembled) {
            const field = plan.pieces.find(p => p.id === call.pieces[0].piece);
            assert.deepStrictEqual(field, existing.pieces.find(p => p.id === field.id));
            assert.strictEqual(call.pieces[1].piece, b12[0].id);
            assert.strictEqual(call.pieces[0].pause_ms, 250);
        }
        assert(!plan.pieces.some(p => p.kind === 'field_end' || p.profile === 'lab-v2/B03'));
        assert(plan.sources.every(s => !/\d/.test(s.text)));
        assert.deepStrictEqual(plan.pause_quality_voices, ['hallensprecher', 'hallensprecherin']);
    });

    it('requires actual v2 field recordings and refuses mismatched excerpts', function() {
        assert.throws(() => startInstructions({ strategy: 'v1' }), /v2 field plan/);
        assert.throws(() => startInstructions({ strategy: 'bts-context-v2-lab-only', pieces: [] }), /field start/);
        const existing = { strategy: 'bts-context-v2-lab-only', pronunciation: {}, sources: [],
            pieces: [{ id: 'field', kind: 'field_start', source: 'missing' }] };
        assert.throws(() => startInstructions(existing), /actual source/);
    });
});
