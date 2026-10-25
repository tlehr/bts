'use strict';
/* eslint-disable no-console -- Capture existing console output without changing its destination. */

const { format } = require('./sanitize');
const sinks = new Set(), originals = new Map(), wrappers = new Map();
function subscribe(sink) {
    if (!sinks.size) for (const name of ['error', 'warn', 'info', 'log', 'debug']) {
        const original = console[name].btsOriginal || console[name]; originals.set(name, original);
        const wrapped = function(...args) {
            original.apply(console, args);
            const level = name === 'log' ? 'info' : name;
            const targets = [...sinks].filter(sink => ['error', 'warn'].includes(level) || sink.verbose());
            if (!targets.length) return;
            const entry = { level, message: format(args), ts: Date.now() };
            const trace = require('../performance/traces').capture()?.record;
            if (trace) for (const field of ['tournament_key', 'match_id', 'court_id', 'trace_id']) if (trace[field]) entry[field] = String(trace[field]).slice(0, 200);
            for (const target of targets) try { target.record(entry); } catch (_) { /* Reporting never breaks application work. */ }
        };
        wrapped.btsOriginal = original; wrappers.set(name, wrapped); console[name] = wrapped;
    }
    sinks.add(sink);
    return () => {
        sinks.delete(sink);
        if (!sinks.size) for (const [name, original] of originals) if (console[name] === wrappers.get(name)) console[name] = original;
    };
}
module.exports = { subscribe };
