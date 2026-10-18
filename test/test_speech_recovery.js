'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { spellNumbers } = require('../bts/speech/numbers');

const voice = 'hallensprecher';
const options = { voice, prefetch: true, priority: 'normal' };
const recipe = (text = 'Jungen Einzel U19', kind = 'generic', before = 'Im ', after = ' erwarten wir spannende Spiele!') =>
    '~bts-context-v2~' + JSON.stringify({ before, text, after, kind });
const config = extra => configuration({ enabled: true, api_key: 'x'.repeat(32), cache_enabled: false, ...extra }, {});
const failed = entry => ({ job_id: crypto.randomBytes(16).toString('hex'), status: 'failed', text: spellNumbers(entry.text),
    voice: entry.voice, language: entry.language, error: { code: 'alignment_failed' } });

describe('Bounded context recovery', function() {
    for (const sourceFailure of [false, true]) it('tries a fresh context once, then lets other work proceed: source failure=' + sourceFailure, async function() {
        let now = 1000;
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => now, request: async (_url, _key, _method, _route, body) => {
            sent.push(body);
            const job_id = crypto.randomBytes(16).toString('hex');
            const bad = !!body.context || sourceFailure && body.source_seed === 45;
            return { ...body, job_id, status: bad ? 'failed' : 'completed', ...(bad ?
                { error: { code: body.context ? 'alignment_failed' : 'generation_failed' } } : { audio: { audio_id: job_id } }) };
        } });
        broker.context_version = 'bts-context-v2';
        const part = recipe();
        for (let step = 0; step < 40; step++) {
            broker.prepare([part], options, 'test'); await broker.step(); now += 60000;
        }
        const entry = broker.entries.get(broker.key(part, voice, 'de-DE'));
        assert(entry.terminal_failure && entry.status === 'failed');
        assert.strictEqual(entry.fallback_stage, 'context');
        assert.deepStrictEqual(sent.filter(body => !body.context).map(body => body.source_seed), [undefined, 45]);
        assert.strictEqual(sent.filter(body => body.context).length, sourceFailure ? 1 : 2);
        assert.strictEqual(broker.regular_work_pending(), false);
        broker.prepare(['Andere dringende Durchsage'], options, 'test'); await broker.step();
        assert.strictEqual(sent.at(-1).text, 'Andere dringende Durchsage');
        broker.stop();
    });

    it('shares a single fresh source between two different failed cuts from that source', async function() {
        let now = 1000;
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => now, request: async (_url, _key, _method, _route, body) => {
            sent.push(body); const job_id = crypto.randomBytes(16).toString('hex');
            return { ...body, job_id, status: body.context ? 'failed' : 'completed', ...(body.context ?
                { error: { code: 'alignment_failed' } } : { audio: { audio_id: job_id } }) };
        } });
        broker.context_version = 'bts-context-v2';
        const full = 'Auf Spielfeld 8! Spielnummer 189. Auf Spielfeld 8!';
        const parts = [recipe('Auf Spielfeld 8!', 'field_start', '', full.slice(16)),
            recipe('Auf Spielfeld 8!', 'field_end', full.slice(0, -16), '')];
        for (let step = 0; step < 40; step++) {
            broker.prepare(parts, options, 'test'); await broker.step(); now += 60000;
        }
        assert.strictEqual(sent.filter(body => body.source_seed === 45).length, 1);
        assert.strictEqual(sent.filter(body => !body.context).length, 2);
        assert(parts.every(part => broker.entries.get(broker.key(part, voice, 'de-DE')).terminal_failure));
        broker.stop();
    });

    it('persists the consumed recovery stage and terminal stop across BTS restarts without an audio file', async function() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-recovery-'));
        const cfg = config({ cache_enabled: true, cache_dir: directory });
        const part = recipe();
        const create = async () => {
            const broker = new SpeechBroker(cfg, { request: async () => { throw new Error('terminal work must not be submitted'); } });
            await broker.disk.ready;
            broker.identity = 'test-identity'; broker.context_version = 'bts-context-v2';
            broker.prepare([part], options, 'test');
            return broker;
        };
        try {
            let broker = await create();
            let entry = broker.entries.get(broker.key(part, voice, 'de-DE'));
            broker.update(entry, failed(entry));
            const fresh = entry.source_key;
            await broker.persist_recovery(); broker.stop();
            broker = await create(); entry = broker.entries.get(broker.key(part, voice, 'de-DE'));
            assert.strictEqual(entry.fallback_stage, 'context');
            assert.strictEqual(entry.source_key, fresh);
            assert.strictEqual(broker.entries.get(fresh).source_seed, 45);
            broker.update(entry, failed(entry)); await broker.persist_recovery(); broker.stop();
            broker = await create(); entry = broker.entries.get(broker.key(part, voice, 'de-DE'));
            assert(entry.terminal_failure && entry.status === 'failed');
            assert.strictEqual(broker.pending_order().length, 0);
            assert.strictEqual(broker.regular_work_pending(), false);
            await broker.step();
            assert.strictEqual(broker.failures.get(broker.identity, entry.key).failure_count, 2);
            broker.identity = 'new-engine-identity'; broker.entries.clear();
            broker.prepare([part], options, 'test');
            assert(!broker.entries.get(broker.key(part, voice, 'de-DE')).terminal_failure);
            broker.stop();
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});
