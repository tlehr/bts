'use strict';

// Continue B08 with reusable role excerpts, preserving the approved tablet clips.
const fs = require('fs');
const { Plan, digest } = require('./tts-context-benchmark-plan');

const ROLES = [
    { id: 'umpire', text: 'Schiedsrichter', before: 'Der ', after: name => ' ist ' + name + '.' },
    { id: 'service', text: 'Aufschlagrichter', before: 'Der ', after: name => ' ist ' + name + '.' },
    { id: 'board', text: 'Klapptafelbedienung', before: 'Die ', after: name => ' übernimmt ' + name + '.' },
];

function officialRoles(existing) {
    if (existing.strategy !== 'bts-context-v2-lab-only') throw new Error('An existing v2 team plan is required');
    const team = existing.pieces.filter(p => p.profile === 'lab-v2/team-after-gegen' && !p.text.includes(' und '))
        .sort((a, b) => a.text.length - b.text.length)[0];
    const donor = team && existing.sources.find(s => s.id === team.source);
    if (!donor || team.before + team.text + team.after !== donor.text) throw new Error('An actual complete individual team is required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    for (const role of ROLES) {
        const after = role.after(team.text), full = role.before + role.text + after;
        const source = plan.source(full, 'lab-v2/role-natural-reference/' + role.id);
        for (const [kind, before, text, end, profile] of [
            ['role', role.before, role.text, after, 'lab-v2/B08-role-' + role.id],
            ['reference', '', full, '', 'lab-v2/role-full-reference'],
        ]) {
            const value = { source, before, text, after: end, kind: kind === 'role' ? 'generic' : 'game', profile, display: text };
            const id = 'p-' + digest(value).slice(0, 20);
            plan.pieces.set(id, { id, ...value });
            plan.cases.push({ id: role.id + '-' + kind, role: role.id, experiment: kind,
                label: role.text + (kind === 'role' ? ' · gemeinsames Rollenstück' : ' · vollständiger Kontext'),
                display: text, pieces: [{ piece: id, pause_ms: 0 }], subjective_quality: 'not-rated' });
        }
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.scope = { purpose: 'Shared B08 officials and counting-board roles, lab only', preferred_variant: 2,
        roles: ROLES.map(r => r.text), new_sources_per_voice: ROLES.length, donor_team: team.text,
        source_team_plan_sha256: digest(existing), names_from_existing_team_audio: true,
        role_to_name_pause_ms: 80, accepted_tablet_audio_unchanged: true, production_strategy_unchanged: true };
    return result;
}

if (require.main === module) process.stdout.write(JSON.stringify(officialRoles(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2) + '\n');
module.exports = { officialRoles, ROLES };
