'use strict';
const assert = require('assert'), fs = require('fs/promises'), os = require('os'), path = require('path'), http = require('http');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { HelperPool, digest } = require('../bts/speech/helpers/pool');
const { HelperGeneration } = require('../bts/speech/helpers/generation');
const { wave } = require('./fixtures/speech_pcm');
const PROFILE = 'b'.repeat(64), RUNTIME = 'a'.repeat(64), KEY = 'helper-generation-test-only-' + 'x'.repeat(32);
const wav = wave([[50, 0], [500, 1200], [50, 0]]);
const part = name => '~bts-context-v2~' + JSON.stringify({ before: 'Wir erwarten ', text: name, after: ' zum nächsten Spiel.', kind: 'team' });

describe('Regular speech preparation on external helpers', function() {
    this.timeout(20000);
    let directory, server, broker, pool, generation, jobs, calls, clock, base, busy, uploadStatus;
    function view(job) { return { ...job, audio: job.status === 'completed' ? { audio_id: job.job_id, processed: !!job.context } : null }; }
    async function makeBroker() {
        const value = new SpeechBroker(configuration({ enabled: true, api_key: KEY, url: base,
            cache_dir: path.join(directory, 'cache'), submit_interval_ms: 0, poll_interval_ms: 0 }, {}), { now: () => clock });
        await value.disk.ready; await value.refresh(); return value;
    }
    beforeEach(async function() {
        clock = 1700000000000; jobs = new Map(); calls = []; busy = false; uploadStatus = 'completed';
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-helper-generation-'));
        const runtime = Buffer.alloc(2048, 1);
        await fs.writeFile(path.join(directory, 'runtime.tar'), runtime);
        await fs.writeFile(path.join(directory, 'runtime.json'), JSON.stringify({ schema: 1, id: RUNTIME,
            sha256: digest(runtime), size_bytes: runtime.length, generation_profile: PROFILE }));
        pool = new HelperPool(directory, { now: () => clock }); await pool.ready;
        server = http.createServer((req, res) => {
            const chunks = []; req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                assert.strictEqual(req.headers['x-api-key'], KEY);
                const data = Buffer.concat(chunks), json = data.length && req.headers['content-type'] !== 'audio/wav' ? JSON.parse(data) : null;
                calls.push({ path: req.url, method: req.method, headers: req.headers, data, json });
                const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
                if (req.url === '/health') return send({ status: 'ready', model_revision: 'v1', context_version: 'bts-context-v2', helper_generation_profile: PROFILE });
                if (req.url === '/v1/voices') return send({ voices: [{ voice_id: 'hallensprecherin', version: '1', languages: ['de-DE'] }] });
                if (req.url === '/v1/helper-jobs' || req.url === '/v1/speech') {
                    if (req.url === '/v1/speech' && busy) return send({ error: { code: 'busy' } }, 429);
                    const request = json.request || json, id = require('crypto').randomBytes(16).toString('hex');
                    const job = { ...request, job_id: id, status: 'processing' }; jobs.set(id, job);
                    return send({ ...view(job), cache_hit: false, helper_task: req.url === '/v1/helper-jobs' ?
                        { text: job.text, voice: job.voice, seed: job.source_seed ?? 42, generation_profile: PROFILE } : null }, 202);
                }
                const id = req.url.split('/')[3], job = jobs.get(id);
                if (!job) return send({ error: { code: 'unknown_job' } }, 404);
                if (req.url.startsWith('/v1/audio/')) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length }); return res.end(wav); }
                if (req.url.endsWith('/result')) {
                    if (busy) return send({ error: { code: 'busy' } }, 429);
                    assert.strictEqual(req.headers['x-helper-generation-profile'], PROFILE);
                    assert.strictEqual(req.headers['x-helper-threads'], '2');
                    assert(data.equals(wav)); job.status = uploadStatus; return send(view(job));
                }
                if (req.url.endsWith('/cancel')) { job.status = 'failed'; return send({ accepted: true }); }
                return send(view(job));
            });
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        base = 'http://127.0.0.1:' + server.address().port;
        broker = await makeBroker(); generation = new HelperGeneration(broker, pool); broker.helpers = generation;
    });
    afterEach(async function() {
        broker?.stop(); await pool.pending;
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        await fs.rm(directory, { recursive: true, force: true });
    });
    async function worker(number) {
        const pair = await pool.pair();
        return pool.register(pair.key, { protocol: 1, device_id: String(number).repeat(32), runtime_id: RUNTIME,
            name: 'Host ' + number, platform: 'Linux', threads: 2 });
    }
    function prepare(names = ['Anna', 'Berta', 'Clara']) {
        broker.prepare(names.map(part), { voice: 'hallensprecherin', priority: 'normal', prefetch: true }, 'default');
    }
    async function tick() { clock += 1001; await generation.step(); }
    for (const count of [1, 3]) it('feeds idle preparation to the server and ' + count + ' helpers without enqueuing the full inventory', async function() {
        const agents = [];
        for (let i = 1; i <= count; i++) agents.push(await worker(i));
        const names = Array.from({ length: 50 }, (_, i) => 'Vorratsname ' + String.fromCharCode(65 + i));
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin', idle_parts: names.map(part) });
        assert.strictEqual(broker.entries.size, 0);
        await tick();
        const remote = [];
        for (const agent of agents) remote.push((await pool.claim(agent.session)).job);
        assert(remote.every(Boolean));
        await broker.step();
        const running = broker.queue('default').items.filter(item => item.current);
        assert.strictEqual(running.length, count + 1);
        assert.strictEqual(new Set(running.map(item => item.execution.name)).size, count + 1);
        assert.deepStrictEqual(remote.map(job => job.text), names.slice(0, count).map(name => 'Wir erwarten ' + name + ' zum nächsten Spiel.'));
        assert.strictEqual(broker.current.entry.text, 'Wir erwarten ' + names[count] + ' zum nächsten Spiel.');
        assert.strictEqual(broker.entries.size, (count + 1) * 2, 'only assigned source/clip chains belong in the queue');
        assert.strictEqual(broker.idle_plans.get('default').cursor, 0, 'unfinished inventory must not be acknowledged early');
    });
    for (const count of [1, 3]) it('starts the buffered next batch on all ' + (count + 1) + ' generators during replanning', async function() {
        const agents = [];
        for (let i = 1; i <= count; i++) agents.push(await worker(i));
        await tick();
        assert.strictEqual(generation.parallelism, count);
        const names = ['Anna', 'Berta', 'Clara', 'Dora', 'Emil', 'Felix'];
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin', idle_parts: names.map(part) });
        broker.fill_idle_queue();
        assert.strictEqual(broker.entries.size, 2 * (count + 1));
        broker.pending_plans.add('default');
        await tick();
        const claimed = [];
        for (const agent of agents) claimed.push((await pool.claim(agent.session)).job);
        assert(claimed.every(Boolean));
        await broker.step();
        assert.strictEqual(broker.queue('default').items.filter(item => item.current).length, count + 1);
        assert.strictEqual(broker.entries.size, 2 * (count + 1), 'new inventory still waits for the updated plan');
    });
    it('looks past cuts sharing an assigned source to keep another helper busy', async function() {
        const a = await worker(1), b = await worker(2);
        const shared = '~bts-context-v2~' + JSON.stringify({ before: 'Wir erwarten Anna ', text: 'zum nächsten Spiel', after: '.', kind: 'generic' });
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin', idle_parts: [part('Anna'), shared, part('Berta'), part('Clara')] });
        await tick();
        const first = (await pool.claim(a.session)).job, next = (await pool.claim(b.session)).job;
        assert.strictEqual(first.text, 'Wir erwarten Anna zum nächsten Spiel.');
        assert.strictEqual(next.text, 'Wir erwarten Berta zum nächsten Spiel.');
        assert.strictEqual(broker.entries.size, 4);
        await broker.step();
        assert.strictEqual(broker.current.entry.text, 'Wir erwarten Clara zum nächsten Spiel.');
        assert.strictEqual(broker.queue('default').items.filter(item => item.current).length, 3);
    });
    it('refills an idle helper while the local source is still rendering and returned audio waits for validation', async function() {
        const a = await worker(1);
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin', idle_parts: ['Anna', 'Berta', 'Clara', 'Dora'].map(part) });
        await tick(); const first = (await pool.claim(a.session)).job;
        await broker.step(); const local = broker.current.job_id;
        await pool.complete(a.session, first.id, first.lease, wav, 1000);
        busy = true; await tick();
        const next = (await pool.claim(a.session)).job;
        assert(next); assert.strictEqual(next.text, 'Wir erwarten Clara zum nächsten Spiel.');
        assert.strictEqual(broker.current.job_id, local);
        const queue = broker.queue('default');
        assert.strictEqual(queue.items.filter(item => item.current).length, 2);
        assert.strictEqual(queue.items.filter(item => item.execution?.phase === 'waiting_validation').length, 1);
        assert.strictEqual(broker.entries.size, 6);
    });
    it('keeps speculative admission behind foreground work even when a helper is free', async function() {
        await worker(1);
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin', idle_parts: [part('Anna')] });
        broker.prepare(['Dringender Aufruf'], { voice: 'hallensprecherin', priority: 'high' }, 'default');
        await tick(); await broker.step(); await tick();
        assert.strictEqual((await pool.snapshot('default')).jobs.length, 0);
        assert.strictEqual(broker.entries.size, 1);
        assert.strictEqual(broker.current.entry.text, 'Dringender Aufruf');
    });

    it('keeps admitted work on both generators during replanning while deferring new inventory', async function() {
        const a = await worker(1);
        const parts = ['Anna', 'Berta', 'Clara'].map(part);
        broker.reconcile_prefetch('default', [], { voice: 'hallensprecherin', idle_parts: parts });
        broker.prepare(parts.slice(0, 2), { voice: 'hallensprecherin', priority: 'idle', prefetch: true }, 'default');
        broker.pending_plans.add('default');
        await tick();
        const remote = (await pool.claim(a.session)).job;
        assert(remote, 'the helper can continue an existing assignment');
        await broker.step();
        assert.strictEqual(broker.queue('default').items.filter(item => item.current).length, 2);
        assert.strictEqual(broker.entries.size, 4, 'the third source stays outside the bounded work queue');
        assert(!broker.entries.has(broker.key(parts[2], 'hallensprecherin', 'de-DE')));
    });

    it('renders two sources concurrently while the local server can work, then publishes through the central API and disk cache', async function() {
        const a = await worker(1), b = await worker(2); prepare(); await tick();
        const first = (await pool.claim(a.session)).job, second = (await pool.claim(b.session)).job;
        assert(first && second); assert.notStrictEqual(first.id, second.id);
        assert.strictEqual(calls.filter(call => call.path === '/v1/helper-jobs').length, 2);
        await broker.step(); assert(broker.current, 'a third source still uses the local CPU slot');
        const local = jobs.get(broker.current.job_id); assert(local);
        await pool.complete(a.session, first.id, first.lease, wav, 1000);
        await pool.complete(b.session, second.id, second.lease, wav, 1000);
        busy = true; await tick();
        assert((await pool.snapshot('default')).jobs.every(job => !job.publication));
        busy = false; local.status = 'completed'; clock += 1001; await broker.step();
        await tick(); await tick();
        const view = await pool.snapshot('default');
        assert(view.jobs.every(job => job.publication === 'ready'));
        assert(view.jobs.every(job => !job.audio_path), 'unchecked source audio is never directly exposed as ready playback');
        const sources = [...broker.entries.values()].filter(entry => entry.context?.kind === 'source');
        assert(sources.every(entry => entry.status === 'completed' && entry.local));
        assert.strictEqual((await fs.readdir(path.join(directory, 'audio'))).length, 0, 'staged raw helper audio is cleaned up');
        assert(calls.filter(call => call.path === '/v1/speech').length === 1);
        const reloaded = await makeBroker(); reloaded.prepare(['Anna', 'Berta', 'Clara'].map(part), { voice: 'hallensprecherin' }, 'default');
        assert([...reloaded.entries.values()].filter(entry => entry.context?.kind === 'source').every(entry => entry.local));
        reloaded.stop();
    });
    it('shows server and helper work separately, waits for validation, and uploads accepted audio only once', async function() {
        const a = await worker(1); prepare(['Anna', 'Berta']); await tick();
        assert.strictEqual(broker.queue('default').items.filter(item => item.current).length, 0, 'an unclaimed lease is waiting');
        const remote = (await pool.claim(a.session)).job;
        await broker.step();
        let queue = broker.queue('default');
        assert.strictEqual(queue.items.filter(item => item.current).length, 2);
        assert.deepStrictEqual(new Set(queue.items.filter(item => item.current).map(item => item.execution.name)), new Set(['Sprachserver', 'Host 1']));
        await pool.complete(a.session, remote.id, remote.lease, wav, 1000);
        queue = broker.queue('default');
        assert.strictEqual(queue.items.filter(item => item.current).length, 1);
        assert(queue.items.some(item => item.execution?.phase === 'waiting_validation' && !item.current));
        busy = true; await tick();
        const local = jobs.get(broker.current.job_id); local.status = 'completed'; clock += 1001; await broker.step();
        busy = false; uploadStatus = 'processing'; await tick();
        const uploads = calls.filter(call => call.path.endsWith('/result')).length;
        await tick(); await tick();
        assert.strictEqual(calls.filter(call => call.path.endsWith('/result')).length, uploads, 'accepted WAVs must only be polled');
        queue = broker.queue('default');
        assert.strictEqual(queue.items.filter(item => item.current).length, 1);
        assert.strictEqual(queue.items.find(item => item.current).execution.phase, 'validation');
        busy = true; await broker.step();
        queue = broker.queue('default');
        assert(queue.items.some(item => item.waiting_for_server));
        assert(queue.items.every(item => !item.retry_at), 'normal capacity waiting must not look like a failed attempt');
    });

    it('preserves leases during upstream outages and reattaches persisted tasks after a BTS speech-process restart', async function() {
        const a = await worker(1); prepare(['Anna']); await tick();
        const job = (await pool.claim(a.session)).job;
        broker.helper_generation_profile = null; await tick();
        assert.strictEqual((await pool.claim(a.session)).job.id, job.id);
        broker.stop(); broker = await makeBroker(); prepare(['Anna']);
        pool = new HelperPool(directory, { now: () => clock }); await pool.ready;
        generation = new HelperGeneration(broker, pool); broker.helpers = generation;
        await pool.complete(a.session, job.id, job.lease, wav, 1000);
        await tick(); await tick();
        assert.strictEqual((await pool.snapshot('default')).jobs[0].publication, 'ready');
    });
    it('releases failed work for the local server and prevents repeated helper retries', async function() {
        const a = await worker(1); prepare(['Anna']); await tick();
        const job = (await pool.claim(a.session)).job;
        await pool.fail(a.session, job.id, job.lease, 'memory_limit'); await tick();
        await broker.step(); assert(broker.current);
        assert.strictEqual(calls.filter(call => call.path === '/v1/helper-jobs').length, 1);
        assert.strictEqual((await pool.snapshot('default')).jobs[0].publication, 'failed');
    });
    it('rejects stale returned audio when the preparation plan changes', async function() {
        const a = await worker(1); prepare(['Anna']); await tick();
        const job = (await pool.claim(a.session)).job;
        broker.entries.clear(); await tick();
        await assert.rejects(pool.complete(a.session, job.id, job.lease, wav, 1), /lease_lost/);
        assert(calls.some(call => call.path.endsWith('/cancel')));
    });
    it('continues locally for an incompatible voice/runtime package', async function() {
        await worker(1); prepare(['Anna']); broker.helper_generation_profile = 'c'.repeat(64); await tick();
        assert.strictEqual(calls.filter(call => call.path === '/v1/helper-jobs').length, 0);
        assert.strictEqual((await pool.snapshot('default')).generation.reason, 'helper_profile_mismatch');
        await broker.step(); assert(broker.current);
    });
    it('reassigns expired production leases, preserves fresh-source seeds, and rejects the old return', async function() {
        const a = await worker(1), b = await worker(2); prepare(['Anna']);
        const source = [...broker.entries.values()].find(entry => entry.context?.kind === 'source');
        source.source_seed = 45; await tick();
        const first = (await pool.claim(a.session)).job; assert.strictEqual(first.seed, 45);
        clock += 90001;
        const replacement = (await pool.claim(b.session)).job;
        assert.strictEqual(first.id, replacement.id); assert.strictEqual(replacement.seed, 45);
        await assert.rejects(pool.complete(a.session, first.id, first.lease, wav, 1), /lease_lost/);
        await pool.complete(b.session, replacement.id, replacement.lease, wav, 1000);
        await tick(); await tick();
        const job = (await pool.snapshot('default')).jobs[0];
        assert.strictEqual(job.worker_id, b.worker_id); assert.strictEqual(job.publication, 'ready');
    });
    it('recovers locally when a central reservation disappeared', async function() {
        await worker(1); prepare(['Anna']); await tick();
        jobs.clear(); await tick();
        assert.strictEqual((await pool.snapshot('default')).jobs[0].error, 'helper_assignment_lost');
        await broker.step(); assert(broker.current);
    });
});
