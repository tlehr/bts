'use strict';
const assert = require('assert');
const { Plan } = require('../scripts/tts-context-benchmark-plan');
const { repeatedTeam } = require('../scripts/tts-gameblock-context-plan');
const { browserBuilder, registration } = require('../scripts/tts-registration-plan');
const { lexemes } = require('../scripts/tts-second-call-plan');

function catalogue() {
    const plan = new Plan();
    for (const text of ['Muhammad Sytsh Abdulquddus', 'Ben Hensel und Max Wächtler']) repeatedTeam(plan, text, text, ['first']);
    const result = plan.export(); result.strategy = 'bts-context-v2-lab-only';
    result.origins = Object.fromEntries(result.pieces.map(p => [p.id, { run: '/approved', sha256: 'a'.repeat(64) }]));
    return result;
}
describe('registration hearing plan', function() {
    it('matches all eight actual browser templates and preserves their repeated labels', function() {
        const plan = registration(catalogue()), build = browserBuilder();
        assert.strictEqual(build('club', null, 'PSV Bremen', 'check'), 'Bitte ein Vertreter vom Verein PSV Bremen zur Anmeldung. Ein Vertreter vom Verein PSV Bremen bitte!');
        const calls = plan.cases.filter(c => c.browser_text);
        assert.strictEqual(calls.length, 8);
        for (const call of calls) {
            assert.strictEqual(lexemes(call.pieces.map(e => plan.pieces.find(p => p.id === e.piece).text).join(' ')), lexemes(call.browser_text));
            assert(!call.display.includes('U17'));
            assert(call.pieces.every(e => [0, 80, 320].includes(e.pause_ms)));
        }
        assert.strictEqual(build('player', { name: 'JE U17' }, '', 'check'), '');
    });
    it('uses only four new contexts, ten common pieces, and byte-identical prepared whole names', function() {
        const old = catalogue(), snapshot = JSON.stringify(old), plan = registration(old);
        assert.strictEqual(JSON.stringify(old), snapshot);
        assert.strictEqual(plan.scope.new_pieces.length, 18);
        assert.strictEqual(Object.keys(plan.scope.fixed_pieces).length, 10);
        assert.strictEqual(new Set(plan.pieces.filter(p => plan.scope.new_pieces.includes(p.id)).map(p => p.source)).size, 4);
        assert.strictEqual(Object.keys(plan.scope.reused_piece_origins).length, 2);
        for (const original of old.pieces) assert.deepStrictEqual(plan.pieces.find(p => p.id === original.id), original);
        for (const kind of ['player', 'pair']) assert.strictEqual(plan.scope.label_pieces[kind][0], plan.scope.label_pieces[kind][1]);
        assert.strictEqual(plan.cases.length, 26);
    });
    it('has exact source positions and standalone coverage for every newly cut piece', function() {
        const plan = registration(catalogue());
        for (const piece of plan.pieces) assert.strictEqual(piece.before + piece.text + piece.after, plan.sources.find(s => s.id === piece.source).text);
        const standalone = plan.cases.filter(c => ['piece', 'reference'].includes(c.experiment)).flatMap(c => c.pieces.map(p => p.piece));
        assert.deepStrictEqual(standalone.sort(), [...plan.scope.new_pieces].sort());
        assert.notStrictEqual(...plan.scope.label_pieces.club);
        assert.notStrictEqual(...plan.scope.label_pieces.state);
    });
    it('retains browser normalization and fails closed on missing provenance or wrong name position', function() {
        assert.strictEqual(browserBuilder([{ language: 'de-DE', origin: 'PSV', replace: 'P S V' }])('club', null, 'PSV Bremen', 'control'),
            'Bitte ein Vertreter vom Verein P S V Bremen zur Turnierleitung. Ein Vertreter vom Verein P S V Bremen bitte!');
        const missing = catalogue(); delete missing.origins[missing.pieces[0].id];
        assert.throws(() => registration(missing), /provenance/);
        const wrong = catalogue(); wrong.pieces[0].profile = 'lab-v2/team-after-gegen';
        assert.throws(() => registration(wrong), /first-position/);
        const pronunciation = catalogue(); pronunciation.pronunciation.numbers = 'old';
        assert.throws(() => registration(pronunciation), /Pronunciation/);
    });
});
