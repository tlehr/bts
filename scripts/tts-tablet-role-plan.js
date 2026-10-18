'use strict';

// B08 trial: one shared role recording; existing team audio supplies every name.
const fs = require('fs');
const { Plan, digest } = require('./tts-context-benchmark-plan');
const ROLE = 'Tabletbedienung:';
const PREFIX = 'Auf Spielfeld acht! Zweiter Aufruf für:';

function tabletRole(existing, { natural = false } = {}) {
    if (existing.strategy !== 'bts-context-v2-lab-only') throw new Error('An existing v2 team plan is required');
    const teams = existing.pieces.filter(p => p.profile === 'lab-v2/team-after-gegen');
    const team = natural ? teams.filter(p => !p.text.includes(' und ')).sort((a, b) => a.text.length - b.text.length)[0] :
        teams.find(p => p.text.includes(' und '));
    const source = team && existing.sources.find(s => s.id === team.source);
    if (!source || team.before + team.text + team.after !== source.text) throw new Error('An actual complete doubles team is required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    const text = natural ? 'Die Tabletbedienung übernimmt ' + team.text + '.' : PREFIX + ROLE + team.text;
    const donor = plan.source(text, natural ? 'lab-v2/tablet-role-natural-reference' : 'lab-v2/tablet-role-reference');
    function piece(before, spoken, after, profile, kind = 'generic') {
        const value = { source: donor, before, text: spoken, after, kind, profile, display: spoken };
        const id = 'p-' + digest(value).slice(0, 20);
        plan.pieces.set(id, { id, ...value }); return id;
    }
    for (const [id, label, group, key] of [
        ['tablet-role', 'B08 · gemeinsame Rollenbezeichnung', 'role', natural ?
            piece('Die ', 'Tabletbedienung', ' übernimmt ' + team.text + '.', 'lab-v2/B08-role') :
            piece(PREFIX, ROLE, team.text, 'lab-v2/B08-role')],
        ...(!natural ? [['tablet-prefix', 'B11 · Zweiter Aufruf für', 'prefix', piece('Auf Spielfeld acht! ', 'Zweiter Aufruf für:', ROLE + team.text, 'lab-v2/B11-normal')]] : []),
        ['tablet-reference', 'Vollständiger Generierungskontext', 'reference', piece('', text, '', 'lab-v2/role-full-reference', 'game')],
    ]) plan.cases.push({ id, label, experiment: group, display: plan.pieces.get(key).text,
        pieces: [{ piece: key, pause_ms: 0 }], subjective_quality: 'not-rated' });
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.scope = { purpose: 'Shared B08 role plus cached teams; hearing trial only',
        preferred_variant: 2, new_sources_per_voice: 1, role: ROLE, context_mode: natural ? 'natural' : 'second-call', donor_team: team.text,
        donor_team_piece: team.id, source_team_plan_sha256: digest(existing),
        names_from_existing_team_audio: true, role_shared_across_names_games_courts: true,
        role_to_name_pause_ms: 80, production_strategy_unchanged: true };
    return result;
}

if (require.main === module) process.stdout.write(JSON.stringify(tabletRole(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), { natural: process.argv.includes('--natural') }), null, 2) + '\n');
module.exports = { tabletRole, ROLE, PREFIX };
