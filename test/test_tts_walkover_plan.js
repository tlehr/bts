'use strict';
const assert = require('assert');
const { gameblocks } = require('../scripts/tts-gameblock-context-plan');
const { walkover } = require('../scripts/tts-walkover-plan');

function catalogue() {
    const team = (...names) => ({ players: names.map(name => ({ name })) });
    const plan = gameblocks({}, [
        { id: 'single', label: 'Einzel', setup: { match_num: 161, event_name: 'JE U17', match_name: 'R16', teams: [team('Muhammad Sytsh Abdulquddus'), team('Max Hahn')] } },
        { id: 'double', label: 'Doppel', setup: { match_num: 381, event_name: 'JD U13', match_name: 'R16', teams: [team('Ben Hensel', 'Max Wächtler'), team('Emil Hermann', 'Konrad Wendt')] } },
    ]);
    plan.origins = Object.fromEntries(plan.pieces.map(p => [p.id, { run: '/approved', sha256: 'a'.repeat(64) }]));
    plan.games = plan.cases.filter(c => c.id.endsWith('-two')).map(c => {
        const keys = c.pieces.map(p => p.piece), final = plan.pieces.find(p => p.id === keys.at(-1));
        return { id: c.id, label: c.label, pieces: keys, winning_team_index: 1,
            winner_piece: plan.pieces.find(p => p.source === final.source && p.profile === 'lab-v2/team-after-gegen').id };
    });
    return plan;
}

describe('D12 common clause and after-gegen winner', function() {
    it('uses one new source for both games, preserves all cached game pieces, and reuses the second team without gegen', function() {
        const old = catalogue(), snapshot = JSON.stringify(old), plan = walkover(old);
        assert.strictEqual(JSON.stringify(old), snapshot);
        assert.strictEqual(plan.cases.length, 6);
        assert.strictEqual(plan.scope.new_pieces.length, 2);
        assert.strictEqual(new Set(plan.pieces.filter(p => plan.scope.new_pieces.includes(p.id)).map(p => p.source)).size, 1);
        const clause = plan.pieces.find(p => p.id === plan.scope.clause_piece);
        assert.strictEqual(clause.text, 'Das Spiel geht kampflos an');
        assert.strictEqual(clause.kind, 'generic');
        for (const c of plan.cases.filter(c => ['assembled', 'short'].includes(c.experiment))) {
            assert.strictEqual(c.winning_team_index, 1);
            const winner = plan.pieces.find(p => p.id === c.winner_piece);
            assert.strictEqual(winner.profile, 'lab-v2/team-after-gegen');
            assert(!winner.text.startsWith('gegen '));
            assert.strictEqual(winner.before, winner.text + ' spielt jetzt gegen ');
            assert.strictEqual(c.pieces.at(-2).piece, clause.id);
            assert.strictEqual(c.pieces.at(-1).piece, winner.id);
            assert(!c.display.includes('Auf Spielfeld'));
        }
        assert(plan.cases.find(c => c.id === 'single-two-assembled').display.endsWith('Das Spiel geht kampflos an Max Hahn!'));
        assert(plan.cases.find(c => c.id === 'double-two-assembled').display.endsWith('Das Spiel geht kampflos an Emil Hermann und Konrad Wendt!'));
        for (const id of Object.keys(plan.scope.reused_piece_origins)) assert.deepStrictEqual(plan.pieces.find(p => p.id === id), old.pieces.find(p => p.id === id));
    });
    it('generates spelled numbers in context, retains numeric display, and preserves exact source substrings', function() {
        const plan = walkover(catalogue());
        const source = plan.sources.find(s => s.profile === 'lab-v2/walkover-context');
        assert(source.text.startsWith('Spielnummer einhunderteinundsechzig. Jungen Einzel U siebzehn.'));
        assert(!/\d/.test(source.text));
        assert(plan.cases.find(c => c.experiment === 'assembled').display.startsWith('Spielnummer 161.'));
        for (const p of plan.pieces) assert.strictEqual(p.before + p.text + p.after, plan.sources.find(s => s.id === p.source).text);
        assert.strictEqual(plan.scope.result_words_match_browser, true);
    });
    it('rejects the first occurrence, a winner with gegen, missing provenance and wrong winning side', function() {
        const first = catalogue();
        const winner = first.pieces.find(p => p.id === first.games[0].winner_piece);
        winner.profile = 'lab-v2/team-before-plays';
        assert.throws(() => walkover(first), /second-position/);
        const withAgainst = catalogue();
        withAgainst.games[0].winner_piece = withAgainst.games[0].pieces.at(-1);
        assert.throws(() => walkover(withAgainst), /second-position/);
        const missing = catalogue(); delete missing.origins[missing.games[0].winner_piece];
        assert.throws(() => walkover(missing), /provenance/);
        const side = catalogue(); side.games[0].winning_team_index = 0;
        assert.throws(() => walkover(side), /second team/);
    });
    it('rejects legacy plans and changed pronunciation identities', function() {
        assert.throws(() => walkover({ strategy: 'v1' }), /v2/);
        const wrong = catalogue(); wrong.pronunciation.numbers = 'old';
        assert.throws(() => walkover(wrong), /Pronunciation/);
    });
});
