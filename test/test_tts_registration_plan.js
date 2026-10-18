'use strict';
const assert = require('assert');
const { Plan } = require('../scripts/tts-context-benchmark-plan');
const { repeatedTeam } = require('../scripts/tts-gameblock-context-plan');
const { browserBuilder, registration } = require('../scripts/tts-registration-plan');
const { lexemes } = require('../scripts/tts-second-call-plan');

function catalogue(normalizations = []) {
    const plan = new Plan(normalizations);
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
    it('uses the repeated-name context for clubs and states while keeping ten common pieces and whole names', function() {
        const old = catalogue(), snapshot = JSON.stringify(old), plan = registration(old);
        assert.strictEqual(JSON.stringify(old), snapshot);
        assert.strictEqual(plan.scope.new_pieces.length, 18);
        assert.strictEqual(Object.keys(plan.scope.fixed_pieces).length, 10);
        assert.strictEqual(new Set(plan.pieces.filter(p => plan.scope.new_pieces.includes(p.id)).map(p => p.source)).size, 6);
        assert.strictEqual(Object.keys(plan.scope.reused_piece_origins).length, 2);
        for (const original of old.pieces) assert.deepStrictEqual(plan.pieces.find(p => p.id === original.id), original);
        for (const kind of ['player', 'pair', 'club', 'state']) {
            const keys = plan.scope.label_pieces[kind], piece = plan.pieces.find(p => p.id === keys[0]);
            assert.strictEqual(keys[0], keys[1]);
            assert.strictEqual(piece.profile, 'lab-v2/team-before-plays');
            assert.strictEqual(piece.before, '');
            assert.strictEqual(piece.after, ' spielt jetzt gegen ' + piece.text + '!');
            assert.strictEqual(plan.sources.find(s => s.id === piece.source).profile, 'lab-v2/team-repeat-plays-now');
        }
        assert.strictEqual(plan.cases.length, 26);
    });
    it('has exact source positions and standalone coverage for every newly cut piece', function() {
        const plan = registration(catalogue());
        for (const piece of plan.pieces) assert.strictEqual(piece.before + piece.text + piece.after, plan.sources.find(s => s.id === piece.source).text);
        const standalone = plan.cases.filter(c => ['piece', 'reference'].includes(c.experiment)).flatMap(c => c.pieces.map(p => p.piece));
        assert.deepStrictEqual(standalone.sort(), [...plan.scope.new_pieces].sort());
        assert.strictEqual(...plan.scope.label_pieces.club);
        assert.strictEqual(...plan.scope.label_pieces.state);
    });
    it('reuses all approved fixed pieces and references, generating only the two missing label contexts', function() {
        const previous = registration(catalogue());
        const labelSources = ['club', 'state'].map(kind => previous.pieces.find(p => p.id === previous.scope.label_pieces[kind][0]).source);
        previous.sources = previous.sources.filter(s => !labelSources.includes(s.id));
        previous.pieces = previous.pieces.filter(p => !labelSources.includes(p.source));
        previous.origins = Object.fromEntries(previous.pieces.map(p => [p.id, { run: '/approved-registration', sha256: 'b'.repeat(64) }]));
        const snapshot = JSON.stringify(previous), updated = registration(previous);
        assert.strictEqual(JSON.stringify(previous), snapshot);
        assert.strictEqual(updated.scope.new_pieces.length, 4);
        assert.strictEqual(updated.scope.new_sources_per_voice, 2);
        assert.strictEqual(Object.keys(updated.scope.reused_piece_origins).length, 16);
        assert.deepStrictEqual(updated.scope.fixed_pieces, previous.scope.fixed_pieces);
        assert.deepStrictEqual(updated.cases.filter(c => c.browser_text).map(c => c.browser_text), previous.cases.filter(c => c.browser_text).map(c => c.browser_text));
        for (const key of Object.keys(updated.scope.reused_piece_origins)) assert.deepStrictEqual(updated.pieces.find(p => p.id === key), previous.pieces.find(p => p.id === key));
        const warm = { ...updated, origins: { ...previous.origins, ...Object.fromEntries(updated.scope.new_pieces.map(k => [k, { run: '/new-labels', sha256: 'c'.repeat(64) }])) } };
        assert.strictEqual(registration(warm).scope.new_pieces.length, 0);
        warm.pieces.find(p => p.id === updated.scope.fixed_pieces.closing).after = 'corrupt';
        assert.throws(() => registration(warm), /exact geometry/);
    });
    it('retains browser normalization and fails closed on missing provenance or wrong name position', function() {
        assert.strictEqual(browserBuilder([{ language: 'de-DE', origin: 'PSV', replace: 'P S V' }])('club', null, 'PSV Bremen', 'control'),
            'Bitte ein Vertreter vom Verein P S V Bremen zur Turnierleitung. Ein Vertreter vom Verein P S V Bremen bitte!');
        const normalized = registration(catalogue([{ language: 'de-DE', origin: 'PSV', replace: 'P S V' }]));
        const club = normalized.pieces.find(p => p.id === normalized.scope.label_pieces.club[0]);
        assert.strictEqual(club.text, 'P S V Bremen'); assert.strictEqual(club.display, 'PSV Bremen');
        const missing = catalogue(); delete missing.origins[missing.pieces[0].id];
        assert.throws(() => registration(missing), /provenance/);
        const wrong = catalogue(); wrong.pieces[0].profile = 'lab-v2/team-after-gegen';
        assert.throws(() => registration(wrong), /first-position/);
        const pronunciation = catalogue(); pronunciation.pronunciation.numbers = 'old';
        assert.throws(() => registration(pronunciation), /Pronunciation/);
    });
});
