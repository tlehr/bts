'use strict';

const assert = require('assert');
const { describeGames } = require('../bts/speech/game_status');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { plan } = require('../bts/speech/coverage');
const { handle } = require('../bts/speech');
const { renderer } = require('../bts/speech/text');

const voice = 'hallensprecher', key = 'default';
const tournament = () => ({ key, language: 'de', name: 'Testturnier',
    annoncement_include_event: true, annoncement_include_round: true, annoncement_include_matchnumber: true,
    locations: [{ _id: 'hall', name: 'Testhalle' }], courts: [{ _id: 'court_4', num: 4, location_id: 'hall', is_active: true }],
    speech: { context_version: 'bts-context-v2' } });
const game = (id, number, setup = {}, extra = {}) => ({ _id: id, match_order: number, ...extra,
    setup: { state: 'scheduled', is_match: true, match_num: number, event_name: 'MX U17', match_name: 'VF',
        scheduled_date: '2026-10-24', scheduled_time_str: '10:00', court_id: 'court_4', location_id: 'hall',
        teams: [{ players: [{ name: 'Anna Beispiel' }] }, { players: [{ name: 'Berta Muster' }] }], ...setup } });
async function fixture(matches = [game('a', 17)], context = tournament()) {
    const broker = new SpeechBroker(configuration({ enabled: true, cache_enabled: false, api_key: 'games-test-' + 'x'.repeat(32) }, {}));
    broker.context_version = context.speech.context_version;
    const targets = await plan(context, matches);
    await broker.coverage.set_plan(key, voice, targets);
    const snapshot = (id, revision) => broker.coverage.game_status(key, voice, id, revision);
    const warm = () => {
        for (const [part] of targets) if (targets.get(part).part) {
            broker.prepare([part], { voice, language: 'de-DE', priority: 'idle' }, key);
        }
        for (const entry of broker.entries.values()) { entry.status = 'completed'; entry.local = false; }
    };
    return { broker, targets, snapshot, warm, context };
}

describe('Per-game speech preparation status', function() {
    it('shows the actual game state independently of speech readiness and stale setup states', function() {
        const matches = [game('running', 1, { state: 'ready', now_on_court: true }),
            game('preparation', 2, { state: 'preparation' }), game('done', 3, { state: 'ready' }, { team1_won: false }),
            game('walkover', 4, {}, { score_status: 'no_match' }), game('unknown', 5, { incomplete: true }),
            game('blocked', 6, { state: 'blocked' }), game('planned', 7)];
        assert.deepStrictEqual(describeGames(tournament(), matches).map(row => row.match_state),
            ['oncourt', 'preparation', 'finished', 'finished', 'incomplete', 'blocked', 'scheduled']);
        assert.deepStrictEqual(describeGames(tournament(), matches, ['running', 'preparation', 'done', 'planned']).map(row => row.match_state),
            ['oncourt', 'preparation', 'finished', 'finished', 'incomplete', 'blocked', 'candidate']);
    });
    it('uses the normal schedule order including completed games without mutating matches', function() {
        const matches = [game('later', 2, { scheduled_time_str: '11:00' }), game('zero', 8, {}, { match_order: 0 }),
            game('done', 3, { state: 'finished' }, { team1_won: true }), game('first', 1),
            game('not-a-game', 0, { is_match: false }), { _id: 'no-setup' }];
        const before = structuredClone(matches);
        assert.deepStrictEqual(describeGames(tournament(), matches).map(row => row.id), ['first', 'done', 'zero', 'later']);
        assert.deepStrictEqual(matches, before);
    });

    for (const version of ['bts-context-v2', 'bts-context-v1', null]) {
        it('reports the actual complete playback pieces without submitting work: ' + version, async function() {
            const context = tournament(); context.speech.context_version = version;
            const f = await fixture(undefined, context), setup = game('a', 17).setup;
            const output = [], texts = renderer(context, 'de', output);
            texts.announceNewMatch(setup);
            const expected = [...new Set(version ? output : texts.localParts(output))];
            let result = await f.snapshot('a');
            const call = result.detail.announcements.find(call => call.group === 'D01');
            assert.strictEqual(call.total, expected.length);
            assert.strictEqual(call.missing, expected.length);
            assert.deepStrictEqual(new Set(call.components.map(part => part.id)), new Set(expected.map(part => f.broker.key(part, voice, 'de-DE'))));
            f.warm();
            const entries = f.broker.entries.size;
            f.broker.prepare = () => { throw new Error('status must not generate'); };
            result = await f.snapshot('a');
            assert.strictEqual(result.items[0].state, 'ready');
            assert(result.detail.announcements.every(call => call.state === 'ready'));
            assert.strictEqual(f.broker.entries.size, entries);
            assert.strictEqual(f.broker.current, null);
        });
    }

    it('counts reused pieces once per game and refreshes every affected call when a piece completes', async function() {
        const f = await fixture([game('a', 17), game('b', 18)]);
        f.warm();
        const calls = f.broker.coverage.plans.get(key).calls.filter(call => call.match_id === 'a');
        const used = new Map();
        for (const call of calls) for (const part of call.keys) used.set(part, (used.get(part) || 0) + 1);
        const shared = [...used].find(([, count]) => count > 1)[0], entry = f.broker.entries.get(shared);
        entry.status = 'processing';
        const before = await f.snapshot('a');
        const row = before.items.find(row => row.id === 'a');
        assert.strictEqual(row.missing, 1, 'a shared piece counts only once across variants');
        assert.strictEqual(row.processing, 1);
        assert(before.detail.announcements.filter(call => call.components.some(part => part.id === shared)).every(call => call.state === 'processing'));
        entry.status = 'completed';
        const after = await f.snapshot('a', before.revision);
        assert.strictEqual(after.items[0].missing, 0);
        assert.notStrictEqual(after.revision, before.revision);
        const unchanged = await f.snapshot('a', after.revision);
        assert.strictEqual(unchanged.unchanged, true);
        assert(!Object.hasOwn(unchanged, 'items'), 'do not transfer unchanged game rows');
        assert(unchanged.detail.announcements.length > 0, 'details remain available independently of row changes');
    });

    it('distinguishes an open field assignment from unknown participants with a completely warm cache', async function() {
        const f = await fixture([game('no-field', 17, { court_id: null }),
            game('unknown', 18, { teams: [null, { players: [] }], incomplete: true })]);
        f.warm();
        let result = await f.snapshot('no-field');
        const noField = result.items.find(row => row.id === 'no-field');
        assert.strictEqual(noField.missing, 0);
        assert.strictEqual(noField.state, 'ready');
        assert.strictEqual(noField.blocked, false);
        assert.deepStrictEqual(noField.reasons, []);
        assert.strictEqual(noField.columns.find(column => column.id === 'call').state, 'ready');
        assert.strictEqual(noField.columns.find(column => column.id === 'preparation').state, 'ready');
        assert(result.detail.announcements.every(call => call.state === 'ready' && !call.unresolved));
        assert(result.detail.announcements.some(call => call.group === 'D03' && call.total > 0));
        result = await f.snapshot('unknown');
        assert.strictEqual(result.items.find(row => row.id === 'unknown').state, 'blocked');
        assert(result.items.find(row => row.id === 'unknown').reasons.includes('Teilnehmer noch unbekannt'));
        assert(result.detail.announcements.some(call => call.unresolved?.includes('Teilnehmer')));
        assert.strictEqual(f.broker.current, null);
    });

    it('still reports outstanding audio when the field assignment is also open', async function() {
        const f = await fixture([game('no-field', 17, { court_id: null })]);
        f.warm();
        const current = f.broker.coverage.game_plans.get(key);
        const part = current.calls.find(call => call.match_id === 'no-field' && call.group === 'D01').keys[0];
        const entry = f.broker.entries.get(part);
        for (const [status, state] of [['processing', 'processing'], ['queued', 'queued'], ['failed', 'failed'], ['completed', 'ready']]) {
            entry.status = status;
            const result = await f.snapshot('no-field');
            const row = result.items[0];
            assert.strictEqual(row.state, state);
            assert.strictEqual(row.blocked, false);
            assert.strictEqual(row.missing, status === 'completed' ? 0 : 1);
        }
        await f.broker.coverage.set_plan(key, voice, await plan(f.context, [game('no-field', 17)]));
        const assigned = await f.snapshot('no-field');
        assert.strictEqual(assigned.items[0].state, 'ready');
        assert.deepStrictEqual(assigned.items[0].reasons, []);
    });

    it('keeps an unknown assigned field visible as a concrete configuration problem', async function() {
        const f = await fixture([game('unknown-field', 17, { court_id: 'missing_99' })]);
        f.warm();
        const result = await f.snapshot('unknown-field');
        assert.strictEqual(result.items[0].state, 'blocked');
        assert.deepStrictEqual(result.items[0].reasons, ['Spielfeld nicht im aktuellen Plan vorhanden']);
    });

    for (const version of ['bts-context-v2', 'bts-context-v1', null]) {
        it('checks every eligible field before an assignment and only the chosen field afterwards: ' + version, async function() {
            const context = tournament(); context.speech.context_version = version;
            context.locations.push({ _id: 'other', name: 'Andere Halle' });
            context.courts.push({ _id: 'court_5', num: 5, location_id: 'hall', is_active: true },
                { _id: 'court_9', num: 9, location_id: 'other', is_active: true },
                { _id: 'court_6', num: 6, location_id: 'hall', is_active: false });
            const f = await fixture([game('open', 17, { court_id: null })], context);
            f.warm();
            const calls = (await f.snapshot('open')).detail.announcements;
            const call = calls.find(call => call.group === 'D01');
            const expected = new Set();
            for (const court_id of ['court_4', 'court_5']) {
                const output = [], texts = renderer(context, 'de', output);
                texts.announceNewMatch(game('open', 17, { court_id }).setup);
                for (const part of version ? output : texts.localParts(output)) expected.add(f.broker.key(part, voice, 'de-DE'));
            }
            assert.deepStrictEqual(new Set(call.components.map(part => part.id)), expected);
            assert.strictEqual(call.state, 'ready');
            assert.deepStrictEqual(calls.filter(call => call.group === 'D03').map(call => call.label),
                ['Spielbeginn · Feld 4', 'Spielbeginn · Feld 5']);
            const court4 = new Set((await plan(context, [game('open', 17)])).announcements
                .filter(call => call.match_id === 'open').flatMap(call => call.parts));
            const field5 = call.components.find(part => !court4.has(f.broker.entries.get(part.id).part));
            assert(field5);
            f.broker.entries.get(field5.id).status = 'processing';
            let result = await f.snapshot('open');
            assert.strictEqual(result.items[0].state, 'processing');
            assert.strictEqual(result.items[0].missing, 1);
            assert.strictEqual(result.items[0].blocked, false);
            const openTotal = result.items[0].total;
            await f.broker.coverage.set_plan(key, voice, await plan(context, [game('open', 17)]));
            result = await f.snapshot('open');
            assert.strictEqual(result.items[0].state, 'ready', 'a missing piece for an unused field does not block an assigned game');
            assert(result.items[0].total < openTotal);
            assert.strictEqual(f.broker.current, null);
        });
    }

    it('checks all active locations when both the field and the hall are still open', async function() {
        const context = tournament();
        context.locations.push({ _id: 'other', name: 'Andere Halle' });
        context.courts.push({ _id: 'court_9', num: 9, location_id: 'other', is_active: true });
        const f = await fixture([game('open', 17, { court_id: null, location_id: null })], context);
        f.warm();
        const result = await f.snapshot('open');
        assert.strictEqual(result.items[0].state, 'ready');
        assert.deepStrictEqual(result.detail.announcements.filter(call => call.group === 'D03').map(call => call.label),
            ['Spielbeginn · Feld 4', 'Spielbeginn · Feld 9']);
    });

    it('does not claim readiness when the selected location has no active fields', async function() {
        const context = tournament(); context.courts[0].is_active = false;
        const f = await fixture([game('open', 17, { court_id: null })], context); f.warm();
        const result = await f.snapshot('open');
        assert.strictEqual(result.items[0].state, 'blocked');
        assert.deepStrictEqual(result.items[0].reasons, ['Kein aktives Spielfeld verfügbar']);
    });

    it('proves unknown pairings ready from the complete discipline roster without predicting opponents', async function() {
        const context = tournament();
        const teams = ['Anna Beispiel', 'Berta Muster', 'Clara Beispiel'].map(name => ({ players: [{ name }] }));
        context.events = { events: [{ name: 'MX U17', stages: [{ id: 17, entry_count: 3, entries: teams.map(team => ({ team })) },
            { stage_type: 9998, entries: [{ team: { players: [{ name: '' }] } }] },
            { stage_type: 9999, entries: [{ team: { players: [] } }] }] },
            { name: 'MX U19', stages: [{ entries: [{ team: { players: [{ name: '' }] } }] }] }] };
        const unknown = game('unknown', 17, { stage_id: 17, court_id: null, teams: [null, { players: [] }], incomplete: true });
        const f = await fixture([unknown], context); f.warm();
        let result = await f.snapshot('unknown');
        assert.strictEqual(result.items[0].state, 'ready');
        assert.strictEqual(result.items[0].match_state, 'incomplete', 'speech readiness must not invent actual participants');
        assert.deepStrictEqual(result.items[0].teams, ['', '']);
        assert(result.detail.announcements.filter(call => call.group !== 'D03').every(call => call.label.includes('Alle Teilnehmer der Disziplin')));
        assert(result.detail.announcements.every(call => !call.unresolved));
        const expected = new Map(result.detail.announcements.map(call => [call.group,
            new Set(result.detail.announcements.filter(other => other.group === call.group).flatMap(other => other.components.map(part => part.id)))]));
        for (const first of teams) for (const second of teams) if (first !== second) {
            const actual = await plan(context, [game('unknown', 17, { stage_id: 17, teams: [first, second] })]);
            for (const call of actual.announcements.filter(call => call.match_id === 'unknown')) {
                assert(call.parts.every(part => expected.get(call.group).has(f.broker.key(part, voice, 'de-DE'))),
                    'the roster pool must cover the actual playback pieces for any pairing');
            }
        }
        const decode = require('../bts/speech/context').decode;
        const againstClara = [...f.broker.entries.values()].find(entry => decode(entry.part, 10000)?.text === 'gegen Clara Beispiel');
        assert(againstClara);
        againstClara.status = 'processing';
        result = await f.snapshot('unknown');
        assert.strictEqual(result.items[0].state, 'processing');
        assert.strictEqual(result.items[0].missing, 1);
        assert.strictEqual(result.items[0].blocked, false);
        const resolved = game('unknown', 17, { stage_id: 17, teams: teams.slice(0, 2) });
        await f.broker.coverage.set_plan(key, voice, await plan(context, [resolved]));
        result = await f.snapshot('unknown');
        assert.strictEqual(result.items[0].state, 'ready', 'unused possible participants no longer affect a concrete pairing');
        assert.strictEqual(f.broker.current, null);
    });

    it('requires complete doubles pairs in the roster and verifies their positional clips', async function() {
        const context = tournament();
        const teams = [['Anna Beispiel', 'Berta Muster'], ['Clara Beispiel', 'Dora Muster']]
            .map(names => ({ players: names.map(name => ({ name })) }));
        context.events = { events: [{ name: 'MX U17', stages: [{ entry_count: 2, entries: teams.map(team => ({ team })) }] }] };
        const unknown = game('unknown', 17, { is_doubles: true, court_id: null, teams: [null, null], incomplete: true });
        const f = await fixture([unknown], context); f.warm();
        let result = await f.snapshot('unknown');
        assert.strictEqual(result.items[0].state, 'ready');
        const decode = require('../bts/speech/context').decode;
        const clip = [...f.broker.entries.values()].find(entry => decode(entry.part, 10000)?.text === 'gegen Clara Beispiel und Dora Muster');
        assert(clip);
        clip.status = 'processing';
        result = await f.snapshot('unknown');
        assert.strictEqual(result.items[0].missing, 1);
        assert.strictEqual(result.items[0].state, 'processing');
        context.events.events[0].stages[0].entries[1].team = { players: [{ name: 'Clara Beispiel' }] };
        await f.broker.coverage.set_plan(key, voice, await plan(context, [unknown]));
        result = await f.snapshot('unknown');
        assert.strictEqual(result.items[0].state, 'blocked', 'a partially known pair must not be inferred from other names');
        assert(result.items[0].reasons.includes('Teilnehmer noch unbekannt'));
    });

    it('does not assume that a partially imported roster is complete', async function() {
        const context = tournament();
        context.events = { events: [{ name: 'MX U17', stages: [{ entry_count: 2,
            entries: [{ team: { players: [{ name: 'Anna Beispiel' }] } }],
        }] }] };
        const f = await fixture([game('unknown', 17, { teams: [null, null], incomplete: true })], context); f.warm();
        assert.strictEqual((await f.snapshot('unknown')).items[0].state, 'blocked');
    });

    it('shows failed and terminal parts, and uses verified disk audio independently of retained queue entries', async function() {
        const f = await fixture(); f.warm();
        const entry = f.broker.entries.values().next().value;
        entry.status = 'failed'; entry.terminal_failure = true;
        let result = await f.snapshot('a');
        assert.strictEqual(result.items[0].failed, 1);
        assert.strictEqual(result.items[0].queued, 0);
        assert.strictEqual(result.items[0].state, 'failed');
        const savedKey = entry.key;
        f.broker.entries.delete(savedKey);
        f.broker.disk = { lookup: (_identity, part) => part === savedKey ? { audio_id: 'saved' } : null };
        result = await f.snapshot('a');
        assert.strictEqual(result.items[0].state, 'ready');
        f.broker.disk.lookup = () => null;
        result = await f.snapshot('a');
        assert.strictEqual(result.items[0].missing, 1, 'an absent or unverified file cannot count as ready');
    });

    it('does not reuse the previous voice and returns only the requested game details', async function() {
        const f = await fixture([game('a', 17), game('b', 18)]); f.warm();
        assert.strictEqual((await f.snapshot('a')).detail.id, 'a');
        assert.strictEqual((await f.snapshot('absent')).detail, null);
        const otherVoice = await f.broker.coverage.game_status(key, 'hallensprecherin', 'a');
        assert.deepStrictEqual(otherVoice.items, []);
        assert.strictEqual(otherVoice.updating, true);
    });

    it('labels team, winning-side and hall variants and keeps incomplete doubles unresolved', async function() {
        const context = tournament(); context.locations.push({ _id: 'other-hall', name: 'Zweite Halle' });
        const f = await fixture([game('a', 17, { location_id: null }), game('doubles', 18, { is_doubles: true })], context);
        const result = await f.snapshot('a');
        assert(result.detail.announcements.some(call => call.label.includes('Team 1')));
        assert(result.detail.announcements.some(call => call.label.includes('Team 2')));
        assert(result.detail.announcements.some(call => call.group === 'D12' && call.label.includes('Sieg für Team 2')));
        assert(result.detail.announcements.some(call => call.group === 'D02' && call.label.includes('Zweite Halle')));
        f.warm();
        const doubles = await f.snapshot('doubles');
        assert.strictEqual(doubles.items.find(row => row.id === 'doubles').state, 'blocked');
        assert(doubles.detail.announcements.some(call => call.unresolved?.includes('Teilnehmer')));
    });

    it('requires a loaded tournament and validates detail requests on the existing admin channel', async function() {
        const f = await fixture(), app = { speech: { broker: f.broker, prefetch: { settings: () => ({ voice, mode: 'auto' }) } } };
        const request = async (message, loaded = key) => {
            let result;
            await handle(app, { speech_tournament_key: loaded, respond: (_msg, _error, value) => { result = value; } },
                { type: 'speech_games', tournament_key: key, ...message });
            return result;
        };
        assert.strictEqual((await request({}, 'elsewhere')).speech_error, 'tournament_not_loaded');
        assert.strictEqual((await request({ match_id: {} })).speech_error, 'invalid_speech_request');
        assert.strictEqual((await request({ revision: 'not-a-revision' })).speech_error, 'invalid_speech_request');
        assert.strictEqual((await request({ match_id: 'a' })).games.detail.id, 'a');
        assert.strictEqual(f.broker.entries.size, 0, 'opening the page adds no jobs');
    });

    it('yields while inspecting a large schedule and inspects each shared component once per request', async function() {
        const f = await fixture(Array.from({ length: 90 }, (_, i) => game('m' + i, i + 1)));
        const lookups = new Map();
        f.broker.disk = { lookup(_identity, part) { lookups.set(part, (lookups.get(part) || 0) + 1); return null; } };
        let yielded = false;
        setImmediate(() => { yielded = true; });
        const result = await f.snapshot();
        assert(yielded);
        assert.strictEqual(result.items.length, 90);
        assert([...lookups.values()].every(count => count === 1));
    });
});
