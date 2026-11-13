'use strict';
const assert = require('assert');
const server = require('../bts/admin_response/event_updates');
const client = require('../static/js/event_updates');
const foreground = require('../bts/foreground_work');
const copy = value => JSON.parse(JSON.stringify(value));
const catalog = () => ({ title: 'Grün 🏸', events: Array.from({ length: 24 }, (_, id) => ({ id,
    stages: [{ entries: Array.from({ length: 80 }, (_, n) => ({ id: n, name: 'Player ' + n, checked_in: false })) }] })) });
function socket(events, format = 2) {
    const ws = {}, snapshot = { events: copy(events) };
    server.finish(server.begin(ws, 'test', format === 1 ? true : format), snapshot);
    return { ws, snapshot };
}
describe('catalog work before allocation locks', function() {
    it('prepares both negotiated formats without advancing any recipient baseline or changing legacy bytes', async function() {
        const original = catalog(), first = socket(original, 1), second = socket(original, 2), legacy = {};
        const changed = copy(original); changed.events[4].stages[0].entries[7].checked_in = true;
        const baselines = [first, second].map(({ ws }) => ws.events_delta_states.get('test').base);
        const owned = await server.precompute({ events: changed }, [first.ws, second.ws, legacy], 'test');
        for (const [index, recipient] of [first, second].entries()) {
            const state = recipient.ws.events_delta_states.get('test');
            assert.strictEqual(state.base, baselines[index]); assert.strictEqual(state.sent, 0);
        }
        changed.events[4].stages[0].entries[7].name = 'Later caller edit';
        const delivery = server.prepare(owned);
        for (const recipient of [first, second]) {
            const value = copy(delivery(recipient.ws, 'test'));
            assert(value.events_delta);
            assert.deepStrictEqual(client.apply(recipient.snapshot, value), owned.events);
        }
        assert.strictEqual(JSON.stringify(delivery(legacy, 'test')), JSON.stringify(owned));
        assert.notStrictEqual(owned.events.events[4].stages[0].entries[7].name, 'Later caller edit');
    });
    it('uses the actual baseline when another update arrives after preparation', async function() {
        const original = catalog(), recipient = socket(original), target = copy(original);
        target.events[2].name = 'Prepared target';
        const prepared = await server.precompute({ events: target }, [recipient.ws], 'test');
        const intermediate = copy(original); intermediate.events[3].name = 'Intermediate';
        const first = copy(server.prepare({ events: intermediate })(recipient.ws, 'test'));
        recipient.snapshot.events = client.apply(recipient.snapshot, first);
        const next = copy(server.prepare(prepared)(recipient.ws, 'test'));
        assert.strictEqual(next.events_delta.base, recipient.snapshot.events_revision);
        assert.deepStrictEqual(client.apply(recipient.snapshot, next), target);
    });
    it('preserves a newly reserved snapshot and a changed negotiation while waiting to publish', async function() {
        const original = catalog(), recipient = socket(original), target = copy(original);
        target.events[1].name = 'Target';
        const prepared = await server.precompute({ events: target }, [recipient.ws], 'test');
        const ticket = server.begin(recipient.ws, 'test', true);
        const queued = copy(server.prepare(prepared)(recipient.ws, 'test'));
        assert(queued.events && !queued.events_delta);
        const snapshot = { events: copy(original) }; server.finish(ticket, snapshot);
        snapshot.events = client.apply(snapshot, queued);
        const following = copy(target); following.events[2].name = 'Following';
        const value = copy(server.prepare({ events: following })(recipient.ws, 'test'));
        assert.deepStrictEqual(client.apply(snapshot, value), following);
    });
    it('does not retain mutable ordinary deliveries or share incomplete preparation', async function() {
        const value = { events: catalog() }, recipient = socket(value.events);
        const prepared = await server.precompute(value, [recipient.ws], 'test');
        value.events.events[0].name = 'Changed source';
        const regular = copy(server.prepare(value)(recipient.ws, 'test'));
        recipient.snapshot.events = client.apply(recipient.snapshot, regular);
        assert.strictEqual(recipient.snapshot.events.events[0].name, 'Changed source');
        const fixed = copy(server.prepare(prepared)(recipient.ws, 'test'));
        assert.deepStrictEqual(client.apply(recipient.snapshot, fixed), prepared.events);
    });
    it('defers preparation until current foreground points finish', async function() {
        const release = foreground.begin('handle_score_update_v2');
        let ready = false;
        const pending = server.precompute({ events: catalog() }, [], 'test').then(() => { ready = true; });
        try { await new Promise(resolve => setImmediate(resolve)); assert.strictEqual(ready, false); }
        finally { release(); await pending; }
        assert(ready);
    });
});
