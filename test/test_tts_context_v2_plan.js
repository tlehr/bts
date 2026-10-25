'use strict';

const assert = require('assert');
const { baseline } = require('../scripts/tts-context-benchmark-plan');
const { experiments, inventory, warmChange } = require('../scripts/tts-context-v2-plan');
const team = (...names) => ({ players: names.map(name => ({ name })) });
const tournament = () => ({ normalizations: [], annoncement_include_event: true,
    annoncement_include_round: true, annoncement_include_matchnumber: true, matches: [
        { _id: 'real-double', setup: { is_match: true, event_name: 'JD U17', match_name: 'R16', match_num: 30,
            teams: [team('Klara Nord', 'Erika Süd'), team('Mia West', 'Anna Ost')] } },
        { _id: 'real-single', setup: { is_match: true, event_name: 'JE U17', match_name: 'R16', match_num: 31,
            teams: [team('Mika Sisic'), team('Milo Ebeling')] } },
    ] });

describe('Laboratory-only context v2 plans', function() {
    it('shares one repeated-name synthesis for both positions and keeps each complete name and team intact', function() {
        const plan = experiments(tournament(), baseline());
        assert.strictEqual(plan.production_strategy, 'bts-context-v1');
        const dual = plan.sources.filter(source => source.profile === 'lab-v2/name-dual-position');
        assert.strictEqual(dual.length, 3);
        assert(dual.some(source => source.text === 'Max Emil Mustermann gegen Max Emil Mustermann.'));
        const sources = new Map(plan.sources.map(source => [source.id, source]));
        for (const piece of plan.pieces) assert.strictEqual(piece.before + piece.text + piece.after, sources.get(piece.source).text);
        const names = plan.pieces.filter(piece => piece.profile.startsWith('lab-v2/name-') && piece.text === 'Max Emil Mustermann');
        assert.strictEqual(names.length, 2);
        assert.notStrictEqual(names[0].id, names[1].id, 'prosodic positions must never share the same key');
        assert.strictEqual(names[0].source, names[1].source, 'one source supplies both complete positions');
        assert.strictEqual(plan.scope.B.real_match, 'real-double');
        assert.strictEqual(plan.scope.B.no_individual_name_splits, true);
        const teams = plan.sources.filter(source => source.profile === 'lab-v2/team-dual-position');
        assert.strictEqual(teams.length, 2);
        assert(teams.some(source => source.text === 'Klara Nord und Erika Süd gegen Klara Nord und Erika Süd.'));
        assert(plan.cases.some(item => item.id === 'C-1-reused-round'));
        assert(!plan.cases.some(item => /D13|D15/.test(item.id)));
    });

    it('does not invent doubles when no actual partnership is supplied and labels unmeasured inventory honestly', function() {
        const plan = experiments({ normalizations: [], matches: [] }, baseline());
        assert.strictEqual(plan.scope.B, 'skipped: no actual doubles game');
        assert(!plan.cases.some(item => item.experiment === 'B'));
        const current = tournament();
        current.matches.push({ _id: 'unknown', setup: { teams: [team('Bekannt'), { players: [] }] } });
        const counts = inventory(current);
        assert.strictEqual(counts.known_games, 2);
        assert.strictEqual(counts.unknown_or_unusable_games, 1);
        assert.strictEqual(counts.unique_v1_sources, 2);
        assert.strictEqual(counts.hypothetical_v2_sources, 6);
        assert.strictEqual(counts.cold_inference_seconds, null);
        assert(counts.source_texts.v2_headers.every(text => !/\d/.test(text)));
    });

    it('changes only the representative team composition while reusing the known header and name positions', function() {
        const existing = experiments(tournament(), baseline());
        const changed = warmChange(existing);
        assert.strictEqual(changed.cases.length, 3);
        const before = new Set(existing.sources.map(item => item.id));
        assert.strictEqual(changed.sources.filter(item => !before.has(item.id)).length, 1, 'only the full reference needs a new source');
        const pieces = new Map(changed.pieces.map(item => [item.id, item]));
        const text = changed.cases[2].pieces.map(item => pieces.get(item.piece).text).join(' ');
        assert(text.includes('Max Emil Mustermann gegen Max Mustermann.'));
        assert(text.includes('Spiel Nummer einunddreißig.'));
        assert(text.includes('Jungeneinzel U siebzehn.'));
        assert.strictEqual(changed.expected_new_source_counts_when_primed.v2_assembly, 0);
    });
});
