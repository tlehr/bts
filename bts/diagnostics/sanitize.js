'use strict';

const SECRET = /password|passwd|secret|token|api.?key|authorization|cookie|signing.?key/i;
function cleanString(value, limit = 3000) {
    return String(value).slice(0, limit).replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[entfernt]')
        .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|signature)\s*[=:]\s*["']?)[^\s,"'&}]+/gi, '$1[entfernt]')
        .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[entfernt]@');
}
function value(input, depth = 0, seen = new WeakSet()) {
    if (input == null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') return cleanString(input);
    if (typeof input !== 'object') return '[' + typeof input + ']';
    if (seen.has(input)) return '[Zyklus]';
    seen.add(input);
    if (input instanceof Error) return { message: cleanString(input.message), stack: cleanString(input.stack || '', 6000), code: cleanString(input.code || '', 120) };
    if (depth >= 3) return '[gekürzt]';
    if (Array.isArray(input)) return input.slice(0, 12).map(item => value(item, depth + 1, seen));
    const result = {};
    for (const key of Object.keys(input).slice(0, 20)) {
        try { result[key] = SECRET.test(key) ? '[entfernt]' : value(input[key], depth + 1, seen); }
        catch (_) { result[key] = '[nicht lesbar]'; }
    }
    return result;
}
function format(args) {
    try { return cleanString(args.slice(0, 6).map(item => typeof item === 'string' ? item : JSON.stringify(value(item))).join(' '), 8000); }
    catch (_) { return '[Logdaten nicht lesbar]'; }
}
module.exports = { cleanString, value, format };
