'use strict';

const LIMIT = 4096;
const MAX_EVENTS = 8;
const code = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : 'unspecified';
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9 ? value : 0;
const stamp = value => Number.isFinite(value) && value >= 0 ? value : 0;
const RECOVERY_POLICY = 'context-recovery-v1';

function cleanRecovery(value) {
    if (!value || value.policy !== RECOVERY_POLICY || ![null, 'context', 'name'].includes(value.stage) || typeof value.terminal !== 'boolean') return null;
    return { policy: RECOVERY_POLICY, stage: value.stage, terminal: value.terminal,
        ...(typeof value.source_key === 'string' && /^[0-9a-f]{64}$/.test(value.source_key) ? { source_key: value.source_key } : {}) };
}

function cleanEvent(row) {
    if (!row || typeof row.event_id !== 'string' || row.event_id.length > 180 || !stamp(row.created_at)) return null;
    return { event_id: row.event_id, code: code(row.code), reason: code(row.reason), stage: code(row.stage),
        created_at: row.created_at, attempt: integer(row.attempt), legacy: row.legacy === true,
        ...(Number.isSafeInteger(row.seed) ? { seed: row.seed } : {}),
        pauses: (Array.isArray(row.pauses) ? row.pauses : []).slice(0, 8).filter(p => p &&
            [p.duration_ms, p.limit_ms, p.start_ms].every(value => Number.isFinite(value) && value >= 0 && value <= 3600000))
            .map(p => ({ kind: code(p.kind), duration_ms: p.duration_ms, limit_ms: p.limit_ms, start_ms: p.start_ms })) };
}

class SpeechFailures {
    constructor(disk, now = Date.now) {
        this.disk = disk;
        this.now = now;
        this.records = disk?.diagnostics || new Map();
        this.started_at = now() / 1000;
        this.current = new Map();
        this.sequence = 0;
    }

    id(identity, key) { return this.disk ? this.disk.key(identity || '', key) : JSON.stringify([identity, key]); }

    get(identity, key) {
        const row = this.records.get(this.id(identity, key));
        if (!row) return null;
        return { failure_count: Object.values(row.families).reduce((sum, n) => sum + n, row.archived || 0),
            transport_count: row.transport_count || 0, last_failure_at: row.last_failure_at,
            recent_failures: row.recent_failures };
    }

    get_current(identity, key) {
        const row = this.current.get(this.id(identity, key));
        if (!row) return null;
        const failure_count = Object.values(row.families).reduce((sum, family) => sum + family.count, row.archived);
        return failure_count || row.transport_count ? { failure_count, transport_count: row.transport_count,
            last_failure_at: row.last_failure_at, recent_failures: row.recent_failures } : null;
    }

    observe_current(identity, key, family, total, events, transport = false) {
        const id = this.id(identity, key);
        const row = this.current.get(id) || { families: {}, archived: 0, transport_count: 0, last_failure_at: 0, recent_failures: [] };
        const recent = events.filter(event => event.created_at >= this.started_at);
        if (transport) row.transport_count++;
        else {
            const previous = row.families[family];
            // The first response can include failures from earlier BTS runs.
            // Count only dated current events, then follow the server's counter
            // so repeated polling cannot inflate the count or truncate it to eight.
            row.families[family] = { total: Math.max(previous?.total || 0, total),
                count: previous ? previous.count + (recent.length ? Math.max(0, total - previous.total) : 0) : recent.length };
            while (Object.keys(row.families).length > 16) {
                const oldest = Object.keys(row.families)[0];
                row.archived += row.families[oldest].count; delete row.families[oldest];
            }
        }
        row.recent_failures = [...new Map([...row.recent_failures, ...recent].map(event => [event.event_id, event])).values()]
            .sort((a, b) => a.created_at - b.created_at).slice(-MAX_EVENTS);
        row.last_failure_at = Math.max(row.last_failure_at, ...recent.map(event => event.created_at));
        this.current.delete(id);
        this.current.set(id, row);
        while (this.current.size > LIMIT) this.current.delete(this.current.keys().next().value);
    }

    recovery(identity, key) { return cleanRecovery(this.records.get(this.id(identity, key))?.recovery); }

    remember_recovery(identity, key, stage, terminal, source_key) {
        return this.save(identity, key, row => { row.recovery = { policy: RECOVERY_POLICY, stage: stage || null, terminal,
            ...(source_key ? { source_key } : {}) }; });
    }

    save(identity, key, update) {
        const id = this.id(identity, key), previous = this.records.get(id) ||
            { families: {}, archived: 0, transport_count: 0, recent_failures: [], last_failure_at: 0 };
        const row = structuredClone(previous);
        update(row);
        while (Object.keys(row.families).length > 16) {
            const oldest = Object.keys(row.families)[0];
            row.archived += row.families[oldest]; delete row.families[oldest];
        }
        row.recent_failures = [...new Map(row.recent_failures.map(event => [event.event_id, event])).values()]
            .sort((a, b) => a.created_at - b.created_at).slice(-MAX_EVENTS);
        row.last_failure_at = Math.max(row.last_failure_at, ...row.recent_failures.map(event => event.created_at));
        if (JSON.stringify(row) === JSON.stringify(previous)) return false;
        this.records.delete(id);
        this.records.set(id, row);
        while (this.records.size > LIMIT) this.records.delete(this.records.keys().next().value);
        return true;
    }

    observe(identity, key, response) {
        const diagnostic = response.diagnostics;
        const family = diagnostic?.cache_key || response.cache_key || response.job_id;
        if (diagnostic && integer(diagnostic.failure_count) && typeof family === 'string' && /^[0-9a-f]{32,64}$/.test(family)) {
            const events = (Array.isArray(diagnostic.recent_failures) ? diagnostic.recent_failures : []).map(cleanEvent).filter(Boolean);
            this.observe_current(identity, key, family, diagnostic.failure_count, events);
            return this.save(identity, key, row => {
                row.families[family] = Math.max(row.families[family] || 0, diagnostic.failure_count);
                row.last_failure_at = Math.max(row.last_failure_at, stamp(diagnostic.last_failure_at));
                row.recent_failures.push(...events);
            });
        }
        // Older servers have no diagnostics. Count an actual job attempt once,
        // even when the failed job is repeatedly returned by status polling.
        if (response.error && typeof response.job_id === 'string' && /^[0-9a-f]{32}$/.test(response.job_id)) {
            const attempt = Math.max(1, (integer(response.attempts) || 1) - (response.status === 'processing' ? 1 : 0));
            const event = cleanEvent({ event_id: response.job_id + ':' + attempt, code: response.error.code,
                reason: 'legacy', stage: 'synthesis', attempt, created_at: stamp(response.updated_at) || this.now() / 1000 });
            this.observe_current(identity, key, response.job_id, attempt, event ? [event] : []);
            return this.save(identity, key, row => {
                row.families[response.job_id] = Math.max(row.families[response.job_id] || 0, attempt);
                if (event && !row.recent_failures.some(item => item.event_id === event.event_id)) row.recent_failures.push(event);
            });
        }
        return false;
    }

    transport(identity, key, error, stage) {
        if (error.status === 429) return false; // Busy is normal scheduling, not a bad recording.
        const event = { event_id: 'transport:' + this.now() + ':' + ++this.sequence,
            created_at: this.now() / 1000, stage,
            code: code(error.response?.error?.code || (error.status === 401 ? 'unauthorized' : 'speech_unavailable')),
            reason: error.status ? 'http_error' : 'connection_failed', attempt: 0, pauses: [] };
        this.observe_current(identity, key, null, 0, [event], true);
        return this.save(identity, key, row => {
            row.transport_count++;
            row.recent_failures.push(event);
        });
    }

    async persist() { if (this.disk) await this.disk.persist(); }
}

module.exports = { SpeechFailures, cleanEvent, cleanRecovery };
