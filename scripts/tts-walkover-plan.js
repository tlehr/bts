'use strict';

// D12 hearing trial: reuse the complete game and the right team's after-gegen position.
const fs = require('fs');
const { _translate: translate } = require('../static/js/ci18n');
const { Plan, digest } = require('./tts-context-benchmark-plan');
const { lexemes } = require('./tts-second-call-plan');

function walkover(existing) {
    if (existing.strategy !== 'bts-context-v2-lab-only' || !existing.games?.length) throw new Error('An explicit v2 game catalogue is required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    if (digest(plan.export().pronunciation) !== digest(existing.pronunciation)) throw new Error('Pronunciation identities must match');
    const origins = {}, samples = [];
    const take = key => {
        const part = existing.pieces.find(p => p.id === key), source = part && existing.sources.find(s => s.id === part.source);
        if (!source || part.before + part.text + part.after !== source.text || !existing.origins?.[key]) throw new Error('Complete prepared pieces with provenance are required');
        plan.sources.set(source.id, { ...source }); plan.pieces.set(key, { ...part }); origins[key] = existing.origins[key];
        return part;
    };
    for (const game of existing.games) {
        if (game.winning_team_index !== 1 || game.pieces.length !== 5) throw new Error('These samples must use the second team as winner');
        const pieces = game.pieces.map(take), winner = take(game.winner_piece);
        if (!pieces.every((p, i) => p.profile === ['lab-v2/B03', 'lab-v2/B04', 'lab-v2/B05', 'lab-v2/team-before-plays', 'lab-v2/team-after-with-gegen'][i]) ||
                winner.profile !== 'lab-v2/team-after-gegen' || winner.kind !== 'team' ||
                winner.before !== winner.text + ' spielt jetzt gegen ' || winner.after !== '!' ||
                pieces[4].text !== 'gegen ' + winner.text || pieces[4].source !== winner.source) {
            throw new Error('Winner must be the complete second-position team, without gegen, from its repeated-team source');
        }
        const team1 = pieces[3].text, team2 = winner.text;
        const rendered = translate('de', 'announcements:no_match_win:teams', { team1, team2, winner: team2 });
        const before = team1 + ' gegen ' + team2 + '. ', ending = team2 + '!';
        if (!rendered.startsWith(before) || !rendered.endsWith(ending)) throw new Error('The German walkover template must retain both teams and its winner');
        const clause = rendered.slice(before.length, -ending.length).trim();
        if (clause !== 'Das Spiel geht kampflos an') throw new Error('Unexpected walkover clause');
        const body = pieces.slice(0, 2).map(p => p.text + '.').join(' ') + ' ' + pieces[2].text + ' ' + team1 + ' gegen ' + team2 + '.';
        const display = pieces.slice(0, 2).map(p => p.display + '.').join(' ') + ' ' + pieces[2].display + ' ' +
            pieces[3].display + ' gegen ' + winner.display + '.';
        samples.push({ id: game.id, label: game.label, pieces, winner, body, display, clause,
            result: rendered, winning_team_index: 1 });
    }
    const donor = samples.find(s => !s.winner.text.includes(' und ')) || samples[0];
    const full = donor.body + ' ' + donor.clause + ' ' + donor.winner.text + '!';
    const source = plan.source(full, 'lab-v2/walkover-context');
    const addPiece = (text, before, after, profile, kind) => {
        const value = { source, before, text, after, kind, profile, display: text }, id = 'p-' + digest(value).slice(0, 20);
        plan.pieces.set(id, { id, ...value }); return id;
    };
    const clause = addPiece(donor.clause, donor.body + ' ', ' ' + donor.winner.text + '!', 'lab-v2/D12-clause', 'generic');
    const reference = addPiece(full, '', '', 'lab-v2/walkover-full-reference', 'game');
    for (const sample of samples) {
        const gameKeys = sample.pieces.map(p => p.id);
        for (const [group, keys, pauses, display] of [
            ['assembled', [...gameKeys, clause, sample.winner.id], [250, 250, 250, 60, 300, 100, 0],
                sample.display + ' ' + sample.clause + ' ' + sample.winner.display + '!'],
            ['short', [clause, sample.winner.id], [100, 0], sample.clause + ' ' + sample.winner.display + '!'],
        ]) {
            const tail = gameKeys.slice(-2).map(k => plan.pieces.get(k).text).join(' ') + '. ' + sample.clause + ' ' + sample.winner.text;
            if (lexemes(tail) !== lexemes(sample.result)) throw new Error('Walkover words differ from the existing browser template');
            plan.cases.push({ id: sample.id + '-' + group, experiment: group, label: sample.label + (group === 'short' ? ' · Kampflos-Satz allein' : ' · vollständige D12'),
                display, winning_team_index: 1, winner_piece: sample.winner.id,
                pieces: keys.map((piece, i) => ({ piece, pause_ms: pauses[i] })), subjective_quality: 'not-rated' });
        }
    }
    for (const [id, group, key, label] of [['walkover-clause', 'piece', clause, 'Gemeinsame Kampflos-Formulierung'],
        ['walkover-context', 'reference', reference, 'Vollständiger Generierungskontext']]) {
        plan.cases.push({ id, experiment: group, label, display: plan.pieces.get(key).text,
            pieces: [{ piece: key, pause_ms: 0 }], subjective_quality: 'not-rated' });
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only'; result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.scope = { purpose: 'D12 hearing trial only; no production switch', new_pieces: [clause, reference], reused_piece_origins: origins,
        clause_piece: clause, winner_position: 'second occurrence after gegen, without gegen', winning_team_index: 1,
        games: samples.map(s => ({ id: s.id, label: s.label, game_pieces: s.pieces.map(p => p.id), winner_piece: s.winner.id })),
        new_sources_per_voice: 1, no_new_name_sources: true, game_pieces_unchanged: true,
        game_to_clause_pause_ms: 300, clause_to_winner_pause_ms: 100, existing_gameblock_wording_unchanged: true,
        result_words_match_browser: true };
    return result;
}

if (require.main === module) process.stdout.write(JSON.stringify(walkover(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2) + '\n');
module.exports = { walkover };
