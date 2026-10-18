'use strict';
const assert = require('assert');
const { tabletRole, ROLE, PREFIX } = require('../scripts/tts-tablet-role-plan');

describe('Shared B08 role hearing plan', function() {
    const existing = () => ({ strategy: 'bts-context-v2-lab-only', pronunciation: { normalizations: [] },
        sources: [{ id: 'team', text: 'Eins und Zwei spielt jetzt gegen Eins und Zwei!' }],
        pieces: [{ id: 'second', source: 'team', before: 'Eins und Zwei spielt jetzt gegen ',
            text: 'Eins und Zwei', after: '!', kind: 'team', profile: 'lab-v2/team-after-gegen' }] });
    it('generates one shared role context and obtains the second-call prefix without another source', function() {
        const original = existing(), snapshot = JSON.stringify(original), plan = tabletRole(original);
        assert.strictEqual(JSON.stringify(original), snapshot);
        assert.strictEqual(plan.sources.length, 1);
        assert.strictEqual(plan.sources[0].text, PREFIX + ROLE + 'Eins und Zwei');
        const role = plan.pieces.find(p => p.profile === 'lab-v2/B08-role');
        assert.strictEqual(role.text, ROLE);
        assert.strictEqual(role.before + role.text + role.after, plan.sources[0].text);
        assert.strictEqual(plan.scope.preferred_variant, 2);
        assert.strictEqual(plan.scope.names_from_existing_team_audio, true);
        assert.strictEqual(plan.pieces.filter(p => p.kind === 'team').length, 0, 'names are reused, never synthesized separately');
        assert(plan.pieces.every(p => p.source === role.source));
        assert(plan.cases.every(c => c.subjective_quality === 'not-rated'));
    });
    it('requires a real complete v2 team and an exact source binding', function() {
        assert.throws(() => tabletRole({ strategy: 'v1' }), /v2/);
        const missing = existing(); missing.pieces = [];
        assert.throws(() => tabletRole(missing), /complete doubles team/);
        const bad = existing(); bad.sources[0].text += 'Andere';
        assert.throws(() => tabletRole(bad), /complete doubles team/);
    });
    it('can use a fluent short context while leaving cached team names independent', function() {
        const value = existing();
        value.sources.push({ id: 'single', text: 'Max Hahn spielt jetzt gegen Max Hahn!' });
        value.pieces.push({ id: 'name', source: 'single', before: 'Max Hahn spielt jetzt gegen ',
            text: 'Max Hahn', after: '!', kind: 'team', profile: 'lab-v2/team-after-gegen' });
        const plan = tabletRole(value, { natural: true });
        assert.strictEqual(plan.sources.length, 1);
        assert.strictEqual(plan.sources[0].text, 'Die Tabletbedienung übernimmt Max Hahn.');
        const role = plan.pieces.find(p => p.profile === 'lab-v2/B08-role');
        assert.strictEqual(role.before, 'Die ');
        assert.strictEqual(role.text, 'Tabletbedienung');
        assert.strictEqual(role.after, ' übernimmt Max Hahn.');
        assert(!plan.pieces.some(p => p.profile === 'lab-v2/B11-normal'));
        assert.strictEqual(plan.scope.names_from_existing_team_audio, true);
    });
});
