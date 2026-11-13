'use strict';
const assert = require('assert'), { EventEmitter } = require('events');
const database = require('../bts/database'), admin = require('../bts/admin');
const updates = require('../bts/admin_response/event_updates'), client = require('../static/js/event_updates');
const planner = require('../bts/btp_sync_plan'), queue = require('../bts/update_queue'), keys = require('../bts/queue_lock_keys');
const wshandler = require('../bts/wshandler');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let sequence = 0;
describe('precomputed catalog publication commit boundary', function() {
    for (const fail of [false, true]) it('prepares before allocation locks and publishes only after ' + (fail ? 'a failed write is rolled back' : 'successful writes'), async function() {
        assert.strictEqual(typeof admin.prepare_event_notification, 'function');
        const key = 'event-prep-' + ++sequence, db = await database.init_test(), app = { db, wss: { clients: [] } };
        const old = { events: [{ id: 1, name: 'Old', stages: [] }] }, changed = { events: [{ id: 1, name: 'Committed', stages: [] }] };
        await new Promise((resolve, reject) => db.tournaments.insert({ key, btp_enabled: true, last_reset_ts: 1, events: old }, error => error ? reject(error) : resolve()));
        const ws = new EventEmitter(); ws.readyState = 1; ws.messages = [];
        ws.send = (bytes, options) => { assert.strictEqual(options.binary, false); ws.messages.push(JSON.parse(bytes.toString())); };
        wshandler.handle(admin, app, ws);
        const snapshot = { events: old }; updates.finish(updates.begin(ws, key, 2), snapshot);
        const state = ws.events_delta_states.get(key), originalBase = state.base;
        const held = deferred(), entered = deferred(), prepared = deferred();
        const holding = queue.execute_locked([keys.events(key)], async () => { entered.resolve(); await held.promise; });
        await entered.promise;
        const original = admin.prepare_event_notification, persist = db.tournaments.persistence.persistNewState;
        let preparations = 0, syncing;
        admin.prepare_event_notification = async function(k, value) {
            if (k !== key) return original(k, value);
            const result = await original(k, value); preparations++; prepared.resolve(); return result;
        };
        if (fail) {
            let failed = false;
            db.tournaments.persistence.persistNewState = function(documents, callback) {
                if (!failed) { failed = true; return callback(new Error('Catalog append failed')); }
                return persist.call(this, documents, callback);
            };
        }
        try {
            syncing = planner.sync(app, key, {}, { expected_reset_ts: 1, skip_unchanged: false }, async staged => {
                await staged.db.tournaments.update_async({ key }, { $set: { events: changed } }, {});
                admin.notify_change(staged, key, 'update_btp_events', { events: changed }); return true;
            });
            const outcome = fail ? assert.rejects(syncing, /Catalog append failed/) : syncing;
            await Promise.race([prepared.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Preparation waited for allocation locks')), 1500))]);
            assert.strictEqual(preparations, 1);
            assert.strictEqual(ws.messages.length, 0); assert.strictEqual(state.base, originalBase); assert.strictEqual(state.sent, 0);
            assert.deepStrictEqual((await db.tournaments.findOne_async({ key })).events, old);
            held.resolve(); await holding; await outcome;
            const messages = ws.messages.filter(m => m.ctype === 'update_btp_events');
            if (fail) {
                assert.strictEqual(messages.length, 0); assert.strictEqual(state.base, originalBase); assert.strictEqual(state.sent, 0);
                assert.deepStrictEqual((await db.tournaments.findOne_async({ key })).events, old);
            } else {
                assert.strictEqual(messages.length, 1);
                assert.deepStrictEqual(client.apply(snapshot, messages[0].val), changed);
                assert.deepStrictEqual((await db.tournaments.findOne_async({ key })).events, changed);
            }
        } finally {
            held.resolve(); await Promise.allSettled([holding, syncing]);
            admin.prepare_event_notification = original; db.tournaments.persistence.persistNewState = persist;
            ws.readyState = 3; ws.emit('close');
        }
    });
});
