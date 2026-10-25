'use strict';
const assert = require('assert');
const { gameblocks } = require('../scripts/tts-gameblock-context-plan');
const { officialNames } = require('../scripts/tts-official-name-plan');

const team = (...names) => ({ players: names.map(name => ({ name })) });
const existing = (normalizations = [], teams = [team('Hans Dampf'), team('Andere Person')]) => gameblocks({ normalizations }, [
    { id: 'actual', label: 'Actual', setup: { match_num: 1, event_name: 'JE U17', match_name: 'R16', teams } },
]);

describe('Demand-driven v2 official names', function() {
    it('shares one new source across roles and games and preserves an existing player-name excerpt exactly', function() {
        const base = existing(), snapshot = JSON.stringify(base);
        const plan = officialNames(base, [
            { _id: 'one', setup: { umpire: { name: 'Max Mustermann' }, service_judge: { name: 'Hans Dampf' } } },
            { _id: 'two', setup: { service_judge: { name: 'Max Mustermann' }, umpire: { name: 'Max Mustermann' } } },
        ]);
        assert.strictEqual(JSON.stringify(base), snapshot);
        assert.strictEqual(plan.sources.length, 2);
        assert.strictEqual(plan.pieces.length, 2, 'only the required second positions are prepared');
        assert.strictEqual(plan.scope.sources_not_in_existing_plan, 1);
        const tim = plan.scope.official_names.find(n => n.spoken === 'Max Mustermann');
        assert.deepStrictEqual(tim.roles, ['umpire', 'service']);
        assert.strictEqual(tim.requests.length, 3);
        const max = plan.scope.official_names.find(n => n.spoken === 'Hans Dampf');
        const cached = base.pieces.find(p => p.text === 'Hans Dampf' && p.profile === 'lab-v2/team-after-gegen');
        assert.deepStrictEqual(plan.pieces.find(p => p.id === max.piece), cached);
        assert(plan.sources.some(s => s.text === 'Max Mustermann spielt jetzt gegen Max Mustermann!'));
        for (const p of plan.pieces) {
            assert.strictEqual(p.before, p.text + ' spielt jetzt gegen ');
            assert.strictEqual(p.after, '!');
        }
    });
    it('applies the same pronunciation rules and number spelling as players while retaining displays', function() {
        const base = existing([{ language: 'de-DE', origin: 'Mueller', replace: 'Müller' }], [team('Müller 2'), team('Andere')]);
        const result = officialNames(base, [{ umpire: { name: 'Mueller 2' }, service_judge: { name: 'Müller 2' } }]);
        assert.strictEqual(result.sources.length, 1);
        assert.strictEqual(result.scope.official_names[0].spoken, 'Müller zwei');
        assert.strictEqual(result.scope.official_names[0].display, 'Mueller 2');
        assert(result.scope.official_names[0].existing_piece);
        assert.strictEqual(result.sources[0].profile, 'lab-v2/team-repeat-plays-now');
    });
    it('does not extract an individual from a doubles context or import unrelated roster names', function() {
        const result = officialNames(existing([], [team('Hans Dampf', 'Partner Eins'), team('Andere', 'Partner Zwei')]),
            [{ umpire: { name: 'Hans Dampf' } }]);
        assert.strictEqual(result.sources.length, 1);
        assert.strictEqual(result.sources[0].text, 'Hans Dampf spielt jetzt gegen Hans Dampf!');
        assert.strictEqual(result.scope.sources_not_in_existing_plan, 1);
        assert(!result.sources[0].text.includes('Partner'));
    });
    it('never schedules placeholders or names without an actual request', function() {
        const plan = officialNames(existing(), [{}, { umpire: null, service_judge: { name: ' ' } },
            { is_match: false, umpire: { name: 'Not needed' } }]);
        assert.strictEqual(plan.sources.length, 0);
        assert.strictEqual(plan.cases.length, 0);
        assert.strictEqual(plan.scope.explicit_requests_only, true);
    });
    it('refuses a different pronunciation identity and does not reuse a name from a different context', function() {
        assert.throws(() => officialNames({ strategy: 'v1' }, []), /v2/);
        const wrong = existing(); wrong.pronunciation.numbers = 'outdated';
        assert.throws(() => officialNames(wrong, []), /pronunciation/);
        const bad = existing();
        const piece = bad.pieces.find(p => p.text === 'Hans Dampf' && p.profile === 'lab-v2/team-after-gegen');
        bad.sources.find(s => s.id === piece.source).text = 'Different context';
        assert.strictEqual(officialNames(bad, [{ umpire: { name: 'Hans Dampf' } }]).scope.sources_not_in_existing_plan, 1);
    });
});
