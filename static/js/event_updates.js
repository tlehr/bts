'use strict';
// Reconstruct a complete current catalog before the ordinary view handlers.
// A gap or stale baseline requests an authoritative tournament snapshot.
var btsEventUpdates = (function() {
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object,key);
    function patchedEvent(source, edits) {
        if (!Array.isArray(edits) || edits.length > 128) return null;
        const result = JSON.parse(JSON.stringify(source));
        for (const edit of edits) {
            const path = edit?.path;
            if (!Array.isArray(path) || !path.length || path.length > 13 || path.some(key =>
                typeof key !== 'string' && !(Number.isSafeInteger(key) && key >= 0) || ['__proto__','constructor','prototype'].includes(key))) return null;
            let target = result;
            for (const key of path.slice(0,-1)) {
                if (!target || typeof target !== 'object' || !own(target,key)) return null;
                target = target[key];
            }
            const key = path.at(-1);
            if (!target || typeof target !== 'object' || Array.isArray(target) && (!Number.isSafeInteger(key) || key >= target.length)) return null;
            if (edit.remove === true) {
                if (Array.isArray(target) || !own(target,key) || own(edit,'value')) return null;
                delete target[key];
            } else { if (!own(edit,'value')) return null;target[key] = edit.value; }
        }
        return result;
    }
    function apply(tournament, value) {
        if (!value?.events_delta) {
            if (!value?.events || typeof value.events !== 'object') return null;
            tournament.events_revision = value.events_revision || null;
            return value.events;
        }
        const delta = value.events_delta;
        if (typeof delta.version !== 'string' || delta.base !== tournament.events_revision ||
            !Array.isArray(tournament.events?.events) || !Array.isArray(delta.order) || !Array.isArray(delta.changed) ||
            !delta.root || typeof delta.root !== 'object' || Array.isArray(delta.root)) return null;
        const rows = new Map(), changed = new Set();
        for (const event of tournament.events.events) {
            if (!event || !['string', 'number'].includes(typeof event.id) || rows.has(String(event.id))) return null;
            rows.set(String(event.id), event);
        }
        for (const event of delta.changed) {
            if (!event || !['string', 'number'].includes(typeof event.id) || changed.has(String(event.id))) return null;
            rows.set(String(event.id), event); changed.add(String(event.id));
        }
        if (delta.patched != null && !Array.isArray(delta.patched)) return null;
        for (const patch of delta.patched || []) {
            if (!patch || !['string','number'].includes(typeof patch.id)) return null;
            const id = String(patch.id);
            if (changed.has(id) || !rows.has(id)) return null;
            const record = patchedEvent(rows.get(id),patch.changes);
            if (!record || String(record.id) !== id) return null;
            rows.set(id,record);changed.add(id);
        }
        const order = delta.order.map(String);
        if (new Set(order).size !== order.length || order.some(id => !rows.has(id)) || [...changed].some(id => !order.includes(id))) return null;
        const result = { ...delta.root, events: order.map(id => rows.get(id)) };
        tournament.events_revision = delta.version;
        return result;
    }
    return { apply, format:2 };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = btsEventUpdates;
