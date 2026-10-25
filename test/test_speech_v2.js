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

    it('uses one preparation context for both edges and a contextual separate field sentence', function() {
        const current = { ...fixture(), preparation_meetingpoint_enabled: false }, texts = renderer(current);
        const parts = plan(texts, current, 'announcePreparationMatch', setup()).parts;
        assert.strictEqual(context.sourcePart(context.decode(parts[0], 1200)), context.sourcePart(context.decode(parts.at(-1), 1200)));
        assert.strictEqual(context.decode(parts[1], 1200).text, 'Für Spielfeld 4!');
        assert.strictEqual(context.decode(parts[1], 1200).before, 'In Vorbereitung! ');
        assert(context.decode(parts[1], 1200).after.includes('Max Mustermann gegen Hans Dampf'));
    });

    it('gives every reusable V2 fragment a longer source while preserving the spoken words', function() {
        for (const recipe of Object.values(v2.fixed)) assert(recipe.before.trim() || recipe.after.trim(), recipe.text);
        for (const recipe of decode(v2.registration('Die Paarung Max Mustermann und Hans Dampf bitte zur Anmeldung. Max Mustermann und Hans Dampf bitte!').parts)) {
            assert(recipe.before.trim() || recipe.after.trim(), recipe.text);
        }
        for (const meeting of [true, false]) for (const match_name of ['R16', 'VF', 'HF', 'Finale', '3/4', '9/16']) {
            const current = { ...fixture(), preparation_meetingpoint_enabled: meeting }, texts = renderer(current);
            const match = setup({ match_name });
            for (const call of [...CALLS, 'announceNoMatchWin', 'prepareFields', 'prepareInstruction', 'prepareGame',
                'prepareName', 'prepareMatchNumber', 'prepareCommon', 'prepareLocation']) {
                const target = call === 'prepareName' ? { players: match.teams[0].players } : match;
                const value = plan(texts, current, call, target, [0]);
                for (const recipe of decode(value.parts)) {
                    assert(recipe.before.trim() || recipe.after.trim(), call + ': isolated ' + recipe.text);
                    assert((recipe.before + recipe.text + recipe.after).length > recipe.text.length + 10, call + ': missing source context');
                }
            }
        }
    });

    it('reuses contextual rounds, fields and meeting points independently of actual games', function() {
        const current = fixture(), texts = renderer(current);
        const a = setup({ match_name: '5/6' });
        const b = setup({ match_name: '5/6', match_num: 99, event_name: 'MX U19', teams: [
            { players: [{ name: 'Andere Person' }] }, { players: [{ name: 'Weitere Person' }] },
        ] });
        const round = match => decode(plan(texts, current, 'prepareGame', match).parts).find(part => part.text === 'Spiel um Platz 5 und 6!');
        assert.deepStrictEqual(round(a), round(b));
        assert(round(a).before.includes('Spielnummer 161'));
        assert(round(a).after.includes('Max Mustermann gegen Hans Dampf'));
        const field = match => plan(texts, current, 'prepareFields', match).parts[2];
        const calledField = decode(plan(texts, current, 'announcePreparationMatch', b).parts).find(part => part.text === 'Für Spielfeld 4!');
        assert.deepStrictEqual(context.decode(field(a), 1200), calledField);
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
    async function registrationParts(current, matches = []) {
        let registration;
        await idlePlan(current, matches, [], [], (stage, parts) => { if (stage === 'registration_reserve') registration = parts; });
        return registration;
    }
    it('warms common registration, federations and clubs before people before the first draw', async function() {
        const current = fixture();
        current.events = { events: [event('ME U19', 'closed', ['Später Name']), event('JE U17', 'open', ['Früher Name'])] };
        current.registration_open_events = { open: true };
        const parts = await registrationParts(current);
        assert(!words(requiredParts(requiredPlan(current, []))).includes('Früher Name'), 'registration must remain idle work before the first draw');
        const values = decode(parts).map(row => row.text);
        assert(values.indexOf('open Verband') < values.indexOf('open Verein'));
        assert(values.indexOf('open Verein') < values.indexOf('Früher Name'));
        assert(values.indexOf('Früher Name') < values.indexOf('Später Name'));
        assert(values.indexOf('Bitte ein Vertreter aus') < values.indexOf('open Verband'));
    });
    it('prepares federations and clubs across all open disciplines before their players and pairs, also after drawing', async function() {
        const current = fixture();
        current.events = { events: [
            event('Abgeschlossene Anmeldung', 'complete', ['Fertiges Musterteam']),
            event('Nicht geöffnete Disziplin', 'closed', ['Spätere Musterperson']),
            event('Zweite nicht geöffnete Disziplin', 'later', ['Weitere spätere Musterperson']),
            event('Erste offene Disziplin', 'one', ['Erste Musterperson']),
            { name: 'Zweite offene Disziplin', id: 'two', stages: [{ entries: [{ entry_id: 'double', team: { players: [
                { name: 'Musterperson Links', state: 'two Verband', club: 'two Verein' },
                { name: 'Musterperson Rechts', state: 'two Verband', club: 'two Verein' },
            ] } }] }] },
        ] };
        current.registration_open_events = { one: true, two: true };
        current.registration_completed_events = { complete: true };
        const matches = [{ _id: 'drawn', setup: setup({ court_id: null, state: 'scheduled' }) }];
        const needed = await registrationParts(current);
        const sameContent = await registrationParts({ ...current, registration_open_events: {} });
        assert.deepStrictEqual(new Set(needed), new Set(sameContent), 'reordering must preserve reusable audio identities');
        const registration = [];
        await idlePlan(current, matches, [], [], (stage, parts) => { if (stage === 'registration_reserve') registration.push(...parts); });
        for (const parts of [needed, registration]) {
            const values = decode(parts).map(row => row.text);
            const position = text => { const index = values.indexOf(text); assert(index >= 0, text); return index; };
            assert(position('one Verband') < position('two Verband'));
            assert(position('two Verband') < position('one Verein'));
            assert(position('one Verein') < position('two Verein'));
            assert(position('two Verein') < position('Erste Musterperson'));
            assert(position('two Verein') < position('Musterperson Links und Musterperson Rechts'));
            assert(position('Musterperson Links und Musterperson Rechts') < position('closed Verband'));
            assert(!values.includes('Fertiges Musterteam'), 'completed registrations no longer warm names in the registration stage');
            assert(position('closed Verband') < position('later Verband'));
            assert(position('later Verband') < position('closed Verein'));
            assert(position('closed Verein') < position('later Verein'));
            assert(position('later Verein') < position('Spätere Musterperson'));
            assert(position('Spätere Musterperson') < position('Weitere spätere Musterperson'));
        }
    });
    it('prepares candidates, scheduled games, extra tablet reserve and then further registrations after drawing', async function() {
        const current = fixture();
        current.events = { events: [event('JE U17', 'drawn', ['Reserve Aktive Disziplin']), event('ME U19', 'next', ['Neue Auslosung'])] };
        current.registration_player_statuses = { 'drawn0:0': { status: 'present' } };
        const games = [{ _id: 'scheduled', setup: setup({ court_id: null, state: 'scheduled' }) },
            { _id: 'candidate', setup: setup({ court_id: null, state: 'scheduled', match_num: 18 }) }];
        const needed = words(requiredParts(requiredPlan(current, games)));
        assert(!needed.includes('Neue Auslosung'));
        const reserve = decode(await idlePlan(current, games, [], ['candidate'])).map(row => row.text);
        const position = text => { const index = reserve.indexOf(text); assert(index >= 0, text); return index; };
        assert(position('Spielnummer 18') < position('Spielnummer 17'));
        assert(position('Spielnummer 17') < position('Reserve Aktive Disziplin'));
        assert(position('Reserve Aktive Disziplin') < position('Neue Auslosung'));
    });
    it('reserves all disciplines past open registration until their real games finish, ordered by the next games', async function() {
        for (const context_version of [context.V2, context.VERSION]) {
            const current = { ...fixture(), speech: { context_version },
                registration_open_events: { open: true, checked: true },
                registration_completed_events: { complete: true },
                registration_player_statuses: { 'checked0:0': { status: 'present' }, 'checked1:0': { status: 'absent' } } };
            const checked = event('Gemeldete Disziplin', 'checked', ['Max Mustermann', 'Abwesende Musterperson']);
            checked.stages[0].stage_type = 1;
            checked.stages.push({ stage_type: 9998, entries: [{ entry_id: 'reserve', team: { players: [{ name: 'Reserve Musterperson' }] } }] });
            current.events = { events: [
                event('Offene Disziplin', 'open', ['Offene Musterperson', 'Noch ungeprüfte Musterperson']),
                event('Nicht geöffnete Disziplin', 'closed', ['Spätere Musterperson']),
                checked,
                event('Abgeschlossene Anmeldung', 'complete', ['Fertige Anmeldung Musterperson']),
                { ...event('Ausgeloste Disziplin', 'drawn', ['Hans Dampf']), is_drawn: true },
                { ...event('Spielzahl ohne Spieldaten', 'counted', ['Erika Musterfrau']), match_count: 2 },
                event('Spätere Spielzeit', 'later', ['Otto Normalverbraucher', 'Ohne nächstes Musterspiel']),
                event('Frühere Spielzeit', 'earlier', ['Frühes Musterteam']),
                event('Beendete Disziplin', 'finished', ['Beendetes Musterteam']),
                event('Kampflose Disziplin', 'walkover', ['Kampfloses Musterteam']),
                event('Ergebnis ohne Statuswechsel', 'result', ['Musterteam mit Ergebnis']),
            ] };
            for (const event of current.events.events.filter(event => !['checked', 'closed'].includes(event.id))) {
                current.registration_player_statuses[event.id + '0:0'] = { status: 'present' };
            }
            current.registration_player_statuses['later1:0'] = { status: 'present' };
            const match = (id, event_name, time, overrides = {}, extra = {}) => {
                const event = current.events.events.find(event => event.id === id);
                return { _id: id, ...extra, setup: setup({ stage_id: id + '-stage', event_name, court_id: null, state: 'scheduled',
                    scheduled_time_str: time, tabletoperators: null, umpire: null, service_judge: null,
                    teams: [event.stages[0].entries[0].team, { players: [] }], ...overrides }) };
            };
            const games = [
                match('later', 'Spätere Spielzeit - Gruppe A', '11:00', { stage_id: null }),
                match('earlier', 'Frühere Spielzeit', '09:00'),
                match('finished', 'Beendete Disziplin', '08:00', { state: 'finished' }),
                match('finished', 'Beendete Disziplin', '12:00', { is_match: false }, { _id: 'placeholder' }),
                match('walkover', 'Kampflose Disziplin', '08:00', {}, { score_status: 'no_match' }),
                match('result', 'Ergebnis ohne Statuswechsel', '08:00', {}, { team1_won: false }),
            ];
            const tablet = [];
            await idlePlan(current, games, [], [], (stage, parts) => { if (stage === 'tablet') tablet.push(...parts); });
            const values = decode(tablet).map(row => row.text);
            const eligible = ['Frühes Musterteam', 'Otto Normalverbraucher', 'Max Mustermann',
                'Fertige Anmeldung Musterperson', 'Hans Dampf', 'Erika Musterfrau', 'Ohne nächstes Musterspiel'];
            const position = name => { const index = values.findIndex(text => text.includes(name)); assert(index >= 0, name); return index; };
            eligible.forEach(position);
            assert(position('Frühes Musterteam') < position('Otto Normalverbraucher'));
            assert(position('Otto Normalverbraucher') < position('Max Mustermann'), 'next-game order precedes teams without a known next game');
            for (const name of ['Offene Musterperson', 'Spätere Musterperson', 'Beendetes Musterteam', 'Kampfloses Musterteam',
                'Musterteam mit Ergebnis', 'Abwesende Musterperson', 'Reserve Musterperson']) {
                assert(!values.some(text => text.includes(name)), 'exclude from additional tablet reserve: ' + name);
            }
            delete current.registration_player_statuses['checked1:0'];
            const after = [];
            await idlePlan(current, games, [], [], (stage, parts) => { if (stage === 'tablet') after.push(...parts); });
            assert(!words(after).includes('Max Mustermann'), 'an incomplete check-in must stay outside this reserve tier');
        }
    });
    it('prepares tablet federations and clubs before people and keeps configured state calls in their own phase', async function() {
        for (const mode of ['people', 'state', 'match-state', 'disabled']) {
            const current = { ...fixture(), tabletoperator_enabled: mode !== 'disabled',
                tabletoperator_with_state_enabled: mode === 'state', tabletoperator_with_state_from_match_enabled: mode === 'match-state',
                tabletoperator_use_manual_counting_boards_enabled: mode !== 'people',
                registration_completed_events: { checked: true },
                registration_player_statuses: { 'present:1': { status: 'present' }, 'absent:2': { status: 'absent' } },
                events: { events: [{ id: 'checked', name: 'ME U19', stages: [{ entries: [
                    { entry_id: 'present', team: { players: [{ btp_id: 1, name: 'Max Mustermann', state: 'Musterverband', club: 'Musterverein' }] } },
                    { entry_id: 'absent', team: { players: [{ btp_id: 2, name: 'Abwesende Musterperson', state: 'Abwesender Verband', club: 'Abwesender Verein' }] } },
                ] }] }] } };
            const phases = new Map(['states', 'clubs', 'people', 'numbers'].map(id => [id, []]));
            await idlePlan(current, [], [], [], (stage, parts, detail) => {
                if (stage === 'tablet') phases.get(detail.tablet_phase).push(...parts);
            });
            const all = words([...phases.values()].flat());
            assert(!all.includes('Abwesend'), 'every phase must filter absent players before preparing their labels');
            assert(words(phases.get('states')).includes('Musterverband'));
            assert(words(phases.get('clubs')).includes('Musterverein'));
            assert(words(phases.get('people')).includes('Max Mustermann'), 'general name preparation is independent of tablet settings');
            if (['state', 'match-state'].includes(mode)) {
                assert(words(phases.get('states')).includes('Klapptafelbedienung'));
                assert(!words(phases.get('people')).includes('Klapptafelbedienung'), 'state-based operator calls stay in the federation phase');
            }
            if (mode === 'disabled') assert(!all.includes('Klapptafelbedienung') && !all.includes('Tabletbedienung'));
        }
    });
    it('uses check-in before drawing and treats drawn players as present, including copied player records', async function() {
        for (const context_version of [context.V2, context.VERSION]) {
            const current = { ...fixture(), speech: { context_version }, registration_completed_events: { pair: true },
                registration_player_statuses: { 'pair-entry:1': { status: 'present' }, 'pair-entry:2': { status: 'absent' } } };
            const players = [{ name: 'Max Mustermann', btp_id: 1 }, { name: 'Hans Dampf', btp_id: 2 }];
            current.events = { events: [{ id: 'pair', name: 'MD U19', stages: [{ id: 'pair-stage', stage_type: 1,
                entries: [{ stage_entry_id: 'pair-entry', team: { players } }] }] }] };
            const games = [{ _id: 'next', setup: setup({ stage_id: 'pair-stage', event_name: 'MD U19', court_id: null,
                teams: [{ players: players.map(player => ({ ...player, btp_id: String(player.btp_id) })) }, { players: [] }],
                tabletoperators: null, umpire: null, service_judge: null }) }];
            const reserved = async (drawn = false) => {
                const parts = [];
                await idlePlan(current, drawn ? games : [], [], [], (stage, values) => { if (stage === 'tablet') parts.push(...values); });
                return words(parts);
            };
            const partial = await reserved();
            assert(!partial.includes('Max Mustermann und Hans Dampf'), 'do not prepare an incomplete pairing');
            assert.strictEqual(partial.includes('Max Mustermann'), context_version === context.V2,
                'general v2 name preparation retains the present player even when their partner is absent');
            current.tabletoperator_split_doubles = true;
            let value = await reserved();
            assert(value.includes('Max Mustermann') && !value.includes('Hans Dampf'), 'split calls only include present individuals');
            current.tabletoperator_split_doubles = false;
            current.registration_player_statuses['pair-entry:2'].status = 'present';
            value = await reserved();
            assert(value.includes('Max Mustermann und Hans Dampf'), 'prepare the pairing when both players are present');
            delete current.registration_player_statuses['pair-entry:2'];
            assert(!(await reserved()).includes('Hans Dampf'), 'unknown attendance is not presence');
            current.registration_player_statuses['pair-entry:2'] = { status: 'absent' };
            assert((await reserved(true)).includes('Max Mustermann und Hans Dampf'),
                'the actual draw establishes attendance even when local check-in is missing or stale');
        }
    });
    it('recognizes completed main-field check-in without a separate completed-events flag', function() {
        const current = fixture(), checked = event('Gemeldete Disziplin', 'checked', ['Max Mustermann', 'Hans Dampf']);
        checked.stages[0].stage_type = 1;
        current.events = { events: [checked] };
        current.registration_open_events = { checked: true };
        current.registration_player_statuses = { 'checked0:0': { status: 'present' }, 'checked1:0': { status: 'absent' } };
        const trace = {};
        require('../bts/speech/v2_inventory').registration(current, [], null, trace);
        assert.strictEqual(trace.events[0].state, 'completed');
        assert(!trace.groups.has('completed_teams'));
        assert(![...trace.parts.values()].some(row => row.event_id === 'checked'));
        delete current.registration_player_statuses['checked1:0'];
        require('../bts/speech/v2_inventory').registration(current, [], null, trace);
        assert.strictEqual(trace.events[0].state, 'open');
        assert([...trace.parts.values()].some(row => row.event_id === 'checked' && row.registration_phase === 'open_people'));
    });
});

describe('Context v2 failed-source recovery', function() {
    it('requests a fresh context and then a different name context before stopping', function() {
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
        assert.strictEqual(source.text, 'Wir erwarten Selten Nachname zum nächsten Spiel. Der nächste Aufruf folgt in Kürze.');
        assert.strictEqual(entry.context.text, 'Selten Nachname');
        assert(entry.context.before && entry.context.after);
        fail(source);
        assert.strictEqual(entry.terminal_failure, true);
        broker.stop();
    });

    it('keeps the against connector in its final contextual name fallback', function() {
        const { SpeechBroker, configuration } = require('../bts/speech/broker');
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false }, {}));
        broker.context_version = context.V2;
        const current = fixture(), texts = renderer(current);
        const part = plan(texts, current, 'prepareName', { players: [{ name: 'Selten Nachname' }] }).parts[2];
        broker.prepare([part], { voice: 'hallensprecher', priority: 'normal' }, 'test');
        const entry = broker.entries.get(broker.key(part, 'hallensprecher', 'de-DE'));
        assert(broker.set_fallback(entry, 'name'));
        assert.strictEqual(entry.context.text, 'gegen Selten Nachname');
        assert(broker.entries.get(entry.source_key).text.startsWith('Max Mustermann spielt gegen Selten Nachname'));
        broker.stop();
    });

    it('does not reuse an old isolated V2 fallback under the new contextual provenance', function() {
        const { SpeechBroker, configuration } = require('../bts/speech/broker');
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false }, {}));
        broker.context_version = context.V2;
        const part = plan(renderer(fixture()), fixture(), 'prepareName', { players: [{ name: 'Selten Nachname' }] }).parts[0];
        broker.prepare([part], { voice: 'hallensprecher' }, 'test');
        const entry = broker.entries.get(broker.key(part, 'hallensprecher', 'de-DE'));
        const saved = { fallback_stage: 'name', audio_id: 'a'.repeat(32), job_id: 'b'.repeat(32), processed: true };
        broker.disk = { lookup: (_identity, key) => key === entry.key ? saved : null };
        assert.strictEqual(broker.restore(entry), false);
        assert(entry.context.before && entry.context.after);
        saved.fallback_source_key = entry.source_key;
        assert.strictEqual(broker.restore(entry), true);
        assert.strictEqual(entry.status, 'completed');
        broker.stop();
    });

    it('allows a new V2 name context after an old terminal failure and persists its new limit', function() {
        const { SpeechBroker, configuration } = require('../bts/speech/broker');
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false }, {}));
        broker.context_version = context.V2;
        const part = plan(renderer(fixture()), fixture(), 'prepareName', { players: [{ name: 'Selten Nachname' }] }).parts[0];
        const key = broker.key(part, 'hallensprecher', 'de-DE');
        broker.failures.remember_recovery(broker.identity, key, 'name', true);
        broker.prepare([part], { voice: 'hallensprecher' }, 'test');
        const entry = broker.entries.get(key);
        assert.notStrictEqual(entry.terminal_failure, true);
        assert(entry.context.before && entry.context.after);
        entry.terminal_failure = true; broker.remember_recovery(entry);
        entry.terminal_failure = false; entry.recovery_loaded = false;
        broker.restore_recovery(entry);
        assert.strictEqual(entry.terminal_failure, true, 'restarting must not retry the same exhausted context forever');
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
