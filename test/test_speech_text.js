'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { prepare, CALLS } = require('../bts/speech/text');
const { upcoming } = require('../bts/speech/prefetch');

function tournament(flags = 7) {
    return {
        key: 'default', language: 'de',
        annoncement_include_event: !!(flags & 1), annoncement_include_round: !!(flags & 2),
        annoncement_include_matchnumber: !!(flags & 4), preparation_meetingpoint_enabled: true,
        locations: [{ _id: 'default_h1', preparation_addition: 'Halle eins!',
            meetingpoint_announcement: 'Bitte {melde dich/meldet euch} bei der Turnierleitung in Halle eins an!' }],
        courts: [{ _id: 'default_4', is_active: true, location_id: 'default_h1' }],
        normalizations: [],
    };
}

function setup(overrides = {}) {
    return {
        _match_id: 'match1', state: 'scheduled', event_name: 'JE U17', match_name: 'HF',
        court_id: 'default_4', location_id: 'default_h1', match_num: 17,
        teams: [
            { players: [{ name: 'Johann Bjarne Schöttmer' }] },
            { players: [{ name: 'Muhammad Sytsh Abdulquddus' }] },
        ],
        tabletoperators: [{ name: 'Max Müller' }, { name: 'Erika Änne' }],
        umpire: { name: 'Ulli Unparteiisch' }, service_judge: { name: 'Lisa Linie' },
        ...overrides,
    };
}

function baseline(context) {
    const sandbox = {
        curt: context.tournament, ci18n: context.translate, announce: context.announce,
        window: context.window, buildAnnouncementClaimKey: context.claim,
        utils: { find: (values, predicate) => values.find(predicate) },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/announcement_text.before.txt'), 'utf8'), sandbox);
    return sandbox;
}

describe('Shared announcement text and preparation', function() {
    for (const locale of ['de', 'en']) for (const flags of [0, 1, 7]) {
        it('preserves every legacy call byte for byte: ' + locale + '/' + flags, function() {
            const current = tournament(flags);
            current.normalizations = [{ origin: 'Johann', replace: 'Hans', language: 'de-DE' }];
            for (const match of [setup(), setup({ court_id: null }), setup({ match_name: '3/4' }),
                setup({ teams: setup().teams.map(team => ({ players: [...team.players, { name: '  Zweite Person  ' }] })) })]) {
                for (const call of [...CALLS, 'announceNoMatchWin']) {
                    const before = [], after = [];
                    const context = {
                        tournament: current, translate: (key, data, fallback) => translate(locale, key, data, fallback),
                        announce: values => after.push(values), window: { localStorage: { getItem: () => 'true' } },
                        claim: () => 'id',
                    };
                    const old = baseline({ ...context, announce: values => before.push(values) });
                    old[call](match, 0);
                    create(context)[call](match, 0);
                    assert.deepStrictEqual(Buffer.from(JSON.stringify(after)), Buffer.from(JSON.stringify(before)), call);
                }
            }
        });
    }

    it('prepares the exact upcoming call parts and common future courts without playing', function() {
        const current = tournament();
        const match = setup();
        const observed = [];
        create({ tournament: current, translate: key => translate('de', key),
            announce: parts => observed.push(...parts.filter(Boolean)),
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null }).announceNewMatch(match);
        const parts = prepare(current, [{ setup: match }]);
        for (const text of observed) assert(parts.includes(text), text);
        assert(parts.includes('Jungeneinzel U17'));
        assert(parts.includes('Johann Bjarne Schöttmer, gegen Muhammad Sytsh Abdulquddus'));
        assert(parts.includes('Auf Spielfeld 4!'));
        assert(parts.includes('Für Spielfeld 4!'));
        assert.strictEqual(new Set(parts).size, parts.length);
    });

    it('keeps known parts warm when future officials or rounds are still unknown', function() {
        const parts = prepare(tournament(), [{ setup: setup({ tabletoperators: [], match_name: undefined }) }]);
        assert(parts.includes('Johann Bjarne Schöttmer, gegen Muhammad Sytsh Abdulquddus'));
    });

    it('prepares both hall meetingpoints when the future location is unassigned', function() {
        const current = tournament();
        current.locations.push({ _id: 'default_h2', preparation_addition: 'Halle zwei!',
            meetingpoint_announcement: 'Bitte in Halle zwei melden!' });
        const parts = prepare(current, [{ setup: setup({ location_id: null }) }]);
        assert(parts.includes('Bitte in Halle zwei melden!'));
        assert(parts.some(part => part.includes('Turnierleitung in Halle eins')));
    });

    it('prioritizes real preparation candidates and excludes finished/incomplete records', function() {
        const matches = [
            { _id: 'early', setup: setup({ match_num: 1 }) },
            { _id: 'candidate', setup: setup({ match_num: 50 }) },
            { _id: 'prepared', setup: setup({ state: 'preparation', match_num: 40 }) },
            { _id: 'another-hall', setup: setup({ state: 'oncourt', match_num: 80 }) },
            { _id: 'finished', setup: setup({ state: 'finished' }) },
            { _id: 'incomplete', setup: setup({ state: 'incomplete' }) },
        ];
        assert.deepStrictEqual(upcoming(matches, 1, ['candidate']).map(match => match._id),
            ['candidate', 'prepared', 'early', 'another-hall']);
    });
});

module.exports = { tournament, setup };
