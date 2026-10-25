'use strict';
const assert = require('assert');
const { officialRoles } = require('../scripts/tts-official-role-plan');

describe('Shared B08 official role hearing plan', function() {
    const existing = () => ({ strategy: 'bts-context-v2-lab-only', pronunciation: { normalizations: [] },
        sources: [{ id: 'name', text: 'Hans Dampf spielt jetzt gegen Hans Dampf!' }],
        pieces: [{ id: 'second', source: 'name', before: 'Hans Dampf spielt jetzt gegen ',
            text: 'Hans Dampf', after: '!', kind: 'team', profile: 'lab-v2/team-after-gegen' }] });
    it('uses three fluent contexts, one excerpt per role and no new individual or doubles sources', function() {
        const value = existing(), snapshot = JSON.stringify(value), result = officialRoles(value);
        assert.strictEqual(JSON.stringify(value), snapshot);
        assert.deepStrictEqual(result.sources.map(s => s.text), ['Der Schiedsrichter ist Hans Dampf.',
            'Der Aufschlagrichter ist Hans Dampf.', 'Die Klapptafelbedienung übernimmt Hans Dampf.']);
        assert.strictEqual(result.pieces.filter(p => p.kind === 'generic').length, 3);
        assert.strictEqual(result.scope.new_sources_per_voice, 3);
        assert(result.scope.names_from_existing_team_audio && result.scope.accepted_tablet_audio_unchanged);
        assert(!result.pieces.some(p => p.kind === 'team' || p.text === 'Tabletbedienung'));
        for (const p of result.pieces) assert.strictEqual(p.before + p.text + p.after,
            result.sources.find(s => s.id === p.source).text);
        assert(result.cases.every(c => c.subjective_quality === 'not-rated'));
    });
    it('refuses legacy plans, incomplete teams and incorrect source bindings', function() {
        assert.throws(() => officialRoles({ strategy: 'v1' }), /v2/);
        const missing = existing(); missing.pieces = [];
        assert.throws(() => officialRoles(missing), /complete individual team/);
        const bad = existing(); bad.sources[0].text += 'Anders';
        assert.throws(() => officialRoles(bad), /complete individual team/);
    });
});
