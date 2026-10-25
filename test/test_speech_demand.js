'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { promisify } = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');
const { create } = require('../bts/speech');
const { compare, requiredPlan, requiredParts, matchParts } = require('../bts/speech/planning');
const { prepare, renderer, CALLS } = require('../bts/speech/text');
const { tournament, setup } = require('./test_speech_text');
const key = 'default', voice = 'hallensprecher';
const team = name => ({ players: [{ name }] });
function game(id, state, timestamp, number) {
    return { _id: id, tournament_key: key, setup: setup({ state, is_match: true, match_num: number,
        called_timestamp: state === 'oncourt' ? timestamp : undefined,
        preparation_call_timestamp: state === 'preparation' ? timestamp : undefined,
        teams: [team(id + ' A'), team(id + ' B')], tabletoperators: null, umpire: null, service_judge: null,
    }) };
}

async function fixture(matches, context_version = 'bts-context-v1') {
    const db = await database.init_test();
    const current = { ...tournament(), tabletoperator_enabled: true, announcement_speech_voice: voice };
    const collections = { tournaments: [current], matches, locations: current.locations, courts: current.courts,
        tabletoperators: [{ tabletoperator: [{ name: 'Wartende Bedienung' }], court: null, end_ts: null }] };
    for (const [collection, docs] of Object.entries(collections)) {
        await promisify(db[collection].insert.bind(db[collection]))(docs.map(doc => ({ ...doc, tournament_key: key })));
    }
    const app = { db, config: { speech: { enabled: true, worker: false, api_key: 'demand-test-' + 'x'.repeat(32) } } };
    app.speech = create(app);
    const { broker, prefetch } = app.speech;
    broker.context_version = context_version;
    prefetch.configure(current, false);
    let clock = 1000;
    const posts = [];
    broker.now = () => clock;
    broker.request = async (_base, _key, method, _route, body) => {
        assert.strictEqual(method, 'POST'); posts.push(body);
        return { ...body, job_id: crypto.randomBytes(16).toString('hex'), status: 'completed', cache_hit: false,
            audio: { audio_id: crypto.randomBytes(16).toString('hex'), processed: !!body.context } };
    };
    const context = { ...current, speech: { context_version }, tabletoperators: collections.tabletoperators };
    return { app, db, broker, prefetch, posts, context, advance: () => { clock += 1000; },
        close: () => app.speech.stop() };
}

describe('Required announcements versus idle inventory', function() {
    it('publishes current game states and field associations even if every generation pass is superseded', async function() {
        const f = await fixture([game('live-state', 'scheduled', undefined, 17)], 'bts-context-v2');
        try {
            await f.prefetch.refresh(key);
            const previous = f.broker.coverage.plans.get(key), jobs = f.broker.entries.size;
            f.app.speech_snapshot = async () => {
                const values = await Promise.all(['tournaments', 'locations', 'courts', 'matches', 'normalizations', 'tabletoperators', 'umpires']
                    .map(name => name === 'tournaments' ? f.db[name].findOne_async({ key }) : f.db[name].find_async({ tournament_key: key })));
                f.prefetch.schedule(key); // A newer notification invalidates generation, not this status snapshot.
                return values;
            };
            for (const state of ['preparation', 'oncourt', 'finished']) {
                await f.db.matches.update_async({ _id: 'live-state' }, { $set: { 'setup.state': state,
                    'setup.now_on_court': state === 'oncourt', 'setup.court_id': 'default_4' } }, {});
                await f.prefetch.refresh(key);
                const status = await f.broker.coverage.game_status(key, voice, 'live-state');
                assert.strictEqual(status.items[0].match_state, state);
                assert.strictEqual(status.items[0].court_id, 'default_4');
                assert(!status.detail.announcements.some(call => call.unresolved?.includes('Spielfeld')));
                assert.strictEqual(f.broker.coverage.plans.get(key), previous, 'do not commit a superseded generation plan');
                assert.strictEqual(f.broker.entries.size, jobs, 'publishing status must not enqueue audio');
            }
        } finally { f.close(); }
    });
    it('uses actual field/preparation calls before schedule, with deterministic handling of missing timestamps', function() {
        const matches = [game('field late', 'oncourt', '200', 1), game('field early', 'oncourt', 100, 99),
            game('prep late', 'preparation', 400, 2), game('prep early', 'preparation', '300', 98),
            game('field missing', 'oncourt', undefined, 3), game('field invalid', 'oncourt', 'invalid', 4),
            game('candidate', 'scheduled', undefined, 5), game('future', 'scheduled', undefined, 6),
            game('finished', 'finished', undefined, 7)];
        assert.deepStrictEqual([...requiredPlan(tournament(), matches).games.keys()],
            ['field early', 'field late', 'field missing', 'field invalid', 'prep early', 'prep late']);
        assert.deepStrictEqual([...matches].slice(6, 8).sort((a, b) => compare(a, b, new Set(['future']))).map(match => match._id),
            ['future', 'candidate'], 'uncalled candidates remain an idle tier');
    });

    for (const context_version of ['bts-context-v1', null]) {
        it('requires waiting tablet operators before called games and leaves future games idle: ' + context_version, async function() {
            const matches = [game('onfield', 'oncourt', 100, 90), game('prepared', 'preparation', 200, 80),
                game('candidate', 'scheduled', undefined, 1), game('future', 'scheduled', undefined, 2)];
            const f = await fixture(matches, context_version);
            try {
                await f.prefetch.refresh(key);
                const items = f.broker.queue(key).items;
                assert(items.some(item => item.text.includes('onfield A') && !item.idle));
                assert(items.some(item => item.text.includes('prepared A') && !item.idle));
                for (const match of matches.slice(0, 2)) {
                    for (const part of matchParts(f.context, match)) {
                        assert(f.broker.entries.has(f.broker.key(part, voice, 'de-DE')), 'every active-game recipe must already be admitted');
                    }
                }
                assert(!items.some(item => /candidate [AB]|future [AB]/.test(item.text)),
                    'the candidate horizon must still remain idle work');
                assert(items.some(item => item.text.includes('Wartende Bedienung') && item.priority === 'normal' && !item.idle),
                    'the real tablet waiting list must be prepared as regular work');
                assert(items.every(item => !item.idle));
                const idle = f.broker.idle_plans.get(key).parts.join('\n');
                for (const text of ['candidate A', 'future A']) assert(idle.includes(text), text);
                assert(!idle.includes('Wartende Bedienung'), 'waiting operators must not be admitted again as idle inventory');
                const candidate = f.broker.idle_plans.get(key).parts.findIndex(part => part.includes('candidate A'));
                const future = f.broker.idle_plans.get(key).parts.findIndex(part => part.includes('future A'));
                assert(candidate < future, 'prepare call candidates before other scheduled games in idle inventory');
                if (context_version) for (const name of ['onfield A', 'onfield B', 'prepared A', 'prepared B']) {
                    assert(items.some(item => item.text === 'Tabletbedienung:' + name && item.priority === 'normal'));
                }
            } finally { f.close(); }
        });
    }

    it('contains every actual call, winner, assigned official and possible tablet announcement for a prepared game', function() {
        const current = { ...tournament(), tabletoperator_enabled: true, speech: { context_version: 'bts-context-v1' } };
        const match = { _id: 'prepared', setup: setup({ state: 'preparation', preparation_call_timestamp: 100 }) };
        const parts = new Set(requiredParts(requiredPlan(current, [match])));
        const output = [], texts = renderer(current, 'de', output);
        for (const name of CALLS) texts[name](match.setup);
        for (const winner of [0, 1]) texts.announceNoMatchWin(match.setup, winner);
        for (const players of match.setup.teams.map(team => team.players)) {
            for (const location_id of [null, ...current.locations.map(hall => hall._id)]) {
                texts.announceSecondCallTabletoperator({ tabletoperators: players, location_id });
                texts.announceSecondPreparationCallTabletoperator({ tabletoperators: players, location_id });
            }
        }
        assert(output.every(part => parts.has(part)), 'the complete prepared-game package must already be required');
    });

    it('registers the complete preparation/field call synchronously through the real notification path while the server is busy', async function() {
        const match = game('called', 'scheduled', undefined, 1);
        const f = await fixture([match]);
        try {
            await f.prefetch.refresh(key);
            f.broker.request = async (_base, _key, _method, _route, body) => {
                f.posts.push(body);
                return { ...body, job_id: crypto.randomBytes(16).toString('hex'), status: 'processing' };
            };
            f.broker.prepare(['Bestehender Auftrag'], { voice, priority: 'high' }, key);
            await f.broker.step();
            const current = f.broker.current;
            const idle_part = f.broker.idle_plans.get(key).parts.find(part => part.includes('Tabletbedienung:called A'));
            f.broker.prepare([idle_part], { voice, priority: 'idle', prefetch: true }, key);
            const existing = f.broker.entries.get(f.broker.key(idle_part, voice, 'de-DE'));
            for (const state of ['preparation', 'oncourt']) {
                const called = game('called', state, state === 'oncourt' ? 300 : 200, 1);
                await f.db.matches.update_async({ _id: called._id }, { $set: { setup: called.setup } }, {});
                admin.notify_change(f.app, key, state === 'preparation' ? 'match_preparation_call' : 'match_called_on_court',
                    state === 'preparation' ? { match: called, match__id: called._id } : called);
                for (const part of matchParts(f.context, called)) {
                    const entry = f.broker.entries.get(f.broker.key(part, voice, 'de-DE'));
                    assert(entry?.prefetch_tournaments.has(key), 'the call must enter required work before yielding to a background refresh');
                    assert.strictEqual(entry.priority, 1);
                }
                assert.strictEqual(f.broker.entries.get(existing.key), existing, 'promote the existing idle entry instead of duplicating it');
                assert.strictEqual(existing.priority, 1);
                assert.strictEqual(f.broker.entries.get(existing.source_key).priority, 1);
                assert.strictEqual(f.broker.current, current);
                assert.strictEqual(f.posts.length, 1, 'do not send a second request while the old job runs');
            }
        } finally { f.close(); }
    });

    it('orders already admitted required sources by the persisted call times, regardless of insertion or schedule', async function() {
        const late = game('late', 'oncourt', 200, 1), early = game('early', 'scheduled', undefined, 99);
        const f = await fixture([late, early]);
        try {
            await f.prefetch.refresh(key);
            const promoted = game('early', 'oncourt', 100, 99);
            await f.db.matches.update_async({ _id: promoted._id }, { $set: { setup: promoted.setup } }, {});
            await f.prefetch.refresh(key);
            const games = f.broker.pending_order().filter(entry => entry.context?.kind === 'source' &&
                /early A gegen early B|late A gegen late B/.test(entry.text));
            assert.strictEqual(games.length, 2);
            assert(games[0].text.includes('early A'));
            assert(games[1].text.includes('late A'));
        } finally { f.close(); }
    });

    it('only synthesizes future game blocks when idle, then reuses them as required after the preparation call', async function() {
        const match = game('future', 'scheduled', undefined, 1), f = await fixture([match]);
        try {
            await f.prefetch.refresh(key);
            while (f.broker.regular_work_pending()) { await f.broker.step(); f.advance(); }
            assert(!f.posts.some(post => post.text.includes('future A')));
            for (let i = 0; ; i++) {
                assert(i < 400);
                await f.broker.step(); f.advance();
                if (!f.broker.pending_order().length && f.broker.idle_plans.get(key).cursor >= f.broker.idle_plans.get(key).parts.length) break;
            }
            const count = f.posts.length;
            const called = game('future', 'preparation', 200, 1);
            await f.db.matches.update_async({ _id: called._id }, { $set: { setup: called.setup } }, {});
            admin.notify_change(f.app, key, 'match_preparation_call', { match: called });
            const parts = prepare(f.context, [called], 'de', { tablet_candidates: true, waiting: false });
            assert(f.broker.views(parts, { voice }, key).every(clip => clip.status === 'completed'));
            assert.strictEqual(f.posts.length, count);
        } finally { f.close(); }
    });
});
