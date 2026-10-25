'use strict';

const assert = require('assert');
const { SpeechHealth } = require('../bts/speech/health');
const { create } = require('../bts/speech');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { Prefetcher } = require('../bts/speech/prefetch');
const admin = require('../bts/admin');
const KEY = 'health-fixture-' + 'x'.repeat(32);

describe('Speech failure containment and admin notification', function() {
    let original, messages;
    beforeEach(function() { original = console.error; messages = []; console.error = (...args) => messages.push(args); });
    afterEach(function() { console.error = original; });

    it('reports causes without diagnostics, limits repetitions and clears every admin window after recovery', function() {
        let now = 1000;
        const one = [], two = [];
        const a = { sendmsg: msg => one.push(msg), respond() {}, last_tournament_key: 'one' };
        const b = { sendmsg: msg => two.push(msg), respond() {}, last_tournament_key: 'two' };
        const broken = { speech_health_subscribed: true, sendmsg() { throw new Error('closed socket'); } };
        const legacyMessages = [], legacy = { sendmsg: message => legacyMessages.push(message) };
        const app = { config: { bts_server_diagnostics_enabled: false }, wss: { clients: new Set([broken, a, b, legacy]) } };
        const health = new SpeechHealth(app, () => now); app.speech = { health };
        admin.on_connect(app, a); admin.on_connect(app, b);
        assert.deepStrictEqual(one, [], 'do not push a new protocol message before the client subscribes');
        admin.handle_speech_health_subscribe(app, a, {}); admin.handle_speech_health_subscribe(app, b, {});
        try {
            const error = Object.assign(new Error('speech_http_error'), { status: 503,
                response: { error: { code: 'playback_processing_failed' }, api_key: KEY, audio: Buffer.alloc(100) } });
            health.fail('upstream_request', error); health.fail('upstream_request', error);
            assert.strictEqual(messages.length, 1);
            assert(messages[0][0].includes('playback_processing_failed (HTTP 503)'));
            for (const received of [one, two]) {
                assert.strictEqual(received.at(-1).type, 'speech_health');
                assert.strictEqual(received.at(-1).health.issues[0].code, 'playback_processing_failed');
                assert(!JSON.stringify(received).includes(KEY));
                assert(!JSON.stringify(received).includes('Buffer'));
                assert(!JSON.stringify(received).includes('stack'));
            }
            now += 30000; health.fail('upstream_request', error); assert.strictEqual(messages.length, 2);
            const reconnect = []; health.send({ speech_health_subscribed: true, sendmsg: value => reconnect.push(value) });
            assert.strictEqual(reconnect[0].health.state, 'error', 'new windows immediately receive the current fault');
            health.clear('upstream_request');
            assert.strictEqual(one.at(-1).health.state, 'ok'); assert.strictEqual(two.at(-1).health.state, 'ok');
            assert.deepStrictEqual(legacyMessages, [], 'legacy clients must not receive messages they cannot understand');
        } finally { admin.on_close(app, a); admin.on_close(app, b); }
    });

    it('continues the real admin notification path when sending to the speech worker throws', function() {
        const received = [], ws = { sendmsg: message => received.push(message), respond() {} };
        const app = { config: { speech: { enabled: true, api_key: KEY } }, wss: { clients: new Set([ws]) } };
        const service = app.speech = create(app);
        service.stopped = false;
        service.worker = { postMessage() { throw new Error('fixture clone failed'); }, terminate: async () => {} };
        admin.on_connect(app, ws);
        admin.handle_speech_health_subscribe(app, ws, {});
        try {
            assert.doesNotThrow(() => admin.notify_change(app, 'default', 'match_called_on_court', { _id: 'match', setup: {} }));
            assert.strictEqual(service.worker, null);
            assert(received.some(msg => msg.type === 'speech_health' && msg.health.issues.some(issue => issue.message === 'fixture clone failed')));
            assert(received.some(msg => msg.ctype === 'match_called_on_court'), 'the original tournament change must still be delivered');
            assert.doesNotThrow(() => admin.notify_change(app, 'default', 'score', { match_id: 'match', network_score: [1, 0] }));
            assert.strictEqual(received.at(-1).ctype, 'score');
            const beforeStop = messages.length; service.stop();
            assert.strictEqual(messages.length, beforeStop, 'normal shutdown must not report another fault');
        } finally { service.stop(); admin.on_close(app, ws); }
    });

    it('contains initialization and projection failures without a global uncaught-exception handler', async function() {
        const listeners = process.listeners('uncaughtException');
        const app = { config: { get speech() { throw new Error('bad speech configuration'); } } };
        const service = create(app);
        assert.doesNotThrow(() => service.start());
        assert.strictEqual(service.health.snapshot().issues[0].retrying, false);
        assert.strictEqual((await service.request({ type: 'speech_queue' })).speech_error, 'speech_unavailable');
        assert.deepStrictEqual(process.listeners('uncaughtException'), listeners);
        const running = create({ config: { speech: { enabled: true, api_key: KEY } } });
        assert.doesNotThrow(() => running.configure(null));
        assert(running.health.snapshot().issues.some(issue => issue.source === 'bridge:configure'));
        running.stop(); service.stop();
    });

    it('contains asynchronous speech handler failures and returns a bounded error response', async function() {
        const issues = [], answers = [];
        const app = { speech: { health: { fail: (source, error) => issues.push([source, error.message]) },
            prefetch: { planning_status() { throw new Error('fixture planning failed'); } } } };
        await require('../bts/speech').handle(app, { speech_tournament_key: 'default',
            respond_background(_message, error, answer) { assert.ifError(error); answers.push(answer); },
        }, { type: 'speech_planning', tournament_key: 'default' });
        assert.deepStrictEqual(issues, [['request_handler', 'fixture planning failed']]);
        assert.deepStrictEqual(answers, [{ speech_error: 'speech_unavailable', clips: [] }]);
    });

    it('explains an offline speech server once, shares the cause with admins and clears it after reconnecting', async function() {
        let now = 10000, offline = true;
        const error = Object.assign(new Error('connect ECONNREFUSED ' + KEY), { code: 'ECONNREFUSED' });
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: KEY }, {}), {
            now: () => now,
            request: async (_base, _key, _method, route) => {
                if (offline) throw error;
                return route === '/health' ? { status: 'ready', model_revision: 'a'.repeat(40) } : { voices: [] };
            },
        });
        await broker.refresh(); await broker.refresh();
        assert.strictEqual(messages.length, 1, 'health and voice checks share one connection warning');
        assert(messages[0][0].includes('Sprachserver nicht erreichbar (http://127.0.0.1:8077)'));
        assert(messages[0][0].includes('„make dev“ startet nur BTS'));
        assert(messages[0][0].includes('automatisch erneut'));
        assert(!messages[0][0].includes('\n    at '), 'an expected network outage has no crash stack');
        const issues = broker.health.snapshot().issues;
        assert.strictEqual(issues.length, 2);
        assert(issues.every(issue => issue.kind === 'upstream_connection' && issue.endpoint === 'http://127.0.0.1:8077'));
        assert(!JSON.stringify([issues, messages]).includes(KEY), 'raw network errors cannot leak credentials');
        broker.health.clear('upstream_health');
        await broker.refresh(); assert.strictEqual(messages.length, 1, 'one remaining failed check retains the log throttle');
        now += 30000; await broker.refresh(); assert.strictEqual(messages.length, 2);
        broker.health.fail('upstream_request', error, true, { endpoint: broker.config.base_url });
        offline = false; await broker.refresh();
        assert.strictEqual(broker.health.snapshot().state, 'ok', 'recovery also clears a previous request connection error');
        offline = true; await broker.refresh();
        assert.strictEqual(messages.length, 3, 'a new outage after recovery must be reported immediately');
    });

    it('shows safe remote connection advice without publishing URL credentials or local start instructions', function() {
        const health = new SpeechHealth();
        health.fail('upstream_health', Object.assign(new Error(KEY), { code: 'speech_timeout' }), true,
            { endpoint: 'https://operator:' + KEY + '@speech.example:8077/private?token=' + KEY });
        const issue = health.snapshot().issues[0];
        assert.strictEqual(issue.endpoint, 'https://speech.example:8077');
        assert(issue.message.includes('nicht rechtzeitig'));
        assert(issue.action.includes('Netzwerkverbindung'));
        assert(!issue.action.includes('make dev'));
        assert(!JSON.stringify([health.snapshot(), messages]).includes(KEY));
    });

    it('keeps the broker running through a playback HTTP failure and clears its fault after a successful retry', async function() {
        let now = 10000, fail = true;
        const error = Object.assign(new Error('speech_http_error'), { status: 503, response: { error: { code: 'playback_processing_failed' } } });
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: KEY }, {}), { now: () => now,
            request: async (_base, _key, _method, _path, body) => {
                if (fail) throw error;
                return { ...body, job_id: 'a'.repeat(32), status: 'completed', audio: { audio_id: 'a'.repeat(32) } };
            } });
        broker.prepare(['Testansage'], { priority: 'high' }, 'default');
        await broker.step();
        assert.strictEqual(broker.stepping, false);
        assert.strictEqual(broker.health.snapshot().issues[0].code, 'playback_processing_failed');
        now += 5001; fail = false; await broker.step();
        assert.strictEqual(broker.health.snapshot().state, 'ok');
        assert.strictEqual([...broker.entries.values()][0].status, 'completed');
    });

    for (const terminal of [false, true]) it('reports the rejected excerpt and its recovery without inventing a crash stack: ' + (terminal ? 'exhausted' : 'recovered'), async function() {
        let now = 10000;
        const sent = [];
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: KEY }, {}), { now: () => now,
            request: async (_base, _key, _method, _path, body) => {
                sent.push(body);
                const job_id = sent.length.toString(16).padStart(32, '0');
                const failed = body.context && (terminal || !body.context.before.startsWith('Wir erwarten '));
                return { ...body, job_id, status: failed ? 'failed' : 'completed',
                    ...(failed ? { error: { code: 'alignment_failed', message: KEY }, diagnostics: {
                        cache_key: job_id.repeat(2), failure_count: 1, last_failure_at: now / 1000,
                        recent_failures: [{ event_id: job_id + ':attempt:1', created_at: now / 1000,
                            code: 'alignment_failed', reason: 'team_anchors_missing', stage: 'excerpt', attempt: 1 }],
                    } } : { audio: { audio_id: job_id, processed: !!body.context } }) };
            } });
        broker.context_version = 'bts-context-v2';
        const part = '~bts-context-v2~' + JSON.stringify({ before: '', text: 'Chunming Yang',
            after: ' spielt jetzt gegen Chunming Yang!', kind: 'team' });
        broker.prepare([part], {}, 'default');
        for (let step = 0; step < 10; step++) { await broker.step(); now += 1000; }
        const entry = broker.entries.get(broker.key(part, 'hallensprecherin', 'de-DE'));
        assert.strictEqual(entry.status, terminal ? 'failed' : 'completed');
        assert.strictEqual(sent.length, 6, 'recovery stays bounded and never repeats a rejected cut');
        const logs = messages.filter(args => args[0].startsWith('[bts speech] generation:'));
        assert.strictEqual(logs.length, terminal ? 3 : 2);
        assert(logs[0][1].includes('Job ' + '2'.padStart(32, '0')));
        assert(logs[0][1].includes('team_anchors_missing'));
        assert(logs[0][1].includes('hallensprecherin'));
        assert(logs[0][1].includes('Chunming Yang'));
        assert(logs[0][1].includes('Ersatz: neue Kontextaufnahme'));
        assert(logs[1][1].includes('Ersatz: anderer Namenskontext'));
        assert(!JSON.stringify(logs).includes(KEY), 'raw upstream messages and credentials stay private');
        assert(!JSON.stringify(logs).includes('SpeechBroker.update'), 'the reporting location is not the failure cause');
        assert.strictEqual(broker.failures.get(broker.identity, entry.key).recent_failures.length, terminal ? 3 : 2);
        if (terminal) {
            assert(logs[2][1].includes('Keine weitere Ersatzaufnahme'));
            assert.strictEqual(broker.health.snapshot().issues[0].retrying, false);
        } else assert.strictEqual(broker.health.snapshot().state, 'ok', 'successful recovery still clears the alert');
    });

    it('does not hide one tournament planning fault when another tournament is refreshed successfully', async function() {
        const prefetch = new Prefetcher({}, { config: { enabled: true, max_entries: 10 }, pending_plans: new Set() });
        prefetch.subscriptions.set('one', {}); prefetch.subscriptions.set('two', {});
        let fail = true;
        prefetch.refresh = async key => { if (key === 'one' && fail) throw new Error('invalid event data'); };
        const refresh = async () => {
            prefetch.schedule('one', undefined, true); prefetch.schedule('two', undefined, true);
            await new Promise(resolve => setTimeout(resolve, 20));
        };
        try {
            await refresh();
            assert.strictEqual(prefetch.health.snapshot().issues[0].source, 'prefetch:one');
            fail = false; await refresh();
            assert.strictEqual(prefetch.health.snapshot().state, 'ok');
        } finally { prefetch.stop(); }
    });

    it('contains asynchronous startup callback errors in the optional inline service too', async function() {
        const app = { db: { tournaments: { find: (_query, callback) => setImmediate(() => callback(null, [{ key: 'default' }])) } } };
        const prefetch = new Prefetcher(app, { config: { enabled: true, prefetch_interval_ms: 30000 }, pending_plans: new Set() });
        prefetch.subscribe = () => { throw new Error('fixture invalid startup data'); };
        try {
            prefetch.start();
            await new Promise(resolve => setImmediate(resolve));
            assert.strictEqual(prefetch.health.snapshot().issues[0].code, 'fixture invalid startup data');
        } finally { prefetch.stop(); }
    });

    it('treats explicit model startup as a lifecycle state, pauses generation and recovers without a false alarm', async function() {
        let starting = false;
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: KEY }, {}), {
            request: async (_base, _key, _method, route) => {
                if (route === '/v1/voices') return { voices: [] };
                const health = { status: starting ? 'starting' : 'ready', model_revision: 'a'.repeat(40) };
                if (starting) throw Object.assign(new Error('speech_http_error'), { status: 503, response: health });
                return health;
            },
        });
        await broker.refresh(); assert.strictEqual(broker.metadata_verified, true);
        starting = true; await broker.refresh();
        assert.strictEqual(broker.metadata_verified, false, 'a restarted model must become ready before any new generation');
        assert.strictEqual(broker.health.snapshot().state, 'ok');
        assert.strictEqual(broker.last_error, 'speech_unavailable', 'local speech is still unavailable while loading');
        assert.deepStrictEqual(messages, [], 'a documented starting response must not print an error stack');
        starting = false; await broker.refresh();
        assert.strictEqual(broker.metadata_verified, true);
        assert.strictEqual(broker.last_error, null);
    });

    it('still reports a genuine HTTP 503 and an explicit model error state', async function() {
        let error = Object.assign(new Error('speech_http_error'), { status: 503 });
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: KEY }, {}), {
            request: async (_base, _key, _method, route) => {
                if (route === '/v1/voices') return { voices: [] };
                throw error;
            },
        });
        await broker.refresh();
        assert(broker.health.snapshot().issues.some(issue => issue.source === 'upstream_health'));
        assert.strictEqual(messages.length, 1);
        error = Object.assign(new Error('speech_http_error'), { status: 503, response: { status: 'error', last_error: 'model_load_failed' } });
        await broker.refresh();
        assert(broker.health.snapshot().issues.some(issue => issue.source === 'upstream_health'));
    });
});
