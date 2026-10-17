'use strict';

const assert = require('assert');
const { gameblocks, disciplinePronunciationTrials } = require('../scripts/tts-gameblock-context-plan');
const team = (...names) => ({ players: names.map(name => ({ name })) });
const sample = (id, number, teams) => ({ id, label: id, origin: 'test fixture',
    setup: { match_num: number, event_name: 'ME U19', match_name: 'R16', teams } });

describe('Requested context game-block listening plan', function() {
    it('cuts numbers and disciplines from context, generates rounds directly and keeps the team positions distinct', function() {
        const plan = gameblocks({}, [sample('one', 189, [team('Nina Keo Boun Khoune'), team('LeandraGalowicz')])]);
        assert.strictEqual(plan.strategy, 'bts-context-v2-lab-only');
        assert.strictEqual(plan.production_strategy, 'bts-context-v1');
        const pieces = new Map(plan.pieces.map(piece => [piece.id, piece]));
        const sources = new Map(plan.sources.map(source => [source.id, source]));
        assert(plan.sources.some(source => source.text === 'Spielnummer einhundertneunundachtzig ist als nächstes an der Reihe.'));
        assert(!plan.sources.some(source => source.text === 'Spielnummer einhundertneunundachtzig.'));
        assert(plan.sources.some(source => source.text === 'Im Mädchen Einzel U neunzehn erwarten wir spannende Spiele!'));
        assert(plan.sources.some(source => source.text === 'Achtelfinale!'));
        for (const piece of pieces.values()) assert.strictEqual(piece.before + piece.text + piece.after, sources.get(piece.source).text);
        const number = plan.pieces.find(piece => piece.profile === 'lab-v2/B03');
        assert.strictEqual(number.before, '');
        assert.strictEqual(number.text, 'Spielnummer einhundertneunundachtzig');
        assert.strictEqual(number.after, ' ist als nächstes an der Reihe.');
        assert.strictEqual(number.display, 'Spielnummer 189');
        const event = plan.pieces.find(piece => piece.profile === 'lab-v2/B04');
        assert.strictEqual(event.before, 'Im ');
        assert.strictEqual(event.text, 'Mädchen Einzel U neunzehn');
        assert.strictEqual(event.after, ' erwarten wir spannende Spiele!');
        assert.strictEqual(event.display, 'Mädcheneinzel U19');
        const positions = plan.pieces.filter(piece => piece.text === 'Nina Keo Boun Khoune');
        assert.strictEqual(positions.length, 2);
        assert.notStrictEqual(positions[0].id, positions[1].id);
        assert.strictEqual(positions[0].source, positions[1].source);
        assert.strictEqual(plan.cases[0].pieces.length, 5);
        assert.strictEqual(plan.cases[1].pieces.length, 6);
        assert(plan.cases.every(item => !item.pieces.some(entry => pieces.get(entry.piece).text.includes('Wir rufen auf'))));
        assert(plan.cases.every(item => !item.pieces.some(entry => pieces.get(entry.piece).text.includes('erwarten wir spannende Spiele'))));
        assert(plan.cases.every(item => !item.pieces.some(entry => pieces.get(entry.piece).text.includes('ist als nächstes'))));
        assert(plan.sources.every(source => !/\d/.test(source.text)));
    });

    it('shares round, discipline and team sources across games, preserves complete doubles and applies actual name rules', function() {
        const teams = [team('Alex Nord', 'Robin Wächtler'), team('Kim Ost', 'Erik Süd')];
        const plan = gameblocks({ normalizations: [{ language: 'de-DE', origin: 'Wächtler', replace: 'Wächtla' }] },
            [sample('one', 381, teams), sample('two', 382, teams)]);
        assert.strictEqual(plan.sources.length, 6, 'two numbers + one event + one round + two team contexts');
        const repeat = plan.sources.filter(source => source.profile === 'lab-v2/team-repeat-no-punctuation');
        assert.strictEqual(repeat.length, 2);
        assert(repeat.some(source => source.text === 'Alex Nord und Robin Wächtla gegen Alex Nord und Robin Wächtla'));
        assert(repeat.every(source => !/[.!?]$/.test(source.text)));
        assert(plan.cases.some(item => item.display.includes('Robin Wächtler')));
        assert(!plan.pieces.some(piece => piece.text === 'Robin Wächtla'));
        assert.throws(() => gameblocks({}, [sample('missing', 7, [team('Known'), team('')])]), /complete actual teams/);
    });

    it('compares one intact discipline with hyphen and space while preserving the original source cache and display', function() {
        const setup = sample('doubles', 381, [team('Alex Nord', 'Robin West'), team('Kim Ost', 'Erik Süd')]);
        setup.setup.event_name = 'JD U13';
        const existing = gameblocks({}, [setup]);
        const snapshot = JSON.stringify(existing);
        const trials = disciplinePronunciationTrials(existing);
        assert.strictEqual(JSON.stringify(existing), snapshot);
        assert.strictEqual(trials.sources.length, 3);
        assert.strictEqual(trials.pieces.length, 3);
        assert.strictEqual(trials.cases.length, 3);
        assert.deepStrictEqual(trials.pronunciation, existing.pronunciation, 'other pronunciation rules keep their cache identity');
        const original = existing.pieces.find(piece => piece.profile === 'lab-v2/B04');
        assert.strictEqual(trials.pieces[2].id, original.id, 'reuse the current space spelling');
        assert(trials.sources.some(source => source.text === 'Im Jungendoppel U dreizehn erwarten wir spannende Spiele!'));
        assert(trials.sources.some(source => source.text === 'Im Jungen-Doppel U dreizehn erwarten wir spannende Spiele!'));
        assert(trials.sources.some(source => source.text === 'Im Jungen Doppel U dreizehn erwarten wir spannende Spiele!'));
        for (const piece of trials.pieces) {
            assert.strictEqual(piece.display, 'Jungendoppel U13');
            assert.strictEqual(piece.before, 'Im ');
            assert.strictEqual(piece.after, ' erwarten wir spannende Spiele!');
        }
        assert(trials.cases.every(item => item.display === 'Jungendoppel U13' && item.pieces.length === 1));
        const fromJoinedRecording = disciplinePronunciationTrials(trials);
        assert.strictEqual(fromJoinedRecording.pieces[0].id, trials.pieces[0].id, 'retain cache reuse for historical joined recordings');
        assert.throws(() => disciplinePronunciationTrials(existing, 'Unknown'), /No matching discipline/);
    });

    it('separates every German discipline compound only in B04 speech, keeping names and display intact', function() {
        for (const [code, display, spoken] of [
            ['JE', 'Jungeneinzel', 'Jungen Einzel'], ['JD', 'Jungendoppel', 'Jungen Doppel'],
            ['ME', 'Mädcheneinzel', 'Mädchen Einzel'], ['MD', 'Mädchendoppel', 'Mädchen Doppel'],
            ['HE', 'Herreneinzel', 'Herren Einzel'], ['HD', 'Herrendoppel', 'Herren Doppel'],
            ['DE', 'Dameneinzel', 'Damen Einzel'], ['DD', 'Damendoppel', 'Damen Doppel'],
            ['GD', 'Gemischtes Doppel', 'Gemischtes Doppel'], ['MX', 'Gemischtes Doppel', 'Gemischtes Doppel'],
            ['E', 'Einzel', 'Einzel'], ['D', 'Doppel', 'Doppel'],
        ]) {
            const entry = sample(code, 7, [team('Jungendoppel Mustermann'), team('Mädcheneinzel Musterfrau')]);
            entry.setup.event_name = code + ' U19';
            const plan = gameblocks({}, [entry]);
            const event = plan.pieces.find(piece => piece.profile === 'lab-v2/B04');
            assert.strictEqual(event.text, spoken + ' U neunzehn', code);
            assert.strictEqual(event.display, display + ' U19', code);
            assert(plan.cases.every(item => item.display.includes(display + ' U19!')), code);
            assert(plan.sources.some(source => source.text === `Im ${spoken} U neunzehn erwarten wir spannende Spiele!`), code);
            assert(plan.sources.some(source => source.text === 'Jungendoppel Mustermann gegen Jungendoppel Mustermann'), code);
            assert(plan.sources.some(source => source.text === 'Mädcheneinzel Musterfrau gegen Mädcheneinzel Musterfrau'), code);
        }
    });
});
