'use strict';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { promisify } = require('util');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { request } = require('../bts/speech/http');
const proxy = require('../bts/speech/proxy');
const { handle } = require('../bts/speech');
const { Prefetcher } = require('../bts/speech/prefetch');
const database = require('../bts/database');
const admin = require('../bts/admin');
const { tournament, setup } = require('./test_speech_text');

const KEY = 'test-only-key-' + 'x'.repeat(32);
const TEXT = ' In Vorbereitung! Jungeneinzel U17: Halbfinale! Schöttmer\n';
const listening = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const id = () => crypto.randomBytes(16).toString('hex');

function config(extra = {}) {
    return configuration({ enabled: true, api_key: KEY, ...extra }, {});
}

function reply(entry, status = 'queued') {
    return { ...entry, job_id: entry.job_id || id(), status,
        audio: status === 'completed' ? { audio_id: entry.job_id || id() } : null };
}

async function http_fixture() {
    const jobs = new Map(), requests = [];
    const wav = Buffer.from('RIFF-test-wave-data');
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            if (req.headers['x-api-key'] !== KEY) { res.writeHead(401).end(); return; }
            requests.push({ method: req.method, url: req.url, range: req.headers.range });
            const json = (status, data) => {
                res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
            };
            if (req.url === '/v1/voices') return json(200, { voices: [
                { voice_id: 'hallensprecherin', version: '1', languages: ['de-DE'] },
            ] });
            if (req.url === '/health') return json(200, { model: 'Qwen/Base', model_revision: 'a'.repeat(40) });
            if (req.url === '/v1/speech') {
                const body = JSON.parse(Buffer.concat(chunks).toString());
                const job = reply(body);
                jobs.set(job.job_id, job);
                return json(202, job);
            }
            if (req.url.startsWith('/v1/jobs/')) {
                const job = jobs.get(req.url.split('/').pop());
                return json(job ? 200 : 404, job || {});
            }
            if (req.url.startsWith('/v1/audio/')) {
                const partial = req.headers.range === 'bytes=0-3';
                const payload = partial ? wav.subarray(0, 4) : wav;
                res.writeHead(partial ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': payload.length,
                    'Accept-Ranges': 'bytes', ...(partial ? { 'Content-Range': 'bytes 0-3/' + wav.length } : {}) });
                return res.end(payload);
            }
            if (req.url === '/invalid-json') return res.end('{');
            if (req.url === '/slow') return;
            res.writeHead(404).end();
        });
    });
    await listening(server);
    return { server, jobs, requests, wav, url: 'http://127.0.0.1:' + server.address().port };
}

function fetch_buffer(url, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get(url, { headers }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
}

describe('Server speech adapter and protected audio', function() {
    this.timeout(10000);

    it('keeps credentials private and disables a missing/unsafe configuration', function() {
        const broker = new SpeechBroker(config());
        const public_data = JSON.stringify(broker.public_config());
        assert(!public_data.includes(KEY));
        assert(!public_data.includes('api_key'));
        assert(!public_data.includes('127.0.0.1'));
        assert.strictEqual(configuration({ enabled: true }, {}).enabled, false);
        assert.strictEqual(config({ url: 'file:///etc/passwd' }).enabled, false);
        assert.strictEqual(config({ url: 'http://secret@127.0.0.1:8077' }).enabled, false);
    });

    it('deduplicates exact text, submits asynchronously, polls and returns only signed ready audio', async function() {
        const fixture = await http_fixture();
        let time = Date.now();
        const broker = new SpeechBroker(config({ url: fixture.url }), { now: () => time });
        try {
            broker.prepare([TEXT, TEXT], { priority: 'low' });
            assert.strictEqual(broker.entries.size, 1);
            assert.strictEqual(fixture.requests.length, 0);
            assert.strictEqual(broker.views([TEXT], {}, 'default')[0].audio_url, null);
            await broker.step();
            const job = [...fixture.jobs.values()][0];
            assert.strictEqual(job.text, TEXT);
            assert.strictEqual(job.priority, 'low');
            fixture.jobs.set(job.job_id, reply(job, 'completed'));
            time += 3000;
            await broker.step();
            const view = broker.views([TEXT], {}, 'default')[0];
            assert.strictEqual(view.status, 'completed');
            const url = new URL(view.audio_url, fixture.url);
            assert(broker.authorize('default', url.pathname.split('/').pop(),
                url.searchParams.get('expires'), url.searchParams.get('signature')));
            assert(!view.audio_url.includes(KEY));
            broker.prepare([TEXT]);
            assert.strictEqual(fixture.requests.filter(req => req.method === 'POST').length, 1);
        } finally { await close(fixture.server); }
    });

    it('keeps a ready clip usable while revalidating its older cache reference in the background', async function() {
        let time = Date.now();
        let posts = 0;
        const broker = new SpeechBroker(config(), { now: () => time, request: async (_base, _key, _method, _path, body) => {
            posts++;
            return reply(body, 'completed');
        } });
        broker.prepare([TEXT]);
        await broker.step();
        time += 301000;
        broker.prepare([TEXT], { priority: 'high' });
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].status, 'completed');
        assert.strictEqual(posts, 1, 'playback lookup must not await an upstream cache revalidation');
        await broker.step();
        assert.strictEqual(posts, 2);
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].status, 'completed');
    });

    it('promotes queued prefetch work when it is needed for an actual call', async function() {
        let time = Date.now();
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => time,
            request: async (_base, _key, _method, _path, body) => { sent.push(body); return reply(body); } });
        broker.prepare(['low', 'urgent']);
        broker.prepare(['urgent'], { priority: 'high' });
        await broker.step();
        assert.strictEqual(sent[0].text, 'urgent');
        assert.strictEqual(sent[0].priority, 'high');
        time += 1000;
        await broker.step();
        broker.prepare(['low'], { priority: 'high' });
        time += 1000;
        await broker.step();
        assert.strictEqual(sent[2].text, 'low');
        assert.strictEqual(sent[2].priority, 'high');
    });

    it('backs off a full queue instead of flooding the speech server', async function() {
        let time = Date.now(), count = 0;
        const broker = new SpeechBroker(config(), { now: () => time, request: async () => {
            count++; throw Object.assign(new Error('capacity'), { status: 429 });
        } });
        broker.prepare([TEXT]);
        await broker.step();
        time += 1000;
        await broker.step();
        assert.strictEqual(count, 1);
        assert.strictEqual(broker.last_error, 'speech_busy');
        time += 10000;
        await broker.step();
        assert.strictEqual(count, 2);
    });

    it('bounds the local queue and validates both content and voice/language', function() {
        const broker = new SpeechBroker(config({ max_entries: 32 }));
        broker.prepare(Array.from({ length: 40 }, (_, i) => 'text ' + i));
        assert.strictEqual(broker.entries.size, 32);
        assert.throws(() => broker.prepare([' ']));
        assert.throws(() => broker.prepare([TEXT], { voice: '../../voices' }));
        assert.throws(() => broker.prepare([TEXT], { language: 'en-GB' }));
        assert.throws(() => broker.prepare(Array(65).fill(TEXT)));
    });

    it('rejects mismatched upstream text and malformed completed audio', async function() {
        const broker = new SpeechBroker(config(), { request: async (_base, _key, _method, _path, body) =>
            reply({ ...body, text: body.text.trim() }, 'completed') });
        broker.prepare([TEXT]);
        await broker.step();
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].audio_url, null);
        assert.strictEqual([...broker.entries.values()][0].status, 'unsubmitted');
    });

    it('invalidates completed references after a model or voice-version change', async function() {
        let revision = 'a'.repeat(40);
        const broker = new SpeechBroker(config(), { request: async (_base, _key, _method, pathname, body) => {
            if (pathname === '/health') return { model: 'Qwen/Base', model_revision: revision };
            if (pathname === '/v1/voices') return { voices: [{ voice_id: 'hallensprecherin', version: '1', languages: ['de-DE'] }] };
            return reply(body, 'completed');
        } });
        await broker.refresh();
        broker.prepare([TEXT]);
        await broker.step();
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].status, 'completed');
        revision = 'b'.repeat(40);
        await broker.refresh();
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].audio_url, null);
    });

    it('invalidates the full synthesis identity even while the new model is starting', async function() {
        let configuration_version = 'one';
        let starting = false;
        const broker = new SpeechBroker(config(), { request: async (_base, _key, _method, pathname, body) => {
            if (pathname === '/health') {
                const health = { model: 'Qwen/Base', model_revision: 'a'.repeat(40), configuration_version };
                if (starting) throw Object.assign(new Error('starting'), { status: 503, response: { ...health, status: 'starting' } });
                return health;
            }
            if (pathname === '/v1/voices') return { voices: [] };
            return reply(body, 'completed');
        } });
        await broker.refresh();
        broker.prepare([TEXT]);
        await broker.step();
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].status, 'completed');
        configuration_version = 'two';
        starting = true;
        await broker.refresh();
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].audio_url, null);
    });

    it('drops a failed WebSocket send callback so a late answer cannot replay it', function() {
        const connection = require('../static/js/conn')(() => {}, () => {});
        const message = { type: 'speech_resolve' };
        let calls = 0;
        assert.throws(() => connection.send(message, () => { calls++; }));
        connection._test_handle_message({ data: JSON.stringify({ type: 'answer', rid: message.rid }) });
        assert.strictEqual(calls, 0);
    });

    it('rejects forged, expired, wrong-tournament and invalid-ID audio grants', function() {
        let time = Date.now();
        const broker = new SpeechBroker(config(), { now: () => time });
        const audio_id = id();
        const url = new URL(broker.audio_url('default', audio_id), 'http://localhost');
        const expires = url.searchParams.get('expires'), signature = url.searchParams.get('signature');
        assert(broker.authorize('default', audio_id, expires, signature));
        assert(!broker.authorize('other', audio_id, expires, signature));
        assert(!broker.authorize('default', '../secret', expires, signature));
        assert(!broker.authorize('default', audio_id, expires, 'x'.repeat(43)));
        time += 901000;
        assert(!broker.authorize('default', audio_id, expires, signature));
    });

    it('streams WAV/ranges through the proxy while denying unsigned requests', async function() {
        const fixture = await http_fixture();
        const app = express();
        const broker = new SpeechBroker(config({ url: fixture.url }));
        app.speech = { broker };
        app.get('/h/:tournament_key/speech/audio/:audio_id', proxy);
        const server = http.createServer(app);
        await listening(server);
        const base = 'http://127.0.0.1:' + server.address().port;
        try {
            const url = base + broker.audio_url('default', id());
            const unauthorized = await fetch_buffer(base + '/h/default/speech/audio/' + id());
            assert.strictEqual(unauthorized.status, 401);
            const result = await fetch_buffer(url, { Range: 'bytes=0-3' });
            assert.strictEqual(result.status, 206);
            assert.strictEqual(result.headers['content-type'], 'audio/wav');
            assert(result.headers['cache-control'].startsWith('private'));
            assert.strictEqual(result.body.toString(), 'RIFF');
            assert.strictEqual(broker.audio_clients, 0);
            assert.strictEqual(fixture.requests.at(-1).range, 'bytes=0-3');
        } finally { await close(server); await close(fixture.server); }
    });

    it('returns a bounded proxy error when the speech service is unavailable', async function() {
        const app = express();
        const broker = new SpeechBroker(config({ url: 'http://127.0.0.1:1' }));
        app.speech = { broker };
        app.get('/h/:tournament_key/speech/audio/:audio_id', proxy);
        const server = http.createServer(app); await listening(server);
        try {
            const result = await fetch_buffer('http://127.0.0.1:' + server.address().port + broker.audio_url('default', id()));
            assert.strictEqual(result.status, 503);
            assert(!result.body.toString().includes(KEY));
            assert.strictEqual(broker.audio_clients, 0);
        } finally { await close(server); }
    });

    it('uses a total HTTP timeout and rejects malformed protocol responses', async function() {
        const fixture = await http_fixture();
        try {
            await assert.rejects(request(fixture.url, KEY, 'GET', '/slow', undefined, 30), /speech_timeout/);
            await assert.rejects(request(fixture.url, KEY, 'GET', '/invalid-json'), /speech_invalid_response/);
        } finally { await close(fixture.server); }
    });

    it('keeps speech control on a loaded admin tournament, without global connection errors', function() {
        const broker = new SpeechBroker(config());
        const subscriptions = [], responses = [];
        const app = { speech: { broker, prefetch: { subscribe: (...args) => subscriptions.push(args) } } };
        const ws = { respond: (_msg, error, response) => { assert.ifError(error); responses.push(response); } };
        const msg = { type: 'speech_prepare', tournament_key: 'default', parts: [TEXT] };
        handle(app, ws, msg);
        assert.strictEqual(responses[0].speech_error, 'tournament_not_loaded');
        ws.speech_tournament_key = 'default';
        admin.handle_speech_prepare(app, ws, msg);
        assert.strictEqual(subscriptions.length, 1);
        assert.strictEqual(responses[1].clips[0].audio_url, null);
        assert.strictEqual(broker.entries.size, 1);
    });

    it('inspects exact parts without submitting jobs, promoting priorities or exposing audio URLs', function() {
        const broker = new SpeechBroker(config());
        broker.prepare([TEXT]);
        const entry = [...broker.entries.values()][0];
        entry.status = 'completed';
        entry.audio_id = id();
        const before = JSON.stringify([...broker.entries.values()]);
        const responses = [];
        const app = { speech: { broker, prefetch: { subscribe() { throw new Error('inspection must not subscribe'); } } } };
        const ws = { speech_tournament_key: 'default', respond: (_msg, error, response) => {
            assert.ifError(error); responses.push(response);
        } };
        const msg = { type: 'speech_status', tournament_key: 'default', voice: 'hallensprecherin',
            language: 'de-DE', parts: [TEXT, 'Noch nicht angefragt'] };
        handle(app, ws, msg);
        assert.deepStrictEqual(responses[0].clips, [{ status: 'completed' }, { status: 'missing' }]);
        assert.strictEqual(JSON.stringify([...broker.entries.values()]), before);
        assert(!JSON.stringify(responses[0]).includes(KEY));
        handle(app, ws, { ...msg, voice: 'hallensprecher' });
        assert(responses[1].clips.every(clip => clip.status === 'missing'));
        handle(app, ws, { ...msg, parts: Array(65).fill(TEXT) });
        assert.strictEqual(responses[2].speech_error, 'invalid_speech_request');
        handle(app, ws, { ...msg, parts: null });
        assert.strictEqual(responses[3].speech_error, 'invalid_speech_request');
        handle(app, ws, { ...msg, parts: [TEXT], audio_urls: true });
        const clip = responses[4].clips[0];
        assert.strictEqual(clip.status, 'completed');
        assert(clip.audio_url.startsWith('/h/default/speech/audio/'));
        assert.strictEqual(JSON.stringify([...broker.entries.values()]), before);
    });

    it('exposes an opaque cache revision that changes with synthesis identity', function() {
        const broker = new SpeechBroker(config());
        broker.identity = JSON.stringify(['Qwen/Base', 'revision-one', 'voice-config']);
        const first = broker.public_config().cache_version;
        assert(/^[a-f0-9]{64}$/.test(first));
        assert.strictEqual(broker.public_config().cache_version, first);
        broker.identity = JSON.stringify(['Qwen/Base', 'revision-two', 'voice-config']);
        assert.notStrictEqual(broker.public_config().cache_version, first);
    });

    it('prepares from real persisted match data before a call, then uses changed text', async function() {
        const db = await database.init_test();
        const current = tournament();
        const fixture = {
            tournaments: [current], locations: current.locations.map(value => ({ ...value, tournament_key: 'default' })),
            courts: current.courts.map(value => ({ ...value, tournament_key: 'default' })),
            matches: [{ _id: 'match1', tournament_key: 'default', setup: setup() }],
        };
        for (const [collection, values] of Object.entries(fixture)) {
            await promisify(db[collection].insert.bind(db[collection]))(values);
        }
        const broker = new SpeechBroker(config());
        const prefetch = new Prefetcher({ db }, broker);
        prefetch.subscriptions.set('default', new Set(['hallensprecherin']));
        await prefetch.refresh('default');
        assert([...broker.entries.values()].some(entry => entry.text.includes('Muhammad Sytsh Abdulquddus')));
        assert([...broker.entries.values()].every(entry => entry.status === 'unsubmitted'));
        await db.matches.update_async({ _id: 'match1' }, { $set: { 'setup.teams.1.players.0.name': 'Neuer Gegner' } }, {});
        await prefetch.refresh('default');
        assert([...broker.entries.values()].some(entry => entry.text.includes('Neuer Gegner')));
        assert.strictEqual(broker.views(['Johann Bjarne Schöttmer, gegen Neuer Gegner'], {}, 'default')[0].audio_url, null);
        prefetch.stop();
    });
});
