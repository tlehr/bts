'use strict';
const assert = require('assert');
const { gameblocks } = require('../scripts/tts-gameblock-context-plan');
const { preparation } = require('../scripts/tts-preparation-context-plan');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');

const games = () => gameblocks({}, [{ id: 'beispiel-189', label: 'Testspiel', setup: {
    match_num: 189, event_name: 'ME U19', match_name: 'R16',
    teams: ['Max Mustermann', 'Hans Dampf'].map(name => ({ players: [{ name }] })),
} }]);
const hall = (id, addition = '', meeting = '') => ({ _id: id, name: id,
    preparation_addition: addition, meetingpoint_announcement: meeting });

describe('location-aware preparation hearing plan', function() {
    it('uses each actual location text, resolves plural and preserves the accepted game identities', function() {
        const existing = games(), snapshot = JSON.stringify(existing);
        const plan = preparation(existing, { preparation_meetingpoint_enabled: true, locations: [
            hall('nord', 'für Halle 2!', 'Bitte {melde dich/meldet euch} in Halle 2!'),
            hall('sued', 'am Nebenfeld!', 'Bitte {komm/kommt} zur Turnierleitung!'),
        ] });
        assert.strictEqual(JSON.stringify(existing), snapshot);
        assert.strictEqual(plan.scope.locations[0].opening, 'In Vorbereitung für Halle 2!');
        assert.strictEqual(plan.scope.locations[0].ending, 'Bitte meldet euch in Halle 2!');
        assert.strictEqual(plan.scope.locations[1].ending, 'Bitte kommt zur Turnierleitung!');
        assert.strictEqual(plan.scope.distinct_location_sources_per_voice, 4);
        assert(!plan.sources.some(s => /\d/.test(s.text)));
        for (const call of plan.cases.filter(c => c.experiment === 'assembled')) {
            const middle = call.pieces.slice(1, -1);
            assert.deepStrictEqual(middle.map(p => p.piece), existing.cases[0].pieces.map(p => p.piece));
            for (const row of middle) assert.deepStrictEqual(plan.pieces.find(p => p.id === row.piece),
                existing.pieces.find(p => p.id === row.piece));
        }
        assert.strictEqual(plan.sources.length, 9, 'five cached game sources plus four complete browser sentences');
        for (const piece of plan.pieces.filter(p => p.profile === 'lab-v2/location-sentence')) {
            assert.strictEqual(piece.before, '');
            assert.strictEqual(piece.after, '');
            assert.strictEqual(piece.text, plan.sources.find(s => s.id === piece.source).text);
        }
        assert(!plan.sources.some(s => /Spielfeld/.test(s.text)), 'no hypothetical court variants');
    });

    it('shares the opening and new no-meeting-point ending across locations', function() {
        const input = { locations: [hall('a'), hall('b', '  ', 'Unused meeting point!')] };
        const plan = preparation(games(), input);
        assert.strictEqual(plan.scope.distinct_location_sources_per_voice, 2);
        const [a, b] = plan.scope.locations;
        assert.strictEqual(a.opening, 'In Vorbereitung');
        assert.strictEqual(a.ending, 'Das Spiel ist in Vorbereitung!');
        assert.strictEqual(a.opening_piece, b.opening_piece);
        assert.strictEqual(a.closing_piece, b.closing_piece);
        assert.notStrictEqual(a.opening_piece, a.closing_piece);
        assert(!plan.sources.some(s => s.text.includes('Unused')));
        assert(plan.sources.some(s => s.text === 'In Vorbereitung'));
        assert(!plan.sources.some(s => s.profile === 'lab-v2/preparation-location-reference'));
        assert.strictEqual(plan.cases.filter(c => c.experiment === 'sentences').length, 4, 'both sentences once per location');
    });

    it('uses the new ending when the enabled meeting-point text is empty', function() {
        const plan = preparation(games(), { preparation_meetingpoint_enabled: true, locations: [hall('empty')] });
        assert.strictEqual(plan.scope.locations[0].ending_kind, 'preparation');
        assert.strictEqual(plan.scope.locations[0].ending, 'Das Spiel ist in Vorbereitung!');
        assert(plan.scope.locations[0].closing_piece);
        assert.strictEqual(plan.cases.length, 3);
        assert.strictEqual(plan.cases[0].pieces.length, 7);
        assert.strictEqual(plan.cases[0].pieces.at(-1).pause_ms, 0);
        assert(!plan.sources.some(s => /Meetingpoint|Halle zwei/.test(s.text)));
    });

    it('uses the existing default meeting text only when no locations exist', function() {
        const plan = preparation(games(), { preparation_meetingpoint_enabled: true, locations: [] });
        assert.strictEqual(plan.scope.locations[0].ending, 'Treffen am Meetingpoint!');
        assert.strictEqual(plan.scope.locations[0].location_id, null);
    });

    it('changing a meeting text keeps the opening, game and other location recordings', function() {
        const a = { preparation_meetingpoint_enabled: true, locations: [hall('a', 'links', 'Hier treffen!'), hall('b', 'rechts', 'Dort treffen!')] };
        const before = preparation(games(), a);
        a.locations[0].meetingpoint_announcement = 'Bitte zum Eingang!';
        const after = preparation(games(), a);
        assert.notStrictEqual(before.scope.locations[0].closing_source, after.scope.locations[0].closing_source);
        assert.strictEqual(before.scope.locations[0].opening_source, after.scope.locations[0].opening_source);
        assert.deepStrictEqual(before.scope.locations[1], after.scope.locations[1]);
        assert.deepStrictEqual(before.scope.game_pieces, after.scope.game_pieces);
    });

    it('matches the actual browser output without invented words or sentence punctuation', function() {
        for (const enabled of [false, true]) {
            const tournament = { preparation_meetingpoint_enabled: enabled, locations: [
                hall('a', 'für Halle 2:', 'Bitte {melde dich/meldet euch} am Eingang.'),
                hall('b', '', ''),
            ] };
            const plan = preparation(games(), tournament);
            let browser;
            const texts = create({ tournament, translate: (key, data, fallback) => translate('de', key, data, fallback),
                window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
                announce: parts => { browser = parts; } });
            for (const location of plan.scope.locations) {
                texts.announcePreparationMatch({ location_id: location.location_id, match_num: 189, event_name: 'ME U19',
                    match_name: 'R16', teams: ['Max Mustermann', 'Hans Dampf'].map(name => ({ players: [{ name }] })) });
                assert.strictEqual(location.opening, browser[0].trim());
                assert.strictEqual(location.ending, browser.at(-1).trim());
                for (const [key, expected] of [['opening_piece', browser[0]], ['closing_piece', browser.at(-1)]]) {
                    if (!expected.trim()) { assert.strictEqual(location[key], null); continue; }
                    const piece = plan.pieces.find(p => p.id === location[key]);
                    assert.strictEqual(piece.display, expected.trim());
                    assert.strictEqual(piece.text, spellNumbers(expected.trim()));
                    assert.strictEqual(piece.before + piece.after, '');
                }
            }
        }
    });

    it('refuses v1, unknown samples, duplicate locations and invalid source boundaries', function() {
        assert.throws(() => preparation({ strategy: 'v1' }, {}), /v2/);
        assert.throws(() => preparation(games(), {}, 'missing'), /sample/);
        assert.throws(() => preparation(games(), { locations: [hall('a'), hall('a')] }), /Unique location/);
        const invalid = games(); invalid.pieces[0].after += 'wrong';
        assert.throws(() => preparation(invalid, {}), /match its sources/);
    });
});
