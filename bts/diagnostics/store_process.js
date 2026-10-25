'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { cleanString } = require('./sanitize');
let directory, rows = new Map(), sequence = 0, bytes = 0, pending = [], dropped = 0, writeError = null, writing = Promise.resolve();
const seenEvents = new Set();
const recent = new Map();
const exportsById = new Map();
const LIMIT = 5000, FILE_LIMIT = 2 * 1024 * 1024, AGE = 7 * 24 * 60 * 60 * 1000;
const file = suffix => path.join(directory, 'events' + suffix + '.jsonl');
const send = message => { if (process.connected) process.send(message); };
async function initialize(settings) {
    directory = settings.directory;
    if (directory) {
        await fs.mkdir(directory, { recursive: true });
        for (const suffix of ['.2', '.1', '']) {
            let content;
            try { content = await fs.readFile(file(suffix), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
            for (const line of content.split('\n')) try {
                const row = JSON.parse(line);
                if (Number.isSafeInteger(row.id) && Number.isSafeInteger(row.revision) && row.updated_at > Date.now() - AGE) {
                    rows.set(row.id, row); sequence = Math.max(sequence, row.revision);
                }
            } catch (_) { /* A partial final line after a crash is ignored. */ }
        }
        bytes = (await fs.stat(file('')).catch(() => ({ size: 0 }))).size;
    }
    prune(); send({ type: 'ready' });
}
function prune() {
    for (const [id, row] of rows) if (row.updated_at < Date.now() - AGE || rows.size > LIMIT) rows.delete(id);
}
function append(entries) {
    for (const entry of entries) {
        if (entry.event_id) {
            if (seenEvents.has(entry.event_id)) continue;
            seenEvents.add(entry.event_id); if (seenEvents.size > 10000) seenEvents.delete(seenEvents.values().next().value);
        }
        const ts = entry.received_at || Date.now(), signature = crypto.createHash('sha256').update(JSON.stringify([entry.source, entry.page_id, entry.level,
            entry.message, entry.tournament_key, entry.match_id, entry.court_id, entry.trace_id])).digest('hex');
        const last = rows.get(recent.get(signature));
        let row;
        if (last?.signature === signature && ts - last.updated_at < 10000) {
            row = { ...last, revision: ++sequence, updated_at: ts, count: last.count + 1 };
        } else {
            const id = ++sequence;
            row = { ...entry, message: cleanString(entry.message, 8000), id, revision: id, ts, updated_at: ts, count: 1, signature };
        }
        rows.delete(row.id); rows.set(row.id, row); recent.set(signature, row.id); pending.push(row);
        if (recent.size > LIMIT) recent.delete(recent.keys().next().value);
        if (pending.length > 2000) { pending.shift(); dropped++; }
    }
    prune();
}
function flush() {
    const batch = pending.splice(0);
    if (!directory || !batch.length) return writing;
    writing = writing.then(async () => {
        let content = '', size = 0;
        const write = async () => {
            if (!size) return;
            if (bytes + size > FILE_LIMIT) {
                await fs.rm(file('.2'), { force: true });
                await fs.rename(file('.1'), file('.2')).catch(error => { if (error.code !== 'ENOENT') throw error; });
                await fs.rename(file(''), file('.1')).catch(error => { if (error.code !== 'ENOENT') throw error; });
                bytes = 0;
            }
            await fs.appendFile(file(''), content, { mode: 0o600 }); bytes += size; content = ''; size = 0;
        };
        for (const row of batch) {
            const line = JSON.stringify(row) + '\n', length = Buffer.byteLength(line);
            if (size + length > FILE_LIMIT) await write();
            content += line; size += length;
        }
        await write(); writeError = null;
    }).catch(error => { writeError = cleanString(error.code || error.message, 200); dropped += batch.length; });
    return writing;
}
function query(filter = {}) {
    prune();
    for (const [id, value] of exportsById) if (value.until < Date.now()) exportsById.delete(id);
    if (filter.export_id) {
        const value = exportsById.get(filter.export_id);
        if (!value) throw new Error('export_expired');
        return exportPage(filter.export_id, value, filter.export_offset || 0);
    }
    const cursor = Number.isSafeInteger(filter.cursor) && filter.cursor >= 0 ? filter.cursor : 0;
    const limit = Math.min(200, Math.max(1, Number(filter.limit) || 200));
    const text = String(filter.search || '').slice(0, 200).toLocaleLowerCase('de');
    const selected = [...rows.values()].filter(row => row.revision > cursor &&
        (!filter.level || filter.level === 'all' || row.level === filter.level) &&
        (!filter.source || filter.source === 'all' || row.source === filter.source) &&
        (!filter.page_id || row.page_id === filter.page_id) &&
        (!filter.tournament_key || row.tournament_key === filter.tournament_key) &&
        (!filter.match_id || row.match_id === filter.match_id) &&
        (!filter.since || row.updated_at >= filter.since) && (!filter.until || row.updated_at <= filter.until) &&
        (!text || JSON.stringify(row).toLocaleLowerCase('de').includes(text)))
        .sort((a, b) => b.revision - a.revision);
    if (filter.export) {
        if (exportsById.size >= 4) exportsById.delete(exportsById.keys().next().value);
        const id = crypto.randomUUID(), value = { rows: selected, until: Date.now() + 120000, cursor: sequence };
        exportsById.set(id, value); return exportPage(id, value, 0);
    }
    const items = publicRows(selected.slice(0, limit));
    return { items, cursor: sequence, total: selected.length, retained: rows.size, truncated: selected.length > limit,
        oldest_ts: rows.size ? rows.values().next().value.ts : null, dropped, write_error: writeError, persistent: !!directory };
}
function publicRows(rows) {
    return rows.map(row => { const value = { ...row }; delete value.signature; return value; });
}
function exportPage(id, value, offset) {
    const rows = value.rows.slice(offset, offset + 200), next = offset + rows.length;
    return { export_id: id, cursor: value.cursor, total: value.rows.length, items: publicRows(rows),
        next_offset: next < value.rows.length ? next : null };
}
let ready = Promise.resolve();
process.on('message', message => {
    if (message.type === 'initialize') { ready = initialize(message); ready.catch(error => send({ type: 'failure', error: cleanString(error.code || error.message) })); return; }
    void ready.then(async () => {
        if (message.type === 'append') append(message.entries);
        else if (message.type === 'query') send({ type: 'reply', id: message.id, result: query(message.filter) });
        else if (message.type === 'close') { await flush(); process.exit(0); }
    }).catch(error => { if (message.id) send({ type: 'reply', id: message.id, error: cleanString(error.code || error.message) }); });
});
setInterval(flush, 1000).unref();
process.on('disconnect', () => { void flush().finally(() => process.exit(0)); });
