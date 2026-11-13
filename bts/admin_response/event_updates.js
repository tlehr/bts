'use strict';
const crypto = require('crypto');
const diff = require('./event_patch');
// Only owned snapshots made by precompute are memoized. Mutable callers
// retain the ordinary uncached API; queued copies keep their captured revision.
const prepared = new WeakMap();

// Negotiate per socket. Old clients continue receiving the complete catalog.
function begin(ws, key, supported) {
    if (supported !== true && supported !== 2) { ws.events_delta_states?.delete(key); return null; }
    ws.events_delta_states ||= new Map();
    if (ws.events_delta_states.size >= 8) ws.events_delta_states.delete(ws.events_delta_states.keys().next().value);
    const state = { loading: true, sent: 0, base: null, format: supported === 2 ? 2 : 1 };
    ws.events_delta_states.set(key, state);
    return { ws, key, state };
}
function describe(events) {
    if (!events || typeof events !== 'object' || Array.isArray(events)) return null;
    const json = JSON.stringify(events), rows = new Map(), order = [];
    if (Array.isArray(events.events)) for (const event of events.events) {
        if (!event || !['string', 'number'].includes(typeof event.id) || rows.has(String(event.id))) return null;
        rows.set(String(event.id), JSON.stringify(event)); order.push(event.id);
    } else return null;
    return { version: crypto.createHash('sha256').update(json).digest('hex'), rows, order, length: json.length };
}
function finish(ticket, tournament) {
    if (!ticket) return;
    const current = tournament && describe(tournament.events);
    if (current) tournament.events_revision = current.version;
    // A notification queued behind the reserved snapshot remains the base,
    // even when the snapshot captured a newer revision during encoding.
    if (ticket.ws.events_delta_states?.get(ticket.key) === ticket.state) {
        if (!ticket.state.sent) ticket.state.base = current;
        ticket.state.loading = false;
    }
}
function prepare(value) {
    if (value && prepared.has(value)) return prepared.get(value);
    const current = describe(value?.events);
    if (!current) return () => value;
    const full = { ...value, events_revision: current.version }, variants = new Map();
    const root = Object.fromEntries(Object.entries(value.events).filter(([key]) => key !== 'events'));
    function* variant(previous, format) {
        const changed = value.events.events.filter(event => previous.rows.get(String(event.id)) !== current.rows.get(String(event.id)));
        const replaced = [], patched = [];
        for (const event of changed) {
            const before = previous.rows.get(String(event.id)), after = current.rows.get(String(event.id));
            const edits = format === 2 && before ? diff(JSON.parse(before), JSON.parse(after)) : null;
            const patch = edits && { id: event.id, changes: edits };
            if (patch && JSON.stringify(patch).length < after.length * .7) patched.push(patch);
            else replaced.push(event);
            yield;
        }
        const delta = { ...value, events: undefined, events_delta: { base: previous.version, version: current.version,
            order: current.order, changed: replaced, root, ...(patched.length ? { patched } : {}) } };
        return JSON.stringify(delta).length < current.length * .85 ? delta : full;
    }
    const deliver = (ws, key) => {
        const state = ws.events_delta_states?.get(key);
        if (!state) return value;
        const previous = state.base;
        state.base = current; state.sent++;
        if (!previous || state.loading) return full;
        const id = previous.version + ':' + state.format;
        if (!variants.has(id)) {
            const work = variant(previous, state.format);
            let next;
            do { next = work.next(); } while (!next.done);
            variants.set(id, next.value);
        }
        return variants.get(id);
    };
    // Preparation reads the baseline without advancing it. Actual delivery
    // checks again and uses the ordinary fallback if the baseline has changed.
    deliver.warm = async (ws, key, cooperate) => {
        const state = ws.events_delta_states?.get(key), previous = state?.base;
        if (!previous || state.loading) return;
        const id = previous.version + ':' + state.format;
        if (variants.has(id)) return;
        const work = variant(previous, state.format);
        for (;;) {
            const next = work.next();
            if (next.done) { variants.set(id, next.value); return; }
            await cooperate();
        }
    };
    return deliver;
}
// Called outside allocation locks. Copy once and yield between bounded patch
// operations, leaving current points free to run. No recipient is notified here.
async function precompute(value, recipients, key) {
    const foreground = require('../foreground_work');
    await foreground.idle();
    const owned = require('nedb/lib/model').deepCopy(value), deliver = prepare(owned);
    let turn = process.hrtime.bigint();
    const cooperate = async () => {
        if (!foreground.busy() && process.hrtime.bigint() - turn < 2000000n) return;
        await new Promise(resolve => setImmediate(resolve));
        await foreground.idle(); turn = process.hrtime.bigint();
    };
    for (const ws of [...recipients]) if (!ws.performance_probe && deliver.warm) await deliver.warm(ws, key, cooperate);
    prepared.set(owned, deliver);
    return owned;
}
module.exports = { begin, finish, prepare, precompute };
