'use strict';

const assert = require('assert');
const create = require('../static/js/announcement_text');
const plan = require('../static/js/speech_context');
const v2 = require('../static/js/speech_context_v2');
const context = require('../bts/speech/context');
const { _translate: translate } = require('../static/js/ci18n');
const { CALLS } = require('../bts/speech/text');
const { requiredPlan, requiredParts } = require('../bts/speech/planning');
const idlePlan = require('../bts/speech/idle_plan');
const { tournament, setup } = require('./test_speech_text');
const fixture = () => ({ ...tournament(), speech: { context_version: context.V2 }, tabletoperator_enabled: true });
const decode = parts => parts.map(part => context.decode(part, 1200) || { text: part });
const words = parts => decode(parts).map(value => value.text).join(' ');
const lexemes = text => text.toLowerCase().replaceAll('maedchen', 'mädchen').replace(/[^\p{L}\p{N}]/gu, '');
function renderer(current, output = []) {
    return create({ tournament: current, translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
        announce: (browser, _local, _claim, local) => output.push({ browser, ...local }) });
}

describe('Production context v2', function() {
    it('uses the browser words in every match/official call and location variant', function() {
        for (const flags of [0, 1, 7]) for (const meeting of [true, false]) for (const court of [null, 'default_4']) {
            const current = { ...fixture(), ...tournament(flags), preparation_meetingpoint_enabled: meeting }, calls = [], texts = renderer(current, calls);
            for (const call of [...CALLS, 'announceNoMatchWin']) {
                const match = setup({ court_id: court });
                texts[call](match, 1);
                const value = calls.at(-1);
                assert(value.localParts.every(part => part.startsWith('~bts-context-v2~')), call);
                assert.strictEqual(value.localParts.length, value.localPauses.length, call);
                assert.strictEqual(lexemes(words(value.localParts)), lexemes(value.browser.join(' ')), call + ': ' + words(value.localParts));
            }
        }
    });

    it('shares each team source across opponent, role, position and field changes', function() {
        const current = fixture(), texts = renderer(current), match = setup();
        const a = plan(texts, current, 'prepareGame', match).parts;
        const b = plan(texts, current, 'prepareGame', { ...match, court_id: 'default_9',
            teams: [match.teams[0], { players: [{ name: 'Anderer Gegner' }] }] }).parts;
        assert.deepStrictEqual(a.slice(0, 4), b.slice(0, 4));
        const source = context.sourcePart(decode(a)[3]);
        const official = plan(texts, current, 'announceSecondCallUmpire', { umpire: { name: match.teams[0].players[0].name } }).parts.at(-1);
        assert.strictEqual(context.sourcePart(context.decode(official, 1200)), source);
        assert.strictEqual(context.decode(source, 1200).version, context.V2);
        assert(!words(a).includes('spielt jetzt'));
    });

    it('uses one preparation context for both edges and a direct separate field sentence', function() {
        const current = { ...fixture(), preparation_meetingpoint_enabled: false }, texts = renderer(current);
        const parts = plan(texts, current, 'announcePreparationMatch', setup()).parts;
        assert.strictEqual(context.sourcePart(context.decode(parts[0], 1200)), context.sourcePart(context.decode(parts.at(-1), 1200)));
        assert.strictEqual(context.decode(parts[1], 1200).text, 'Für Spielfeld 4!');
        assert.strictEqual(context.decode(parts[1], 1200).before, '');
    });

    it('assembles registration names and labels with the same reusable team source', function() {
        for (const text of [
            'Nina Keo Boun Khoune bitte zur Anmeldung. Nina Keo Boun Khoune bitte!',
            'Die Paarung A und B bitte zur Turnierleitung. A und B bitte!',
            'Bitte ein Vertreter vom Verein PSV Bremen zur Anmeldung. Ein Vertreter vom Verein PSV Bremen bitte!',
            'Bitte ein Vertreter aus Bremen zur Turnierleitung. Ein Vertreter aus Bremen bitte!',
        ]) {
            const value = v2.registration(text);
            assert.strictEqual(lexemes(words(value.parts)), lexemes(text));
            assert(value.pauses.includes(320));
        }
        assert.strictEqual(v2.registration('Freie Ansage!'), null);
    });

    it('orders needed games by call timestamps and all officials before idle candidates', async function() {
        const current = fixture();
        const games = [
            { _id: 'new', setup: setup({ state: 'oncourt', called_timestamp: 200 }) },
            { _id: 'old', setup: setup({ state: 'oncourt', match_num: 2, called_timestamp: 100 }) },
            { _id: 'prep', setup: setup({ state: 'preparation', match_num: 3, preparation_call_timestamp: 50 }) },
            { _id: 'candidate', setup: setup({ state: 'scheduled', match_num: 4, court_id: null }) },
        ];
        const value = requiredPlan(current, games, [{ name: 'Offizieller Reserve' }]);
        assert.deepStrictEqual([...value.games.keys()], ['old', 'new', 'prep']);
        const required = requiredParts(value);
        assert(words(required).includes('Offizieller Reserve'));
        assert(!words(required).includes('Spielnummer 4'));
        const idle = await idlePlan(current, games, [], ['candidate']);
        assert(words(idle).includes('Spielnummer 4'));
        assert(!words(idle).includes('Offizieller Reserve'));
    });
});

describe('Context v2 tournament progression', function() {
    function event(name, id, players) {
        return { name, id, stages: [{ id: id + '-stage', entries: players.map((player, i) => ({ entry_id: id + i, team: { players: [{ name: player, state: id + ' Verband', club: id + ' Verein' }] } })) }] };
    }
    it('warms common registration, federations and clubs before people before the first draw', function() {
        const current = fixture();
        current.events = { events: [event('ME U19', 'closed', ['Später Name']), event('JE U17', 'open', ['Früher Name'])] };
        current.registration_open_events = { open: true };
        const parts = requiredParts(requiredPlan(current, []));
        const values = decode(parts).map(row => row.text);
        assert(values.indexOf('open Verband') < values.indexOf('open Verein'));
        assert(values.indexOf('open Verein') < values.indexOf('Früher Name'));
        assert(values.indexOf('Früher Name') < values.indexOf('Später Name'));
        assert(values.indexOf('Bitte ein Vertreter aus') < values.indexOf('open Verband'));
    });
    it('moves further registrations behind scheduled games and before extra operator reserve after drawing', async function() {
        const current = fixture();
        current.events = { events: [event('JE U17', 'drawn', ['Reserve Aktive Disziplin']), event('ME U19', 'next', ['Neue Auslosung'])] };
        const games = [{ _id: 'scheduled', setup: setup({ court_id: null, state: 'scheduled' }) }];
        const needed = words(requiredParts(requiredPlan(current, games)));
        assert(!needed.includes('Neue Auslosung'));
        const reserve = decode(await idlePlan(current, games)).map(row => row.text);
        assert(reserve.indexOf('Spielnummer 17') < reserve.indexOf('Neue Auslosung'));
        assert(reserve.indexOf('Neue Auslosung') < reserve.indexOf('Reserve Aktive Disziplin'));
    });
});

describe('Context v2 failed-source recovery', function() {
    it('requests a fresh context before the final single-name fallback and then stops', function() {
        const { SpeechBroker, configuration } = require('../bts/speech/broker');
        const { spellNumbers } = require('../bts/speech/numbers');
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false }, {}));
        broker.context_version = context.V2;
        const current = fixture(), texts = renderer(current);
        const part = plan(texts, current, 'prepareName', { players: [{ name: 'Selten Nachname' }] }).parts[0];
        broker.prepare([part], { voice: 'hallensprecher', priority: 'normal', prefetch: true }, 'test');
        const entry = broker.entries.get(broker.key(part, 'hallensprecher', 'de-DE'));
        const fail = source => broker.update(source, { job_id: 'a'.repeat(32), status: 'failed', text: spellNumbers(source.text),
            voice: source.voice, language: source.language, error: { code: 'source_quality_failed' } });
        fail(broker.entries.get(entry.source_key));
        assert.strictEqual(entry.fallback_stage, 'context');
        let source = broker.entries.get(entry.source_key);
        assert.strictEqual(source.source_seed, 45);
        assert.strictEqual(source.context.version, context.V2);
        fail(source);
        assert.strictEqual(entry.fallback_stage, 'name');
        source = broker.entries.get(entry.source_key);
        assert.strictEqual(source.text, 'Selten Nachname');
        fail(source);
        assert.strictEqual(entry.terminal_failure, true);
        broker.stop();
    });
});


describe('Speech startup during a context-version change', function() {
    it('keeps restored plans from reaching an unverified starting server', async function() {
        const { SpeechBroker, configuration } = require('../bts/speech/broker');
        const posts = [];
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false }, {}), {
            request: async (_base, _key, method, route, body) => {
                if (method === 'POST') posts.push(body);
                if (route === '/v1/voices') return { voices: [] };
                throw new Error('server_starting');
            },
        });
        broker.prepare(['Veralteter Auftrag'], { voice: 'hallensprecher', priority: 'normal' }, 'test');
        broker.start();
        try {
            await new Promise(resolve => setTimeout(resolve, 150));
            assert.strictEqual(posts.length, 0, 'cache metadata is sufficient for playback, not for new synthesis');
        } finally { broker.stop(); }
    });
});
