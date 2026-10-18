'use strict';
const assert = require('assert');
const { gameblocks } = require('../scripts/tts-gameblock-context-plan');
const { preparation } = require('../scripts/tts-preparation-context-plan');

const games = () => gameblocks({}, [{ id: 'beispiel-189', label: 'Testspiel', setup: {
    match_num: 189, event_name: 'ME U19', match_name: 'R16',
    teams: ['Nina Keo Boun Khoune', 'Leandra Galowicz'].map(name => ({ players: [{ name }] })),
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
        assert.strictEqual(plan.scope.distinct_location_sources_per_voice, 2);
        assert(!plan.sources.some(s => /\d/.test(s.text)));
        for (const call of plan.cases.filter(c => c.experiment === 'assembled')) {
            const middle = call.pieces.slice(1, -1);
            assert.deepStrictEqual(middle.map(p => p.piece), existing.cases[0].pieces.map(p => p.piece));
            for (const row of middle) assert.deepStrictEqual(plan.pieces.find(p => p.id === row.piece),
                existing.pieces.find(p => p.id === row.piece));
        }
        assert.strictEqual(plan.sources.length, 7, 'five cached game sources plus two location contexts');
        assert(!plan.sources.some(s => /Spielfeld/.test(s.text)), 'no hypothetical court variants');
    });

    it('shares identical location text and makes separate opening/closing cuts when meeting points are off', function() {
        const input = { locations: [hall('a'), hall('b', '  ', 'Unused meeting point!')] };
        const plan = preparation(games(), input);
        assert.strictEqual(plan.scope.distinct_location_sources_per_voice, 1);
        const [a, b] = plan.scope.locations;
        assert.strictEqual(a.opening, 'In Vorbereitung');
        assert.strictEqual(a.ending, 'In Vorbereitung');
        assert.strictEqual(a.opening_piece, b.opening_piece);
        assert.strictEqual(a.closing_piece, b.closing_piece);
        assert.notStrictEqual(a.opening_piece, a.closing_piece);
        assert(!plan.sources.some(s => s.text.includes('Unused')));
        assert(plan.sources.some(s => s.text.startsWith('In Vorbereitung: ') && s.text.endsWith('In Vorbereitung!')));
    });

    it('honors an explicitly empty meeting point instead of inventing a location or default ending', function() {
        const plan = preparation(games(), { preparation_meetingpoint_enabled: true, locations: [hall('empty')] });
        assert.strictEqual(plan.scope.locations[0].ending_kind, 'empty');
        assert.strictEqual(plan.scope.locations[0].closing_piece, null);
        assert.strictEqual(plan.cases.length, 3);
        assert.strictEqual(plan.cases[0].pieces.length, 6);
        assert.strictEqual(plan.cases[0].pieces.at(-1).pause_ms, 0);
        assert(!plan.sources.some(s => /Meetingpoint|Halle zwei/.test(s.text)));
    });

    it('uses the existing default meeting text only when no locations exist', function() {
        const plan = preparation(games(), { preparation_meetingpoint_enabled: true, locations: [] });
        assert.strictEqual(plan.scope.locations[0].ending, 'Treffen am Meetingpoint!');
        assert.strictEqual(plan.scope.locations[0].location_id, null);
    });

    it('changing one location changes only its own reference and keeps game and other location pieces', function() {
        const a = { preparation_meetingpoint_enabled: true, locations: [hall('a', 'links', 'Hier treffen!'), hall('b', 'rechts', 'Dort treffen!')] };
        const before = preparation(games(), a);
        a.locations[0].meetingpoint_announcement = 'Bitte zum Eingang!';
        const after = preparation(games(), a);
        assert.notStrictEqual(before.scope.locations[0].source, after.scope.locations[0].source);
        assert.deepStrictEqual(before.scope.locations[1], after.scope.locations[1]);
        assert.deepStrictEqual(before.scope.game_pieces, after.scope.game_pieces);
    });

    it('refuses v1, unknown samples, duplicate locations and invalid source boundaries', function() {
        assert.throws(() => preparation({ strategy: 'v1' }, {}), /v2/);
        assert.throws(() => preparation(games(), {}, 'missing'), /sample/);
        assert.throws(() => preparation(games(), { locations: [hall('a'), hall('a')] }), /Unique location/);
        const invalid = games(); invalid.pieces[0].after += 'wrong';
        assert.throws(() => preparation(invalid, {}), /match its sources/);
    });
});
