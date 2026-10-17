'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { promisify } = require('util');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { Prefetcher } = require('../bts/speech/prefetch');
const database = require('../bts/database');
const idlePlan = require('../bts/speech/idle_plan');
const context = require('../bts/speech/context');
const { renderer } = require('../bts/speech/text');
const { tournament, setup } = require('./test_speech_text');

const voice = 'hallensprecher';
const key = 'default';
const team = name => ({ players: [{ name }] });
const game = (id, overrides) => ({ _id: id, setup: setup({ tabletoperators: null, umpire: null, service_judge: null, ...overrides }) });
const selected = () => ({ ...tournament(), tabletoperator_enabled: true, speech: { context_version: 'bts-context-v1' } });
const names = parts => parts.map(part => context.decode(part, 1200)?.text).filter(text => text?.startsWith('Tabletbedienung:'));
const id = () => crypto.randomBytes(16).toString('hex');
function service(options = {}) {
    let clock = 1000;
    const posts = [];
    const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-idle-' + 'x'.repeat(32), ...options }, {}), {
        now: () => clock,
        request: async (_base, _key, method, _route, body) => {
            assert.strictEqual(method, 'POST'); posts.push(body);
            return { ...body, job_id: id(), status: 'completed', cache_hit: false,
                audio: { audio_id: id(), processed: !!body.context } };
        },
    });
    broker.context_version = 'bts-context-v1';
    return { broker, posts, advance: (ms = 1000) => { clock += ms; } };
}

describe('Speech preparation only during idle time', function() {
    it('prepares imminent tablet candidates before later games and remaining registrations of active disciplines', async function() {
        const current = selected();
        current.events = { events: [
            { id: 1, name: 'JE U17', stages: [{ id: 11, entries: [
                { team: team('Noch ohne Gegner') }, { team: team('Früh A') },
            ] }] },
            { id: 2, name: 'MD U19', stages: [{ id: 22, entries: [{ team: team('Andere Disziplin') }] }] },
        ] };
        const matches = [
            game('late', { stage_id: 11, match_num: 20, scheduled_time_str: '11:00', teams: [team('Spät A'), team('Spät B')] }),
            game('early', { stage_id: 11, match_num: 21, scheduled_time_str: '10:00', teams: [team('Früh A'), team('Früh B')] }),
            game('prep', { stage_id: 11, event_name: 'JE U17 - Gruppe A', state: 'preparation', teams: [team('Vorbereitet A'), team('Vorbereitet B')] }),
            game('other', { stage_id: 22, event_name: 'MD U19', teams: [team('Andere Disziplin'), team('Weitere Andere')] }),
            game('unknown', { stage_id: 11, state: 'incomplete', teams: [team('Bekannt ohne Paarung'), { players: [] }] }),
            game('finished', { stage_id: 11, state: 'finished', teams: [team('Schon fertig A'), team('Schon fertig B')] }),
        ];
        const parts = await idlePlan(current, matches);
        assert.deepStrictEqual(names(parts), ['Vorbereitet A', 'Vorbereitet B', 'Früh A', 'Früh B',
            'Spät A', 'Spät B', 'Bekannt ohne Paarung', 'Noch ohne Gegner'].map(name => 'Tabletbedienung:' + name));
        assert.strictEqual(new Set(parts).size, parts.length);
        assert(!names(parts).some(part => part.includes('Andere Disziplin')));
        assert(parts.some(part => part.includes('Andere Disziplin')), 'future game blocks also belong to idle inventory');
        assert(!parts.some(part => part.includes('Schon fertig')));
        const observed = [], texts = renderer(current, 'de', observed);
        texts.announceSecondCallTabletoperator({ tabletoperators: team('Früh A').players });
        texts.announceSecondPreparationCallTabletoperator({ tabletoperators: team('Früh A').players });
        texts.announceSecondPreparationCallTabletoperator({ tabletoperators: team('Früh A').players, location_id: 'default_h1' });
        assert(observed.every(part => parts.includes(part)), 'idle inventory must use the exact later playback recipes');
    });

    it('prioritizes on-court games, preparation and candidates while keeping BTS list order within each tier', async function() {
        const current = selected();
        const match = (id, time, overrides = {}, extra = {}) => ({ ...game(id, {
            scheduled_date: '2026-10-17', scheduled_time_str: time, teams: [team(id), { players: [] }], ...overrides,
        }), ...extra });
        const matches = [
            match('Feld', '08:00', { state: 'oncourt', now_on_court: true, called_timestamp: 200 }),
            match('Feld ohne Status', '08:15', { now_on_court: true, called_timestamp: 100 }),
            match('Vorbereitung', '11:00', { state: 'preparation', preparation_call_timestamp: 300, teams: [team('Vorbereitung'), team('Früh')] }),
            match('Vorbereitung früher', '10:30', { state: 'preparation', preparation_call_timestamp: 400 }),
            match('Kandidat', '12:00'),
            match('Kandidat später', '12:30'),
            match('Früh', '09:00'),
            match('Unvollständig', '08:30', { state: 'incomplete' }),
            match('Manuell später', '10:00', { match_num: 2 }, { match_order: 20 }),
            match('Manuell früher', '10:00', { match_num: 99 }, { match_order: 10 }),
            match('Ohne Uhrzeit', null, { match_num: 0 }),
            match('Platzhalterzeit', '00:00', { match_num: 1 }),
        ];
        const parts = await idlePlan(current, matches, [], ['Kandidat später', 'Kandidat']);
        assert.deepStrictEqual(names(parts), ['Feld ohne Status', 'Feld', 'Vorbereitung', 'Früh', 'Vorbereitung früher',
            'Kandidat', 'Kandidat später', 'Unvollständig', 'Manuell früher', 'Manuell später',
            'Platzhalterzeit', 'Ohne Uhrzeit'].map(name => 'Tabletbedienung:' + name));
        assert.strictEqual(names(parts).filter(name => name === 'Tabletbedienung:Früh').length, 1,
            'a team appearing in several games keeps its most urgent place');
    });

    it('uses preferred candidates to start a quiet discipline and respects doubles, state and counting-board settings', async function() {
        const current = selected();
        const doubles = { players: [{ name: 'Erste', state: 'Bremen' }, { name: 'Zweite', state: 'Bremen' }] };
        const matches = [game('earlier', { match_num: 1, event_name: 'MD U19', teams: [team('Nicht aktiv'), team('Auch nicht')] }),
            game('candidate', { match_num: 50, teams: [doubles, team('Gegner')] })];
        let parts = await idlePlan(current, matches, [], ['candidate']);
        assert(names(parts).includes('Tabletbedienung:Erste und Zweite'));
        assert(!names(parts).some(part => part.includes('Nicht aktiv')));
        current.tabletoperator_split_doubles = true;
        parts = await idlePlan(current, matches, [], ['candidate']);
        assert(names(parts).includes('Tabletbedienung:Erste'));
        assert(names(parts).includes('Tabletbedienung:Zweite'));
        assert(!names(parts).some(part => part.includes('Erste und Zweite')));
        current.tabletoperator_with_state_enabled = true;
        current.tabletoperator_use_manual_counting_boards_enabled = true;
        parts = await idlePlan(current, matches, [], ['candidate']);
        const roles = parts.map(part => context.decode(part, 1200)?.text).filter(text => text?.startsWith('Klapptafelbedienung:'));
        assert.strictEqual(roles.filter(text => text === 'Klapptafelbedienung:Bremen').length, 1);
        current.tabletoperator_enabled = false;
        assert.deepStrictEqual(names(await idlePlan(current, matches)), []);
        const officials = await idlePlan(current, matches, [{ name: 'Alexandra Becker' }]);
        assert(officials.some(part => context.decode(part, 1200)?.text === 'Schiedsrichter:Alexandra Becker'));
    });

    it('keeps inventory out of the queue until ordinary work is finished and sends only protocol priorities', async function() {
        const { broker, posts, advance } = service();
        broker.reconcile_prefetch(key, [], { voice, idle_parts: ['Später A', 'Später B'] });
        assert.strictEqual(broker.entries.size, 0);
        assert.strictEqual(broker.queue(key).items.length, 0, 'queue reads must not start inventory work');
        broker.prepare(['Regulär'], { voice, priority: 'low', prefetch: true }, key);
        await broker.step(); advance();
        assert.deepStrictEqual(posts.map(post => post.text), ['Regulär']);
        await broker.step(); advance();
        assert.deepStrictEqual(posts.map(post => post.text), ['Regulär', 'Später A']);
        assert(![...broker.entries.values()].some(entry => entry.text === 'Später B'), 'admit one piece at a time');
        await broker.step(); advance();
        assert.deepStrictEqual(posts.map(post => post.text), ['Regulär', 'Später A', 'Später B']);
        assert(posts.every(post => post.priority === 'low'));
        const reserve = broker.queue(key).items.filter(item => item.idle);
        assert.strictEqual(reserve.length, 2);
        assert(reserve.every(item => item.priority === 'idle' && item.status === 'completed'));
    });

    it('applies a revised idle order to already admitted cuts and their sources before dispatch', async function() {
        const { broker, posts, advance } = service();
        const before = 'Auf Spielfeld acht! ';
        const part = text => '~bts-context-v1~' + JSON.stringify({ before, text, after: '', kind: 'generic' });
        const earlier = part('Tabletbedienung:Früheres Spiel'), later = part('Tabletbedienung:Späteres Spiel');
        broker.reconcile_prefetch(key, [], { voice, idle_parts: [later, earlier] });
        broker.admit_idle();
        advance();
        broker.reconcile_prefetch(key, [], { voice, idle_parts: [earlier, later] });
        for (let i = 0; i < 5; i++) { await broker.step(); advance(); }
        assert.deepStrictEqual(posts.map(post => post.text), [before + 'Tabletbedienung:Früheres Spiel',
            'Tabletbedienung:Früheres Spiel', before + 'Tabletbedienung:Späteres Spiel', 'Tabletbedienung:Späteres Spiel']);
    });

    it('does not fill retry delays for ordinary work with speculative requests', async function() {
        const { broker, posts, advance } = service();
        broker.prepare(['Regulär'], { voice, priority: 'low', prefetch: true }, key);
        const regular = [...broker.entries.values()][0];
        regular.status = 'failed'; regular.retry_at = 10000;
        broker.reconcile_prefetch(key, ['Regulär'], { voice, idle_parts: ['Reserve'] });
        await broker.step(); advance(12000);
        await broker.step();
        assert.strictEqual(posts.length, 0);
        assert.strictEqual(broker.entries.size, 1);
        broker.prepare(['Regulär'], { voice, priority: 'low', prefetch: true }, key);
        await broker.step(); advance(); await broker.step();
        assert.deepStrictEqual(posts.map(post => post.text), ['Regulär', 'Reserve']);
    });

    it('pauses reserve as soon as a tournament update is scheduled while actual calls still have immediate access', async function() {
        const { broker, posts, advance } = service();
        const prefetch = new Prefetcher({}, broker);
        prefetch.configure({ key, announcement_speech_voice: voice }, false);
        broker.reconcile_prefetch(key, [], { voice, idle_parts: ['Reserve'] });
        try {
            prefetch.schedule(key);
            await broker.step();
            assert.strictEqual(posts.length, 0, 'the new ordinary plan must be read before admitting reserve');
            broker.prepare(['Jetzt aufrufen'], { voice, priority: 'high' }, key);
            await broker.step(); advance();
            assert.strictEqual(posts[0].text, 'Jetzt aufrufen');
            await broker.step();
            assert.strictEqual(posts.length, 1);
        } finally { prefetch.stop(); }
        await broker.step();
        assert.strictEqual(posts[1].text, 'Reserve');
    });

    it('does not let an exhausted name fallback block all useful idle work forever', async function() {
        const { broker, posts } = service();
        const recipe = '~bts-context-v1~' + JSON.stringify({ before: '', text: 'Ein Name', after: ' gegen Andere.', kind: 'team' });
        broker.prepare([recipe], { voice, prefetch: true }, key);
        const entry = broker.entries.get(broker.key(recipe, voice, 'de-DE'));
        broker.set_team_fallback(entry, 'name');
        entry.status = 'failed'; entry.terminal_failure = true;
        broker.entries.get(entry.source_key).status = 'failed';
        broker.reconcile_prefetch(key, [recipe], { voice, idle_parts: ['Andere Reserve'] });
        assert.strictEqual(broker.regular_work_pending(), false);
        await broker.step();
        assert.deepStrictEqual(posts.map(post => post.text), ['Andere Reserve']);
    });

    it('finishes an accepted idle job alone, then immediately serves a new actual call', async function() {
        const { broker, posts, advance } = service();
        let active, done = false;
        broker.request = async (_base, _key, method, _route, body) => {
            if (method === 'POST') {
                assert(!active, 'never open a second server job');
                posts.push(body); active = { ...body, job_id: id(), status: 'processing' };
            }
            const result = done ? { ...active, status: 'completed', audio: { audio_id: id() } } : active;
            if (done) active = null;
            return result;
        };
        broker.reconcile_prefetch(key, [], { voice, idle_parts: ['Erste Reserve', 'Zweite Reserve'] });
        await broker.step(); advance(3000);
        broker.prepare(['Jetzt benötigt'], { voice, priority: 'high' }, key);
        await broker.step(); advance(3000);
        assert.strictEqual(posts.length, 1);
        done = true;
        await broker.step(); advance(); await broker.step(); advance();
        assert.deepStrictEqual(posts.map(post => post.text), ['Erste Reserve', 'Jetzt benötigt']);
        await broker.step();
        assert.strictEqual(posts[2].text, 'Zweite Reserve');
    });

    it('promotes a context piece and its source when needed, then returns expired requests to the idle tier', async function() {
        const { broker, advance } = service();
        const recipe = '~bts-context-v1~' + JSON.stringify({ before: 'Auf Spielfeld acht! ', text: 'Tabletbedienung:Ein Team',
            after: '', kind: 'generic' });
        broker.reconcile_prefetch(key, [], { voice, idle_parts: [recipe] });
        broker.admit_idle();
        const entry = broker.entries.get(broker.key(recipe, voice, 'de-DE'));
        const source = broker.entries.get(entry.source_key);
        assert.strictEqual(source.priority, 3);
        assert(source.idle_tournaments.has(key));
        broker.prepare([recipe], { voice, priority: 'high' }, key);
        assert.strictEqual(entry.priority, 0);
        assert.strictEqual(source.priority, 0);
        advance(10001);
        broker.reconcile_prefetch(key, [], { voice, idle_parts: [recipe] });
        assert.strictEqual(entry.priority, 3);
        assert.strictEqual(source.priority, 3);
        broker.prepare(['Vorrang'], { voice, priority: 'low' }, key);
        assert.deepStrictEqual(broker.pending_order().map(item => item.text), ['Vorrang']);
        broker.reconcile_prefetch(key, [], { voice });
        assert(!broker.entries.has(entry.key));
        assert(!broker.entries.has(source.key));
    });

    it('reuses finished reserve without new generation, counts it as stock and promotes it to needed on use', async function() {
        const { broker, posts, advance } = service();
        await broker.coverage.set_plan(key, voice, new Map([['Reserve', { part: 'Reserve', groups: new Set(['D08']) }]]));
        broker.reconcile_prefetch(key, [], { voice, idle_parts: ['Reserve'] });
        assert.strictEqual(broker.queue(key).coverage.total.potential, 1);
        await broker.step(); advance();
        assert.strictEqual(broker.queue(key).coverage.total.stock, 1);
        broker.reconcile_prefetch(key, [], { voice, idle_parts: ['Reserve'] });
        await broker.step(); advance();
        assert.strictEqual(posts.length, 1);
        broker.prepare(['Reserve'], { voice, priority: 'normal', prefetch: true }, key);
        assert.strictEqual(broker.queue(key).coverage.total.generated, 1);
        assert.strictEqual(broker.queue(key).items[0].idle, false);
        await broker.step();
        assert.strictEqual(posts.length, 1);
    });

    it('checks the persistent cache before admitting reserve and discards obsolete inventory on voice change', async function() {
        const { broker, posts } = service();
        const cached = broker.key('Gespeichert', voice, 'de-DE');
        broker.disk = { ready: Promise.resolve(), lookup: (_identity, lookup) => lookup === cached ? { audio_id: id() } : null };
        broker.reconcile_prefetch(key, [], { voice, idle_parts: ['Gespeichert'] });
        await broker.step();
        assert.strictEqual(broker.entries.size, 0);
        assert.strictEqual(posts.length, 0);
        broker.reconcile_prefetch(key, [], { voice, idle_parts: ['Nicht mehr nötig'] });
        broker.select_voice(key, 'hallensprecherin');
        await broker.step();
        assert.strictEqual(posts.length, 0);
    });

    it('builds the idle inventory from persisted tournament data and warms a late tablet assignment without another synthesis', async function() {
        const db = await database.init_test();
        const current = { ...selected(), announcement_speech_voice: voice };
        const previous = game('previous', { state: 'oncourt', teams: [team('Auf Feld A'), team('Auf Feld B')] });
        const next = game('next', { state: 'scheduled', match_num: 18, court_id: null,
            teams: [team('Nächste Bedienung A'), team('Nächste Bedienung B')] });
        const fixture = { tournaments: [current], matches: [previous, next],
            courts: current.courts, locations: current.locations };
        for (const [collection, docs] of Object.entries(fixture)) {
            await promisify(db[collection].insert.bind(db[collection]))(docs.map(doc => ({ ...doc, tournament_key: key })));
        }
        const { broker, posts, advance } = service();
        const prefetch = new Prefetcher({ db }, broker);
        prefetch.configure(current, false);
        try {
            await prefetch.refresh(key);
            assert(!broker.queue(key).items.some(item => item.text === 'Tabletbedienung:Nächste Bedienung A'));
            for (let i = 0; broker.regular_work_pending(); i++) {
                assert(i < 500, 'ordinary plan must finish');
                await broker.step(); advance();
            }
            const ordinary_posts = posts.length;
            assert(!broker.queue(key).items.some(item => item.idle));
            for (let i = 0; ; i++) {
                assert(i < 500, 'idle inventory must finish');
                await broker.step(); advance();
                if (!broker.pending_order().length && [...broker.idle_plans.values()].every(plan => plan.cursor >= plan.parts.length)) break;
            }
            assert(posts.length > ordinary_posts);
            const reserve = broker.queue(key).items.find(item => item.text === 'Tabletbedienung:Nächste Bedienung A');
            assert(reserve.idle && reserve.status === 'completed');
            const count = posts.length;
            const assigned = { ...next.setup, court_id: 'default_4', tabletoperators: next.setup.teams[0].players };
            const parts = [], texts = renderer(current, 'de', parts);
            texts.announceNewMatch(assigned);
            broker.prepare(parts, { voice, priority: 'high' }, key);
            assert(broker.views(parts, { voice }, key).every(clip => clip.status === 'completed'));
            await broker.step();
            assert.strictEqual(posts.length, count, 'the actual late call only reuses ready recordings and cuts');
            assert(broker.queue(key).items.some(item => item.key === reserve.key && !item.idle));
        } finally { prefetch.stop(); }
    });
});
