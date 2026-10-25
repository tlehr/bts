'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const proxy = require('../bts/speech/proxy');
const { wave } = require('./fixtures/speech_pcm');
const KEY = 'durable-test-key-' + 'x'.repeat(32);
const close = server => new Promise(resolve => server.close(resolve));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

async function fixture(directory, shared = false, context = false, playback = false) {
    const jobs = new Map(), requests = [], body = wave([[10, 0], [40, 1000], [10, 0]]);
    const state = { revision: 'a'.repeat(40), corrupt: false, failCuts: false, playbackVersion: playback ? 'c'.repeat(64) : null };
    const shared_directory = path.join(directory, 'shared');
    fs.mkdirSync(shared_directory);
    const server = http.createServer((req, res) => {
        assert.strictEqual(req.headers['x-api-key'], KEY);
        requests.push({ method: req.method, url: req.url });
        const json = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (req.url === '/health') return json({ model: 'test-model', model_revision: state.revision,
            configuration_version: 'test-configuration', ...(context ? { context_version: typeof context === 'string' ? context : 'bts-context-v1' } : {}),
            ...(state.playbackVersion ? { playback_profile: 'bts-playback-v1', playback_version: state.playbackVersion } : {}) });
        if (req.url === '/v1/voices') return json({ voices: [
            { voice_id: 'hallensprecherin', version: '1', languages: ['de-DE'] },
            { voice_id: 'hallensprecher', version: '1', languages: ['de-DE'] },
        ] });
        if (req.url.startsWith('/v1/audio/')) {
            res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(state.corrupt ? 'broken' : body); return;
        }
        if (req.url.startsWith('/v1/jobs/')) return json(jobs.get(req.url.split('/').pop().split('?')[0]));
        const chunks = [];
        req.on('data', data => chunks.push(data));
        req.on('end', () => {
            const request = JSON.parse(Buffer.concat(chunks));
            requests[requests.length - 1].body = request;
            const job_id = crypto.randomBytes(16).toString('hex');
            const result = { ...request, job_id, status: 'completed', cache_hit: state.cacheHit === true, audio: { audio_id: job_id, size_bytes: body.length,
                sha256: crypto.createHash('sha256').update(body).digest('hex'), processed: !!request.context,
                leading_quiet_ms: request.context ? 10 : 0, trailing_quiet_ms: request.context ? 10 : 0,
                ...(request.playback_profile ? { playback_profile: request.playback_profile, playback_version: state.playbackVersion } : {}) } };
            if (state.pending) { result.status = 'queued'; result.audio = null; }
            if (state.failCuts && request.context?.before &&
                (state.failCuts !== 'original' || jobs.get(request.context.audio_id).source_seed !== 43)) {
                result.status = 'failed'; result.error = { code: 'alignment_failed' }; delete result.audio;
            }
            if (shared) {
                const folder = request.playback_profile ? path.join(shared_directory, 'playback') : shared_directory;
                fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, job_id + '.wav'), body);
            }
            jobs.set(job_id, result); json(result);
        });
    });
    await listen(server);
    const config = configuration({ enabled: true, api_key: KEY, url: 'http://127.0.0.1:' + server.address().port,
        cache_dir: path.join(directory, 'bts-cache'), ...(shared ? { shared_audio_dir: shared_directory } : {}) }, {});
    return { server, config, jobs, requests, body, state, shared_directory,
        posts: () => requests.filter(item => item.method === 'POST'),
        downloads: () => requests.filter(item => item.url.startsWith('/v1/audio/')) };
}

function get(url, headers = {}) {
    return new Promise((resolve, reject) => http.get(url, { headers }, res => {
        const chunks = [];
        res.on('data', data => chunks.push(data));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject));
}

describe('Durable BTS speech cache', function() {
    this.timeout(10000);
    let directory, upstream, localServer;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-durable-test-')); });
    afterEach(async () => {
        if (localServer?.listening) await close(localServer);
        if (upstream?.server.listening) await close(upstream.server);
        fs.rmSync(directory, { recursive: true, force: true });
        localServer = upstream = null;
    });

    it('reports durable recordings ready without admitting them to the work queue, including after restart', async function() {
        upstream = await fixture(directory, false, true, true);
        const first = new SpeechBroker({ ...upstream.config, submit_interval_ms: 0 });
        await first.refresh();
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Im ', text: 'Gemischten Doppel U17',
            after: ' erwarten wir spannende Spiele!', kind: 'generic' });
        const parts = ['Lucy Kopec', part];
        const voices = ['hallensprecher', 'hallensprecherin'];
        for (const voice of voices) {
            first.prepare(parts, { voice }, 'default');
            for (let step = 0; step < 4; step++) await first.step();
            assert(first.views(parts, { voice }, 'default').every(clip => clip.local));
        }
        first.entries.clear();
        const requests = upstream.requests.length;
        const fresh = new SpeechBroker(upstream.config, { request: async () => { throw new Error('inspection must stay offline'); } });
        await fresh.disk.ready;
        for (const broker of [first, fresh]) {
            for (const voice of voices) {
                const clips = broker.inspect(parts, { voice }, 'default');
                assert(clips.every(clip => clip.status === 'completed' && clip.local));
                assert(clips[1].processed);
                assert.strictEqual(clips[1].leading_quiet_ms, 10);
                assert.strictEqual(clips[1].trailing_quiet_ms, 10);
                for (const clip of clips) {
                    const url = new URL(clip.audio_url, 'http://localhost');
                    assert(broker.authorize('default', url.pathname.split('/').pop(),
                        url.searchParams.get('expires'), url.searchParams.get('signature')));
                }
                assert.deepStrictEqual(broker.inspect(parts, { voice }).map(clip => clip.audio_url), [undefined, undefined]);
            }
            assert.strictEqual(broker.entries.size, 0);
            assert.strictEqual(broker.current, null);
            assert.strictEqual(broker.pending_order().length, 0);
            assert.strictEqual(broker.inspect(['Nicht vorhanden'], {})[0].status, 'missing');
        }
        fresh.playback_profile = 'another-profile';
        assert.strictEqual(fresh.inspect(parts, { voice: voices[0] })[0].status, 'missing');
        fresh.playback_profile = first.playback_profile;
        const saved = fresh.disk.lookup(fresh.identity, fresh.key(part, voices[0], 'de-DE'));
        fs.unlinkSync(fresh.disk.file(saved.audio_id).path);
        assert.strictEqual(fresh.inspect([part], { voice: voices[0] })[0].status, 'missing');
        assert.strictEqual(upstream.requests.length, requests);
        first.stop(); fresh.stop();
    });

    for (const shared of [false, true]) it('retains a successful non-name context recovery offline (' + (shared ? 'shared' : 'download') + ')', async function() {
        upstream = await fixture(directory, shared, true);
        upstream.state.failCuts = 'original';
        const first = new SpeechBroker({ ...upstream.config, submit_interval_ms: 0 }); await first.refresh();
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Im ', text: 'Jungen Einzel U19',
            after: ' erwarten wir spannende Spiele!', kind: 'generic' });
        const options = { voice: 'hallensprecher', prefetch: true, priority: 'normal' };
        for (let step = 0; step < 6; step++) { first.prepare([part], options, 'default'); await first.step(); }
        const previous = first.views([part], options, 'default')[0];
        assert(previous.local && previous.status === 'completed');
        assert.strictEqual(first.entries.get(first.key(part, options.voice, 'de-DE')).fallback_stage, 'context');
        assert.strictEqual(upstream.posts().filter(post => post.body.source_seed === 43).length, 1);
        first.stop();
        const requests = upstream.requests.length;
        const second = new SpeechBroker(upstream.config, { request: async () => { throw new Error('offline cache must suffice'); } });
        await second.disk.ready;
        second.prepare([part], options, 'default'); await second.step();
        const restored = second.views([part], options, 'default')[0];
        assert(restored.local && restored.status === 'completed');
        assert.strictEqual(second.entries.get(second.key(part, options.voice, 'de-DE')).audio_id,
            first.entries.get(first.key(part, options.voice, 'de-DE')).audio_id);
        assert.strictEqual(upstream.requests.length, requests);
        second.stop();
    });

    for (const shared of [false, true]) it('retains normalized playback offline for both voices (' + (shared ? 'shared' : 'download') + ')', async function() {
        upstream = await fixture(directory, shared, false, true);
        const first = new SpeechBroker({ ...upstream.config, submit_interval_ms: 0 }); await first.refresh();
        for (const voice of ['hallensprecher', 'hallensprecherin']) {
            first.prepare(['In Vorbereitung!'], { voice }, 'default'); await first.step();
            const clip = first.views(['In Vorbereitung!'], { voice }, 'default')[0];
            assert(clip.local && !clip.audio_url.includes('playback='), 'already normalized audio is never compacted twice');
            assert.strictEqual(upstream.posts().at(-1).body.playback_profile, 'bts-playback-v1');
            if (shared) {
                const entry = first.entries.get(first.key('In Vorbereitung!', voice, 'de-DE'));
                const source = path.join(upstream.shared_directory, 'playback', entry.audio_id + '.wav');
                assert.strictEqual(fs.statSync(source).ino, fs.statSync(first.disk.file(entry.audio_id).path).ino);
            }
        }
        const count = upstream.requests.length;
        await close(upstream.server);
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        assert.strictEqual(fresh.playback_profile, 'bts-playback-v1');
        for (const voice of ['hallensprecher', 'hallensprecherin']) {
            fresh.prepare(['In Vorbereitung!'], { voice }, 'default'); await fresh.step();
            assert(fresh.views(['In Vorbereitung!'], { voice }, 'default')[0].local);
        }
        assert.strictEqual(upstream.requests.length, count);
    });

    it('requests normalization for a cut while retaining the complete context original', async function() {
        upstream = await fixture(directory, true, true, true);
        const broker = new SpeechBroker({ ...upstream.config, submit_interval_ms: 0 }); await broker.refresh();
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Anfang. ', text: 'In Vorbereitung!', after: ' Ende.', kind: 'generic' });
        broker.prepare([part], {}, 'default'); await broker.step(); await broker.step();
        assert.strictEqual(upstream.posts().length, 2);
        assert.strictEqual(upstream.posts()[0].body.playback_profile, undefined);
        assert.strictEqual(upstream.posts()[1].body.playback_profile, 'bts-playback-v1');
        assert(broker.views([part], {}, 'default')[0].local);
    });

    it('retains opted-in other-voice recordings after opt-out and restart without contacting the speech server', async function() {
        upstream = await fixture(directory, true);
        const config = { ...upstream.config, submit_interval_ms: 0 };
        const first = new SpeechBroker(config); await first.refresh();
        const voice = 'hallensprecher', part = 'Bitte mit dem Spielen beginnen!';
        first.prepare([part], { voice, prefetch: true }, 'default');
        first.reconcile_prefetch('default', [part], { voice, warm_other_voice: true });
        await first.step(); await first.step();
        assert.deepStrictEqual(upstream.posts().map(post => post.body.voice), [voice, 'hallensprecherin']);
        first.reconcile_prefetch('default', [part], { voice, warm_other_voice: false });
        assert(!first.queue('default').items.some(item => item.spare));
        const count = upstream.requests.length;
        await close(upstream.server);
        const fresh = new SpeechBroker(config); await fresh.disk.ready;
        fresh.prepare([part], { voice: 'hallensprecherin', prefetch: true }, 'default');
        await fresh.step();
        assert(fresh.views([part], { voice: 'hallensprecherin' }, 'default')[0].local);
        assert.strictEqual(upstream.requests.length, count);
    });

    it('keeps the requested playback profile when polling a queued job', async function() {
        upstream = await fixture(directory, false, false, true);
        upstream.state.pending = true;
        let clock = 1000;
        const broker = new SpeechBroker(upstream.config, { now: () => clock }); await broker.refresh();
        broker.prepare(['Ein Satz.'], {}, 'default'); await broker.step();
        const job = [...upstream.jobs.values()][0];
        job.status = 'completed'; job.audio = { audio_id: job.job_id, size_bytes: upstream.body.length,
            sha256: crypto.createHash('sha256').update(upstream.body).digest('hex'),
            playback_profile: 'bts-playback-v1', playback_version: upstream.state.playbackVersion };
        clock += 2000; await broker.step();
        assert(upstream.requests.some(item => item.url.endsWith('?playback_profile=bts-playback-v1')));
        assert(broker.views(['Ein Satz.'], {}, 'default')[0].local);
    });

    it('finishes more idle inventory than fits in memory, preserves ordinary cache entries and reuses all files after restart', async function() {
        upstream = await fixture(directory, true);
        const config = { ...upstream.config, max_entries: 32, submit_interval_ms: 0 };
        const service = new SpeechBroker(config); await service.refresh();
        const voice = config.voice;
        service.prepare(['Regulär benötigt'], { voice, priority: 'normal', prefetch: true }, 'default');
        await service.step();
        const regular_key = service.key('Regulär benötigt', voice, 'de-DE');
        const parts = Array.from({ length: 70 }, (_, i) => 'Weitere Tabletbedienung ' + i);
        const targets = new Map(parts.map(part => [part, { part, groups: new Set(['D08']) }]));
        await service.coverage.set_plan('default', voice, targets);
        service.reconcile_prefetch('default', ['Regulär benötigt'], { voice, idle_parts: parts });
        for (let i = 0; i < 80; i++) {
            await service.step();
            assert(service.entries.size <= 32);
            assert(service.entries.has(regular_key), 'idle work must not evict ordinary cache entries');
        }
        assert.strictEqual(upstream.posts().length, 71);
        assert.strictEqual(service.queue('default').coverage.groups.find(group => group.id === 'D08').prepared, 70,
            'unused session reserve survives eviction from the bounded in-memory queue');
        assert.strictEqual(service.queue('default').coverage.groups.find(group => group.id === 'D08').stock, 0);
        const count = upstream.requests.length;
        const fresh = new SpeechBroker(config); await fresh.disk.ready;
        await fresh.coverage.set_plan('default', voice, targets);
        fresh.reconcile_prefetch('default', [], { voice, idle_parts: parts });
        await fresh.step();
        assert.strictEqual(upstream.requests.length, count, 'a restarted BTS must check disk without requesting the speech server again');
        assert.strictEqual(fresh.queue('default').coverage.total.stock, 1);
        assert.strictEqual(fresh.queue('default').coverage.total.tournament_stock, 70);
        assert.strictEqual(fresh.queue('default').coverage.total.prepared, 0, 'a new BTS session treats all existing files as old stock');
    });

    it('remembers the first actual need of session reserve even after retirement and eviction, independently for each tournament', async function() {
        upstream = await fixture(directory, true);
        const first = new SpeechBroker({ ...upstream.config, submit_interval_ms: 0 }); await first.refresh();
        const voice = upstream.config.voice;
        const part = 'Vorsorglich für die Tabletbedienung';
        const targets = new Map([[part, { part, groups: new Set(['D08', 'D11']) }]]);
        await first.coverage.set_plan('default', voice, targets);
        await first.coverage.set_plan('other', voice, targets);
        first.reconcile_prefetch('default', [], { voice, idle_parts: [part] });
        await first.step();
        assert.strictEqual(first.queue('default').coverage.total.prepared, 1);
        assert.strictEqual(first.queue('other').coverage.total.prepared, 0);
        assert.strictEqual(first.queue('other').coverage.total.tournament_stock, 1, 'another tournament reuses already existing audio');
        const count = upstream.requests.length;
        first.prepare([part], { voice, priority: 'normal', prefetch: true }, 'default');
        assert.strictEqual(first.queue('default').coverage.total.generated, 1);
        first.reconcile_prefetch('default', [], { voice });
        assert.strictEqual(first.entries.size, 0);
        assert.strictEqual(first.queue('default').coverage.total.tournament_stock, 1);
        assert.strictEqual(first.queue('default').coverage.total.prepared, 0);
        first.reconcile_prefetch('default', [], { voice, idle_parts: [part] });
        await first.step();
        assert.strictEqual(first.queue('default').coverage.total.prepared, 0);
        assert.strictEqual(upstream.requests.length, count);
    });

    it('counts an idle cache hit from the speech server as existing stock, not as new session reserve', async function() {
        upstream = await fixture(directory, true); upstream.state.cacheHit = true;
        const first = new SpeechBroker(upstream.config); await first.refresh();
        const voice = upstream.config.voice, part = 'Schon beim Sprachserver vorhanden';
        await first.coverage.set_plan('default', voice, new Map([[part, { part, groups: new Set(['D08']) }]]));
        first.reconcile_prefetch('default', [], { voice, idle_parts: [part] });
        await first.step();
        const coverage = first.queue('default').coverage;
        assert.strictEqual(coverage.total.tournament_stock, 1);
        assert.strictEqual(coverage.total.prepared, 0);
    });

    it('retains announcement groups and generation origin across retirement and restart, including shared use by another tournament', async function() {
        upstream = await fixture(directory, true);
        const first = new SpeechBroker(upstream.config); await first.refresh();
        const targets = new Map([['Tabletbedienung: Ein Name', { part: 'Tabletbedienung: Ein Name', groups: new Set(['D08', 'D11']) }]]);
        await first.coverage.set_plan('default', upstream.config.voice, targets);
        first.prepare([...targets.keys()], { prefetch: true }, 'default'); await first.step();
        assert.strictEqual(first.queue('default').coverage.total.generated, 1);
        first.reconcile_prefetch('default', [], { voice: upstream.config.voice });
        assert.strictEqual(first.queue('default').coverage.total.tournament_stock, 1);
        const count = upstream.requests.length;
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        await fresh.coverage.set_plan('default', upstream.config.voice, new Map());
        let coverage = fresh.queue('default').coverage;
        assert.strictEqual(coverage.total.stock, 1);
        assert.strictEqual(coverage.groups.find(group => group.id === 'D08').stock, 1);
        fresh.prepare([...targets.keys()], { prefetch: true }, 'default');
        assert.strictEqual(fresh.queue('default').coverage.total.generated, 1);
        await fresh.coverage.set_plan('other', upstream.config.voice, targets);
        fresh.prepare([...targets.keys()], { prefetch: true }, 'other');
        coverage = fresh.queue('other').coverage;
        assert.strictEqual(coverage.total.cached, 1);
        assert.strictEqual(coverage.total.generated, 0);
        assert.strictEqual(upstream.requests.length, count);
    });

    it('counts a cache hit from the speech server as reused cache rather than newly generated audio', async function() {
        upstream = await fixture(directory, true); upstream.state.cacheHit = true;
        const first = new SpeechBroker(upstream.config); await first.refresh();
        const targets = new Map([['Vorhandene Aufnahme', { part: 'Vorhandene Aufnahme', groups: new Set(['D14']) }]]);
        await first.coverage.set_plan('default', upstream.config.voice, targets);
        first.prepare([...targets.keys()], { prefetch: true }, 'default'); await first.step();
        const coverage = first.queue('default').coverage;
        assert.strictEqual(coverage.total.cached, 1);
        assert.strictEqual(coverage.total.generated, 0);
    });

    it('remembers who initiated generation when BTS restarts before the audio is completed', async function() {
        upstream = await fixture(directory, true); upstream.state.pending = true;
        const first = new SpeechBroker(upstream.config); await first.refresh();
        const part = 'Nach dem Neustart fertig', targets = new Map([[part, { part, groups: new Set(['D13']) }]]);
        await first.coverage.set_plan('default', upstream.config.voice, targets);
        first.prepare([part], { prefetch: true }, 'default'); await first.step();
        assert.strictEqual(first.queue('default').coverage.total.ordered, 1);
        upstream.state.pending = false; upstream.state.cacheHit = true;
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        await fresh.coverage.set_plan('default', upstream.config.voice, targets);
        fresh.prepare([part], { prefetch: true }, 'default'); await fresh.step();
        assert.strictEqual(fresh.queue('default').coverage.total.generated, 1);
        assert.strictEqual(fresh.disk.generation.size, 0, 'completed provenance replaces the temporary generation marker');
    });

    it('keeps completed WAVs on disk when they leave the current prefetch plan and restores them without another request', async function() {
        upstream = await fixture(directory, true);
        const broker = new SpeechBroker(upstream.config); await broker.refresh();
        broker.prepare(['Temporärer Bedarf'], { prefetch: true }, 'default'); await broker.step();
        const entry = [...broker.entries.values()][0];
        const filename = broker.disk.file(entry.audio_id).path, count = upstream.requests.length;
        assert.strictEqual(broker.public_config().persistent_cache.stored, 1);
        broker.reconcile_prefetch('default', [], { voice: upstream.config.voice });
        assert.strictEqual(broker.queue('default').items.length, 0);
        assert.strictEqual(broker.public_config().persistent_cache.ready, 0);
        assert.strictEqual(broker.public_config().persistent_cache.stored, 1, 'the saved inventory is independent of current demand');
        assert(fs.existsSync(filename));
        const fresh = new SpeechBroker(upstream.config);
        assert.strictEqual(fresh.public_config().persistent_cache.stored, null, 'do not show a partial count during verification');
        await fresh.disk.ready;
        assert.strictEqual(fresh.public_config('hallensprecher').persistent_cache.stored, 1, 'the inventory includes inactive voices after restart');
        fresh.prepare(['Temporärer Bedarf'], { prefetch: true }, 'default'); await fresh.step();
        assert(fresh.views(['Temporärer Bedarf'], {}, 'default')[0].local);
        assert.strictEqual(upstream.requests.length, count);
    });

    for (const stage of ['original', 'context', 'name']) it('restores a cached ' + stage + ' excerpt before enqueueing missing raw sources, including during startup', async function() {
        upstream = await fixture(directory, true, true);
        upstream.state.failCuts = stage === 'name' ? true : stage === 'context' ? 'original' : false;
        let clock = 1000;
        const first = new SpeechBroker(upstream.config, { now: () => clock }); await first.refresh();
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Finale! ', text: 'Ein Name', after: ' gegen Andere.', kind: 'team' });
        first.prepare([part], {}, 'default');
        for (let step = 0; step < 8; step++) { await first.step(); clock += 1000; }
        assert(first.views([part], {}, 'default')[0].local);
        for (const entry of first.entries.values()) if (entry.context?.kind === 'source') {
            fs.unlinkSync(first.disk.file(entry.audio_id).path);
            fs.unlinkSync(path.join(upstream.shared_directory, entry.audio_id + '.wav'));
        }
        const requests = upstream.requests.length;
        const fresh = new SpeechBroker(upstream.config);
        fresh.prepare([part], {}, 'default'); // Deliberately before asynchronous cache verification finishes.
        await fresh.disk.ready; await fresh.step();
        assert(fresh.views([part], {}, 'default')[0].local);
        assert.strictEqual(fresh.entries.size, 1, 'no raw source is needed to play a finished excerpt');
        assert.strictEqual(fresh.pending_order().length, 0);
        assert.strictEqual(upstream.requests.length, requests);
    });

    it('checks the disk cache again before dispatching a previously waiting request', async function() {
        upstream = await fixture(directory, true);
        const broker = new SpeechBroker(upstream.config); await broker.refresh();
        broker.prepare(['Zwischenzeitlich fertig'], {}, 'default');
        const entry = [...broker.entries.values()][0];
        const response = await broker.request(upstream.config.base_url, KEY, 'POST', '/v1/speech',
            { text: entry.text, voice: entry.voice, language: entry.language }, 2000);
        await broker.disk.store(broker.identity, entry.key, response);
        const count = upstream.requests.length;
        await broker.step();
        assert(broker.views([entry.text], {}, 'default')[0].local);
        assert.strictEqual(broker.current, null);
        assert.strictEqual(upstream.requests.length, count);
    });

    for (const stage of ['context', 'name']) it('retains a successful ' + stage + ' fallback and its provenance after a restart without another request', async function() {
        upstream = await fixture(directory, true, true); upstream.state.failCuts = stage === 'name' ? true : 'original';
        let clock = 1000;
        const first = new SpeechBroker(upstream.config, { now: () => clock }); await first.refresh();
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Finale! ', text: 'Ridhi Polali',
            after: ' gegen Charlotte Dettmann.', kind: 'team' });
        first.prepare([part], {}, 'default');
        for (let step = 0; step < 10; step++) { await first.step(); clock += 2000; }
        assert(first.views([part], {}, 'default')[0].local);
        const count = upstream.posts().length;
        assert.strictEqual(count, stage === 'name' ? 6 : 4);
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        fresh.prepare([part], {}, 'default'); await fresh.step();
        assert(fresh.views([part], {}, 'default')[0].local);
        const row = fresh.queue('default').items.find(item => item.kind === 'team');
        assert.strictEqual(row.fallback_stage, stage);
        assert.strictEqual(row.operation, stage === 'name' ? 'processing' : 'excerpt');
        const source = fresh.entries.get(row.source_key);
        assert.strictEqual(source.text.slice(row.source_range.start, row.source_range.end), row.text);
        if (stage === 'context') assert.strictEqual(source.source_seed, 43);
        assert.strictEqual(upstream.posts().length, count);
    });

    it('retains the new V2 name context offline and excludes old isolated fallback cuts from readiness', async function() {
        upstream = await fixture(directory, false, 'bts-context-v2');
        const first = new SpeechBroker({ ...upstream.config, submit_interval_ms: 0 }); await first.refresh();
        const part = '~bts-context-v2~' + JSON.stringify({ before: '', text: 'Ein Beispielname',
            after: ' spielt jetzt gegen Ein Beispielname!', kind: 'team' });
        const options = { voice: 'hallensprecher' }, key = first.key(part, options.voice, 'de-DE');
        first.prepare([part], options, 'default');
        first.set_fallback(first.entries.get(key), 'name');
        for (let step = 0; step < 6; step++) await first.step();
        assert(first.views([part], options, 'default')[0].local);
        const saved = first.disk.lookup(first.identity, key);
        assert.strictEqual(saved.fallback_source_key, first.entries.get(key).source_key);
        const filename = first.disk.file(saved.audio_id).path;
        first.stop(); await first.disk.writes;
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        const count = upstream.posts().length;
        assert.strictEqual(fresh.inspect([part], options)[0].status, 'completed');
        fresh.prepare([part], options, 'default'); await fresh.step();
        assert(fresh.views([part], options, 'default')[0].local);
        assert(fresh.entries.get(key).context.before && fresh.entries.get(key).context.after);
        assert.strictEqual(upstream.posts().length, count);
        fresh.stop(); await fresh.disk.writes;

        // Simulate an index from before contextual final-name recovery.
        const index = JSON.parse(fs.readFileSync(first.disk.index, 'utf8'));
        delete index.records.find(row => row.key === key).fallback_source_key;
        fs.writeFileSync(first.disk.index, JSON.stringify(index));
        const migrated = new SpeechBroker(upstream.config); await migrated.disk.ready;
        assert.strictEqual(migrated.disk.lookup(migrated.identity, key), null);
        assert.strictEqual(migrated.inspect([part], options)[0].status, 'missing');
        assert(fs.existsSync(filename), 'migration retains existing audio files');
        migrated.prepare([part], options, 'default');
        assert.notStrictEqual(migrated.entries.get(key).status, 'completed');
        migrated.stop();
    });

    for (const shared of [false, true]) it('restores completed audio after BTS restart and serves it with the speech server stopped (' +
        (shared ? 'shared hardlinks' : 'remote download') + ')', async function() {
        upstream = await fixture(directory, shared);
        const first = new SpeechBroker(upstream.config);
        await first.refresh();
        first.prepare(['Dauerhaft 189'], {}, 'default');
        await first.step();
        const clip = first.views(['Dauerhaft 189'], {}, 'default')[0];
        assert(clip.local);
        assert.strictEqual(upstream.posts().length, 1);
        assert.strictEqual(upstream.downloads().length, shared ? 0 : 1);
        const audio_id = [...first.entries.values()][0].audio_id;
        const file = first.disk.file(audio_id);
        if (shared) {
            const original = path.join(upstream.shared_directory, audio_id + '.wav');
            assert.strictEqual(fs.statSync(original).ino, fs.statSync(file.path).ino, 'one set of physical WAV data');
            fs.unlinkSync(original);
        }
        await close(upstream.server);
        const fresh = new SpeechBroker(upstream.config);
        await fresh.disk.ready;
        fresh.prepare(['Dauerhaft 189'], {}, 'default');
        await fresh.refresh();
        await fresh.step();
        assert.strictEqual(fresh.views(['Dauerhaft 189'], {}, 'default')[0].status, 'completed');
        assert(fresh.inspect(['Dauerhaft 189'], {}, 'default')[0].local);
        assert.strictEqual(upstream.posts().length, 1, 'no repeated cache POST or synthesis after restart');
        assert.strictEqual(upstream.downloads().length, shared ? 0 : 1);
        const app = express(); app.speech = { broker: fresh };
        app.get('/h/:tournament_key/speech/audio/:audio_id', proxy);
        localServer = http.createServer(app); await listen(localServer);
        const url = 'http://127.0.0.1:' + localServer.address().port + fresh.views(['Dauerhaft 189'], {}, 'default')[0].audio_url;
        const response = await get(url);
        assert.strictEqual(response.status, 200); assert.deepStrictEqual(response.body, upstream.body);
        const range = await get(url, { Range: 'bytes=0-3' });
        assert.strictEqual(range.status, 206); assert.strictEqual(range.body.toString(), 'RIFF');
        assert.strictEqual((await get(url, { 'If-None-Match': response.headers.etag })).status, 304);
        assert.strictEqual((await get(url.replace('/default/', '/foreign/'))).status, 401);
        assert.strictEqual((await get(url.replace(/signature=[^&]+/, 'signature=forged'))).status, 401);
    });

    it('restores context sources, cut provenance, processing flags and pauses without any new POST', async function() {
        upstream = await fixture(directory, true, true);
        const first = new SpeechBroker(upstream.config);
        await first.refresh();
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Anfang. ', text: 'In Vorbereitung', after: ' Ende.', kind: 'generic' });
        first.prepare([part], {}, 'default');
        await first.step(); first.last_post = -Infinity; await first.step();
        assert.strictEqual(upstream.posts().length, 2, 'one source and one extraction');
        assert.strictEqual(upstream.downloads().length, 0);
        const fresh = new SpeechBroker(upstream.config);
        await fresh.disk.ready;
        assert.strictEqual(fresh.context_version, 'bts-context-v1');
        fresh.prepare([part], {}, 'default'); await fresh.step();
        const clip = fresh.views([part], {}, 'default')[0];
        assert(clip.local && clip.processed && clip.status === 'completed');
        assert.strictEqual(clip.leading_quiet_ms, 10);
        assert.strictEqual(clip.trailing_quiet_ms, 10);
        assert(fresh.queue('default').items.every(item => item.status === 'completed'));
        for (const entry of first.entries.values()) {
            const source = fs.statSync(path.join(upstream.shared_directory, entry.audio_id + '.wav'));
            assert.strictEqual(source.ino, fs.statSync(first.disk.file(entry.audio_id).path).ino);
            assert(source.nlink > 1, 'each source ID stays pinned even with identical PCM in another ID');
        }
        assert.strictEqual(upstream.posts().length, 2);
    });

    it('converts existing downloaded copies to shared hardlinks at startup without calling the API', async function() {
        upstream = await fixture(directory, true);
        const first = new SpeechBroker({ ...upstream.config, shared_audio_dir: null }); await first.refresh();
        first.prepare(['Text'], {}, 'default'); await first.step();
        const id = [...first.entries.values()][0].audio_id;
        const previous = first.disk.file(id).path;
        assert.notStrictEqual(fs.statSync(previous).ino, fs.statSync(path.join(upstream.shared_directory, id + '.wav')).ino);
        const count = upstream.requests.length;
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        fresh.prepare(['Text'], {}, 'default');
        assert(fresh.views(['Text'], {}, 'default')[0].local);
        assert.strictEqual(fs.statSync(fresh.disk.file(id).path).ino, fs.statSync(path.join(upstream.shared_directory, id + '.wav')).ino);
        assert(!fs.existsSync(previous));
        assert.strictEqual(upstream.requests.length, count);
    });

    it('invalidates restored entries after a verified model change and keeps old files intact', async function() {
        upstream = await fixture(directory, true);
        const first = new SpeechBroker(upstream.config); await first.refresh();
        first.prepare(['Text'], {}, 'default'); await first.step();
        const original = first.disk.file([...first.entries.values()][0].audio_id).path;
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        fresh.prepare(['Text'], {}, 'default');
        assert.strictEqual(fresh.views(['Text'], {}, 'default')[0].status, 'completed');
        upstream.state.revision = 'b'.repeat(40);
        await fresh.refresh();
        assert.strictEqual(fresh.views(['Text'], {}, 'default')[0].status, 'unsubmitted');
        await fresh.step();
        assert.strictEqual(upstream.posts().length, 2);
        assert(fs.existsSync(original));
    });

    it('does not restore truncated or missing audio as completed', async function() {
        upstream = await fixture(directory);
        const first = new SpeechBroker(upstream.config); await first.refresh();
        first.prepare(['Text'], {}, 'default'); await first.step();
        const file = first.disk.file([...first.entries.values()][0].audio_id).path;
        fs.writeFileSync(file, 'broken');
        const fresh = new SpeechBroker(upstream.config); await fresh.disk.ready;
        fresh.prepare(['Text'], {}, 'default');
        assert.strictEqual(fresh.views(['Text'], {}, 'default')[0].status, 'unsubmitted');
        await fresh.step();
        assert.strictEqual(fresh.views(['Text'], {}, 'default')[0].status, 'completed');
        fs.unlinkSync([...fresh.disk.files.values()][0].path);
        assert.strictEqual(fresh.views(['Text'], {}, 'default')[0].status, 'unsubmitted');
    });

    it('does not mark completion before index persistence and retries the same job after a storage failure', async function() {
        upstream = await fixture(directory);
        let clock = 1000;
        const broker = new SpeechBroker(upstream.config, { now: () => clock }); await broker.refresh();
        const persist = broker.disk.persist.bind(broker.disk);
        broker.disk.persist = async () => { throw new Error('disk temporarily unavailable'); };
        broker.prepare(['Text'], {}, 'default'); await broker.step();
        assert.notStrictEqual(broker.views(['Text'], {}, 'default')[0].status, 'completed');
        assert(broker.current.job_id);
        broker.disk.persist = persist; clock += 6000; await broker.step();
        assert.strictEqual(broker.views(['Text'], {}, 'default')[0].status, 'completed');
        assert.strictEqual(upstream.posts().length, 1, 'the already completed synthesis must never be submitted again');
    });

    it('rejects broken downloads before publishing completion', async function() {
        upstream = await fixture(directory); upstream.state.corrupt = true;
        const broker = new SpeechBroker(upstream.config); await broker.refresh();
        broker.prepare(['Text'], {}, 'default'); await broker.step();
        assert.notStrictEqual(broker.views(['Text'], {}, 'default')[0].status, 'completed');
        assert.strictEqual(broker.disk.valid.size, 0);
        assert(fs.readdirSync(broker.disk.audio_directory).every(name => !name.endsWith('.tmp')));
    });

    it('preserves shared sources and supports their cached output after voice switching', async function() {
        upstream = await fixture(directory, true);
        const broker = new SpeechBroker(upstream.config); await broker.refresh();
        broker.prepare(['Text'], { voice: 'hallensprecher' }, 'default'); await broker.step();
        broker.select_voice('default', 'hallensprecherin');
        assert.strictEqual(broker.entries.size, 0);
        broker.prepare(['Text'], { voice: 'hallensprecher' }, 'default');
        assert.strictEqual(broker.views(['Text'], { voice: 'hallensprecher' }, 'default')[0].status, 'completed');
        assert.strictEqual(upstream.posts().length, 1);
    });
});
