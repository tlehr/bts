'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SpeechFailures } = require('../bts/speech/failures');
const { describeFailures } = require('../static/js/speech_queue');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const Disk = require('../bts/speech/disk_cache');
const config = extra => configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false, ...extra }, {});
function failure(n = 1, code = 'alignment_failed') {
    return { job_id: 'b'.repeat(32), cache_key: 'a'.repeat(64), status: 'failed', text: 'Name', voice: 'hallensprecher', language: 'de-DE',
        error: { code }, diagnostics: { cache_key: 'a'.repeat(64), failure_count: n, last_failure_at: 1700000000,
            recent_failures: [{ event_id: 'b'.repeat(32) + ':1', code, reason: 'word_times_inconsistent', stage: 'excerpt',
                attempt: 1, created_at: 1700000000 }] } };
}

describe('Speech failure feedback', function() {
    it('does not count repeated polls or cache hits as new failures', function() {
        const log = new SpeechFailures();
        log.observe('identity', 'key', failure(5));
        for (let i = 0; i < 20; i++) log.observe('identity', 'key', failure(5));
        assert.strictEqual(log.get('identity', 'key').failure_count, 5);
        assert.strictEqual(log.get('identity', 'key').recent_failures.length, 1);
        log.observe('identity', 'key', { ...failure(6), status: 'completed', error: null });
        assert.strictEqual(log.get('identity', 'key').failure_count, 6);
    });

    it('keeps old-server retries idempotent and separates busy/transport failures', function() {
        const log = new SpeechFailures(null, () => 1700000000000), response = failure();
        delete response.diagnostics;
        response.attempts = 1;
        log.observe('id', 'key', response); log.observe('id', 'key', response);
        assert.strictEqual(log.get('id', 'key').failure_count, 1);
        log.transport('id', 'key', { status: 429 }, 'transport');
        assert.strictEqual(log.get('id', 'key').transport_count, 0);
        log.transport('id', 'key', new Error('secret filesystem path'), 'transport');
        assert.strictEqual(log.get('id', 'key').transport_count, 1);
        assert(!JSON.stringify(log.get('id', 'key')).includes('secret'));
    });

    it('persists failed entries without an audio file and after a cache restart', async function() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-errors-'));
        try {
            const cfg = config({ cache_enabled: true, cache_dir: directory });
            let disk = new Disk(cfg); await disk.ready;
            const log = new SpeechFailures(disk);
            log.observe('identity', 'a'.repeat(64), failure(12)); await log.persist();
            disk = new Disk(cfg); await disk.ready;
            const restored = new SpeechFailures(disk);
            assert.strictEqual(restored.get('identity', 'a'.repeat(64)).failure_count, 12);
            assert.strictEqual(restored.get_current('identity', 'a'.repeat(64)), null);
            assert.strictEqual(disk.count(), 0);
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });

    it('excludes earlier runs from both queue and inventory while retaining recovery state', async function() {
        const broker = new SpeechBroker(config(), { now: () => 1700000010000 });
        const part = '~bts-context-v2~' + JSON.stringify({ before: '', text: 'Finale!', after: '', kind: 'generic' });
        broker.context_version = 'bts-context-v2';
        broker.prepare([part], { voice: 'hallensprecher', prefetch: true }, 't');
        const key = broker.key(part, 'hallensprecher', 'de-DE');
        broker.failures.observe(broker.identity, key, failure(49));
        broker.failures.remember_recovery(broker.identity, key, 'context', true);
        await broker.coverage.set_plan('t', 'hallensprecher', new Map([[part, { part, groups: new Set(['D01']) }]]));
        assert.strictEqual(broker.queue('t').items.find(row => row.key === key).diagnostics, null);
        assert.strictEqual(broker.coverage.inventory('t', 'hallensprecher', 'components').items[0].diagnostics, null);
        assert.strictEqual(broker.failures.get(broker.identity, key).failure_count, 49);
        assert.strictEqual(broker.failures.recovery(broker.identity, key).terminal, true);
        const response = failure(50);
        response.diagnostics.recent_failures.push({ ...response.diagnostics.recent_failures[0],
            event_id: 'b'.repeat(32) + ':50', created_at: 1700000011, attempt: 50 });
        response.diagnostics.last_failure_at = 1700000011;
        for (let i = 0; i < 20; i++) broker.failures.observe(broker.identity, key, response);
        const info = broker.queue('t').items.find(row => row.key === key).diagnostics;
        assert.strictEqual(info.failure_count, 1);
        assert.strictEqual(info.recent_failures.length, 1);
        assert.strictEqual(info.last_failure_at, 1700000011);
        assert.deepStrictEqual(broker.coverage.inventory('t', 'hallensprecher', 'components').items[0].diagnostics, info);
        assert(!describeFailures({ diagnostics: info }).summary.includes('wiederholt'));
        const late = new SpeechFailures(null, () => 1700000010000);
        late.observe('id', 'key', response);
        assert.strictEqual(late.get_current('id', 'key').failure_count, 1, 'first response may mix old and current events');
        broker.stop();
    });

    it('counts new failures beyond the eight-event detail window and resets display at restart', function() {
        let now = 1700000010000;
        const records = new Map();
        const disk = { diagnostics: records, key: (identity, key) => JSON.stringify([identity, key]) };
        const log = new SpeechFailures(disk, () => now);
        log.observe('id', 'key', failure(49));
        assert.strictEqual(log.get_current('id', 'key'), null);
        for (let n = 50; n <= 61; n++) {
            const response = failure(n);
            response.diagnostics.recent_failures = [{ ...response.diagnostics.recent_failures[0],
                event_id: 'b'.repeat(32) + ':' + n, created_at: ++now / 1000, attempt: n }];
            log.observe('id', 'key', response);
        }
        assert.strictEqual(log.get_current('id', 'key').failure_count, 12);
        assert.strictEqual(log.get_current('id', 'key').recent_failures.length, 8);
        log.transport('id', 'key', new Error('offline'), 'transport');
        assert.strictEqual(log.get_current('id', 'key').transport_count, 1);
        now++;
        const restarted = new SpeechFailures(disk, () => now);
        assert.strictEqual(restarted.get_current('id', 'key'), null);
        assert.strictEqual(restarted.get('id', 'key').failure_count, 61);
        assert.strictEqual(restarted.get('id', 'key').transport_count, 1);
    });

    it('filters dated old-server failures and counts only fresh retry attempts', function() {
        const log = new SpeechFailures(null, () => 1700000010000), response = failure();
        delete response.diagnostics;
        Object.assign(response, { attempts: 49, updated_at: 1700000000 });
        log.observe('id', 'key', response);
        assert.strictEqual(log.get_current('id', 'key'), null);
        Object.assign(response, { attempts: 50, updated_at: 1700000011 });
        log.observe('id', 'key', response); log.observe('id', 'key', response);
        assert.strictEqual(log.get_current('id', 'key').failure_count, 1);
    });

    it('propagates source failures to dependent pieces and keeps reasons through the name fallback', function() {
        const broker = new SpeechBroker(config(), { now: () => 1700000000000 }); broker.context_version = 'bts-context-v2';
        const part = '~bts-context-v2~' + JSON.stringify({ before: '', text: 'Name', after: ' spielt jetzt gegen Name!', kind: 'team' });
        broker.prepare([part], { voice: 'hallensprecher', priority: 'normal' }, 't');
        const child = broker.entries.get(broker.key(part, 'hallensprecher', 'de-DE'));
        const source = broker.entries.get(child.source_key);
        const response = { ...failure(3, 'source_quality_failed'), text: source.text };
        response.diagnostics.recent_failures = [1, 2, 3].map(attempt => ({ ...response.diagnostics.recent_failures[0],
            event_id: 'b'.repeat(32) + ':' + attempt, attempt }));
        broker.update(source, response);
        assert.strictEqual(child.fallback_stage, 'context');
        assert.strictEqual(broker.queue('t').items.find(row => row.key === child.key).diagnostics.failure_count, 3);
        assert.strictEqual(broker.queue('t').items.find(row => row.key === source.key).diagnostics.failure_count, 3);
        broker.stop();
    });

    it('renders a repeated reason, measured pauses, retry time and success history', function() {
        const info = failure(3).diagnostics;
        info.recent_failures[0] = { ...info.recent_failures[0], code: 'source_quality_failed', reason: 'long_internal_pause',
            seed: 43, pauses: [{ kind: 'word', duration_ms: 810, limit_ms: 500, start_ms: 1200 }] };
        const result = describeFailures({ diagnostics: info, status: 'failed', retry_at: 1700000030000 }, 1700000000000);
        assert(result.summary.includes('3 Fehlversuche · wiederholt'));
        assert(result.reason.includes('Pause'));
        assert(result.details[0].includes('810 ms'));
        assert(result.details[0].includes('Grenze 500 ms'));
        assert(result.next.includes('Erneuter Versuch'));
        assert(describeFailures({ diagnostics: info, status: 'completed' }).summary.includes('inzwischen fertig'));
        assert(describeFailures({ diagnostics: info, terminal_failure: true }).next.includes('Keine weiteren'));
    });
});
