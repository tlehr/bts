'use strict';

// Explicit v2 demand only: prepare assigned officials, never the entire roster.
const fs = require('fs');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');
const { Plan, digest } = require('./tts-context-benchmark-plan');
const { repeatedTeam } = require('./tts-gameblock-context-plan');

function officialNames(existing, requests) {
    if (existing.strategy !== 'bts-context-v2-lab-only' || !Array.isArray(requests)) throw new Error('A v2 plan and explicit official requests are required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    if (digest(plan.export().pronunciation) !== digest(existing.pronunciation)) throw new Error('Name pronunciation identities must match');
    const texts = create({ tournament: { normalizations: plan.normalizations },
        translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, announce: () => {} });
    const entries = new Map();
    for (const request of requests) {
        const setup = request.setup || request;
        if (setup.is_match === false) continue;
        for (const [field, role] of [['umpire', 'umpire'], ['service_judge', 'service']]) {
            const raw = setup[field]?.name;
            if (typeof raw !== 'string' || !raw.trim()) continue;
            const display = raw.trim(), spoken = spellNumbers(texts.normalizeNames(display));
            if (!spoken.trim()) continue;
            if (!entries.has(spoken)) {
                const full = `${spoken} spielt jetzt gegen ${spoken}!`;
                const cached = existing.pieces.find(p => p.kind === 'team' && p.profile === 'lab-v2/team-after-gegen' &&
                    p.text === spoken && p.before === `${spoken} spielt jetzt gegen ` && p.after === '!' &&
                    existing.sources.some(s => s.id === p.source && s.profile === 'lab-v2/team-repeat-plays-now' && s.text === full));
                let piece;
                if (cached) {
                    plan.sources.set(cached.source, { ...existing.sources.find(s => s.id === cached.source) });
                    plan.pieces.set(cached.id, { ...cached }); piece = cached.id;
                } else piece = repeatedTeam(plan, spoken, display, ['second']).second;
                const id = 'official-name-' + digest(spoken).slice(0, 20);
                entries.set(spoken, { display, spoken, piece, source: plan.pieces.get(piece).source,
                    existing_piece: !!cached, roles: [], requests: [] });
                plan.cases.push({ id, experiment: 'name', label: display + ' · vollständiger Offiziellenname',
                    display, pieces: [{ piece, pause_ms: 0 }], subjective_quality: 'not-rated' });
            }
            const entry = entries.get(spoken);
            if (!entry.roles.includes(role)) entry.roles.push(role);
            entry.requests.push({ role, display, match_id: request._id || null });
        }
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.scope = { purpose: 'On-demand official names, shared with player-name sources; no production switch',
        official_names: [...entries.values()], name_context: '[Name] spielt jetzt gegen [Name]!',
        excerpt_position: 'second, without gegen', role_independent: true, explicit_requests_only: true,
        source_plan_sha256: digest(existing), sources_not_in_existing_plan: [...entries.values()].filter(e => !e.existing_piece).length,
        existing_name_sources: [...entries.values()].filter(e => e.existing_piece).length,
        no_individual_extraction_from_doubles: true, production_strategy_unchanged: true };
    return result;
}

if (require.main === module) process.stdout.write(JSON.stringify(officialNames(
    JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))), null, 2) + '\n');
module.exports = { officialNames };
