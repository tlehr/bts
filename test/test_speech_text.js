'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { prepare, CALLS } = require('../bts/speech/text');
const { upcoming } = require('../bts/speech/prefetch');
const SPACED_FIELD_CALLS = new Set([
    'announceBeginnToPlay', 'announceSecondCallTabletoperator', 'announceSecondCallUmpire', 'announceSecondCallServiceJudge',
]);

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
    it('starts the German walkover result with Das Spiel for browser and cached local speech', function() {
        const current = tournament(), match = setup(), calls = [];
        const texts = create({ tournament: current, translate: (key, data) => translate('de', key, data),
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
            announce: (parts, _local, _claim, options) => calls.push({ parts, ...options }) });
        for (const winner of [0, 1]) {
            texts.announceNoMatchWin(match, winner);
            const call = calls.at(-1);
            assert.strictEqual(call.parts[1], 'Johann Bjarne Schöttmer gegen Muhammad Sytsh Abdulquddus. ' +
                'Das Spiel geht kampflos an ' + match.teams[winner].players[0].name + '!');
            assert(call.localParts.includes('Das Spiel geht kampflos an'));
            const opponent = call.localParts.indexOf('Muhammad Sytsh Abdulquddus');
            assert.strictEqual(call.localPauses[opponent], 250, 'finish the encounter before the result sentence');
        }
        const prepared = prepare(current, [{ setup: match }]);
        assert(prepared.includes('Das Spiel geht kampflos an'));
        assert(!prepared.includes('geht kampflos an'));
    });

    for (const locale of ['de', 'en']) for (const flags of [0, 1, 7]) {
        it('preserves legacy text except corrected sentence separators: ' + locale + '/' + flags, function() {
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
                    // The frozen legacy fixture deliberately retains the reported
                    // missing space. Only these four joins gain a separator.
                    const field = old.createFieldAnnouncement(match);
                    if (SPACED_FIELD_CALLS.has(call) && field) {
                        before[0][0] = field + ' ' + before[0][0].slice(field.length);
                    }
                    create(context)[call](match, 0);
                    assert.deepStrictEqual(Buffer.from(JSON.stringify(after)), Buffer.from(JSON.stringify(before)), call);
                    const local = [];
                    const builder = create({ ...context, local: true, announce: values => local.push(values) });
                    builder[call](match, 0);
                    // Only boundaries and their whitespace differ. Every name,
                    // word and number survives; structural punctuation becomes
                    // playback boundaries, without changing the browser text.
                    const characters = values => values.flat().filter(Boolean).join('').replace(/\s/g, '');
                    const plan = builder.localPlan(after.flat());
                    assert.deepStrictEqual(local.flat(), plan.map(part => part.text));
                    assert.strictEqual(characters(plan.map(part => part.before + part.text + part.after)), characters(before), call + ' local text');
                    assert(local.flat().every(text => text.trim() && !/^[\s,;:.!?]+$/.test(text)));
                    assert(local.flat().length <= 64, 'a complete call must fit the resolve API');
                }
            }
        });
    }

    for (const [locale, field, instruction] of [
        ['de', 'Auf Spielfeld 5!', 'Bitte mit dem Spielen beginnen!'],
        ['en', 'On Court 5!', 'Start to play!'],
    ]) {
        it('reuses the court and one start instruction while preserving the browser sentence: ' + locale, function() {
            const current = tournament();
            current.courts.push({ _id: 'default_5', is_active: true, location_id: 'default_h1' });
            const observed = [];
            const texts = create({ tournament: current, translate: key => translate(locale, key),
                announce: parts => observed.push(...parts),
                window: { localStorage: { getItem: () => 'true' } }, claim: () => null });
            const expected = field + ' ' + instruction;
            texts.announceBeginnToPlay(setup({ court_id: 'default_5' }));
            texts.announceBeginnToPlay(setup({ court_id: null }));
            assert.deepStrictEqual(observed, [expected, instruction]);
            const future = prepare(current, [], locale);
            assert(future.includes(field.slice(0, -1)), 'the court must be ready before assignment');
            assert.strictEqual(future.filter(text => text === instruction.slice(0, -1)).length, 1);
            assert(!future.includes(expected), 'a combined recording must not be generated for each court');
            assert(!future.includes(field + instruction), 'the broken concatenation must not be warmed again');
        });
    }

    it('separates the court sentence from official second calls and prefetches their exact text', function() {
        const current = tournament();
        const match = setup();
        const prepared = prepare(current, [{ setup: match }]);
        const calls = [], local = [];
        const texts = create({ tournament: current, translate: key => translate('de', key),
            announce: (parts, _local, _claim, options) => { calls.push(...parts); local.push(...options.localParts); },
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null });
        for (const call of ['announceSecondCallTabletoperator', 'announceSecondCallUmpire', 'announceSecondCallServiceJudge']) {
            texts[call](match);
            assert(calls.at(-1).startsWith('Auf Spielfeld 4! Zweiter Aufruf für:'), calls.at(-1));
            assert(local.every(part => prepared.includes(part)), 'every local clip must be prefetched');
            assert(!prepared.includes(calls.at(-1)), 'the court, prefix, role and name must be shared clips');
            texts[call]({ ...match, court_id: null });
            assert(calls.at(-1).startsWith('Zweiter Aufruf für:'), 'an unassigned court must not add leading whitespace');
        }
        for (const part of ['Auf Spielfeld 4', 'Zweiter Aufruf für', 'Schiedsrichter', 'Ulli Unparteiisch']) {
            assert(local.includes(part), part);
        }
    });

    it('prepares the exact upcoming call parts and common future courts without playing', function() {
        const current = tournament();
        const match = setup();
        const observed = [];
        create({ local: true, tournament: current, translate: key => translate('de', key),
            announce: parts => observed.push(...parts.filter(Boolean)),
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null }).announceNewMatch(match);
        const parts = prepare(current, [{ setup: match }]);
        for (const text of observed) assert(parts.includes(text), text);
        assert(parts.includes('Jungeneinzel U17'));
        assert(parts.includes('Johann Bjarne Schöttmer'));
        assert(parts.includes('gegen'));
        assert(parts.includes('Muhammad Sytsh Abdulquddus'));
        assert(!parts.includes('Johann Bjarne Schöttmer, gegen Muhammad Sytsh Abdulquddus'));
        assert(parts.includes('Auf Spielfeld 4'));
        assert(parts.includes('Für Spielfeld 4'));
        assert.strictEqual(new Set(parts).size, parts.length);
    });

    it('keeps known parts warm when future officials or rounds are still unknown', function() {
        const parts = prepare(tournament(), [{ setup: setup({ tabletoperators: [], match_name: undefined }) }]);
        assert(parts.includes('Johann Bjarne Schöttmer'));
        assert(parts.includes('Muhammad Sytsh Abdulquddus'));
    });

    it('prepares both hall meetingpoints when the future location is unassigned', function() {
        const current = tournament();
        current.locations.push({ _id: 'default_h2', preparation_addition: 'Halle zwei!',
            meetingpoint_announcement: 'Bitte in Halle zwei melden!' });
        const parts = prepare(current, [{ setup: setup({ location_id: null }) }]);
        assert(parts.includes('Bitte in Halle zwei melden'));
        assert(parts.some(part => part.includes('Turnierleitung in Halle eins')));
    });

    it('warms the complete local plan for every call, winner and hall with singles and doubles', function() {
        for (const locale of ['de', 'en']) for (const meetingpoint of [false, true]) {
            for (const doubles of [false, true]) for (const countingBoards of [false, true]) {
                const current = tournament();
                current.preparation_meetingpoint_enabled = meetingpoint;
                current.tabletoperator_use_manual_counting_boards_enabled = countingBoards;
                current.normalizations = [{ origin: 'Johann', replace: 'Hans', language: 'de-DE' }];
                current.locations.push({ _id: 'hall2', preparation_addition: '{Halle zwei einzeln!/Halle zwei gemeinsam!}',
                    meetingpoint_announcement: 'Bitte {komm/kommt} in Halle zwei!' });
                const match = setup({ location_id: null });
                if (doubles) match.teams = match.teams.map(team => ({
                    players: [...team.players, { name: 'Zweite Person Ä\nU17' }],
                }));
                const prepared = new Set(prepare(current, [{ setup: match }], locale));
                const observed = [];
                const texts = create({ local: true, tournament: current,
                    translate: (key, data) => translate(locale, key, data),
                    window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
                    announce: parts => observed.push(...parts) });
                for (const location_id of [null, ...current.locations.map(hall => hall._id)]) {
                    for (const call of CALLS) texts[call]({ ...match, location_id });
                    for (const winner of [0, 1]) texts.announceNoMatchWin({ ...match, location_id }, winner);
                }
                assert(observed.every(text => prepared.has(text)),
                    locale + ': missing ' + observed.filter(text => !prepared.has(text)).join(' / '));
            }
        }
    });

    it('reuses full player names across new opponents, doubles and officials without splitting names or U17', function() {
        const current = tournament();
        const first = setup();
        const second = setup({ court_id: 'default_8', match_num: 18,
            teams: [first.teams[0], { players: [{ name: 'Neue Gegnerin' }, { name: 'Andere Partnerin' }] }],
            umpire: { name: first.teams[0].players[0].name } });
        const parts = prepare(current, [{ setup: first }, { setup: second }]);
        assert.strictEqual(parts.filter(text => text === 'Johann Bjarne Schöttmer').length, 1);
        for (const text of ['Neue Gegnerin', 'Andere Partnerin', 'und', 'gegen', 'Schiedsrichter', 'Jungeneinzel U17']) {
            assert(parts.includes(text), text);
        }
        assert(!parts.some(text => text.includes('Schöttmer, gegen')));
        assert(!parts.includes('Johann'));
        assert(!parts.includes('U17'));
        assert(!parts.some(text => text.includes('Spielfeld') && text.includes('Bitte mit dem Spielen')));
    });

    it('uses one recording per name and round with sentence endings represented as playback pauses', function() {
        const current = tournament();
        const match = setup({ match_name: 'R16',
            teams: [{ players: [{ name: 'Buddhsa Keo Boun Khoune' }] }, { players: [{ name: 'Noe Rößler' }] }] });
        const prepared = prepare(current, [{ setup: match }]);
        for (const text of ['Buddhsa Keo Boun Khoune', 'Noe Rößler', 'Achtelfinale']) {
            assert.strictEqual(prepared.filter(part => part === text).length, 1, text);
            assert(!prepared.includes(text + '!'), text + ' must not be generated again for sentence endings');
            assert(!prepared.includes(', ' + text), text + ' must not be generated again after a comma');
        }
        const calls = [];
        const texts = create({ tournament: current, translate: (key, data) => translate('de', key, data),
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
            announce: (parts, _local, _claim, options) => calls.push({ parts, ...options }) });
        texts.announceSecondPreparationCallTeamOne({ ...match, location_id: null });
        assert(calls[0].parts[0].endsWith('Buddhsa Keo Boun Khoune!'));
        const index = calls[0].localParts.indexOf('Buddhsa Keo Boun Khoune');
        assert(index >= 0);
        assert.strictEqual(calls[0].localPauses[index], 250);
        texts.announceNoMatchWin(match, 1);
        assert.strictEqual(calls[1].localParts.at(-1), 'Noe Rößler');
        assert.strictEqual(calls[1].localPauses.at(-1), 250);
        const round = calls[1].localParts.indexOf('Achtelfinale');
        assert(round >= 0);
        assert.strictEqual(calls[1].localPauses[round], 250);
    });

    it('preserves punctuation within original names, including initials and abbreviations', function() {
        const match = setup({ location_id: null,
            teams: [{ players: [{ name: 'Nina K.' }] }, { players: [{ name: 'Leandra G.!' }] }] });
        const prepared = prepare(tournament(), [{ setup: match }]);
        for (const name of ['Nina K.', 'Leandra G.!']) {
            assert.strictEqual(prepared.filter(text => text === name).length, 1);
            assert(!prepared.includes(name + '!'));
        }
        assert(!prepared.includes('Nina K'));
        assert(!prepared.includes('Leandra G'));
    });

    it('shares match number 186 between regular and forfeit calls with their respective pauses', function() {
        const calls = [];
        const current = tournament();
        const match = setup({ match_num: 186 });
        const texts = create({ tournament: current, translate: (key, data) => translate('de', key, data),
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
            announce: (parts, _local, _claim, options) => calls.push({ parts, ...options }) });
        texts.announceNewMatch(match);
        texts.announceNoMatchWin(match, 0);
        assert(calls[0].parts.includes('Spiel Nummer 186!'));
        assert(calls[1].parts[0].startsWith('Spiel Nummer 186,'));
        for (const [index, pause] of [[0, 250], [1, 120]]) {
            const position = calls[index].localParts.indexOf('Spiel Nummer 186');
            assert(position >= 0);
            assert.strictEqual(calls[index].localPauses[position], pause);
        }
        const prepared = prepare(current, [{ setup: match }]);
        assert.strictEqual(prepared.filter(text => text === 'Spiel Nummer 186').length, 1);
        assert(!prepared.includes('Spiel Nummer 186!'));
    });

    it('has no punctuation-only duplicate variants across all structured call parts and hall variants', function() {
        for (const locale of ['de', 'en']) for (const meetingpoint of [false, true]) {
            const current = tournament();
            current.preparation_meetingpoint_enabled = meetingpoint;
            current.locations.push({ ...current.locations[0], _id: 'hall2', preparation_addition: 'Halle eins',
                meetingpoint_announcement: current.locations[0].meetingpoint_announcement.slice(0, -1) });
            const prepared = prepare(current, ['R16', 'HF', '3/4'].map((match_name, i) => ({
                setup: setup({ location_id: null, match_num: 186 + i, match_name }),
            })), locale);
            const speechcheck = translate(locale, 'announcements:speechcheck:text');
            assert.strictEqual(prepared[0], speechcheck, 'the speech test remains a complete original recording');
            const variants = new Map();
            for (const text of prepared.slice(1)) {
                const words = text.replace(/^[\s,;:.!?]+|[\s,;:.!?]+$/g, '');
                assert(!variants.has(words), 'duplicate: ' + variants.get(words) + ' / ' + text);
                variants.set(words, text);
            }
            for (const text of ['Auf Spielfeld 4', 'Für Spielfeld 4', 'In Vorbereitung']) {
                if (locale === 'de') assert(prepared.includes(text), text);
            }
        }
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
