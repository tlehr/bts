'use strict';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { promisify } = require('util');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { request } = require('../bts/speech/http');
const proxy = require('../bts/speech/proxy');
const { create, handle } = require('../bts/speech');
const resolveSettings = require('../static/js/speech_settings');
const { Prefetcher } = require('../bts/speech/prefetch');
const database = require('../bts/database');
const admin = require('../bts/admin');
const { tournament, setup } = require('./test_speech_text');
const { wave, pcm } = require('./fixtures/speech_pcm');

const KEY = 'test-only-key-' + 'x'.repeat(32);
const TEXT = ' In Vorbereitung! Jungeneinzel U17: Halbfinale! Schöttmer\n';
const SPOKEN_TEXT = ' In Vorbereitung! Jungeneinzel U siebzehn: Halbfinale! Schöttmer\n';
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

    it('reacts to confirmed score finishes through the real admin notification path without replanning for every point', async function() {
        const db = await database.init_test(), scheduled = [];
        const app = { db, config: { speech: { enabled: true, api_key: KEY } } };
        app.speech = create(app);
        app.speech.prefetch.schedule = key => scheduled.push(key);
        admin.notify_change(app, 'default', 'score', { now_on_court: true });
        assert.deepStrictEqual(scheduled, []);
        admin.notify_change(app, 'default', 'score', { now_on_court: false, team1_won: true });
        admin.notify_change(app, 'default', 'score', { team1_won: false });
        assert.deepStrictEqual(scheduled, ['default', 'default']);
        app.speech.stop();
    });

    it('expires obsolete contextual foreground requests without keeping their source pinned forever', function() {
        let clock = 1000;
        const broker = new SpeechBroker(config(), { now: () => clock });
        broker.context_version = 'bts-context-v1';
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Auf Spielfeld acht! ',
            text: 'Tabletbedienung: Ein Team', after: '', kind: 'generic' });
        broker.prepare([part], { priority: 'high' }, 'default');
        broker.prepare(['Freier Text'], {}, 'default');
        assert.strictEqual(broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin' }), 10000);
        clock += 10001;
        broker.prepare([part], { prefetch: true }, 'default');
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin' });
        assert.deepStrictEqual(broker.queue('default').items.map(item => item.text), ['Freier Text']);
    });

    it('retains a shared source for the latest actual request without extending it through background preparation', function() {
        let clock = 1000;
        const broker = new SpeechBroker(config(), { now: () => clock }); broker.context_version = 'bts-context-v1';
        const first = '~bts-context-v1~' + JSON.stringify({ before: '', text: 'Ein Team', after: ' gegen Andere.', kind: 'team' });
        const second = '~bts-context-v1~' + JSON.stringify({ before: 'Ein Team gegen ', text: 'Andere', after: '.', kind: 'team' });
        broker.prepare([first], { priority: 'high' }, 'default'); clock += 5000;
        broker.prepare([second], { priority: 'high' }, 'default');
        broker.prepare([first], { prefetch: true }, 'default');
        clock = 12000;
        assert.strictEqual(broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin' }), 4000);
        const child = broker.entries.get(broker.key(second, 'hallensprecherin', 'de-DE'));
        assert(child && broker.entries.has(child.source_key));
        clock = 17000;
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin' });
        assert.strictEqual(broker.entries.size, 0);
    });

    it('retires stale prefetch without cancelling an active request, manual calls or another tournament', async function() {
        let clock = 1000, current;
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => clock,
            request: async (_base, _key, method, _route, body) => {
                if (method === 'GET') return reply(current, 'completed');
                sent.push(body); current = reply(body, 'processing'); return current;
            } });
        broker.prepare(['obsolete', 'needed', 'shared'], { prefetch: true }, 'default');
        broker.prepare(['shared'], { prefetch: true }, 'other');
        await broker.step(); clock += 3000;
        broker.prepare(['manual'], { priority: 'high' }, 'default');
        broker.reconcile_prefetch('default', ['needed'], { voice: 'hallensprecherin' });
        assert(broker.current, 'retiring an active entry must not release its one current slot');
        assert.deepStrictEqual(broker.queue('default').items.map(item => item.text).sort(), ['manual', 'needed']);
        assert(broker.queue('other').items.some(item => item.text === 'shared'));
        assert.strictEqual(sent.length, 1);
        await broker.step(); clock += 1000;
        assert.strictEqual(broker.current, null);
        await broker.step();
        assert.deepStrictEqual(sent.map(body => body.text), ['obsolete', 'manual']);
    });

    it('does not start a context or individual fallback for a retired in-flight team excerpt', async function() {
        let clock = 1000, current;
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => clock,
            request: async (_base, _key, method, _route, body) => {
                if (method === 'GET') return { ...current, status: 'failed', error: { code: 'alignment_failed' } };
                sent.push(body); const job_id = id();
                return (current = { ...body, job_id, status: body.context ? 'processing' : 'completed',
                    audio: body.context ? null : { audio_id: job_id } });
            } });
        broker.context_version = 'bts-context-v1';
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Finale! ', text: 'Ein Team', after: ' gegen Andere.', kind: 'team' });
        broker.prepare([part], { prefetch: true }, 'default');
        await broker.step(); clock += 1000;
        await broker.step(); clock += 3000;
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin' });
        await broker.step(); clock += 1000;
        await broker.step();
        assert.strictEqual(sent.length, 2);
        assert.strictEqual(broker.entries.size, 0);
        assert.strictEqual(broker.current, null);
    });

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

    it('deduplicates original text, submits spelled numbers asynchronously, polls and returns only signed ready audio', async function() {
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
            assert.strictEqual(job.text, SPOKEN_TEXT);
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

    it('chooses actual calls before unsent prefetch without replacing an active job', async function() {
        let time = Date.now();
        const sent = [], jobs = new Map();
        const broker = new SpeechBroker(config(), { now: () => time,
            request: async (_base, _key, method, route, body) => {
                if (method === 'GET') return jobs.get(route.split('/').at(-1));
                sent.push(body); const job = reply(body); jobs.set(job.job_id, job); return job;
            } });
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
        assert.strictEqual(sent.length, 1);
        const active = [...jobs.values()][0];
        jobs.set(active.job_id, reply(active, 'completed'));
        time += 3000;
        await broker.step();
        time += 1000;
        await broker.step();
        assert.strictEqual(sent[1].text, 'low');
        assert.strictEqual(sent[1].priority, 'high');
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

    it('notifies associated tournaments once on completion or failure after releasing the current job', async function() {
        let time = Date.now(), active;
        const changes = [];
        const broker = new SpeechBroker(config(), { now: () => time,
            onChange: keys => {
                assert.strictEqual(broker.current, null);
                assert.strictEqual(broker.stepping, false);
                changes.push(keys);
            },
            request: async (_base, _key, method, _route, body) => {
                if (method === 'GET') return active;
                return (active = reply(body, body.text === 'failure' ? 'failed' : body.text === 'cached' ? 'completed' : 'queued'));
            },
        });
        broker.prepare([TEXT], {}, 'default');
        broker.prepare([TEXT], {}, 'other');
        await broker.step();
        assert.deepStrictEqual(changes, []);
        active = reply(active, 'processing');
        time += 3000; await broker.step();
        assert.deepStrictEqual(changes, []);
        active = reply(active, 'completed');
        time += 3000; await broker.step();
        assert.deepStrictEqual(changes, [['default', 'other']]);
        broker.prepare([TEXT], {}, 'default');
        time += 3000; await broker.step();
        assert.strictEqual(changes.length, 1, 'an unchanged ready recording must not send duplicate notifications');
        broker.prepare(['failure'], {}, 'default');
        await broker.step();
        assert.deepStrictEqual(changes, [['default', 'other'], ['default']]);
        broker.prepare(['cached'], {}, 'default');
        time += 3000; await broker.step();
        assert.deepStrictEqual(changes, [['default', 'other'], ['default'], ['default']]);
        assert(!JSON.stringify(changes).includes(TEXT));
        assert(!JSON.stringify(changes).includes(KEY));
    });

    it('reports the actual priority and alternating-voice dispatch order without changing it', async function() {
        let time = Date.now();
        const sent = [];
        const broker = new SpeechBroker(config({ submit_interval_ms: 0 }), { now: () => time,
            request: async (_base, _key, _method, _route, body) => {
                sent.push(body); return reply(body, 'completed');
            } });
        for (const voice of ['hallensprecherin', 'hallensprecher']) {
            for (const priority of ['low', 'high', 'normal']) {
                broker.prepare([priority + ' one', priority + ' two'], { voice, priority }, 'default');
                time++;
            }
        }
        const before = JSON.stringify([...broker.entries.values()]);
        const expected = broker.queue('default').items;
        assert.deepStrictEqual(expected.map(item => item.priority), [
            'high', 'high', 'high', 'high', 'normal', 'normal', 'normal', 'normal', 'low', 'low', 'low', 'low',
        ]);
        assert.deepStrictEqual(expected.slice(0, 4).map(item => item.voice), [
            'hallensprecherin', 'hallensprecher', 'hallensprecherin', 'hallensprecher',
        ]);
        assert.deepStrictEqual(expected.map(item => item.position), Array.from({ length: 12 }, (_, i) => i + 1));
        assert(expected.every(item => item.audio_url === null));
        assert.strictEqual(JSON.stringify([...broker.entries.values()]), before);
        assert.strictEqual(broker.last_post_voice.size, 0);
        for (let i = 0; i < expected.length; i++) { await broker.step(); time += 3000; }
        assert.deepStrictEqual(sent.map(item => [item.text, item.voice]), expected.map(item => [item.text, item.voice]));
        assert(broker.queue('default').items.every(item => item.position === null && item.status === 'completed'));
    });

    it('keeps the current job first, separates deferred work and scopes shared text to its tournaments', async function() {
        const time = Date.now();
        const broker = new SpeechBroker(config(), { now: () => time, request: async (_base, _key, _method, _route, body) => reply(body) });
        broker.prepare(['active'], { priority: 'low' }, 'other');
        await broker.step();
        broker.prepare([TEXT], { voice: 'hallensprecher', priority: 'high' }, 'default');
        broker.prepare(['shared'], {}, 'default');
        broker.prepare(['shared'], {}, 'other');
        broker.prepare(['failed', 'done', 'delayed'], {}, 'default');
        for (const entry of broker.entries.values()) {
            if (entry.text === 'failed') entry.status = 'failed';
            if (entry.text === 'done') { entry.status = 'completed'; entry.audio_id = id(); }
            if (entry.text === 'delayed') entry.retry_at = time + 5000;
        }
        const own = broker.queue('default');
        assert(own.busy_elsewhere);
        assert.deepStrictEqual(own.items.map(item => item.text), [TEXT, 'shared', 'failed', 'delayed', 'done']);
        assert.strictEqual(own.items[0].priority, 'high');
        assert(own.items.slice(2).every(item => item.position === null));
        const other = broker.queue('other');
        assert.strictEqual(other.busy_elsewhere, false);
        assert(other.items[0].current);
        assert.strictEqual(other.items[0].position, 0);
        assert.deepStrictEqual(other.items.map(item => item.text), ['active', 'shared']);
        const url = new URL(own.items.at(-1).audio_url, 'http://localhost');
        const audio_id = url.pathname.split('/').at(-1);
        assert(broker.authorize('default', audio_id, url.searchParams.get('expires'), url.searchParams.get('signature')));
        assert(!broker.authorize('other', audio_id, url.searchParams.get('expires'), url.searchParams.get('signature')));
        assert(!JSON.stringify(own).includes(KEY));
    });

    it('allows queue inspection only for the loaded admin tournament and never schedules generation', function() {
        const broker = new SpeechBroker(config());
        broker.prepare([TEXT], {}, 'default');
        const before = JSON.stringify([...broker.entries.values()]);
        const responses = [];
        const ws = { respond: (_msg, error, response) => { assert.ifError(error); responses.push(response); } };
        const app = { speech: { broker, prefetch: { subscribe() { throw new Error('queue reads must not subscribe'); } } } };
        const msg = { type: 'speech_queue', tournament_key: 'default' };
        admin.handle_speech_queue(app, ws, msg);
        assert.strictEqual(responses[0].speech_error, 'tournament_not_loaded');
        ws.speech_tournament_key = 'default';
        admin.handle_speech_queue(app, ws, msg);
        assert.strictEqual(responses[1].queue.items[0].text, TEXT);
        assert.strictEqual(responses[1].queue.items[0].status, 'unsubmitted');
        assert.strictEqual(JSON.stringify([...broker.entries.values()]), before);
        assert.strictEqual(broker.current, null);
        admin.handle_speech_queue(app, ws, { ...msg, tournament_key: 'other' });
        assert.strictEqual(responses[2].speech_error, 'tournament_not_loaded');
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

    it('spells numbers for both upstream voices while queue, status and playback use the original text', async function() {
        let time = Date.now();
        const sent = [];
        const original = 'Auf Spielfeld 8! Spiel Nummer 186, Jungeneinzel U17!';
        const spoken = 'Auf Spielfeld acht! Spiel Nummer einhundertsechsundachtzig, Jungeneinzel U siebzehn!';
        const broker = new SpeechBroker(config(), { now: () => time, request: async (_base, _key, _method, _route, body) => {
            sent.push(body); return reply(body, 'completed');
        } });
        for (const voice of ['hallensprecherin', 'hallensprecher']) {
            broker.prepare([original, original], { voice }, 'default');
            broker.prepare([original], { voice, priority: 'high' }, 'default');
            await broker.step(); time += 1000;
            assert.strictEqual(broker.views([original], { voice }, 'default')[0].status, 'completed');
            assert.strictEqual(broker.inspect([original], { voice }, 'default')[0].status, 'completed');
        }
        assert.deepStrictEqual(sent.map(body => [body.text, body.voice, body.priority]), [
            [spoken, 'hallensprecherin', 'high'], [spoken, 'hallensprecher', 'high'],
        ]);
        assert.deepStrictEqual(broker.queue('default').items.map(item => item.text), [original, original]);
        assert.strictEqual(broker.entries.size, 2);
        broker.prepare([original], { priority: 'high' }, 'default');
        await broker.step();
        assert.strictEqual(sent.length, 2, 'playing the original numeric text must reuse its prepared recording');
    });

    it('checks the expanded text limit before scheduling any part of an invalid batch', function() {
        const broker = new SpeechBroker(config({ max_text: 10 }));
        assert.throws(() => broker.prepare(['OK', 'Feld 17']), /invalid_speech_parts/);
        assert.strictEqual(broker.entries.size, 0);
        broker.prepare(['Feld 4']);
        assert.strictEqual(broker.entries.size, 1);
    });

    it('rejects a server response for the original digits instead of the requested spoken text', async function() {
        const broker = new SpeechBroker(config(), { request: async (_base, _key, _method, _route, body) =>
            reply({ ...body, text: 'Auf Spielfeld 8' }, 'completed') });
        broker.prepare(['Auf Spielfeld 8']);
        await broker.step();
        assert.strictEqual(broker.views(['Auf Spielfeld 8'], {}, 'default')[0].audio_url, null);
    });

    it('backs off all new parts together when the server rejects a busy request', async function() {
        let time = Date.now();
        const sent = [];
        let accepted, full = true;
        const broker = new SpeechBroker(config(), { now: () => time,
            request: async (_base, _key, method, _path, body) => {
                sent.push({ method, body });
                if (method === 'GET') return reply(accepted);
                if (full) throw Object.assign(new Error('full'), { status: 429 });
                return (accepted = reply(body));
            } });
        broker.prepare(['accepted', 'full', 'another']);
        await broker.step();
        time += 1000;
        await broker.step();
        time += 1000;
        await broker.step();
        assert.deepStrictEqual(sent.map(call => call.method), ['POST']);
        time += 10000;
        full = false;
        await broker.step();
        assert.strictEqual(sent.at(-1).method, 'POST');
        time += 3000;
        await broker.step();
        assert.deepStrictEqual(sent.map(call => call.method), ['POST', 'POST', 'GET']);
    });

    it('keeps exactly one open job and chooses the next priority only after completion', async function() {
        let time = Date.now();
        const posts = [];
        const jobs = new Map();
        const broker = new SpeechBroker(config(), { now: () => time,
            request: async (_base, _key, method, route, body) => {
                if (method === 'GET') return jobs.get(route.split('/').at(-1));
                posts.push(body);
                const job = reply(body); jobs.set(job.job_id, job); return job;
            } });
        broker.prepare(['one', 'two', 'three']);
        await broker.step(); time += 1000;
        await broker.step(); time += 1000;
        await broker.step();
        assert.strictEqual(posts.length, 1);
        broker.prepare(['actual call'], { voice: 'hallensprecher', priority: 'high' });
        await broker.step();
        assert.strictEqual(posts.length, 1);
        const active = [...jobs.values()][0];
        jobs.set(active.job_id, reply(active, 'completed'));
        time += 3000;
        await broker.step();
        time += 1000;
        await broker.step();
        assert.strictEqual(posts.at(-1).text, 'actual call');
        assert.strictEqual(posts.at(-1).priority, 'high');
        assert.strictEqual(posts.length, 2);
    });

    it('holds the same request across a lost POST reply instead of opening another job', async function() {
        let time = Date.now(), calls = 0, active;
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => time,
            request: async (_base, _key, method, _route, body) => {
                if (method === 'GET') return reply(active, 'completed');
                sent.push(body);
                if (++calls === 1) { active = reply(body); throw new Error('speech_timeout'); }
                return body.text === active.text ? active : reply(body, 'completed');
            } });
        broker.prepare(['first']);
        await broker.step();
        broker.prepare(['urgent'], { priority: 'high', voice: 'hallensprecher' });
        time += 1000;
        await broker.step();
        assert.strictEqual(sent.length, 1);
        time += 5000;
        await broker.step();
        assert.deepStrictEqual(sent.map(request => request.text), ['first', 'first']);
        time += 3000;
        await broker.step();
        time += 1000;
        await broker.step();
        assert.deepStrictEqual(sent.map(request => request.text), ['first', 'first', 'urgent']);
    });

    it('does not dispatch a second job while waiting for the first POST acknowledgement', async function() {
        let finish, count = 0;
        const broker = new SpeechBroker(config(), { request: async (_base, _key, _method, _route, body) => {
            count++;
            return new Promise(resolve => { finish = () => resolve(reply(body)); });
        } });
        broker.prepare(['one', 'two']);
        const first = broker.step();
        await broker.step();
        await broker.step();
        assert.strictEqual(count, 1);
        finish();
        await first;
    });

    it('gives a newly selected male voice a turn ahead of older same-priority female prefetch', async function() {
        let time = Date.now();
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => time,
            request: async (_base, _key, _method, _route, body) => { sent.push(body); return reply(body, 'completed'); } });
        broker.prepare(['female one', 'female two', 'female three'], { priority: 'normal' });
        await broker.step(); time += 1000;
        broker.prepare(['male one', 'male two'], { voice: 'hallensprecher', priority: 'normal' });
        await broker.step(); time += 1000;
        await broker.step(); time += 1000;
        await broker.step();
        assert.deepStrictEqual(sent.map(request => request.voice),
            ['hallensprecherin', 'hallensprecher', 'hallensprecherin', 'hallensprecher']);
    });

    it('does not evict imminent calls to make room for distant background work', function() {
        const broker = new SpeechBroker(config({ max_entries: 32 }));
        broker.prepare(Array.from({ length: 32 }, (_, i) => 'imminent ' + i), { priority: 'normal' });
        broker.prepare(['future'], { priority: 'low' });
        assert.strictEqual(broker.views(['imminent 0'], {}, 'default')[0].status, 'unsubmitted');
        assert.strictEqual(broker.views(['future'], {}, 'default')[0].status, 'unsubmitted');
        assert(![...broker.entries.values()].some(entry => entry.text === 'future'));
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

    it('prepares the exact call again after switching to the Kitten backend', async function() {
        let backend = 'qwen';
        let time = Date.now();
        const received = [];
        const broker = new SpeechBroker(config(), { now: () => time, request: async (_base, _key, _method, pathname, body) => {
            if (pathname === '/health') return {
                backend, model: backend === 'qwen' ? 'Qwen/Base' : 'KittenML/kitten-tts-2',
                model_revision: (backend === 'qwen' ? 'a' : 'b').repeat(40),
            };
            if (pathname === '/v1/voices') return { voices: [
                { voice_id: 'hallensprecherin', version: '1', languages: ['de-DE'] },
                { voice_id: 'hallensprecher', version: '1', languages: ['de-DE'] },
            ] };
            received.push(body);
            return reply(body, 'completed');
        } });
        await broker.refresh();
        broker.prepare([TEXT]);
        await broker.step();
        const old_audio = broker.views([TEXT], {}, 'default')[0].audio_url;
        backend = 'kitten_cpp';
        time += 1000;
        await broker.refresh();
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].audio_url, null);
        await broker.step();
        const clip = broker.views([TEXT], {}, 'default')[0];
        assert.strictEqual(clip.status, 'completed');
        assert.notStrictEqual(clip.audio_url, old_audio);
        assert.deepStrictEqual(received.map(request => request.text), [SPOKEN_TEXT, SPOKEN_TEXT]);
        assert(received.every(request => request.voice === 'hallensprecherin' && request.language === 'de-DE'));
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

    it('discards an old in-flight generation answer after a backend switch', async function() {
        let backend = 'qwen', finish;
        let time = Date.now();
        let old_request;
        const broker = new SpeechBroker(config(), { now: () => time, request: async (_base, _key, _method, pathname, body) => {
            if (pathname === '/health') return { backend, model: 'shared-model', model_revision: 'a'.repeat(40) };
            if (pathname === '/v1/voices') return { voices: [] };
            if (backend === 'qwen') {
                old_request = body;
                return new Promise(resolve => { finish = resolve; });
            }
            return reply(body, 'completed');
        } });
        await broker.refresh();
        broker.prepare([TEXT]);
        const pending = broker.step();
        backend = 'kitten_cpp';
        await broker.refresh();
        finish(reply(old_request, 'completed'));
        await pending;
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].audio_url, null);
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].status, 'unsubmitted');
        time += 1000;
        await broker.step();
        assert.strictEqual(broker.views([TEXT], {}, 'default')[0].status, 'completed');
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

    it('selects signed male playback variants for resolution, readiness and previews without new generation', function() {
        const time = Date.now();
        const broker = new SpeechBroker(config(), { now: () => time });
        for (const voice of ['hallensprecher', 'hallensprecherin']) {
            const texts = ['Nina Beispiel', 'Bitte kommen!', 'Zeile eins\nZeile zwei'];
            broker.prepare(texts, { voice }, 'default');
            for (const entry of broker.entries.values()) { entry.status = 'completed'; entry.audio_id ||= id(); }
            const resolved = broker.views(texts, { voice }, 'default');
            const inspected = broker.inspect(texts, { voice }, 'default');
            for (let i = 0; i < resolved.length; i++) {
                const url = new URL(resolved[i].audio_url, 'http://localhost');
                const mode = url.searchParams.get('playback') || '';
                assert.strictEqual(mode, voice === 'hallensprecher' ? i ? 'edges-v1' : 'words-v1' : '');
                assert.strictEqual(inspected[i].audio_url, resolved[i].audio_url);
                assert(broker.queue('default').items.some(item => item.audio_url === resolved[i].audio_url));
                const expires = url.searchParams.get('expires'), signature = url.searchParams.get('signature');
                const audio_id = url.pathname.split('/').pop();
                assert(broker.authorize('default', audio_id, expires, signature, mode));
                assert(!broker.authorize('default', audio_id, expires, signature, mode ? '' : 'words-v1'));
                assert(!broker.authorize('default', audio_id, expires, signature, 'unknown'));
            }
        }
        assert([...broker.entries.values()].every(entry => !entry.job_id));
    });

    it('serves compact male WAVs with matching ranges, caching and grants while keeping raw recordings intact', async function() {
        const raw = wave([[300, 0], [120, 800], [700, 0], [120, -1000], [400, 0]]);
        let downloads = 0;
        const upstream = http.createServer((req, res) => {
            downloads++;
            assert.strictEqual(req.headers['x-api-key'], KEY);
            assert.strictEqual(req.headers.range, undefined, 'compaction requires the complete original recording');
            res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': raw.length }); res.end(raw);
        });
        await listening(upstream);
        const app = express(), broker = new SpeechBroker(config({ url: 'http://127.0.0.1:' + upstream.address().port }));
        app.speech = { broker }; app.get('/h/:tournament_key/speech/audio/:audio_id', proxy);
        const server = http.createServer(app); await listening(server);
        try {
            const url = 'http://127.0.0.1:' + server.address().port +
                broker.audio_url('default', id(), { voice: 'hallensprecher', text: 'Nina Beispiel' });
            const result = await fetch_buffer(url);
            assert.strictEqual(result.status, 200);
            assert.strictEqual(pcm(result.body).length / 48000, 0.4);
            assert.strictEqual(Number(result.headers['content-length']), result.body.length);
            assert(result.headers['cache-control'].startsWith('private'));
            const range = await fetch_buffer(url, { Range: 'bytes=0-3' });
            assert.strictEqual(range.status, 206); assert.strictEqual(range.body.toString(), 'RIFF');
            assert.strictEqual(range.headers['content-range'], 'bytes 0-3/' + result.body.length);
            const suffix = await fetch_buffer(url, { Range: 'bytes=-4' });
            assert.deepStrictEqual(suffix.body, result.body.subarray(-4));
            const invalid = await fetch_buffer(url, { Range: 'bytes=9999999-' });
            assert.strictEqual(invalid.status, 416);
            assert.strictEqual(invalid.headers['content-range'], 'bytes */' + result.body.length);
            assert.strictEqual((await fetch_buffer(url, { 'If-None-Match': result.headers.etag })).status, 304);
            assert.strictEqual((await fetch_buffer(url, { Range: 'bytes=0-3', 'If-Range': 'old-etag' })).status, 200);
            assert.strictEqual((await fetch_buffer(url.replace('playback=words-v1', 'playback=edges-v1'))).status, 401);
            assert.strictEqual((await fetch_buffer(url.replace('&playback=words-v1', ''))).status, 401);
            assert.strictEqual(downloads, 1, 'the bounded BTS memory cache avoids repeated WAV downloads');
            const plain = await fetch_buffer('http://127.0.0.1:' + server.address().port + broker.audio_url('default', id()));
            assert.deepStrictEqual(plain.body, raw);
            assert.strictEqual(broker.audio_clients, 0);
        } finally { await close(server); await close(upstream); }
    });

    it('releases compact playback download slots after oversized, aborted or timed-out upstream responses', async function() {
        let mode;
        const upstream = http.createServer((_req, res) => {
            if (mode === 'oversized') {
                res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 16 * 1024 * 1024 + 1 });
                res.flushHeaders();
            } else if (mode === 'aborted') {
                res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 1000 });
                res.flushHeaders(); res.write('RIFF'); setImmediate(() => res.destroy());
            }
        });
        await listening(upstream);
        const app = express(), broker = new SpeechBroker(config({ url: 'http://127.0.0.1:' + upstream.address().port }));
        broker.config.audio_timeout_ms = 50;
        app.speech = { broker }; app.get('/h/:tournament_key/speech/audio/:audio_id', proxy);
        const server = http.createServer(app); await listening(server);
        try {
            for (mode of ['oversized', 'aborted', 'timeout']) {
                const url = 'http://127.0.0.1:' + server.address().port +
                    broker.audio_url('default', id(), { voice: 'hallensprecher', text: 'Nina Beispiel' });
                assert.strictEqual((await fetch_buffer(url)).status, 503, mode);
                assert.strictEqual(broker.audio_clients, 0, mode);
            }
        } finally { await close(server); await close(upstream); }
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
            matches: [{ _id: 'match1', tournament_key: 'default', setup: setup({ state: 'preparation' }) }],
        };
        for (const [collection, values] of Object.entries(fixture)) {
            await promisify(db[collection].insert.bind(db[collection]))(values);
        }
        const broker = new SpeechBroker(config());
        const prefetch = new Prefetcher({ db }, broker);
        prefetch.configure(current, false);
        await prefetch.refresh('default');
        assert([...broker.entries.values()].some(entry => entry.text.includes('Muhammad Sytsh Abdulquddus')));
        assert([...broker.entries.values()].every(entry => entry.status === 'unsubmitted'));
        assert([...broker.entries.values()].every(entry => entry.voice === 'hallensprecherin'));
        const previous = new Set([...broker.entries.values()].map(entry => entry.text));
        await db.matches.update_async({ _id: 'match1' }, { $set: { 'setup.teams.1.players.0.name': 'Neuer Gegner' } }, {});
        await prefetch.refresh('default');
        assert.deepStrictEqual([...broker.entries.values()].map(entry => entry.text).filter(text => !previous.has(text)).sort(),
            ['Neuer Gegner']);
        assert.strictEqual(broker.views(['Johann Bjarne Schöttmer, gegen Neuer Gegner'], {}, 'default')[0].audio_url, null);
        prefetch.stop();
    });

    it('prepares tablet candidates from on-court teams and the persisted waiting pool before their later assignment', async function() {
        const db = await database.init_test();
        const current = { ...tournament(), tabletoperator_enabled: true, announcement_speech_voice: 'hallensprecher' };
        const previous = setup({ state: 'oncourt', tabletoperators: null, umpire: null, service_judge: null });
        const next = setup({ match_num: 18, court_id: null, location_id: null, tabletoperators: null,
            umpire: null, service_judge: null, teams: [{ players: [{ name: 'Nächste A' }] }, { players: [{ name: 'Nächste B' }] }] });
        const fixture = { tournaments: [current],
            locations: current.locations.map(value => ({ ...value, tournament_key: 'default' })),
            courts: current.courts.map(value => ({ ...value, tournament_key: 'default' })),
            matches: [{ _id: 'previous', tournament_key: 'default', setup: previous },
                { _id: 'next', tournament_key: 'default', setup: next }],
            tabletoperators: [{ tournament_key: 'default', tabletoperator: [{ name: 'Wartende Bedienung' }], court: null, end_ts: null }],
        };
        for (const [collection, values] of Object.entries(fixture)) await promisify(db[collection].insert.bind(db[collection]))(values);
        let clock = 1000;
        const sent = [];
        const broker = new SpeechBroker(config(), { now: () => clock,
            request: async (_base, _key, _method, _route, body) => {
                sent.push(body);
                const job_id = id();
                return { ...body, job_id, status: 'completed', audio: { audio_id: job_id, processed: !!body.context } };
            } });
        broker.context_version = 'bts-context-v1';
        const prefetch = new Prefetcher({ db }, broker);
        try {
            prefetch.configure(current, false);
            await prefetch.refresh('default');
            const roles = [...broker.entries.values()].filter(entry => entry.text.startsWith('Tabletbedienung:'));
            assert(roles.some(entry => entry.text.includes('Johann') && entry.priority === 1));
            assert(!roles.some(entry => entry.text === 'Tabletbedienung:Wartende Bedienung'), 'unassigned waiting operators are idle inventory');
            assert(!roles.some(entry => /Nächste [AB]/.test(entry.text)), 'future games are not speculative tablet candidates');
            assert(roles.every(entry => entry.voice === 'hallensprecher'));
            while (broker.pending_order().length) { await broker.step(); clock += 1000; }
            while ([...broker.idle_plans.values()].some(plan => plan.cursor < plan.parts.length) || broker.pending_order().length) {
                await broker.step(); clock += 1000;
            }
            const count = sent.length;
            // The previous game leaves the upcoming set. Its possible loser is
            // only assigned to the next game's tablet service at the call.
            await db.matches.update_async({ _id: 'previous' }, { $set: { 'setup.state': 'finished' } }, {});
            await db.matches.update_async({ _id: 'next' }, { $set: { 'setup.tabletoperators': previous.teams[1].players,
                'setup.court_id': 'default_4', 'setup.location_id': 'default_h1', 'setup.state': 'oncourt' } }, {});
            await prefetch.refresh('default');
            const updated_roles = [...broker.entries.values()].filter(entry => entry.text.startsWith('Tabletbedienung:'));
            assert(!updated_roles.some(entry => entry.text.includes('Johann')), 'the unused possible winner must leave the active queue');
            assert(updated_roles.some(entry => entry.text.includes('Muhammad')), 'the newly assigned loser remains available');
            const selected = { ...current, speech: { context_version: broker.context_version } };
            const texts = require('../bts/speech/text').renderer(selected, 'de', []);
            const assigned = { ...next, tabletoperators: previous.teams[1].players, court_id: 'default_4', location_id: 'default_h1' };
            const plan = require('../static/js/speech_context')(texts, selected, 'announceNewMatch', assigned);
            broker.prepare(plan.parts, { voice: 'hallensprecher', priority: 'high' }, 'default');
            assert(broker.views(plan.parts, { voice: 'hallensprecher' }, 'default').every(clip => clip.status === 'completed'));
            assert.strictEqual(sent.length, count, 'the full late call is already warm before assignment');
        } finally { prefetch.stop(); }
    });

    it('uses the persisted selection on restart and rejects generation requests from stale clients', async function() {
        const db = await database.init_test();
        const current = { ...tournament(), announcement_speech_voice: 'hallensprecher', announcement_speech_mode: 'server' };
        await promisify(db.tournaments.insert.bind(db.tournaments))(current);
        const app = { db, config: { speech: { enabled: true, api_key: KEY } } };
        app.speech = create(app);
        try {
            const loaded = { ...current }, responses = [];
            const ws = { respond: (_msg, error, response) => { assert.ifError(error); responses.push(response); } };
            app.speech.loaded(loaded, ws);
            assert.strictEqual(loaded.speech.voice, 'hallensprecher');
            assert.strictEqual(loaded.speech.mode, 'server');
            handle(app, ws, { type: 'speech_prepare', tournament_key: 'default', parts: [TEXT], voice: 'hallensprecherin' });
            assert.strictEqual(responses[0].speech_error, 'speech_settings_changed');
            assert.strictEqual(app.speech.broker.entries.size, 0);
            handle(app, ws, { type: 'speech_prepare', tournament_key: 'default', parts: [TEXT] });
            assert([...app.speech.broker.entries.values()].every(entry => entry.voice === 'hallensprecher'));
            await app.speech.prefetch.refresh('default');
            assert([...app.speech.broker.entries.values()].every(entry => entry.voice === 'hallensprecher'));
            assert.deepStrictEqual(resolveSettings({ ...current, speech: { voice: 'hallensprecherin', mode: 'auto' } }),
                { voice: 'hallensprecher', mode: 'server' });
            await db.tournaments.update_async({ key: 'default' }, { $set: { announcement_speech_mode: 'browser' } }, {});
            app.speech.configure({ ...current, announcement_speech_mode: 'browser' });
            await app.speech.prefetch.refresh('default');
            handle(app, ws, { type: 'speech_prepare', tournament_key: 'default', parts: [TEXT], voice: 'hallensprecher' });
            assert.deepStrictEqual(responses.at(-1).clips, []);
            assert.strictEqual(app.speech.broker.entries.size, 0, 'central browser mode must not generate local recordings');
        } finally { app.speech.stop(); }
    });

    it('drops unsent work for a deselected voice, preserves other tournaments and completes the current job alone', async function() {
        let active;
        const sent = [];
        const broker = new SpeechBroker(config(), { request: async (_base, _key, method, _route, body) => {
            if (method === 'GET') return reply(active, 'completed');
            sent.push(body); return (active = reply(body));
        } });
        broker.prepare(['current', 'unused', 'shared'], {}, 'default');
        broker.prepare(['shared'], {}, 'other');
        await broker.step();
        const prefetch = new Prefetcher({}, broker);
        prefetch.configure({ key: 'default', announcement_speech_voice: 'hallensprecher' }, false);
        assert.deepStrictEqual(broker.queue('default').items, []);
        assert.strictEqual(broker.queue('other').items[0].text, 'shared');
        assert(![...broker.entries.values()].some(entry => entry.text === 'unused'));
        broker.prepare(['new voice'], { voice: 'hallensprecher', priority: 'high' }, 'default');
        await broker.step();
        assert.strictEqual(sent.length, 1, 'a voice change must not open a second server job');
        broker.current.entry.next_poll = 0;
        await broker.step();
        assert.strictEqual(broker.current, null);
        broker.last_post = -Infinity;
        await broker.step();
        assert.strictEqual(sent.at(-1).voice, 'hallensprecher');
        prefetch.configure({ key: 'default', announcement_speech_voice: 'hallensprecher', announcement_speech_mode: 'browser' }, false);
        assert.strictEqual(broker.queue('default').items.length, 0);
    });

    it('saves central speech settings through both existing edit paths and rejects invalid values atomically', async function() {
        const db = await database.init_test();
        await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'default', displaysettings_general: 'display', displaysettings_general_tablet: 'tablet' });
        const app = { db, config: { speech: { enabled: true, api_key: KEY } } };
        app.speech = create(app);
        const edit = msg => new Promise((resolve, reject) => admin['handle_' + msg.type](app,
            { respond: (_msg, error) => error ? reject(error) : resolve() }, { key: 'default', ...msg }));
        try {
            await edit({ type: 'tournament_edit_prop', field: 'announcement_speech_voice', value: 'hallensprecher' });
            assert.strictEqual((await db.tournaments.findOne_async({ key: 'default' })).announcement_speech_voice, 'hallensprecher');
            assert.strictEqual(app.speech.prefetch.settings('default').voice, 'hallensprecher');
            await edit({ type: 'tournament_edit_props', props: { announcement_speech_mode: 'server', announcement_speech_voice: 'hallensprecherin' } });
            assert.deepStrictEqual(app.speech.prefetch.settings('default'), { mode: 'server', voice: 'hallensprecherin' });
            await assert.rejects(edit({ type: 'tournament_edit_prop', field: 'announcement_speech_voice', value: 'unknown' }));
            await assert.rejects(edit({ type: 'tournament_edit_props', props: { announcement_speech_voice: 'hallensprecher', announcement_speech_mode: 'unknown' } }));
            assert.deepStrictEqual(resolveSettings(await db.tournaments.findOne_async({ key: 'default' })),
                { mode: 'server', voice: 'hallensprecherin' });
        } finally { app.speech.stop(); }
    });
});
