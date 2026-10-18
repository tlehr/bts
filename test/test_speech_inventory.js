'use strict';
const assert = require('assert');
const { plan } = require('../bts/speech/coverage');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { tournament, setup } = require('./test_speech_text');
const context = require('../bts/speech/context');
const { handle } = require('../bts/speech');
const { requiredPlan, requiredParts } = require('../bts/speech/planning');

async function fixture(prepareAll = true, profile = context.V2) {
    const current = { ...tournament(), speech: { context_version: profile }, tabletoperator_enabled: true };
    const matches = [1, 2].map(number => ({ _id: 'game-' + number, setup: setup({ state: 'oncourt', match_num: number, called_timestamp: number }) }));
    const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false }, {}));
    broker.context_version = profile; broker.identity = 'inventory-test';
    const targets = await plan(current, matches);
    await broker.coverage.set_plan(current.key, 'hallensprecher', targets);
    const parts = prepareAll ? [...targets.values()].map(target => target.part).filter(Boolean) : requiredParts(requiredPlan(current, matches));
    for (const part of parts) broker.prepare([part], { voice: 'hallensprecher', priority: 'normal', prefetch: true }, current.key);
    for (const entry of broker.entries.values()) { entry.status = 'completed'; entry.audio_id = 'a'.repeat(32); }
    return { broker, current, matches, targets };
}

describe('Separate component and announcement inventory', function() {
    it('uses the actual playback dependencies prepared by BTS for all supported speech profiles', async function() {
        for (const profile of [context.V2, context.VERSION, null]) {
            const { broker, current } = await fixture(false, profile);
            const games = broker.coverage.inventory(current.key, 'hallensprecher', 'announcements', 'D01');
            assert.strictEqual(games.total, 2);
            assert(games.items.every(row => row.ready), 'required playback pieces must suffice for profile ' + profile);
            broker.stop();
        }
    });

    it('counts unique components and complete calls separately and propagates one shared failure to both games', async function() {
        const { broker, current } = await fixture();
        const summary = broker.coverage.summary(current.key, 'hallensprecher');
        assert(summary.components.total.total > 0 && summary.announcements.total.total > 0);
        const games = broker.coverage.inventory(current.key, 'hallensprecher', 'announcements', 'D01');
        assert.strictEqual(games.total, 2);
        assert(games.items.every(item => item.ready));
        const names = broker.coverage.inventory(current.key, 'hallensprecher', 'components', 'names', 0, 50);
        assert.strictEqual(new Set(names.items.map(item => item.id)).size, names.total);
        assert(names.items.some(item => item.label === 'Team / Name · erste Position'));
        assert(names.items.some(item => item.label === 'Team / Name · zweite Position'));
        const name = names.items.find(item => games.items.every(game => game.components.some(piece => piece.id === item.id)));
        assert(name, 'the two calls must actually share the same team part');
        broker.entries.get(name.id).status = 'failed';
        const failed = broker.coverage.inventory(current.key, 'hallensprecher', 'announcements', 'D01');
        assert(failed.items.every(item => !item.ready && item.failed));
        assert(failed.items.every(item => item.ready_parts === item.total_parts - 1));
        broker.stop();
    });

    it('keeps unknown games in announcements without counting invented components', async function() {
        const { broker, current, matches, targets } = await fixture();
        const count = broker.coverage.summary(current.key, 'hallensprecher').components.total.total;
        const unknown = { _id: 'unknown', setup: setup({ teams: [null, null], court_id: null }) };
        const updated = await plan(current, [...matches, unknown]);
        await broker.coverage.set_plan(current.key, 'hallensprecher', updated);
        assert.strictEqual(broker.coverage.summary(current.key, 'hallensprecher').components.total.total, count);
        const list = broker.coverage.inventory(current.key, 'hallensprecher', 'announcements', 'D01');
        assert.strictEqual(list.total, 3);
        assert(list.items.some(item => item.unresolved && item.state === 'potential' && !item.components.length));
        assert(targets.size > 0);
        broker.stop();
    });

    it('requires the assigned field for a full call even when its known parts are ready', async function() {
        const { broker, current, matches } = await fixture();
        const previous = broker.coverage.summary(current.key, 'hallensprecher');
        const updated = await plan(current, [
            { ...matches[0], setup: { ...matches[0].setup, court_id: null, location_id: null } }, matches[1],
        ]);
        await broker.coverage.set_plan(current.key, 'hallensprecher', updated);
        const list = broker.coverage.inventory(current.key, 'hallensprecher', 'announcements', 'D01');
        const unresolved = list.items.find(row => row.unresolved);
        assert(unresolved && !unresolved.ready && unresolved.state === 'potential');
        assert.strictEqual(unresolved.ready_parts, unresolved.total_parts);
        assert(list.items.some(row => row.ready));
        const next = broker.coverage.summary(current.key, 'hallensprecher');
        assert.notStrictEqual(next.revision, previous.revision);
        await broker.coverage.set_plan(current.key, 'hallensprecher', updated);
        assert.strictEqual(broker.coverage.summary(current.key, 'hallensprecher').revision, next.revision);
        broker.stop();
    });

    it('loads bounded pages without preparing speech and validates every batch query', async function() {
        const { broker, current } = await fixture();
        const before = broker.entries.size;
        const values = broker.coverage.inventories(current.key, 'hallensprecher', [
            { kind: 'announcements', group: 'D01', offset: 0, limit: 1 }, { kind: 'components', group: 'all', limit: 2 },
        ]);
        assert.strictEqual(values[0].items.length, 1); assert.strictEqual(values[0].next_offset, 1);
        assert.strictEqual(values[1].items.length, 2); assert.strictEqual(broker.entries.size, before);
        for (const query of [{ kind: 'sources' }, { kind: 'components', limit: 500 }, { kind: 'components', offset: -1 },
            { kind: 'components', state: 'invalid' }, { kind: 'components', state: ['cached'] },
            { kind: 'components', states: 'cached' }, { kind: 'components', states: null },
            { kind: 'components', states: ['invalid'] }, { kind: 'components', states: Array(7).fill('cached') }]) {
            assert.throws(() => broker.coverage.inventories(current.key, 'hallensprecher', [query]));
        }
        const responses = [];
        handle({ speech: { broker, prefetch: { settings: () => ({ voice: 'hallensprecher', mode: 'auto' }) } } },
            { speech_tournament_key: current.key, respond: (_msg, _error, value) => responses.push(value) },
            { type: 'speech_inventory', tournament_key: current.key, requests: [{ kind: 'announcements', group: 'D01', limit: 1 }] });
        assert.strictEqual(responses[0].inventories[0].items.length, 1);
        assert.strictEqual(broker.entries.size, before);
        broker.stop();
    });

    it('filters group and status before pagination without queuing any synthesis', async function() {
        const { broker, current } = await fixture();
        const before = broker.entries.size;
        const kinds = ['components', 'announcements'];
        for (const kind of kinds) {
            const groups = kind === 'components' ? ['all', 'names', 'rounds'] : ['all', 'D01', 'D12'];
            for (const group of groups) {
                const full = broker.coverage.inventory(current.key, 'hallensprecher', kind, group, 0, 50).items;
                for (const state of ['all', 'stock', 'prepared', 'cached', 'generated', 'ordered', 'potential'])
                    for (const states of [[], ['stock', 'generated'], ['cached', 'generated', 'ordered', 'potential']]) {
                        const expected = full.filter(row => (state === 'all' || row.state === state) && states.includes(row.state));
                        const pages = [];
                        for (let offset = 0; offset < Math.max(1, expected.length); offset += 2) {
                            const page = broker.coverage.inventory(current.key, 'hallensprecher', kind, group, offset, 2, state, states);
                            assert.strictEqual(page.total, expected.length);
                            assert.strictEqual(page.state, state);
                            assert.strictEqual(page.next_offset, offset + 2 < expected.length ? offset + 2 : null);
                            pages.push(...page.items);
                        }
                        assert.deepStrictEqual(pages, expected);
                    }
            }
        }
        assert.strictEqual(broker.entries.size, before);
        broker.stop();
    });
});
